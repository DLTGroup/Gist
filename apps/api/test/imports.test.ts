import { describe, expect, it } from "vitest";
import { detectCollection, extractLinks, type IngestedSource } from "@gist/core";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { DemoSummarizer } from "../src/summarize.ts";
import { parseFeedCollection, parseSpotifyEmbed, parseYouTubePlaylistHtml } from "../src/ingest/playlist.ts";

describe("collection detection", () => {
  it("recognizes playlists, shows and feeds", () => {
    expect(detectCollection("https://www.youtube.com/playlist?list=PLabc")).toEqual({ kind: "youtube-playlist", ambiguous: false });
    expect(detectCollection("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc")).toEqual({ kind: "youtube-playlist", ambiguous: true });
    expect(detectCollection("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ")).toBeNull();
    expect(detectCollection("https://open.spotify.com/playlist/37i9dQ?si=x")?.kind).toBe("spotify-playlist");
    expect(detectCollection("https://open.spotify.com/intl-fr/show/4rOoJ6")?.kind).toBe("spotify-show");
    expect(detectCollection("https://open.spotify.com/episode/123")).toBeNull();
    expect(detectCollection("https://podcasts.apple.com/ca/podcast/x/id123")?.kind).toBe("apple-show");
    expect(detectCollection("https://podcasts.apple.com/ca/podcast/x/id123?i=9")).toBeNull();
    expect(detectCollection("https://feeds.example.com/show")?.kind).toBe("podcast-feed");
    expect(detectCollection("https://example.com/blog/post")).toBeNull();
  });
  it("extracts links from pasted text", () => {
    expect(extractLinks("watch https://youtu.be/aaaaaaaaaaa, then\nhttps://blog.ca/x.\nhttps://youtu.be/aaaaaaaaaaa")).toEqual(["https://youtu.be/aaaaaaaaaaa", "https://blog.ca/x"]);
  });
});

describe("collection parsers", () => {
  it("parses a YouTube playlist page", () => {
    const data = {
      metadata: { playlistMetadataRenderer: { title: "Investing 101" } },
      contents: { a: [{ playlistVideoRenderer: { videoId: "aaaaaaaaaaa", title: { runs: [{ text: "Lesson 1" }] } } }, { playlistVideoRenderer: { videoId: "bbbbbbbbbbb", title: { simpleText: "[Private video]" }, isPlayable: false } }, { playlistVideoRenderer: { videoId: "ccccccccccc", title: { simpleText: "Lesson 3" } } }] },
    };
    const col = parseYouTubePlaylistHtml(`<script>var ytInitialData = ${JSON.stringify(data)};</script>`);
    expect(col.title).toBe("Investing 101");
    expect(col.items).toEqual([{ url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", title: "Lesson 1" }, { url: "https://www.youtube.com/watch?v=ccccccccccc", title: "Lesson 3" }]);
    expect(col.skipped).toHaveLength(1);
  });
  it("keeps podcast episodes from a Spotify playlist and skips music", () => {
    const next = { props: { pageProps: { state: { data: { entity: { name: "Commute", trackList: [{ uri: "spotify:episode:EP1", title: "Ep one" }, { uri: "spotify:track:T1", title: "A song" }] } } } } } };
    const col = parseSpotifyEmbed(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`, "spotify-playlist");
    expect(col.title).toBe("Commute");
    expect(col.items).toEqual([{ url: "https://open.spotify.com/episode/EP1", title: "Ep one" }]);
    expect(col.skipped[0].reason).toMatch(/music/);
  });
  it("turns a feed into per-episode links", () => {
    const col = parseFeedCollection(`<rss><channel><title>Show &amp; Tell</title><item><title>Ep 2</title></item><item><title>Ep 1</title></item></channel></rss>`, "https://feeds.x.ca/s.xml");
    expect(col.title).toBe("Show & Tell");
    expect(col.items[0].url).toBe("https://feeds.x.ca/s.xml#episode=Ep%202");
  });
});

describe("bulk import API", () => {
  it("imports a playlist into its own folder and reports progress and savings", async () => {
    const db = openDb(":memory:");
    const text = "Index funds spread your money across the whole market at low cost. ".repeat(40);
    const app = createApp({
      db,
      summarizer: new DemoSummarizer(),
      ingestFn: async (i): Promise<IngestedSource> => {
        if (i.url?.includes("bad")) throw new Error("boom");
        return { kind: "youtube", url: i.url ?? null, title: "Video " + i.url?.slice(-3), author: "Chan", publishedAt: null, thumbnailUrl: null, durationSeconds: 600, text };
      },
      expandFn: async () => ({ kind: "youtube-playlist", title: "Investing 101", items: [{ url: "https://youtu.be/aaaaaaaa001", title: "L1" }, { url: "https://youtu.be/aaaaaaaa002", title: "L2" }, { url: "https://youtu.be/bad", title: "L3" }], skipped: [{ title: "x", reason: "private or deleted video" }] }),
    });
    const call = async (method: string, path: string, body?: unknown, token?: string) => {
      const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: r.headers.get("content-type")?.includes("json") ? await r.json() : null, text: r.headers.get("content-type")?.includes("json") ? null : await r.text() };
    };
    const token = (await call("POST", "/api/auth/signup", { email: "p@x.ca", password: "password1" })).json.token;
    const r = await call("POST", "/api/imports?wait=1", { url: "https://www.youtube.com/playlist?list=PLx", templateId: "study-notes" }, token);
    expect(r.status).toBe(202);
    const imp = r.json.import;
    expect(imp.title).toBe("Investing 101");
    expect([imp.total, imp.ready, imp.failed, imp.processing]).toEqual([3, 2, 1, 0]);
    expect(imp.skipped).toHaveLength(1);
    expect(imp.totals.minutesSaved).toBeGreaterThan(10);
    expect(imp.gists.every((g: { templateId: string }) => g.templateId === "study-notes")).toBe(true);
    const folders = (await call("GET", "/api/folders", undefined, token)).json.folders;
    expect(folders).toEqual([expect.objectContaining({ name: "Investing 101", gistCount: 3 })]);
    const md = await call("GET", `/api/export/markdown?import=${imp.id}`, undefined, token);
    expect(md.text?.startsWith("# Investing 101")).toBe(true);
    expect((md.text?.match(/^## /gm) ?? []).length).toBe(2);
    const list = (await call("GET", "/api/imports", undefined, token)).json.imports;
    expect(list[0].total).toBe(3);

    const links = await call("POST", "/api/imports?wait=1", { urls: ["https://youtu.be/aaaaaaaa009", "not a link", "https://youtu.be/aaaaaaaa009"], title: "Reading list" }, token);
    expect(links.json.import.total).toBe(1);
    expect(links.json.import.title).toBe("Reading list");
  });
});
