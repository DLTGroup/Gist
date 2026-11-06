import { describe, expect, it } from "vitest";
import type { IngestedSource } from "@gist/core";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { DemoSummarizer } from "../src/summarize.ts";
import { CapturingMailer, member } from "./helpers.ts";
import { SoftAuthenticator } from "./softAuthenticator.ts";

const text = "Compost needs greens and browns in balance. Turn the pile weekly so air reaches it. Keep it as damp as a wrung-out sponge. ".repeat(20);
const src = (url?: string | null): IngestedSource => ({ kind: "web", url: url ?? null, title: "Composting", author: null, publishedAt: null, thumbnailUrl: null, durationSeconds: null, text });

/** A browser: keeps cookies between requests and sends the web app's header. */
function setup(opts: { google?: Record<string, unknown> } = {}) {
  const db = openDb(":memory:");
  const mailer = new CapturingMailer();
  const nonces: string[] = [];
  const app = createApp({
    db,
    summarizer: new DemoSummarizer(),
    ingestFn: async (i) => src(i.url),
    mailer,
    identity: {
      env: { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", GIST_TOKEN_KEY: "k".repeat(64) },
      fetchFn: (async () => Response.json({ id_token: "fake" })) as unknown as typeof fetch,
      verifyGoogleIdToken: async () => ({ sub: "g-123", email: "jesse@example.ca", email_verified: true, name: "Jesse", nonce: nonces.at(-1), ...opts.google }),
    },
  });
  const browser = () => {
    const jar = new Map<string, string>();
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await app.request(path, { method, headers: { "content-type": "application/json", "x-gist-client": "web", ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      for (const sc of res.headers.getSetCookie()) {
        const [pair, ...attrs] = sc.split(";");
        const [k, v] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
        if (!v || attrs.some((a) => /max-age=0/i.test(a))) jar.delete(k);
        else jar.set(k, v);
      }
      const type = res.headers.get("content-type") ?? "";
      return { status: res.status, headers: res.headers, setCookie: res.headers.getSetCookie(), json: type.includes("json") ? await res.json() : null };
    };
    return { call, jar };
  };
  return { db, mailer, browser, nonces };
}

describe("guests", () => {
  it("can make a first gist and share it, and are asked to sign in for everything else", async () => {
    const { browser } = setup();
    const b = browser();
    expect((await b.call("GET", "/api/gists")).status).toBe(401);
    const guest = await b.call("POST", "/api/auth/guest");
    expect(guest.status).toBe(201);
    expect(guest.setCookie[0]).toMatch(/gist_session=.+HttpOnly/i);
    expect(guest.setCookie[0]).toMatch(/SameSite=Lax/i);

    const g = (await b.call("POST", "/api/gists?wait=1", { url: "https://example.ca/compost" })).json.gist;
    expect(g.status).toBe("ready");
    const me = (await b.call("GET", "/api/me")).json.user;
    expect(me).toMatchObject({ isGuest: true, email: null, guestGistsLeft: 0 });

    const share = await b.call("POST", `/api/gists/${g.id}/share`, {});
    expect(share.status).toBe(200);
    const token = share.json.share.url.split("/s/")[1];
    expect((await browser().call("GET", `/s/${token}`)).status).toBe(200);

    for (const [method, path, body] of [
      ["POST", "/api/gists", { url: "https://example.ca/second" }],
      ["POST", `/api/gists/${g.id}/send`, { target: "notion" }],
      ["GET", `/api/gists/${g.id}/export/markdown`],
      ["PATCH", "/api/settings", { hourlyRate: 50 }],
      ["PATCH", `/api/gists/${g.id}`, { favourite: true }],
      ["POST", "/api/imports", { url: "https://www.youtube.com/playlist?list=x" }],
      ["GET", "/api/connections"],
      ["POST", "/api/templates", { name: "x" }],
      ["POST", "/api/auth/passkey/register/options"],
    ] as [string, string, unknown?][]) {
      const r = await b.call(method, path, body);
      expect([path, r.status, r.json?.code]).toEqual([path, 403, "login_required"]);
    }
  });

  it("doesn't count a failed gist against the free try", async () => {
    const { browser } = setup();
    const b = browser();
    await b.call("POST", "/api/auth/guest");
    expect((await b.call("POST", "/api/gists?wait=1", { text: "   " })).status).toBe(400);
    expect((await b.call("GET", "/api/me")).json.user.guestGistsLeft).toBe(1);
  });

  it("blocks cookie requests that lack the app's header (cross-site forgery)", async () => {
    const { browser } = setup();
    const b = browser();
    await b.call("POST", "/api/auth/guest");
    expect((await b.call("POST", "/api/gists", { url: "https://example.ca/a" }, { "x-gist-client": "" })).status).toBe(403);
  });
});

describe("email code sign-in", () => {
  it("creates the account, moves the guest's gists over and can't be reused", async () => {
    const { browser, mailer } = setup();
    const b = browser();
    await b.call("POST", "/api/auth/guest");
    const g = (await b.call("POST", "/api/gists?wait=1", { url: "https://example.ca/compost" })).json.gist;

    expect((await b.call("POST", "/api/auth/email/start", { email: "not-an-email" })).status).toBe(400);
    const start = await b.call("POST", "/api/auth/email/start", { email: "Jesse@Example.ca" });
    expect(start.status).toBe(200);
    expect(mailer.sent[0].to).toBe("jesse@example.ca");
    expect((await b.call("POST", "/api/auth/email/verify", { code: "000000" === mailer.lastCode() ? "111111" : "000000" })).status).toBe(400);
    const ok = await b.call("POST", "/api/auth/email/verify", { code: mailer.lastCode(), name: "Jesse" });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ isNew: true, recovery: false, needsPasskey: true });
    expect((await b.call("POST", "/api/auth/email/verify", { code: mailer.lastCode() })).status).toBe(400);

    const me = (await b.call("GET", "/api/me")).json.user;
    expect(me).toMatchObject({ isGuest: false, email: "jesse@example.ca", name: "Jesse", hasPasskeys: false });
    expect((await b.call("GET", `/api/gists/${g.id}`)).status).toBe(200);
    expect((await b.call("PATCH", `/api/gists/${g.id}`, { favourite: true })).status).toBe(200);

    await b.call("POST", "/api/auth/logout");
    expect((await b.call("GET", "/api/me")).status).toBe(401);
  });

  it("answers the same whether or not an account exists", async () => {
    const { browser, db } = setup();
    member(db, "known@example.ca");
    const a = await browser().call("POST", "/api/auth/email/start", { email: "known@example.ca" });
    const b = await browser().call("POST", "/api/auth/email/start", { email: "unknown@example.ca" });
    expect([a.status, Object.keys(a.json).sort()]).toEqual([b.status, Object.keys(b.json).sort()]);
  });

  it("only works in the browser that asked, and stops after five wrong codes", async () => {
    const { browser, mailer } = setup();
    const b = browser();
    await b.call("POST", "/api/auth/email/start", { email: "a@example.ca" });
    expect((await browser().call("POST", "/api/auth/email/verify", { code: mailer.lastCode() })).status).toBe(400);
    const wrong = mailer.lastCode() === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) expect((await b.call("POST", "/api/auth/email/verify", { code: wrong })).status).toBe(400);
    expect((await b.call("POST", "/api/auth/email/verify", { code: mailer.lastCode() })).status).toBe(429);
  });
});

describe("passkeys", () => {
  it("registers a passkey with the spec's options and signs in with it", async () => {
    const { browser, mailer, db } = setup();
    const b = browser();
    await b.call("POST", "/api/auth/email/start", { email: "p@example.ca" });
    await b.call("POST", "/api/auth/email/verify", { code: mailer.lastCode() });

    const { options } = (await b.call("POST", "/api/auth/passkey/register/options")).json;
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(options.pubKeyCredParams.map((p: { alg: number }) => p.alg)).toEqual([-8, -7, -257]);
    expect(options.attestation).toBe("none");
    expect(options.extensions).toMatchObject({ credProps: true });

    const key = new SoftAuthenticator("localhost", "http://localhost");
    const reg = await b.call("POST", "/api/auth/passkey/register/verify", { response: key.register(options) });
    expect(reg.status).toBe(201);
    expect(reg.json.passkeys).toEqual([expect.objectContaining({ id: key.id, synced: true, backedUp: true })]);
    const row = db.prepare("SELECT * FROM credentials").get() as Record<string, unknown>;
    expect(row).toMatchObject({ credential_id: key.id, sign_count: 1, backup_eligible: 1 });

    // A fresh browser signs in with the passkey alone.
    const other = browser();
    const login = (await other.call("POST", "/api/auth/passkey/login/options")).json;
    expect(login.options.userVerification).toBe("required");
    expect(login.options.allowCredentials ?? []).toEqual([]);
    const done = await other.call("POST", "/api/auth/passkey/login/verify", { challengeId: login.challengeId, response: key.login(login.options) });
    expect(done.status).toBe(200);
    expect((await other.call("GET", "/api/me")).json.user).toMatchObject({ email: "p@example.ca", hasPasskeys: true });
    expect((db.prepare("SELECT sign_count FROM credentials").get() as { sign_count: number }).sign_count).toBe(2);

    // The challenge is single-use.
    expect((await other.call("POST", "/api/auth/passkey/login/verify", { challengeId: login.challengeId, response: key.login(login.options) })).status).toBe(400);
    // A passkey the server doesn't know gets a code the client uses to tell the keychain to remove it.
    const stray = new SoftAuthenticator("localhost", "http://localhost");
    const opt2 = (await other.call("POST", "/api/auth/passkey/login/options")).json;
    const unknown = await other.call("POST", "/api/auth/passkey/login/verify", { challengeId: opt2.challengeId, response: stray.login(opt2.options) });
    expect([unknown.status, unknown.json.code]).toEqual([404, "unknown_credential"]);
  });

  it("treats an emailed code on a passkey account as recovery: add-a-passkey only, alert email, 24-hour pause on removing passkeys", async () => {
    const { browser, mailer } = setup();
    const b = browser();
    await b.call("POST", "/api/auth/email/start", { email: "r@example.ca" });
    await b.call("POST", "/api/auth/email/verify", { code: mailer.lastCode() });
    const key = new SoftAuthenticator("localhost", "http://localhost");
    const { options } = (await b.call("POST", "/api/auth/passkey/register/options")).json;
    await b.call("POST", "/api/auth/passkey/register/verify", { response: key.register(options) });

    // Lost the device: a code in a new browser opens a short session that can only add a passkey.
    const lost = browser();
    await lost.call("POST", "/api/auth/email/start", { email: "r@example.ca" });
    const rec = await lost.call("POST", "/api/auth/email/verify", { code: mailer.lastCode() });
    expect(rec.json).toMatchObject({ recovery: true, scoped: true, needsPasskey: true });
    expect(rec.setCookie.find((c: string) => c.startsWith("gist_session="))).toMatch(/Max-Age=300/);
    expect(mailer.sent.at(-1)!.subject).toMatch(/New sign-in/);
    expect((await lost.call("GET", "/api/me")).json.user).toMatchObject({ restricted: true });
    for (const [m, path] of [["GET", "/api/gists"], ["GET", "/api/auth/passkeys"], ["DELETE", `/api/auth/passkeys/${key.id}`]]) {
      const r = await lost.call(m, path);
      expect([path, r.status, r.json.code]).toEqual([path, 403, "passkey_required"]);
    }
    const newKey = new SoftAuthenticator("localhost", "http://localhost");
    const opts = (await lost.call("POST", "/api/auth/passkey/register/options")).json.options;
    expect((await lost.call("POST", "/api/auth/passkey/register/verify", { response: newKey.register(opts) })).status).toBe(201);
    // Now a normal session, but the old passkey can't be removed for 24 hours.
    expect((await lost.call("GET", "/api/gists")).status).toBe(200);
    const me = (await lost.call("GET", "/api/me")).json.user;
    expect(me.restricted).toBeUndefined();
    expect(me.recoveryUntil).toBeTruthy();
    const del = await lost.call("DELETE", `/api/auth/passkeys/${key.id}`);
    expect([del.status, del.json.code]).toEqual([403, "recovery_cooldown"]);
  });

  it("gives the mobile app (no passkeys yet) a normal session on recovery, still with the pause", async () => {
    const { browser, mailer, db } = setup();
    const b = browser();
    await b.call("POST", "/api/auth/email/start", { email: "m@example.ca" });
    await b.call("POST", "/api/auth/email/verify", { code: mailer.lastCode() });
    const { options } = (await b.call("POST", "/api/auth/passkey/register/options")).json;
    await b.call("POST", "/api/auth/passkey/register/verify", { response: new SoftAuthenticator("localhost", "http://localhost").register(options) });
    const app = browser();
    const start = await app.call("POST", "/api/auth/email/start", { email: "m@example.ca" });
    app.jar.clear(); // a native app keeps the attempt id rather than a cookie
    const v = await app.call("POST", "/api/auth/email/verify", { code: mailer.lastCode(), attemptId: start.json.attemptId });
    expect(v.json).toMatchObject({ recovery: true, scoped: false });
    app.jar.clear();
    const r = await app.call("GET", "/api/gists", undefined, { authorization: `Bearer ${v.json.token}` });
    expect(r.status).toBe(200);
    expect((db.prepare("SELECT recovery_until FROM users WHERE email = 'm@example.ca'").get() as { recovery_until: string }).recovery_until).toBeTruthy();
  });

  it("rejects a passkey made for another site", async () => {
    const { browser, mailer } = setup();
    const b = browser();
    await b.call("POST", "/api/auth/email/start", { email: "x@example.ca" });
    await b.call("POST", "/api/auth/email/verify", { code: mailer.lastCode() });
    const { options } = (await b.call("POST", "/api/auth/passkey/register/options")).json;
    const phish = new SoftAuthenticator("localhost", "https://evil.example");
    expect((await b.call("POST", "/api/auth/passkey/register/verify", { response: phish.register(options) })).status).toBe(400);
  });
});

describe("Google sign-in", () => {
  it("uses PKCE, state and a nonce, and links to an existing account with the same verified email", async () => {
    const { browser, nonces, db } = setup();
    member(db, "jesse@example.ca", "Jesse");
    const b = browser();
    await b.call("POST", "/api/auth/guest");
    await b.call("POST", "/api/gists?wait=1", { url: "https://example.ca/compost" });
    const start = await b.call("GET", "/api/auth/google/start?next=/app/library");
    expect(start.status).toBe(302);
    const url = new URL(start.headers.get("location")!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    nonces.push(url.searchParams.get("nonce")!);

    expect((await b.call("GET", `/api/auth/google/callback?code=c&state=wrong`)).headers.get("location")).toMatch(/\/signin\?error=/);
    const cb = await b.call("GET", `/api/auth/google/callback?code=c&state=${url.searchParams.get("state")}`);
    expect(cb.headers.get("location")).toBe("http://localhost/app/library");
    const me = (await b.call("GET", "/api/me")).json.user;
    expect(me).toMatchObject({ email: "jesse@example.ca", google: true, isGuest: false });
    expect((await b.call("GET", "/api/gists")).json.gists).toHaveLength(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(1);
  });

  it("refuses an unverified Google email or a mismatched nonce", async () => {
    for (const google of [{ email_verified: false }, { nonce: "other" }]) {
      const { browser, nonces } = setup({ google });
      const b = browser();
      const url = new URL((await b.call("GET", "/api/auth/google/start")).headers.get("location")!);
      nonces.push(url.searchParams.get("nonce")!);
      const cb = await b.call("GET", `/api/auth/google/callback?code=c&state=${url.searchParams.get("state")}`);
      expect(cb.headers.get("location")).toMatch(/\/signin\?error=/);
      expect((await b.call("GET", "/api/me")).status).toBe(401);
    }
  });
});
