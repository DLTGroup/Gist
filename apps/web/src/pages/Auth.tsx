import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BRAND } from "@gist/core";
import { api } from "../api.ts";
import { useSession } from "../main.tsx";

export function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const { signIn } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = mode === "signup" ? await api.signup(email, password, name) : await api.login(email, password);
      signIn(r.token, r.user);
      const next = params.get("next");
      nav(next && next.startsWith("/app") ? next : "/app/new", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <Link to="/" className="brand" style={{ justifyContent: "center" }}>
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} /> {BRAND.name}
      </Link>
      <form className="card" onSubmit={submit}>
        <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        {mode === "signup" && (
          <div className="field">
            <label htmlFor="name">Name <span className="hint">(optional)</span></label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
          {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <p className="muted small" style={{ marginTop: "1rem", textAlign: "center" }}>
          {mode === "signup" ? <>Have an account? <Link to="/signin">Sign in</Link></> : <>New here? <Link to="/signup">Create an account</Link></>}
        </p>
      </form>
    </div>
  );
}
