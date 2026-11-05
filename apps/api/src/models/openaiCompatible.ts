import type { ExtractionTemplate, IngestedSource, Summary } from "@gist/core";
import { SUMMARY_JSON_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from "@gist/core";
import { SummarizeError, normalizeSummary, type Summarizer, type SummaryResult } from "../summarize.ts";

/**
 * Any provider that speaks the OpenAI Chat Completions format: OpenAI, Google Gemini (via its
 * OpenAI-compatible endpoint), OpenRouter, Groq, DeepSeek, Mistral, Together, or a self-hosted
 * server such as vLLM or Ollama. Asks for JSON-schema output first and falls back to plain JSON
 * mode for providers that don't support schemas.
 */
export class OpenAICompatibleSummarizer implements Summarizer {
  readonly model: string;
  private schemaMode = true;

  constructor(
    private provider: string,
    private modelName: string,
    private baseUrl: string,
    private apiKey: string | null,
    private fetchFn: typeof fetch = fetch,
    private timeoutMs = 180_000,
  ) {
    this.model = `${provider}/${modelName}`;
  }

  async summarize(src: IngestedSource, template: ExtractionTemplate, focus?: string | null): Promise<SummaryResult> {
    const started = Date.now();
    let res = await this.call(src, template, focus);
    if (res.status === 400 && this.schemaMode && /response_format|json_schema|schema/i.test(res.text)) {
      // This provider doesn't take JSON schemas; remember that and use JSON mode with the schema in the prompt.
      this.schemaMode = false;
      res = await this.call(src, template, focus);
    }
    if (res.status === 429) throw new SummarizeError("We're busy right now. Please try again in a minute.", 429);
    if (res.status === 401 || res.status === 403) throw new SummarizeError("The summarizer isn't configured correctly (API credentials).", 500);
    if (res.status >= 400) throw new SummarizeError(`The summarizer had a problem (${res.status}). Please try again.`, res.status >= 500 ? 502 : 422);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = JSON.parse(res.text);
    } catch {
      throw new SummarizeError("The summarizer sent an unreadable reply. Please try again.");
    }
    const choice = body.choices?.[0];
    if (choice?.finish_reason === "length") throw new SummarizeError("The summary ran too long. Try a shorter template.", 422);
    if (choice?.finish_reason === "content_filter" || choice?.message?.refusal) throw new SummarizeError("This content couldn't be summarized.", 422);
    const parsed = parseJsonReply(choice?.message?.content ?? "");
    if (!parsed) throw new SummarizeError("The summary came back malformed. Please try again.");
    return {
      summary: normalizeSummary(parsed, template),
      model: this.model,
      ms: Date.now() - started,
      usage: body.usage ? { input: body.usage.prompt_tokens ?? 0, output: body.usage.completion_tokens ?? 0 } : null,
    };
  }

  private async call(src: IngestedSource, template: ExtractionTemplate, focus?: string | null) {
    const system = this.schemaMode
      ? SYSTEM_PROMPT
      : `${SYSTEM_PROMPT}\n\nReply with a single JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(SUMMARY_JSON_SCHEMA)}`;
    const body = {
      model: this.modelName,
      messages: [
        { role: "system", content: system },
        { role: "user", content: buildUserPrompt(src, template, focus) },
      ],
      response_format: this.schemaMode
        ? { type: "json_schema", json_schema: { name: "gist_summary", schema: SUMMARY_JSON_SCHEMA, strict: true } }
        : { type: "json_object" },
    };
    try {
      const r = await this.fetchFn(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { status: r.status, text: await r.text() };
    } catch (e) {
      throw new SummarizeError(`Couldn't reach the summarizer (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message}).`, 502);
    }
  }
}

/** Reads a JSON object from a model reply, tolerating code fences or a sentence around it. */
export function parseJsonReply(text: string): Summary | null {
  const tryParse = (t: string) => {
    try {
      const v = JSON.parse(t);
      return v && typeof v === "object" && Array.isArray(v.sections) ? (v as Summary) : null;
    } catch {
      return null;
    }
  };
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const a = trimmed.indexOf("{"), b = trimmed.lastIndexOf("}");
  return a >= 0 && b > a ? tryParse(trimmed.slice(a, b + 1)) : null;
}
