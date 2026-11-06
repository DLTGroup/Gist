import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  SLOT_OF, changeFromPrevious, entryTime, formatMinutes, formatMoney, paceUntil, periodRange, periodSlots, recentPace, sumRange,
  type Period, type PeriodSlot,
} from "@gist/core";
import { api, type SavingsReport } from "../api.ts";

const KIND = { youtube: "Videos", podcast: "Podcasts", web: "Articles", text: "Pasted text" } as Record<string, string>;

const PERIODS: Record<Period, { name: string; slot: string; current: string; before: string }> = {
  day: { name: "Day", slot: "hour", current: "today", before: "the day before" },
  week: { name: "Week", slot: "day", current: "this week", before: "the week before" },
  month: { name: "Month", slot: "day", current: "this month", before: "the month before" },
  year: { name: "Year", slot: "month", current: "this year", before: "the year before" },
};
const PERIOD_KEY = "gist-savings-period";

function readPeriod(): Period {
  try {
    const p = localStorage.getItem(PERIOD_KEY);
    if (p && p in PERIODS) return p as Period;
  } catch {
    // Storage can be unavailable (private windows); the default is fine.
  }
  return "week";
}

const hourName = (h: number) => (h === 0 ? "12 a.m." : h === 12 ? "Noon" : h < 12 ? `${h} a.m.` : `${h - 12} p.m.`);

function rangeName(start: Date, end: Date, p: Period, offset: number): string {
  const last = new Date(end.getTime() - 1);
  const md = (d: Date) => d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  if (p === "day") return `${offset === 0 ? "Today, " : offset === -1 ? "Yesterday, " : ""}${start.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}`;
  if (p === "week") return `${md(start)} – ${start.getMonth() === last.getMonth() ? last.getDate() : md(last)}, ${last.getFullYear()}`;
  if (p === "month") return start.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  return String(start.getFullYear());
}

/** The label under a bar, if it gets one. */
function tick(s: PeriodSlot, p: Period, i: number): string[] | null {
  const d = s.start;
  if (p === "day") return i % 6 === 0 ? [hourName(i)] : null;
  if (p === "week") return [d.toLocaleDateString("en-CA", { weekday: "short" }), String(d.getDate())];
  if (p === "month") return d.getDate() === 1 || (d.getDate() % 5 === 0 && d.getDate() < 31) ? [String(d.getDate())] : null;
  return [d.toLocaleDateString("en-CA", { month: "short" })];
}

function slotName(s: PeriodSlot, p: Period): string {
  if (p === "day") return `${hourName(s.start.getHours())} to ${hourName((s.start.getHours() + 1) % 24)}`;
  if (p === "year") return s.start.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  return s.start.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
}

const compactMinutes = (m: number) => (m < 1 ? "" : m < 60 ? `${Math.round(m)}m` : `${(m / 60 >= 100 ? Math.round(m / 60) : (m / 60).toFixed(1).replace(/\.0$/, ""))}h`);
const compactMoney = (n: number) => (n < 1 ? "" : n >= 1000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `$${Math.round(n)}`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function SavingsPage() {
  const [r, setR] = useState<SavingsReport | null>(null);
  const [period, setPeriod] = useState<Period>(readPeriod);
  const [offset, setOffset] = useState(0);
  const [metric, setMetric] = useState<"time" | "money">("time");
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    api.savings().then(setR, () => {});
  }, []);

  const view = useMemo(() => {
    if (!r) return null;
    const now = new Date();
    const entries = r.hourly ?? [];
    const { start, end } = periodRange(period, now, offset);
    const slots = periodSlots(entries, period, now, offset);
    const total = sumRange(entries, start, end);
    const pace = recentPace(entries, now);
    const running = offset === 0;
    // Outlined bars: the rest of a running week, month or year at the recent pace. Hours are too lumpy for that.
    const ghosts = slots.map((s) => (running && period !== "day" && pace.gists > 0 && (s.future || s.current) ? paceUntil(pace, s.end, now, s.start) : null));
    const ahead = running ? paceUntil(pace, end, now) : null;
    const change = changeFromPrevious(entries, period, now, offset);
    const kinds = [...new Set(entries.map((e) => e.kind))].map((kind) => ({ kind, ...sumRange(entries, start, end, kind) })).filter((k) => k.gists > 0);
    const first = entries.length ? Math.min(...entries.map((e) => entryTime(e).getTime())) : now.getTime();
    return { now, start, end, slots, total, pace, ghosts, ahead, change, kinds, canGoBack: start.getTime() > first, running };
  }, [r, period, offset]);

  if (!r || !view) return <p className="muted">Loading…</p>;
  const t = r.totals;
  const P = PERIODS[period];
  const { start, end, slots, total, pace, ghosts, ahead, change, kinds, canGoBack, running } = view;
  const value = (b: { minutesSaved: number; moneySaved: number }) => (metric === "time" ? b.minutesSaved : b.moneySaved);
  const show = (n: number) => (metric === "time" ? formatMinutes(n) : formatMoney(n, t.currency));
  const max = Math.max(1e-9, ...slots.map((s, i) => value(s) + (ghosts[i] ? value(ghosts[i]!) : 0)));
  const elapsed = slots.filter((s) => !s.future);
  const avg = elapsed.length ? elapsed.reduce((a, s) => a + value(s), 0) / elapsed.length : 0;
  const best = slots.reduce((m, s) => (value(s) > value(m) ? s : m), slots[0]);
  const sel = selected !== null ? slots[selected] ?? null : null;
  const many = slots.length > 12;
  const range = rangeName(start, end, period, offset);

  const choosePeriod = (p: Period) => {
    setPeriod(p);
    setOffset(0);
    setSelected(null);
    try {
      localStorage.setItem(PERIOD_KEY, p);
    } catch {
      // Not remembered; nothing else depends on it.
    }
  };
  const step = (k: number) => {
    setOffset((o) => Math.min(0, o + k));
    setSelected(null);
  };

  return (
    <div className="stack">
      <h1>Your savings</h1>
      {t.gists === 0 ? (
        <div className="card">
          <p>Make your first gist to start tracking the time and money you save.</p>
          <Link className="btn btn-primary" to="/app/new">Make a gist</Link>
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            All time: <strong>{formatMinutes(t.minutesSaved)}</strong> saved, worth <strong>{formatMoney(t.moneySaved, t.currency)}</strong>, across {plural(t.gists, "gist")}.
          </p>

          <div className="savings-bar">
            <div className="seg seg-lg" role="radiogroup" aria-label="Show savings for one">
              {(Object.keys(PERIODS) as Period[]).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={p === period} className={p === period ? "on" : ""} onClick={() => choosePeriod(p)}>
                  {PERIODS[p].name}
                </button>
              ))}
            </div>
            <div className="savings-nav">
              <button type="button" className="btn-ghost nav-step" aria-label={`Previous ${period}`} disabled={!canGoBack} onClick={() => step(-1)}>‹</button>
              <strong aria-live="polite">{range}</strong>
              <button type="button" className="btn-ghost nav-step" aria-label={`Next ${period}`} disabled={running} onClick={() => step(1)}>›</button>
              {!running && <button type="button" className="link" onClick={() => step(-offset)}>Back to {P.current}</button>}
            </div>
          </div>

          <div className="kpis">
            <div className="card kpi"><span className="v">{formatMinutes(total.minutesSaved)}</span><span className="l">time saved</span></div>
            <div className="card kpi"><span className="v">{formatMoney(total.moneySaved, t.currency)}</span><span className="l">value of that time</span></div>
            <div className="card kpi"><span className="v">{total.gists}</span><span className="l">{total.gists === 1 ? "gist" : "gists"}</span></div>
            <div className="card kpi">
              <span className="v">{change === null ? (total.minutesSaved > 0 ? "New" : "–") : `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}%`}</span>
              <span className="l">{change === null ? `nothing ${running ? "by this point in" : "in"} ${P.before}` : `vs ${P.before}${running ? ", same point" : ""}`}</span>
            </div>
          </div>

          <div className="card">
            <div className="savings-chart-head">
              <h2>{metric === "time" ? "Time saved" : "Value saved"} by {P.slot}</h2>
              <div className="seg seg-sm" role="radiogroup" aria-label="Measure">
                <button type="button" role="radio" aria-checked={metric === "time"} className={metric === "time" ? "on" : ""} onClick={() => setMetric("time")}>Time</button>
                <button type="button" role="radio" aria-checked={metric === "money"} className={metric === "money" ? "on" : ""} onClick={() => setMetric("money")}>Value</button>
              </div>
            </div>
            <div className={`pbars${many ? " many" : ""}`} role="group" aria-label={`${metric === "time" ? "Time" : "Value"} saved by ${P.slot}, ${range}`}>
              {slots.map((s, i) => {
                const v = value(s);
                const g = ghosts[i] ? value(ghosts[i]!) : 0;
                const label = tick(s, period, i);
                return (
                  <button
                    key={s.start.getTime()}
                    type="button"
                    className={`${s === sel ? "sel" : ""}${s.future ? " fut" : ""}`}
                    aria-pressed={s === sel}
                    title={`${slotName(s, period)}: ${show(v)}${g ? ` (about ${show(g)} more at your recent pace)` : ""}`}
                    onClick={() => setSelected(s === sel ? null : i)}
                  >
                    {!many && <small className="v">{metric === "time" ? compactMinutes(v) : compactMoney(v)}</small>}
                    <span className="pstack">
                      {g > 0 && <span className="proj" style={{ height: `${(g / max) * 86}%` }} />}
                      <span className={`b${s.current ? " now" : ""}`} style={{ height: `${v > 0 ? Math.max(3, (v / max) * 86) : s.future ? 0 : 1.5}%` }} />
                    </span>
                    <small className="lb">
                      {label && (
                        <span className={`tk${period === "day" && i === 0 ? " first" : ""}`}>
                          {label.map((x, j) => <span key={j}>{j ? " " : ""}{x}</span>)}
                        </span>
                      )}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="pdetail" aria-live="polite">
              {sel ? (
                <>
                  <strong>{slotName(sel, period)}{period === "day" ? `, ${sel.start.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : ""}</strong>
                  <span>{formatMinutes(sel.minutesSaved)} saved · {formatMoney(sel.moneySaved, t.currency)} · {plural(sel.gists, "gist")}</span>
                  <button type="button" className="link" onClick={() => setSelected(null)}>Show the whole {period}</button>
                </>
              ) : (
                <>
                  <strong>{range}</strong>
                  <span>{formatMinutes(total.minutesSaved)} saved · {formatMoney(total.moneySaved, t.currency)} · {plural(total.gists, "gist")}</span>
                  {ahead && pace.gists > 0 && (
                    <span className="muted">
                      At your recent pace, {P.current} ends near {formatMinutes(total.minutesSaved + ahead.minutesSaved)} ({formatMoney(total.moneySaved + ahead.moneySaved, t.currency)}).
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="pmeta">
              <div><span>Average per {P.slot}</span><b>{show(avg)}</b><small>{running ? "so far" : ""}</small></div>
              <div><span>Best {P.slot}</span><b>{value(best) > 0 ? show(value(best)) : "–"}</b><small>{value(best) > 0 ? slotName(best, period) : ""}</small></div>
              <div><span>At your recent pace</span><b>{formatMinutes(pace.minutesPerDay * 365)}</b><small>a year, worth {formatMoney(pace.moneyPerDay * 365, t.currency)}</small></div>
            </div>
            <p className="muted small">
              {ghosts.some(Boolean) ? `Outlined bars are where the rest of ${P.current} is heading at your pace over the last 28 days. ` : ""}Select a bar for its details.
            </p>
          </div>

          <div className="card">
            <h2>By source</h2>
            {kinds.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr className="muted small" style={{ textAlign: "left" }}><th>Type</th><th>Gists</th><th>Time saved</th><th>Value</th></tr>
                </thead>
                <tbody>
                  {kinds.map((k) => (
                    <tr key={k.kind}>
                      <td>{KIND[k.kind] ?? k.kind}</td>
                      <td>{k.gists}</td>
                      <td>{formatMinutes(k.minutesSaved)}</td>
                      <td>{formatMoney(k.moneySaved, t.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No gists in this {period}.</p>
            )}
          </div>

          <div className="card">
            <h2>Effort</h2>
            <p>
              Watching, listening, reading and taking notes on all your gists would have taken about <strong>{formatMinutes(t.originalMinutes)}</strong>. Reading the gists takes about{" "}
              <strong>{formatMinutes(t.gistMinutes)}</strong>, which is {t.originalMinutes > 0 ? Math.round((1 - t.gistMinutes / t.originalMinutes) * 100) : 0}% less effort, and{" "}
              {Math.round(t.wordsAvoided).toLocaleString("en-CA")} words you didn't have to process.
            </p>
          </div>
        </>
      )}
      <p className="muted small">
        How we estimate: original length at {r.assumptions.playbackSpeed}× playback (or reading at {r.assumptions.readingWpm} words per minute), plus{" "}
        {Math.round(r.assumptions.noteTakingFactor * 100)}% for taking notes by hand, minus the time to read the gist. Your time is valued at{" "}
        {formatMoney(r.assumptions.hourlyRate, r.assumptions.currency)} an hour. Recent pace is your last 28 days. <Link to="/app/settings">Change these in Settings.</Link>
      </p>
    </div>
  );
}
