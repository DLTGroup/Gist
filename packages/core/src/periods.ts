/**
 * Savings by day, week, month or year. The server groups savings by calendar day in the
 * person's time zone; these helpers roll those days up into periods on the device, in local time.
 */

export type Period = "day" | "week" | "month" | "year";

/** One calendar day of savings for one source kind, as the savings report returns it. */
export interface DailySavings {
  /** YYYY-MM-DD in the person's time zone. */
  date: string;
  kind: string;
  gists: number;
  minutesSaved: number;
  moneySaved: number;
}

export interface PeriodBucket {
  start: Date;
  end: Date;
  gists: number;
  minutesSaved: number;
  moneySaved: number;
  current: boolean;
}

/** How many bars each period shows by default. Years grow from the first gist (see bucketSavings). */
export const PERIOD_BARS: Record<Period, number> = { day: 14, week: 12, month: 12, year: 3 };

const DAY_MS = 864e5;

/** Start of the period containing `d`, in local time. Weeks start on Monday. */
export function periodStart(d: Date, p: Period): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (p === "week") s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  if (p === "month") s.setDate(1);
  if (p === "year") s.setMonth(0, 1);
  return s;
}

export function addPeriods(d: Date, p: Period, k: number): Date {
  const s = new Date(d);
  if (p === "day") s.setDate(s.getDate() + k);
  else if (p === "week") s.setDate(s.getDate() + 7 * k);
  else if (p === "month") s.setMonth(s.getMonth() + k);
  else s.setFullYear(s.getFullYear() + k);
  return s;
}

/** Parses YYYY-MM-DD as local midnight. */
export function localDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The savings in [from, to), optionally for one source kind. */
export function sumDays(days: DailySavings[], from: Date, to: Date, kind?: string) {
  const t = { gists: 0, minutesSaved: 0, moneySaved: 0 };
  for (const x of days) {
    const at = localDay(x.date).getTime();
    if (at < from.getTime() || at >= to.getTime() || (kind && x.kind !== kind)) continue;
    t.gists += x.gists;
    t.minutesSaved += x.minutesSaved;
    t.moneySaved += x.moneySaved;
  }
  return t;
}

/** The last `n` periods up to and including the current one, oldest first. */
export function bucketSavings(days: DailySavings[], p: Period, now = new Date(), n?: number): PeriodBucket[] {
  let count = n ?? PERIOD_BARS[p];
  if (p === "year" && n === undefined && days.length) {
    // From the first gist's year: at least 3 bars, at most 10.
    const first = Math.min(...days.map((x) => localDay(x.date).getFullYear()));
    count = Math.min(10, Math.max(PERIOD_BARS.year, now.getFullYear() - first + 1));
  }
  const cur = periodStart(now, p);
  const out: PeriodBucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addPeriods(cur, p, -i);
    const end = addPeriods(start, p, 1);
    out.push({ start, end, ...sumDays(days, start, end), current: i === 0 });
  }
  return out;
}

/** Savings per day over the last 28 days, including today. Used for pace and projections. */
export function recentPace(days: DailySavings[], now = new Date()) {
  const today = periodStart(now, "day");
  const t = sumDays(days, addPeriods(today, "day", -27), addPeriods(today, "day", 1));
  return { gists: t.gists, minutesPerDay: t.minutesSaved / 28, moneyPerDay: t.moneySaved / 28 };
}

/** Where the current period is heading: what's saved so far plus the recent pace for the days left. */
export function projectCurrent(bucket: PeriodBucket, pace: ReturnType<typeof recentPace>, now = new Date()) {
  const daysLeft = Math.max(0, (bucket.end.getTime() - now.getTime()) / DAY_MS);
  return { minutesSaved: bucket.minutesSaved + pace.minutesPerDay * daysLeft, moneySaved: bucket.moneySaved + pace.moneyPerDay * daysLeft };
}

/**
 * The current period against the previous one at the same point. With daily data, "the same point"
 * means the same number of whole days (today included); a day is compared with all of yesterday.
 * Returns null when the previous period had nothing by then.
 */
export function changeFromPrevious(days: DailySavings[], p: Period, now = new Date()): number | null {
  const cur = periodStart(now, p);
  const today = periodStart(now, "day");
  const elapsedDays = Math.round((today.getTime() - cur.getTime()) / DAY_MS) + 1;
  const prevStart = addPeriods(cur, p, -1);
  const prevEnd = p === "day" ? cur : new Date(Math.min(addPeriods(prevStart, "day", elapsedDays).getTime(), cur.getTime()));
  const before = sumDays(days, prevStart, prevEnd).minutesSaved;
  const nowSaved = sumDays(days, cur, addPeriods(today, "day", 1)).minutesSaved;
  return before > 0 ? Math.round((nowSaved / before - 1) * 100) : null;
}
