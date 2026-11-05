import type { Gist, SummarySection } from "./types.ts";
import { BRAND, formatTimestamp, sourceLinks, timestampLink } from "./sources.ts";
import { formatMinutes, formatMoney } from "./metrics.ts";

/** Renders a gist as Markdown. With frontMatter, the output is ready for Obsidian/Logseq. */
export function toMarkdown(g: Gist, opts: { frontMatter?: boolean } = {}): string {
  if (!g.summary) return "";
  const out: string[] = [];
  if (opts.frontMatter) {
    const yaml = [
      "---",
      `title: ${JSON.stringify(g.summary.title)}`,
      `source: ${JSON.stringify(g.source.url ?? "")}`,
      `source_type: ${g.source.kind}`,
      g.source.author ? `author: ${JSON.stringify(g.source.author)}` : null,
      `created: ${g.createdAt.slice(0, 10)}`,
      `tags: [${g.tags.map((t) => JSON.stringify(t)).join(", ")}]`,
      g.savings ? `minutes_saved: ${g.savings.minutesSaved}` : null,
      "---",
      "",
    ].filter((l) => l !== null);
    out.push(yaml.join("\n"));
  }
  out.push(`# ${g.summary.title}`, "");
  out.push(`> **TL;DR** ${g.summary.tldr}`, "");
  for (const sec of g.summary.sections) {
    if (!sec.paragraph && sec.items.length === 0) continue;
    out.push(`## ${sec.heading}`, "");
    if (sec.paragraph) out.push(sec.paragraph, "");
    sec.items.forEach((item, i) => {
      const ts = item.timestamp != null ? tsMarkdown(g, item.timestamp) : "";
      out.push(`${bullet(sec, i)}${item.text}${ts}`);
    });
    if (sec.items.length) out.push("");
  }
  out.push("---", sourceLine(g));
  if (g.savings) out.push(`*Saved about ${formatMinutes(g.savings.minutesSaved)} (${formatMoney(g.savings.moneySaved, g.savings.currency)}) with ${BRAND.name}.*`);
  return out.join("\n").trim() + "\n";
}

function bullet(sec: SummarySection, i: number): string {
  if (sec.format === "checklist") return "- [ ] ";
  if (sec.format === "numbered") return `${i + 1}. `;
  return "- ";
}

function tsMarkdown(g: Gist, seconds: number): string {
  const link = timestampLink(g.source.kind, g.source.url, seconds, g.source.audioUrl);
  const label = formatTimestamp(seconds);
  return link ? ` ([${label}](${link}))` : ` (${label})`;
}

function sourceLine(g: Gist): string {
  const by = g.source.author ? ` by ${g.source.author}` : "";
  const main = g.source.url ? `Source: [${g.source.title}](${g.source.url})${by}` : `Source: ${g.source.title}${by}`;
  const extra = sourceLinks(g.source).filter((l) => l.kind !== "original").map((l) => `[${l.label}](${l.url})`);
  return extra.length ? `${main} · ${extra.join(" · ")}` : main;
}

export function toPlainText(g: Gist): string {
  if (!g.summary) return "";
  const out = [g.summary.title, "", `TL;DR: ${g.summary.tldr}`, ""];
  for (const sec of g.summary.sections) {
    if (!sec.paragraph && !sec.items.length) continue;
    out.push(sec.heading.toUpperCase());
    if (sec.paragraph) out.push(sec.paragraph);
    sec.items.forEach((it, i) => {
      const prefix = sec.format === "numbered" ? `${i + 1}. ` : sec.format === "checklist" ? "☐ " : "• ";
      out.push(prefix + it.text + (it.timestamp != null ? ` (${formatTimestamp(it.timestamp)})` : ""));
    });
    out.push("");
  }
  out.push(`Source: ${g.source.title}${g.source.url ? " — " + g.source.url : ""}`);
  for (const l of sourceLinks(g.source).filter((x) => x.kind !== "original")) out.push(`${l.label}: ${l.url}`);
  return out.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Evernote export (.enex) — importable via File › Import in Evernote. */
export function toEnex(gists: Gist[]): string {
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const notes = gists
    .filter((g) => g.summary)
    .map((g) => {
      const s = g.summary!;
      const body: string[] = [`<div><b>TL;DR</b> ${esc(s.tldr)}</div>`];
      for (const sec of s.sections) {
        if (!sec.paragraph && !sec.items.length) continue;
        body.push(`<h2>${esc(sec.heading)}</h2>`);
        if (sec.paragraph) body.push(`<div>${esc(sec.paragraph)}</div>`);
        if (sec.items.length) {
          if (sec.format === "checklist") {
            body.push(...sec.items.map((it) => `<div><en-todo checked="false"/>${esc(it.text)}</div>`));
          } else {
            const tag = sec.format === "numbered" ? "ol" : "ul";
            body.push(`<${tag}>${sec.items.map((it) => `<li>${esc(it.text)}${it.timestamp != null ? ` (${formatTimestamp(it.timestamp)})` : ""}</li>`).join("")}</${tag}>`);
          }
        }
      }
      if (g.source.url) body.push(`<hr/><div>Source: <a href="${esc(g.source.url)}">${esc(g.source.title)}</a></div>`);
      const content = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${body.join("")}</en-note>`;
      return `<note><title>${esc(s.title)}</title><content><![CDATA[${content}]]></content><created>${stamp(g.createdAt)}</created><updated>${stamp(g.updatedAt)}</updated>${g.tags.map((t) => `<tag>${esc(t)}</tag>`).join("")}${g.source.url ? `<note-attributes><source-url>${esc(g.source.url)}</source-url></note-attributes>` : ""}</note>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export application="${BRAND.name}" version="1.0">${notes.join("")}</en-export>\n`;
}

/** Notion API block objects for a gist (used with POST /v1/pages). */
export function toNotionBlocks(g: Gist): unknown[] {
  if (!g.summary) return [];
  const rt = (text: string, link?: string | null) => [{ type: "text", text: { content: text.slice(0, 2000), link: link ? { url: link } : null } }];
  const blocks: unknown[] = [
    { object: "block", type: "callout", callout: { rich_text: rt(g.summary.tldr), icon: { type: "emoji", emoji: "💡" } } },
  ];
  for (const sec of g.summary.sections) {
    if (!sec.paragraph && !sec.items.length) continue;
    blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: rt(sec.heading) } });
    if (sec.paragraph) blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: rt(sec.paragraph) } });
    for (const it of sec.items) {
      const text = it.text + (it.timestamp != null ? ` (${formatTimestamp(it.timestamp)})` : "");
      const type = sec.format === "checklist" ? "to_do" : sec.format === "numbered" ? "numbered_list_item" : "bulleted_list_item";
      const payload: Record<string, unknown> = { rich_text: rt(text) };
      if (type === "to_do") payload.checked = false;
      blocks.push({ object: "block", type, [type]: payload });
    }
  }
  if (g.source.url) {
    blocks.push({ object: "block", type: "divider", divider: {} });
    blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: rt(`Source: ${g.source.title}`, g.source.url) } });
  }
  return blocks.slice(0, 100); // Notion caps children per request at 100
}

/** obsidian://new deep link that creates the note directly in the user's vault. */
export function obsidianUri(g: Gist, vault: string, folder?: string | null): string {
  const safe = (g.summary?.title ?? "Gist").replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const file = folder ? `${folder.replace(/\/+$/, "")}/${safe}` : safe;
  const q = new URLSearchParams({ vault, file, content: toMarkdown(g, { frontMatter: true }) });
  return `obsidian://new?${q.toString().replace(/\+/g, "%20")}`;
}

export function exportFilename(g: Gist, ext: string): string {
  const base = (g.summary?.title ?? "gist").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `${base || "gist"}.${ext}`;
}
