import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ExtractionTemplate, Folder } from "@gist/core";
import { detectSourceKind } from "@gist/core";
import { api } from "../api.ts";
import { useSession } from "../main.tsx";

const KIND_LABEL = { youtube: "▶ YouTube video", podcast: "🎙 Podcast episode", web: "📰 Article or blog post", text: "📝 Pasted text" } as const;

export function NewGist() {
  const { user } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  // Share targets (PWA, desktop) may pass the link in url, text or title.
  const shared = params.get("url") || params.get("text")?.match(/https?:\/\/\S+/)?.[0] || "";
  const [input, setInput] = useState(shared);
  const [title, setTitle] = useState("");
  const [focus, setFocus] = useState("");
  const [templates, setTemplates] = useState<ExtractionTemplate[]>([]);
  const [templateId, setTemplateId] = useState(user?.settings.defaultTemplateId ?? "takeaways-actions");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.templates().then((r) => setTemplates(r.templates), () => {});
    api.folders().then((r) => setFolders(r.folders), () => {});
  }, []);

  const kind = useMemo(() => (input.trim() ? detectSourceKind(input) : null), [input]);
  const isText = kind === "text";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { gist } = await api.createGist({
        url: isText ? undefined : input.trim(),
        text: isText ? input : undefined,
        title: isText ? title : undefined,
        templateId,
        focus: focus.trim() || undefined,
        folderId: folderId || null,
      });
      nav(`/app/g/${gist.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="stack composer" onSubmit={submit}>
      <div>
        <h1>What do you want the gist of?</h1>
        <p className="muted">Paste a YouTube, podcast or article link, or paste text.</p>
      </div>
      <div>
        <textarea
          aria-label="Link or text"
          autoFocus
          rows={isText ? 8 : 2}
          placeholder="https://www.youtube.com/watch?v=…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {kind && <span className="pill source-chip" style={{ marginTop: "0.5rem" }}>{KIND_LABEL[kind]}</span>}
      </div>
      {isText && (
        <div className="field">
          <label htmlFor="t">Title <span className="hint">(optional)</span></label>
          <input id="t" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="focus">
          What are you looking for? <span className="hint">(optional, e.g. "pricing tips", "anything about RRSPs", "the workout routine")</span>
        </label>
        <input id="focus" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Leave blank for a general gist" />
      </div>
      <div>
        <div className="row" style={{ marginBottom: "0.5rem" }}>
          <label style={{ margin: 0 }}>Format</label>
          <span className="spacer" />
          <Link to="/app/templates" className="small">Build your own →</Link>
        </div>
        <div className="template-grid">
          {templates.map((t) => (
            <button type="button" key={t.id} className={`template-option ${t.id === templateId ? "selected" : ""}`} onClick={() => setTemplateId(t.id)} aria-pressed={t.id === templateId}>
              <strong>{t.icon} {t.name}</strong>
              <span className="muted small">{t.description || t.sections.map((s) => s.heading).join(" · ")}</span>
            </button>
          ))}
        </div>
      </div>
      {folders.length > 0 && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="folder">Save to folder</label>
          <select id="folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">No folder</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div>
        <button className="btn-primary" disabled={busy || !input.trim()} style={{ padding: "0.7rem 1.4rem" }}>
          {busy ? "Starting…" : "Get the gist"}
        </button>
      </div>
    </form>
  );
}
