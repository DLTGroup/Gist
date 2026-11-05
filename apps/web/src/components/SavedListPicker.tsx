import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PLATFORM_LABEL } from "@gist/core";
import { api, type AccountProvider, type ConnectionInfo, type SavedList } from "../api.ts";
import { PlatformIcon } from "../lib/platformIcons.tsx";

export interface PickedList {
  provider: AccountProvider;
  list: SavedList;
}

/** On the New page: choose a playlist or saved list from a connected YouTube or Spotify account. */
export function SavedListPicker({ picked, onPick }: { picked: PickedList | null; onPick: (p: PickedList | null) => void }) {
  const [conns, setConns] = useState<ConnectionInfo[] | null>(null);
  const [tab, setTab] = useState<AccountProvider | null>(null);
  const [lists, setLists] = useState<Record<string, SavedList[] | string>>({});

  useEffect(() => {
    api.connections().then((r) => {
      setConns(r.connections);
      setTab(r.connections.find((c) => c.connected)?.provider ?? null);
    }, () => setConns([]));
  }, []);

  useEffect(() => {
    if (!tab || lists[tab]) return;
    api.savedLists(tab).then((r) => setLists((x) => ({ ...x, [tab]: r.lists })), (e) => setLists((x) => ({ ...x, [tab]: (e as Error).message })));
  }, [tab, lists]);

  if (!conns) return null;
  const connected = conns.filter((c) => c.connected);
  if (!connected.length) {
    if (!conns.some((c) => c.available)) return null;
    return <p className="muted small" style={{ margin: 0 }}><Link to="/app/settings#connections">Connect YouTube or Spotify</Link> to summarize lists you've already saved.</p>;
  }
  const current = tab ? lists[tab] : undefined;
  return (
    <div className="card" style={{ boxShadow: "none" }}>
      <div className="row" style={{ marginBottom: "0.5rem" }}>
        <strong>From your saved lists</strong>
        <span className="spacer" />
        {picked && <button type="button" className="btn-ghost small" onClick={() => onPick(null)}>Clear</button>}
      </div>
      {connected.length > 1 && (
        <div className="acct-tabs">
          {connected.map((c) => (
            <button type="button" key={c.provider} className={c.provider === tab ? "" : "btn-ghost"} onClick={() => setTab(c.provider)}>
              <PlatformIcon platform={c.provider} size={14} /> {PLATFORM_LABEL[c.provider]}
            </button>
          ))}
        </div>
      )}
      {current === undefined && <p className="muted small">Loading your lists…</p>}
      {typeof current === "string" && <p className="error">{current}</p>}
      {Array.isArray(current) && (current.length ? (
        <div className="saved-lists">
          {current.map((l) => {
            const on = picked?.provider === tab && picked.list.id === l.id;
            return (
              <button type="button" key={l.id} className="saved-list" aria-pressed={on} onClick={() => onPick(on ? null : { provider: tab!, list: l })}>
                <span>{l.title}</span>
                {l.count != null && <span className="count">{l.count} {l.count === 1 ? "item" : "items"}</span>}
              </button>
            );
          })}
        </div>
      ) : <p className="muted small">No saved lists found in this account.</p>)}
    </div>
  );
}
