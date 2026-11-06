import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { createApp, ftsQuery } from "../src/app.ts";
import { DemoSummarizer } from "../src/summarize.ts";
import { parseTimedText } from "../src/ingest/youtube.ts";
import { parseTranscript, pickFromFeed, parseDuration } from "../src/ingest/podcast.ts";
import { parseArticleHtml } from "../src/ingest/web.ts";
import type { IngestedSource } from "@gist/core";
import { member } from "./helpers.ts";

const para = "Composting turns kitchen scraps into rich soil for the garden. Balance green material like vegetable peels with brown material like dry leaves. Turn the pile every week so oxygen reaches the microbes doing the work. Keep the pile about as damp as a wrung-out sponge for the fastest results. Avoid meat and dairy because they attract pests and smell. Finished compost is dark, crumbly and smells like a forest floor after rain. ";
const fakeSource = (url?: string | null): IngestedSource => ({
  kind: "youtube", url: url ?? "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Composting basics", author: "Soil School",
  publishedAt: null, thumbnailUrl: null, durationSeconds: 1200, text: para.repeat(12),
  segments: para.repeat(12).split(". ").map((t, i) => ({ start: i * 10, text: t + "." })),
});

function setup() {
  const db = openDb(":memory:");
  const app = createApp({ db, summarizer: new DemoSummarizer(), ingestFn: async (i) => (i.text ? { ...fakeSource(null), kind: "text", text: i.text, segments: undefined, durationSeconds: null } : fakeSource(i.url)) });
  let token = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, json: type.includes("json") ? await res.json() : null, text: type.includes("json") ? null : await res.text(), headers: res.headers };
  };
  return { call, db, setToken: (t: string) => (token = t) };
}

describe("API end to end", () => {
  it("signs up, makes a gist, organizes, searches, exports and reports savings", async () => {
    const { call, db, setToken } = setup();
    expect((await call("GET", "/api/gists")).status).toBe(401);
    setToken(member(db, "jesse@example.ca", "Jesse"));

    const folder = await call("POST", "/api/folders", { name: "Garden" });
    const made = await call("POST", "/api/gists?wait=1", { url: "https://youtu.be/dQw4w9WgXcQ", templateId: "takeaways-actions", focus: "pests", folderId: folder.json.folder.id });
    expect(made.status).toBe(202);
    const g = made.json.gist;
    expect(g.status).toBe("ready");
    expect(g.summary.sections.map((s: { id: string }) => s.id)).toEqual(["takeaways", "actions", "resources"]);
    expect(g.savings.originalMinutes).toBe(20);
    expect(g.savings.minutesSaved).toBeGreaterThan(20);
    expect(g.tags.length).toBeGreaterThan(0);

    const patched = await call("PATCH", `/api/gists/${g.id}`, { tags: ["Compost", "#home garden"], favourite: true });
    expect(patched.json.gist.tags).toEqual(["compost", "home-garden"]);

    expect((await call("GET", "/api/gists?q=compos")).json.gists).toHaveLength(1);
    expect((await call("GET", "/api/gists?q=spaceship")).json.gists).toHaveLength(0);
    expect((await call("GET", `/api/gists?folder=${folder.json.folder.id}&tag=compost&favourite=1`)).json.gists).toHaveLength(1);
    expect((await call("GET", "/api/folders")).json.folders[0].gistCount).toBe(1);

    const md = await call("GET", `/api/gists/${g.id}/export/markdown`);
    expect(md.status).toBe(200);
    expect(md.headers.get("content-disposition")).toMatch(/attachment; filename=".+\.md"/);
    expect(md.text).toContain("Source: [Composting basics]");
    expect((await call("GET", `/api/gists/${g.id}/export/evernote`)).text).toContain("<en-export");

    expect((await call("POST", `/api/gists/${g.id}/send`, { target: "obsidian" })).status).toBe(400);
    await call("PATCH", "/api/settings", { obsidianVault: "Brain", hourlyRate: 60 });
    const ob = await call("POST", `/api/gists/${g.id}/send`, { target: "obsidian" });
    expect(ob.json.url).toMatch(/^obsidian:\/\/new\?vault=Brain/);

    const tpl = await call("POST", "/api/templates", { name: "Sales call", sections: [{ heading: "Objections", instruction: "Customer objections raised", format: "bullets" }] });
    expect(tpl.status).toBe(201);
    const re = await call("POST", `/api/gists/${g.id}/regenerate?wait=1`, { templateId: tpl.json.template.id });
    expect(re.json.gist.summary.sections[0].heading).toBe("Objections");

    const text = await call("POST", "/api/gists?wait=1", { text: para.repeat(3), title: "My notes" });
    expect(text.json.gist.status).toBe("ready");
    const sav = await call("GET", "/api/savings");
    expect(sav.json.totals.gists).toBe(2);
    expect(sav.json.totals.minutesSaved).toBeGreaterThan(20);
    expect(sav.json.assumptions.hourlyRate).toBe(60);
    const kinds = sav.json.hourly.map((d: { kind: string }) => d.kind).sort();
    expect(kinds).toEqual(["text", "youtube"]);
    expect(sav.json.hourly.reduce((a: number, d: { gists: number }) => a + d.gists, 0)).toBe(2);
    const local = await call("GET", "/api/savings?tz=America/Toronto");
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    expect(local.json.hourly[0].date).toBe(`${parts.year}-${parts.month}-${parts.day}`);
    expect(local.json.hourly[0].hour).toBe(Number(parts.hour));
    expect((await call("GET", "/api/savings?tz=Not/AZone")).status).toBe(200);

    const me = await call("PATCH", "/api/settings", { notionToken: "secret_abcdef1234" });
    expect(me.json.user.settings.notionToken).toBe("••••1234");

    expect((await call("DELETE", `/api/gists/${g.id}`)).status).toBe(200);
    expect((await call("GET", `/api/gists/${g.id}`)).status).toBe(404);
  });

  it("isolates users", async () => {
    const { call, db, setToken } = setup();
    setToken(member(db, "a@x.ca"));
    const g = (await call("POST", "/api/gists?wait=1", { url: "https://youtu.be/dQw4w9WgXcQ" })).json.gist;
    setToken(member(db, "b@x.ca"));
    expect((await call("GET", `/api/gists/${g.id}`)).status).toBe(404);
    expect((await call("GET", "/api/gists?q=compost")).json.gists).toHaveLength(0);
  });
});

describe("parsers", () => {
  it("parses YouTube timedtext formats", () => {
    expect(parseTimedText('<transcript><text start="1.5" dur="2">Hello &amp;amp; welcome</text></transcript>')).toEqual([{ start: 1.5, text: "Hello & welcome" }]);
    expect(parseTimedText('<timedtext><body><p t="2500" d="1000">Hi <s>there</s></p></body></timedtext>')).toEqual([{ start: 2.5, text: "Hi there" }]);
  });
  it("parses VTT, SRT and JSON transcripts", () => {
    expect(parseTranscript("WEBVTT\n\n00:01:02.000 --> 00:01:04.000\n<v Host>Welcome back", "text/vtt")).toEqual([{ start: 62, text: "Welcome back" }]);
    expect(parseTranscript("1\n00:00:05,500 --> 00:00:07,000\nHello\n", "application/srt")).toEqual([{ start: 5.5, text: "Hello" }]);
    expect(parseTranscript('{"segments":[{"startTime":3,"body":"Hi"}]}', "application/json")).toEqual([{ start: 3, text: "Hi" }]);
  });
  it("picks episodes from a feed", () => {
    const feed = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>Show</title>
      <item><title>Ep 2</title><enclosure url="https://cdn.x/2.mp3" type="audio/mpeg"/><itunes:duration>1:02:03</itunes:duration><podcast:transcript url="https://x/2.vtt" type="text/vtt"/></item>
      <item><title>Ep 1</title><enclosure url="https://cdn.x/1.mp3?t=1" type="audio/mpeg"/><itunes:duration>600</itunes:duration></item></channel></rss>`;
    const latest = pickFromFeed(feed, null);
    expect(latest.title).toBe("Ep 2");
    expect(latest.durationSeconds).toBe(3723);
    expect(latest.transcripts).toEqual([{ url: "https://x/2.vtt", type: "text/vtt" }]);
    expect(pickFromFeed(feed, "ep 1").audioUrl).toBe("https://cdn.x/1.mp3?t=1");
    expect(pickFromFeed(feed, null, "https://cdn.x/1.mp3").title).toBe("Ep 1");
    expect(parseDuration("45:00")).toBe(2700);
  });
  it("extracts article text", () => {
    const html = `<html><head><title>Site</title><meta property="og:site_name" content="Blog"></head><body><nav>Menu</nav><article><h1>Real title</h1>${"<p>" + para + "</p>"}${"<p>" + para + "</p>"}</article></body></html>`;
    const a = parseArticleHtml(html, "https://blog.example.ca/post");
    expect(a.text).toContain("Composting turns kitchen scraps");
    expect(a.text).not.toContain("Menu");
    expect(a.text).toMatch(/^Real title\n/);
  });
  it("sanitizes search queries", () => {
    expect(ftsQuery('compost "OR" (x')).toBe('"compost"* "or"* "x"*');
  });
});
