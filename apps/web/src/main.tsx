import { StrictMode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import "./styles.css";
import { api, tokenStore, type Me } from "./api.ts";
import { Layout } from "./components/Layout.tsx";
import { Landing } from "./pages/Landing.tsx";
import { AuthPage } from "./pages/Auth.tsx";
import { NewGist } from "./pages/NewGist.tsx";
import { GistView } from "./pages/GistView.tsx";
import { Library } from "./pages/Library.tsx";
import { Templates } from "./pages/Templates.tsx";
import { SavingsPage } from "./pages/Savings.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { ImportView } from "./pages/ImportView.tsx";

interface Session {
  user: Me | null;
  loading: boolean;
  demo: boolean;
  setUser: (u: Me | null) => void;
  /** Reloads the signed-in user, e.g. after a sign-in completes. */
  refresh: () => Promise<Me | null>;
  /** Starts a guest session so someone can try Gist before creating an account. */
  startGuest: () => Promise<void>;
  /** Native apps pass the bearer token; the website's session is an HttpOnly cookie. */
  signIn: (token?: string | null) => Promise<Me | null>;
  signOut: () => Promise<void>;
}
const SessionCtx = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(SessionCtx);

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const refresh = useCallback(async () => {
    const u = await api.me().then((r) => r.user, () => null);
    setUser(u);
    return u;
  }, []);
  useEffect(() => {
    api.health().then((h) => setDemo(h.demo), () => {});
    refresh().finally(() => setLoading(false));
    const out = () => setUser(null);
    window.addEventListener("gist:signedout", out);
    return () => window.removeEventListener("gist:signedout", out);
  }, [refresh]);
  const startGuest = useCallback(async () => {
    const r = await api.guest();
    if (r.token) tokenStore.set(r.token);
    await refresh();
  }, [refresh]);
  const signIn = useCallback(async (token?: string | null) => {
    if (token) tokenStore.set(token);
    return refresh();
  }, [refresh]);
  const signOut = useCallback(async () => {
    await api.logout().catch(() => {});
    tokenStore.set(null);
    setUser(null);
  }, []);
  return <SessionCtx.Provider value={{ user, loading, demo, setUser, refresh, startGuest, signIn, signOut }}>{children}</SessionCtx.Provider>;
}

/**
 * Pages a guest may use (making, reading and sharing gists) start a guest session automatically,
 * so the first gist needs no sign-up. Other pages send guests to create an account.
 */
function RequireAuth({ children, guestOk = false }: { children: React.ReactNode; guestOk?: boolean }) {
  const { user, loading, startGuest } = useSession();
  const [failed, setFailed] = useState<string | null>(null);
  const starting = useRef(false);
  const needsGuest = !loading && !user && guestOk;
  useEffect(() => {
    if (!needsGuest || starting.current) return;
    starting.current = true;
    startGuest().catch((e: Error) => setFailed(e.message)).finally(() => (starting.current = false));
  }, [needsGuest, startGuest]);
  const next = encodeURIComponent(location.pathname + location.search);
  if (failed) return <div className="main"><p className="error">{failed}</p></div>;
  if (loading || needsGuest) return <div className="main muted">Loading…</div>;
  if (!user) return <Navigate to={`/signin?next=${next}`} replace />;
  if (user.restricted) return <Navigate to={`/signin?next=${next}`} replace />;
  if (user.isGuest && !guestOk) return <Navigate to={`/signup?next=${next}`} replace />;
  return <>{children}</>;
}

/** Desktop app: links sent from the global shortcut or tray open the composer prefilled. */
function DesktopBridge() {
  const nav = useNavigate();
  useEffect(() => {
    window.gistDesktop?.onGistUrl((url) => nav(`/app/new?url=${encodeURIComponent(url)}`));
  }, [nav]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <DesktopBridge />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/signin" element={<AuthPage mode="signin" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route
            path="/app"
            element={
              <RequireAuth guestOk>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="new" replace />} />
            <Route path="new" element={<NewGist />} />
            <Route path="library" element={<Library />} />
            <Route path="g/:id" element={<GistView />} />
            <Route path="savings" element={<SavingsPage />} />
            <Route path="imports/:id" element={<RequireAuth><ImportView /></RequireAuth>} />
            <Route path="templates" element={<RequireAuth><Templates /></RequireAuth>} />
            <Route path="settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);
