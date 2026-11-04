import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import type { ExportTarget, ExtractionTemplate, Folder, Gist, UserSettings } from "@gist/core";

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:8787";
const TOKEN_KEY = "gist.token";

let token: string | null = null;
export const auth = {
  async load() {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
    return token;
  },
  async set(t: string | null) {
    token = t;
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Me { id: string; email: string; name: string | null; settings: UserSettings }
export interface Totals { gists: number; minutesSaved: number; moneySaved: number; wordsAvoided: number; originalMinutes: number; gistMinutes: number; currency: string }

export const api = {
  signup: (email: string, password: string) => req<{ token: string; user: Me }>("POST", "/api/auth/signup", { email, password }),
  login: (email: string, password: string) => req<{ token: string; user: Me }>("POST", "/api/auth/login", { email, password }),
  me: () => req<{ user: Me }>("GET", "/api/me"),
  updateSettings: (p: Partial<UserSettings>) => req<{ user: Me }>("PATCH", "/api/settings", p),
  templates: () => req<{ templates: ExtractionTemplate[] }>("GET", "/api/templates"),
  folders: () => req<{ folders: Folder[] }>("GET", "/api/folders"),
  createGist: (b: { url?: string; text?: string; templateId?: string; focus?: string }) => req<{ gist: Gist }>("POST", "/api/gists", b),
  gists: (q = "") => req<{ gists: Gist[] }>("GET", `/api/gists?q=${encodeURIComponent(q)}`),
  gist: (id: string) => req<{ gist: Gist }>("GET", `/api/gists/${id}`),
  updateGist: (id: string, p: { favourite?: boolean; tags?: string[]; folderId?: string | null }) => req<{ gist: Gist }>("PATCH", `/api/gists/${id}`, p),
  deleteGist: (id: string) => req("DELETE", `/api/gists/${id}`),
  send: (id: string, target: ExportTarget) => req<{ url: string | null; openOnClient?: boolean }>("POST", `/api/gists/${id}/send`, { target }),
  savings: () => req<{ totals: Totals }>("GET", "/api/savings"),
};
