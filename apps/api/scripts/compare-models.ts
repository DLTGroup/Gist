/**
 * Runs the same sources through several models and reports speed, tokens, estimated cost and
 * the output side by side, so the team can pick what goes in GIST_MODELS.
 *
 *   npm run compare-models -w @gist/api -- \
 *     --models "anthropic/<model-a>, openai/<model-b>" \
 *     --url https://www.youtube.com/watch?v=... --file notes.txt \
 *     --price "openai/<model-b>=0.25/2" --template takeaways-actions
 *
 * Prices are US dollars per million input/output tokens; check each provider's pricing page.
 * Keys come from the same environment variables the server uses.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BUILT_IN_TEMPLATES, countWords, type IngestedSource } from "@gist/core";
import { ingest } from "../src/ingest/index.ts";
import { buildSummarizer, parseModelList } from "../src/models/router.ts";
import type { SummaryResult } from "../src/summarize.ts";

const args = process.argv.slice(2);
const all = (flag: string) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const one = (flag: string) => all(flag)[0];

const specs = parseModelList(one("--models") ?? process.env.GIST_MODELS ?? process.env.GIST_MODEL ?? "");
if (!specs.length) throw new Error('Pass --models "provider/model, ..." or set GIST_MODELS.');
const template = BUILT_IN_TEMPLATES.find((t) => t.id === (one("--template") ?? "takeaways-actions"));
if (!template) throw new Error("Unknown --template.");
const prices = new Map(all("--price").map((p) => {
  const [model, rate] = p.split("=");
  const [inp, out] = rate.split("/").map(Number);
  return [model.trim(), { inp, out }] as const;
}));

const sources: IngestedSource[] = [];
for (const url of all("--url")) sources.push(await ingest({ url }));
for (const file of all("--file")) {
  const text = readFileSync(file, "utf8");
  sources.push({ kind: "text", url: null, title: file, author: null, publishedAt: null, thumbnailUrl: null, durationSeconds: null, text });
}
if (!sources.length) throw new Error("Pass at least one --url or --file.");

type Row = { model: string; source: string; result?: SummaryResult; error?: string };
const rows: Row[] = [];
for (const spec of specs) {
  const id = `${spec.provider}/${spec.model}`;
  let s;
  try {
    s = buildSummarizer(spec);
  } catch (e) {
    for (const src of sources) rows.push({ model: id, source: src.title, error: (e as Error).message });
    continue;
  }
  for (const src of sources) {
    process.stderr.write(`${id} · ${src.title} … `);
    try {
      const result = await s.summarize(src, template);
      rows.push({ model: id, source: src.title, result });
      process.stderr.write(`${(result.ms / 1000).toFixed(1)}s\n`);
    } catch (e) {
      rows.push({ model: id, source: src.title, error: (e as Error).message });
      process.stderr.write("failed\n");
    }
  }
}

const cost = (r: Row) => {
  const p = prices.get(r.model);
  const u = r.result?.usage;
  return p && u ? (u.input * p.inp + u.output * p.out) / 1_000_000 : null;
};
const lines = [
  `# Model comparison, ${new Date().toISOString().slice(0, 10)}`,
  "",
  `Template: ${template.name}. Sources: ${sources.map((s) => `${s.title} (${countWords(s.text).toLocaleString("en-CA")} words)`).join("; ")}.`,
  "",
  "| Model | Source | Seconds | Input tokens | Output tokens | Est. cost (USD) | Result |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) => {
    const c = cost(r);
    return `| ${r.model} | ${r.source} | ${r.result ? (r.result.ms / 1000).toFixed(1) : "n/a"} | ${r.result?.usage?.input ?? "n/a"} | ${r.result?.usage?.output ?? "n/a"} | ${c == null ? "n/a" : c.toFixed(4)} | ${r.error ? `failed: ${r.error}` : "ok"} |`;
  }),
  "",
  "## Outputs",
  ...rows.filter((r) => r.result).flatMap((r) => [
    "",
    `### ${r.model} · ${r.source}`,
    "",
    `**${r.result!.summary.title}**: ${r.result!.summary.tldr}`,
    "",
    ...r.result!.summary.sections.flatMap((s) => [`*${s.heading}*`, ...(s.paragraph ? [s.paragraph] : []), ...s.items.map((i) => `- ${i.text}`), ""]),
  ]),
];
const out = one("--out") ?? `model-comparison-${Date.now()}.md`;
writeFileSync(out, lines.join("\n"));
console.log(lines.slice(0, 6 + rows.length).join("\n"));
console.log(`\nFull outputs written to ${out}`);
