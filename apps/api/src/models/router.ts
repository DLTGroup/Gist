import type { ExtractionTemplate, IngestedSource } from "@gist/core";
import { AnthropicSummarizer, DemoSummarizer, SummarizeError, type Summarizer, type SummaryResult } from "../summarize.ts";
import { OpenAICompatibleSummarizer } from "./openaiCompatible.ts";
import { GeminiVideoSummarizer } from "./geminiVideo.ts";
import { videoSummariesEnabled } from "../ingest/index.ts";

/** Default video model for YouTube links Gemini watches directly. Override with GIST_VIDEO_MODEL. */
export const DEFAULT_VIDEO_MODEL = "gemini-3.8-flash";

/**
 * Model routing. Which model writes gists is a server setting, never a user choice:
 *
 *   GIST_MODELS="anthropic/<model-id>, openai/<model-id>"
 *
 * The first entry does the work; each later entry takes over if the one before it fails
 * (rate limit, outage, malformed reply). Swap or reorder entries in the host's settings and
 * restart: no code change. Each provider reads its own API key from the environment.
 */
export interface ProviderPreset {
  /** Env var holding the API key. */
  keyEnv: string;
  /** OpenAI-compatible base URL; absent for providers with their own SDK. */
  baseUrl?: string;
}

export const PROVIDERS: Record<string, ProviderPreset> = {
  anthropic: { keyEnv: "ANTHROPIC_API_KEY" },
  openai: { keyEnv: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1" },
  google: { keyEnv: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  openrouter: { keyEnv: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1" },
  groq: { keyEnv: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1" },
  deepseek: { keyEnv: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/v1" },
  mistral: { keyEnv: "MISTRAL_API_KEY", baseUrl: "https://api.mistral.ai/v1" },
  together: { keyEnv: "TOGETHER_API_KEY", baseUrl: "https://api.together.xyz/v1" },
  // Any other OpenAI-compatible endpoint (self-hosted vLLM, Ollama, a new provider): set both.
  custom: { keyEnv: "GIST_CUSTOM_API_KEY", baseUrl: "" },
};

export interface ModelSpec {
  provider: string;
  model: string;
}

/** Parses "provider/model" entries. A bare model name means Anthropic, for older configs. */
export function parseModelList(value: string): ModelSpec[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const slash = entry.indexOf("/");
      if (slash < 0) return { provider: "anthropic", model: entry };
      return { provider: entry.slice(0, slash).toLowerCase(), model: entry.slice(slash + 1) };
    });
}

export function buildSummarizer(spec: ModelSpec, env: NodeJS.ProcessEnv = process.env, fetchFn: typeof fetch = fetch): Summarizer {
  const preset = PROVIDERS[spec.provider];
  if (!preset) throw new Error(`Unknown model provider "${spec.provider}". Known: ${Object.keys(PROVIDERS).join(", ")}.`);
  const key = env[preset.keyEnv] || null;
  if (spec.provider === "anthropic") {
    if (!key && !env.ANTHROPIC_AUTH_TOKEN) throw new Error("ANTHROPIC_API_KEY is not set.");
    return new AnthropicSummarizer(spec.model, undefined, key ?? undefined);
  }
  const baseUrl = spec.provider === "custom" ? env.GIST_CUSTOM_BASE_URL : preset.baseUrl;
  if (!baseUrl) throw new Error("GIST_CUSTOM_BASE_URL is not set.");
  if (!key && spec.provider !== "custom") throw new Error(`${preset.keyEnv} is not set.`);
  return new OpenAICompatibleSummarizer(spec.provider, spec.model, baseUrl, key, fetchFn);
}

/** Tries each model in order until one succeeds. */
export class ModelRouter implements Summarizer {
  readonly model: string;
  constructor(
    private chain: Summarizer[],
    private log: (msg: string) => void = (m) => console.warn(m),
  ) {
    if (!chain.length) throw new Error("ModelRouter needs at least one model.");
    this.model = chain.map((s) => s.model).join(" → ");
  }

  async summarize(src: IngestedSource, template: ExtractionTemplate, focus?: string | null): Promise<SummaryResult> {
    let first: unknown = null;
    for (const [i, s] of this.chain.entries()) {
      try {
        return await s.summarize(src, template, focus);
      } catch (e) {
        first ??= e;
        const next = this.chain[i + 1];
        this.log(`[models] ${s.model} failed (${e instanceof SummarizeError ? `${e.status} ${e.message}` : (e as Error).message})${next ? `; trying ${next.model}` : ""}`);
      }
    }
    // Every model failed: report the primary model's error, which is the most meaningful one.
    if (first instanceof SummarizeError) throw first;
    throw new SummarizeError("The summarizer had a problem. Please try again.");
  }
}

/** Sends sources that need the video watched to the video model, and everything else to the text chain. */
export class MediaRouter implements Summarizer {
  readonly model: string;
  constructor(
    private text: Summarizer,
    private video: Summarizer,
  ) {
    // The text chain's id decides demo mode; the video model is an add-on.
    this.model = text.model;
  }
  summarize(src: IngestedSource, template: ExtractionTemplate, focus?: string | null): Promise<SummaryResult> {
    return src.video ? this.video.summarize(src, template, focus) : this.text.summarize(src, template, focus);
  }
}

/**
 * Reads GIST_MODELS (or the older GIST_MODEL) and builds the chain. Entries whose key is missing
 * are skipped with a warning. With nothing usable, or GIST_SUMMARIZER=demo, the demo extractor runs.
 */
export function createSummarizer(env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = (m) => console.warn(m)): Summarizer {
  if (env.GIST_SUMMARIZER === "demo") return new DemoSummarizer();
  const text = createTextSummarizer(env, log);
  if (!videoSummariesEnabled(env)) return text;
  return new MediaRouter(text, new GeminiVideoSummarizer((env.GIST_VIDEO_MODEL || DEFAULT_VIDEO_MODEL).replace(/^google\//, ""), env.GEMINI_API_KEY!));
}

function createTextSummarizer(env: NodeJS.ProcessEnv, log: (m: string) => void): Summarizer {
  const fallbackDefault = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? "anthropic/claude-opus-5-5" : env.GEMINI_API_KEY ? `google/${DEFAULT_VIDEO_MODEL}` : "";
  const configured = env.GIST_MODELS || env.GIST_MODEL || fallbackDefault;
  const chain: Summarizer[] = [];
  for (const spec of parseModelList(configured)) {
    try {
      chain.push(buildSummarizer(spec, env));
    } catch (e) {
      log(`[models] skipping ${spec.provider}/${spec.model}: ${(e as Error).message}`);
    }
  }
  if (!chain.length) return new DemoSummarizer();
  return chain.length === 1 ? chain[0] : new ModelRouter(chain, log);
}
