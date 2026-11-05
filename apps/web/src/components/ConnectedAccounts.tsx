import { useEffect, useState } from "react";
import { PLATFORM_LABEL } from "@gist/core";
import { api, type AccountProvider, type ConnectionInfo } from "../api.ts";
import { PlatformIcon } from "../lib/platformIcons.tsx";

/** Settings card: connect or disconnect YouTube and Spotify so saved lists can be imported. */
export function ConnectedAccounts() {
  const [items, setItems] = useState<ConnectionInfo[] | null>(null);
  const [busy, setBusy] = useState<AccountProvider | null>(null);
  const params = new URLSearchParams(window.location.search);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(() => {
    const done = params.get("connected") as AccountProvider | null;
    const err = params.get("connect_error");
    if (done && done in PLATFORM_LABEL) return { ok: true, text: `${PLATFORM_LABEL[done]} is connected. Pick a saved list on the New page.` };
    if (err) return { ok: false, text: err };
    return null;
  });

  const load = () => api.connections().then((r) => setItems(r.connections), () => setItems([]));
  useEffect(() => {
    load();
  }, []);

  async function connect(p: AccountProvider) {
    setBusy(p);
    try {
      const { url } = await api.startConnection(p);
      window.location.href = url;
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
      setBusy(null);
    }
  }
  async function disconnect(p: AccountProvider) {
    setBusy(p);
    await api.disconnect(p).catch(() => {});
    setNotice(null);
    setBusy(null);
    load();
  }

  return (
    <div className="card" id="connections">
      <h2>Connected accounts</h2>
      <p className="muted small">Connect an account to summarize what you've already saved there. Gist only reads your lists and never posts or changes anything.</p>
      {notice && <p className={notice.ok ? "small" : "error"}>{notice.text}</p>}
      <div className="stack" style={{ gap: "0.6rem" }}>
        {(items ?? []).map((c) => (
          <div key={c.provider} className="row conn-row">
            <span className="conn-mark"><PlatformIcon platform={c.provider} size={20} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{PLATFORM_LABEL[c.provider]}</strong>
              <div className="muted small">
                {c.connected ? `Connected as ${c.accountName}` : c.available ? c.note : "Not set up on this server yet."}
              </div>
            </div>
            {c.connected ? (
              <button type="button" className="btn-ghost" disabled={busy === c.provider} onClick={() => disconnect(c.provider)}>Disconnect</button>
            ) : (
              <button type="button" disabled={!c.available || busy === c.provider} onClick={() => connect(c.provider)}>
                {busy === c.provider ? "Opening…" : "Connect"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
