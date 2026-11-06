import type { ExtractionTemplate, TemplateSection } from "./types.ts";

const s = (id: string, heading: string, format: TemplateSection["format"], instruction: string): TemplateSection => ({
  id,
  heading,
  format,
  instruction,
});

/** Built-in extraction templates. Users can clone and edit any of these, or build their own. */
export const BUILT_IN_TEMPLATES: ExtractionTemplate[] = [
  {
    // Jesse's master extraction template (2026-11-06): exhaustive, attributed, extract-only.
    id: "full-extraction",
    name: "Full extraction",
    description: "Everything of substance, attributed to who said it, most important first.",
    icon: "🧾",
    length: "exhaustive",
    includeTimestamps: true,
    builtIn: true,
    quotes: { max: 10, maxWords: 25 },
    guidance: `You are a precise, exhaustive extractor. Capture everything of substance in the source: every idea, insight, statistic, example, recommendation and argument. You are recording, not evaluating.

Importance criteria. Wherever a section calls for ranking, judge importance in this order:
1. Centrality: how essential the point is to the core thesis.
2. Speaker emphasis: time, repetition or stress the speaker gives it, or whether they call it important.
3. Insight: how non-obvious, specific or perspective-changing it is, rather than generic or commonly known.
4. Actionability: whether it gives a concrete step, method, number or decision rule.
5. Specificity: hard data, named sources and precise mechanisms rank above general statements.
These criteria govern order and emphasis only, never whether the content is correct.

Within each section, list items in order of importance unless the section says otherwise.

Attribution: when more than one person speaks, begin every item with the speaker's name and a colon (e.g. "Dr. Lee: …"). With a single speaker, leave the name out.

Rules:
- Extract only. Do not assess accuracy, validity, quality or strength of evidence. Do not add counterarguments, implications, opinions, outside context or corrections.
- If something said appears wrong or contradicts something else in the source, record it exactly as stated. Do not flag or fix it.
- Use neutral attribution verbs: "states", "says", "explains", "describes", "recommends". Avoid verbs that carry judgment, such as "claims", "admits", "proves" or "concedes".
- Preserve precision: exact numbers, units, qualifiers and hedges as spoken. Do not round, generalize or soften.
- Do not invent or fill gaps. If a word or figure is unclear, write [UNCLEAR] rather than guessing.
- If the source has nothing for a section, set that section's paragraph to "None." and leave its items empty.
- If the reader gives a focus, still extract everything, but treat content relevant to the focus as higher importance.
- The TL;DR is one or two sentences giving the core thesis.`,
    sections: [
      s("most-important", "Most important points", "bullets", "Every point that ranks high under the importance criteria: the core ideas, key insights, critical statistics and main recommendations. No fixed number: include everything that qualifies and nothing that doesn't. Each item here must also appear in full in its own section below."),
      s("speakers", "Speakers", "bullets", "Each speaker as 'Name: role or credentials', as stated or introduced in the source."),
      s("thesis", "Core thesis", "paragraph", "The central argument or purpose of the source, as the speaker(s) present it."),
      s("argument", "Argument as presented", "numbered", "The speaker's reasoning in the order and structure they give it: starting points, supporting points, steps of reasoning, conclusion. Follow presentation order, not importance."),
      s("key-ideas", "Key ideas", "bullets", "Every idea presented. For each: the idea stated precisely; the speaker's explanation of it; the examples, stories or analogies used and the point each makes; and any qualifications or exceptions the speaker attaches."),
      s("insights", "Insights", "bullets", "Every insight, lesson, observation or takeaway the speaker offers, stated as close to their framing as possible."),
      s("statistics", "Statistics and data", "bullets", "Every number, percentage, figure, price, date, measurement or result mentioned, written as: the value and units — what it refers to — the source the speaker cites, or 'no source stated'. Set the item's timestamp."),
      s("evidence", "Studies, cases and evidence cited", "bullets", "Every study, experiment, case, report or real-world example referenced, with the speaker's description of it and what they say it shows."),
      s("frameworks", "Frameworks and models", "bullets", "Every framework, model, method, heuristic, rule of thumb or defined term, as 'Name: the speaker's definition — how it works, as they explain it'."),
      s("stories", "Stories and anecdotes", "bullets", "Each story or personal example, summarized, followed by the lesson the speaker draws from it."),
      s("recommendations", "Recommendations and steps", "numbered", "Every recommendation, instruction, procedure or piece of advice. Give procedure steps in the order given, with specifics (tools, settings, amounts, timing) and any conditions or warnings the speaker attaches."),
      s("predictions", "Predictions and forecasts", "bullets", "Every prediction made, with any timeframe or conditions given."),
      s("against-belief", "Points framed against common belief", "bullets", "Every place the speaker says conventional wisdom is wrong or incomplete, as 'Common view: … Speaker's view: …'."),
      s("disagreements", "Disagreements between speakers", "bullets", "Every disagreement, with each speaker's position as stated."),
      s("caveats", "Caveats and limitations stated", "bullets", "Every limit, risk, exception or uncertainty the speaker raises about their own content."),
      s("resources", "Resources and names mentioned", "bullets", "Every person, organization, book, paper, product, tool, website or other resource mentioned, with the context of the mention."),
      s("quotes", "Key quotations", "bullets", "Verbatim quotes where the exact wording matters: the thesis in the speaker's own words, the most important insights, precise definitions, strong or distinctive positions, memorable formulations. Stay within the quotation limit, choosing the most important. Format: \"quote\" — speaker. Set the item's timestamp."),
      s("questions", "Questions raised", "bullets", "Every question the speaker poses or says remains open."),
      s("summary", "Condensed summary", "paragraph", "A summary of the full content: the thesis, main ideas, key statistics and recommendations, in the speaker's terms. As long as needed to cover all high-importance content."),
    ],
  },
  {
    id: "quick-gist",
    name: "Quick gist",
    description: "The one-minute version: what it is about and the points that matter.",
    icon: "⚡",
    length: "brief",
    includeTimestamps: true,
    builtIn: true,
    sections: [s("key-points", "Key points", "bullets", "The 3–6 most important points, most important first.")],
  },
  {
    id: "takeaways-actions",
    name: "Takeaways and action items",
    description: "What you learned and what to do about it.",
    icon: "✅",
    length: "standard",
    includeTimestamps: true,
    builtIn: true,
    sections: [
      s("takeaways", "Key takeaways", "bullets", "The main lessons or insights, each stated as a complete idea."),
      s("actions", "Action items", "checklist", "Concrete, doable next steps a viewer could take, phrased as tasks starting with a verb."),
      s("resources", "Resources mentioned", "bullets", "Books, tools, websites, people or products the source mentions, with a few words on why. Leave empty if none."),
    ],
  },
  {
    id: "study-notes",
    name: "Study notes",
    description: "Concepts, definitions and review questions for learning.",
    icon: "📚",
    length: "detailed",
    includeTimestamps: true,
    builtIn: true,
    sections: [
      s("concepts", "Core concepts", "bullets", "Each key concept with a one-to-two sentence explanation in plain language."),
      s("definitions", "Terms and definitions", "bullets", "Technical terms introduced, formatted as 'Term: definition'."),
      s("examples", "Examples", "bullets", "Worked examples or illustrations the source uses, briefly described."),
      s("review", "Review questions", "numbered", "4–6 questions that test understanding of the material."),
    ],
  },
  {
    id: "tutorial-steps",
    name: "How-to steps",
    description: "Turn a tutorial into a step-by-step checklist.",
    icon: "🛠️",
    length: "standard",
    includeTimestamps: true,
    builtIn: true,
    sections: [
      s("before", "Before you start", "bullets", "Prerequisites, tools, materials, accounts or skills needed."),
      s("steps", "Steps", "numbered", "The procedure in order, one action per step, including key settings or values."),
      s("tips", "Tips and pitfalls", "bullets", "Warnings, common mistakes and tips the source gives."),
    ],
  },
  {
    id: "podcast-highlights",
    name: "Podcast highlights",
    description: "Who spoke, what was discussed and the moments worth hearing.",
    icon: "🎙️",
    length: "standard",
    includeTimestamps: true,
    builtIn: true,
    sections: [
      s("who", "Who's talking", "bullets", "Host(s) and guest(s) with their role or credentials, if stated."),
      s("topics", "Topics covered", "bullets", "The main topics in the order discussed."),
      s("insights", "Notable insights", "bullets", "The most interesting or useful ideas, opinions or stories."),
      s("resources", "Resources mentioned", "bullets", "Books, links, products or people mentioned. Leave empty if none."),
    ],
  },
  {
    id: "research-brief",
    name: "Research brief",
    description: "Claims, evidence and caveats, for when accuracy matters.",
    icon: "🔎",
    length: "detailed",
    includeTimestamps: true,
    builtIn: true,
    sections: [
      s("claims", "Main claims", "bullets", "The central claims or arguments the source makes."),
      s("evidence", "Evidence offered", "bullets", "Data, studies, examples or sources cited in support of each claim. Say when a claim has no support offered."),
      s("caveats", "Caveats and open questions", "bullets", "Limitations, counterpoints, potential bias or things a careful reader should verify."),
    ],
  },
  {
    id: "decision-brief",
    name: "Decision brief",
    description: "For managers and owners: implications, risks and next steps.",
    icon: "📈",
    length: "standard",
    tone: "concise and businesslike",
    audience: "a busy decision-maker",
    includeTimestamps: false,
    builtIn: true,
    sections: [
      s("so-what", "Why it matters", "paragraph", "Two or three sentences on the relevance and implications."),
      s("opportunities", "Opportunities", "bullets", "Opportunities or benefits identified."),
      s("risks", "Risks", "bullets", "Risks, costs or downsides identified."),
      s("next", "Recommended next steps", "checklist", "Practical next steps for the reader."),
    ],
  },
  {
    id: "recipe-card",
    name: "Recipe card",
    description: "Ingredients and method from a cooking video or blog.",
    icon: "🍳",
    length: "standard",
    includeTimestamps: true,
    builtIn: true,
    sections: [
      s("ingredients", "Ingredients", "checklist", "Every ingredient with quantity, in metric where given (keep the source's units if only imperial)."),
      s("method", "Method", "numbered", "Cooking steps in order with times and temperatures."),
      s("notes", "Notes", "bullets", "Substitutions, make-ahead or storage tips."),
    ],
  },
];

export function findTemplate(id: string, custom: ExtractionTemplate[] = []): ExtractionTemplate | undefined {
  return custom.find((t) => t.id === id) ?? BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

export const LENGTH_GUIDANCE: Record<ExtractionTemplate["length"], string> = {
  brief: "Keep the whole gist under about 150 words. Prefer fewer, sharper points.",
  standard: "Keep the whole gist under about 400 words.",
  detailed: "Be thorough but tight; up to about 900 words.",
  exhaustive:
    "No length limit and no item limits. Completeness comes first: capture every substantive point, including minor ones. Never truncate, sample, compress to save space, or write \"among others\". The most important material must be the most prominent.",
};

/** The id of the template new accounts use until they pick another. */
export const DEFAULT_TEMPLATE_ID = "full-extraction";

/** Validates a user-supplied template. Returns an error message or null. */
export function validateTemplate(t: Partial<ExtractionTemplate>): string | null {
  if (!t.name || t.name.trim().length < 2) return "Give the template a name.";
  if (!Array.isArray(t.sections) || t.sections.length === 0) return "Add at least one section.";
  if (t.sections.length > 20) return "Use 20 sections or fewer.";
  for (const sec of t.sections) {
    if (!sec.heading?.trim()) return "Every section needs a heading.";
    if (!sec.instruction?.trim()) return `Tell us what to extract for "${sec.heading}".`;
    if (!["bullets", "paragraph", "checklist", "numbered"].includes(sec.format)) return `Unknown format for "${sec.heading}".`;
  }
  if (t.length && !["brief", "standard", "detailed", "exhaustive"].includes(t.length)) return "Unknown length.";
  return null;
}
