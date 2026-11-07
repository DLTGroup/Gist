import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { DB } from "./db.ts";
import { newId, now } from "./db.ts";
import { createSession, deleteSession, sessionForToken, upgradeSession } from "./auth.ts";
import { grantConsent } from "./marketing.ts";

/**
 * Passwordless accounts, following the project's passkey specification:
 * - Passkeys (WebAuthn, discoverable credentials, user verification required) are the primary sign-in.
 * - Google sign-in uses OpenID Connect with PKCE and a nonce; the ID token is verified against Google's keys.
 * - Email sign-up and recovery use a 6-digit, single-use, 5-minute code bound to the requesting browser.
 *   An emailed-code sign-in to an account that already has passkeys is recovery: on the website it only
 *   opens a 5-minute session that can do nothing but register a new passkey. It also sends a security
 *   alert and pauses removing passkeys for 24 hours.
 * - Guests can make a few gists and share them before signing up; signing in moves their gists over.
 * No passwords or password hashes are stored.
 */

export const SESSION_COOKIE = "gist_session";
const ATTEMPT_COOKIE = "gist_attempt";
const CODE_TTL_MS = 5 * 60_000;
/** A recovery session can only add a passkey, and only for a few minutes. */
export const RECOVERY_METHOD = "recovery";
const RECOVERY_SESSION_MS = 5 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const REGISTER_CHALLENGE_TTL_MS = 60_000;
// Conditional UI requests its challenge on page load and waits for the user, so login challenges live longer.
const LOGIN_CHALLENGE_TTL_MS = 5 * 60_000;
const RECOVERY_COOLDOWN_MS = 24 * 3600_000;

type Row = Record<string, unknown>;

// ---------- email ----------

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Sends through Resend's HTTP API (RESEND_API_KEY, GIST_EMAIL_FROM). */
export class ResendMailer implements Mailer {
  constructor(private apiKey: string, private from: string, private fetchFn: typeof fetch = fetch) {}
  async send(to: string, subject: string, text: string) {
    const r = await this.fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [to], subject, text }),
    });
    if (!r.ok) throw new Error(`Email provider returned ${r.status}`);
  }
}

/** Development only: prints the email to the server log. */
export class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, text: string) {
    console.log(`[email] to=${to} subject="${subject}"\n${text}`);
  }
}

export function createMailer(env = process.env): Mailer | null {
  if (env.RESEND_API_KEY && env.GIST_EMAIL_FROM) return new ResendMailer(env.RESEND_API_KEY, env.GIST_EMAIL_FROM);
  return env.NODE_ENV === "production" ? null : new ConsoleMailer();
}

// ---------- configuration ----------

export interface IdentityConfig {
  db: DB;
  mailer: Mailer | null;
  /** Public base URL of the site, e.g. https://gist.example.ca */
  publicBase: (c: Context) => string;
  /** Extra origins allowed to complete passkey ceremonies (e.g. a dev server). */
  extraOrigins?: string[];
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  /** Override Google ID-token verification in tests. */
  verifyGoogleIdToken?: (idToken: string, clientId: string) => Promise<JWTPayload>;
  guestGistLimit?: number;
}

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
async function verifyGoogle(idToken: string, clientId: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, googleJwks, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: clientId });
  return payload;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");
const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const validEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;

class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  take(key: string) {
    const t = Date.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.max) return false;
    list.push(t);
    this.hits.set(key, list);
    return true;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountIdentity(app: Hono<any>, cfg: IdentityConfig) {
  const { db } = cfg;
  const env = cfg.env ?? process.env;
  const fetchFn = cfg.fetchFn ?? fetch;
  const verifyIdToken = cfg.verifyGoogleIdToken ?? verifyGoogle;
  const codeSecret = env.GIST_TOKEN_KEY || randomBytes(32).toString("hex");
  const emailLimiter = new Limiter(5, 3600_000);
  const guestLimiter = new Limiter(10, 3600_000);

  const fail = (status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string, code?: string): never => {
    throw new HTTPException(status, { res: new Response(JSON.stringify({ error: message, ...(code ? { code } : {}) }), { status, headers: { "content-type": "application/json" } }) });
  };
  const body = async <T>(c: Context): Promise<T> => (await c.req.json().catch(() => ({}))) as T;
  const ip = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "local";
  const secure = (c: Context) => cfg.publicBase(c).startsWith("https://");
  const rp = (c: Context) => {
    const base = new URL(cfg.publicBase(c));
    return { id: env.GIST_RP_ID || base.hostname, origins: [base.origin, ...(cfg.extraOrigins ?? [])] };
  };
  const currentToken = (c: Context) => c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || getCookie(c, SESSION_COOKIE) || null;
  const currentUser = (c: Context) => {
    const t = currentToken(c);
    const s = t ? sessionForToken(db, t) : null;
    return s ? (db.prepare("SELECT * FROM users WHERE id = ?").get(s.userId) as Row | undefined) ?? null : null;
  };
  const requireMember = (c: Context, allowRecovery = false) => {
    const u = currentUser(c);
    if (!u) fail(401, "Please sign in.");
    if (u!.is_guest) fail(403, "Create an account to do that.", "login_required");
    const t = currentToken(c);
    if (!allowRecovery && t && sessionForToken(db, t)?.method === RECOVERY_METHOD) fail(403, "Add a passkey to finish getting back into your account.", "passkey_required");
    return u!;
  };

  /** Moves a guest's gists, folders and share links to the account they just signed in to. */
  function adoptGuest(guestId: string | null | undefined, userId: string) {
    if (!guestId || guestId === userId) return;
    const g = db.prepare("SELECT is_guest FROM users WHERE id = ?").get(guestId) as Row | undefined;
    if (!g?.is_guest) return;
    for (const t of ["gists", "folders", "templates", "imports", "shares", "gists_fts"]) db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).run(userId, guestId);
    db.prepare("DELETE FROM users WHERE id = ?").run(guestId);
  }

  function startSession(c: Context, userId: string, method: string, ttlMs = 60 * 86400_000) {
    const token = createSession(db, userId, method, ttlMs);
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/", maxAge: Math.round(ttlMs / 1000) });
    return token;
  }

  function hasPasskeys(userId: string) {
    return !!db.prepare("SELECT 1 FROM credentials WHERE user_id = ? LIMIT 1").get(userId);
  }

  function userHandle(userId: string): string {
    const r = db.prepare("SELECT webauthn_user_handle FROM users WHERE id = ?").get(userId) as Row;
    if (r.webauthn_user_handle) return r.webauthn_user_handle as string;
    const h = b64url(randomBytes(32));
    db.prepare("UPDATE users SET webauthn_user_handle = ? WHERE id = ?").run(h, userId);
    return h;
  }

  function saveChallenge(kind: "register" | "login", challenge: string, userId: string | null) {
    db.prepare("DELETE FROM auth_challenges WHERE created_at < ?").run(new Date(Date.now() - LOGIN_CHALLENGE_TTL_MS).toISOString());
    const id = newId();
    db.prepare("INSERT INTO auth_challenges (id, kind, challenge, user_id, created_at) VALUES (?, ?, ?, ?, ?)").run(id, kind, challenge, userId, now());
    return id;
  }
  function takeChallenge(where: string, ...args: (string | null)[]) {
    const r = db.prepare(`SELECT * FROM auth_challenges WHERE ${where}`).get(...args) as Row | undefined;
    if (r) db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(r.id as string);
    return r;
  }

  // ---------- guests ----------

  app.post("/api/auth/guest", (c) => {
    const existing = currentUser(c);
    if (existing) return c.json({ token: null, userId: existing.id });
    if (!guestLimiter.take(ip(c))) fail(429, "Too many new sessions from this network. Please wait a little.");
    const id = newId();
    db.prepare("INSERT INTO users (id, is_guest, settings_json, created_at) VALUES (?, 1, '{}', ?)").run(id, now());
    return c.json({ token: startSession(c, id, "guest"), userId: id }, 201);
  });

  // ---------- email code ----------

  app.post("/api/auth/email/start", async (c) => {
    const { email } = await body<{ email?: string }>(c);
    const addr = (email ?? "").trim().toLowerCase();
    if (!validEmail(addr)) fail(400, "Enter a valid email address.");
    if (!cfg.mailer) fail(503, "Email sign-in isn't set up on this server yet.");
    if (!emailLimiter.take(`ip:${ip(c)}`) || !emailLimiter.take(`em:${addr}`)) fail(429, "Too many codes requested. Please wait a few minutes.");
    db.prepare("DELETE FROM email_codes WHERE expires_at < ?").run(now());
    const attemptId = b64url(randomBytes(24));
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    db.prepare("INSERT INTO email_codes (attempt_id, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(
      attemptId, addr, hmac(code, attemptId), now(), new Date(Date.now() + CODE_TTL_MS).toISOString(),
    );
    // The same reply whether or not an account exists, so the form can't be used to discover accounts.
    await cfg.mailer!.send(addr, `${code} is your Gist code`, `Your Gist sign-in code is ${code}.\n\nIt works once, in the browser where you asked for it, for the next 5 minutes.\n\nIf you didn't ask for this, you can ignore this email.`).catch((e) => {
      console.error("[email] send failed", (e as Error).message);
    });
    setCookie(c, ATTEMPT_COOKIE, attemptId, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/api/auth", maxAge: CODE_TTL_MS / 1000 });
    return c.json({ ok: true, attemptId });
  });

  function hmac(code: string, attemptId: string) {
    return createHmac("sha256", codeSecret).update(`${attemptId}:${code}`).digest("base64url");
  }

  app.post("/api/auth/email/verify", async (c) => {
    const b = await body<{ code?: string; attemptId?: string; name?: string; marketing?: boolean }>(c);
    // Web clients are bound by the HttpOnly cookie set when the code was requested; native apps send the id they were given.
    const cookieBound = !!getCookie(c, ATTEMPT_COOKIE);
    const attemptId = getCookie(c, ATTEMPT_COOKIE) || b.attemptId || "";
    const r = db.prepare("SELECT * FROM email_codes WHERE attempt_id = ?").get(attemptId) as Row | undefined;
    if (!r || (r.expires_at as string) < now()) fail(400, "That code has expired. Ask for a new one.");
    if ((r!.attempts as number) >= CODE_MAX_ATTEMPTS) fail(429, "Too many wrong codes. Ask for a new one.");
    const given = hmac(String(b.code ?? "").replace(/\D/g, ""), attemptId);
    const ok = given.length === (r!.code_hash as string).length && timingSafeEqual(Buffer.from(given), Buffer.from(r!.code_hash as string));
    if (!ok) {
      db.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE attempt_id = ?").run(attemptId);
      fail(400, "That code isn't right. Check the email and try again.");
    }
    db.prepare("DELETE FROM email_codes WHERE attempt_id = ?").run(attemptId);
    deleteCookie(c, ATTEMPT_COOKIE, { path: "/api/auth" });
    const email = r!.email as string;
    const guest = currentUser(c);
    let user = db.prepare("SELECT * FROM users WHERE email = ? AND is_guest = 0").get(email) as Row | undefined;
    let isNew = false;
    if (!user) {
      const id = newId();
      db.prepare("INSERT INTO users (id, email, email_verified_at, name, settings_json, created_at) VALUES (?, ?, ?, ?, '{}', ?)").run(id, email, now(), b.name?.trim() || null, now());
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row;
      isNew = true;
    } else if (!user.email_verified_at) {
      db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(now(), user.id as string);
    }
    if (user.status !== "active") fail(403, "This account is locked. Contact support.");
    const uid = user.id as string;
    const recovery = hasPasskeys(uid);
    if (recovery) {
      db.prepare("UPDATE users SET recovery_until = ? WHERE id = ?").run(new Date(Date.now() + RECOVERY_COOLDOWN_MS).toISOString(), uid);
      await cfg.mailer?.send(email, "New sign-in to your Gist account", `Someone used an emailed code to get into your Gist account at ${new Date().toUTCString()}.\n\nIf this was you, you can ignore this message. For the next 24 hours, removing passkeys is paused as a precaution.\n\nIf it wasn't you, sign in with your passkey and remove any passkeys you don't recognize once the pause ends.`).catch(() => {});
    }
    adoptGuest(guest?.is_guest ? (guest.id as string) : null, uid);
    if (b.marketing === true) await grantConsent(db, { userId: uid, source: isNew ? "signup-email" : "signin", c, base: cfg.publicBase(c), mailer: cfg.mailer, env });
    // On the website, recovery only opens a short session for adding a new passkey. The mobile app can't
    // create passkeys yet, so it gets a normal session under the same alert and 24-hour pause.
    const scoped = recovery && cookieBound;
    const token = scoped ? startSession(c, uid, RECOVERY_METHOD, RECOVERY_SESSION_MS) : startSession(c, uid, recovery ? "email-recovery" : "email");
    return c.json({ token, isNew, recovery, scoped, needsPasskey: scoped || !hasPasskeys(uid) }, isNew ? 201 : 200);
  });

  // ---------- passkeys ----------

  app.post("/api/auth/passkey/register/options", async (c) => {
    const u = requireMember(c, true);
    const uid = u.id as string;
    const existing = db.prepare("SELECT credential_id, transports FROM credentials WHERE user_id = ?").all(uid) as Row[];
    const options = await generateRegistrationOptions({
      rpName: "Gist",
      rpID: rp(c).id,
      userName: (u.email as string) ?? uid,
      userID: Buffer.from(userHandle(uid), "base64url"),
      userDisplayName: (u.name as string) || (u.email as string) || "",
      attestationType: "none",
      excludeCredentials: existing.map((r) => ({ id: r.credential_id as string, transports: JSON.parse(r.transports as string) })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: [-8, -7, -257],
      extensions: { credProps: true } as Record<string, unknown>,
      timeout: REGISTER_CHALLENGE_TTL_MS,
    });
    saveChallenge("register", options.challenge, uid);
    return c.json({ options });
  });

  app.post("/api/auth/passkey/register/verify", async (c) => {
    const u = requireMember(c, true);
    const uid = u.id as string;
    const { response, name } = await body<{ response?: RegistrationResponseJSON; name?: string }>(c);
    if (!response) fail(400, "Missing passkey response.");
    const since = new Date(Date.now() - REGISTER_CHALLENGE_TTL_MS).toISOString();
    let used: Row | undefined;
    let v;
    try {
      v = await verifyRegistrationResponse({
        response: response!,
        expectedChallenge: (ch) => {
          used = db.prepare("SELECT * FROM auth_challenges WHERE kind = 'register' AND user_id = ? AND challenge = ? AND created_at >= ?").get(uid, ch, since) as Row | undefined;
          return !!used;
        },
        expectedOrigin: rp(c).origins,
        expectedRPID: rp(c).id,
        requireUserVerification: true,
      });
    } catch (e) {
      fail(400, `The passkey couldn't be verified (${(e as Error).message}).`);
    }
    if (used) db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(used.id as string);
    if (!v!.verified) fail(400, "The passkey couldn't be verified.");
    const info = v!.registrationInfo!;
    db.prepare(
      `INSERT INTO credentials (credential_id, user_id, friendly_name, public_key, aaguid, sign_count, backup_eligible, backup_state, transports, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      info.credential.id, uid, name?.trim().slice(0, 60) || friendlyName(info.aaguid, info.credentialDeviceType === "multiDevice"),
      b64url(info.credential.publicKey), info.aaguid, info.credential.counter, info.credentialDeviceType === "multiDevice" ? 1 : 0,
      info.credentialBackedUp ? 1 : 0, JSON.stringify(info.credential.transports ?? response!.response.transports ?? []), now(),
    );
    // Finishing recovery: the restricted session becomes a normal one.
    const t = currentToken(c);
    if (t && sessionForToken(db, t)?.method === RECOVERY_METHOD) {
      upgradeSession(db, t, "recovery-passkey");
      setCookie(c, SESSION_COOKIE, t, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/", maxAge: 60 * 86400 });
    }
    return c.json(passkeyList(c, uid), 201);
  });

  app.post("/api/auth/passkey/login/options", async (c) => {
    const options = await generateAuthenticationOptions({ rpID: rp(c).id, userVerification: "required", timeout: LOGIN_CHALLENGE_TTL_MS });
    return c.json({ options, challengeId: saveChallenge("login", options.challenge, null) });
  });

  app.post("/api/auth/passkey/login/verify", async (c) => {
    const { challengeId, response } = await body<{ challengeId?: string; response?: AuthenticationResponseJSON }>(c);
    if (!response?.id) fail(400, "Missing passkey response.");
    const cred = db.prepare("SELECT * FROM credentials WHERE credential_id = ?").get(response!.id) as Row | undefined;
    // The client removes passkeys we no longer know about from the user's keychain (Signal API).
    if (!cred) fail(404, "That passkey isn't linked to an account any more.", "unknown_credential");
    const ch = takeChallenge("id = ? AND kind = 'login' AND created_at >= ?", challengeId ?? "", new Date(Date.now() - LOGIN_CHALLENGE_TTL_MS).toISOString());
    if (!ch) fail(400, "The sign-in request expired. Please try again.");
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response: response!,
        expectedChallenge: ch!.challenge as string,
        expectedOrigin: rp(c).origins,
        expectedRPID: rp(c).id,
        requireUserVerification: true,
        credential: { id: cred!.credential_id as string, publicKey: Buffer.from(cred!.public_key as string, "base64url"), counter: cred!.sign_count as number, transports: JSON.parse(cred!.transports as string) },
      });
    } catch (e) {
      fail(401, `The passkey couldn't be verified (${(e as Error).message}).`);
    }
    if (!v!.verified) fail(401, "The passkey couldn't be verified.");
    const uid = cred!.user_id as string;
    const user = db.prepare("SELECT status FROM users WHERE id = ?").get(uid) as Row;
    if (user.status !== "active") fail(403, "This account is locked. Contact support.");
    db.prepare("UPDATE credentials SET sign_count = ?, backup_state = ?, last_used_at = ? WHERE credential_id = ?").run(
      v!.authenticationInfo.newCounter, v!.authenticationInfo.credentialBackedUp ? 1 : 0, now(), cred!.credential_id as string,
    );
    const guest = currentUser(c);
    adoptGuest(guest?.is_guest ? (guest.id as string) : null, uid);
    return c.json({ token: startSession(c, uid, "passkey") });
  });

  function passkeyList(c: Context, uid: string) {
    const rows = db.prepare("SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at").all(uid) as Row[];
    return {
      rpId: rp(c).id,
      userHandle: userHandle(uid),
      passkeys: rows.map((r) => ({
        id: r.credential_id as string,
        name: r.friendly_name as string,
        synced: !!r.backup_eligible,
        backedUp: !!r.backup_state,
        createdAt: r.created_at as string,
        lastUsedAt: (r.last_used_at as string) ?? null,
      })),
    };
  }

  app.get("/api/auth/passkeys", (c) => c.json(passkeyList(c, requireMember(c).id as string)));
  app.patch("/api/auth/passkeys/:id", async (c) => {
    const uid = requireMember(c).id as string;
    const { name } = await body<{ name?: string }>(c);
    if (!name?.trim()) fail(400, "Give the passkey a name.");
    db.prepare("UPDATE credentials SET friendly_name = ? WHERE credential_id = ? AND user_id = ?").run(name!.trim().slice(0, 60), c.req.param("id"), uid);
    return c.json(passkeyList(c, uid));
  });
  app.delete("/api/auth/passkeys/:id", (c) => {
    const u = requireMember(c);
    if (u.recovery_until && (u.recovery_until as string) > now()) {
      fail(403, "For your security, passkeys can't be removed for 24 hours after signing in with an emailed code.", "recovery_cooldown");
    }
    db.prepare("DELETE FROM credentials WHERE credential_id = ? AND user_id = ?").run(c.req.param("id"), u.id as string);
    return c.json(passkeyList(c, u.id as string));
  });

  // ---------- Google (OpenID Connect) ----------

  app.get("/api/auth/google/start", (c) => {
    const clientId = env.GOOGLE_CLIENT_ID;
    const base = cfg.publicBase(c);
    if (!clientId || !env.GOOGLE_CLIENT_SECRET) return c.redirect(`${base}/signin?error=${encodeURIComponent("Google sign-in isn't set up yet.")}`);
    db.prepare("DELETE FROM login_states WHERE created_at < ?").run(new Date(Date.now() - 15 * 60_000).toISOString());
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(16));
    const guest = currentUser(c);
    const next = c.req.query("next");
    db.prepare("INSERT INTO login_states (state, verifier, nonce, guest_id, next, marketing, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      state, verifier, nonce, guest?.is_guest ? (guest.id as string) : null, next && next.startsWith("/app") ? next : null, c.req.query("marketing") === "1" ? 1 : 0, now(),
    );
    const q = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: `${base}/api/auth/google/callback`,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: sha256(verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  });

  app.get("/api/auth/google/callback", async (c) => {
    const base = cfg.publicBase(c);
    const back = (msg: string) => c.redirect(`${base}/signin?error=${encodeURIComponent(msg)}`);
    const { code, state, error } = c.req.query();
    if (error) return back(error === "access_denied" ? "You cancelled the Google sign-in." : "Google sign-in didn't complete.");
    const st = db.prepare("SELECT * FROM login_states WHERE state = ?").get(state ?? "") as Row | undefined;
    db.prepare("DELETE FROM login_states WHERE state = ?").run(state ?? "");
    if (!st || !code || (st.created_at as string) < new Date(Date.now() - 15 * 60_000).toISOString()) return back("That sign-in link expired. Please try again.");
    const clientId = env.GOOGLE_CLIENT_ID!;
    let claims: JWTPayload;
    try {
      const tr = await fetchFn("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${base}/api/auth/google/callback`, client_id: clientId, client_secret: env.GOOGLE_CLIENT_SECRET!, code_verifier: st.verifier as string }),
      });
      const tok = (await tr.json()) as { id_token?: string };
      if (!tr.ok || !tok.id_token) return back("Google sign-in didn't complete.");
      claims = await verifyIdToken(tok.id_token, clientId);
    } catch {
      return back("Google sign-in couldn't be verified.");
    }
    if (claims.nonce !== st.nonce) return back("Google sign-in couldn't be verified.");
    const sub = String(claims.sub ?? "");
    const email = String(claims.email ?? "").toLowerCase();
    if (!sub || !email || claims.email_verified !== true) return back("Your Google account's email isn't verified.");
    let user = db.prepare("SELECT * FROM users WHERE google_sub = ?").get(sub) as Row | undefined;
    if (!user) {
      user = db.prepare("SELECT * FROM users WHERE email = ? AND is_guest = 0").get(email) as Row | undefined;
      if (user) db.prepare("UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?").run(sub, now(), user.id as string);
    }
    let isNew = false;
    if (!user) {
      const id = newId();
      db.prepare("INSERT INTO users (id, email, email_verified_at, name, google_sub, settings_json, created_at) VALUES (?, ?, ?, ?, ?, '{}', ?)").run(id, email, now(), (claims.name as string) ?? null, sub, now());
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row;
      isNew = true;
    }
    if (user.status !== "active") return back("This account is locked. Contact support.");
    adoptGuest(st.guest_id as string | null, user.id as string);
    if (st.marketing) await grantConsent(db, { userId: user.id as string, source: isNew ? "signup-google" : "signin", c, base, mailer: cfg.mailer, env });
    startSession(c, user.id as string, "google");
    return c.redirect(`${base}${(st.next as string) || "/app/new"}`);
  });

  // ---------- sign out ----------

  app.post("/api/auth/logout", (c) => {
    const t = currentToken(c);
    if (t) deleteSession(db, t);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  return { currentToken, hasPasskeys };
}

/** A readable default name until the user renames it. */
function friendlyName(aaguid: string, synced: boolean): string {
  const known: Record<string, string> = {
    "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
    "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
    "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
    "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
    "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
    "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
    "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  };
  return known[aaguid] ?? (synced ? "Synced passkey" : "Security key");
}
