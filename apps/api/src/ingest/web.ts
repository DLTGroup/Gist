import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { IngestedSource } from "@gist/core";
import { countWords } from "@gist/core";
import { IngestError, fetchWithLimits } from "./http.ts";

/** Extracts the readable article from a blog post or web page. */
export async function fetchWebArticle(url: string): Promise<IngestedSource> {
  const res = await fetchWithLimits(url, { headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9" } });
  if (!res.ok) throw new IngestError(`The page returned an error (${res.status}). It may need a login or block automated readers.`);
  const type = res.headers.get("content-type") ?? "";
  const raw = await res.bodyText();
  if (type.includes("text/plain")) {
    return { kind: "web", url: res.url || url, title: new URL(url).pathname.split("/").pop() || url, author: null, publishedAt: null, thumbnailUrl: null, durationSeconds: null, text: raw };
  }
  if (!type.includes("html")) throw new IngestError("That link isn't a web page we can read (try a blog post or article).");
  return parseArticleHtml(raw, res.url || url);
}

export function parseArticleHtml(html: string, url: string): IngestedSource {
  const vc = new VirtualConsole(); // swallow CSS/JS parse noise
  const dom = new JSDOM(html, { url, virtualConsole: vc });
  const doc = dom.window.document;
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content")?.trim() || null;
  const article = new Readability(doc, { charThreshold: 300 }).parse();
  const text = blockText(article?.content ?? "", url);
  if (countWords(text) < 80) {
    throw new IngestError("Couldn't find enough article text on that page. It may be behind a paywall or built entirely with scripts.");
  }
  return {
    kind: "web",
    url,
    title: article?.title?.trim() || meta('meta[property="og:title"]') || doc.title || url,
    author: article?.byline?.trim() || meta('meta[name="author"]') || article?.siteName || meta('meta[property="og:site_name"]') || new URL(url).hostname,
    publishedAt: article?.publishedTime || meta('meta[property="article:published_time"]'),
    thumbnailUrl: meta('meta[property="og:image"]'),
    durationSeconds: null,
    text,
    language: article?.lang ?? null,
  };
}

/** Text of article HTML with line breaks between block elements (textContent alone runs headings into paragraphs). */
function blockText(html: string, url: string): string {
  const doc = new JSDOM(html, { url }).window.document;
  doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr, br, div, section, figcaption").forEach((el) => el.after(doc.createTextNode("\n")));
  return (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
