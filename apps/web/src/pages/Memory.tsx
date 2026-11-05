import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Deck, MemorySettings } from "@gist/core";
import { RETENTION_RANGE } from "@gist/core";
import { api, type MemorySummary } from "../api.ts";

/** Memory home: what's due, the decks, and how reviews are scheduled and reminded. */
export function MemoryPage() {
  const nav = useNavigate();
  const [sum, setSum] = useState<MemorySummary | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const load = () => {
    api.memorySummary().then(setSum, (e) => setError(e.message));
    api.decks().then((r) => setDecks(r.decks), () => {});
  };
  useEffect(load, []);

  if (error) return <p className="error">{error}</p>;
  if (!sum) return <p className="muted">Loading…</p>;
  const toStudy = sum.dueNow + sum.newToday;
  const peak = Math.max(1, ...sum.forecast.map((f) => f.count));

  return (
    <div>
      <h1>Memory</h1>
      <p className="muted">
        Star the takeaways you want to keep. Gist turns them into cards and brings each one back just before you'd forget it.
      </p>

      <div className="card memory-hero">
        <div>
          <div className="memory-big">{toStudy}</div>
          <div className="muted small">
            {sum.dueNow} due for review · {sum.newToday} new today
          </div>
        </div>
        <div className="row">
          <button className="btn-primary" disabled={!toStudy} onClick={() => nav("/app/review")}>
            {toStudy ? "Start review" : "All caught up"}
          </button>
          <button disabled={sum.totalCards < 2} onClick={() => nav("/app/quiz")}>Quiz me</button>
        </div>
      </div>

      <div className="kpis" style={{ marginTop: "1rem" }}>
        <div className="card kpi"><span className="v">{sum.totalCards}</span><span className="l">cards</span></div>
        <div className="card kpi"><span className="v">{sum.streakDays}</span><span className="l">day streak</span></div>
        <div className="card kpi">
          <span className="v">{sum.retention30d == null ? "–" : `${Math.round(sum.retention30d * 100)}%`}</span>
          <span className="l">recalled, last 30 days</span>
        </div>
        <div className="card kpi"><span className="v">{sum.reviewedToday}</span><span className="l">reviewed today</span></div>
      </div>

      <section className="section">
        <h2>Coming up</h2>
        {sum.forecast.every((f) => f.count === 0) ? (
          <p className="muted">No reviews scheduled this week yet. Cards join the schedule after their first review.</p>
        ) : (
        <div className="forecast" aria-label="Reviews due over the next 7 days">
          {sum.forecast.map((f, i) => (
            <div key={f.date} className="forecast-day">
              <div className="forecast-bar" style={{ height: `${(f.count / peak) * 100}%` }} title={`${f.count} due`} />
              <span className="small">{f.count}</span>
              <span className="muted small">{i === 0 ? "Today" : new Date(f.date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "short" })}</span>
            </div>
          ))}
        </div>
        )}
      </section>

      <section className="section">
        <h2>Decks</h2>
        {decks.length === 0 && (
          <p className="muted">
            No cards yet. Open a gist and tap ☆ beside any takeaway, or "Remember all".{" "}
            <Link to="/app/library">Go to your library</Link>
          </p>
        )}
        <div className="list">
          {decks.map((d) => (
            <Link key={d.id} to={`/app/memory/decks/${d.id}`} className="card deck-row">
              <div>
                <strong>{d.name}</strong>
                <div className="muted small">
                  {d.cardCount} card{d.cardCount === 1 ? "" : "s"}
                  {d.memberCount > 1 && <> · shared with {d.memberCount - 1}</>}
                  {d.role !== "owner" && <> · from {d.ownerName ?? "someone"} ({d.role})</>}
                </div>
              </div>
              <span className="spacer" />
              {d.dueCount > 0 && <span className="pill pill-save">{d.dueCount} due</span>}
              {d.newCount > 0 && <span className="pill">{d.newCount} new</span>}
            </Link>
          ))}
        </div>
        <form
          className="row"
          style={{ marginTop: "0.8rem" }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            await api.createDeck(newName.trim());
            setNewName("");
            load();
          }}
        >
          <input style={{ maxWidth: 280 }} placeholder="New deck name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit">Add deck</button>
        </form>
      </section>

      <MemorySettingsCard initial={sum.settings} onSaved={load} />
    </div>
  );
}

function MemorySettingsCard({ initial, onSaved }: { initial: MemorySettings; onSaved: () => void }) {
  const [s, setS] = useState(initial);
  const [cal, setCal] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notify, setNotify] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  useEffect(() => {
    api.memorySettings().then((r) => setCal(r.calendarUrl), () => {});
  }, []);
  const save = async (patch: Partial<MemorySettings>) => {
    try {
      const r = await api.updateMemorySettings(patch);
      setS(r.settings);
      setMsg("Saved");
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setTimeout(() => setMsg(null), 2500);
  };
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <section className="section">
      <h2>Scheduling and reminders</h2>
      <div className="card stack">
        <label className="field">
          <span>
            Target recall: <strong>{Math.round(s.desiredRetention * 100)}%</strong>
          </span>
          <input
            type="range"
            min={RETENTION_RANGE.min}
            max={RETENTION_RANGE.max}
            step={0.01}
            value={s.desiredRetention}
            onChange={(e) => setS({ ...s, desiredRetention: Number(e.target.value) })}
            onMouseUp={() => save({ desiredRetention: s.desiredRetention })}
            onTouchEnd={() => save({ desiredRetention: s.desiredRetention })}
            onKeyUp={() => save({ desiredRetention: s.desiredRetention })}
          />
          <span className="hint">
            How likely you are to remember a card when it comes back. Higher means more reviews; 90% is the usual balance.
          </span>
        </label>
        <label className="field">
          <span>New cards per day</span>
          <input type="number" min={0} max={500} style={{ width: 100 }} value={s.newCardsPerDay} onChange={(e) => setS({ ...s, newCardsPerDay: Number(e.target.value) })} onBlur={() => save({ newCardsPerDay: s.newCardsPerDay })} />
        </label>
        <label className="field">
          <span>Daily reminder</span>
          <div className="row">
            <select
              style={{ width: "auto" }}
              value={s.reminderHour ?? ""}
              onChange={(e) => save({ reminderHour: e.target.value === "" ? null : Number(e.target.value), timeZone: browserZone })}
            >
              <option value="">Off</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{new Date(2026, 0, 1, h).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}</option>
              ))}
            </select>
            <span className="muted small">{s.timeZone}</span>
          </div>
        </label>
        <div className="field">
          <span>Where reminders appear</span>
          <div className="stack small">
            <div className="row">
              <span>Calendar (phone, Google, Apple, Outlook):</span>
              {cal ? (
                <>
                  <a href={cal.replace(/^https?:/, "webcal:")}>Subscribe</a>
                  <button className="btn-ghost small" onClick={() => navigator.clipboard.writeText(cal).then(() => setMsg("Calendar link copied"))}>Copy link</button>
                  <button className="btn-ghost small btn-danger" onClick={async () => { await api.disableCalendar(); setCal(null); }}>Turn off</button>
                </>
              ) : (
                <button className="small" onClick={async () => setCal((await api.enableCalendar()).calendarUrl)}>Make my calendar link</button>
              )}
            </div>
            <div className="row">
              <span>This browser, while Gist is open:</span>
              {notify === "granted" ? (
                <span className="pill pill-accent">On</span>
              ) : notify === "denied" ? (
                <span className="muted">Blocked in browser settings</span>
              ) : (
                <button className="small" onClick={async () => setNotify(await Notification.requestPermission())}>Allow notifications</button>
              )}
            </div>
            <span className="hint">The calendar link is private: anyone with it can see how many cards you have due, nothing else.</span>
          </div>
        </div>
        {msg && <span className="pill">{msg}</span>}
      </div>
    </section>
  );
}
