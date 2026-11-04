import type { IngestedSource, Savings, SavingsAssumptions, Summary } from "./types.ts";
import { countWords } from "./sources.ts";

/**
 * Default assumptions. All are user-adjustable in Settings and shown in the UI,
 * so the savings figures are transparent estimates rather than claims.
 */
export const DEFAULT_ASSUMPTIONS: SavingsAssumptions = {
  readingWpm: 238, // commonly cited average for adult silent reading of non-fiction (Brysbaert, 2019)
  noteTakingFactor: 0.35, // extra time to pause, rewind and write notes by hand
  hourlyRate: 35,
  currency: "CAD",
  playbackSpeed: 1,
};

export function summaryText(summary: Summary): string {
  const parts = [summary.title, summary.tldr];
  for (const sec of summary.sections) {
    parts.push(sec.heading);
    if (sec.paragraph) parts.push(sec.paragraph);
    for (const item of sec.items) parts.push(item.text);
  }
  return parts.join("\n");
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeSavings(
  source: Pick<IngestedSource, "kind" | "durationSeconds"> & { wordCount: number },
  summary: Summary,
  a: SavingsAssumptions = DEFAULT_ASSUMPTIONS,
): Savings {
  const gistWords = countWords(summaryText(summary));
  const sourceWords = source.wordCount;
  const isTimed = (source.kind === "youtube" || source.kind === "podcast") && source.durationSeconds;
  const originalMinutes = isTimed
    ? (source.durationSeconds as number) / 60 / Math.max(0.5, a.playbackSpeed)
    : sourceWords / a.readingWpm;
  const manualNotesMinutes = originalMinutes * a.noteTakingFactor;
  const gistMinutes = gistWords / a.readingWpm;
  const minutesSaved = Math.max(0, originalMinutes + manualNotesMinutes - gistMinutes);
  return {
    originalMinutes: round1(originalMinutes),
    manualNotesMinutes: round1(manualNotesMinutes),
    gistMinutes: round1(gistMinutes),
    minutesSaved: round1(minutesSaved),
    moneySaved: round2((minutesSaved / 60) * a.hourlyRate),
    currency: a.currency,
    sourceWords,
    gistWords,
    effortReduction: sourceWords > 0 ? round2(Math.max(0, 1 - gistWords / sourceWords)) : 0,
  };
}

export interface SavingsTotals {
  gists: number;
  minutesSaved: number;
  moneySaved: number;
  wordsAvoided: number;
  originalMinutes: number;
  gistMinutes: number;
  currency: string;
}

export function totalSavings(items: Savings[], currency = DEFAULT_ASSUMPTIONS.currency): SavingsTotals {
  const t = items.reduce(
    (acc, s) => {
      acc.minutesSaved += s.minutesSaved;
      acc.moneySaved += s.moneySaved;
      acc.wordsAvoided += Math.max(0, s.sourceWords - s.gistWords);
      acc.originalMinutes += s.originalMinutes + s.manualNotesMinutes;
      acc.gistMinutes += s.gistMinutes;
      return acc;
    },
    { gists: items.length, minutesSaved: 0, moneySaved: 0, wordsAvoided: 0, originalMinutes: 0, gistMinutes: 0, currency },
  );
  t.minutesSaved = round1(t.minutesSaved);
  t.moneySaved = round2(t.moneySaved);
  t.originalMinutes = round1(t.originalMinutes);
  t.gistMinutes = round1(t.gistMinutes);
  return t;
}

export function formatMinutes(min: number): string {
  if (min < 1) return `${Math.max(1, Math.round(min * 60))} sec`;
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatMoney(amount: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: amount < 100 ? 2 : 0 }).format(amount);
}
