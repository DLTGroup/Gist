import { describe, expect, it } from "vitest";
import { answerMatches, buildQuiz, clozeCard, newMemoryState, previewIntervals, reviewCalendar, reviewCard, type IngestedSource } from "@gist/core";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { DemoSummarizer } from "../src/summarize.ts";
import { streak } from "../src/memory.ts";

const para = "Composting turns kitchen scraps into rich soil for the garden. Balance green material like vegetable peels with brown material like dry leaves. Turn the pile every week so oxygen reaches the microbes doing the work. Keep the pile about as damp as a wrung-out sponge. A hot pile reaches 60 degrees Celsius within three days. ";
const src = (): IngestedSource => ({
  kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Composting basics", author: "Soil School", publishedAt: null, thumbnailUrl: null,
  durationSeconds: 1200, text: para.repeat(12), segments: para.repeat(12).split(". ").map((t, i) => ({ start: i * 10, text: t + "." })),
});

function setup() {
  const db = openDb(":memory:");
  const app = createApp({ db, summarizer: new DemoSummarizer(), ingestFn: async () => src() });
  const as = (token: string) => async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, json: type.includes("json") ? await res.json() : null, text: type.includes("json") ? null : await res.text(), type };
  };
  const signup = async (email: string, name?: string) => {
    const r = await as("")("POST", "/api/auth/signup", { email, password: "correct horse", name });
    return as(r.json.token);
  };
  return { db, signup, anon: as("") };
}

describe("FSRS scheduling (core)", () => {
  it("pushes intervals out on success and pulls them in on a lapse", () => {
    const t0 = new Date("2026-01-01T09:00:00Z");
    let m = newMemoryState(t0);
    expect(m.state).toBe("new");
    m = reviewCard(m, 3, t0); // Good on a new card: short learning step
    expect(m.state).toBe("learning");
    let t = new Date(m.due);
    m = reviewCard(m, 3, t);
    expect(m.state).toBe("review");
    const first = m.scheduledDays;
    t = new Date(m.due);
    m = reviewCard(m, 3, t);
    expect(m.scheduledDays).toBeGreaterThan(first * 2);
    const beforeLapse = m.stability;
    t = new Date(m.due);
    m = reviewCard(m, 1, t);
    expect(m.state).toBe("relearning");
    expect(m.lapses).toBe(1);
    expect(m.stability).toBeLessThan(beforeLapse);
  });

  it("previews four intervals in increasing order and honours the retention target", () => {
    const t0 = new Date("2026-01-01T09:00:00Z");
    let m = reviewCard(newMemoryState(t0), 3, t0);
    m = reviewCard(m, 3, new Date(m.due));
    const at = new Date(m.due);
    const p = previewIntervals(m, at);
    const ms = [1, 2, 3, 4].map((r) => Date.parse(p[r as 1].due));
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
    expect(p[1].label).toMatch(/min/);
    const strict = Date.parse(previewIntervals(m, at, 0.97)[3].due);
    const loose = Date.parse(previewIntervals(m, at, 0.8)[3].due);
    expect(strict).toBeLessThan(loose);
  });

  it("makes a cloze card from the most specific word, preferring numbers", () => {
    const c = clozeCard("A hot pile reaches 60 degrees Celsius within three days.");
    expect(c.kind).toBe("cloze");
    expect(c.back).toBe("60");
    expect(c.front).toBe("A hot pile reaches [...] degrees Celsius within three days.");
    expect(clozeCard("Screens delay melatonin release.Sleep matters.").back).not.toContain(".");
    expect(clozeCard("Inflation ran at 3.5% in 2024.").back).toBe("3.5%");
  });

  it("builds multiple-choice questions with distinct distractors and matches typed answers leniently", () => {
    const cards = ["Paris", "Ottawa", "Rome", "Lima", "Oslo"].map((b, i) => ({ id: String(i), front: `Capital ${i}?`, back: b, source: null }));
    const q = buildQuiz(cards, cards, 5, () => 0.42);
    expect(q).toHaveLength(5);
    for (const x of q) {
      expect(new Set(x.choices).size).toBe(x.choices.length);
      expect(x.choices[x.answerIndex]).toBe(cards.find((c) => c.id === x.cardId)!.back);
    }
    expect(answerMatches(" the  Ottawa! ", "Ottawa")).toBe(true);
    expect(answerMatches("Toronto", "Ottawa")).toBe(false);
  });

  it("writes a daily calendar reminder", () => {
    const ics = reviewCalendar({ appUrl: "https://gist.example.ca/app/review", hour: 8, timeZone: "America/Toronto", dueCount: 3, uid: "abc", now: new Date("2026-11-05T12:00:00Z") });
    expect(ics).toContain("DTSTART;TZID=America/Toronto:20261105T080000");
    expect(ics).toContain("RRULE:FREQ=DAILY");
    expect(ics).toContain("SUMMARY:Gist review: 3 cards due");
    expect(ics.split("\r\n").length).toBeGreaterThan(10);
  });

  it("counts a review streak ending today or yesterday", () => {
    const at = new Date("2026-11-05T15:00:00Z");
    expect(streak(["2026-11-05", "2026-11-04", "2026-11-03", "2026-11-01"], at)).toBe(3);
    expect(streak(["2026-11-04", "2026-11-03"], at)).toBe(2);
    expect(streak(["2026-11-02"], at)).toBe(0);
  });
});

describe("memory API", () => {
  it("stars takeaways into cards, reviews them and keeps the schedule per person", async () => {
    const { signup } = setup();
    const a = await signup("ana@example.ca", "Ana");
    const g = (await a("POST", "/api/gists?wait=1", { url: "https://youtu.be/dQw4w9WgXcQ", templateId: "takeaways-actions" })).json.gist;
    // Two takeaways with different text, wherever they sit in the summary.
    const picks: { sectionId: string; itemIndex: number; text: string }[] = [];
    for (const s of g.summary.sections) s.items.forEach((it: { text: string }, i: number) => { if (!picks.some((p) => p.text === it.text)) picks.push({ sectionId: s.id, itemIndex: i, text: it.text }); });
    expect(picks.length).toBeGreaterThanOrEqual(2);
    const sec = { id: picks[0].sectionId, items: [{ text: picks[0].text }] };
    const made = await a("POST", `/api/gists/${g.id}/cards`, { items: picks.slice(0, 2).map(({ sectionId, itemIndex }) => ({ sectionId, itemIndex })) });
    expect(made.status).toBe(201);
    expect(made.json.cards).toHaveLength(2);
    const card = made.json.cards[0];
    expect(card.source.text).toBe(sec.items[0].text);
    expect(card.source.gistTitle).toBeTruthy();
    expect(card.front).toContain("[...]");
    expect(card.memory.state).toBe("new");
    // Starring the same takeaway again doesn't duplicate it.
    const again = await a("POST", `/api/gists/${g.id}/cards`, { items: [{ sectionId: picks[0].sectionId, itemIndex: picks[0].itemIndex }] });
    expect(again.json.cards).toHaveLength(0);
    expect(again.json.skipped).toBe(1);
    expect((await a("GET", `/api/gists/${g.id}/cards`)).json.cards).toHaveLength(2);

    const decks = (await a("GET", "/api/decks")).json.decks;
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ name: "My memory", role: "owner", cardCount: 2, newCount: 2, dueCount: 0 });

    const q = (await a("GET", "/api/review/queue")).json;
    expect(q.cards).toHaveLength(2);
    expect(q.newCount).toBe(2);
    expect(q.cards[0].intervals[3].label).toBeTruthy();
    const rated = await a("POST", `/api/review/${card.id}`, { rating: 3, durationMs: 4200 });
    expect(rated.status).toBe(200);
    expect(rated.json.card.memory.state).toBe("learning");
    expect((await a("POST", `/api/review/${card.id}`, { rating: 7 })).status).toBe(400);

    const sum = (await a("GET", "/api/memory/summary")).json;
    expect(sum.totalCards).toBe(2);
    expect(sum.reviewedToday).toBe(1);
    expect(sum.streakDays).toBe(1);
    expect(sum.forecast).toHaveLength(7);

    // New-card allowance applies per day.
    await a("PATCH", "/api/memory/settings", { newCardsPerDay: 1 });
    const q2 = (await a("GET", "/api/review/queue")).json;
    expect(q2.newCount).toBe(0);
    expect((await a("PATCH", "/api/memory/settings", { desiredRetention: 0.5 })).status).toBe(400);
    expect((await a("PATCH", "/api/memory/settings", { timeZone: "Mars/Olympus" })).status).toBe(400);
  });

  it("makes a card for every takeaway with all:true, and edits, suspends and deletes cards", async () => {
    const { signup } = setup();
    const a = await signup("ben@example.ca");
    const g = (await a("POST", "/api/gists?wait=1", { url: "https://youtu.be/dQw4w9WgXcQ", templateId: "study-notes" })).json.gist;
    const expected = g.summary.sections.reduce((n: number, s: { items: unknown[]; paragraph: string | null }) => n + (s.items.length || (s.paragraph ? 1 : 0)), 0);
    const all = await a("POST", `/api/gists/${g.id}/cards`, { all: true });
    expect(all.json.cards.length).toBeGreaterThan(0);
    expect(all.json.cards.length + all.json.skipped).toBe(expected);
    const id = all.json.cards[0].id;
    const ed = await a("PATCH", `/api/cards/${id}`, { front: "What does a hot pile reach?", back: "60 °C", suspended: true });
    expect(ed.json.card).toMatchObject({ front: "What does a hot pile reach?", back: "60 °C", suspended: true });
    const queue = (await a("GET", "/api/review/queue")).json.cards.map((c: { id: string }) => c.id);
    expect(queue).not.toContain(id);
    expect((await a("DELETE", `/api/cards/${id}`)).status).toBe(200);
    expect((await a("PATCH", `/api/cards/${id}`, { front: "x" })).status).toBe(404);
  });

  it("shares a deck: a public preview, joining with a separate schedule, and editor rights", async () => {
    const { signup, anon } = setup();
    const owner = await signup("owner@example.ca", "Olive");
    const deck = (await owner("POST", "/api/decks", { name: "Garden <science>", description: "Soil basics" })).json.deck;
    const c1 = (await owner("POST", `/api/decks/${deck.id}/cards`, { front: "Ideal pile moisture?", back: "A wrung-out sponge" })).json.card;
    await owner("POST", `/api/decks/${deck.id}/cards`, { front: "Hot pile temperature?", back: "60 °C" });
    const shareUrl = (await owner("POST", `/api/decks/${deck.id}/share`)).json.shareUrl as string;
    const token = shareUrl.split("/d/")[1];

    const pub = await anon("GET", `/d/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.text).toContain("Garden &lt;science&gt;");
    expect(pub.text).toContain("Ideal pile moisture?");
    expect(pub.text).toContain(`/app/join/${token}`);

    const friend = await signup("friend@example.ca", "Fern");
    expect((await friend("GET", `/api/decks/${deck.id}`)).status).toBe(404);
    expect((await friend("GET", `/api/decks/join/${token}`)).json).toMatchObject({ member: false, deck: { name: "Garden <science>", cardCount: 2 } });
    const joined = await friend("POST", `/api/decks/join/${token}`);
    expect(joined.json.deck).toMatchObject({ role: "viewer", cardCount: 2, newCount: 2 });

    // Each member reviews on their own schedule.
    await owner("POST", `/api/review/${c1.id}`, { rating: 4 });
    const mine = (await owner("GET", `/api/decks/${deck.id}`)).json.cards.find((c: { id: string }) => c.id === c1.id);
    const theirs = (await friend("GET", `/api/decks/${deck.id}`)).json.cards.find((c: { id: string }) => c.id === c1.id);
    expect(mine.memory.state).not.toBe("new");
    expect(theirs.memory.state).toBe("new");

    // Viewers can study but not edit; the owner can promote them.
    expect((await friend("POST", `/api/decks/${deck.id}/cards`, { front: "Q", back: "A" })).status).toBe(403);
    const friendId = (await friend("GET", "/api/me")).json.user.id;
    expect((await friend("PATCH", `/api/decks/${deck.id}/members/${friendId}`, { role: "editor" })).status).toBe(403);
    expect((await owner("PATCH", `/api/decks/${deck.id}/members/${friendId}`, { role: "editor" })).status).toBe(200);
    expect((await friend("POST", `/api/decks/${deck.id}/cards`, { front: "Green or brown: dry leaves?", back: "Brown" })).status).toBe(201);
    const detail = (await owner("GET", `/api/decks/${deck.id}`)).json;
    expect(detail.cards).toHaveLength(3);
    expect(detail.members.map((m: { name: string; role: string; cardsAdded: number }) => [m.name, m.role, m.cardsAdded])).toEqual([["Olive", "owner", 2], ["Fern", "editor", 1]]);

    // Leaving keeps the deck for everyone else; turning sharing off kills the link.
    expect((await friend("DELETE", `/api/decks/${deck.id}`)).json.left).toBe(true);
    expect((await owner("GET", `/api/decks/${deck.id}`)).json.cards).toHaveLength(3);
    await owner("DELETE", `/api/decks/${deck.id}/share`);
    expect((await anon("GET", `/d/${token}`)).status).toBe(404);
  });

  it("quizzes with multiple choice, counting an answer as a review only when the card is due", async () => {
    const { signup, db } = setup();
    const a = await signup("quiz@example.ca");
    const deck = (await a("POST", "/api/decks", { name: "Capitals" })).json.deck;
    const ids: string[] = [];
    for (const [f, b] of [["Canada?", "Ottawa"], ["Peru?", "Lima"], ["Norway?", "Oslo"], ["Italy?", "Rome"]]) ids.push((await a("POST", `/api/decks/${deck.id}/cards`, { front: f, back: b })).json.card.id);
    const quiz = (await a("GET", `/api/quiz?deck=${deck.id}&count=4`)).json.questions;
    expect(quiz).toHaveLength(4);
    expect(quiz[0].choices).toHaveLength(4);

    const practice = await a("POST", `/api/quiz/${ids[0]}`, { correct: true });
    expect(practice.json.counted).toBe(false);
    // Make card 2 due, then a quiz answer counts as its review.
    await a("POST", `/api/review/${ids[1]}`, { rating: 3 });
    db.prepare("UPDATE card_states SET due = ? WHERE card_id = ?").run("2000-01-01T00:00:00.000Z", ids[1]);
    const st = JSON.parse((db.prepare("SELECT state_json FROM card_states WHERE card_id = ?").get(ids[1]) as { state_json: string }).state_json);
    db.prepare("UPDATE card_states SET state_json = ? WHERE card_id = ?").run(JSON.stringify({ ...st, due: "2000-01-01T00:00:00.000Z" }), ids[1]);
    const counted = await a("POST", `/api/quiz/${ids[1]}`, { correct: false });
    expect(counted.json.counted).toBe(true);
    expect(counted.json.card.memory.lapses + (counted.json.card.memory.state === "learning" ? 1 : 0)).toBeGreaterThan(0);
  });

  it("serves a private calendar feed for reminders, and isolates users", async () => {
    const { signup, anon } = setup();
    const a = await signup("cal@example.ca");
    const on = (await a("POST", "/api/memory/calendar")).json.calendarUrl as string;
    expect(on).toMatch(/\/cal\/[\w-]{20,}\.ics$/);
    await a("PATCH", "/api/memory/settings", { reminderHour: 7, timeZone: "America/Vancouver" });
    const feed = await anon("GET", new URL(on).pathname);
    expect(feed.status).toBe(200);
    expect(feed.type).toContain("text/calendar");
    expect(feed.text).toContain("DTSTART;TZID=America/Vancouver:");
    expect(feed.text).toContain("T070000");
    await a("DELETE", "/api/memory/calendar");
    expect((await anon("GET", new URL(on).pathname)).status).toBe(404);

    const b = await signup("other@example.ca");
    const deck = (await a("POST", "/api/decks", { name: "Private" })).json.deck;
    const card = (await a("POST", `/api/decks/${deck.id}/cards`, { front: "Q", back: "A" })).json.card;
    expect((await b("GET", `/api/decks/${deck.id}`)).status).toBe(404);
    expect((await b("POST", `/api/review/${card.id}`, { rating: 3 })).status).toBe(404);
    expect((await b("DELETE", `/api/cards/${card.id}`)).status).toBe(404);
    expect((await b("GET", "/api/review/queue")).json.cards).toHaveLength(0);
  });
});
