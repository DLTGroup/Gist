import { describe, expect, it } from "vitest";
import type { IngestedSource } from "@gist/core";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { DemoSummarizer } from "../src/summarize.ts";
import { member } from "./helpers.ts";

const para = "Composting turns kitchen scraps into rich soil for the garden. Balance green material like vegetable peels with brown material like dry leaves. Turn the pile every week so oxygen reaches the microbes doing the work. Keep the pile about as damp as a wrung-out sponge. ";
const src = (): IngestedSource => ({
  kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Composting basics", author: "Soil School", publishedAt: null, thumbnailUrl: null,
  durationSeconds: 1200, text: para.repeat(15), segments: para.repeat(15).split(". ").map((t, i) => ({ start: i * 10, text: t + "." })),
});

function setup() {
  const db = openDb(":memory:");
  const app = createApp({ db, summarizer: new DemoSummarizer(), ingestFn: async () => src() });
  let token = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, json: type.includes("json") ? await res.json() : null, text: type.includes("json") ? null : await res.text() };
  };
  return { call, db, setToken: (t: string) => (token = t) };
}

describe("removing pieces of a gist", () => {
  it("removes single points, paragraphs and the TL;DR, leaves them out of exports, and puts them back", async () => {
    const { call, db, setToken } = setup();
    setToken(member(db, "a@example.ca"));
    const g = (await call("POST", "/api/gists?wait=1", { url: "https://youtu.be/dQw4w9WgXcQ", templateId: "quick-gist" })).json.gist;
    const sec = g.summary.sections.find((s: { items: unknown[] }) => s.items.length >= 2);
    expect(sec).toBeTruthy();
    const point = sec.items[1].text as string;
    const before = (await call("GET", `/api/gists/${g.id}/export/markdown`)).text!;
    expect(before).toContain(point);

    const r1 = await call("PATCH", `/api/gists/${g.id}`, { remove: { kind: "item", sectionId: sec.id, index: 1 } });
    expect(r1.status).toBe(200);
    expect(r1.json.gist.removedCount).toBe(1);
    const after = r1.json.gist.summary.sections.find((s: { id: string }) => s.id === sec.id);
    expect(after.items).toHaveLength(sec.items.length - 1);
    const count = (t: string) => t.split(point).length - 1;
    expect(count((await call("GET", `/api/gists/${g.id}/export/markdown`)).text!)).toBe(count(before) - 1);

    const r2 = await call("PATCH", `/api/gists/${g.id}`, { remove: { kind: "tldr" } });
    expect(r2.json.gist.summary.tldr).toBe("");
    expect(r2.json.gist.removedCount).toBe(2);
    // Removing something that's already gone is refused.
    expect((await call("PATCH", `/api/gists/${g.id}`, { remove: { kind: "tldr" } })).status).toBe(400);
    expect((await call("PATCH", `/api/gists/${g.id}`, { remove: { kind: "item", sectionId: "nope", index: 0 } })).status).toBe(400);
    expect((await call("PATCH", `/api/gists/${g.id}`, { remove: { kind: "item", sectionId: sec.id, index: -1 } })).status).toBe(400);

    // Undo puts back the newest removal only.
    const r3 = await call("PATCH", `/api/gists/${g.id}`, { restore: "last" });
    expect(r3.json.gist.summary.tldr).toBe(g.summary.tldr);
    expect(r3.json.gist.removedCount).toBe(1);

    // Restore all puts each point back where it was.
    const r4 = await call("PATCH", `/api/gists/${g.id}`, { restore: "all" });
    expect(r4.json.gist.removedCount).toBe(0);
    expect(r4.json.gist.summary).toEqual(g.summary);
    expect((await call("GET", `/api/gists/${g.id}`)).json.gist.removedCount).toBe(0);
  });

  it("restores several points in one section to their original order", async () => {
    const { call, db, setToken } = setup();
    setToken(member(db, "b@example.ca"));
    const g = (await call("POST", "/api/gists?wait=1", { url: "https://youtu.be/dQw4w9WgXcQ", templateId: "quick-gist" })).json.gist;
    const sec = g.summary.sections.find((s: { items: unknown[] }) => s.items.length >= 3);
    expect(sec).toBeTruthy();
    // Remove the first point twice: that takes out points 0 and 1.
    await call("PATCH", `/api/gists/${g.id}`, { remove: { kind: "item", sectionId: sec.id, index: 0 } });
    await call("PATCH", `/api/gists/${g.id}`, { remove: { kind: "item", sectionId: sec.id, index: 0 } });
    const back = (await call("PATCH", `/api/gists/${g.id}`, { restore: "all" })).json.gist;
    expect(back.summary.sections.find((s: { id: string }) => s.id === sec.id).items).toEqual(sec.items);
  });
});
