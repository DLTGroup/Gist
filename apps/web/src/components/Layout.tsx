import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { Folder } from "@gist/core";
import { BRAND, formatMinutes, formatMoney } from "@gist/core";
import { api, type Totals } from "../api.ts";
import { useSession } from "../main.tsx";

export function Layout() {
  const { demo } = useSession();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const loc = useLocation();
  useEffect(() => {
    api.folders().then((r) => setFolders(r.folders), () => {});
    api.savings().then((r) => setTotals(r.totals), () => {});
  }, [loc.pathname]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          {BRAND.name}
        </NavLink>
        <nav className="nav">
          <NavLink to="/app/new"><span aria-hidden>＋</span> New gist</NavLink>
          <NavLink to="/app/library" end><span aria-hidden>▤</span> Library</NavLink>
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
