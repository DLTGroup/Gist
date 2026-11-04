import type { SourceKind } from "./types.ts";

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
  if (AUDIO_EXT.test(trimmed) || FEED_HINT.test(trimmed)) return "podcast";
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

/** Deep link to a moment in the source, where the platform supports it. */
export function timestampLink(kind: SourceKind, url: string | null, seconds: number): string | null {
  if (!url) return null;
  if (kind === "youtube") {
    const id = youtubeVideoId(url);
    return id ? `https://www.youtube.com/watch?v=${id}&t=${Math.floor(seconds)}s` : null;
  }
  return null;
}
