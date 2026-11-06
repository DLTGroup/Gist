import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, USES_BEARER } from "../api.ts";
import { useSession } from "../main.tsx";
import { Wordmark } from "../components/Wordmark.tsx";
import { cancelPasskeyAutofill, createPasskey, passkeysSupported, signInWithPasskey } from "../lib/passkeys.ts";

type Step = "start" | "code" | "passkey";

/**
 * One page for signing in and creating an account. There are no passwords: people continue with
 * Google, use a passkey (Face ID, fingerprint or device PIN), or get a 6-digit code by email and
 * are then offered a passkey for next time.
 */
export function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const { user, signIn, signOut } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next")?.startsWith("/app") ? params.get("next")! : "/app/new";
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  // Recovery on the website: the session can only add a passkey until one is added.
  const [scoped, setScoped] = useState(false);
  const [crossDevice, setCrossDevice] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState<string | null>(null);
  const canPasskey = passkeysSupported();
  const guest = user?.isGuest ? user : null;

  // Already signed in: nothing to do here, unless recovery still needs a passkey.
  useEffect(() => {
    if (user?.restricted && step === "start") {
      setRecovery(true);
      setScoped(true);
      setStep("passkey");
    } else if (user && !user.isGuest && step === "start") nav(next, { replace: true });
  }, [user, step, next, nav]);

  // Offer saved passkeys in the email field's autofill (Conditional UI) while this page is open.
  useEffect(() => {
    if (!canPasskey) return;
    let live = true;
    signInWithPasskey(true).then(
      (ok) => {
        if (ok && live) void finish(ok);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
      cancelPasskeyAutofill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finish(how: true | "offer-local" = true) {
    await signIn();
    // Signed in with a phone's passkey (QR code): offer to save one on this device too.
    if (how === "offer-local") {
      setCrossDevice(true);
      setStep("passkey");
    } else nav(next, { replace: true });
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const sendCode = (e?: React.FormEvent) => {
    e?.preventDefault();
    return run("email", async () => {
      const r = await api.emailStart(email.trim());
      // The website is tied to the code by a cookie; the desktop app keeps the id instead.
      setAttemptId(USES_BEARER ? r.attemptId : null);
      setCode("");
      setStep("code");
    });
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    return run("code", async () => {
      const r = await api.emailVerify(code, attemptId, name.trim() || undefined);
      await signIn(r.token);
      setRecovery(r.recovery);
      setScoped(r.scoped);
      if (r.scoped || (r.needsPasskey && canPasskey)) setStep("passkey");
      else nav(next, { replace: true });
    });
  };

  const heading = mode === "signup" ? "Create your free account" : "Sign in to Gist";

  return (
    <div className="auth">
      <Link to="/" className="brand" style={{ justifyContent: "center" }}>
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} /> <Wordmark size="1.4rem" />
      </Link>

      {step === "start" && (
        <div className="card auth-card">
          <h1>{heading}</h1>
          {guest ? (
            <p className="muted small">The gists you've made come with you.</p>
          ) : (
            <p className="muted small">No password needed.</p>
          )}
          {!USES_BEARER && (
            <a className="btn auth-google" href={api.googleStartUrl(next)}>
              <GoogleG /> Continue with Google
            </a>
          )}
          {canPasskey && (
            <button type="button" className="btn auth-passkey" disabled={!!busy} onClick={() => run("passkey", async () => { const ok = await signInWithPasskey(false); if (ok) await finish(ok); })}>
              <KeyIcon /> {busy === "passkey" ? "Waiting for your passkey…" : "Sign in with a passkey"}
            </button>
          )}
          <div className="auth-or"><span>or use your email</span></div>
          <form onSubmit={sendCode}>
            {mode === "signup" && (
              <div className="field">
                <label htmlFor="name">Name <span className="hint">(optional)</span></label>
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              {/* "webauthn" lets the browser offer saved passkeys right in this field. */}
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username webauthn" inputMode="email" />
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn-primary auth-wide" disabled={!!busy}>{busy === "email" ? "Sending…" : "Email me a code"}</button>
          </form>
          <p className="muted small auth-switch">
            {mode === "signup" ? <>Have an account? <Link to={`/signin?next=${encodeURIComponent(next)}`}>Sign in</Link></> : <>New here? <Link to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></>}
          </p>
          {!guest && (
            <p className="muted small auth-switch">
              Just looking? <Link to="/app/new">Make a gist without an account</Link>
            </p>
          )}
        </div>
      )}

      {step === "code" && (
        <form className="card auth-card" onSubmit={verify}>
          <h1>Check your email</h1>
          <p className="muted small">We sent a 6-digit code to <b>{email.trim()}</b>. It works for 5 minutes, in this browser only.</p>
          <div className="field">
            <label htmlFor="code">Code</label>
            <input
              id="code"
              className="auth-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              autoFocus
            />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn-primary auth-wide" disabled={!!busy || code.length !== 6}>{busy === "code" ? "Checking…" : "Continue"}</button>
          <p className="muted small auth-switch">
            <button type="button" className="link" onClick={() => sendCode()}>Send a new code</button> ·{" "}
            <button type="button" className="link" onClick={() => (setStep("start"), setError(null))}>Use a different email</button>
          </p>
        </form>
      )}

      {step === "passkey" && (
        <div className="card auth-card">
          {recovery && (
            <p className="notice">
              {scoped
                ? "Your email is confirmed. To finish getting back in, add a passkey on this device. We've emailed you about this, and removing passkeys is paused for 24 hours as a precaution."
                : "You're signed in. As a precaution, removing passkeys is paused for 24 hours, and we've emailed you about this sign-in."}
            </p>
          )}
          <h1>{recovery ? "Add a passkey on this device" : crossDevice ? "Save a passkey on this device?" : "Sign in faster next time"}</h1>
          <p className="muted small">
            {crossDevice
              ? "You signed in with your phone. Save a passkey here and next time you can sign in on this device directly."
              : "Create a passkey and sign in with Face ID, your fingerprint or your device PIN. There's no password to remember or leak, and it works on your other devices through your password manager."}
          </p>
          {error && <p className="error" role="alert">{error}</p>}
          {canPasskey && (
            <button
              className="btn-primary auth-wide"
              disabled={!!busy}
              onClick={() =>
                run("create", async () => {
                  if (await createPasskey(user?.email ?? (email.trim() || null), user?.name ?? (name.trim() || null))) {
                    await signIn();
                    nav(next, { replace: true });
                  }
                })
              }
            >
              {busy === "create" ? "Waiting for your device…" : "Create a passkey"}
            </button>
          )}
          {scoped ? (
            <button className="btn-ghost auth-wide" onClick={() => signOut().then(() => (setStep("start"), setRecovery(false), setScoped(false)))}>Cancel</button>
          ) : (
            <button className="btn-ghost auth-wide" onClick={() => nav(next, { replace: true })}>Not now</button>
          )}
        </div>
      )}
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.7 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15 19 4M18 5l2 2M15 8l2 2" />
    </svg>
  );
}
