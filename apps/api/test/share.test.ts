import { describe, expect, it } from "vitest";
import { shareLinks, shareMessage, speechSegments, type Gist, type IngestedSource } from "@gist/core";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { DemoSummarizer } from "../src/summarize.ts";

const para = "Composting turns kitchen scraps into rich soil for the garden. Balance green material like vegetable peels with brown material like dry leaves. Turn the pile every week so oxygen reaches the microbes doing the work. Keep the pile about as damp as a wrung-out sponge. ";
const src = (): IngestedSource => ({
  kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Composting <basics>", author: "Soil School", publishedAt: null, thumbnailUrl: null,
  durationSeconds: 1200, text: para.repeat(15), segments: para.repeat(15).split(". ").map((t, i) => ({ start: i * 10, text: t + "." })),
});
// Smallest valid PNG (1×1, transparent).
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function setup() {
  const db = openDb(":memory:");
  const app = createApp({ db, summarizer: new DemoSummarizer(), ingestFn: async () => src() });
  let token = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, type, json: type.includes("json") ? await res.json() : null, text: type.includes("html") ? await res.text() : null, bytes: type.includes("png") ? new Uint8Array(await res.arrayBuffer()) : null };
  };
  return { call, setToken: (t: string) => (token = t), clearToken: () => (token = "") };
}

describe("share links", () => {
  it("creates a public page with preview tags and a card image, and can be turned off", async () => {
    const { call, setToken, clearToken } = setup();
    const su = await call("POST", "/api/auth/signup", { email: "a@example.ca", password: "correct horse" });
    setToken(su.json.token);
    const g = (await call("POST", "/api/gists?wait=1", { url: "https://youtu.be/dQw4w9WgXcQ", templateId: "quick-gist" })).json.gist;

    expect((await call("GET", `/api/gists/${g.id}/share`)).json.share).toBeNull();
    expect((await call("POST", `/api/gists/${g.id}/share`, { card: "data:image/jpeg;base64,AAAA" })).status).toBe(400);
    const made = await call("POST", `/api/gists/${g.id}/share`, { card: PNG }, { "x-forwarded-proto": "https", "x-forwarded-host": "gist.example.ca" });
    expect(made.status).toBe(200);
    const { url, cardUrl } = made.json.share;
    expect(url).toMatch(/^https:\/\/gist\.example\.ca\/s\/[\w-]{20,}$/);
    expect(cardUrl).toBe(url + "/card.png");
    // Sharing again keeps the same link.
    expect((await call("POST", `/api/gists/${g.id}/share`, {})).json.share.url.split("/s/")[1]).toBe(url.split("/s/")[1]);

    clearToken();
    const path = new URL(url).pathname;
    const page = await call("GET", path, undefined, { "x-forwarded-proto": "https", "x-forwarded-host": "gist.example.ca" });
    expect(page.status).toBe(200);
    expect(page.text).toContain(`<meta property="og:image" content="${cardUrl}">`);
    expect(page.text).toContain('name="twitter:card" content="summary_large_image"');
    expect(page.text).toContain("Composting &lt;basics&gt;"); // escaped
    expect(page.text).toContain(">Sources</h2>");
    const img = await call("GET", path + "/card.png");
    expect(img.type).toBe("image/png");
    expect(img.bytes!.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    setToken(su.json.token);
    expect((await call("DELETE", `/api/gists/${g.id}/share`)).status).toBe(200);
    clearToken();
    expect((await call("GET", path)).status).toBe(404);
    expect((await call("GET", path + "/card.png")).status).toBe(404);
  });

  it("only lets the owner share a gist", async () => {
    const { call, setToken } = setup();
    setToken((await call("POST", "/api/auth/signup", { email: "a@example.ca", password: "correct horse" })).json.token);
    const g = (await call("POST", "/api/gists?wait=1", { url: "https://youtu.be/dQw4w9WgXcQ" })).json.gist;
    setToken((await call("POST", "/api/auth/signup", { email: "b@example.ca", password: "correct horse" })).json.token);
    expect((await call("POST", `/api/gists/${g.id}/share`, {})).status).toBe(404);
  });
});

describe("listen and share helpers", () => {
  const g = {
    source: { kind: "youtube", url: null, title: "T", author: null },
    savings: { minutesSaved: 42 },
    summary: { title: "Title", tldr: "Short version.", sections: [{ id: "k", heading: "Key points", format: "bullets", items: [{ text: "One" }, { text: "Two" }] }, { id: "e", heading: "Empty", format: "bullets", items: [] }] },
  } as unknown as Gist;
  it("reads the gist aloud point by point", () => {
    expect(speechSegments(g).map((s) => s.key)).toEqual(["title", "tldr", "h:k", "i:k:0", "i:k:1"]);
    expect(speechSegments(g)[2].text).toBe("Key points.");
  });
  it("builds share links for each network", () => {
    const msg = shareMessage(g);
    expect(msg).toContain("saved 42 min");
    const withUrl = shareLinks(msg, "https://gist.example.ca/s/abc");
    expect(withUrl.facebook).toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fgist.example.ca%2Fs%2Fabc");
    expect(withUrl.whatsapp).toContain(encodeURIComponent("https://gist.example.ca/s/abc"));
    expect(shareLinks(msg, null).facebook).toBeNull();
    expect(withUrl.reddit).toBe(`https://www.reddit.com/submit?url=${encodeURIComponent("https://gist.example.ca/s/abc")}&title=${encodeURIComponent(msg.split("\n")[0])}`);
    expect(shareLinks(msg, null, "My title").reddit).toMatch(/^https:\/\/www\.reddit\.com\/submit\?type=TEXT&title=My%20title&text=/);
    const long = shareLinks("word ".repeat(100), "https://x.y/s/1").x!;
    expect(decodeURIComponent(long.split("text=")[1].split("&url=")[0]).length).toBeLessThanOrEqual(256);
  });
});
