import { useEffect, useState } from "react";
import { api, type PasskeyList } from "../api.ts";
import { useSession } from "../main.tsx";
import { createPasskey, passkeysSupported, syncPasskeyManager } from "../lib/passkeys.ts";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "never");

/** Settings: how this account signs in, and its passkeys. */
export function AccountSecurity() {
  const { user, refresh } = useSession();
  const [list, setList] = useState<PasskeyList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (l: PasskeyList) => {
    setList(l);
    // Keeps the person's passkey manager in step with the server: removed passkeys stop being offered.
    syncPasskeyManager(l, user?.email ?? null, user?.name ?? null);
  };
  useEffect(() => {
    api.passkeys().then(apply, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<PasskeyList | null>) => {
    setBusy(true);
    setError(null);
    try {
      const l = await fn();
      if (l) apply(l);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cooling = user?.recoveryUntil && new Date(user.recoveryUntil) > new Date();
  return (
    <div className="card" id="security">
      <h2>Sign-in and security</h2>
      <p className="muted small">
        Signed in as <b>{user?.email}</b>
        {user?.google ? " · Google connected" : ""}. Gist never uses passwords: you sign in with a passkey, Google or a code sent to your email.
      </p>
      {cooling && (
        <p className="notice">
          You recently signed in with an emailed code, so removing passkeys is paused for 24 hours (until {new Date(user!.recoveryUntil!).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}). This protects you if someone else got into your email.
        </p>
      )}
      <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.3rem" }}>Passkeys</h3>
      {list?.passkeys.length === 1 && !list.passkeys[0].synced && (
        <p className="notice">
          Your passkey lives on one device or security key only. Add a second one, such as your phone, so losing that device doesn't lock you out.
        </p>
      )}
      {list && !list.passkeys.length && <p className="muted small">No passkeys yet. Add one to sign in with Face ID, your fingerprint or your device PIN.</p>}
      {list?.passkeys.map((p) => (
        <div className="passkey-row" key={p.id}>
          <div className="grow">
            <strong>{p.name}</strong>
            <div className="muted small">
              {p.synced ? "Synced across your devices" : "This device or security key only"} · added {when(p.createdAt)} · last used {when(p.lastUsedAt)}
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              const name = prompt("Name this passkey", p.name);
              if (name?.trim()) void act(() => api.renamePasskey(p.id, name.trim()));
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || !!cooling}
            onClick={() => {
              if (list.passkeys.length === 1 && !confirm("This is your only passkey. You'll sign in with Google or an emailed code until you add another. Remove it?")) return;
              void act(() => api.deletePasskey(p.id));
            }}
          >
            Remove
          </button>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      {passkeysSupported() ? (
        <button type="button" className="btn" disabled={busy} onClick={() => act(() => createPasskey(user?.email ?? null, user?.name ?? null))}>
          {busy ? "One moment…" : "Add a passkey"}
        </button>
      ) : (
        <p className="muted small">This browser can't create passkeys.</p>
      )}
    </div>
  );
}
