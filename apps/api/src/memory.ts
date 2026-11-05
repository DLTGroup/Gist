/**
 * Memory (spaced repetition): decks, cards made from starred takeaways, FSRS reviews, quizzes,
 * shared decks and reminders. Card content belongs to a deck; each member keeps their own schedule.
 */
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "node:crypto";
import type { CardKind, CardSource, Deck, DeckRole, MemoryCard, MemorySettings, MemoryState, ReviewRating } from "@gist/core";
import {
  DEFAULT_MEMORY_SETTINGS,
  RETENTION_RANGE,
  buildQuiz,
  highlightSource,
  newMemoryState,
  previewIntervals,
  reviewCalendar,
  reviewCard,
  timestampLink,
} from "@gist/core";
import type { DB } from "./db.ts";
import { getGist, newId, now } from "./db.ts";
import type { CardWriter } from "./summarize.ts";

type Env = { Variables: { userId: string } };
type Row = Record<string, unknown>;

/** Most cards a person can make in one request (a whole gist is usually 10–30 takeaways). */
const MAX_CARDS_PER_REQUEST = 40;
const MAX_DECKS = 200;

export function migrateMemory(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      share_token TEXT UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deck_members (
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (deck_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS deck_members_user ON deck_members(user_id);
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      source_json TEXT,
      gist_id TEXT REFERENCES gists(id) ON DELETE SET NULL,
      section_id TEXT,
      item_index INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cards_deck ON cards(deck_id);
    CREATE INDEX IF NOT EXISTS cards_gist ON cards(gist_id);
    CREATE TABLE IF NOT EXISTS card_states (
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state_json TEXT NOT NULL,
      due TEXT NOT NULL,
      state TEXT NOT NULL,
      suspended INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (card_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS card_states_due ON card_states(user_id, due);
    CREATE TABLE IF NOT EXISTS review_log (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      mode TEXT NOT NULL,
      state_before TEXT NOT NULL,
      stability REAL,
      difficulty REAL,
      elapsed_days REAL,
      scheduled_days REAL,
      duration_ms INTEGER,
      reviewed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS review_log_user ON review_log(user_id, reviewed_at);
    CREATE TABLE IF NOT EXISTS memory_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      json TEXT NOT NULL,
      calendar_token TEXT UNIQUE
    );
  `);
}

export interface MemoryDeps {
  db: DB;
  cardWriter: CardWriter;
  publicBase: (c: Context) => string;
  fail: (status: 400 | 401 | 403 | 404 | 409 | 422 | 429, message: string) => never;
}

/** Public pages (no sign-in): the shared-deck preview and the reminder calendar feed. */
export function registerPublicMemoryRoutes(app: Hono<Env>, { db, publicBase }: Pick<MemoryDeps, "db" | "publicBase">) {
  app.get("/d/:token", (c) => {
    const d = db.prepare("SELECT d.*, u.name AS owner_name FROM decks d JOIN users u ON u.id = d.owner_id WHERE d.share_token = ?").get(c.req.param("token")) as Row | undefined;
    if (!d) return c.html(page("Not found", "<p>This deck doesn't exist or is no longer shared.</p>"), 404);
    const cards = db.prepare("SELECT front, back FROM cards WHERE deck_id = ? ORDER BY created_at LIMIT 200").all(d.id as string) as Row[];
    const total = (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE deck_id = ?").get(d.id as string) as Row).n as number;
    const base = publicBase(c);
    const join = `${base}/app/join/${c.req.param("token")}`;
    const body = `
      <p class="eyebrow">Shared memory deck${d.owner_name ? ` from ${esc(d.owner_name as string)}` : ""}</p>
      <h1>${esc(d.name as string)}</h1>
      ${d.description ? `<p>${esc(d.description as string)}</p>` : ""}
      <p><a class="btn" href="${esc(join)}">Study this deck in Gist</a></p>
      <p class="muted">${total} card${total === 1 ? "" : "s"}. Gist schedules each review just before you'd forget it, so what you learn stays learned.</p>
      <ol class="cards">${cards.map((r) => `<li><strong>${esc(r.front as string)}</strong><span>${esc(r.back as string)}</span></li>`).join("")}</ol>
      ${total > cards.length ? `<p class="muted">…and ${total - cards.length} more.</p>` : ""}`;
    c.header("cache-control", "public, max-age=120");
    return c.html(page(`${d.name as string} · Gist deck`, body));
  });

  app.get("/cal/:token", (c) => {
    const token = c.req.param("token").replace(/\.ics$/, "");
    const r = db.prepare("SELECT user_id, json FROM memory_settings WHERE calendar_token = ?").get(token) as Row | undefined;
    if (!r) return c.text("Not found", 404);
    const s = { ...DEFAULT_MEMORY_SETTINGS, ...JSON.parse(r.json as string) } as MemorySettings;
    const due = dueCount(db, r.user_id as string, new Date(Date.now() + 24 * 3600_000));
    const ics = reviewCalendar({ appUrl: `${publicBase(c)}/app/review`, hour: s.reminderHour ?? 9, timeZone: s.timeZone, dueCount: due, uid: token.slice(0, 12) });
    return c.body(ics, 200, { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=1800" });
  });
}

/** Signed-in routes. Register after the auth middleware. */
export function registerMemoryRoutes(app: Hono<Env>, { db, cardWriter, publicBase, fail }: MemoryDeps) {
  const body = async <T>(c: Context): Promise<T> => (await c.req.json().catch(() => ({}))) as T;

  const settingsFor = (uid: string): MemorySettings => {
    const r = db.prepare("SELECT json FROM memory_settings WHERE user_id = ?").get(uid) as Row | undefined;
    return { ...DEFAULT_MEMORY_SETTINGS, ...(r ? JSON.parse(r.json as string) : {}) };
  };

  const roleIn = (uid: string, deckId: string): DeckRole | null =>
    ((db.prepare("SELECT role FROM deck_members WHERE deck_id = ? AND user_id = ?").get(deckId, uid) as Row | undefined)?.role as DeckRole) ?? null;
  const mustRole = (uid: string, deckId: string, need: "read" | "edit" | "own"): DeckRole => {
    const role = roleIn(uid, deckId) ?? fail(404, "Deck not found.");
    if (need === "edit" && role === "viewer") fail(403, "Only the deck's owner and editors can change its cards.");
    if (need === "own" && role !== "owner") fail(403, "Only the deck's owner can do that.");
    return role;
  };

  const createDeck = (uid: string, name: string, description: string | null = null): string => {
    const count = (db.prepare("SELECT COUNT(*) AS n FROM decks WHERE owner_id = ?").get(uid) as Row).n as number;
    if (count >= MAX_DECKS) fail(400, `You can have up to ${MAX_DECKS} decks.`);
    const id = newId();
    const t = now();
    db.prepare("INSERT INTO decks (id, owner_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)").run(id, uid, name, description, t);
    db.prepare("INSERT INTO deck_members (deck_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(id, uid, t);
    return id;
  };

  /** The deck new stars go to when none is chosen: the user's first own deck, made on first use. */
  const defaultDeck = (uid: string): string => {
    const r = db.prepare("SELECT d.id FROM decks d WHERE d.owner_id = ? ORDER BY d.created_at LIMIT 1").get(uid) as Row | undefined;
    return (r?.id as string) ?? createDeck(uid, "My memory", "Everything you star lands here unless you pick another deck.");
  };

  /** Makes sure the user has a schedule row for every card in decks they belong to. */
  const ensureStates = (uid: string, deckId?: string) => {
    const t = now();
    const missing = db
      .prepare(
        `SELECT c.id FROM cards c JOIN deck_members m ON m.deck_id = c.deck_id AND m.user_id = ?
         WHERE ${deckId ? "c.deck_id = ? AND " : ""}NOT EXISTS (SELECT 1 FROM card_states s WHERE s.card_id = c.id AND s.user_id = ?)`,
      )
      .all(...(deckId ? [uid, deckId, uid] : [uid, uid])) as Row[];
    const ins = db.prepare("INSERT OR IGNORE INTO card_states (card_id, user_id, state_json, due, state) VALUES (?, ?, ?, ?, 'new')");
    for (const r of missing) {
      const m = newMemoryState(new Date(t));
      ins.run(r.id as string, uid, JSON.stringify(m), m.due);
    }
  };

  const rowToCard = (r: Row): MemoryCard => ({
    id: r.id as string,
    deckId: r.deck_id as string,
    kind: r.kind as CardKind,
    front: r.front as string,
    back: r.back as string,
    source: r.source_json ? (JSON.parse(r.source_json as string) as CardSource) : null,
    createdBy: (r.created_by as string) ?? "",
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    memory: JSON.parse(r.state_json as string) as MemoryState,
    suspended: !!r.suspended,
  });

  const cardFor = (uid: string, cardId: string): MemoryCard | null => {
    const r = db
      .prepare(
        `SELECT c.*, s.state_json, s.suspended FROM cards c
         JOIN deck_members m ON m.deck_id = c.deck_id AND m.user_id = ?
         JOIN card_states s ON s.card_id = c.id AND s.user_id = ?
         WHERE c.id = ?`,
      )
      .get(uid, uid, cardId) as Row | undefined;
    return r ? rowToCard(r) : null;
  };
  const mustCard = (uid: string, cardId: string) => {
    ensureStates(uid);
    return cardFor(uid, cardId) ?? fail(404, "Card not found.");
  };

  const deckJson = (uid: string, r: Row): Deck => {
    const at = now();
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS cards,
                SUM(CASE WHEN s.suspended = 0 AND s.state <> 'new' AND s.due <= ? THEN 1 ELSE 0 END) AS due,
                SUM(CASE WHEN s.suspended = 0 AND s.state = 'new' THEN 1 ELSE 0 END) AS fresh
         FROM cards c JOIN card_states s ON s.card_id = c.id AND s.user_id = ? WHERE c.deck_id = ?`,
      )
      .get(at, uid, r.id as string) as Row;
    const members = (db.prepare("SELECT COUNT(*) AS n FROM deck_members WHERE deck_id = ?").get(r.id as string) as Row).n as number;
    return {
      id: r.id as string,
      name: r.name as string,
      description: (r.description as string) ?? null,
      role: r.role as DeckRole,
      ownerName: (r.owner_name as string) ?? (r.owner_email as string) ?? null,
      cardCount: Number(counts.cards ?? 0),
      dueCount: Number(counts.due ?? 0),
      newCount: Number(counts.fresh ?? 0),
      memberCount: members,
      createdAt: r.created_at as string,
    };
  };
  const listDecks = (uid: string): Deck[] => {
    ensureStates(uid);
    const rows = db
      .prepare(
        `SELECT d.*, m.role, u.name AS owner_name, u.email AS owner_email FROM decks d
         JOIN deck_members m ON m.deck_id = d.id AND m.user_id = ?
         JOIN users u ON u.id = d.owner_id ORDER BY d.created_at`,
      )
      .all(uid) as Row[];
    return rows.map((r) => deckJson(uid, r));
  };

  // ---------- settings ----------
  app.get("/api/memory/settings", (c) => c.json({ settings: settingsFor(c.get("userId")), calendarUrl: calendarUrl(c, c.get("userId")) }));
  app.patch("/api/memory/settings", async (c) => {
    const uid = c.get("userId");
    const p = await body<Partial<MemorySettings>>(c);
    const next = { ...settingsFor(uid) };
    if (p.desiredRetention !== undefined) {
      if (typeof p.desiredRetention !== "number" || p.desiredRetention < RETENTION_RANGE.min || p.desiredRetention > RETENTION_RANGE.max)
        fail(400, `Target recall must be between ${RETENTION_RANGE.min * 100}% and ${RETENTION_RANGE.max * 100}%.`);
      next.desiredRetention = Math.round(p.desiredRetention * 100) / 100;
    }
    if (p.newCardsPerDay !== undefined) {
      if (!Number.isInteger(p.newCardsPerDay) || p.newCardsPerDay < 0 || p.newCardsPerDay > 500) fail(400, "New cards per day must be a whole number from 0 to 500.");
      next.newCardsPerDay = p.newCardsPerDay;
    }
    if (p.reminderHour !== undefined) {
      if (p.reminderHour !== null && (!Number.isInteger(p.reminderHour) || p.reminderHour < 0 || p.reminderHour > 23)) fail(400, "Pick an hour from 0 to 23.");
      next.reminderHour = p.reminderHour;
    }
    if (p.timeZone !== undefined) {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: p.timeZone });
      } catch {
        fail(400, "Unknown time zone.");
      }
      next.timeZone = p.timeZone;
    }
    db.prepare("INSERT INTO memory_settings (user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json").run(uid, JSON.stringify(next));
    return c.json({ settings: next, calendarUrl: calendarUrl(c, uid) });
  });
  /** Turns on (or replaces) the private calendar feed used for reminders. */
  app.post("/api/memory/calendar", (c) => {
    const uid = c.get("userId");
    const token = randomBytes(18).toString("base64url");
    db.prepare("INSERT INTO memory_settings (user_id, json, calendar_token) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET calendar_token = excluded.calendar_token").run(
      uid, JSON.stringify(settingsFor(uid)), token,
    );
    return c.json({ calendarUrl: calendarUrl(c, uid) });
  });
  app.delete("/api/memory/calendar", (c) => {
    db.prepare("UPDATE memory_settings SET calendar_token = NULL WHERE user_id = ?").run(c.get("userId"));
    return c.json({ calendarUrl: null });
  });
  const calendarUrl = (c: Context, uid: string): string | null => {
    const r = db.prepare("SELECT calendar_token FROM memory_settings WHERE user_id = ?").get(uid) as Row | undefined;
    return r?.calendar_token ? `${publicBase(c)}/cal/${r.calendar_token as string}.ics` : null;
  };

  // ---------- overview ----------
  app.get("/api/memory/summary", (c) => {
    const uid = c.get("userId");
    ensureStates(uid);
    const s = settingsFor(uid);
    const at = new Date();
    const due = dueCount(db, uid, at);
    const newToday = newIntroducedToday(uid, s);
    const newAvailable = (db.prepare("SELECT COUNT(*) AS n FROM card_states WHERE user_id = ? AND state = 'new' AND suspended = 0").get(uid) as Row).n as number;
    const total = (db.prepare("SELECT COUNT(*) AS n FROM card_states WHERE user_id = ?").get(uid) as Row).n as number;
    // Forecast: reviews coming due on each of the next 7 days (day 0 = due now or later today).
    const forecast: { date: string; count: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const end = new Date(at);
      end.setHours(24 * (d + 1), 0, 0, 0);
      const start = new Date(at);
      start.setHours(24 * d, 0, 0, 0);
      const n = (db.prepare("SELECT COUNT(*) AS n FROM card_states WHERE user_id = ? AND suspended = 0 AND state <> 'new' AND due < ? AND due >= ?").get(uid, end.toISOString(), d === 0 ? "0" : start.toISOString()) as Row).n as number;
      forecast.push({ date: start.toISOString().slice(0, 10), count: n });
    }
    const since = new Date(at.getTime() - 30 * 86400_000).toISOString();
    const recent = db.prepare("SELECT rating, state_before FROM review_log WHERE user_id = ? AND mode = 'review' AND reviewed_at >= ?").all(uid, since) as Row[];
    const matured = recent.filter((r) => r.state_before === "review");
    const retention = matured.length ? matured.filter((r) => (r.rating as number) > 1).length / matured.length : null;
    const days = (db.prepare("SELECT DISTINCT substr(reviewed_at, 1, 10) AS d FROM review_log WHERE user_id = ? ORDER BY d DESC LIMIT 400").all(uid) as Row[]).map((r) => r.d as string);
    return c.json({
      dueNow: due,
      newToday: Math.max(0, Math.min(newAvailable, s.newCardsPerDay - newToday)),
      totalCards: total,
      reviewedToday: (db.prepare("SELECT COUNT(*) AS n FROM review_log WHERE user_id = ? AND reviewed_at >= ?").get(uid, startOfDay(at).toISOString()) as Row).n,
      streakDays: streak(days, at),
      retention30d: retention,
      reviews30d: recent.length,
      forecast,
      settings: s,
    });
  });

  const newIntroducedToday = (uid: string, _s: MemorySettings) =>
    (db.prepare("SELECT COUNT(DISTINCT card_id) AS n FROM review_log WHERE user_id = ? AND state_before = 'new' AND mode = 'review' AND reviewed_at >= ?").get(uid, startOfDay(new Date()).toISOString()) as Row).n as number;

  // ---------- decks ----------
  app.get("/api/decks", (c) => c.json({ decks: listDecks(c.get("userId")) }));
  app.post("/api/decks", async (c) => {
    const uid = c.get("userId");
    const b = await body<{ name?: string; description?: string }>(c);
    const name = b.name?.trim();
    if (!name) fail(400, "Give the deck a name.");
    const id = createDeck(uid, name!.slice(0, 120), b.description?.trim().slice(0, 500) || null);
    return c.json({ deck: listDecks(uid).find((d) => d.id === id) }, 201);
  });
  app.get("/api/decks/:id", (c) => {
    const uid = c.get("userId");
    const id = c.req.param("id");
    mustRole(uid, id, "read");
    ensureStates(uid, id);
    const deck = listDecks(uid).find((d) => d.id === id)!;
    const cards = (
      db
        .prepare(`SELECT c.*, s.state_json, s.suspended FROM cards c JOIN card_states s ON s.card_id = c.id AND s.user_id = ? WHERE c.deck_id = ? ORDER BY c.created_at DESC`)
        .all(uid, id) as Row[]
    ).map(rowToCard);
    const members = (
      db.prepare("SELECT u.id, u.name, u.email, m.role, m.joined_at, (SELECT COUNT(*) FROM cards c WHERE c.deck_id = m.deck_id AND c.created_by = u.id) AS cards FROM deck_members m JOIN users u ON u.id = m.user_id WHERE m.deck_id = ? ORDER BY m.joined_at").all(id) as Row[]
    ).map((m) => ({ id: m.id, name: (m.name as string) || (m.email as string).split("@")[0], role: m.role, joinedAt: m.joined_at, cardsAdded: Number(m.cards), you: m.id === uid }));
    const share = db.prepare("SELECT share_token FROM decks WHERE id = ?").get(id) as Row;
    return c.json({ deck, cards, members, shareUrl: share.share_token && deck.role !== "viewer" ? `${publicBase(c)}/d/${share.share_token as string}` : null });
  });
  app.patch("/api/decks/:id", async (c) => {
    const uid = c.get("userId");
    const id = c.req.param("id");
    mustRole(uid, id, "edit");
    const b = await body<{ name?: string; description?: string | null }>(c);
    if (b.name !== undefined) {
      if (!b.name.trim()) fail(400, "Give the deck a name.");
      db.prepare("UPDATE decks SET name = ? WHERE id = ?").run(b.name.trim().slice(0, 120), id);
    }
    if (b.description !== undefined) db.prepare("UPDATE decks SET description = ? WHERE id = ?").run(b.description?.trim().slice(0, 500) || null, id);
    return c.json({ deck: listDecks(uid).find((d) => d.id === id) });
  });
  app.delete("/api/decks/:id", (c) => {
    const uid = c.get("userId");
    const id = c.req.param("id");
    const role = mustRole(uid, id, "read");
    // The owner deletes the deck for everyone; anyone else just leaves it.
    if (role === "owner") db.prepare("DELETE FROM decks WHERE id = ?").run(id);
    else {
      db.prepare("DELETE FROM deck_members WHERE deck_id = ? AND user_id = ?").run(id, uid);
      db.prepare("DELETE FROM card_states WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?)").run(uid, id);
    }
    return c.json({ ok: true, left: role !== "owner" });
  });

  // Sharing: one link per deck. Anyone signed in who opens it joins as a viewer (their own schedule,
  // read-only cards); the owner can make members editors so they can add and fix cards too.
  app.post("/api/decks/:id/share", (c) => {
    const uid = c.get("userId");
    const id = c.req.param("id");
    mustRole(uid, id, "edit");
    const r = db.prepare("SELECT share_token FROM decks WHERE id = ?").get(id) as Row;
    const token = (r.share_token as string) ?? randomBytes(16).toString("base64url");
    if (!r.share_token) db.prepare("UPDATE decks SET share_token = ? WHERE id = ?").run(token, id);
    return c.json({ shareUrl: `${publicBase(c)}/d/${token}` });
  });
  app.delete("/api/decks/:id/share", (c) => {
    mustRole(c.get("userId"), c.req.param("id"), "own");
    db.prepare("UPDATE decks SET share_token = NULL WHERE id = ?").run(c.req.param("id"));
    return c.json({ shareUrl: null });
  });
  app.get("/api/decks/join/:token", (c) => {
    const d = db.prepare("SELECT d.id, d.name, d.description, u.name AS owner_name, (SELECT COUNT(*) FROM cards WHERE deck_id = d.id) AS n FROM decks d JOIN users u ON u.id = d.owner_id WHERE d.share_token = ?").get(c.req.param("token")) as Row | undefined;
    if (!d) fail(404, "This deck link doesn't work any more. Ask for a new one.");
    return c.json({ deck: { id: d!.id, name: d!.name, description: d!.description, ownerName: d!.owner_name, cardCount: Number(d!.n) }, member: !!roleIn(c.get("userId"), d!.id as string) });
  });
  app.post("/api/decks/join/:token", (c) => {
    const uid = c.get("userId");
    const d = db.prepare("SELECT id FROM decks WHERE share_token = ?").get(c.req.param("token")) as Row | undefined;
    if (!d) fail(404, "This deck link doesn't work any more. Ask for a new one.");
    db.prepare("INSERT OR IGNORE INTO deck_members (deck_id, user_id, role, joined_at) VALUES (?, ?, 'viewer', ?)").run(d!.id as string, uid, now());
    return c.json({ deck: listDecks(uid).find((x) => x.id === d!.id) });
  });
  app.patch("/api/decks/:id/members/:userId", async (c) => {
    const id = c.req.param("id");
    mustRole(c.get("userId"), id, "own");
    const { role } = await body<{ role?: DeckRole }>(c);
    if (role !== "editor" && role !== "viewer") fail(400, "Role must be editor or viewer.");
    const target = roleIn(c.req.param("userId"), id) ?? fail(404, "That person isn't in this deck.");
    if (target === "owner") fail(400, "The owner's role can't change.");
    db.prepare("UPDATE deck_members SET role = ? WHERE deck_id = ? AND user_id = ?").run(role!, id, c.req.param("userId"));
    return c.json({ ok: true });
  });
  app.delete("/api/decks/:id/members/:userId", (c) => {
    const id = c.req.param("id");
    mustRole(c.get("userId"), id, "own");
    if (roleIn(c.req.param("userId"), id) === "owner") fail(400, "The owner can't be removed. Delete the deck instead.");
    db.prepare("DELETE FROM deck_members WHERE deck_id = ? AND user_id = ?").run(id, c.req.param("userId"));
    db.prepare("DELETE FROM card_states WHERE user_id = ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?)").run(c.req.param("userId"), id);
    return c.json({ ok: true });
  });

  // ---------- cards ----------
  const insertCard = (uid: string, deckId: string, card: { kind: CardKind; front: string; back: string }, source: CardSource | null): string => {
    const id = newId();
    const t = now();
    db.prepare("INSERT INTO cards (id, deck_id, created_by, kind, front, back, source_json, gist_id, section_id, item_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, deckId, uid, card.kind, card.front, card.back, source ? JSON.stringify(source) : null, source?.gistId ?? null, source?.sectionId ?? null, source?.itemIndex ?? null, t, t,
    );
    const m = newMemoryState(new Date(t));
    db.prepare("INSERT INTO card_states (card_id, user_id, state_json, due, state) VALUES (?, ?, ?, ?, 'new')").run(id, uid, JSON.stringify(m), m.due);
    return id;
  };

  /** Star takeaways: each becomes one or two cards, written by Claude (or the offline cloze writer). */
  app.post("/api/gists/:id/cards", async (c) => {
    const uid = c.get("userId");
    const g = getGist(db, uid, c.req.param("id")) ?? fail(404, "Gist not found.");
    if (g.status !== "ready" || !g.summary) fail(409, "This gist isn't ready yet.");
    const b = await body<{ items?: { sectionId: string; itemIndex: number }[]; all?: boolean; deckId?: string }>(c);
    const deckId = b.deckId ?? defaultDeck(uid);
    mustRole(uid, deckId, "edit");
    let wanted = b.items ?? [];
    if (b.all) {
      wanted = g.summary!.sections.flatMap((s) => (s.items.length ? s.items.map((_, i) => ({ sectionId: s.id, itemIndex: i })) : s.paragraph ? [{ sectionId: s.id, itemIndex: -1 }] : []));
    }
    const link = (sec: number) => timestampLink(g.source.kind, g.source.url, sec, g.source.audioUrl);
    // Skip takeaways already in this deck (by text), so starring twice doesn't duplicate cards.
    const existing = new Set((db.prepare("SELECT source_json FROM cards WHERE deck_id = ? AND gist_id = ?").all(deckId, g.id) as Row[]).map((r) => (r.source_json ? JSON.parse(r.source_json as string).text : "")));
    const sources = wanted
      .map((h) => highlightSource(g, h, link))
      .filter((s): s is CardSource => !!s && !existing.has(s.text))
      .filter((s, i, a) => a.findIndex((x) => x.text === s.text) === i);
    if (!wanted.length) fail(400, "Pick at least one takeaway to remember.");
    if (sources.length > MAX_CARDS_PER_REQUEST) fail(400, `Star up to ${MAX_CARDS_PER_REQUEST} takeaways at a time.`);
    const written = sources.length ? await cardWriter.writeCards(g.summary!.title || g.source.title, g.source.author, sources) : [];
    const ids: string[] = [];
    db.exec("BEGIN");
    try {
      for (const w of written) ids.push(insertCard(uid, deckId, w, sources[w.index]));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return c.json({ cards: ids.map((id) => cardFor(uid, id)!), skipped: wanted.length - sources.length, deckId }, 201);
  });

  /** Which takeaways in a gist are already starred (made into cards the user can see). */
  app.get("/api/gists/:id/cards", (c) => {
    const uid = c.get("userId");
    const g = getGist(db, uid, c.req.param("id")) ?? fail(404, "Gist not found.");
    ensureStates(uid);
    const rows = db
      .prepare(`SELECT c.*, s.state_json, s.suspended FROM cards c JOIN card_states s ON s.card_id = c.id AND s.user_id = ? WHERE c.gist_id = ? ORDER BY c.created_at`)
      .all(uid, g.id) as Row[];
    return c.json({ cards: rows.map(rowToCard) });
  });

  /** A card written by hand. */
  app.post("/api/decks/:id/cards", async (c) => {
    const uid = c.get("userId");
    const deckId = c.req.param("id");
    mustRole(uid, deckId, "edit");
    const b = await body<{ front?: string; back?: string }>(c);
    if (!b.front?.trim() || !b.back?.trim()) fail(400, "A card needs a question and an answer.");
    const id = insertCard(uid, deckId, { kind: "qa", front: b.front!.trim().slice(0, 600), back: b.back!.trim().slice(0, 600) }, null);
    return c.json({ card: cardFor(uid, id) }, 201);
  });

  app.patch("/api/cards/:id", async (c) => {
    const uid = c.get("userId");
    const card = mustCard(uid, c.req.param("id"));
    const b = await body<{ front?: string; back?: string; suspended?: boolean; deckId?: string; reset?: boolean }>(c);
    if (b.front !== undefined || b.back !== undefined || b.deckId !== undefined) {
      mustRole(uid, card.deckId, "edit");
      const front = b.front !== undefined ? b.front.trim() : card.front;
      const back = b.back !== undefined ? b.back.trim() : card.back;
      if (!front || !back) fail(400, "A card needs a question and an answer.");
      if (b.deckId && b.deckId !== card.deckId) mustRole(uid, b.deckId, "edit");
      db.prepare("UPDATE cards SET front = ?, back = ?, deck_id = ?, updated_at = ? WHERE id = ?").run(front.slice(0, 600), back.slice(0, 600), b.deckId ?? card.deckId, now(), card.id);
    }
    // Suspending and resetting are personal: they change only this person's schedule.
    if (b.suspended !== undefined) db.prepare("UPDATE card_states SET suspended = ? WHERE card_id = ? AND user_id = ?").run(b.suspended ? 1 : 0, card.id, uid);
    if (b.reset) {
      const m = newMemoryState();
      db.prepare("UPDATE card_states SET state_json = ?, due = ?, state = 'new' WHERE card_id = ? AND user_id = ?").run(JSON.stringify(m), m.due, card.id, uid);
    }
    ensureStates(uid);
    return c.json({ card: cardFor(uid, card.id) });
  });
  app.delete("/api/cards/:id", (c) => {
    const uid = c.get("userId");
    const card = mustCard(uid, c.req.param("id"));
    mustRole(uid, card.deckId, "edit");
    db.prepare("DELETE FROM cards WHERE id = ?").run(card.id);
    return c.json({ ok: true });
  });

  // ---------- review ----------
  /** Cards to review now: everything due, then new cards up to today's allowance. */
  app.get("/api/review/queue", (c) => {
    const uid = c.get("userId");
    ensureStates(uid);
    const s = settingsFor(uid);
    const deckId = c.req.query("deck");
    const gistId = c.req.query("gist");
    if (deckId) mustRole(uid, deckId, "read");
    const limit = Math.min(200, Number(c.req.query("limit") ?? 100) || 100);
    const at = new Date();
    const filter = `${deckId ? " AND c.deck_id = ?" : ""}${gistId ? " AND c.gist_id = ?" : ""}`;
    const args = [...(deckId ? [deckId] : []), ...(gistId ? [gistId] : [])];
    const base = `SELECT c.*, s.state_json, s.suspended FROM cards c JOIN card_states s ON s.card_id = c.id AND s.user_id = ? JOIN deck_members m ON m.deck_id = c.deck_id AND m.user_id = ? WHERE s.suspended = 0`;
    const due = db.prepare(`${base} AND s.state <> 'new' AND s.due <= ?${filter} ORDER BY s.due LIMIT ?`).all(uid, uid, at.toISOString(), ...args, limit) as Row[];
    const allowance = Math.max(0, s.newCardsPerDay - newIntroducedToday(uid, s));
    const fresh = allowance > 0 ? (db.prepare(`${base} AND s.state = 'new'${filter} ORDER BY c.created_at LIMIT ?`).all(uid, uid, ...args, Math.min(allowance, limit)) as Row[]) : [];
    const cards = [...due, ...fresh].map(rowToCard).map((card) => ({ ...card, intervals: previewIntervals(card.memory, at, s.desiredRetention) }));
    return c.json({ cards, dueCount: due.length, newCount: fresh.length });
  });

  const record = (uid: string, card: MemoryCard, rating: ReviewRating, mode: "review" | "quiz", durationMs: number | null) => {
    const s = settingsFor(uid);
    const at = new Date();
    const next = reviewCard(card.memory, rating, at, s.desiredRetention);
    db.prepare("UPDATE card_states SET state_json = ?, due = ?, state = ? WHERE card_id = ? AND user_id = ?").run(JSON.stringify(next), next.due, next.state, card.id, uid);
    db.prepare("INSERT INTO review_log (id, card_id, user_id, rating, mode, state_before, stability, difficulty, elapsed_days, scheduled_days, duration_ms, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      newId(), card.id, uid, rating, mode, card.memory.state, next.stability, next.difficulty, next.elapsedDays, next.scheduledDays, durationMs, at.toISOString(),
    );
    return next;
  };

  app.post("/api/review/:cardId", async (c) => {
    const uid = c.get("userId");
    const card = mustCard(uid, c.req.param("cardId"));
    const b = await body<{ rating?: number; durationMs?: number }>(c);
    if (![1, 2, 3, 4].includes(b.rating as number)) fail(400, "Rating must be 1 (Again), 2 (Hard), 3 (Good) or 4 (Easy).");
    const ms = typeof b.durationMs === "number" && b.durationMs >= 0 ? Math.min(Math.round(b.durationMs), 3600_000) : null;
    const memory = record(uid, card, b.rating as ReviewRating, "review", ms);
    return c.json({ card: { ...card, memory } });
  });

  // ---------- quizzes ----------
  /** Multiple-choice quiz over a deck, a gist's cards, or everything. Practice by default. */
  app.get("/api/quiz", (c) => {
    const uid = c.get("userId");
    ensureStates(uid);
    const deckId = c.req.query("deck");
    const gistId = c.req.query("gist");
    if (deckId) mustRole(uid, deckId, "read");
    const count = Math.min(30, Math.max(1, Number(c.req.query("count") ?? 10) || 10));
    const rows = db
      .prepare(
        `SELECT c.* FROM cards c JOIN deck_members m ON m.deck_id = c.deck_id AND m.user_id = ? JOIN card_states s ON s.card_id = c.id AND s.user_id = ?
         WHERE s.suspended = 0${deckId ? " AND c.deck_id = ?" : ""}${gistId ? " AND c.gist_id = ?" : ""}`,
      )
      .all(uid, uid, ...(deckId ? [deckId] : []), ...(gistId ? [gistId] : [])) as Row[];
    if (rows.length < 2) fail(400, "A quiz needs at least two cards. Star a few more takeaways first.");
    const cards = rows.map((r) => ({ id: r.id as string, front: r.front as string, back: r.back as string, source: r.source_json ? JSON.parse(r.source_json as string) : null }));
    // Distractors come from the same pool; for a small pool, widen it to all the user's cards.
    let pool: { id: string; back: string }[] = cards;
    if (cards.length < 4) pool = (db.prepare("SELECT c.id, c.back FROM cards c JOIN deck_members m ON m.deck_id = c.deck_id AND m.user_id = ? LIMIT 500").all(uid) as Row[]).map((r) => ({ id: r.id as string, back: r.back as string }));
    return c.json({ questions: buildQuiz(cards, pool, count) });
  });

  /**
   * Records a quiz answer. A quiz is practice and doesn't move the schedule, except when the card
   * is already due: then the answer counts as its review (right = Good, wrong = Again).
   */
  app.post("/api/quiz/:cardId", async (c) => {
    const uid = c.get("userId");
    const card = mustCard(uid, c.req.param("cardId"));
    const { correct } = await body<{ correct?: boolean }>(c);
    if (typeof correct !== "boolean") fail(400, "Say whether the answer was right.");
    const isDue = card.memory.state !== "new" && new Date(card.memory.due) <= new Date();
    if (isDue) return c.json({ counted: true, card: { ...card, memory: record(uid, card, correct ? 3 : 1, "review", null) } });
    db.prepare("INSERT INTO review_log (id, card_id, user_id, rating, mode, state_before, duration_ms, reviewed_at) VALUES (?, ?, ?, ?, 'quiz', ?, NULL, ?)").run(newId(), card.id, uid, correct ? 3 : 1, card.memory.state, now());
    return c.json({ counted: false, card });
  });
}

export function dueCount(db: DB, uid: string, at: Date): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM card_states s JOIN cards c ON c.id = s.card_id JOIN deck_members m ON m.deck_id = c.deck_id AND m.user_id = s.user_id WHERE s.user_id = ? AND s.suspended = 0 AND s.state <> 'new' AND s.due <= ?")
      .get(uid, at.toISOString()) as Row
  ).n as number;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Consecutive days with at least one review, ending today or yesterday. */
export function streak(daysDesc: string[], at = new Date()): number {
  const set = new Set(daysDesc);
  const day = (offset: number) => new Date(at.getTime() - offset * 86400_000).toISOString().slice(0, 10);
  let start = set.has(day(0)) ? 0 : set.has(day(1)) ? 1 : -1;
  if (start < 0) return 0;
  let n = 0;
  while (set.has(day(start + n))) n++;
  return n;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}"><meta name="description" content="A shared memory deck on Gist.">
<style>
:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--card:#fff;--line:#e7e5e4;--accent:#fbbf24}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--card:#1c1917;--line:#292524}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:2rem 1rem 4rem}.eyebrow{color:var(--muted);font-size:.85rem;margin:0}h1{margin:.2rem 0 .6rem;font-size:1.8rem}
.muted{color:var(--muted)}.btn{display:inline-block;background:var(--fg);color:var(--bg);padding:.6rem 1.1rem;border-radius:999px;text-decoration:none;font-weight:600}
.cards{padding-left:1.2rem}.cards li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.7rem .9rem;margin:.5rem 0}
.cards li span{display:block;color:var(--muted);margin-top:.25rem}
</style></head><body><main>${body}</main></body></html>`;
}
