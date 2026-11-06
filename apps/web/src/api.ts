import type { ExportTarget, ExtractionTemplate, Folder, Gist, UserSettings } from "@gist/core";
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";

declare global {
  interface Window {
    /** Set by the desktop app's preload script. */
    gistDesktop?: { apiBase: string; onGistUrl: (cb: (url: string) => void) => void; openExternal: (url: string) => void };
  }
}

export type AccountProvider = "youtube" | "spotify";
export interface ConnectionInfo { provider: AccountProvider; available: boolean; connected: boolean; accountName: string | null; note: string | null }
export interface SavedList { id: string; title: string; count: number | null; kind: "likes" | "playlist" | "saved-episodes" }

export const API_BASE: string = window.gistDesktop?.apiBase ?? import.meta.env.VITE_API_URL ?? "";
const TOKEN_KEY = "gist.token";
/**
 * The website keeps its session in an HttpOnly cookie the page's scripts can't read. Only the desktop
 * app, which talks to the server from another origin, keeps a bearer token.
 */
export const USES_BEARER = !!window.gistDesktop;
if (!USES_BEARER) {
  try {
    localStorage.removeItem(TOKEN_KEY); // tokens from before sign-in moved to cookies
  } catch {
    /* storage unavailable */
  }
}

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    if (!USES_BEARER) return;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string | null = null) {
    super(message);
  }
}

/** Raised when a guest tries something that needs an account; the app shows a sign-in prompt. */
export const LOGIN_REQUIRED_EVENT = "gist:loginrequired";

export interface ShareInfo {
  url: string;
  cardUrl: string | null;
  createdAt: string;
}

function headers(json: boolean): Record<string, string> {
  const token = tokenStore.get();
  // The custom header marks requests as coming from the app (the server's cross-site forgery check).
  return { "x-gist-client": "web", ...(json ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (res.status === 401 && !res.url.includes("/api/auth/")) {
    tokenStore.set(null);
    window.dispatchEvent(new Event("gist:signedout"));
  }
  if (data.code === "login_required") window.dispatchEvent(new CustomEvent(LOGIN_REQUIRED_EVENT, { detail: data.error }));
  throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.code ?? null);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await check(await fetch(API_BASE + path, { method, credentials: "include", headers: headers(!!body), body: body ? JSON.stringify(body) : undefined }));
  return (await res.json().catch(() => ({}))) as T;
}

export interface Me {
  id: string;
  email: string | null;
  name: string | null;
  settings: UserSettings;
  /** Trying Gist before creating an account. */
  isGuest: boolean;
  hasPasskeys: boolean;
  google: boolean;
  /** Set for 24 hours after an emailed-code sign-in to an account with passkeys. */
  recoveryUntil: string | null;
  guestGistsLeft?: number;
  /** Mid-recovery on the website: the session can only add a passkey. */
  restricted?: boolean;
}

export interface PasskeyInfo { id: string; name: string; synced: boolean; backedUp: boolean; createdAt: string; lastUsedAt: string | null }
export interface PasskeyList { rpId: string; userHandle: string; passkeys: PasskeyInfo[] }
export interface EmailVerifyResult { token: string; isNew: boolean; recovery: boolean; scoped: boolean; needsPasskey: boolean }

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
  guest: () => req<{ token: string | null; userId: string }>("POST", "/api/auth/guest"),
  emailStart: (email: string) => req<{ ok: true; attemptId: string }>("POST", "/api/auth/email/start", { email }),
  emailVerify: (code: string, attemptId: string | null, name?: string) => req<EmailVerifyResult>("POST", "/api/auth/email/verify", { code, attemptId, name }),
  passkeyRegisterOptions: () => req<{ options: PublicKeyCredentialCreationOptionsJSON }>("POST", "/api/auth/passkey/register/options"),
  passkeyRegisterVerify: (response: RegistrationResponseJSON, name?: string) => req<PasskeyList>("POST", "/api/auth/passkey/register/verify", { response, name }),
  passkeyLoginOptions: () => req<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>("POST", "/api/auth/passkey/login/options"),
  passkeyLoginVerify: (challengeId: string, response: AuthenticationResponseJSON) => req<{ token: string }>("POST", "/api/auth/passkey/login/verify", { challengeId, response }),
  passkeys: () => req<PasskeyList>("GET", "/api/auth/passkeys"),
  renamePasskey: (id: string, name: string) => req<PasskeyList>("PATCH", `/api/auth/passkeys/${encodeURIComponent(id)}`, { name }),
  deletePasskey: (id: string) => req<PasskeyList>("DELETE", `/api/auth/passkeys/${encodeURIComponent(id)}`),
  googleStartUrl: (next?: string | null) => `${API_BASE}/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`,
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

  /** Downloads an export file through fetch, so a sign-in prompt can appear instead of a broken download. */
  async download(path: string) {
    const res = await check(await fetch(API_BASE + path, { credentials: "include", headers: headers(false) }));
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
