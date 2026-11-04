import { StrictMode, createContext, useCallback, useContext, useEffect, useState } from "react";
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

interface Session {
  user: Me | null;
  loading: boolean;
  demo: boolean;
  setUser: (u: Me | null) => void;
  signIn: (token: string, user: Me) => void;
  signOut: () => void;
}
const SessionCtx = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(SessionCtx);

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    api.health().then((h) => setDemo(h.demo), () => {});
    if (!tokenStore.get()) return;
    api.me().then((r) => setUser(r.user), () => tokenStore.set(null)).finally(() => setLoading(false));
    const out = () => setUser(null);
    window.addEventListener("gist:signedout", out);
    return () => window.removeEventListener("gist:signedout", out);
  }, []);
  const signIn = useCallback((token: string, u: Me) => {
    tokenStore.set(token);
    setUser(u);
  }, []);
  const signOut = useCallback(() => {
    api.logout().catch(() => {});
    tokenStore.set(null);
    setUser(null);
  }, []);
  return <SessionCtx.Provider value={{ user, loading, demo, setUser, signIn, signOut }}>{children}</SessionCtx.Provider>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  if (loading) return <div className="main muted">Loading…</div>;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/signin?next=${next}`} replace />;
  }
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
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="new" replace />} />
            <Route path="new" element={<NewGist />} />
            <Route path="library" element={<Library />} />
            <Route path="g/:id" element={<GistView />} />
            <Route path="templates" element={<Templates />} />
            <Route path="savings" element={<SavingsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);
