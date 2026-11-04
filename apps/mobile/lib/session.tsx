import { createContext, useContext, useEffect, useState } from "react";
import { api, auth, type Me } from "./api";

interface Session { user: Me | null; ready: boolean; signIn: (t: string, u: Me) => Promise<void>; signOut: () => Promise<void>; setUser: (u: Me) => void }
const Ctx = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    auth
      .load()
      .then((t) => (t ? api.me().then((r) => setUser(r.user)) : undefined))
      .catch(() => auth.set(null))
      .finally(() => setReady(true));
  }, []);
  return (
    <Ctx.Provider
      value={{
        user,
        ready,
        setUser,
        signIn: async (t, u) => {
          await auth.set(t);
          setUser(u);
        },
        signOut: async () => {
          await auth.set(null);
          setUser(null);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
