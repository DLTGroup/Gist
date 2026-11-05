import type { SourceKind, SourceLink } from "./types.ts";

/** Brand constants in one place, so the name can be switched between "Gist" and "Briefly". */
export const BRAND = {
  name: "Gist",
  altName: "Briefly",
  tagline: "Get the point. Skip the hour.",
} as const;

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtube-nocookie.com"]);

const PODCAST_HOSTS = [
  "podcasts.apple.com",
  "open.spotify.com",
  "overcast.fm",
  "pca.st",
  "pocketcasts.com",
  "castbox.fm",
  "podcastaddict.com",
  "podbean.com",
  "buzzsprout.com",
  "anchor.fm",
  "podcasters.spotify.com",
  "simplecast.com",
  "libsyn.com",
  "transistor.fm",
  "captivate.fm",
  "megaphone.fm",
  "omny.fm",
];

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i;
const FEED_HINT = /(\/feed\/?$|\/rss\/?$|\.rss(\?|$)|\.xml(\?|$)|feeds\.|\/podcast\.xml)/i;

/** Extracts an 11-character YouTube video id from any common URL shape. */
export function youtubeVideoId(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(u.hostname)) return null;
  const valid = (id: string | null | undefined) => (id && /^[\w-]{11}$/.test(id) ? id : null);
  if (u.hostname === "youtu.be") return valid(u.pathname.slice(1).split("/")[0]);
  if (u.searchParams.get("v")) return valid(u.searchParams.get("v"));
  const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
  return valid(m?.[1]);
}

/** Classifies a pasted link (or raw text) into a source kind. */
export function detectSourceKind(input: string): SourceKind {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "text";
  if (youtubeVideoId(trimmed)) return "youtube";
  let host = "";
  try {
    host = new URL(trimmed).hostname.replace(/^www\./, "");
  } catch {
    return "text";
  }
  if (PODCAST_HOSTS.some((h) => host === h || host.endsWith("." + h))) return "podcast";
  const noHash = trimmed.split("#")[0];
  if (AUDIO_EXT.test(noHash) || FEED_HINT.test(noHash)) return "podcast";
  return "web";
}

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Deep link to a moment in the source, where the platform supports it (YouTube, or a podcast's audio file). */
export function timestampLink(kind: SourceKind, url: string | null, seconds: number, audioUrl?: string | null): string | null {
  if (kind === "youtube" && url) {
    const id = youtubeVideoId(url);
    return id ? `https://www.youtube.com/watch?v=${id}&t=${Math.floor(seconds)}s` : null;
  }
  if (kind === "podcast" && audioUrl) return `${audioUrl.split("#")[0]}#t=${Math.floor(seconds)}`;
  return null;
}

/**
 * Links shown under "Sources" on a gist: the original, its transcript and its audio where available.
 * Gists made before links were recorded fall back to the source URL.
 */
export function sourceLinks(source: { kind: SourceKind; url: string | null; links?: SourceLink[] }): SourceLink[] {
  if (source.links?.length) return source.links;
  if (!source.url) return [];
  const label = source.kind === "youtube" ? "Watch on YouTube" : source.kind === "podcast" ? "Episode page" : "Read the original";
  return [{ kind: "original", label, url: source.url }];
}

/** Links for a YouTube video. YouTube has no standalone transcript page, so the transcript link says where to find it. */
export function youtubeLinks(watchUrl: string): SourceLink[] {
  return [
    { kind: "original", label: "Watch on YouTube", url: watchUrl },
    { kind: "transcript", label: "Transcript on YouTube", url: watchUrl, note: "Under the video, open the description and choose Show transcript." },
  ];
}

export type CollectionKind = "youtube-playlist" | "spotify-playlist" | "spotify-show" | "podcast-feed" | "apple-show";

/**
 * Recognizes links that point at many items (a playlist, a show or a feed) rather than one.
 * `ambiguous` is true for a single video opened inside a playlist (watch?v=…&list=…).
 */
export function detectCollection(input: string): { kind: CollectionKind; ambiguous: boolean } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtube.com" || host === "youtu.be") {
    const list = u.searchParams.get("list");
    if (!list || list.startsWith("RD")) return null; // RD… are auto-generated mixes, not real playlists
    return { kind: "youtube-playlist", ambiguous: !!youtubeVideoId(input) };
  }
  if (host === "open.spotify.com") {
    const seg = u.pathname.split("/").filter(Boolean).filter((s) => !s.startsWith("intl-"));
    if (seg[0] === "playlist") return { kind: "spotify-playlist", ambiguous: false };
    if (seg[0] === "show") return { kind: "spotify-show", ambiguous: false };
    return null;
  }
  if (host === "podcasts.apple.com" && /\/id\d+/.test(u.pathname) && !u.searchParams.get("i")) return { kind: "apple-show", ambiguous: false };
  if (/(\/feed\/?$|\/rss\/?$|\.rss$|\.xml$|^feeds\.)/i.test(u.pathname) || /^feeds?\./.test(host)) return { kind: "podcast-feed", ambiguous: false };
  return null;
}

/** Pulls every http(s) link out of pasted text (one per line, or mixed with other text). */
export function extractLinks(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  return [...new Set(found.map((s) => s.replace(/[.,;]+$/, "")))];
}
