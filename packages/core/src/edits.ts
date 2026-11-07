import type { Summary, SummaryItem } from "./types.ts";

/**
 * People can remove any single piece of a gist (the TL;DR, a section's paragraph, or one point)
 * before sending it to their notes. Removed pieces are kept so they can be put back.
 */
export type SummaryPart =
  | { kind: "tldr" }
  | { kind: "paragraph"; sectionId: string }
  | { kind: "item"; sectionId: string; index: number };

export interface RemovedPart {
  part: SummaryPart;
  /** The removed text, or the removed point. */
  text: string;
  item?: SummaryItem;
}

/** Removes one piece. Returns null when the piece doesn't exist or is already empty. */
export function removePart(summary: Summary, part: SummaryPart): { summary: Summary; removed: RemovedPart } | null {
  if (part.kind === "tldr") {
    if (!summary.tldr) return null;
    return { summary: { ...summary, tldr: "" }, removed: { part, text: summary.tldr } };
  }
  const si = summary.sections.findIndex((s) => s.id === part.sectionId);
  if (si < 0) return null;
  const sec = summary.sections[si];
  const sections = [...summary.sections];
  if (part.kind === "paragraph") {
    if (!sec.paragraph) return null;
    sections[si] = { ...sec, paragraph: null };
    return { summary: { ...summary, sections }, removed: { part, text: sec.paragraph } };
  }
  const item = sec.items[part.index];
  if (!Number.isInteger(part.index) || !item) return null;
  sections[si] = { ...sec, items: sec.items.filter((_, i) => i !== part.index) };
  return { summary: { ...summary, sections }, removed: { part, text: item.text, item } };
}

/** Puts removed pieces back, newest first, so each lands where it was. */
export function restoreParts(summary: Summary, removed: RemovedPart[]): Summary {
  let out: Summary = { ...summary, sections: summary.sections.map((s) => ({ ...s, items: [...s.items] })) };
  for (const r of [...removed].reverse()) {
    const p = r.part;
    if (p.kind === "tldr") {
      out = { ...out, tldr: r.text };
      continue;
    }
    const sec = out.sections.find((s) => s.id === p.sectionId);
    if (!sec) continue;
    if (p.kind === "paragraph") sec.paragraph = r.text;
    else sec.items.splice(Math.min(p.index, sec.items.length), 0, r.item ?? { text: r.text, timestamp: null });
  }
  return out;
}

/** Checks a part sent by a client. */
export function parsePart(v: unknown): SummaryPart | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "tldr") return { kind: "tldr" };
  if (typeof o.sectionId !== "string" || !o.sectionId) return null;
  if (o.kind === "paragraph") return { kind: "paragraph", sectionId: o.sectionId };
  if (o.kind === "item" && typeof o.index === "number" && Number.isInteger(o.index) && o.index >= 0) return { kind: "item", sectionId: o.sectionId, index: o.index };
  return null;
}
