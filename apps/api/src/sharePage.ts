import { BRAND, formatMinutes, formatTimestamp, sourceLinks, timestampLink, type Gist } from "@gist/core";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The public, read-only page behind a share link. Open Graph and X card tags give link previews on X, Facebook, WhatsApp and LinkedIn. */
export function renderSharePage(g: Gist, opts: { url: string; cardUrl: string | null; appUrl: string }): string {
  const s = g.summary!;
  const desc = s.tldr.length > 200 ? s.tldr.slice(0, s.tldr.lastIndexOf(" ", 197)) + "…" : s.tldr;
  const ts = (sec: number | null | undefined) => {
    if (sec == null) return "";
    const link = timestampLink(g.source.kind, g.source.url, sec, g.source.audioUrl);
    const label = esc(formatTimestamp(sec));
    return link ? `<a class="ts" href="${esc(link)}" target="_blank" rel="noopener">${label}</a> ` : `<span class="ts">${label}</span> `;
  };
  const sections = s.sections
    .filter((sec) => sec.paragraph || sec.items.length)
    .map((sec) => {
      const tag = sec.format === "numbered" ? "ol" : "ul";
      const items = sec.items.map((it) => `<li>${ts(it.timestamp)}${esc(it.text)}</li>`).join("");
      return `<h2>${esc(sec.heading)}</h2>${sec.paragraph ? `<p>${esc(sec.paragraph)}</p>` : ""}${items ? `<${tag}>${items}</${tag}>` : ""}`;
    })
    .join("");
  const links = sourceLinks(g.source).map((l) => `<a class="src" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("");
  const saved = g.savings ? `<span class="save">Saved ${esc(formatMinutes(g.savings.minutesSaved))}</span>` : "";
  const by = [g.source.title, g.source.author].filter(Boolean).map(esc).join(", ");
  const image = opts.cardUrl
    ? `<meta property="og:image" content="${esc(opts.cardUrl)}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1080"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(opts.cardUrl)}">`
    : `<meta name="twitter:card" content="summary">`;
  return `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title)} · ${BRAND.name}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="${BRAND.name}"><meta property="og:title" content="${esc(s.title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(opts.url)}">
<meta name="twitter:title" content="${esc(s.title)}"><meta name="twitter:description" content="${esc(desc)}">
${image}
<link rel="canonical" href="${esc(opts.url)}">
<style>
:root{--bg:#f6f8f5;--fg:#102016;--mute:#465449;--line:rgba(16,32,22,.12);--teal:#166534;--tsoft:#e2ede4;--amber:#166534;--asoft:#e2ede4;--dot:#f59e0b;--cta:#b45309;--cta-ink:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#09110c;--fg:#e6efe8;--mute:#a7b5ab;--line:rgba(230,239,232,.14);--teal:#5fd38a;--tsoft:#12301d;--amber:#5fd38a;--asoft:#12301d;--cta:#f59e0b;--cta-ink:#1c1000;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:28px max(18px,env(safe-area-inset-left)) 64px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;font-weight:800;font-size:22px;letter-spacing:-.03em}
.brand i{width:28px;height:28px;border-radius:7px;background:#166534;position:relative}.brand i::after{content:"";position:absolute;right:5px;bottom:6px;width:6px;height:6px;border-radius:50%;background:var(--dot)}
.kicker{margin-top:36px;font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--mute)}
h1{font-size:clamp(30px,6vw,44px);line-height:1.08;letter-spacing:-.03em;margin:10px 0 14px}
.tldr{font-size:20px}.save{display:inline-block;margin:6px 0 4px;background:var(--asoft);color:var(--amber);font-weight:700;font-size:14px;border-radius:999px;padding:4px 12px}
h2{display:flex;align-items:center;gap:10px;font-size:21px;line-height:1.25;font-weight:800;letter-spacing:-.02em;color:inherit;margin:32px 0 10px;padding-top:24px;border-top:1px solid var(--line)}h2::before{content:"";flex:none;width:4px;height:1.05em;border-radius:2px;background:var(--teal)}
li{margin:6px 0}.ts{font:600 12px ui-monospace,Menlo,monospace;color:var(--teal);background:var(--tsoft);border-radius:5px;padding:1px 6px;text-decoration:none}
.sources{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0}.src{font-size:14px;font-weight:600;color:inherit;text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:6px 12px}
.foot{margin-top:40px;padding-top:20px;border-top:1px solid var(--line);color:var(--mute);font-size:14px;display:grid;gap:14px}
.cta{justify-self:start;background:var(--cta);color:var(--cta-ink);text-decoration:none;font-weight:600;border-radius:999px;padding:12px 20px}
</style></head><body><main>
<a class="brand" href="${esc(opts.appUrl)}"><i></i>${BRAND.name}</a>
<div class="kicker">${esc({ youtube: "Video", podcast: "Podcast", web: "Article", text: "Notes" }[g.source.kind])} summary</div>
<h1>${esc(s.title)}</h1>
<p class="tldr">${esc(s.tldr)}</p>
${saved}
${sections}
${links ? `<h2>Sources</h2><div class="sources">${links}</div>` : ""}
<div class="foot"><span>Summary written by ${BRAND.name}${by ? ` from ${by}` : ""}. Check important details against the original.</span><a class="cta" href="${esc(opts.appUrl)}">Get the gist of your own videos and podcasts</a></div>
</main></body></html>`;
}
