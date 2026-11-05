import type { ExportTarget, ExtractionTemplate, Folder, Gist, UserSettings } from "@gist/core";

declare global {
  interface Window {
    /** Set by the desktop app's preload script. */
    gistDesktop?: { apiBase: string; onGistUrl: (cb: (url: string) => void) => void; openExternal: (url: string) => void };
  }
}

export type AccountProvider = "youtube" | "spotify";
export interface ConnectionInfo { provider: AccountProvider; available: boolean; connected: boolean; accountName: string | null; note: string | null }
export interface SavedList { id: string; title: string; count: number | null; kind: "likes" | "playlist" | "saved-episodes" }

const API_BASE: string = window.gistDesktop?.apiBase ?? import.meta.env.VITE_API_URL ?? "";
const TOKEN_KEY = "gist.token";

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface ShareInfo {
  url: string;
  cardUrl: string | null;
  createdAt: string;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(API_BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && token) {
    tokenStore.set(null);
    window.dispatchEvent(new Event("gist:signedout"));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  settings: UserSettings;
}

export interface SavingsReport {
  totals: Totals;
  byWeek: (Totals & { week: string })[];
  byKind: (Totals & { kind: string })[];
  assumptions: { readingWpm: number; noteTakingFactor: number; hourlyRate: number; currency: string; playbackSpeed: number };
}
export interface ImportStatus {
  id: string;
  title: string;
  kind: string;
  sourceUrl: string | null;
  folderId: string | null;
  createdAt: string;
  skipped: { title: string | null; reason: string }[];
  total: number;
  ready: number;
  failed: number;
  processing: number;
  totals: Totals;
  gists?: Gist[];
}
export interface Totals {
  gists: number;
  minutesSaved: number;
  moneySaved: number;
  wordsAvoided: number;
  originalMinutes: number;
  gistMinutes: number;
  currency: string;
}

export const api = {
  health: () => req<{ ok: boolean; demo: boolean }>("GET", "/api/health"),
  signup: (email: string, password: string, name?: string) => req<{ token: string; user: Me }>("POST", "/api/auth/signup", { email, password, name }),
  login: (email: string, password: string) => req<{ token: string; user: Me }>("POST", "/api/auth/login", { email, password }),
  logout: () => req("POST", "/api/auth/logout"),
  me: () => req<{ user: Me }>("GET", "/api/me"),
  updateSettings: (patch: Partial<UserSettings>) => req<{ user: Me }>("PATCH", "/api/settings", patch),

  templates: () => req<{ templates: ExtractionTemplate[] }>("GET", "/api/templates"),
  createTemplate: (t: Partial<ExtractionTemplate>) => req<{ template: ExtractionTemplate }>("POST", "/api/templates", t),
  updateTemplate: (id: string, t: Partial<ExtractionTemplate>) => req<{ template: ExtractionTemplate }>("PUT", `/api/templates/${id}`, t),
  deleteTemplate: (id: string) => req("DELETE", `/api/templates/${id}`),

  folders: () => req<{ folders: Folder[] }>("GET", "/api/folders"),
  createFolder: (name: string) => req<{ folder: Folder }>("POST", "/api/folders", { name }),
  renameFolder: (id: string, name: string) => req("PATCH", `/api/folders/${id}`, { name }),
  deleteFolder: (id: string) => req("DELETE", `/api/folders/${id}`),
  tags: () => req<{ tags: { tag: string; count: number }[] }>("GET", "/api/tags"),

  createGist: (b: { url?: string; text?: string; title?: string; templateId?: string; focus?: string; folderId?: string | null }) =>
    req<{ gist: Gist }>("POST", "/api/gists", b),
  gists: (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    return req<{ gists: Gist[]; hasMore: boolean }>("GET", `/api/gists?${q}`);
  },
  gist: (id: string) => req<{ gist: Gist }>("GET", `/api/gists/${id}`),
  updateGist: (id: string, patch: { folderId?: string | null; tags?: string[]; favourite?: boolean; title?: string }) =>
    req<{ gist: Gist }>("PATCH", `/api/gists/${id}`, patch),
  deleteGist: (id: string) => req("DELETE", `/api/gists/${id}`),
  regenerate: (id: string, templateId?: string, focus?: string) => req<{ gist: Gist }>("POST", `/api/gists/${id}/regenerate`, { templateId, focus }),
  getShare: (id: string) => req<{ share: ShareInfo | null }>("GET", `/api/gists/${id}/share`),
  createShare: (id: string, card?: string) => req<{ share: ShareInfo }>("POST", `/api/gists/${id}/share`, { card }),
  deleteShare: (id: string) => req("DELETE", `/api/gists/${id}/share`),
  send: (id: string, target: ExportTarget) => req<{ url: string | null; openOnClient?: boolean }>("POST", `/api/gists/${id}/send`, { target }),
  savings: () => req<SavingsReport>("GET", "/api/savings"),
  connections: () => req<{ connections: ConnectionInfo[] }>("GET", "/api/connections"),
  startConnection: (p: AccountProvider) => req<{ url: string }>("POST", `/api/connections/${p}/start`),
  disconnect: (p: AccountProvider) => req("DELETE", `/api/connections/${p}`),
  savedLists: (p: AccountProvider) => req<{ lists: SavedList[] }>("GET", `/api/connections/${p}/lists`),
  createImport: (b: { url?: string; urls?: string[]; connection?: { provider: AccountProvider; listId: string; title?: string }; limit?: number; templateId?: string; focus?: string; folderId?: string | null; title?: string }) =>
    req<{ import: ImportStatus }>("POST", "/api/imports", b),
  imports: () => req<{ imports: ImportStatus[] }>("GET", "/api/imports"),
  importStatus: (id: string) => req<{ import: ImportStatus }>("GET", `/api/imports/${id}`),
  retryImport: (id: string) => req<{ retried: number }>("POST", `/api/imports/${id}/retry`),

  /** Downloads an export file using the auth header (a plain link can't carry it). */
  async download(path: string) {
    const res = await fetch(API_BASE + path, { headers: { authorization: `Bearer ${tokenStore.get()}` } });
    if (!res.ok) throw new ApiError("Export failed", res.status);
    const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "gist.txt";
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export function openExternal(url: string) {
  if (window.gistDesktop) window.gistDesktop.openExternal(url);
  else window.location.href = url;
}
