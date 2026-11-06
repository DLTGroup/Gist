import { useEffect, useState } from "react";
import type { ExportTarget, ExtractionTemplate, UserSettings } from "@gist/core";
import { api } from "../api.ts";
import { useSession } from "../main.tsx";
import { ConnectedAccounts } from "../components/ConnectedAccounts.tsx";
import { AccountSecurity } from "../components/AccountSecurity.tsx";
import { useNavigate } from "react-router-dom";

export function SettingsPage() {
  const { user, setUser, signOut } = useSession();
  const nav = useNavigate();
  const [s, setS] = useState<UserSettings>(user!.settings);
  const [templates, setTemplates] = useState<ExtractionTemplate[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.templates().then((r) => setTemplates(r.templates), () => {});
  }, []);

  const set = <K extends keyof UserSettings>(k: K, v: UserSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.updateSettings(s);
      setUser(r.user);
      setS(r.user.settings);
      setMsg("Saved");
      setTimeout(() => setMsg(null), 3000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <h1>Settings</h1>

      <AccountSecurity />

      <ConnectedAccounts />

      <div className="card">
        <h2>Savings</h2>
        <p className="muted small">Used to estimate what each gist saves you.</p>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Your time is worth (per hour)</label>
            <input type="number" min={0} step={1} value={s.hourlyRate} onChange={(e) => set("hourlyRate", Number(e.target.value))} />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label>Currency</label>
            <select value={s.currency} onChange={(e) => set("currency", e.target.value)}>
              {["CAD", "USD", "EUR", "GBP", "AUD"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field" style={{ width: 200 }}>
            <label>You usually watch/listen at</label>
            <select value={s.playbackSpeed} onChange={(e) => set("playbackSpeed", Number(e.target.value))}>
              {[1, 1.25, 1.5, 1.75, 2].map((v) => <option key={v} value={v}>{v}× speed</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Defaults</h2>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Default format</label>
            <select value={s.defaultTemplateId} onChange={(e) => set("defaultTemplateId", e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Automatically send new gists to</label>
            <select value={s.autoExport ?? ""} onChange={(e) => set("autoExport", (e.target.value || null) as ExportTarget | null)}>
              <option value="">Nowhere (I'll send them myself)</option>
              <option value="notion">Notion</option>
              <option value="webhook">My webhook</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Notion</h2>
        <p className="muted small">
          Create an internal integration at notion.so/my-integrations, copy its secret, then share a page with the integration (••• › Connections) and paste that page's link below.
        </p>
        <div className="field">
          <label>Integration secret</label>
          <input type="password" value={s.notionToken ?? ""} onChange={(e) => set("notionToken", e.target.value)} placeholder="ntn_…" autoComplete="off" />
        </div>
        <div className="field">
          <label>Parent page link or ID</label>
          <input value={s.notionParentPageId ?? ""} onChange={(e) => set("notionParentPageId", e.target.value)} placeholder="https://www.notion.so/My-Gists-…" />
        </div>
      </div>

      <div className="card">
        <h2>Obsidian</h2>
        <p className="muted small">Gists open straight in your vault through Obsidian's own link handler. Obsidian must be installed on this device.</p>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>Vault name</label>
            <input value={s.obsidianVault ?? ""} onChange={(e) => set("obsidianVault", e.target.value)} placeholder="My Vault" />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>Folder in the vault</label>
            <input value={s.obsidianFolder ?? ""} onChange={(e) => set("obsidianFolder", e.target.value)} placeholder="Gist" />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Webhook</h2>
        <p className="muted small">Send each gist as JSON and Markdown to Zapier, Make, n8n or your own service, to reach OneNote, Google Docs, Slack and more.</p>
        <div className="field">
          <label>Webhook URL</label>
          <input value={s.webhookUrl ?? ""} onChange={(e) => set("webhookUrl", e.target.value)} placeholder="https://hooks.zapier.com/…" />
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn-primary">Save settings</button>
        {msg && <span className="pill pill-accent">{msg}</span>}
        <span className="spacer" />
        <span className="muted small">{user?.email}</span>
        <button type="button" className="btn-ghost" onClick={() => signOut().then(() => nav("/"))}>Sign out</button>
      </div>
    </form>
  );
}
