import type { CollectionKind } from "@gist/core";
import { detectCollection } from "@gist/core";
import { IngestError, decodeEntities, fetchWithLimits } from "./http.ts";
import { XMLParser } from "fast-xml-parser";

export interface CollectionItem {
  url: string;
  title: string | null;
}

export interface Collection {
  kind: CollectionKind;
  title: string;
  items: CollectionItem[];
  /** Items left out, with the reason (e.g. music tracks in a Spotify playlist). */
  skipped: { title: string | null; reason: string }[];
}

export const MAX_IMPORT_ITEMS = 50;

/** Expands a playlist, show or feed link into the individual items to summarize. */
export async function expandCollection(url: string, limit = 25): Promise<Collection> {
  const c = detectCollection(url);
  if (!c) throw new IngestError("That link isn't a playlist, show or feed we can import.");
  const max = Math.max(1, Math.min(MAX_IMPORT_ITEMS, limit));
  let col: Collection;
  switch (c.kind) {
    case "youtube-playlist":
      col = await youtubePlaylist(url);
      break;
    case "spotify-playlist":
    case "spotify-show":
      col = await spotifyCollection(url, c.kind);
      break;
    case "apple-show":
      col = await appleShow(url);
      break;
    case "podcast-feed":
      col = await podcastFeed(url);
      break;
  }
  if (!col.items.length) {
    throw new IngestError(col.skipped.length ? `Nothing in that ${label(c.kind)} can be summarized (${col.skipped[0].reason}).` : `That ${label(c.kind)} looks empty or private.`);
  }
  if (col.items.length > max) {
    col.skipped.push({ title: null, reason: `${col.items.length - max} more item(s) beyond the ${max}-item limit` });
    col.items = col.items.slice(0, max);
  }
  return col;
}

const label = (k: CollectionKind) => ({ "youtube-playlist": "playlist", "spotify-playlist": "playlist", "spotify-show": "show", "apple-show": "show", "podcast-feed": "feed" })[k];

// ---------- YouTube ----------

/** Reads the public playlist page. YouTube shows the first 100 videos without scrolling, which covers the import limit. */
export async function youtubePlaylist(url: string): Promise<Collection> {
  const list = new URL(url).searchParams.get("list")!;
  const res = await fetchWithLimits(`https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`, { headers: { cookie: "CONSENT=YES+1" } });
  const html = await res.bodyText();
  return parseYouTubePlaylistHtml(html);
}

export function parseYouTubePlaylistHtml(html: string): Collection {
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s);
  if (!m) throw new IngestError("Couldn't read that playlist. It may be private.");
  const data = JSON.parse(m[1]);
  const items: CollectionItem[] = [];
  const seen = new Set<string>();
  const skipped: Collection["skipped"] = [];
  // Walk the whole tree: YouTube moves renderers around, but playlist entries keep these shapes.
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const o = node as Record<string, unknown>;
    const r = o.playlistVideoRenderer as Record<string, unknown> | undefined;
    if (r?.videoId && typeof r.videoId === "string") {
      const title = textOf(r.title);
      if (r.isPlayable === false || /^\[(Private|Deleted) video\]$/.test(title ?? "")) skipped.push({ title, reason: "private or deleted video" });
      else if (!seen.has(r.videoId)) {
        seen.add(r.videoId);
        items.push({ url: `https://www.youtube.com/watch?v=${r.videoId}`, title });
      }
      return;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(data);
  const meta = (data?.metadata?.playlistMetadataRenderer ?? {}) as { title?: string };
  const header = textOf((data?.header?.playlistHeaderRenderer ?? {}).title);
  return { kind: "youtube-playlist", title: meta.title ?? header ?? "YouTube playlist", items, skipped };
}

function textOf(t: unknown): string | null {
  if (!t || typeof t !== "object") return null;
  const o = t as { simpleText?: string; runs?: { text: string }[]; content?: string };
  return o.simpleText ?? o.runs?.map((r) => r.text).join("") ?? o.content ?? null;
}

// ---------- Spotify ----------

interface SpotifyTrack {
  uri?: string;
  title?: string;
  subtitle?: string;
}

/**
 * Spotify's public embed page lists a playlist's or show's entries without an API key.
 * Podcast episodes are imported; music tracks are skipped (lyrics aren't summarized).
 */
export async function spotifyCollection(url: string, kind: "spotify-playlist" | "spotify-show"): Promise<Collection> {
  const seg = new URL(url).pathname.split("/").filter(Boolean).filter((s) => !s.startsWith("intl-"));
  const id = seg[1];
  if (!id) throw new IngestError("Couldn't read that Spotify link.");
  const res = await fetchWithLimits(`https://open.spotify.com/embed/${seg[0]}/${id}`);
  if (!res.ok) throw new IngestError("Couldn't open that Spotify link. It may be private.");
  return parseSpotifyEmbed(await res.bodyText(), kind);
}

export function parseSpotifyEmbed(html: string, kind: "spotify-playlist" | "spotify-show"): Collection {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if (!m) throw new IngestError("Spotify didn't return the list (it may have changed its page).");
  const data = JSON.parse(m[1]);
  const entity = data?.props?.pageProps?.state?.data?.entity ?? {};
  const tracks: SpotifyTrack[] = entity.trackList ?? [];
  const items: CollectionItem[] = [];
  const skipped: Collection["skipped"] = [];
  for (const t of tracks) {
    const [, type, tid] = (t.uri ?? "").split(":");
    if (type === "episode" && tid) items.push({ url: `https://open.spotify.com/episode/${tid}`, title: t.title ?? null });
    else skipped.push({ title: t.title ?? null, reason: "music track (only podcast episodes are summarized)" });
  }
  return { kind, title: entity.name ?? entity.title ?? "Spotify " + (kind === "spotify-show" ? "show" : "playlist"), items, skipped };
}

// ---------- Podcasts ----------

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: (n) => n === "item" });

/** Episode links point back into the feed (#episode=title) so each one resolves to its own transcript. */
export async function podcastFeed(feedUrl: string): Promise<Collection> {
  const res = await fetchWithLimits(feedUrl, { headers: { accept: "application/rss+xml, application/xml, text/xml" } });
  return parseFeedCollection(await res.bodyText(), feedUrl);
}

export function parseFeedCollection(body: string, feedUrl: string): Collection {
  const channel = xml.parse(body)?.rss?.channel;
  if (!channel) throw new IngestError("That feed couldn't be read.");
  const str = (v: unknown) => (v == null ? null : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v));
  const base = feedUrl.split("#")[0];
  const items = ((channel.item ?? []) as Record<string, unknown>[]).map((it) => {
    const title = decodeEntities(str(it.title) ?? "Episode");
    return { url: `${base}#episode=${encodeURIComponent(title)}`, title };
  });
  return { kind: "podcast-feed", title: decodeEntities(str(channel.title) ?? "Podcast"), items, skipped: [] };
}

async function appleShow(url: string): Promise<Collection> {
  const showId = new URL(url).pathname.match(/id(\d+)/)?.[1];
  const res = await fetchWithLimits(`https://itunes.apple.com/lookup?id=${showId}`);
  const feedUrl = ((JSON.parse(await res.bodyText()) as { results?: { feedUrl?: string }[] }).results ?? [])[0]?.feedUrl;
  if (!feedUrl) throw new IngestError("Couldn't find that show's feed on Apple Podcasts.");
  return { ...(await podcastFeed(feedUrl)), kind: "apple-show" };
}
