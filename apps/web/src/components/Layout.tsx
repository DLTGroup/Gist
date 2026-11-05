import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { Folder } from "@gist/core";
import { formatMinutes, formatMoney } from "@gist/core";
import { api, type Totals } from "../api.ts";
import { useSession } from "../main.tsx";
import { Wordmark } from "./Wordmark.tsx";

/**
 * While the app is open, shows a browser notification once a day at the user's reminder hour if
 * cards are due (only after they've allowed notifications on the Memory page).
 */
function useReviewReminder() {
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const KEY = "gist.reminded";
    const check = async () => {
      if (Notification.permission !== "granted") return;
      const today = new Date().toLocaleDateString("en-CA");
      let last: string | null = null;
      try {
        last = localStorage.getItem(KEY);
      } catch {
        /* storage unavailable */
      }
      if (last === today) return;
      const s = await api.memorySummary().catch(() => null);
      if (!s || s.settings.reminderHour == null || new Date().getHours() < s.settings.reminderHour) return;
      const n = s.dueNow + s.newToday;
      if (!n) return;
      try {
        localStorage.setItem(KEY, today);
      } catch {
        /* storage unavailable */
      }
      const note = new Notification("Time for a quick review", { body: `${n} card${n === 1 ? "" : "s"} ready in Gist. A few minutes keeps them.`, tag: "gist-review" });
      note.onclick = () => {
        window.focus();
        window.location.assign(`${import.meta.env.BASE_URL}app/review`);
      };
    };
    check();
    const t = setInterval(check, 10 * 60_000);
    return () => clearInterval(t);
  }, []);
}

export function Layout() {
  const { demo } = useSession();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [due, setDue] = useState(0);
  const loc = useLocation();
  useEffect(() => {
    api.folders().then((r) => setFolders(r.folders), () => {});
    api.savings().then((r) => setTotals(r.totals), () => {});
    api.memorySummary().then((r) => setDue(r.dueNow + r.newToday), () => {});
  }, [loc.pathname]);
  useReviewReminder();

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <Wordmark />
        </NavLink>
        <nav className="nav">
          <NavLink to="/app/new"><span aria-hidden>＋</span> New gist</NavLink>
          <NavLink to="/app/library" end><span aria-hidden>▤</span> Library</NavLink>
          <NavLink to="/app/memory" className={({ isActive }) => (isActive || ["/app/review", "/app/quiz"].includes(loc.pathname) ? "active" : "")}>
            <span aria-hidden>★</span> Memory {due > 0 && <span className="badge" aria-label={`${due} to review`}>{due}</span>}
          </NavLink>
          <NavLink to="/app/templates"><span aria-hidden>✎</span> Templates</NavLink>
          <NavLink to="/app/savings"><span aria-hidden>⏱</span> Savings</NavLink>
          <NavLink to="/app/settings"><span aria-hidden>⚙</span> Settings</NavLink>
        </nav>
        {folders.length > 0 && <div className="nav-section">Folders</div>}
        <nav className="nav">
          {folders.map((f) => (
            <NavLink key={f.id} className="folder-link" to={`/app/library?folder=${f.id}`}>
              <span aria-hidden>▸</span> {f.name} <span className="spacer" /> <span className="muted small">{f.gistCount}</span>
            </NavLink>
          ))}
        </nav>
        {totals && totals.gists > 0 && (
          <div className="savings-mini">
            You've saved
            <strong>{formatMinutes(totals.minutesSaved)}</strong>
            worth about {formatMoney(totals.moneySaved, totals.currency)}
          </div>
        )}
      </aside>
      <main className="main">
        {demo && (
          <p className="notice">
            Demo mode: summaries use a simple built-in extractor. Add an Anthropic API key on the server to use Claude.
          </p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
