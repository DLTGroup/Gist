import { XMLParser } from "fast-xml-parser";
import type { IngestedSource } from "@gist/core";
import { IngestError, decodeEntities, fetchWithLimits } from "./http.ts";

interface Episode {
  title: string;
  show: string | null;
  audioUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  imageUrl: string | null;
  transcripts: { url: string; type: string }[];
  link: string | null;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: false, isArray: (n) => n === "item" || n === "podcast:transcript" });
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string | null => (v == null ? null : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") || null : String(v));

/**
 * Resolves a podcast link (Apple Podcasts, Spotify, RSS feed, show page or audio file) to an episode,
 * then prefers the publisher's own transcript (Podcasting 2.0 <podcast:transcript>) and falls back
 * to speech-to-text on the audio.
 */
export async function fetchPodcast(url: string): Promise<IngestedSource> {
  const ep = await resolveEpisode(url);
  let segments: { start: number; text: string }[] | null = null;

  for (const t of rankTranscripts(ep.transcripts)) {
    try {
      const res = await fetchWithLimits(t.url);
      if (!res.ok) continue;
      segments = parseTranscript(await res.bodyText(), t.type);
      if (segments.length) break;
    } catch {
      /* try the next one */
    }
  }
  if (!segments?.length) {
    if (!ep.audioUrl) throw new IngestError("Couldn't find the audio or a transcript for that episode.");
    segments = await transcribeAudio(ep.audioUrl);
  }
  const durationSeconds = ep.durationSeconds ?? Math.ceil(segments[segments.length - 1].start + 10);
  return {
    kind: "podcast",
    url,
    title: ep.title,
    author: ep.show,
    publishedAt: ep.publishedAt,
    thumbnailUrl: ep.imageUrl,
    durationSeconds,
    text: segments.map((s) => s.text).join(" "),
    segments,
  };
}

async function resolveEpisode(url: string): Promise<Episode> {
  const u = new URL(url);
  if (/\.(mp3|m4a|aac|ogg|opus|wav)$/i.test(u.pathname)) {
    return { title: decodeURIComponent(u.pathname.split("/").pop() ?? "Episode"), show: u.hostname, audioUrl: url, durationSeconds: null, publishedAt: null, imageUrl: null, transcripts: [], link: url };
  }
  if (u.hostname === "podcasts.apple.com") return fromApple(u);
  if (u.hostname === "open.spotify.com") return fromSpotify(u);

  const res = await fetchWithLimits(url, { headers: { accept: "application/rss+xml, application/xml, text/xml, text/html" } });
  const body = await res.bodyText();
  if (/^\s*(<\?xml[^>]*>\s*)?<rss/i.test(body)) {
    // Links made by a feed import carry the episode title: …/feed.xml#episode=Title
    const wanted = u.hash.startsWith("#episode=") ? decodeURIComponent(u.hash.slice(9)) : null;
    return pickFromFeed(body, wanted);
  }

  // A show or episode web page: look for its RSS feed and match the episode by title.
  const feedHref = body.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]*>/i)?.[0].match(/href=["']([^"']+)["']/i)?.[1];
  const ogTitle = body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (feedHref) {
    const feed = await (await fetchWithLimits(new URL(decodeEntities(feedHref), url).toString())).bodyText();
    return pickFromFeed(feed, ogTitle ? decodeEntities(ogTitle) : null);
  }
  const ogAudio = body.match(/<meta[^>]+property=["']og:audio(?::url)?["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (ogAudio) return { title: ogTitle ? decodeEntities(ogTitle) : "Episode", show: u.hostname, audioUrl: decodeEntities(ogAudio), durationSeconds: null, publishedAt: null, imageUrl: null, transcripts: [], link: url };
  throw new IngestError("Couldn't find a podcast episode at that link. Try the Apple Podcasts link or the show's RSS feed.");
}

interface ItunesResult {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  collectionName?: string;
  feedUrl?: string;
  episodeUrl?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  artworkUrl600?: string;
}

async function itunes(path: string): Promise<ItunesResult[]> {
  const res = await fetchWithLimits(`https://itunes.apple.com/${path}`);
  if (!res.ok) throw new IngestError("Apple Podcasts lookup failed. Try the show's RSS feed instead.", 502);
  return (JSON.parse(await res.bodyText()) as { results: ItunesResult[] }).results ?? [];
}

async function fromApple(u: URL): Promise<Episode> {
  const showId = u.pathname.match(/id(\d+)/)?.[1];
  const episodeId = u.searchParams.get("i");
  if (!showId) throw new IngestError("Couldn't read that Apple Podcasts link.");
  const results = await itunes(`lookup?id=${showId}&entity=podcastEpisode&limit=200`);
  const show = results.find((r) => r.wrapperType === "track" && r.kind === "podcast") ?? results[0];
  const episode = episodeId ? results.find((r) => String(r.trackId) === episodeId) : results.find((r) => r.wrapperType === "podcastEpisode");
  if (show?.feedUrl) {
    try {
      const feed = await (await fetchWithLimits(show.feedUrl)).bodyText();
      return pickFromFeed(feed, episode?.trackName ?? null, episode?.episodeUrl ?? null);
    } catch {
      /* fall back to iTunes data below */
    }
  }
  if (!episode?.episodeUrl) throw new IngestError("Couldn't find that episode on Apple Podcasts.");
  return itunesEpisode(episode, show?.collectionName ?? null);
}

const itunesEpisode = (e: ItunesResult, show: string | null): Episode => ({
  title: e.trackName ?? "Episode",
  show: e.collectionName ?? show,
  audioUrl: e.episodeUrl ?? null,
  durationSeconds: e.trackTimeMillis ? Math.round(e.trackTimeMillis / 1000) : null,
  publishedAt: e.releaseDate ?? null,
  imageUrl: e.artworkUrl600 ?? null,
  transcripts: [],
  link: null,
});

/** Spotify doesn't expose audio or feeds, so find the same episode in the open podcast directory by title. */
async function fromSpotify(u: URL): Promise<Episode> {
  if (!u.pathname.startsWith("/episode/")) throw new IngestError("Paste a Spotify episode link (not a show or playlist).");
  const oembed = await fetchWithLimits(`https://open.spotify.com/oembed?url=${encodeURIComponent(u.toString())}`);
  const title = oembed.ok ? ((JSON.parse(await oembed.bodyText()) as { title?: string }).title ?? null) : null;
  if (!title) throw new IngestError("Couldn't read that Spotify episode.");
  const hits = await itunes(`search?media=podcast&entity=podcastEpisode&limit=5&term=${encodeURIComponent(title)}`);
  const hit = hits.find((h) => h.trackName?.toLowerCase() === title.toLowerCase()) ?? hits[0];
  if (!hit) throw new IngestError("That episode is Spotify-exclusive or couldn't be found in public podcast directories.");
  if (hit.feedUrl) {
    try {
      return pickFromFeed(await (await fetchWithLimits(hit.feedUrl)).bodyText(), hit.trackName ?? title, hit.episodeUrl ?? null);
    } catch {
      /* fall through */
    }
  }
  return itunesEpisode(hit, null);
}

/** Picks an episode from an RSS feed: by audio URL, then title, else the most recent. */
export function pickFromFeed(feedXml: string, title: string | null, audioUrl: string | null = null): Episode {
  const doc = xml.parse(feedXml);
  const channel = doc?.rss?.channel;
  if (!channel) throw new IngestError("That feed couldn't be read.");
  const items = arr(channel.item) as Record<string, unknown>[];
  if (!items.length) throw new IngestError("That feed has no episodes.");
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const enclosureUrl = (it: Record<string, unknown>) => ((it.enclosure as Record<string, string> | undefined)?.["@_url"] ?? null);
  const stripQuery = (s: string) => s.split("?")[0];
  const item =
    (audioUrl && items.find((it) => enclosureUrl(it) && stripQuery(enclosureUrl(it)!) === stripQuery(audioUrl))) ||
    (title && items.find((it) => norm(txt(it.title) ?? "") === norm(title))) ||
    (title && items.find((it) => norm(txt(it.title) ?? "").includes(norm(title)) || norm(title).includes(norm(txt(it.title) ?? "")))) ||
    items[0];
  const image = (channel["itunes:image"] as Record<string, string> | undefined)?.["@_href"] ?? (channel.image as Record<string, string> | undefined)?.url ?? null;
  const itemImage = (item["itunes:image"] as Record<string, string> | undefined)?.["@_href"];
  return {
    title: decodeEntities(txt(item.title) ?? "Episode"),
    show: txt(channel.title) ? decodeEntities(txt(channel.title)!) : null,
    audioUrl: enclosureUrl(item),
    durationSeconds: parseDuration(txt(item["itunes:duration"])),
    publishedAt: txt(item.pubDate) ? new Date(txt(item.pubDate)!).toISOString() : null,
    imageUrl: itemImage ?? image,
    transcripts: arr(item["podcast:transcript"] as Record<string, string>[]).map((t) => ({ url: t["@_url"], type: t["@_type"] ?? "" })).filter((t) => t.url),
    link: txt(item.link),
  };
}

export function parseDuration(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const parts = v.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function rankTranscripts(ts: { url: string; type: string }[]) {
  const order = ["text/vtt", "application/x-subrip", "application/srt", "application/json", "text/plain", "text/html"];
  const rank = (t: string) => (order.indexOf(t) < 0 ? order.length : order.indexOf(t));
  return [...ts].sort((a, b) => rank(a.type) - rank(b.type));
}

/** Parses WebVTT, SRT, Podcasting 2.0 JSON, HTML or plain-text transcripts into timed segments. */
export function parseTranscript(body: string, type: string): { start: number; text: string }[] {
  const trimmed = body.trim();
  if (type.includes("json") || trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as { segments?: { startTime?: number; body?: string }[] };
      return (j.segments ?? []).filter((s) => s.body?.trim()).map((s) => ({ start: s.startTime ?? 0, text: s.body!.trim() }));
    } catch {
      /* not JSON after all */
    }
  }
  const cue = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s*-->/;
  if (cue.test(trimmed)) {
    const out: { start: number; text: string }[] = [];
    for (const block of trimmed.split(/\r?\n\r?\n/)) {
      const lines = block.split(/\r?\n/);
      const idx = lines.findIndex((l) => cue.test(l));
      if (idx < 0) continue;
      const m = lines[idx].match(cue)!;
      const start = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
      const text = lines.slice(idx + 1).join(" ").replace(/<[^>]+>/g, "").trim();
      if (text) out.push({ start, text: decodeEntities(text) });
    }
    return out;
  }
  const plain = decodeEntities(trimmed.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return plain ? [{ start: 0, text: plain }] : [];
}

/** Speech-to-text fallback. Deepgram fetches the audio URL itself, so nothing large passes through this server. */
async function transcribeAudio(audioUrl: string): Promise<{ start: number; text: string }[]> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    throw new IngestError(
      "This episode has no published transcript, and audio transcription isn't set up on this server yet (DEEPGRAM_API_KEY).",
      501,
    );
  }
  const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&paragraphs=true&detect_language=true", {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ url: audioUrl }),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!res.ok) throw new IngestError(`Transcription failed (${res.status}).`, 502);
  const data = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string; paragraphs?: { paragraphs?: { start: number; sentences: { text: string }[] }[] } }[] }[] };
  };
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  const paras = alt?.paragraphs?.paragraphs ?? [];
  if (paras.length) return paras.map((p) => ({ start: p.start, text: p.sentences.map((s) => s.text).join(" ") }));
  return alt?.transcript ? [{ start: 0, text: alt.transcript }] : [];
}
