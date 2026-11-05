import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATES, type IngestedSource } from "@gist/core";
import { IngestError } from "../src/ingest/http.ts";
import { ingestYouTube, youtubeMode } from "../src/ingest/index.ts";
import { NoTranscriptError } from "../src/ingest/youtube.ts";
import { GeminiVideoSummarizer, toGeminiSchema } from "../src/models/geminiVideo.ts";
import { MediaRouter, createSummarizer } from "../src/models/router.ts";
import { DemoSummarizer } from "../src/summarize.ts";

const template = BUILT_IN_TEMPLATES.find((t) => t.id === "takeaways-actions")!;
const watch = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const meta: IngestedSource = { kind: "youtube", url: watch, title: "Pricing talk", author: "Chan", publishedAt: null, thumbnailUrl: null, durationSeconds: 1800, text: "" };
const withCaptions: IngestedSource = { ...meta, text: "words ".repeat(300), segments: [{ start: 0, text: "hello" }] };
const oembed = async () => ({ title: "From oEmbed", author: "Chan", thumbnailUrl: null });

describe("YouTube handling modes", () => {
  it("only uses video when a Gemini key is set", () => {
    expect(youtubeMode({})).toBe("transcript-only");
    expect(youtubeMode({ GEMINI_API_KEY: "k" })).toBe("transcript-first");
    expect(youtubeMode({ GEMINI_API_KEY: "k", GIST_YOUTUBE_MODE: "video-first" })).toBe("video-first");
    expect(youtubeMode({ GEMINI_API_KEY: "k", GIST_VIDEO_MODEL: "off" })).toBe("transcript-only");
  });

  it("uses captions when there are some, and the video when there aren't", async () => {
    expect((await ingestYouTube(watch, "transcript-first", async () => withCaptions, oembed)).video).toBeUndefined();
    const noCaps = await ingestYouTube(watch, "transcript-first", async () => { throw new NoTranscriptError("none", meta); }, oembed);
    expect(noCaps.video).toEqual({ url: watch });
    expect(noCaps.durationSeconds).toBe(1800);
  });

  it("falls back to oEmbed details when YouTube blocks the page, and keeps errors for private videos", async () => {
    const blocked = await ingestYouTube(watch, "transcript-first", async () => { throw new IngestError("Couldn't fetch the link (403)."); }, oembed);
    expect(blocked).toMatchObject({ title: "From oEmbed", video: { url: watch }, durationSeconds: null });
    await expect(ingestYouTube(watch, "transcript-first", async () => { throw new IngestError("Private video"); }, async () => ({ title: null, author: null, thumbnailUrl: null }))).rejects.toThrow("Private video");
    await expect(ingestYouTube(watch, "transcript-only", async () => { throw new NoTranscriptError("none", meta); }, oembed)).rejects.toThrow("none");
  });

  it("sends every video to the video model in video-first mode", async () => {
    expect((await ingestYouTube(watch, "video-first", async () => withCaptions, oembed)).video).toEqual({ url: watch });
  });
});

describe("Gemini video summarizer", () => {
  const reply = {
    title: "Price on value",
    tldr: "Set prices from costs and value, not competitors.",
    sections: template.sections.map((s) => ({ id: s.id, heading: s.heading, paragraph: null, items: [{ text: `Point ${s.id}`, timestamp: 75 }] })),
    suggestedTags: ["pricing"],
  };

  it("sends the YouTube URL to the Interactions API and reads the reply", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        status: "completed",
        steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "text", text: JSON.stringify(reply) }] }],
        usage: { total_input_tokens: 180_500, total_output_tokens: 600, total_thought_tokens: 200, input_tokens_by_modality: [{ modality: "text", tokens: 500 }, { modality: "video", tokens: 150_000 }, { modality: "audio", tokens: 30_000 }] },
      }));
    }) as unknown as typeof fetch;
    const s = new GeminiVideoSummarizer("gemini-3.8-flash", "gk", fetchFn);
    const r = await s.summarize({ ...meta, durationSeconds: null, video: { url: watch } }, template);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gk");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe("gemini-3.8-flash");
    expect(body.input[1]).toEqual({ type: "video", uri: watch });
    expect(body.response_format.mime_type).toBe("application/json");
    expect(r.model).toBe("google/gemini-3.8-flash");
    expect(r.summary.title).toBe("Price on value");
    expect(r.summary.sections[0].items[0].timestamp).toBe(75);
    expect(r.usage).toEqual({ input: 180_500, output: 800 });
    expect(r.estimatedDurationSeconds).toBe(1800);
  });

  it("retries without a schema if the API rejects it, and explains private videos", async () => {
    let n = 0;
    const fetchFn = (async (_u: string, init: RequestInit) => {
      n++;
      const b = JSON.parse(String(init.body));
      if (b.response_format) return new Response('{"error":{"message":"Invalid response_format schema"}}', { status: 400 });
      return new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "```json\n" + JSON.stringify(reply) + "\n```" }] }] }));
    }) as unknown as typeof fetch;
    const s = new GeminiVideoSummarizer("m", "k", fetchFn);
    expect((await s.summarize({ ...meta, video: { url: watch } }, template)).summary.tldr).toMatch(/value/);
    expect(n).toBe(2);
    const priv = new GeminiVideoSummarizer("m", "k", (async () => new Response('{"error":{"message":"The video is private"}}', { status: 400 })) as unknown as typeof fetch);
    await expect(priv.summarize({ ...meta, video: { url: watch } }, template)).rejects.toMatchObject({ status: 422 });
  });

  it("rewrites nullable types for Google's schema format", () => {
    expect(toGeminiSchema({ type: "object", properties: { a: { type: ["string", "null"] } } })).toEqual({ type: "object", properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] } } });
  });
});

describe("routing video sources", () => {
  it("sends video sources to the video model and the rest to the text chain", async () => {
    const video = { model: "google/v", summarize: async () => ({ ...(await new DemoSummarizer().summarize(withCaptions, template)), model: "google/v" }) };
    const r = new MediaRouter(new DemoSummarizer(), video);
    expect((await r.summarize({ ...meta, video: { url: watch } }, template)).model).toBe("google/v");
    expect((await r.summarize(withCaptions, template)).model).toBe("demo-extractive");
  });

  it("uses Gemini for text too when it is the only key", () => {
    const s = createSummarizer({ GEMINI_API_KEY: "k" }, () => {});
    expect(s).toBeInstanceOf(MediaRouter);
    expect(s.model).toBe("google/gemini-3.8-flash");
  });
});
