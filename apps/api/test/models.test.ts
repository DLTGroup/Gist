import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATES, type IngestedSource } from "@gist/core";
import { DemoSummarizer, SummarizeError, type Summarizer, type SummaryResult } from "../src/summarize.ts";
import { ModelRouter, createSummarizer, parseModelList } from "../src/models/router.ts";
import { OpenAICompatibleSummarizer, parseJsonReply } from "../src/models/openaiCompatible.ts";

const template = BUILT_IN_TEMPLATES.find((t) => t.id === "takeaways-actions")!;
const src: IngestedSource = { kind: "web", url: "https://example.ca/a", title: "Composting", author: null, publishedAt: null, thumbnailUrl: null, durationSeconds: null, text: "Compost needs greens and browns. Turn it weekly. Keep it damp." };
const reply = {
  title: "Compost basics",
  tldr: "Balance greens and browns, turn weekly, keep damp.",
  sections: template.sections.map((s) => ({ id: s.id, heading: s.heading, paragraph: null, items: [{ text: `Point for ${s.id}`, timestamp: null }] })),
  suggestedTags: ["Compost", "garden"],
};

describe("model configuration", () => {
  it("parses provider/model lists, with bare names meaning Anthropic", () => {
    expect(parseModelList("anthropic/model-a, openai/model-b\nopenrouter/vendor/model-c")).toEqual([
      { provider: "anthropic", model: "model-a" },
      { provider: "openai", model: "model-b" },
      { provider: "openrouter", model: "vendor/model-c" },
    ]);
    expect(parseModelList("model-a")).toEqual([{ provider: "anthropic", model: "model-a" }]);
  });

  it("builds the chain from the environment and skips models without a key", () => {
    const logs: string[] = [];
    const s = createSummarizer({ GIST_MODELS: "openai/gpt-x, groq/llama-y, google/gemini-z", OPENAI_API_KEY: "k1", GEMINI_API_KEY: "k3" }, (m) => logs.push(m));
    expect(s.model).toBe("openai/gpt-x → google/gemini-z");
    expect(logs[0]).toMatch(/skipping groq\/llama-y: GROQ_API_KEY is not set/);
  });

  it("falls back to the demo extractor when nothing is configured", () => {
    expect(createSummarizer({}).model).toBe("demo-extractive");
    expect(createSummarizer({ GIST_MODEL: "model-a" }, () => {}).model).toBe("demo-extractive");
    expect(createSummarizer({ GIST_SUMMARIZER: "demo", ANTHROPIC_API_KEY: "x" }).model).toBe("demo-extractive");
  });
});

describe("OpenAI-compatible provider", () => {
  it("asks for schema output, normalizes the reply and reports usage", async () => {
    const seen: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization ?? null });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }], usage: { prompt_tokens: 900, completion_tokens: 120 } }));
    }) as unknown as typeof fetch;
    const s = new OpenAICompatibleSummarizer("openai", "gpt-x", "https://api.example.com/v1/", "sk-1", fetchFn);
    const r = await s.summarize(src, template);
    expect(seen[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect(seen[0].auth).toBe("Bearer sk-1");
    expect((seen[0].body.response_format as { type: string }).type).toBe("json_schema");
    expect(r.model).toBe("openai/gpt-x");
    expect(r.usage).toEqual({ input: 900, output: 120 });
    expect(r.summary.sections.map((x) => x.id)).toEqual(template.sections.map((x) => x.id));
    expect(r.summary.suggestedTags).toEqual(["compost", "garden"]);
  });

  it("switches to JSON mode when a provider rejects schemas", async () => {
    const formats: string[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      formats.push(body.response_format.type);
      if (body.response_format.type === "json_schema") return new Response('{"error":{"message":"response_format json_schema is not supported"}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "Here you go:\n```json\n" + JSON.stringify(reply) + "\n```" } }] }));
    }) as unknown as typeof fetch;
    const s = new OpenAICompatibleSummarizer("custom", "local", "http://localhost:11434/v1", null, fetchFn);
    expect((await s.summarize(src, template)).summary.title).toBe("Compost basics");
    expect((await s.summarize(src, template)).summary.title).toBe("Compost basics");
    expect(formats).toEqual(["json_schema", "json_object", "json_object"]);
  });

  it("reads JSON wrapped in prose or fences", () => {
    expect(parseJsonReply('Sure! {"title":"x","sections":[]} Hope that helps')?.title).toBe("x");
    expect(parseJsonReply("not json")).toBeNull();
  });
});

describe("model router", () => {
  const failing = (model: string, err: Error): Summarizer => ({ model, summarize: async () => { throw err; } });
  const ok = (model: string): Summarizer => ({ model, summarize: async (): Promise<SummaryResult> => ({ ...(await new DemoSummarizer().summarize(src, template)), model }) });

  it("uses the next model when one fails and records which model wrote it", async () => {
    const logs: string[] = [];
    const r = new ModelRouter([failing("a/one", new SummarizeError("busy", 429)), ok("b/two")], (m) => logs.push(m));
    const out = await r.summarize(src, template);
    expect(out.model).toBe("b/two");
    expect(logs[0]).toMatch(/a\/one failed \(429 busy\); trying b\/two/);
  });

  it("reports the primary model's error when every model fails", async () => {
    const r = new ModelRouter([failing("a/one", new SummarizeError("This content couldn't be summarized.", 422)), failing("b/two", new Error("down"))], () => {});
    await expect(r.summarize(src, template)).rejects.toMatchObject({ status: 422 });
  });
});

describe("full extraction", () => {
  const full = BUILT_IN_TEMPLATES.find((t) => t.id === "full-extraction")!;
  it("the demo summarizer fills every section, writing None. where it runs out", async () => {
    const r = await new DemoSummarizer().summarize(src, full);
    expect(r.summary.sections).toHaveLength(19);
    for (const s of r.summary.sections) expect(s.paragraph || s.items.length).toBeTruthy();
    expect(r.summary.sections.some((s) => s.paragraph === "None.")).toBe(true);
  });
});
