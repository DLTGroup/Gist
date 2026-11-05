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
