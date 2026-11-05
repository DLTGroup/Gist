import type { IngestedSource } from "@gist/core";
import { countWords, detectSourceKind, youtubeLinks, youtubeVideoId } from "@gist/core";
import { IngestError } from "./http.ts";
import { NoTranscriptError, fetchYouTube, youtubeOEmbed } from "./youtube.ts";
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
  if (kind === "youtube") return ingestYouTube(url, youtubeMode());
  if (kind === "podcast") return fetchPodcast(url);
  if (kind === "web") return fetchWebArticle(url);
  throw new IngestError("That doesn't look like a link. Paste a YouTube, podcast or article URL.");
}

/**
 * How YouTube links are handled (server setting GIST_YOUTUBE_MODE):
 * - transcript-first (default): read the captions; if there are none or YouTube blocks the
 *   request, have a video-capable model watch the video instead.
 * - video-first: always have the video model watch the video (sees slides and demos; costs more).
 * - transcript-only: captions or nothing. This is the mode whenever no video model is configured.
 */
export type YouTubeMode = "transcript-first" | "video-first" | "transcript-only";

export function videoSummariesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.GEMINI_API_KEY && env.GIST_VIDEO_MODEL !== "off";
}

export function youtubeMode(env: NodeJS.ProcessEnv = process.env): YouTubeMode {
  if (!videoSummariesEnabled(env)) return "transcript-only";
  const m = env.GIST_YOUTUBE_MODE;
  return m === "video-first" || m === "transcript-only" ? m : "transcript-first";
}

export async function ingestYouTube(url: string, mode: YouTubeMode, fetchFn = fetchYouTube, oembedFn = youtubeOEmbed): Promise<IngestedSource> {
  if (mode === "transcript-only") return fetchFn(url);
  try {
    const s = await fetchFn(url);
    return mode === "video-first" ? { ...s, video: { url: s.url! } } : s;
  } catch (e) {
    if (!(e instanceof IngestError)) throw e;
    if (e instanceof NoTranscriptError) return { ...e.meta, video: { url: e.meta.url! } };
    // The watch page couldn't be read (often YouTube blocking cloud servers). oEmbed still names
    // public videos; private or removed ones fail here too, and the original error stands.
    const id = youtubeVideoId(url);
    if (!id) throw e;
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const o = await oembedFn(watch);
    if (!o.title) throw e;
    return { kind: "youtube", url: watch, title: o.title, author: o.author, publishedAt: null, thumbnailUrl: o.thumbnailUrl, durationSeconds: null, text: "", links: youtubeLinks(watch), video: { url: watch } };
  }
}
