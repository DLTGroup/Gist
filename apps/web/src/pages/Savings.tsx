import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatMinutes, formatMoney } from "@gist/core";
import { api, type SavingsReport } from "../api.ts";

const KIND = { youtube: "Videos", podcast: "Podcasts", web: "Articles", text: "Pasted text" } as Record<string, string>;

export function SavingsPage() {
  const [r, setR] = useState<SavingsReport | null>(null);
  useEffect(() => {
    api.savings().then(setR, () => {});
  }, []);
  if (!r) return <p className="muted">Loading…</p>;
  const t = r.totals;
  const maxWeek = Math.max(1, ...r.byWeek.map((w) => w.minutesSaved));

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
          <div className="kpis">
            <div className="card kpi"><span className="v">{formatMinutes(t.minutesSaved)}</span><span className="l">time saved</span></div>
            <div className="card kpi"><span className="v">{formatMoney(t.moneySaved, t.currency)}</span><span className="l">value of that time</span></div>
            <div className="card kpi"><span className="v">{Math.round(t.wordsAvoided).toLocaleString("en-CA")}</span><span className="l">words you didn't have to process</span></div>
            <div className="card kpi"><span className="v">{t.gists}</span><span className="l">gists made</span></div>
          </div>

          <div className="card">
            <h2>Effort</h2>
            <p>
              Watching, listening, reading and taking notes on these would have taken about <strong>{formatMinutes(t.originalMinutes)}</strong>. Reading the gists takes about{" "}
              <strong>{formatMinutes(t.gistMinutes)}</strong>, which is {t.originalMinutes > 0 ? Math.round((1 - t.gistMinutes / t.originalMinutes) * 100) : 0}% less effort.
            </p>
          </div>

          <div className="card">
            <h2>Time saved by week</h2>
            <div className="bars">
              {r.byWeek.map((w) => (
                <div className="bar" key={w.week}>
                  <span className="muted">{new Date(w.week + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</span>
                  <div className="track"><div className="fill" style={{ width: `${(w.minutesSaved / maxWeek) * 100}%` }} /></div>
                  <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatMinutes(w.minutesSaved)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>By source</h2>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr className="muted small" style={{ textAlign: "left" }}><th>Type</th><th>Gists</th><th>Time saved</th><th>Value</th></tr>
              </thead>
              <tbody>
                {r.byKind.map((k) => (
                  <tr key={k.kind}>
                    <td>{KIND[k.kind] ?? k.kind}</td>
                    <td>{k.gists}</td>
                    <td>{formatMinutes(k.minutesSaved)}</td>
                    <td>{formatMoney(k.moneySaved, k.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted small">
        How we estimate: original length at {r.assumptions.playbackSpeed}× playback (or reading at {r.assumptions.readingWpm} words per minute), plus{" "}
        {Math.round(r.assumptions.noteTakingFactor * 100)}% for taking notes by hand, minus the time to read the gist. Your time is valued at{" "}
        {formatMoney(r.assumptions.hourlyRate, r.assumptions.currency)} an hour. <Link to="/app/settings">Change these in Settings.</Link>
      </p>
    </div>
  );
}
