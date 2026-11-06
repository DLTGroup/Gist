import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ExtractionTemplate, Folder } from "@gist/core";
import { DEFAULT_TEMPLATE_ID, PLATFORM_LABEL, detectCollection, detectSourceKind, extractLinks } from "@gist/core";
import { api } from "../api.ts";
import { useSession } from "../main.tsx";
import { SavedListPicker, type PickedList } from "../components/SavedListPicker.tsx";

const COLLECTION_LABEL = {
  "youtube-playlist": "▶ YouTube playlist",
  "spotify-playlist": "🎧 Spotify playlist",
  "spotify-show": "🎙 Spotify podcast show",
  "apple-show": "🎙 Apple Podcasts show",
  "podcast-feed": "🎙 Podcast feed",
} as const;

const KIND_LABEL = { youtube: "▶ YouTube video", podcast: "🎙 Podcast episode", web: "📰 Article or blog post", text: "📝 Pasted text" } as const;

export function NewGist() {
  const { user, refresh } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  // Share targets (PWA, desktop) may pass the link in url, text or title.
  const shared = params.get("url") || params.get("text")?.match(/https?:\/\/\S+/)?.[0] || "";
  const [input, setInput] = useState(shared);
  const [title, setTitle] = useState("");
  const [focus, setFocus] = useState("");
  const [templates, setTemplates] = useState<ExtractionTemplate[]>([]);
  const [templateId, setTemplateId] = useState(user?.settings.defaultTemplateId ?? DEFAULT_TEMPLATE_ID);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<PickedList | null>(null);

  useEffect(() => {
    api.templates().then((r) => setTemplates(r.templates), () => {});
    api.folders().then((r) => setFolders(r.folders), () => {});
  }, []);

  const kind = useMemo(() => (input.trim() ? detectSourceKind(input) : null), [input]);
  const links = useMemo(() => extractLinks(input), [input]);
  const collection = useMemo(() => (links.length === 1 && input.trim() === links[0] ? detectCollection(links[0]) : null), [input, links]);
  const [wholeList, setWholeList] = useState(true);
  const [limit, setLimit] = useState(25);
  const bulkLinks = links.length > 1 && links.join(" ").length > input.replace(/\s+/g, " ").trim().length * 0.6;
  const importMode = !!picked || bulkLinks || (!!collection && (!collection.ambiguous || wholeList));
  const isText = kind === "text" && !bulkLinks;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (importMode) {
        const { import: imp } = await api.createImport({
          ...(picked ? { connection: { provider: picked.provider, listId: picked.list.id, title: picked.list.title } } : bulkLinks ? { urls: links } : { url: input.trim() }),
          limit,
          templateId,
          focus: focus.trim() || undefined,
          folderId: folderId || null,
        });
        nav(`/app/imports/${imp.id}`);
        return;
      }
      const { gist } = await api.createGist({
        url: isText ? undefined : input.trim(),
        text: isText ? input : undefined,
        title: isText ? title : undefined,
        templateId,
        focus: focus.trim() || undefined,
        folderId: folderId || null,
      });
      if (user?.isGuest) void refresh(); // updates the guest's remaining free gists
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
        <p className="muted">Paste a YouTube, podcast or article link, a whole playlist, several links at once, or some text.</p>
      </div>
      <div>
        <textarea
          aria-label="Link or text"
          autoFocus
          rows={isText ? 8 : 2}
          placeholder="https://www.youtube.com/watch?v=…"
          value={input}
          onChange={(e) => { setInput(e.target.value); if (e.target.value.trim()) setPicked(null); }}
        />
        {kind && !importMode && !collection && <span className="pill source-chip" style={{ marginTop: "0.5rem" }}>{KIND_LABEL[kind]}</span>}
      </div>
      {!input.trim() && !user?.isGuest && <SavedListPicker picked={picked} onPick={setPicked} />}
      {(picked || collection || bulkLinks) && (
        <div className="card" style={{ background: "var(--accent-soft)", borderColor: "transparent", boxShadow: "none" }}>
          <strong>{picked ? `${PLATFORM_LABEL[picked.provider]}: ${picked.list.title}` : bulkLinks ? `${links.length} links found` : COLLECTION_LABEL[collection!.kind]}</strong>
          {collection?.ambiguous && (
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <label className="row" style={{ fontWeight: 400, margin: 0 }}><input type="radio" style={{ width: "auto" }} checked={wholeList} onChange={() => setWholeList(true)} /> The whole playlist</label>
              <label className="row" style={{ fontWeight: 400, margin: 0 }}><input type="radio" style={{ width: "auto" }} checked={!wholeList} onChange={() => setWholeList(false)} /> Just this video</label>
            </div>
          )}
          {importMode && (
            <>
              <p className="muted small" style={{ margin: "0.4rem 0" }}>
                Each {picked?.provider === "youtube" || collection?.kind === "youtube-playlist" || bulkLinks ? "item" : "episode"} gets its own gist in the format below, all filed in a new folder, with combined savings.
                {(collection?.kind === "spotify-playlist" || picked?.provider === "spotify") && " Music tracks are skipped; podcast episodes are summarized."}
              </p>
              <div className="row">
                <label htmlFor="limit" style={{ margin: 0 }}>Summarize up to</label>
                <select id="limit" style={{ width: "auto" }} value={limit} onChange={(e) => setLimit(+e.target.value)}>
                  {[5, 10, 25, 50].map((n) => <option key={n} value={n}>{n} items</option>)}
                </select>
                {!bulkLinks && !picked && collection?.kind !== "youtube-playlist" && <span className="muted small">(newest first)</span>}
              </div>
            </>
          )}
        </div>
      )}
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
        <button className="btn-primary" disabled={busy || (!input.trim() && !picked)} style={{ padding: "0.7rem 1.4rem" }}>
          {busy ? "Starting…" : importMode ? "Summarize them all" : "Get the gist"}
        </button>
      </div>
    </form>
  );
}
