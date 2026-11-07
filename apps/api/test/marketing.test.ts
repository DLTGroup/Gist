import { describe, expect, it } from "vitest";
import type { IngestedSource } from "@gist/core";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { DemoSummarizer } from "../src/summarize.ts";
import { CapturingMailer, member } from "./helpers.ts";

const text = "Compost needs greens and browns in balance. Turn the pile weekly. ".repeat(20);
const src = (): IngestedSource => ({ kind: "web", url: null, title: "Composting", author: null, publishedAt: null, thumbnailUrl: null, durationSeconds: null, text });
const CASL = { GIST_BUSINESS_NAME: "DLT Group", GIST_MAILING_ADDRESS: "1 Example St, Bracebridge, ON P1L 0A0", GIST_CONTACT_EMAIL: "hello@example.ca", GIST_ADMIN_EMAILS: "Boss@example.ca" };

function setup(extraEnv: Record<string, string> = CASL) {
  const db = openDb(":memory:");
  const mailer = new CapturingMailer();
  const nonces: string[] = [];
  const app = createApp({
    db, summarizer: new DemoSummarizer(), ingestFn: async () => src(), mailer,
    identity: {
      env: { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", GIST_TOKEN_KEY: "k".repeat(64), ...extraEnv },
      fetchFn: (async () => Response.json({ id_token: "fake" })) as unknown as typeof fetch,
      verifyGoogleIdToken: async () => ({ sub: "g-1", email: "gina@example.ca", email_verified: true, name: "Gina", nonce: nonces.at(-1) }),
    },
  });
  const browser = (token?: string) => {
    const jar = new Map<string, string>();
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json", "x-gist-client": "web", ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const sc of res.headers.getSetCookie()) {
        const [pair, ...attrs] = sc.split(";");
        const [k, v] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
        if (!v || attrs.some((a) => /max-age=0/i.test(a))) jar.delete(k);
        else jar.set(k, v);
      }
      const type = res.headers.get("content-type") ?? "";
      return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null, text: type.includes("json") ? null : await res.text() };
    };
    return { call };
  };
  return { db, mailer, browser, nonces };
}

async function signUpByEmail(b: ReturnType<ReturnType<typeof setup>["browser"]>, mailer: CapturingMailer, email: string, marketing?: boolean) {
  await b.call("POST", "/api/auth/email/start", { email });
  return b.call("POST", "/api/auth/email/verify", { code: mailer.lastCode(), ...(marketing === undefined ? {} : { marketing }) });
}

describe("marketing email consent", () => {
  it("only offers the box once the business name, mailing address and contact are set", async () => {
    const off = setup({});
    expect((await off.browser().call("GET", "/api/marketing/consent")).json).toMatchObject({ available: false });
    const b = off.browser();
    await signUpByEmail(b, off.mailer, "a@example.ca", true);
    expect((await b.call("GET", "/api/me")).json.user.marketingOptIn).toBe(false);

    const on = (await setup().browser().call("GET", "/api/marketing/consent")).json;
    expect(on.available).toBe(true);
    expect(on.label).toMatch(/optional/i);
    // The request names who is asking, a mailing address, a contact, and that consent can be withdrawn.
    for (const part of ["DLT Group", "1 Example St, Bracebridge", "hello@example.ca", "withdraw your consent"]) expect(on.details).toContain(part);
  });

  it("leaves people off the list unless they tick the box", async () => {
    const { browser, mailer, db } = setup();
    const b = browser();
    await signUpByEmail(b, mailer, "quiet@example.ca");
    expect((await b.call("GET", "/api/me")).json.user.marketingOptIn).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM consent_log").get()).toMatchObject({ n: 0 });
    expect(mailer.sent.map((m) => m.subject)).not.toContain("You're on the Gist email list");
  });

  it("records consent given at sign-up, confirms it by email, and honours the unsubscribe link", async () => {
    const { browser, mailer, db } = setup();
    const b = browser();
    const r = await signUpByEmail(b, mailer, "yes@example.ca", true);
    expect(r.status).toBe(201);
    expect((await b.call("GET", "/api/me")).json.user.marketingOptIn).toBe(true);
    const log = db.prepare("SELECT * FROM consent_log").all() as Record<string, string>[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ email: "yes@example.ca", action: "granted", source: "signup-email" });
    expect(log[0].wording).toContain("DLT Group");
    expect(log[0].created_at).toMatch(/^\d{4}-\d\d-\d\dT/);

    const confirm = mailer.sent.find((m) => m.subject === "You're on the Gist email list")!;
    expect(confirm.to).toBe("yes@example.ca");
    const link = confirm.text.match(/http:\/\/localhost(\/u\/[\w-]+)/)![1];

    // Opening the link only asks; a link scanner can't unsubscribe anyone.
    const page = await browser().call("GET", link);
    expect(page.text).toContain("Unsubscribe from Gist emails?");
    expect((await b.call("GET", "/api/me")).json.user.marketingOptIn).toBe(true);
    const done = await browser().call("POST", link);
    expect(done.text).toContain("You're unsubscribed");
    expect((await b.call("GET", "/api/me")).json.user.marketingOptIn).toBe(false);
    expect((db.prepare("SELECT action, source FROM consent_log ORDER BY created_at").all() as Record<string, string>[]).at(-1)).toMatchObject({ action: "withdrawn", source: "unsubscribe-link" });
    expect((await browser().call("GET", "/u/not-a-real-token-at-all-xx")).status).toBe(404);
  });

  it("does not withdraw consent when someone signs in again without ticking the box", async () => {
    const { browser, mailer } = setup();
    await signUpByEmail(browser(), mailer, "keep@example.ca", true);
    const again = browser();
    await signUpByEmail(again, mailer, "keep@example.ca");
    expect((await again.call("GET", "/api/me")).json.user.marketingOptIn).toBe(true);
  });

  it("records consent through Google sign-up", async () => {
    const { browser, nonces, db } = setup();
    const b = browser();
    const url = new URL((await b.call("GET", "/api/auth/google/start?marketing=1")).headers.get("location")!);
    nonces.push(url.searchParams.get("nonce")!);
    await b.call("GET", `/api/auth/google/callback?code=c&state=${url.searchParams.get("state")}`);
    expect((await b.call("GET", "/api/me")).json.user).toMatchObject({ email: "gina@example.ca", marketingOptIn: true });
    expect(db.prepare("SELECT source FROM consent_log").get()).toMatchObject({ source: "signup-google" });
  });

  it("lets members turn it on and off in Settings, but not guests", async () => {
    const { browser, db } = setup();
    const m = browser(member(db, "set@example.ca"));
    expect((await m.call("PATCH", "/api/marketing", { optIn: "yes" })).status).toBe(400);
    expect((await m.call("PATCH", "/api/marketing", { optIn: true })).json.user.marketingOptIn).toBe(true);
    expect((await m.call("PATCH", "/api/marketing", { optIn: false })).json.user.marketingOptIn).toBe(false);
    expect((db.prepare("SELECT action, source FROM consent_log ORDER BY created_at").all() as Record<string, string>[]).map((r) => `${r.action}:${r.source}`)).toEqual(["granted:settings", "withdrawn:settings"]);

    const g = browser();
    await g.call("POST", "/api/auth/guest");
    expect((await g.call("PATCH", "/api/marketing", { optIn: true })).status).toBe(403);
  });

  it("lets only named operators download the list, with formula-safe cells", async () => {
    const { browser, db } = setup();
    const boss = browser(member(db, "boss@example.ca"));
    const other = browser(member(db, "other@example.ca"));
    expect((await other.call("GET", "/api/admin/mailing-list.csv")).status).toBe(404);
    expect((await other.call("GET", "/api/me")).json.user.isAdmin).toBe(false);
    expect((await boss.call("GET", "/api/me")).json.user.isAdmin).toBe(true);

    const fan = browser(member(db, "fan@example.ca", "=HYPERLINK(\"x\")"));
    await fan.call("PATCH", "/api/marketing", { optIn: true });
    await other.call("PATCH", "/api/marketing", { optIn: true });
    await other.call("PATCH", "/api/marketing", { optIn: false });

    expect((await boss.call("GET", "/api/admin/mailing-list")).json.count).toBe(1);
    const csv = await boss.call("GET", "/api/admin/mailing-list.csv");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.headers.get("content-disposition")).toMatch(/attachment; filename="gist-mailing-list-\d{4}-\d\d-\d\d\.csv"/);
    const lines = csv.text!.trim().split("\r\n");
    expect(lines[0]).toBe("email,name,consented_at,consent_source,signed_up_at,unsubscribe_url");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^fan@example\.ca,"'=HYPERLINK\(""x""\)",\d{4}-.+,settings,.+,http:\/\/localhost\/u\/[\w-]+$/);
  });
});
