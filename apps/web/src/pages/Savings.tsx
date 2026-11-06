import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  bucketSavings, changeFromPrevious, formatMinutes, formatMoney, projectCurrent, recentPace, sumDays,
  type Period, type PeriodBucket,
} from "@gist/core";
import { api, type SavingsReport } from "../api.ts";

const KIND = { youtube: "Videos", podcast: "Podcasts", web: "Articles", text: "Pasted text" } as Record<string, string>;

const PERIODS: Record<Period, { name: string; unit: string; current: string; previous: string }> = {
  day: { name: "Day", unit: "day", current: "today", previous: "yesterday" },
  week: { name: "Week", unit: "week", current: "this week", previous: "last week" },
  month: { name: "Month", unit: "month", current: "this month", previous: "last month" },
  year: { name: "Year", unit: "year", current: "this year", previous: "last year" },
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

/** Short bar label in two parts, so narrow screens can stack them. */
function barLabel(b: PeriodBucket, p: Period): [string, string?] {
  const d = b.start;
  if (p === "day") return b.current ? ["Today"] : [String(d.getDate())];
  if (p === "week") return b.current ? ["This", "wk"] : [d.toLocaleDateString("en-CA", { month: "short" }), String(d.getDate())];
  if (p === "month") return [d.toLocaleDateString("en-CA", { month: "short" }), d.getMonth() === 0 ? `’${String(d.getFullYear()).slice(2)}` : undefined];
  return [String(d.getFullYear())];
}

function longLabel(d: Date, p: Period): string {
  if (p === "day") return d.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
  if (p === "week") return `Week of ${d.toLocaleDateString("en-CA", { month: "long", day: "numeric" })}`;
  if (p === "month") return d.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  return String(d.getFullYear());
}

const compactMinutes = (m: number) => (m < 1 ? "" : m < 60 ? `${Math.round(m)}m` : `${(m / 60 >= 100 ? Math.round(m / 60) : (m / 60).toFixed(1).replace(/\.0$/, ""))}h`);
const compactMoney = (n: number) => (n < 1 ? "" : n >= 1000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `$${Math.round(n)}`);

export function SavingsPage() {
  const [r, setR] = useState<SavingsReport | null>(null);
  const [period, setPeriod] = useState<Period>(readPeriod);
  const [metric, setMetric] = useState<"time" | "money">("time");
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    api.savings().then(setR, () => {});
  }, []);

  const view = useMemo(() => {
    if (!r) return null;
    const now = new Date();
    const days = r.daily ?? [];
    const buckets = bucketSavings(days, period, now);
    const current = buckets[buckets.length - 1];
    const pace = recentPace(days, now);
    const projected = projectCurrent(current, pace, now);
    const change = changeFromPrevious(days, period, now);
    const from = buckets[0].start;
    const window = sumDays(days, from, current.end);
    const kinds = [...new Set(days.map((d) => d.kind))]
      .map((kind) => ({ kind, ...sumDays(days, from, current.end, kind) }))
      .filter((k) => k.gists > 0);
    return { buckets, current, pace, projected, change, window, kinds };
  }, [r, period]);

  if (!r || !view) return <p className="muted">Loading…</p>;
  const t = r.totals;
  const P = PERIODS[period];
  const { buckets, current, pace, projected, change, window, kinds } = view;
  const value = (b: { minutesSaved: number; moneySaved: number }) => (metric === "time" ? b.minutesSaved : b.moneySaved);
  const show = (n: number) => (metric === "time" ? formatMinutes(n) : formatMoney(n, t.currency));
  const projectedValue = value(projected);
  const max = Math.max(1e-9, ...buckets.map(value), pace.gists ? projectedValue : 0);
  const sel = buckets[selected ?? buckets.length - 1] ?? current;
  const avg = buckets.reduce((s, b) => s + value(b), 0) / buckets.length;
  const best = buckets.reduce((m, b) => (value(b) > value(m) ? b : m), buckets[0]);
  const dense = buckets.length > 7;
  const windowName = `last ${buckets.length} ${P.unit}s`;

  const choosePeriod = (p: Period) => {
    setPeriod(p);
    setSelected(null);
    try {
      localStorage.setItem(PERIOD_KEY, p);
    } catch {
      // Not remembered; nothing else depends on it.
    }
  };

  return (
    <div className="stack">
      <div className="savings-head">
        <h1>Your savings</h1>
        <div className="seg" role="radiogroup" aria-label="Show savings by">
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={p === period} className={p === period ? "on" : ""} onClick={() => choosePeriod(p)}>
              {PERIODS[p].name}
            </button>
          ))}
        </div>
      </div>

      {t.gists === 0 ? (
        <div className="card">
          <p>Make your first gist to start tracking the time and money you save.</p>
          <Link className="btn btn-primary" to="/app/new">Make a gist</Link>
        </div>
      ) : (
        <>
          <p className="muted">
            All time: <strong>{formatMinutes(t.minutesSaved)}</strong> saved, worth <strong>{formatMoney(t.moneySaved, t.currency)}</strong>, across {t.gists} gist{t.gists === 1 ? "" : "s"}.
          </p>

          <div className="kpis">
            <div className="card kpi"><span className="v">{formatMinutes(current.minutesSaved)}</span><span className="l">saved {P.current}</span></div>
            <div className="card kpi"><span className="v">{formatMoney(current.moneySaved, t.currency)}</span><span className="l">value {P.current}</span></div>
            <div className="card kpi"><span className="v">{current.gists}</span><span className="l">gist{current.gists === 1 ? "" : "s"} {P.current}</span></div>
            <div className="card kpi">
              <span className="v">{change === null ? (current.minutesSaved > 0 ? "New" : "–") : `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}%`}</span>
              <span className="l">
                {change === null
                  ? current.minutesSaved > 0 ? `nothing ${period === "day" ? P.previous : `by this point ${P.previous}`}` : `no gists yet ${P.current}`
                  : period === "day" ? "vs yesterday" : `vs the same point ${P.previous}`}
              </span>
            </div>
          </div>

          <div className="card">
            <div className="savings-chart-head">
              <h2>{metric === "time" ? "Time saved" : "Value saved"} by {P.unit}</h2>
              <div className="seg seg-sm" role="radiogroup" aria-label="Measure">
                <button type="button" role="radio" aria-checked={metric === "time"} className={metric === "time" ? "on" : ""} onClick={() => setMetric("time")}>Time</button>
                <button type="button" role="radio" aria-checked={metric === "money"} className={metric === "money" ? "on" : ""} onClick={() => setMetric("money")}>Value</button>
              </div>
            </div>
            <div className={`pbars${dense ? " dense" : ""}`} role="group" aria-label={`${metric === "time" ? "Time" : "Value"} saved per ${P.unit}, ${windowName}`}>
              {buckets.map((b, i) => {
                const v = value(b);
                const ahead = b.current && pace.gists ? Math.max(0, projectedValue - v) : 0;
                const [l1, l2] = barLabel(b, period);
                return (
                  <button
                    key={b.start.toISOString()}
                    type="button"
                    className={b === sel ? "sel" : ""}
                    aria-pressed={b === sel}
                    title={`${longLabel(b.start, period)}: ${show(v)}${ahead ? `, heading for about ${show(projectedValue)}` : ""}`}
                    onClick={() => setSelected(i)}
                  >
                    <small className="v">{metric === "time" ? compactMinutes(v) : compactMoney(v)}</small>
                    <span className="pstack">
                      {ahead > 0 && <span className="proj" style={{ height: `${(ahead / max) * 86}%` }} />}
                      <span className={`b${b.current ? " now" : ""}`} style={{ height: `${Math.max(v > 0 ? 3 : 1.5, (v / max) * 86)}%` }} />
                    </span>
                    <small className="lb"><span>{l1}</span>{l2 && <> <span>{l2}</span></>}</small>
                  </button>
                );
              })}
            </div>
            <div className="pdetail" aria-live="polite">
              <strong>{longLabel(sel.start, period)}</strong>
              <span>{formatMinutes(sel.minutesSaved)} saved · {formatMoney(sel.moneySaved, t.currency)} · {sel.gists} gist{sel.gists === 1 ? "" : "s"}</span>
              {sel.current && pace.gists > 0 && (
                <span className="muted">At your recent pace, {P.current} ends near {formatMinutes(projected.minutesSaved)} ({formatMoney(projected.moneySaved, t.currency)}).</span>
              )}
            </div>
            <div className="pmeta">
              <div><span>Average per {P.unit}</span><b>{show(avg)}</b></div>
              <div><span>Best {P.unit}</span><b>{value(best) > 0 ? show(value(best)) : "–"}</b><small>{value(best) > 0 ? longLabel(best.start, period) : ""}</small></div>
              <div><span>At your recent pace</span><b>{formatMinutes(pace.minutesPerDay * 365)}</b><small>a year, worth {formatMoney(pace.moneyPerDay * 365, t.currency)}</small></div>
            </div>
            {pace.gists > 0 && <p className="muted small">The outlined top of the current bar is where {P.current} is heading at your pace over the last 28 days.</p>}
          </div>

          <div className="card">
            <h2>By source, {windowName}</h2>
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
              <p className="muted">No gists in the {windowName}.</p>
            )}
            {window.gists > 0 && <p className="muted small">{window.gists} gist{window.gists === 1 ? "" : "s"} in the {windowName}, saving {formatMinutes(window.minutesSaved)}.</p>}
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
