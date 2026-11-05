import { describe, expect, it } from "vitest";
import type { IngestedSource } from "@gist/core";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { DemoSummarizer } from "../src/summarize.ts";
import { Connections, seal, unseal } from "../src/connections.ts";

const env = { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsecret", SPOTIFY_CLIENT_ID: "sid", SPOTIFY_CLIENT_SECRET: "ssecret", GIST_TOKEN_KEY: "k".repeat(40), GIST_PUBLIC_URL: "https://gist.example.ca" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A stand-in for Google, YouTube and Spotify that records what Gist asked for. */
function fakePlatforms() {
  const calls: { url: string; init?: RequestInit }[] = [];
  let tokenN = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://oauth2.googleapis.com/token") || url.startsWith("https://accounts.spotify.com/api/token")) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("refresh_token") === "dead") return json({ error: "invalid_grant" }, 400);
      tokenN++;
      return json({ access_token: `at${tokenN}`, refresh_token: form.get("grant_type") === "authorization_code" ? "rt" : undefined, expires_in: 3600 });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return json({});
    if (url.includes("/youtube/v3/channels?part=snippet")) return json({ items: [{ id: "UC1", snippet: { title: "Jesse W" } }] });
    if (url.includes("/youtube/v3/channels?part=contentDetails")) return json({ items: [{ contentDetails: { relatedPlaylists: { likes: "LL" } } }] });
    if (url.includes("/youtube/v3/playlists")) return json({ items: [{ id: "PL1", snippet: { title: "Investing" }, contentDetails: { itemCount: 3 } }] });
    if (url.includes("/youtube/v3/playlistItems")) {
      return json({ items: [
        { snippet: { title: "Lesson 1" }, contentDetails: { videoId: "aaaaaaaaaaa" } },
        { snippet: { title: "Private video" }, contentDetails: { videoId: "bbbbbbbbbbb" } },
        { snippet: { title: "Lesson 3" }, contentDetails: { videoId: "ccccccccccc" } },
      ] });
    }
    if (url === "https://api.spotify.com/v1/me") return json({ id: "jesse", display_name: "Jesse" });
    if (url.startsWith("https://api.spotify.com/v1/me/episodes")) return json({ total: 2, items: [{ episode: { id: "E1", type: "episode", name: "Ep 1" } }, { episode: { id: "E2", type: "episode", name: "Ep 2" } }] });
    if (url.startsWith("https://api.spotify.com/v1/me/playlists")) {
      return json({ items: [
        { id: "MINE", name: "Commute", owner: { id: "jesse" }, items: { total: 4 } },
        { id: "THEIRS", name: "Someone else's", owner: { id: "other" }, collaborative: false },
      ] });
    }
    if (url.startsWith("https://api.spotify.com/v1/playlists/MINE/items")) return json({ items: [{ item: { id: "E9", type: "episode", name: "Pod" } }, { item: { id: "T1", type: "track", name: "Song" } }] });
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
  return { fetchFn, calls };
}

function setup() {
  const db = openDb(":memory:");
  const fake = fakePlatforms();
  const connections = new Connections(db, fake.fetchFn, env);
  const text = "Index funds spread your money across the whole market at low cost. ".repeat(40);
  const app = createApp({
    db,
    summarizer: new DemoSummarizer(),
    connections,
    ingestFn: async (i): Promise<IngestedSource> => ({ kind: i.url?.includes("spotify") ? "podcast" : "youtube", url: i.url ?? null, title: "Item", author: null, publishedAt: null, thumbnailUrl: null, durationSeconds: 600, text }),
  });
  let token = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, headers: r.headers, json: r.headers.get("content-type")?.includes("json") ? await r.json() : null };
  };
  return { db, call, fake, setToken: (t: string) => (token = t) };
}

async function connect(s: ReturnType<typeof setup>, provider: "youtube" | "spotify") {
  const start = await s.call("POST", `/api/connections/${provider}/start`);
  expect(start.status).toBe(200);
  const url = new URL(start.json.url);
  const state = url.searchParams.get("state")!;
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("redirect_uri")).toContain(`/api/connections/${provider}/callback`);
  return s.call("GET", `/api/connections/${provider}/callback?code=abc&state=${state}`);
}

describe("connected accounts", () => {
  it("seals tokens so they aren't stored in plain text", () => {
    const sealed = seal("secret-token", env.GIST_TOKEN_KEY);
    expect(sealed).not.toContain("secret-token");
    expect(unseal(sealed, env.GIST_TOKEN_KEY)).toBe("secret-token");
  });

  it("connects YouTube, lists saved playlists and imports one", async () => {
    const s = setup();
    s.setToken((await s.call("POST", "/api/auth/signup", { email: "c@x.ca", password: "password1" })).json.token);
    expect((await s.call("GET", "/api/connections")).json.connections).toEqual([
      expect.objectContaining({ provider: "youtube", available: true, connected: false }),
      expect.objectContaining({ provider: "spotify", available: true, connected: false }),
    ]);
    const cb = await connect(s, "youtube");
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("/app/settings?connected=youtube");
    const stored = s.db.prepare("SELECT access_token, refresh_token, account_name FROM connections").get() as Record<string, string>;
    expect(stored.account_name).toBe("Jesse W");
    expect(stored.refresh_token).not.toBe("rt");

    const lists = (await s.call("GET", "/api/connections/youtube/lists")).json.lists;
    expect(lists.map((l: { id: string; title: string }) => [l.id, l.title])).toEqual([["LL", "Liked videos"], ["PL1", "Investing"]]);

    const imp = await s.call("POST", "/api/imports?wait=1", { connection: { provider: "youtube", listId: "PL1", title: "Investing" } });
    expect(imp.status).toBe(202);
    expect(imp.json.import.kind).toBe("youtube-account");
    expect(imp.json.import.title).toBe("Investing");
    expect(imp.json.import.ready).toBe(2);
    expect(imp.json.import.skipped).toEqual([{ title: "Private video", reason: "private or deleted" }]);
    // The access token went to YouTube as a bearer token, never in a URL.
    expect(s.fake.calls.filter((c) => c.url.includes("/youtube/v3/")).every((c) => !c.url.includes("at1"))).toBe(true);

    expect((await s.call("DELETE", "/api/connections/youtube")).status).toBe(200);
    expect(s.fake.calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    expect((await s.call("GET", "/api/connections/youtube/lists")).status).toBe(409);
  });

  it("connects Spotify, offers saved episodes and own playlists, and skips music", async () => {
    const s = setup();
    s.setToken((await s.call("POST", "/api/auth/signup", { email: "s@x.ca", password: "password1" })).json.token);
    await connect(s, "spotify");
    const lists = (await s.call("GET", "/api/connections/spotify/lists")).json.lists;
    expect(lists.map((l: { id: string }) => l.id)).toEqual(["saved-episodes", "MINE"]);
    const tokenCall = s.fake.calls.find((c) => c.url.startsWith("https://accounts.spotify.com/api/token"))!;
    expect((tokenCall.init?.headers as Record<string, string>).authorization).toMatch(/^Basic /);

    const imp = await s.call("POST", "/api/imports?wait=1", { connection: { provider: "spotify", listId: "MINE", title: "Commute" } });
    expect(imp.json.import.total).toBe(1);
    expect(imp.json.import.skipped).toEqual([{ title: "Song", reason: "music track" }]);
    expect(imp.json.import.gists[0].source.url).toBe("https://open.spotify.com/episode/E9");
  });

  it("rejects a forged or reused sign-in state and refreshes expired tokens", async () => {
    const s = setup();
    s.setToken((await s.call("POST", "/api/auth/signup", { email: "f@x.ca", password: "password1" })).json.token);
    const forged = await s.call("GET", "/api/connections/youtube/callback?code=abc&state=nope");
    expect(forged.headers.get("location")).toContain("connect_error=");
    expect((await s.call("GET", "/api/connections")).json.connections[0].connected).toBe(false);

    await connect(s, "youtube");
    s.db.prepare("UPDATE connections SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    expect((await s.call("GET", "/api/connections/youtube/lists")).status).toBe(200);
    expect(s.fake.calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/token"))).toHaveLength(2);

    // A revoked grant removes the connection and asks the user to reconnect.
    s.db.prepare("UPDATE connections SET expires_at = ?, refresh_token = ?").run(new Date(0).toISOString(), seal("dead", env.GIST_TOKEN_KEY));
    const dead = await s.call("GET", "/api/connections/youtube/lists");
    expect(dead.status).toBe(401);
    expect(dead.json.error).toMatch(/connect it again/);
    expect((await s.call("GET", "/api/connections")).json.connections[0].connected).toBe(false);
  });

  it("reports connections as unavailable until the server is configured", async () => {
    const db = openDb(":memory:");
    const app = createApp({ db, summarizer: new DemoSummarizer(), connections: new Connections(db, fetch, {}) });
    const su = await app.request("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "u@x.ca", password: "password1" }) });
    const token = ((await su.json()) as { token: string }).token;
    const r = await app.request("/api/connections/youtube/start", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(r.status).toBe(503);
  });
});
