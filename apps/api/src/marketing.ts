import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import type { DB } from "./db.ts";
import { newId, now } from "./db.ts";
import type { Mailer } from "./identity.ts";

/**
 * Consent to marketing email, kept to Canada's anti-spam law (CASL) and the CRTC's guidance:
 * - The request is a separate, unticked box (CRTC 2012-549, paras 5-6; CRTC 2012-548, paras 16, 18).
 * - It names who is asking, gives a mailing address and an email or web address, and says consent
 *   can be withdrawn (Electronic Commerce Protection Regulations (CRTC), SOR/2012-36, s. 4).
 * - Every grant and withdrawal is logged with the date, time, wording and how it was given, because
 *   the sender has to prove consent (CRTC 2012-548, paras 26-27).
 * - A confirmation is sent once consent is given (CRTC 2012-549, para 8).
 *
 * The box only appears once the operator has set GIST_BUSINESS_NAME, GIST_MAILING_ADDRESS and
 * GIST_CONTACT_EMAIL, so a request that lacks the required details is never shown.
 */

export type ConsentSource = "signup-email" | "signup-google" | "signin" | "settings" | "unsubscribe-link";

export interface ConsentRequest {
  available: boolean;
  /** The words beside the box. */
  label: string;
  /** The small print under it: purpose, who is asking, how to reach them, how to withdraw. */
  details: string;
}

type Row = Record<string, unknown>;

export function marketingConfig(env: NodeJS.ProcessEnv = process.env) {
  const business = env.GIST_BUSINESS_NAME?.trim() ?? "";
  const address = env.GIST_MAILING_ADDRESS?.trim() ?? "";
  const contact = env.GIST_CONTACT_EMAIL?.trim() ?? "";
  const admins = (env.GIST_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { business, address, contact, admins, ready: !!(business && address && contact) };
}

export function consentRequest(env: NodeJS.ProcessEnv = process.env): ConsentRequest {
  const m = marketingConfig(env);
  const label = "Email me news, tips and offers about Gist (optional)";
  if (!m.ready) return { available: false, label, details: "" };
  return {
    available: true,
    label,
    details:
      `${m.business} will send you occasional emails about new features, tips and offers for Gist. ` +
      `You can withdraw your consent at any time with the unsubscribe link in any of these emails or in Settings. ` +
      `${m.business}, ${m.address}. Contact: ${m.contact}.`,
  };
}

const wording = (r: ConsentRequest) => `${r.label}\n${r.details}`;

function tokenFor(db: DB, userId: string): string {
  const r = db.prepare("SELECT marketing_token FROM users WHERE id = ?").get(userId) as Row | undefined;
  if (r?.marketing_token) return r.marketing_token as string;
  const t = randomBytes(24).toString("base64url");
  db.prepare("UPDATE users SET marketing_token = ? WHERE id = ?").run(t, userId);
  return t;
}

export const unsubscribeUrl = (base: string, token: string) => `${base}/u/${token}`;

const clientInfo = (c: Context | null) => ({
  ip: c ? c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || null : null,
  ua: c ? c.req.header("user-agent")?.slice(0, 300) ?? null : null,
});

function log(db: DB, userId: string, email: string, action: "granted" | "withdrawn", source: ConsentSource, text: string, c: Context | null) {
  const { ip, ua } = clientInfo(c);
  db.prepare("INSERT INTO consent_log (id, user_id, email, action, source, wording, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    newId(), userId, email, action, source, text, ip, ua, now(),
  );
}

/**
 * Records consent when the person ticked the box. Does nothing for guests, accounts without an email,
 * people already on the list, or when the request isn't set up (the box was never shown).
 */
export async function grantConsent(db: DB, opts: { userId: string; source: ConsentSource; c: Context | null; base: string; mailer: Mailer | null; env?: NodeJS.ProcessEnv }) {
  const req = consentRequest(opts.env);
  if (!req.available) return false;
  const u = db.prepare("SELECT email, is_guest, marketing_opt_in FROM users WHERE id = ?").get(opts.userId) as Row | undefined;
  if (!u || u.is_guest || !u.email) return false;
  if (u.marketing_opt_in) return true;
  db.prepare("UPDATE users SET marketing_opt_in = 1 WHERE id = ?").run(opts.userId);
  log(db, opts.userId, u.email as string, "granted", opts.source, wording(req), opts.c);
  const link = unsubscribeUrl(opts.base, tokenFor(db, opts.userId));
  const m = marketingConfig(opts.env);
  await opts.mailer
    ?.send(
      u.email as string,
      "You're on the Gist email list",
      `Thanks for signing up for news, tips and offers about Gist. We'll email you now and then, never more than we need to.\n\n` +
        `Changed your mind? Unsubscribe here: ${link}\nYou can also turn this off in Settings.\n\n${m.business}, ${m.address}. Contact: ${m.contact}.`,
    )
    .catch((e) => console.error("[email] consent confirmation failed", (e as Error).message));
  return true;
}

export function withdrawConsent(db: DB, opts: { userId: string; source: ConsentSource; c: Context | null }) {
  const u = db.prepare("SELECT email, marketing_opt_in FROM users WHERE id = ?").get(opts.userId) as Row | undefined;
  if (!u?.marketing_opt_in) return;
  db.prepare("UPDATE users SET marketing_opt_in = 0 WHERE id = ?").run(opts.userId);
  log(db, opts.userId, (u.email as string) ?? "", "withdrawn", opts.source, "", opts.c);
}

/** Spreadsheet programs run cells that start with these characters as formulas. */
const cell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Everyone who currently agrees to marketing email, with when and how they agreed. */
export function mailingListCsv(db: DB, base: string): { csv: string; count: number } {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.created_at,
        (SELECT created_at FROM consent_log l WHERE l.user_id = u.id AND l.action = 'granted' ORDER BY created_at DESC LIMIT 1) AS consented_at,
        (SELECT source FROM consent_log l WHERE l.user_id = u.id AND l.action = 'granted' ORDER BY created_at DESC LIMIT 1) AS source
       FROM users u WHERE u.marketing_opt_in = 1 AND u.is_guest = 0 AND u.email IS NOT NULL AND u.status = 'active' ORDER BY consented_at`,
    )
    .all() as Row[];
  const lines = [["email", "name", "consented_at", "consent_source", "signed_up_at", "unsubscribe_url"].join(",")];
  for (const r of rows) lines.push([r.email, r.name, r.consented_at, r.source, r.created_at, unsubscribeUrl(base, tokenFor(db, r.id as string))].map(cell).join(","));
  return { csv: lines.join("\r\n") + "\r\n", count: rows.length };
}

export function userForUnsubscribeToken(db: DB, token: string): { id: string; email: string; optedIn: boolean } | null {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const r = db.prepare("SELECT id, email, marketing_opt_in FROM users WHERE marketing_token = ?").get(token) as Row | undefined;
  return r ? { id: r.id as string, email: (r.email as string) ?? "", optedIn: !!r.marketing_opt_in } : null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** A small standalone page for the unsubscribe link in emails. */
export function unsubscribePage(state: "ask" | "done" | "invalid", email = ""): string {
  const body =
    state === "ask"
      ? `<h1>Unsubscribe from Gist emails?</h1><p>You'll stop getting news, tips and offers at <b>${esc(email)}</b>. Emails about your account, like sign-in codes, still arrive.</p><form method="post"><button type="submit">Unsubscribe</button></form>`
      : state === "done"
        ? `<h1>You're unsubscribed</h1><p>We won't send news, tips or offers to <b>${esc(email)}</b>. You can sign up again any time in Settings.</p>`
        : `<h1>This link isn't valid</h1><p>It may be incomplete. You can turn marketing emails off in Gist's Settings.</p>`;
  return `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Gist emails</title>
<style>:root{color-scheme:light dark}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f8f5;color:#102016;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:30rem;background:#fff;border:1px solid rgba(16,32,22,.12);border-radius:16px;padding:28px}h1{font-size:1.35rem;margin:0 0 .6rem}
button{font:inherit;font-weight:700;padding:.7rem 1.2rem;border-radius:10px;border:0;background:#166534;color:#fff;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#0e1511;color:#e7efe9}main{background:#141d17;border-color:rgba(231,239,233,.14)}button{background:#5fd38a;color:#0e1511}}</style></head>
<body><main>${body}</main></body></html>`;
}
