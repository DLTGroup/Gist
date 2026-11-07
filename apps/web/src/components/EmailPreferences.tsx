import { useEffect, useState } from "react";
import { api, type ConsentRequest } from "../api.ts";
import { useSession } from "../main.tsx";
import { MarketingBox } from "../pages/Auth.tsx";

/** Marketing email on or off, and the mailing list download for operators. */
export function EmailPreferences() {
  const { user, setUser } = useSession();
  const [consent, setConsent] = useState<ConsentRequest | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.marketingConsent().then(setConsent, () => {});
    if (user?.isAdmin) api.mailingListCount().then((r) => setCount(r.count), () => {});
  }, [user?.isAdmin]);

  if (!consent?.available && !user?.isAdmin) return null;

  async function change(v: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.setMarketing(v);
      setUser(r.user);
      if (user?.isAdmin) setCount((await api.mailingListCount()).count);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Emails</h2>
      <p className="muted small">Emails about your account, like sign-in codes, always arrive. News, tips and offers are up to you.</p>
      {consent?.available && <MarketingBox consent={consent} checked={!!user?.marketingOptIn} onChange={change} disabled={busy} />}
      {error && <p className="error" role="alert">{error}</p>}
      {user?.isAdmin && (
        <div className="mailing-list">
          <div>
            <b>Mailing list</b>
            <p className="muted small">
              {count == null ? "Counting…" : `${count.toLocaleString("en-CA")} ${count === 1 ? "person has" : "people have"} agreed to marketing email.`} The file includes when and how each person agreed, and their unsubscribe link.
            </p>
          </div>
          <button type="button" className="btn" onClick={() => api.download("/api/admin/mailing-list.csv").catch((e: Error) => setError(e.message))}>
            Download CSV
          </button>
        </div>
      )}
    </div>
  );
}
