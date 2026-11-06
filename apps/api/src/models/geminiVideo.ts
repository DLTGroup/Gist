import type { ExtractionTemplate, IngestedSource } from "@gist/core";
import { SUMMARY_JSON_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from "@gist/core";
import { SummarizeError, normalizeSummary, type Summarizer, type SummaryResult } from "../summarize.ts";
import { parseJsonReply } from "./openaiCompatible.ts";

/**
 * Summarizes a public YouTube video by having Gemini watch it directly (speech and visuals),
 * through the Gemini Interactions API. Used when a video has no captions, when YouTube blocks the
 * caption request, or for every video in video-first mode.
 *
 * Per Google's docs (checked 2026-11-05): YouTube input is in preview, public videos only, free
 * tier capped at 8 hours of video a day (no length cap on paid), about 100 tokens per second of
 * video at default resolution, and up to about 3 hours per video on 1M-context models.
 */
export class GeminiVideoSummarizer implements Summarizer {
  readonly model: string;
  private useSchema = true;

  constructor(
    private modelName: string,
    private apiKey: string,
    private fetchFn: typeof fetch = fetch,
    private baseUrl = "https://generativelanguage.googleapis.com/v1beta",
    private timeoutMs = 600_000,
  ) {
    this.model = `google/${modelName}`;
  }

  async summarize(src: IngestedSource, template: ExtractionTemplate, focus?: string | null): Promise<SummaryResult> {
    if (!src.video?.url) throw new SummarizeError("There's no video to watch for this source.", 422);
    const started = Date.now();
    let res = await this.call(src, template, focus);
    if (res.status === 400 && this.useSchema && /schema|response_format/i.test(res.text)) {
      this.useSchema = false; // fall back to asking for JSON in the prompt
      res = await this.call(src, template, focus);
    }
    if (res.status === 429) throw new SummarizeError("We're busy right now. Please try again in a minute.", 429);
    if (res.status === 401 || res.status === 403) throw new SummarizeError("The video summarizer isn't configured correctly (API credentials).", 500);
    if (res.status === 400 && /private|unlisted|not (?:available|accessible)|permission/i.test(res.text)) {
      throw new SummarizeError("That video can't be watched: it may be private, unlisted or age-restricted.", 422);
    }
    if (res.status >= 400) throw new SummarizeError(`The video summarizer had a problem (${res.status}). Please try again.`, res.status >= 500 ? 502 : 422);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = JSON.parse(res.text);
    } catch {
      throw new SummarizeError("The video summarizer sent an unreadable reply. Please try again.");
    }
    if (body.status === "incomplete") throw new SummarizeError("The summary ran past the length limit for one gist. Try a shorter template for this source.", 422);
    if (body.status === "failed" || body.status === "cancelled") throw new SummarizeError("The video couldn't be summarized. Please try again.", 502);
    const text = (body.steps ?? [])
      .filter((s: { type?: string }) => s.type === "model_output")
      .flatMap((s: { content?: { type?: string; text?: string }[] }) => (s.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? ""))
      .join("");
    const parsed = parseJsonReply(text);
    if (!parsed) throw new SummarizeError("The summary came back malformed. Please try again.");
    const u = body.usage ?? {};
    const mediaTokens = (u.input_tokens_by_modality ?? [])
      .filter((m: { modality?: string }) => /video|audio|image/i.test(m.modality ?? ""))
      .reduce((a: number, m: { tokens?: number }) => a + (m.tokens ?? 0), 0);
    return {
      summary: normalizeSummary(parsed, template),
      model: this.model,
      ms: Date.now() - started,
      usage: u.total_input_tokens != null ? { input: u.total_input_tokens, output: (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0) } : null,
      // Rough length from video tokens (about 100 per second at default resolution), used only when YouTube gave no length.
      estimatedDurationSeconds: mediaTokens > 0 ? Math.round(mediaTokens / 100) : null,
    };
  }

  private async call(src: IngestedSource, template: ExtractionTemplate, focus?: string | null) {
    const prompt = buildUserPrompt(
      { ...src, segments: undefined, text: "(No transcript is provided. Watch and listen to the attached video and summarize what is said and shown. For timestamps, use the number of seconds from the start of the video where each point is made.)" },
      template,
      focus,
    );
    const jsonRule = this.useSchema ? "" : `\n\nReply with a single JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(SUMMARY_JSON_SCHEMA)}`;
    const body: Record<string, unknown> = {
      model: this.modelName,
      store: false,
      input: [
        { type: "text", text: `${SYSTEM_PROMPT}${jsonRule}\n\n${prompt}` },
        { type: "video", uri: src.video!.url },
      ],
    };
    if (this.useSchema) body.response_format = { type: "text", mime_type: "application/json", schema: toGeminiSchema(SUMMARY_JSON_SCHEMA) };
    try {
      const r = await this.fetchFn(`${this.baseUrl}/interactions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { status: r.status, text: await r.text() };
    } catch (e) {
      throw new SummarizeError(`Couldn't reach the video summarizer (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message}).`, 502);
    }
  }
}

/** Rewrites `type: [X, "null"]` unions as anyOf, the form Google's schema docs show. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toGeminiSchema(node: any): any {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === "type" ? v : toGeminiSchema(v);
  if (Array.isArray(node.type)) {
    const { type, ...rest } = out as { type: string[] };
    return { ...rest, anyOf: type.map((t) => ({ type: t })) };
  }
  return out;
}
