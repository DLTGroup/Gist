import { createHash, randomBytes } from "node:crypto";
import type { DB } from "./db.ts";
import { now } from "./db.ts";

const SESSION_DAYS = 60;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Creates an opaque session token. Only its hash is stored. The web app receives it as an
 * HttpOnly cookie; native apps keep it in the device keychain and send it as a bearer token.
 */
export function createSession(db: DB, userId: string, method = "unknown", ttlMs = SESSION_DAYS * 86400_000): string {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + ttlMs).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, method) VALUES (?, ?, ?, ?, ?)").run(sha256(token), userId, now(), expires, method);
  return token;
}

export function sessionForToken(db: DB, token: string): { userId: string; method: string } | null {
  const r = db.prepare("SELECT user_id, expires_at, method FROM sessions WHERE token_hash = ?").get(sha256(token)) as
    | { user_id: string; expires_at: string; method: string | null }
    | undefined;
  if (!r || r.expires_at < now()) return null;
  return { userId: r.user_id, method: r.method ?? "unknown" };
}

/** Turns a short, restricted session into a full one (after account recovery adds a passkey). */
export function upgradeSession(db: DB, token: string, method: string) {
  db.prepare("UPDATE sessions SET method = ?, expires_at = ? WHERE token_hash = ?").run(method, new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString(), sha256(token));
}

export function userIdForToken(db: DB, token: string): string | null {
  return sessionForToken(db, token)?.userId ?? null;
}

export function deleteSession(db: DB, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}
