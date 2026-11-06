import { describe, expect, it } from "vitest";
import {
  sourcePlatform,
  BUILT_IN_TEMPLATES, buildUserPrompt, computeSavings, detectSourceKind, formatMinutes, obsidianUri,
  sourceLinks, timestampLink, toEnex, toMarkdown, toNotionBlocks, validateTemplate, youtubeLinks, youtubeVideoId, type Gist,
  changeFromPrevious, paceUntil, periodRange, planPayback, periodSlots, periodStart, recentPace, sumRange, type HourlySavings,
} from "../src/index.ts";

describe("source detection", () => {
  it("recognizes YouTube URL shapes", () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"])
      expect(youtubeVideoId(u)).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
  it("classifies podcasts, web and text", () => {
    expect(detectSourceKind("https://podcasts.apple.com/ca/podcast/x/id123?i=456")).toBe("podcast");
    expect(detectSourceKind("https://open.spotify.com/episode/abc")).toBe("podcast");
    expect(detectSourceKind("https://feeds.example.com/show.xml")).toBe("podcast");
    expect(detectSourceKind("https://cdn.example.com/show.xml#episode=Ep%201")).toBe("podcast");
    expect(detectSourceKind("https://example.com/blog/post")).toBe("web");
    expect(detectSourceKind("just some notes")).toBe("text");
  });
});

const summary = {
  title: "How to plan a garden",
  tldr: "Start small and plan around sunlight.",
  suggestedTags: ["gardening"],
  sections: [
    { id: "takeaways", heading: "Key takeaways", format: "bullets" as const, paragraph: null, items: [{ text: "Map the sun across the day.", timestamp: 65 }] },
    { id: "actions", heading: "Action items", format: "checklist" as const, paragraph: null, items: [{ text: "Buy a soil test kit.", timestamp: null }] },
    { id: "empty", heading: "Resources", format: "bullets" as const, paragraph: null, items: [] },
  ],
};

const gist: Gist = {
  id: "g1", userId: "u1", status: "ready", error: null, templateId: "takeaways-actions", focus: null,
  source: { kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Garden video", author: "Green Thumb", publishedAt: null, thumbnailUrl: null, durationSeconds: 1800, wordCount: 4500 },
  summary, savings: null, folderId: null, tags: ["gardening"], favourite: false, model: "test",
  createdAt: "2026-11-04T12:00:00.000Z", updatedAt: "2026-11-04T12:00:00.000Z",
};

describe("source platform", () => {
  it("names the service a source came from", () => {
    expect(sourcePlatform({ kind: "youtube", url: "https://youtu.be/abc" })).toBe("youtube");
    expect(sourcePlatform({ kind: "podcast", url: "https://open.spotify.com/episode/123" })).toBe("spotify");
    expect(sourcePlatform({ kind: "podcast", url: "https://podcasts.apple.com/ca/podcast/x/id1" })).toBe("applepodcasts");
    expect(sourcePlatform({ kind: "podcast", url: "https://feeds.example.com/show.rss" })).toBe("podcast");
    expect(sourcePlatform({ kind: "web", url: "https://example.ca/post" })).toBe("web");
    expect(sourcePlatform({ kind: "text", url: null })).toBe("text");
  });
});

describe("savings", () => {
  it("uses duration for video and reading speed for text", () => {
    const v = computeSavings({ kind: "youtube", durationSeconds: 1800, wordCount: 4500 }, summary);
    expect(v.originalMinutes).toBe(30);
    expect(v.manualNotesMinutes).toBe(10.5);
    expect(v.minutesSaved).toBeGreaterThan(40);
    expect(v.moneySaved).toBeCloseTo((v.minutesSaved / 60) * 35, 1);
    const w = computeSavings({ kind: "web", durationSeconds: null, wordCount: 2380 }, summary);
    expect(w.originalMinutes).toBe(10);
    expect(w.effortReduction).toBeGreaterThan(0.9);
  });
  it("respects playback speed", () => {
    const v = computeSavings({ kind: "youtube", durationSeconds: 1800, wordCount: 4500 }, summary, { readingWpm: 238, noteTakingFactor: 0, hourlyRate: 0, currency: "CAD", playbackSpeed: 2 });
    expect(v.originalMinutes).toBe(15);
  });
  it("formats minutes", () => {
    expect(formatMinutes(0.3)).toBe("18 sec");
    expect(formatMinutes(95)).toBe("1 h 35 min");
  });
});

describe("rendering", () => {
  it("renders markdown with front matter, checklists, timestamps and attribution", () => {
    const md = toMarkdown(gist, { frontMatter: true });
    expect(md).toMatch(/^---\ntitle: "How to plan a garden"/);
    expect(md).toContain("- [ ] Buy a soil test kit.");
    expect(md).toContain("([1:05](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65s))");
    expect(md).not.toContain("## Resources");
    expect(md).toContain("Source: [Garden video](https://www.youtube.com/watch?v=dQw4w9WgXcQ) by Green Thumb");
  });
  it("renders valid-looking ENEX with to-dos", () => {
    const x = toEnex([gist]);
    expect(x).toContain("<en-export");
    expect(x).toContain('<en-todo checked="false"/>Buy a soil test kit.');
    expect(x).toContain("<tag>gardening</tag>");
    expect(x).toContain('Map the sun across the day. (<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=65s">1:05</a>)');
  });
  it("renders Notion blocks", () => {
    const blocks = toNotionBlocks(gist) as { type: string }[];
    expect(blocks.map((b) => b.type)).toEqual(["callout", "heading_2", "bulleted_list_item", "heading_2", "to_do", "divider", "paragraph"]);
    const rich = (blocks[2] as unknown as { bulleted_list_item: { rich_text: { text: { content: string; link: { url: string } | null } }[] } }).bulleted_list_item.rich_text;
    expect(rich.map((r) => r.text.content).join("")).toBe("Map the sun across the day. (1:05)");
    expect(rich[2].text.link).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65s" });
  });
  it("builds an Obsidian deep link", () => {
    const uri = obsidianUri(gist, "My Vault", "Gist");
    expect(uri.startsWith("obsidian://new?vault=My%20Vault&file=Gist%2FHow%20to%20plan%20a%20garden&content=")).toBe(true);
  });
});

describe("templates and prompt", () => {
  it("built-ins are valid and have unique ids", () => {
    for (const t of BUILT_IN_TEMPLATES) expect(validateTemplate(t)).toBeNull();
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(BUILT_IN_TEMPLATES.length);
  });
  it("rejects bad templates", () => {
    expect(validateTemplate({ name: "X" })).toMatch(/name/);
    expect(validateTemplate({ name: "Mine", sections: [] })).toMatch(/section/);
  });
  it("puts timestamps and the reader's focus in the prompt", () => {
    const p = buildUserPrompt(
      { kind: "youtube", url: "u", title: "T", author: null, publishedAt: null, thumbnailUrl: null, durationSeconds: 90, text: "a b", segments: [{ start: 0, text: "hello" }, { start: 45, text: "world" }] },
      BUILT_IN_TEMPLATES[1], "pricing advice",
    );
    expect(p).toContain("[0:00|0s] hello");
    expect(p).toContain("[0:45|45s] world");
    expect(p).toContain("The reader specifically wants: pricing advice");
    expect(p).toContain('id="actions"');
  });
});

describe("source links", () => {
  it("links timestamps to YouTube and to podcast audio", () => {
    expect(timestampLink("youtube", "https://youtu.be/dQw4w9WgXcQ", 75.4)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s");
    expect(timestampLink("podcast", "https://example.com/ep", 90, "https://cdn.example.com/ep.mp3")).toBe("https://cdn.example.com/ep.mp3#t=90");
    expect(timestampLink("podcast", "https://example.com/ep", 90)).toBeNull();
    expect(timestampLink("web", "https://example.com/a", 90)).toBeNull();
  });
  it("lists stored links, falling back to the source URL for older gists", () => {
    const yt = youtubeLinks("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(yt.map((l) => l.kind)).toEqual(["original", "transcript"]);
    expect(sourceLinks({ kind: "youtube", url: "x", links: yt })).toBe(yt);
    expect(sourceLinks({ kind: "web", url: "https://example.com/a" })).toEqual([{ kind: "original", label: "Read the original", url: "https://example.com/a" }]);
    expect(sourceLinks({ kind: "text", url: null })).toEqual([]);
  });
  it("puts transcript links in Markdown exports", () => {
    const g = { ...sampleGistForLinks(), source: { ...sampleGistForLinks().source, links: [{ kind: "original", label: "Episode page", url: "https://example.com/ep" }, { kind: "transcript", label: "Publisher's transcript", url: "https://example.com/ep.vtt" }] } } as Gist;
    expect(toMarkdown(g)).toContain("[Publisher's transcript](https://example.com/ep.vtt)");
  });
});

function sampleGistForLinks(): Gist {
  return {
    id: "g1", userId: "u1", status: "ready", error: null, templateId: "quick-gist", focus: null, folderId: null, tags: [], favourite: false, model: "demo", createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z",
    source: { kind: "podcast", url: "https://example.com/ep", title: "Ep 1", author: "Show", publishedAt: null, thumbnailUrl: null, durationSeconds: 600, wordCount: 1000 },
    summary: { title: "T", tldr: "Short.", sections: [{ id: "s", heading: "Key points", format: "bullets", items: [{ text: "A point", timestamp: 30 }] }], quotes: [], suggestedTags: [] },
    savings: null,
  } as unknown as Gist;
}

describe("savings periods", () => {
  const now = new Date(2026, 10, 6, 15, 30); // Friday, November 6, 2026, 3:30 p.m. local
  const at = (m: number, d: number, hour: number, minutes: number, kind = "youtube", y = 2026): HourlySavings => ({
    date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, hour, kind, gists: 1, minutesSaved: minutes, moneySaved: minutes / 2,
  });
  const entries = [at(11, 6, 9, 30), at(11, 6, 14, 5), at(11, 3, 20, 60, "podcast"), at(10, 30, 8, 20), at(10, 27, 10, 15), at(10, 1, 12, 10), at(6, 1, 9, 5, "web", 2025)];

  it("starts weeks on Monday and months and years on the first", () => {
    expect(periodStart(now, "week").toDateString()).toBe(new Date(2026, 10, 2).toDateString());
    expect(periodStart(now, "month").getDate()).toBe(1);
    expect(periodStart(now, "year").getMonth()).toBe(0);
    expect(periodStart(now, "hour").getHours()).toBe(15);
  });

  it("splits a day into hours, a week or month into days and a year into months", () => {
    const day = periodSlots(entries, "day", now);
    expect(day).toHaveLength(24);
    expect(day[9].minutesSaved).toBe(30);
    expect(day[14].minutesSaved).toBe(5);
    expect(day[15].current).toBe(true);
    expect(day[16].future).toBe(true);
    const week = periodSlots(entries, "week", now);
    expect(week.map((s) => s.start.getDate())).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(week[1].minutesSaved).toBe(60);
    expect(week[4]).toMatchObject({ minutesSaved: 35, gists: 2, current: true });
    expect(periodSlots(entries, "month", now)).toHaveLength(30);
    expect(periodSlots(entries, "month", now, -1)).toHaveLength(31);
    const year = periodSlots(entries, "year", now);
    expect(year).toHaveLength(12);
    expect(year[9].minutesSaved).toBe(45);
    expect(year[10].minutesSaved).toBe(95);
  });

  it("steps back to earlier periods", () => {
    const { start, end } = periodRange("week", now, -1);
    expect(start.toDateString()).toBe(new Date(2026, 9, 26).toDateString());
    expect(sumRange(entries, start, end).minutesSaved).toBe(35);
    expect(periodRange("year", now, -1).start.getFullYear()).toBe(2025);
  });

  it("projects the rest of the period from the last 28 days", () => {
    const pace = recentPace(entries, now);
    expect(pace.minutesPerDay).toBeCloseTo(130 / 28);
    const { end } = periodRange("week", now);
    expect(paceUntil(pace, end, now).minutesSaved).toBeCloseTo((130 / 28) * 2.3542, 1);
  });

  it("compares with the period before, at the same point while it is still running", () => {
    // This week to Friday 3:30 p.m.: 95. Last week to Friday 3:30 p.m.: 15 + 20.
    expect(changeFromPrevious(entries, "week", now)).toBe(171);
    // Last week in full (35) against the week before (nothing).
    expect(changeFromPrevious(entries, "week", now, -1)).toBeNull();
    expect(changeFromPrevious(entries, "day", now)).toBeNull();
  });

  it("works out each plan's payback from the recent pace, counting only the gists it includes", () => {
    // 28 gists in 28 days, $280 of time: about 30 a month worth $304.
    const small = planPayback({ gists: 28, minutesPerDay: 20, moneyPerDay: 10 });
    expect(small.plans[0]).toMatchObject({ name: "Pro", overLimit: false });
    expect(small.plans[0].times).toBeCloseTo(30.4);
    expect(small.plans[1].times).toBeCloseTo(15.2);
    // About 1,520 gists a month: Pro counts 200 of them, Pro+ 1,000.
    const big = planPayback({ gists: 1400, minutesPerDay: 500, moneyPerDay: 250 });
    expect(big.plans[0].overLimit).toBe(true);
    expect(big.plans[0].value).toBeCloseTo((250 * 30.4 * 200) / (1400 / 28 * 30.4));
    expect(big.plans[1].value).toBeCloseTo((250 * 30.4 * 1000) / (1400 / 28 * 30.4));
  });
});
