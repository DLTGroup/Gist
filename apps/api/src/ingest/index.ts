import type { IngestedSource } from "@gist/core";
import { countWords, detectSourceKind } from "@gist/core";
import { IngestError } from "./http.ts";
import { fetchYouTube } from "./youtube.ts";
import { fetchPodcast } from "./podcast.ts";
import { fetchWebArticle } from "./web.ts";

export { IngestError };

export interface IngestInput {
  url?: string | null;
  /** Pasted text (notes, a transcript, an article) instead of a link. */
  text?: string | null;
  title?: string | null;
}

export async function ingest(input: IngestInput): Promise<IngestedSource> {
  if (input.text?.trim()) {
    const text = input.text.trim();
    if (countWords(text) < 40) throw new IngestError("Paste at least a paragraph or two so there's something to summarize.");
    return {
      kind: "text",
      url: null,
      title: input.title?.trim() || text.split(/\n/)[0].slice(0, 80),
      author: null,
      publishedAt: null,
      thumbnailUrl: null,
      durationSeconds: null,
      text,
    };
  }
  const url = input.url?.trim();
  if (!url) throw new IngestError("Paste a link or some text.");
  const kind = detectSourceKind(url);
  if (kind === "youtube") return fetchYouTube(url);
  if (kind === "podcast") return fetchPodcast(url);
  if (kind === "web") return fetchWebArticle(url);
  throw new IngestError("That doesn't look like a link. Paste a YouTube, podcast or article URL.");
}
