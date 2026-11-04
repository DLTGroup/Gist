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
};

/** Validates a user-supplied template. Returns an error message or null. */
export function validateTemplate(t: Partial<ExtractionTemplate>): string | null {
  if (!t.name || t.name.trim().length < 2) return "Give the template a name.";
  if (!Array.isArray(t.sections) || t.sections.length === 0) return "Add at least one section.";
  if (t.sections.length > 10) return "Use 10 sections or fewer.";
  for (const sec of t.sections) {
    if (!sec.heading?.trim()) return "Every section needs a heading.";
    if (!sec.instruction?.trim()) return `Tell us what to extract for "${sec.heading}".`;
    if (!["bullets", "paragraph", "checklist", "numbered"].includes(sec.format)) return `Unknown format for "${sec.heading}".`;
  }
  if (t.length && !["brief", "standard", "detailed"].includes(t.length)) return "Unknown length.";
  return null;
}
