import type { IngestedSource } from "@gist/core";
import { youtubeLinks, youtubeVideoId } from "@gist/core";
import { IngestError, decodeEntities, fetchWithLimits } from "./http.ts";

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string; thumbnail?: { thumbnails?: { url: string }[] } };
  microformat?: { playerMicroformatRenderer?: { publishDate?: string } };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}

const ANDROID_VERSION = "20.10.38";

/**
 * Fetches the public caption track for a video. This reads the same captions any viewer can
 * turn on in the player. If YouTube changes its internals this is the module to update; a
 * licensed transcript provider can be swapped in behind fetchYouTube() without touching callers.
 */
/** Thrown when a video can be identified but has no usable captions; carries what we know about it. */
export class NoTranscriptError extends IngestError {
  constructor(message: string, public meta: IngestedSource) {
    super(message);
  }
}

/** Title, channel and thumbnail from YouTube's public oEmbed endpoint, for when the watch page can't be read. */
export async function youtubeOEmbed(watchUrl: string): Promise<{ title: string | null; author: string | null; thumbnailUrl: string | null }> {
  try {
    const r = await fetchWithLimits(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`, { timeoutMs: 8000 });
    const j = JSON.parse(await r.bodyText()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return { title: j.title ?? null, author: j.author_name ?? null, thumbnailUrl: j.thumbnail_url ?? null };
  } catch {
    return { title: null, author: null, thumbnailUrl: null };
  }
}

export async function fetchYouTube(url: string): Promise<IngestedSource> {
  const id = youtubeVideoId(url);
  if (!id) throw new IngestError("That isn't a YouTube video link.");
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;

  const page = await fetchWithLimits(watchUrl, { headers: { cookie: "CONSENT=YES+1" } });
  const html = await page.bodyText();
  const apiKey = html.match(/"INNERTUBE_API_KEY":\s*"([\w-]+)"/)?.[1];

  let player: PlayerResponse | null = null;
  if (apiKey) {
    const res = await fetchWithLimits(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 14) gzip` },
      body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: ANDROID_VERSION, hl: "en" } }, videoId: id }),
    });
    if (res.ok) player = JSON.parse(await res.bodyText()) as PlayerResponse;
  }
  // Fallback: the player response embedded in the watch page.
  const embedded = extractEmbeddedPlayer(html);
  if (!player?.captions && embedded) player = { ...embedded, ...player, captions: embedded.captions };
  if (!player) throw new IngestError("Couldn't read that video. It may be private or unavailable.");

  const status = player.playabilityStatus?.status;
  if (status && status !== "OK" && !player.captions) {
    throw new IngestError(player.playabilityStatus?.reason || "That video isn't available.");
  }

  const details = player.videoDetails ?? embedded?.videoDetails ?? {};
  const thumbs = details.thumbnail?.thumbnails ?? [];
  const meta: IngestedSource = {
    kind: "youtube",
    url: watchUrl,
    title: details.title ?? "YouTube video",
    author: details.author ?? null,
    publishedAt: (player.microformat ?? embedded?.microformat)?.playerMicroformatRenderer?.publishDate ?? null,
    thumbnailUrl: thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    durationSeconds: details.lengthSeconds ? Number(details.lengthSeconds) : null,
    text: "",
    links: youtubeLinks(watchUrl),
  };
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) {
    throw new NoTranscriptError("This video has no captions, so there's nothing to summarize yet. Try another video, or paste the text instead.", meta);
  }
  const track = pickTrack(tracks);
  const segments = await fetchCaptionSegments(track.baseUrl);
  if (!segments.length) throw new NoTranscriptError("The captions for this video came back empty.", meta);

  return {
    ...meta,
    durationSeconds: meta.durationSeconds ?? Math.ceil(segments[segments.length - 1].start + 5),
    text: segments.map((s) => s.text).join(" "),
    segments,
    language: track.languageCode,
  };
}

function extractEmbeddedPlayer(html: string): PlayerResponse | null {
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as PlayerResponse;
  } catch {
    return null;
  }
}

export function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  const en = (t: CaptionTrack) => t.languageCode.toLowerCase().startsWith("en");
  return tracks.find((t) => en(t) && t.kind !== "asr") ?? tracks.find(en) ?? tracks.find((t) => t.kind !== "asr") ?? tracks[0];
}

export async function fetchCaptionSegments(baseUrl: string): Promise<{ start: number; text: string }[]> {
  const res = await fetchWithLimits(baseUrl.replace(/&fmt=[^&]*/, ""));
  return parseTimedText(await res.bodyText());
}

/** Parses YouTube timedtext XML (format 1 <text start=…> and format 3 <p t=…ms>). */
export function parseTimedText(xml: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  const clean = (s: string) => decodeEntities(decodeEntities(s.replace(/<[^>]+>/g, ""))).replace(/\s+/g, " ").trim();
  for (const m of xml.matchAll(/<text[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = clean(m[2]);
    if (text) out.push({ start: Number(m[1]), text });
  }
  if (out.length) return out;
  for (const m of xml.matchAll(/<p[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = clean(m[2]);
    if (text) out.push({ start: Number(m[1]) / 1000, text });
  }
  return out;
}
