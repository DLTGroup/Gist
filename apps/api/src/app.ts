import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { ExportTarget, ExtractionTemplate, Gist, Savings, UserSettings } from "@gist/core";
import {
  BUILT_IN_TEMPLATES,
  computeSavings,
  countWords,
  exportFilename,
  findTemplate,
  toEnex,
  toMarkdown,
  toPlainText,
  totalSavings,
  validateTemplate,
} from "@gist/core";
import type { DB } from "./db.ts";
import { DEFAULT_SETTINGS, getGist, getSettings, listFolders, listTemplates, newId, normalizeTag, now, reindex, rowToGist, setTags } from "./db.ts";
import { createSession, deleteSession, hashPassword, userIdForToken, verifyPassword } from "./auth.ts";
import { IngestError, ingest } from "./ingest/index.ts";
import { MAX_IMPORT_ITEMS, expandCollection, type Collection } from "./ingest/playlist.ts";
import { SummarizeError, type Summarizer } from "./summarize.ts";
import { ExportError, sendToTarget } from "./exporters.ts";

type Env = { Variables: { userId: string } };
type Row = Record<string, unknown>;

export interface AppDeps {
  db: DB;
  summarizer: Summarizer;
  /** Override ingestion in tests. */
  ingestFn?: typeof ingest;
  expandFn?: typeof expandCollection;
  corsOrigins?: string[];
}

const SECRET_FIELDS: (keyof UserSettings)[] = ["notionToken"];

export function createApp({ db, summarizer, ingestFn = ingest, expandFn = expandCollection, corsOrigins = [] }: AppDeps) {
  const app = new Hono<Env>();
  const jobs = new JobQueue(3);
  const rate = new RateLimiter(40, 3600_000);
  const bulkRate = new RateLimiter(150, 3600_000);

  app.use("*", secureHeaders({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: { defaultSrc: ["'self'"], imgSrc: ["'self'", "https:", "data:"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'"], frameAncestors: ["'none'"] } }));
  app.use("/api/*", bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => c.json({ error: "That's too much text to send at once." }, 413) }));
  const authRate = new RateLimiter(20, 15 * 60_000);
  app.use("/api/auth/*", async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "local";
    if (!authRate.take(ip)) fail(429, "Too many attempts. Please wait a few minutes and try again.");
    await next();
  });
  app.use("/api/*", cors({ origin: (o) => (corsOrigins.includes(o) || corsOrigins.includes("*") ? o : null), allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof IngestError || err instanceof SummarizeError || err instanceof ExportError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: "Something went wrong on our side." }, 500);
  });

  const fail = (status: 400 | 401 | 403 | 404 | 409 | 422 | 429, message: string): never => {
    throw new HTTPException(status, { message });
  };
  const body = async <T>(c: Context): Promise<T> => (await c.req.json().catch(() => ({}))) as T;

  // ---------- public ----------
  app.get("/api/health", (c) => c.json({ ok: true, model: summarizer.model, demo: summarizer.model.startsWith("demo") }));

  app.post("/api/auth/signup", async (c) => {
    const { email, password, name } = await body<{ email?: string; password?: string; name?: string }>(c);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter a valid email address.");
    if (!password || password.length < 8) fail(400, "Use a password of at least 8 characters.");
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email!)) fail(409, "An account with that email already exists. Try signing in.");
    const id = newId();
    db.prepare("INSERT INTO users (id, email, name, password_hash, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id, email!.trim(), name?.trim() || null, await hashPassword(password!), "{}", now(),
    );
    return c.json({ token: createSession(db, id), user: publicUser(id) }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const { email, password } = await body<{ email?: string; password?: string }>(c);
    const r = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email ?? "") as Row | undefined;
    if (!r || !(await verifyPassword(password ?? "", r.password_hash as string))) fail(401, "Email or password is incorrect.");
    return c.json({ token: createSession(db, r!.id as string), user: publicUser(r!.id as string) });
  });

  // ---------- authenticated ----------
  app.use("/api/*", async (c, next) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const userId = token ? userIdForToken(db, token) : null;
    if (!userId) fail(401, "Please sign in.");
    c.set("userId", userId!);
    await next();
  });

  app.post("/api/auth/logout", (c) => {
    deleteSession(db, c.req.header("authorization")!.replace(/^Bearer\s+/i, ""));
    return c.json({ ok: true });
  });

  function publicUser(id: string) {
    const r = db.prepare("SELECT id, email, name, created_at FROM users WHERE id = ?").get(id) as Row;
    const settings = getSettings(db, id);
    const masked = { ...settings } as Record<string, unknown>;
    for (const f of SECRET_FIELDS) masked[f] = settings[f] ? "••••" + String(settings[f]).slice(-4) : null;
    return { id: r.id, email: r.email, name: r.name, createdAt: r.created_at, settings: masked };
  }

  app.get("/api/me", (c) => c.json({ user: publicUser(c.get("userId")) }));

  app.patch("/api/settings", async (c) => {
    const uid = c.get("userId");
    const patch = await body<Partial<UserSettings>>(c);
    const current = getSettings(db, uid);
    const next: UserSettings = { ...current };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof UserSettings)[]) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (SECRET_FIELDS.includes(k) && typeof v === "string" && v.startsWith("••••")) continue; // unchanged mask
      (next as unknown as Record<string, unknown>)[k] = v === "" ? null : v;
    }
    if (typeof next.hourlyRate !== "number" || next.hourlyRate < 0 || next.hourlyRate > 10000) fail(400, "Hourly value must be between 0 and 10,000.");
    if (typeof next.playbackSpeed !== "number" || next.playbackSpeed < 0.5 || next.playbackSpeed > 4) fail(400, "Playback speed must be between 0.5× and 4×.");
    if (next.webhookUrl && !/^https:\/\//.test(next.webhookUrl)) fail(400, "Webhook URLs must start with https://");
    db.prepare("UPDATE users SET settings_json = ? WHERE id = ?").run(JSON.stringify(next), uid);
    return c.json({ user: publicUser(uid) });
  });

  // ---------- templates ----------
  app.get("/api/templates", (c) => c.json({ templates: [...BUILT_IN_TEMPLATES, ...listTemplates(db, c.get("userId"))] }));

  const saveTemplate = async (c: Context<Env>, id: string, isNew: boolean) => {
    const t = await body<Partial<ExtractionTemplate>>(c);
    const err = validateTemplate(t);
    if (err) fail(400, err);
    const tpl: ExtractionTemplate = {
      id,
      name: t.name!.trim(),
      description: t.description?.trim() ?? "",
      icon: t.icon?.trim() || "✨",
      length: t.length ?? "standard",
      tone: t.tone?.trim() || undefined,
      audience: t.audience?.trim() || undefined,
      includeTimestamps: t.includeTimestamps ?? true,
      sections: t.sections!.map((s, i) => ({ id: s.id?.trim() || `s${i + 1}`, heading: s.heading.trim(), instruction: s.instruction.trim(), format: s.format })),
    };
    if (isNew) db.prepare("INSERT INTO templates (id, user_id, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, c.get("userId"), JSON.stringify(tpl), now(), now());
    else {
      const r = db.prepare("UPDATE templates SET json = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(tpl), now(), id, c.get("userId"));
      if (!r.changes) fail(404, "Template not found (built-in templates can be copied, not edited).");
    }
    return c.json({ template: tpl }, isNew ? 201 : 200);
  };
  app.post("/api/templates", (c) => saveTemplate(c, "custom-" + newId().slice(0, 8), true));
  app.put("/api/templates/:id", (c) => saveTemplate(c, c.req.param("id"), false));
  app.delete("/api/templates/:id", (c) => {
    db.prepare("DELETE FROM templates WHERE id = ? AND user_id = ?").run(c.req.param("id"), c.get("userId"));
    return c.json({ ok: true });
  });

  // ---------- folders & tags ----------
  app.get("/api/folders", (c) => c.json({ folders: listFolders(db, c.get("userId")) }));
  app.post("/api/folders", async (c) => {
    const { name, colour } = await body<{ name?: string; colour?: string }>(c);
    if (!name?.trim()) fail(400, "Name the folder.");
    const id = newId();
    db.prepare("INSERT INTO folders (id, user_id, name, colour, created_at) VALUES (?, ?, ?, ?, ?)").run(id, c.get("userId"), name!.trim().slice(0, 60), colour ?? null, now());
    return c.json({ folder: { id, name: name!.trim(), colour: colour ?? null, gistCount: 0 } }, 201);
  });
  app.patch("/api/folders/:id", async (c) => {
    const { name, colour } = await body<{ name?: string; colour?: string | null }>(c);
    const r = db.prepare("UPDATE folders SET name = COALESCE(?, name), colour = COALESCE(?, colour) WHERE id = ? AND user_id = ?").run(name?.trim() || null, colour ?? null, c.req.param("id"), c.get("userId"));
    if (!r.changes) fail(404, "Folder not found.");
    return c.json({ ok: true });
  });
  app.delete("/api/folders/:id", (c) => {
    db.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").run(c.req.param("id"), c.get("userId"));
    return c.json({ ok: true });
  });
  app.get("/api/tags", (c) => {
    const rows = db
      .prepare("SELECT t.tag, COUNT(*) AS n FROM gist_tags t JOIN gists g ON g.id = t.gist_id WHERE g.user_id = ? GROUP BY t.tag ORDER BY n DESC, t.tag")
      .all(c.get("userId")) as Row[];
    return c.json({ tags: rows.map((r) => ({ tag: r.tag, count: Number(r.n) })) });
  });

  // ---------- gists ----------
  async function processGist(g: Gist, input: { url?: string | null; text?: string | null; title?: string | null }, template: ExtractionTemplate) {
    try {
      const src = await ingestFn(input);
      const settings = getSettings(db, g.userId);
      const wordCount = countWords(src.text);
      const sourceMeta = { kind: src.kind, url: src.url, title: src.title, author: src.author, publishedAt: src.publishedAt, thumbnailUrl: src.thumbnailUrl, durationSeconds: src.durationSeconds, language: src.language ?? null, wordCount };
      db.prepare("UPDATE gists SET source_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(sourceMeta), now(), g.id);
      const summary = await summarizer.summarize(src, template, g.focus);
      const savings = computeSavings(sourceMeta, summary, { readingWpm: 238, noteTakingFactor: 0.35, hourlyRate: settings.hourlyRate, currency: settings.currency, playbackSpeed: settings.playbackSpeed });
      db.prepare("UPDATE gists SET status = 'ready', error = NULL, summary_json = ?, savings_json = ?, model = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(summary), JSON.stringify(savings), summarizer.model, now(), g.id,
      );
      const existing = (db.prepare("SELECT tag FROM gist_tags WHERE gist_id = ?").all(g.id) as Row[]).map((r) => r.tag as string);
      setTags(db, g.id, existing.length ? existing : summary.suggestedTags);
      const fresh = getGist(db, g.userId, g.id)!;
      reindex(db, fresh);
      // The source text is deliberately not stored: only the summary and metadata are kept.
      if (settings.autoExport && ["notion", "webhook"].includes(settings.autoExport)) {
        await sendToTarget(fresh, settings.autoExport, settings).then(
          (r) => logExport(g.id, settings.autoExport!, true, r.url),
          (e: Error) => logExport(g.id, settings.autoExport!, false, e.message),
        );
      }
    } catch (err) {
      const msg = err instanceof IngestError || err instanceof SummarizeError ? err.message : "Something went wrong while making this gist.";
      if (!(err instanceof IngestError || err instanceof SummarizeError)) console.error(err);
      db.prepare("UPDATE gists SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(msg, now(), g.id);
    }
  }

  function logExport(gistId: string, target: string, ok: boolean, detail: string | null) {
    db.prepare("INSERT INTO export_log (id, gist_id, target, ok, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(newId(), gistId, target, ok ? 1 : 0, detail, now());
  }

  function resolveTemplate(uid: string, id?: string | null) {
    const custom = listTemplates(db, uid);
    const t = findTemplate(id || getSettings(db, uid).defaultTemplateId, custom) ?? BUILT_IN_TEMPLATES[0];
    return t;
  }

  app.post("/api/gists", async (c) => {
    const uid = c.get("userId");
    if (!rate.take(uid)) fail(429, "You've hit the hourly limit. Try again a little later.");
    const b = await body<{ url?: string; text?: string; title?: string; templateId?: string; focus?: string; folderId?: string; tags?: string[] }>(c);
    if (!b.url?.trim() && !b.text?.trim()) fail(400, "Paste a link or some text.");
    if (b.text && b.text.length > 2_000_000) fail(400, "That text is too long (2 million characters maximum).");
    const template = resolveTemplate(uid, b.templateId);
    if (b.folderId && !db.prepare("SELECT 1 FROM folders WHERE id = ? AND user_id = ?").get(b.folderId, uid)) fail(404, "Folder not found.");
    const id = newId();
    const t = now();
    const placeholder = { kind: b.text?.trim() ? "text" : "web", url: b.url?.trim() || null, title: b.title?.trim() || b.url?.trim() || "Pasted text", author: null, publishedAt: null, thumbnailUrl: null, durationSeconds: null, wordCount: 0 };
    db.prepare("INSERT INTO gists (id, user_id, status, source_json, template_id, focus, folder_id, created_at, updated_at) VALUES (?, ?, 'processing', ?, ?, ?, ?, ?, ?)").run(
      id, uid, JSON.stringify(placeholder), template.id, b.focus?.trim() || null, b.folderId ?? null, t, t,
    );
    if (b.tags?.length) setTags(db, id, b.tags);
    const g = getGist(db, uid, id)!;
    const job = jobs.run(() => processGist(g, { url: b.url, text: b.text, title: b.title }, template));
    if (c.req.query("wait") === "1") await job;
    return c.json({ gist: getGist(db, uid, id) }, 202);
  });

  app.get("/api/gists", (c) => {
    const uid = c.get("userId");
    const q = c.req.query("q")?.trim();
    const folder = c.req.query("folder");
    const tag = c.req.query("tag");
    const kind = c.req.query("kind");
    const fav = c.req.query("favourite") === "1";
    const limit = Math.min(100, Number(c.req.query("limit") ?? 50) || 50);
    const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
    const where = ["g.user_id = ?"];
    const params: (string | number)[] = [uid];
    let from = "gists g";
    if (q) {
      from = "gists g JOIN gists_fts f ON f.gist_id = g.id";
      where.push("gists_fts MATCH ?");
      params.push(ftsQuery(q));
    }
    if (folder === "none") where.push("g.folder_id IS NULL");
    else if (folder) (where.push("g.folder_id = ?"), params.push(folder));
    if (tag) (where.push("EXISTS (SELECT 1 FROM gist_tags t WHERE t.gist_id = g.id AND t.tag = ?)"), params.push(normalizeTag(tag)));
    if (kind) (where.push("json_extract(g.source_json, '$.kind') = ?"), params.push(kind));
    if (fav) where.push("g.favourite = 1");
    const order = q ? "bm25(gists_fts, 0, 0, 4.0, 1.0, 2.0), g.created_at DESC" : "g.created_at DESC";
    const rows = db.prepare(`SELECT g.* FROM ${from} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit + 1, offset) as Row[];
    return c.json({ gists: rows.slice(0, limit).map((r) => rowToGist(db, r)), hasMore: rows.length > limit });
  });

  const mustGet = (c: Context<Env>) => getGist(db, c.get("userId"), c.req.param("id")!) ?? fail(404, "Gist not found.");

  app.get("/api/gists/:id", (c) => c.json({ gist: mustGet(c) }));

  app.patch("/api/gists/:id", async (c) => {
    const g = mustGet(c);
    const b = await body<{ folderId?: string | null; tags?: string[]; favourite?: boolean; title?: string }>(c);
    if (b.folderId !== undefined) {
      if (b.folderId && !db.prepare("SELECT 1 FROM folders WHERE id = ? AND user_id = ?").get(b.folderId, g.userId)) fail(404, "Folder not found.");
      db.prepare("UPDATE gists SET folder_id = ? WHERE id = ?").run(b.folderId, g.id);
    }
    if (b.favourite !== undefined) db.prepare("UPDATE gists SET favourite = ? WHERE id = ?").run(b.favourite ? 1 : 0, g.id);
    if (b.tags) setTags(db, g.id, b.tags);
    if (b.title?.trim() && g.summary) db.prepare("UPDATE gists SET summary_json = ? WHERE id = ?").run(JSON.stringify({ ...g.summary, title: b.title.trim() }), g.id);
    db.prepare("UPDATE gists SET updated_at = ? WHERE id = ?").run(now(), g.id);
    const fresh = getGist(db, g.userId, g.id)!;
    reindex(db, fresh);
    return c.json({ gist: fresh });
  });

  app.delete("/api/gists/:id", (c) => {
    const g = mustGet(c);
    db.prepare("DELETE FROM gists_fts WHERE gist_id = ?").run(g.id);
    db.prepare("DELETE FROM gists WHERE id = ?").run(g.id);
    return c.json({ ok: true });
  });

  app.post("/api/gists/:id/regenerate", async (c) => {
    const g = mustGet(c);
    if (g.status === "processing") fail(409, "This gist is still being made.");
    if (g.source.kind === "text") fail(400, "Pasted text isn't stored, so it can't be re-run. Paste it again with the new template.");
    if (!rate.take(g.userId)) fail(429, "You've hit the hourly limit. Try again a little later.");
    const b = await body<{ templateId?: string; focus?: string }>(c);
    const template = resolveTemplate(g.userId, b.templateId ?? g.templateId);
    const focus = b.focus !== undefined ? b.focus.trim() || null : g.focus;
    db.prepare("UPDATE gists SET status = 'processing', error = NULL, template_id = ?, focus = ?, updated_at = ? WHERE id = ?").run(template.id, focus, now(), g.id);
    const job = jobs.run(() => processGist({ ...g, focus }, { url: g.source.url }, template));
    if (c.req.query("wait") === "1") await job;
    return c.json({ gist: getGist(db, g.userId, g.id) }, 202);
  });

  app.get("/api/gists/:id/export/:format", (c) => {
    const g = mustGet(c);
    if (!g.summary) fail(409, "This gist isn't ready yet.");
    const format = c.req.param("format");
    const files: Record<string, [string, string, string]> = {
      markdown: [toMarkdown(g, { frontMatter: true }), "text/markdown; charset=utf-8", exportFilename(g, "md")],
      text: [toPlainText(g), "text/plain; charset=utf-8", exportFilename(g, "txt")],
      evernote: [toEnex([g]), "application/enex+xml; charset=utf-8", exportFilename(g, "enex")],
      json: [JSON.stringify(g, null, 2), "application/json", exportFilename(g, "json")],
    };
    const f = files[format] ?? fail(400, "Unknown export format.");
    logExport(g.id, format, true, null);
    return c.body(f[0], 200, { "content-type": f[1], "content-disposition": `attachment; filename="${f[2]}"` });
  });

  app.post("/api/gists/:id/send", async (c) => {
    const g = mustGet(c);
    const { target } = await body<{ target?: ExportTarget }>(c);
    if (!target) fail(400, "Choose where to send it.");
    try {
      const r = await sendToTarget(g, target!, getSettings(db, g.userId));
      logExport(g.id, target!, true, r.url);
      return c.json(r);
    } catch (e) {
      logExport(g.id, target!, false, (e as Error).message);
      throw e;
    }
  });

  app.get("/api/export/evernote", (c) => {
    const uid = c.get("userId");
    const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean);
    const gists = ids.length
      ? ids.map((id) => getGist(db, uid, id)).filter((g): g is Gist => !!g)
      : (db.prepare("SELECT * FROM gists WHERE user_id = ? AND status = 'ready' ORDER BY created_at DESC").all(uid) as Row[]).map((r) => rowToGist(db, r));
    return c.body(toEnex(gists), 200, { "content-type": "application/enex+xml; charset=utf-8", "content-disposition": 'attachment; filename="gist-export.enex"' });
  });

  // ---------- bulk import (playlists, shows, feeds, pasted link lists) ----------
  app.post("/api/imports", async (c) => {
    const uid = c.get("userId");
    const b = await body<{ url?: string; urls?: string[]; limit?: number; templateId?: string; focus?: string; folderId?: string | null; title?: string }>(c);
    const limit = Math.max(1, Math.min(MAX_IMPORT_ITEMS, Number(b.limit) || 25));
    let col: Collection;
    if (b.url?.trim()) col = await expandFn(b.url.trim(), limit);
    else if (b.urls?.length) {
      const urls = [...new Set(b.urls.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))];
      if (!urls.length) fail(400, "Paste at least one link.");
      col = { kind: "youtube-playlist", title: b.title?.trim() || `Imported links (${new Date().toLocaleDateString("en-CA")})`, items: urls.slice(0, limit).map((url) => ({ url, title: null })), skipped: urls.length > limit ? [{ title: null, reason: `${urls.length - limit} more link(s) beyond the ${limit}-item limit` }] : [] };
      (col as { kind: string }).kind = "links";
    } else fail(400, "Paste a playlist link or a list of links.");
    for (let i = 0; i < col!.items.length; i++) if (!bulkRate.take(uid)) fail(429, "That's more than the hourly bulk limit. Try a smaller import or wait a little.");
    const template = resolveTemplate(uid, b.templateId);
    let folderId = b.folderId ?? null;
    if (folderId && !db.prepare("SELECT 1 FROM folders WHERE id = ? AND user_id = ?").get(folderId, uid)) fail(404, "Folder not found.");
    if (!folderId) {
      folderId = newId();
      db.prepare("INSERT INTO folders (id, user_id, name, colour, created_at) VALUES (?, ?, ?, NULL, ?)").run(folderId, uid, col!.title.slice(0, 60), now());
    }
    const importId = newId();
    db.prepare("INSERT INTO imports (id, user_id, kind, source_url, title, folder_id, template_id, skipped_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      importId, uid, col!.kind, b.url?.trim() || null, col!.title, folderId, template.id, JSON.stringify(col!.skipped), now(),
    );
    const jobsDone: Promise<unknown>[] = [];
    col!.items.forEach((item, i) => {
      const id = newId();
      // Stagger timestamps so the library keeps playlist order (newest first = last item first).
      const t = new Date(Date.now() + i).toISOString();
      const placeholder = { kind: "web", url: item.url, title: item.title || item.url, author: null, publishedAt: null, thumbnailUrl: null, durationSeconds: null, wordCount: 0 };
      db.prepare("INSERT INTO gists (id, user_id, status, source_json, template_id, focus, folder_id, import_id, created_at, updated_at) VALUES (?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?)").run(
        id, uid, JSON.stringify(placeholder), template.id, b.focus?.trim() || null, folderId, importId, t, t,
      );
      const g = getGist(db, uid, id)!;
      jobsDone.push(jobs.run(() => processGist(g, { url: item.url }, template)));
    });
    if (c.req.query("wait") === "1") await Promise.all(jobsDone);
    return c.json({ import: importStatus(uid, importId) }, 202);
  });

  function importStatus(uid: string, id: string) {
    const r = db.prepare("SELECT * FROM imports WHERE id = ? AND user_id = ?").get(id, uid) as Row | undefined;
    if (!r) return fail(404, "Import not found.");
    const gists = (db.prepare("SELECT * FROM gists WHERE import_id = ? ORDER BY created_at").all(id) as Row[]).map((g) => rowToGist(db, g));
    const count = (s: string) => gists.filter((g) => g.status === s).length;
    const savings = gists.flatMap((g) => (g.savings ? [g.savings] : []));
    return {
      id, title: r.title as string, kind: r.kind as string, sourceUrl: (r.source_url as string) ?? null, folderId: (r.folder_id as string) ?? null,
      templateId: r.template_id as string, createdAt: r.created_at as string, skipped: JSON.parse(r.skipped_json as string),
      total: gists.length, ready: count("ready"), failed: count("failed"), processing: count("processing"),
      totals: totalSavings(savings, getSettings(db, uid).currency),
      gists,
    };
  }

  app.get("/api/imports", (c) => {
    const uid = c.get("userId");
    const rows = db.prepare("SELECT id FROM imports WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(uid) as Row[];
    return c.json({ imports: rows.map((r) => { const s = importStatus(uid, r.id as string); return { ...s, gists: undefined }; }) });
  });
  app.get("/api/imports/:id", (c) => c.json({ import: importStatus(c.get("userId"), c.req.param("id")) }));
  app.post("/api/imports/:id/retry", async (c) => {
    const uid = c.get("userId");
    const imp = importStatus(uid, c.req.param("id"));
    const failed = imp.gists.filter((g) => g.status === "failed" && g.source.url);
    for (const g of failed) {
      const template = resolveTemplate(uid, g.templateId);
      db.prepare("UPDATE gists SET status = 'processing', error = NULL WHERE id = ?").run(g.id);
      jobs.run(() => processGist(g, { url: g.source.url }, template));
    }
    return c.json({ retried: failed.length });
  });

  /** One Markdown file with every ready gist in a folder or import, e.g. to drop into a notes app at once. */
  app.get("/api/export/markdown", (c) => {
    const uid = c.get("userId");
    const folder = c.req.query("folder");
    const imp = c.req.query("import");
    const where = imp ? "import_id = ?" : folder ? "folder_id = ?" : "1 = 1";
    const params = imp ? [uid, imp] : folder ? [uid, folder] : [uid];
    const gists = (db.prepare(`SELECT * FROM gists WHERE user_id = ? AND status = 'ready' AND ${where} ORDER BY created_at`).all(...params) as Row[]).map((r) => rowToGist(db, r));
    const name = imp ? (db.prepare("SELECT title FROM imports WHERE id = ?").get(imp) as Row | undefined)?.title : folder ? (db.prepare("SELECT name FROM folders WHERE id = ?").get(folder) as Row | undefined)?.name : "All gists";
    const doc = [`# ${name ?? "Gists"}`, "", ...gists.map((g) => toMarkdown(g).replace(/^(#{1,5}) /gm, "#$1 "))].join("\n");
    const file = String(name ?? "gists").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gists";
    return c.body(doc, 200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${file}.md"` });
  });

  // ---------- savings dashboard ----------
  app.get("/api/savings", (c) => {
    const uid = c.get("userId");
    const settings = getSettings(db, uid);
    const rows = db.prepare("SELECT savings_json, source_json, created_at FROM gists WHERE user_id = ? AND status = 'ready' AND savings_json IS NOT NULL ORDER BY created_at").all(uid) as Row[];
    const items = rows.map((r) => ({ s: JSON.parse(r.savings_json as string) as Savings, kind: JSON.parse(r.source_json as string).kind as string, at: r.created_at as string }));
    const byWeek = new Map<string, Savings[]>();
    const byKind = new Map<string, Savings[]>();
    for (const it of items) {
      const d = new Date(it.at);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
      const wk = d.toISOString().slice(0, 10);
      byWeek.set(wk, [...(byWeek.get(wk) ?? []), it.s]);
      byKind.set(it.kind, [...(byKind.get(it.kind) ?? []), it.s]);
    }
    return c.json({
      totals: totalSavings(items.map((i) => i.s), settings.currency),
      byWeek: [...byWeek.entries()].slice(-12).map(([week, s]) => ({ week, ...totalSavings(s, settings.currency) })),
      byKind: [...byKind.entries()].map(([kind, s]) => ({ kind, ...totalSavings(s, settings.currency) })),
      assumptions: { readingWpm: 238, noteTakingFactor: 0.35, hourlyRate: settings.hourlyRate, currency: settings.currency, playbackSpeed: settings.playbackSpeed },
    });
  });

  return app;
}

/** Turns free text into a safe FTS5 prefix query. */
export function ftsQuery(q: string): string {
  const terms = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.length ? terms.map((t) => `"${t}"*`).join(" ") : '""';
}

/** Small in-process queue. Swap for a durable queue (e.g. a jobs table + worker) when scaling out. */
class JobQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  take(key: string): boolean {
    const t = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.max) return false;
    arr.push(t);
    this.hits.set(key, arr);
    return true;
  }
}
