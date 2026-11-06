/**
 * Savings for one day, week, month or year. The server groups savings by hour in the person's
 * time zone; these helpers pick out one period and split it into bars on the device, in local
 * time: a day into hours, a week or month into days, a year into months.
 */

export type Period = "day" | "week" | "month" | "year";
type Unit = Period | "hour";

/** One hour of savings for one source kind, as the savings report returns it. */
export interface HourlySavings {
  /** YYYY-MM-DD in the person's time zone. */
  date: string;
  /** 0–23 in the person's time zone. */
  hour: number;
  kind: string;
  gists: number;
  minutesSaved: number;
  moneySaved: number;
}

export interface SavingsSum {
  gists: number;
  minutesSaved: number;
  moneySaved: number;
}

export interface PeriodSlot extends SavingsSum {
  start: Date;
  end: Date;
  /** The slot hasn't started yet. */
  future: boolean;
  /** The slot is happening now. */
  current: boolean;
}

/** What each period is split into. */
export const SLOT_OF: Record<Period, Unit> = { day: "hour", week: "day", month: "day", year: "month" };

const DAY_MS = 864e5;

/** Start of the period containing `d`, in local time. Weeks start on Monday. */
export function periodStart(d: Date, p: Unit): Date {
  if (p === "hour") return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (p === "week") s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  if (p === "month") s.setDate(1);
  if (p === "year") s.setMonth(0, 1);
  return s;
}

export function addPeriods(d: Date, p: Unit, k: number): Date {
  const s = new Date(d);
  if (p === "hour") s.setHours(s.getHours() + k);
  else if (p === "day") s.setDate(s.getDate() + k);
  else if (p === "week") s.setDate(s.getDate() + 7 * k);
  else if (p === "month") s.setMonth(s.getMonth() + k);
  else s.setFullYear(s.getFullYear() + k);
  return s;
}

/** The local time an hourly entry starts at. */
export function entryTime(x: Pick<HourlySavings, "date" | "hour">): Date {
  const [y, m, d] = x.date.split("-").map(Number);
  return new Date(y, m - 1, d, x.hour);
}

/** The period `offset` steps from the one containing `now` (0 = current, −1 = the one before). */
export function periodRange(p: Period, now = new Date(), offset = 0): { start: Date; end: Date } {
  const start = addPeriods(periodStart(now, p), p, offset);
  return { start, end: addPeriods(start, p, 1) };
}

/** The savings in [from, to), optionally for one source kind. */
export function sumRange(entries: HourlySavings[], from: Date, to: Date, kind?: string): SavingsSum {
  const t = { gists: 0, minutesSaved: 0, moneySaved: 0 };
  for (const x of entries) {
    const at = entryTime(x).getTime();
    if (at < from.getTime() || at >= to.getTime() || (kind && x.kind !== kind)) continue;
    t.gists += x.gists;
    t.minutesSaved += x.minutesSaved;
    t.moneySaved += x.moneySaved;
  }
  return t;
}

/** The bars for one period: its hours, days or months, in order. */
export function periodSlots(entries: HourlySavings[], p: Period, now = new Date(), offset = 0): PeriodSlot[] {
  const { start, end } = periodRange(p, now, offset);
  const unit = SLOT_OF[p];
  const slots: PeriodSlot[] = [];
  for (let a = start; a < end; a = addPeriods(a, unit, 1)) {
    const b = addPeriods(a, unit, 1);
    slots.push({ start: a, end: b, ...sumRange(entries, a, b), future: a > now, current: a <= now && now < b });
  }
  return slots;
}

/** Savings per day over the last 28 days, up to now. Used for pace and projections. */
export function recentPace(entries: HourlySavings[], now = new Date()) {
  const t = sumRange(entries, new Date(now.getTime() - 28 * DAY_MS), new Date(now.getTime() + 1));
  return { gists: t.gists, minutesPerDay: t.minutesSaved / 28, moneyPerDay: t.moneySaved / 28 };
}

/** What the recent pace adds between now (or `from`, if later) and `end`. */
export function paceUntil(pace: ReturnType<typeof recentPace>, end: Date, now = new Date(), from = now): SavingsSum {
  const days = Math.max(0, (end.getTime() - Math.max(from.getTime(), now.getTime())) / DAY_MS);
  return { gists: 0, minutesSaved: pace.minutesPerDay * days, moneySaved: pace.moneyPerDay * days };
}

/**
 * The shown period against the one before. While the shown period is still running, the one
 * before counts only up to the same point; otherwise all of it. Null when the one before had nothing.
 */
export function changeFromPrevious(entries: HourlySavings[], p: Period, now = new Date(), offset = 0): number | null {
  const { start, end } = periodRange(p, now, offset);
  const prevStart = addPeriods(start, p, -1);
  const running = offset === 0;
  const prevEnd = running ? new Date(prevStart.getTime() + (now.getTime() - start.getTime())) : start;
  const before = sumRange(entries, prevStart, prevEnd).minutesSaved;
  const shown = sumRange(entries, start, running ? new Date(now.getTime() + 1) : end).minutesSaved;
  return before > 0 ? Math.round((shown / before - 1) * 100) : null;
}
