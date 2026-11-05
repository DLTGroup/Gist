import type { Gist } from "./types.ts";
import { formatMinutes } from "./metrics.ts";
import { BRAND } from "./sources.ts";

/** One spoken chunk of a gist. `key` lets a player highlight the matching element ("title", "tldr", "h:<sectionId>", "i:<sectionId>:<n>", "p:<sectionId>"). */
export interface SpeechSegment {
  key: string;
  text: string;
}

/** The gist as a list of short passages to read aloud in order, so a player can highlight and skip point by point. */
export function speechSegments(g: Gist): SpeechSegment[] {
  if (!g.summary) return [];
  const out: SpeechSegment[] = [
    { key: "title", text: g.summary.title },
    { key: "tldr", text: g.summary.tldr },
  ];
  for (const sec of g.summary.sections) {
    if (!sec.paragraph && !sec.items.length) continue;
    out.push({ key: `h:${sec.id}`, text: sec.heading.endsWith(".") ? sec.heading : sec.heading + "." });
    if (sec.paragraph) out.push({ key: `p:${sec.id}`, text: sec.paragraph });
    sec.items.forEach((it, n) => out.push({ key: `i:${sec.id}:${n}`, text: it.text }));
  }
  return out.filter((s) => s.text.trim());
}

/** Rough listening time in minutes at a given speech rate (about 160 spoken words a minute at 1×). */
export function listenMinutes(segments: SpeechSegment[], rate = 1): number {
  const words = segments.reduce((n, s) => n + (s.text.match(/\S+/g)?.length ?? 0), 0);
  return words / (160 * rate);
}

/** Default text for a social post: title, the short version, up to three points, and the time saved. */
export function shareMessage(g: Gist): string {
  if (!g.summary) return g.source.title;
  const points = g.summary.sections.flatMap((s) => s.items).slice(0, 3).map((i) => `• ${i.text}`);
  const saved = g.savings ? `\n\nGot the gist and saved ${formatMinutes(g.savings.minutesSaved)}.` : "";
  return `${g.summary.title}\n\n${g.summary.tldr}${points.length ? "\n\n" + points.join("\n") : ""}${saved} Summarized with ${BRAND.name}.`;
}

export type ShareNetwork = "x" | "facebook" | "whatsapp" | "linkedin";

/** Web share links for each network. X posts are trimmed to fit with the link. Facebook only takes a URL. */
export function shareLinks(message: string, url: string | null): Record<ShareNetwork, string | null> {
  const enc = encodeURIComponent;
  const xRoom = 280 - (url ? 24 : 0) - 1;
  const xText = message.length > xRoom ? message.slice(0, message.lastIndexOf(" ", xRoom - 1)) + "…" : message;
  const withUrl = url ? `${message}\n\n${url}` : message;
  return {
    x: `https://x.com/intent/post?text=${enc(xText)}${url ? `&url=${enc(url)}` : ""}`,
    facebook: url ? `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` : null,
    whatsapp: `https://wa.me/?text=${enc(withUrl)}`,
    linkedin: url ? `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` : `https://www.linkedin.com/feed/?shareActive=true&text=${enc(message)}`,
  };
}
