import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { DB } from "./db.ts";
import { now } from "./db.ts";
import { IngestError } from "./ingest/http.ts";
import { MAX_IMPORT_ITEMS, type Collection } from "./ingest/playlist.ts";

/**
 * Connected accounts: the user signs in to YouTube (Google) or Spotify so Gist can read
 * the lists they've already saved and import them. Read-only scopes only. Tokens are
 * encrypted at rest with GIST_TOKEN_KEY and can be removed at any time.
 *
 * Platform limits worth knowing (checked 2026-11-05):
 * - YouTube: playlists the user made or saved, and liked videos, are readable.
 *   Watch Later and watch history are not available through the YouTube Data API.
 * - Spotify: saved episodes and the user's own (or collaborative) playlists are readable.
 *   Apps in development mode work for at most 5 allowlisted users; wider access needs
 *   Spotify's extended quota approval.
 */
export type Provider = "youtube" | "spotify";
export const PROVIDERS: Provider[] = ["youtube", "spotify"];

export interface SavedList {
  id: string;
  title: string;
  count: number | null;
  kind: "likes" | "playlist" | "saved-episodes";
}

export interface ConnectionInfo {
  provider: Provider;
  available: boolean;
  connected: boolean;
  accountName: string | null;
  note: string | null;
}

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  extraAuthParams: Record<string, string>;
  basicAuth: boolean;
}

const NOTES: Record<Provider, string> = {
  youtube: "Reads your playlists and liked videos. YouTube doesn't let apps read Watch Later or watch history.",
  spotify: "Reads your saved episodes and your own playlists. Music tracks are skipped.",
};

export function providerConfig(p: Provider, env = process.env): ProviderConfig | null {
  if (p === "youtube") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    return {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      scope: "https://www.googleapis.com/auth/youtube.readonly",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
      basicAuth: false,
    };
  }
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;
  return {
    authUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scope: "user-library-read playlist-read-private playlist-read-collaborative",
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
    extraAuthParams: {},
    basicAuth: true,
  };
}

// ---------- token encryption ----------

function keyFrom(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function unseal(sealed: string, secret: string): string {
  const raw = Buffer.from(sealed.replace(/^v1:/, ""), "base64");
  const d = createDecipheriv("aes-256-gcm", keyFrom(secret), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

const b64url = (b: Buffer) => b.toString("base64url");

export class ConnectionError extends Error {
  constructor(message: string, public status: 400 | 401 | 404 | 409 | 502 | 503 = 400) {
    super(message);
  }
}

type Row = Record<string, unknown>;
type FetchFn = typeof fetch;

export class Connections {
  constructor(
    private db: DB,
    private fetchFn: FetchFn = fetch,
    private env: NodeJS.ProcessEnv = process.env,
  ) {}

  private get secret(): string | null {
    const k = this.env.GIST_TOKEN_KEY;
    return k && k.length >= 32 ? k : null;
  }

  available(p: Provider) {
    return !!providerConfig(p, this.env) && !!this.secret;
  }

  list(uid: string): ConnectionInfo[] {
    return PROVIDERS.map((p) => {
      const r = this.db.prepare("SELECT account_name FROM connections WHERE user_id = ? AND provider = ?").get(uid, p) as Row | undefined;
      return { provider: p, available: this.available(p), connected: !!r, accountName: (r?.account_name as string) ?? null, note: NOTES[p] };
    });
  }

  /** Returns the URL to send the browser to. The state ties the callback back to this user. */
  start(uid: string, p: Provider, redirectUri: string): string {
    const cfg = this.config(p);
    this.db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(new Date(Date.now() - 15 * 60_000).toISOString());
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    this.db.prepare("INSERT INTO oauth_states (state, user_id, provider, verifier, created_at) VALUES (?, ?, ?, ?, ?)").run(state, uid, p, verifier, now());
    const q = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: cfg.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...cfg.extraAuthParams,
    });
    return `${cfg.authUrl}?${q}`;
  }

  /** Handles the provider's redirect: checks the state, swaps the code for tokens and stores them. */
  async finish(p: Provider, state: string, code: string, redirectUri: string): Promise<{ userId: string; accountName: string }> {
    const cfg = this.config(p);
    const st = this.db.prepare("SELECT * FROM oauth_states WHERE state = ? AND provider = ?").get(state, p) as Row | undefined;
    this.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    if (!st || Date.parse(st.created_at as string) < Date.now() - 15 * 60_000) throw new ConnectionError("That sign-in link has expired. Please try connecting again.");
    const tok = await this.tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: st.verifier as string });
    if (!tok.refresh_token) throw new ConnectionError("The account didn't grant ongoing access. Please try connecting again.");
    const uid = st.user_id as string;
    const account = await this.accountInfo(p, tok.access_token);
    const secret = this.secret!;
    this.db.prepare(
      `INSERT INTO connections (user_id, provider, access_token, refresh_token, expires_at, account_id, account_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at, account_id = excluded.account_id, account_name = excluded.account_name`,
    ).run(uid, p, seal(tok.access_token, secret), seal(tok.refresh_token, secret), expiry(tok.expires_in), account.id, account.name, now());
    return { userId: uid, accountName: account.name };
  }

  async disconnect(uid: string, p: Provider): Promise<void> {
    const r = this.row(uid, p);
    if (!r) return;
    this.db.prepare("DELETE FROM connections WHERE user_id = ? AND provider = ?").run(uid, p);
    const cfg = providerConfig(p, this.env);
    if (cfg?.revokeUrl && this.secret) {
      // Best effort: Google revokes the grant; Spotify has no revoke endpoint (users remove apps in their account page).
      await this.fetchFn(cfg.revokeUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: unseal(r.refresh_token as string, this.secret) }) }).catch(() => {});
    }
  }

  /** The lists the user has saved on that platform, for the picker. */
  async savedLists(uid: string, p: Provider): Promise<SavedList[]> {
    if (p === "youtube") {
      const ch = await this.api(uid, p, "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true");
      const likes = ch.items?.[0]?.contentDetails?.relatedPlaylists?.likes as string | undefined;
      const pl = await this.api(uid, p, "https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50");
      const lists: SavedList[] = [];
      if (likes) lists.push({ id: likes, title: "Liked videos", count: null, kind: "likes" });
      for (const it of pl.items ?? []) lists.push({ id: it.id, title: it.snippet?.title ?? "Untitled playlist", count: it.contentDetails?.itemCount ?? null, kind: "playlist" });
      return lists;
    }
    const me = this.row(uid, p)!.account_id as string;
    const eps = await this.api(uid, p, "https://api.spotify.com/v1/me/episodes?limit=1");
    const pls = await this.api(uid, p, "https://api.spotify.com/v1/me/playlists?limit=50");
    const lists: SavedList[] = [{ id: "saved-episodes", title: "Saved episodes", count: eps.total ?? null, kind: "saved-episodes" }];
    // Spotify only returns the contents of playlists the user owns or collaborates on.
    for (const it of pls.items ?? []) {
      if (!it || (it.owner?.id !== me && !it.collaborative)) continue;
      lists.push({ id: it.id, title: it.name ?? "Untitled playlist", count: it.items?.total ?? it.tracks?.total ?? null, kind: "playlist" });
    }
    return lists;
  }

  /** Turns one saved list into the items to summarize, in the same shape as a pasted playlist link. */
  async expand(uid: string, p: Provider, listId: string, limit = 25, title?: string): Promise<Collection> {
    const max = Math.max(1, Math.min(MAX_IMPORT_ITEMS, limit));
    const items: Collection["items"] = [];
    const skipped: Collection["skipped"] = [];
    if (p === "youtube") {
      let page: string | undefined;
      do {
        const q = new URLSearchParams({ part: "snippet,contentDetails", playlistId: listId, maxResults: "50", ...(page ? { pageToken: page } : {}) });
        const r = await this.api(uid, p, `https://www.googleapis.com/youtube/v3/playlistItems?${q}`);
        for (const it of r.items ?? []) {
          const vid = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId;
          const t = it.snippet?.title as string | undefined;
          if (!vid || t === "Private video" || t === "Deleted video") skipped.push({ title: t ?? null, reason: "private or deleted" });
          else items.push({ url: `https://www.youtube.com/watch?v=${vid}`, title: t ?? null });
        }
        page = r.nextPageToken;
      } while (page && items.length < max);
    } else {
      const url = listId === "saved-episodes" ? "https://api.spotify.com/v1/me/episodes?limit=50" : `https://api.spotify.com/v1/playlists/${encodeURIComponent(listId)}/items?limit=50&additional_types=episode`;
      const r = await this.api(uid, p, url);
      for (const it of r.items ?? []) {
        const e = it.episode ?? it.item ?? it.track;
        if (!e?.id) continue;
        if (e.type === "track") skipped.push({ title: e.name ?? null, reason: "music track" });
        else items.push({ url: `https://open.spotify.com/episode/${e.id}`, title: e.name ?? null });
      }
    }
    if (!items.length) throw new IngestError(skipped.length ? `Nothing in that list can be summarized (${skipped[0].reason}).` : "That list looks empty.");
    if (items.length > max) {
      skipped.push({ title: null, reason: `${items.length - max} more item(s) beyond the ${max}-item limit` });
      items.length = max;
    }
    const fallback = listId === "saved-episodes" ? "Spotify saved episodes" : p === "youtube" ? "YouTube playlist" : "Spotify playlist";
    return { kind: p === "youtube" ? "youtube-account" : "spotify-account", title: title?.trim().slice(0, 80) || fallback, items, skipped };
  }

  // ---------- internals ----------

  private config(p: Provider): ProviderConfig {
    const cfg = providerConfig(p, this.env);
    if (!cfg || !this.secret) throw new ConnectionError(`${p === "youtube" ? "YouTube" : "Spotify"} connections aren't set up on this server yet.`, 503);
    return cfg;
  }

  private row(uid: string, p: Provider) {
    return this.db.prepare("SELECT * FROM connections WHERE user_id = ? AND provider = ?").get(uid, p) as Row | undefined;
  }

  private async tokenRequest(cfg: ProviderConfig, params: Record<string, string>) {
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    const form = new URLSearchParams(params);
    if (cfg.basicAuth) headers.authorization = "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    else {
      form.set("client_id", cfg.clientId);
      form.set("client_secret", cfg.clientSecret);
    }
    const res = await this.fetchFn(cfg.tokenUrl, { method: "POST", headers, body: form });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) throw new ConnectionError(j.error === "invalid_grant" ? "reconnect" : "The account sign-in didn't complete. Please try again.", j.error === "invalid_grant" ? 401 : 502);
    return j as { access_token: string; refresh_token?: string; expires_in?: number };
  }

  private async accountInfo(p: Provider, token: string): Promise<{ id: string | null; name: string }> {
    const auth = { headers: { authorization: `Bearer ${token}` } };
    if (p === "youtube") {
      const r = await this.fetchFn("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", auth);
      const j = (await r.json().catch(() => ({}))) as { items?: { id: string; snippet?: { title?: string } }[] };
      const ch = j.items?.[0];
      return { id: ch?.id ?? null, name: ch?.snippet?.title ?? "YouTube account" };
    }
    const r = await this.fetchFn("https://api.spotify.com/v1/me", auth);
    const j = (await r.json().catch(() => ({}))) as { id?: string; display_name?: string };
    return { id: j.id ?? null, name: j.display_name || j.id || "Spotify account" };
  }

  private async accessToken(uid: string, p: Provider): Promise<string> {
    const r = this.row(uid, p);
    if (!r) throw new ConnectionError(`Connect your ${p === "youtube" ? "YouTube" : "Spotify"} account first.`, 409);
    const secret = this.secret;
    if (!secret) throw new ConnectionError("Account connections aren't set up on this server yet.", 503);
    if (Date.parse(r.expires_at as string) - 60_000 > Date.now()) return unseal(r.access_token as string, secret);
    try {
      const tok = await this.tokenRequest(this.config(p), { grant_type: "refresh_token", refresh_token: unseal(r.refresh_token as string, secret) });
      this.db.prepare("UPDATE connections SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ? WHERE user_id = ? AND provider = ?").run(
        seal(tok.access_token, secret), tok.refresh_token ? seal(tok.refresh_token, secret) : null, expiry(tok.expires_in), uid, p,
      );
      return tok.access_token;
    } catch (e) {
      if (e instanceof ConnectionError && e.message === "reconnect") {
        this.db.prepare("DELETE FROM connections WHERE user_id = ? AND provider = ?").run(uid, p);
        throw new ConnectionError(`Your ${p === "youtube" ? "YouTube" : "Spotify"} connection has expired. Please connect it again.`, 401);
      }
      throw e;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async api(uid: string, p: Provider, url: string): Promise<any> {
    const token = await this.accessToken(uid, p);
    const res = await this.fetchFn(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401) throw new ConnectionError(`Your ${p === "youtube" ? "YouTube" : "Spotify"} connection needs to be renewed. Please connect it again.`, 401);
    if (res.status === 403 && p === "spotify") throw new ConnectionError("Spotify only lets Gist read playlists you own or collaborate on, and only for approved testers while Gist awaits Spotify's approval.", 409);
    if (res.status === 404) throw new ConnectionError("That list wasn't found. It may have been deleted.", 404);
    if (!res.ok) throw new ConnectionError(`${p === "youtube" ? "YouTube" : "Spotify"} didn't respond as expected (${res.status}). Please try again shortly.`, 502);
    return res.json();
  }
}

const expiry = (secs?: number) => new Date(Date.now() + (secs ?? 3600) * 1000).toISOString();
