/** Shared domain types used by the API, web, desktop and mobile clients. */

export type SourceKind = "youtube" | "podcast" | "web" | "text";

/** Normalized content pulled from a link before summarization. Never persisted in full. */
export interface IngestedSource {
  kind: SourceKind;
  url: string | null;
  title: string;
  /** Channel, show, site or author name, used for attribution. */
  author: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
  /** Length of the original in seconds (video/audio). Null for text sources. */
  durationSeconds: number | null;
  /** Plain text of the transcript or article. */
  text: string;
  /** Optional timed segments (video/audio) so the summary can cite timestamps. */
  segments?: { start: number; text: string }[];
  /** Language code where known (e.g. "en"). */
  language?: string | null;
  /** Direct audio file for podcast episodes, used for timestamp links. */
  audioUrl?: string | null;
  /** Where the reader can open the original and its transcript. Links only: the text itself is never stored. */
  links?: SourceLink[];
  /**
   * Set when the model should watch the video itself rather than read a transcript (no captions,
   * captions blocked, or video-first mode). `text` may then be empty.
   */
  video?: { url: string };
}

/** A link from a gist back to its source: the original page, its transcript or its audio. */
export interface SourceLink {
  kind: "original" | "transcript" | "audio";
  label: string;
  url: string;
  /** Short help text, e.g. where YouTube keeps the transcript. */
  note?: string;
}

export type SectionFormat = "bullets" | "paragraph" | "checklist" | "numbered";

export interface TemplateSection {
  id: string;
  heading: string;
  /** Plain-language instruction telling the model what to extract for this section. */
  instruction: string;
  format: SectionFormat;
}

export type Length = "brief" | "standard" | "detailed" | "exhaustive";

export interface ExtractionTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  sections: TemplateSection[];
  length: Length;
  /** Optional tone/voice, e.g. "plain language", "executive". */
  tone?: string;
  /** Who the notes are for, e.g. "a busy small-business owner". */
  audience?: string;
  includeTimestamps: boolean;
  /** Standing instructions for this template, e.g. how to rank and attribute (shown to the model). */
  guidance?: string;
  /** Direct-quotation allowance. Defaults to 2 quotes of 20 words or fewer (see docs/LEGAL-NOTES.md). */
  quotes?: { max: number; maxWords: number };
  builtIn?: boolean;
}

export interface SummaryItem {
  text: string;
  /** Seconds into the source, when the point can be located. */
  timestamp: number | null;
}

export interface SummarySection {
  id: string;
  heading: string;
  format: SectionFormat;
  paragraph: string | null;
  items: SummaryItem[];
}

export interface Summary {
  title: string;
  tldr: string;
  sections: SummarySection[];
  suggestedTags: string[];
}

export interface SavingsAssumptions {
  /** Reading speed in words per minute (adult silent reading, non-fiction). */
  readingWpm: number;
  /** Extra time spent taking notes manually, as a fraction of consumption time. */
  noteTakingFactor: number;
  /** Value of the user's time, per hour, in their currency. */
  hourlyRate: number;
  currency: string;
  /** Playback speed the user would otherwise use for video/audio. */
  playbackSpeed: number;
}

export interface Savings {
  /** Minutes to watch/listen/read the original at the user's usual speed. */
  originalMinutes: number;
  /** Minutes the user would also spend writing notes by hand. */
  manualNotesMinutes: number;
  /** Minutes to read the gist. */
  gistMinutes: number;
  minutesSaved: number;
  moneySaved: number;
  currency: string;
  sourceWords: number;
  gistWords: number;
  /** 0–1: share of reading/processing avoided. */
  effortReduction: number;
}

export interface Gist {
  id: string;
  userId: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  source: Omit<IngestedSource, "text" | "segments"> & { wordCount: number };
  templateId: string;
  focus: string | null;
  summary: Summary | null;
  savings: Savings | null;
  folderId: string | null;
  tags: string[];
  favourite: boolean;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  colour: string | null;
  gistCount?: number;
}

export type ExportTarget = "markdown" | "obsidian" | "notion" | "evernote" | "webhook" | "text";

export interface UserSettings {
  hourlyRate: number;
  currency: string;
  playbackSpeed: number;
  defaultTemplateId: string;
  autoExport: ExportTarget | null;
  obsidianVault: string | null;
  obsidianFolder: string | null;
  notionToken: string | null;
  notionParentPageId: string | null;
  webhookUrl: string | null;
}
