import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionTemplate, IngestedSource, Summary, SummarySection } from "@gist/core";
import { SUMMARY_JSON_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from "@gist/core";

export interface SummaryResult {
  summary: Summary;
  /** "provider/model" that actually wrote it, stored on the gist (never shown to users). */
  model: string;
  ms: number;
  usage: { input: number; output: number } | null;
  /** Set by video models when the source's length wasn't known beforehand. */
  estimatedDurationSeconds?: number | null;
}

export interface Summarizer {
  /** Display id for logs, e.g. "anthropic/claude-opus-5-5" or "router(2)". */
  readonly model: string;
  summarize(src: IngestedSource, template: ExtractionTemplate, focus?: string | null): Promise<SummaryResult>;
}

export class SummarizeError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Anthropic provider: structured output, adaptive thinking and server-side refusal fallback. */
export class AnthropicSummarizer implements Summarizer {
  private client: Anthropic;
  readonly model: string;
  constructor(
    modelName: string,
    private effort: Effort = (process.env.GIST_EFFORT as Effort) || "medium",
    apiKey?: string,
  ) {
    this.model = `anthropic/${modelName}`;
    this.modelName = modelName;
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }
  private modelName: string;

  async summarize(src: IngestedSource, template: ExtractionTemplate, focus?: string | null): Promise<SummaryResult> {
    const started = Date.now();
    let message;
    try {
      const stream = this.client.beta.messages.stream({
        model: this.modelName,
        max_tokens: 32000,
        // Server-side fallback: if a safety classifier declines, the API re-runs the request on
        // Anthropic's recommended fallback model instead of returning a refusal.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: this.effort, format: { type: "json_schema", schema: SUMMARY_JSON_SCHEMA as unknown as Record<string, unknown> } },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildUserPrompt(src, template, focus) }],
      });
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new SummarizeError("We're busy right now. Please try again in a minute.", 429);
      if (err instanceof Anthropic.BadRequestError) throw new SummarizeError(`The summarizer rejected this request: ${err.message}`, 422);
      if (err instanceof Anthropic.AuthenticationError) throw new SummarizeError("The summarizer isn't configured correctly (API credentials).", 500);
      if (err instanceof Anthropic.APIError) throw new SummarizeError(`The summarizer had a problem (${err.status}). Please try again.`);
      throw err;
    }
    if (message.stop_reason === "refusal") throw new SummarizeError("This content couldn't be summarized.", 422);
    if (message.stop_reason === "max_tokens") throw new SummarizeError("The summary ran too long. Try a shorter template.", 422);
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let parsed: Summary;
    try {
      parsed = JSON.parse(text) as Summary;
    } catch {
      throw new SummarizeError("The summary came back malformed. Please try again.");
    }
    return { summary: normalizeSummary(parsed, template), model: this.model, ms: Date.now() - started, usage: { input: message.usage.input_tokens, output: message.usage.output_tokens } };
  }
}

/** Aligns model output to the template (section order, formats) and drops empty bits. */
export function normalizeSummary(raw: Summary, template: ExtractionTemplate): Summary {
  const byId = new Map(raw.sections.map((s) => [s.id, s]));
  const sections: SummarySection[] = template.sections.map((ts) => {
    const got = byId.get(ts.id);
    const items = (got?.items ?? [])
      .filter((i) => i.text?.trim())
      .map((i) => ({ text: i.text.trim(), timestamp: template.includeTimestamps && typeof i.timestamp === "number" && i.timestamp >= 0 ? Math.floor(i.timestamp) : null }));
    const paragraph = got?.paragraph?.trim() || null;
    return { id: ts.id, heading: ts.heading, format: ts.format, paragraph: ts.format === "paragraph" ? paragraph ?? (items.map((i) => i.text).join(" ") || null) : paragraph, items: ts.format === "paragraph" ? [] : items };
  });
  return {
    title: raw.title?.trim() || "Untitled gist",
    tldr: raw.tldr?.trim() || "",
    sections,
    suggestedTags: (raw.suggestedTags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean).slice(0, 5),
  };
}

/**
 * Demo summarizer used when no model is configured. It picks representative sentences by word
 * frequency so the full product flow can be tried locally. Output is clearly worse than a real
 * model's and is labelled as a demo in the UI.
 */
export class DemoSummarizer implements Summarizer {
  readonly model = "demo-extractive";

  async summarize(src: IngestedSource, template: ExtractionTemplate, focus?: string | null): Promise<SummaryResult> {
    return { summary: this.extract(src, template, focus), model: this.model, ms: 0, usage: null };
  }

  private extract(src: IngestedSource, template: ExtractionTemplate, focus?: string | null): Summary {
    const sentences = splitSentences(src.segments?.length ? src.segments.map((s) => s.text).join(" ") : src.text);
    const freq = new Map<string, number>();
    const words = (s: string) => s.toLowerCase().match(/[a-zÀ-ɏ']{4,}/g) ?? [];
    for (const s of sentences) for (const w of words(s)) if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    const focusWords = new Set(words(focus ?? "").filter((w) => !STOP.has(w)));
    const scored = sentences
      .map((s, i) => {
        const ws = words(s).filter((w) => !STOP.has(w));
        const base = ws.reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.max(4, ws.length);
        const boost = ws.some((w) => focusWords.has(w)) ? 2 : 1;
        return { s, i, score: base * boost };
      })
      .filter((x) => x.s.length > 40 && x.s.length < 320);
    const top = [...scored].sort((a, b) => b.score - a.score);
    const perSection = template.length === "brief" ? 4 : template.length === "standard" ? 4 : 6;
    const used = new Set<number>();
    const timeFor = (sentence: string) => {
      if (!src.segments?.length || !template.includeTimestamps) return null;
      const probe = sentence.slice(0, 30);
      const seg = src.segments.find((g) => g.text.includes(probe.slice(0, 15)));
      return seg ? Math.floor(seg.start) : null;
    };
    const sections: SummarySection[] = template.sections.map((ts) => {
      const picks = top.filter((x) => !used.has(x.i)).slice(0, perSection).sort((a, b) => a.i - b.i);
      picks.forEach((p) => used.add(p.i));
      if (ts.format === "paragraph") return { id: ts.id, heading: ts.heading, format: ts.format, paragraph: picks.slice(0, 2).map((p) => p.s).join(" ") || null, items: [] };
      return { id: ts.id, heading: ts.heading, format: ts.format, paragraph: null, items: picks.map((p) => ({ text: p.s, timestamp: timeFor(p.s) })) };
    });
    const tags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
    return {
      title: src.title,
      tldr: (top[0]?.s ?? sentences[0] ?? "").slice(0, 280),
      sections,
      suggestedTags: tags,
    };
  }
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"'“])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const STOP = new Set(
  "that this with have from they will would there their what about which when your just like into than then them been were also more some very could should these those because being here where while doing really going know think people things thing actually right yeah okay well want said says make made much many even only other over such each most both does didn't don't it's i'm you're that's".split(" "),
);


