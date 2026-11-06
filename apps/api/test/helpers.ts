import type { DB } from "../src/db.ts";
import { newId, now } from "../src/db.ts";
import { createSession } from "../src/auth.ts";
import type { Mailer } from "../src/identity.ts";

/** Creates a signed-up member directly and returns a session token, for tests about other features. */
export function member(db: DB, email: string, name: string | null = null): string {
  const id = newId();
  db.prepare("INSERT INTO users (id, email, email_verified_at, name, settings_json, created_at) VALUES (?, ?, ?, ?, '{}', ?)").run(id, email.toLowerCase(), now(), name, now());
  return createSession(db, id, "test");
}

/** Keeps sent emails in memory so tests can read the sign-in code. */
export class CapturingMailer implements Mailer {
  sent: { to: string; subject: string; text: string }[] = [];
  async send(to: string, subject: string, text: string) {
    this.sent.push({ to, subject, text });
  }
  lastCode(): string {
    const m = this.sent.at(-1)?.text.match(/\b(\d{6})\b/);
    if (!m) throw new Error("No code was sent.");
    return m[1];
  }
}
