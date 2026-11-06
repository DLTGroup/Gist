import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ExtractionTemplate, Folder, Gist, UserSettings } from "@gist/core";
import { DEFAULT_ASSUMPTIONS, summaryText } from "@gist/core";

export type DB = DatabaseSync;

export const DEFAULT_SETTINGS: UserSettings = {
  hourlyRate: DEFAULT_ASSUMPTIONS.hourlyRate,
  currency: DEFAULT_ASSUMPTIONS.currency,
  playbackSpeed: 1,
  defaultTemplateId: "takeaways-actions",
  autoExport: null,
  obsidianVault: null,
  obsidianFolder: "Gist",
  notionToken: null,
  notionParentPageId: null,
  webhookUrl: null,
};

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE COLLATE NOCASE,
      email_verified_at TEXT,
      name TEXT,
      webauthn_user_handle TEXT UNIQUE,
      google_sub TEXT UNIQUE,
      is_guest INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      recovery_until TEXT,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      colour TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      error TEXT,
      source_json TEXT NOT NULL,
      template_id TEXT NOT NULL,
      focus TEXT,
      summary_json TEXT,
      savings_json TEXT,
      folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
      favourite INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS gists_user_created ON gists(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS gist_tags (
      gist_id TEXT NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (gist_id, tag)
    );
    CREATE TABLE IF NOT EXISTS export_log (
      id TEXT PRIMARY KEY,
      gist_id TEXT NOT NULL REFERENCES gists(id) ON DELETE CASCADE,
      target TEXT NOT NULL,
      ok INTEGER NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      source_url TEXT,
      title TEXT NOT NULL,
      folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
      template_id TEXT NOT NULL,
      skipped_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS gists_fts USING fts5(gist_id UNINDEXED, user_id UNINDEXED, title, body, tags, tokenize = 'porter unicode61');
  `);
  // Lightweight migrations for databases created by earlier versions.
  const cols = (db.prepare("PRAGMA table_info(gists)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("import_id")) db.exec("ALTER TABLE gists ADD COLUMN import_id TEXT REFERENCES imports(id) ON DELETE SET NULL");
  db.exec("CREATE INDEX IF NOT EXISTS gists_import ON gists(import_id)");
  // Public share links: one per gist, with the image card the web app drew for previews.
  db.exec(`CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    gist_id TEXT NOT NULL UNIQUE REFERENCES gists(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card BLOB,
    created_at TEXT NOT NULL
  )`);
  // Passwordless accounts (2026-11): drop stored password hashes, allow guests and passkeys.
  const userCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (userCols.includes("password_hash")) {
    db.exec(`PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE users_v2 (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE COLLATE NOCASE,
        email_verified_at TEXT,
        name TEXT,
        webauthn_user_handle TEXT UNIQUE,
        google_sub TEXT UNIQUE,
        is_guest INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        recovery_until TEXT,
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      INSERT INTO users_v2 (id, email, name, settings_json, created_at) SELECT id, email, name, settings_json, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_v2 RENAME TO users;
      COMMIT;
      PRAGMA foreign_keys = ON;`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS credentials (
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friendly_name TEXT,
    public_key TEXT NOT NULL,
    aaguid TEXT,
    sign_count INTEGER NOT NULL DEFAULT 0,
    backup_eligible INTEGER NOT NULL DEFAULT 0,
    backup_state INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS credentials_user ON credentials(user_id);
  CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    challenge TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS email_codes (
    attempt_id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_states (
    state TEXT PRIMARY KEY,
    verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    guest_id TEXT,
    next TEXT,
    created_at TEXT NOT NULL
  )`);
  const sessCols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
  if (!sessCols.includes("method")) db.exec("ALTER TABLE sessions ADD COLUMN method TEXT");

  // Connected YouTube / Spotify accounts. Tokens are AES-GCM sealed with GIST_TOKEN_KEY.
  db.exec(`CREATE TABLE IF NOT EXISTS connections (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    account_id TEXT,
    account_name TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, provider)
  );
  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    verifier TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  return db;
}

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

type Row = Record<string, unknown>;

export function rowToGist(db: DB, r: Row): Gist {
  const tags = (db.prepare("SELECT tag FROM gist_tags WHERE gist_id = ? ORDER BY tag").all(r.id as string) as Row[]).map((t) => t.tag as string);
  return {
    id: r.id as string,
    userId: r.user_id as string,
    status: r.status as Gist["status"],
    error: (r.error as string) ?? null,
    source: JSON.parse(r.source_json as string),
    templateId: r.template_id as string,
    focus: (r.focus as string) ?? null,
    summary: r.summary_json ? JSON.parse(r.summary_json as string) : null,
    savings: r.savings_json ? JSON.parse(r.savings_json as string) : null,
    folderId: (r.folder_id as string) ?? null,
    tags,
    favourite: !!r.favourite,
    model: (r.model as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function getGist(db: DB, userId: string, id: string): Gist | null {
  const r = db.prepare("SELECT * FROM gists WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  return r ? rowToGist(db, r) : null;
}

export function setTags(db: DB, gistId: string, tags: string[]) {
  const clean = [...new Set(tags.map(normalizeTag).filter(Boolean))].slice(0, 20);
  db.prepare("DELETE FROM gist_tags WHERE gist_id = ?").run(gistId);
  const ins = db.prepare("INSERT OR IGNORE INTO gist_tags (gist_id, tag) VALUES (?, ?)");
  for (const t of clean) ins.run(gistId, t);
}

export function normalizeTag(t: string): string {
  return t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40);
}

/** Keeps the full-text index in step with a gist's title, summary and tags. */
export function reindex(db: DB, g: Gist) {
  db.prepare("DELETE FROM gists_fts WHERE gist_id = ?").run(g.id);
  const title = g.summary?.title ?? g.source.title;
  const body = [g.source.title, g.source.author ?? "", g.summary ? summaryText(g.summary) : ""].join("\n");
  db.prepare("INSERT INTO gists_fts (gist_id, user_id, title, body, tags) VALUES (?, ?, ?, ?, ?)").run(g.id, g.userId, title, body, g.tags.join(" "));
}

export function getSettings(db: DB, userId: string): UserSettings {
  const r = db.prepare("SELECT settings_json FROM users WHERE id = ?").get(userId) as Row | undefined;
  return { ...DEFAULT_SETTINGS, ...(r ? JSON.parse(r.settings_json as string) : {}) };
}

export function listTemplates(db: DB, userId: string): ExtractionTemplate[] {
  return (db.prepare("SELECT json FROM templates WHERE user_id = ? ORDER BY created_at").all(userId) as Row[]).map((r) => JSON.parse(r.json as string));
}

export function listFolders(db: DB, userId: string): Folder[] {
  return (
    db
      .prepare(
        `SELECT f.id, f.name, f.colour, (SELECT COUNT(*) FROM gists g WHERE g.folder_id = f.id) AS gist_count
         FROM folders f WHERE f.user_id = ? ORDER BY f.name COLLATE NOCASE`,
      )
      .all(userId) as Row[]
  ).map((r) => ({ id: r.id as string, name: r.name as string, colour: (r.colour as string) ?? null, gistCount: Number(r.gist_count) }));
}
