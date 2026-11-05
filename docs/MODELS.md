# Summarization models

Which model writes gists is a **server setting**. Users never see or choose it, and the API does not expose it.

## Swap the model

Set `GIST_MODELS` in the host's environment (Render: *Environment* tab), then save. Render restarts the service automatically, with no code change and no redeploy of the code.

```
GIST_MODELS=anthropic/<model-id>
GIST_MODELS=openai/<model-id>, anthropic/<model-id>
GIST_MODELS=google/<model-id>, openrouter/<vendor>/<model-id>
```

The first entry writes every gist. If it fails (rate limit, outage, malformed reply, refusal), the next entry takes over for that gist, and so on. Each gist records which model wrote it, for later comparison. Entries whose API key is missing are skipped with a warning in the logs. With no usable entry, the server runs the demo extractor.

Replace `<model-id>` with the exact id from the provider's model list.

## Providers

| Prefix | API key variable | How it connects |
|---|---|---|
| `anthropic/` | `ANTHROPIC_API_KEY` | Anthropic SDK (structured output, adaptive thinking, `GIST_EFFORT`) |
| `openai/` | `OPENAI_API_KEY` | OpenAI Chat Completions |
| `google/` | `GEMINI_API_KEY` | Gemini's OpenAI-compatible endpoint |
| `openrouter/` | `OPENROUTER_API_KEY` | OpenRouter (hundreds of models behind one key) |
| `groq/` | `GROQ_API_KEY` | Groq, OpenAI-compatible |
| `deepseek/` | `DEEPSEEK_API_KEY` | DeepSeek, OpenAI-compatible |
| `mistral/` | `MISTRAL_API_KEY` | Mistral, OpenAI-compatible |
| `together/` | `TOGETHER_API_KEY` | Together, OpenAI-compatible |
| `custom/` | `GIST_CUSTOM_API_KEY` + `GIST_CUSTOM_BASE_URL` | Any other OpenAI-compatible server (self-hosted vLLM or Ollama, or a new provider) |

OpenAI-compatible providers are asked for JSON-schema output first. If a provider rejects that, Gist switches to plain JSON mode with the schema in the prompt. Every reply is checked and normalized to the template, so gists look the same whatever model wrote them.

The base URLs are built into `apps/api/src/models/router.ts`. They have been checked against the providers' docs from memory, not live. Run the comparison below once per new provider before relying on it.

## YouTube: transcript or the video itself

Gist reads a YouTube video's captions by default, because text is cheap. With a `GEMINI_API_KEY` set, Gemini can also **watch the video** through Google's Interactions API, and `GIST_YOUTUBE_MODE` chooses when:

| Mode | What happens |
|---|---|
| `transcript-first` (default) | Captions when the video has them. If it has none, or YouTube blocks the caption request from the server, Gemini watches the video instead. |
| `video-first` | Gemini watches every video. Summaries can use what's on screen (slides, code, demos), at a higher cost per video. |
| `transcript-only` | Never watch videos. This is automatic when there is no Gemini key. |

`GIST_VIDEO_MODEL` picks the Gemini model (default `gemini-3.8-flash`), or `off`.

Google's documentation (checked 5 November 2026) gives these limits:
- YouTube input is in **preview**, and works for **public videos only** (not private or unlisted).
- The free tier is capped at 8 hours of YouTube video a day; the paid tier has no length cap.
- A video costs about **100 tokens per second** at default resolution, so 30 minutes ≈ 180,000 input tokens.
- Videos up to about 3 hours are supported on 1M-context models.

Gemini 3.8 Flash was listed at US$0.75 per million input tokens and $3.75 per million output tokens through 31 December 2026, doubling from 1 January 2027. On those prices, watching a 30-minute video costs roughly US$0.14 at the 2026 price and $0.27 from 2027, against roughly a cent for the transcript. Check the [pricing page](https://ai.google.dev/gemini-api/docs/pricing) before relying on this.

Sources: [video understanding](https://ai.google.dev/gemini-api/docs/video-understanding), [models](https://ai.google.dev/gemini-api/docs/models), [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview).

## Pick the cheapest model that is good enough

```
npm run compare-models -w @gist/api -- \
  --models "anthropic/<model-a>, openai/<model-b>, google/<model-c>" \
  --url "https://www.youtube.com/watch?v=..." --url "https://example.ca/article" \
  --price "openai/<model-b>=0.25/2" --price "google/<model-c>=0.3/2.5"
```

The script runs the same sources through each model and prints a table of seconds, input tokens, output tokens and estimated cost. Prices are US dollars per million input and output tokens, taken from each provider's pricing page. The script also writes a Markdown file with every model's summary side by side, so you can judge quality. Use the same 5 to 10 representative sources each time a new model comes out, then update `GIST_MODELS`.

## Adding a provider that isn't OpenAI-compatible

Write a class implementing `Summarizer` (see `AnthropicSummarizer` in `apps/api/src/summarize.ts`) and add a branch for it in `buildSummarizer` in `apps/api/src/models/router.ts`.
