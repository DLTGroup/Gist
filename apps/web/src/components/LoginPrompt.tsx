import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LOGIN_REQUIRED_EVENT, api, USES_BEARER } from "../api.ts";

/**
 * Shown when a guest tries something that needs an account, such as sending a gist to a notes app.
 * Making, reading and sharing gists never needs one.
 */
export function LoginPrompt() {
  const [message, setMessage] = useState<string | null>(null);
  const loc = useLocation();
  const next = loc.pathname + loc.search;
  useEffect(() => {
    const show = (e: Event) => setMessage((e as CustomEvent<string | undefined>).detail || "Create a free account to do that.");
    window.addEventListener(LOGIN_REQUIRED_EVENT, show);
    return () => window.removeEventListener(LOGIN_REQUIRED_EVENT, show);
  }, []);
  useEffect(() => {
    if (!message) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMessage(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [message]);
  if (!message) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title" onClick={(e) => e.target === e.currentTarget && setMessage(null)}>
      <div className="prompt">
        <h2 id="prompt-title">Free account needed</h2>
        <p className="muted">{message}</p>
        {!USES_BEARER && <a className="btn btn-primary auth-wide" href={api.googleStartUrl(next)}>Continue with Google</a>}
        <Link className="btn auth-wide" to={`/signup?next=${encodeURIComponent(next)}`} onClick={() => setMessage(null)}>Use my email</Link>
        <p className="muted small" style={{ textAlign: "center" }}>
          Already have one? <Link to={`/signin?next=${encodeURIComponent(next)}`} onClick={() => setMessage(null)}>Sign in</Link>
        </p>
        <button className="btn-ghost auth-wide" onClick={() => setMessage(null)}>Not now</button>
      </div>
    </div>
  );
}
