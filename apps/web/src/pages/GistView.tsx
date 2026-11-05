import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ExtractionTemplate, Folder, Gist, MemoryCard } from "@gist/core";
import { formatMinutes, formatMoney, formatTimestamp, sourceLinks, timestampLink, toPlainText } from "@gist/core";
import { api, openExternal } from "../api.ts";
import { useSession } from "../main.tsx";
import { ListenBar } from "../components/ListenBar.tsx";
import { ShareSheet } from "../components/ShareSheet.tsx";

export function GistView() {
  const { id } = useParams();
  const nav = useNavigate();
  const [gist, setGist] = useState<Gist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [sharing, setSharing] = useState(false);
  const mem = useStars(gist);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const load = () =>
      api.gist(id!).then(
        (r) => {
          if (!alive) return;
          setGist(r.gist);
          if (r.gist.status === "processing") timer = setTimeout(load, 1500);
        },
        (e) => setError(e.message),
      );
    load();
    api.folders().then((r) => setFolders(r.folders), () => {});
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!gist) return <p className="muted">Loading…</p>;

  const update = async (patch: Parameters<typeof api.updateGist>[1]) => setGist((await api.updateGist(gist.id, patch)).gist);

  return (
    <article>
      <div className="gist-head">
        {gist.source.thumbnailUrl ? <img src={gist.source.thumbnailUrl} alt="" /> : <div className="thumb card" style={{ aspectRatio: "16/9", display: "grid", placeItems: "center", fontSize: "2rem" }}>{icon(gist)}</div>}
        <div>
          <h1 data-say="title">{gist.summary?.title ?? gist.source.title}</h1>
          <p className="muted small">
            {icon(gist)}{" "}
            {gist.source.url ? <a href={gist.source.url} target="_blank" rel="noreferrer">{gist.source.title}</a> : gist.source.title}
            {gist.source.author && <> · {gist.source.author}</>}
            {gist.source.durationSeconds ? <> · {formatTimestamp(gist.source.durationSeconds)}</> : gist.source.wordCount ? <> · {gist.source.wordCount.toLocaleString("en-CA")} words</> : null}
          </p>
          <Sources gist={gist} />
          {gist.status === "ready" && (
            <div className="row">
              <button className="btn-ghost" onClick={() => update({ favourite: !gist.favourite })} aria-pressed={gist.favourite}>
                {gist.favourite ? "★ Favourite" : "☆ Favourite"}
              </button>
              <select aria-label="Folder" style={{ width: "auto" }} value={gist.folderId ?? ""} onChange={(e) => update({ folderId: e.target.value || null })}>
                <option value="">No folder</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <span className="spacer" />
              <button className="btn-primary share-open" onClick={() => setSharing(true)}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>
                Share
              </button>
              <ExportMenu gist={gist} />
            </div>
          )}
        </div>
      </div>

      {gist.status === "processing" && (
        <div className="card processing" style={{ marginTop: "1.5rem" }}>
          <div className="spinner" />
          <div>
            <strong>Working on it…</strong>
            <div className="muted small">Fetching the {gist.source.kind === "youtube" ? "captions" : gist.source.kind === "podcast" ? "episode" : "content"} and pulling out what you asked for. Long podcasts can take a minute or two.</div>
          </div>
        </div>
      )}

      {gist.status === "failed" && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <p className="error">{gist.error}</p>
          <div className="row">
            {gist.source.kind !== "text" && <button onClick={async () => setGist((await api.regenerate(gist.id)).gist)}>Try again</button>}
            <button className="btn-danger" onClick={async () => { await api.deleteGist(gist.id); nav("/app/library"); }}>Delete</button>
          </div>
        </div>
      )}

      {gist.status === "ready" && gist.summary && (
        <>
          {gist.savings && (
            <div className="savings-strip" aria-label="Savings">
              <div className="stat"><span className="v">{formatMinutes(gist.savings.minutesSaved)}</span><span className="l">time saved</span></div>
              <div className="stat"><span className="v">{formatMoney(gist.savings.moneySaved, gist.savings.currency)}</span><span className="l">value of that time</span></div>
              <div className="stat"><span className="v">{Math.round(gist.savings.effortReduction * 100)}%</span><span className="l">less to read</span></div>
              <div className="stat"><span className="v">{formatMinutes(gist.savings.gistMinutes)}</span><span className="l">to read this gist</span></div>
            </div>
          )}
          <ListenBar gist={gist} />
          {gist.focus && <p className="pill pill-accent">Looking for: {gist.focus}</p>}
          <p className="tldr" data-say="tldr"><strong>TL;DR</strong> {gist.summary.tldr}<Star mem={mem} sectionId="tldr" itemIndex={-1} text={gist.summary.tldr} /></p>
          <MemoryBar gist={gist} mem={mem} />

          {gist.summary.sections.map((sec) => {
            if (!sec.paragraph && !sec.items.length) return null;
            const List = sec.format === "numbered" ? "ol" : "ul";
            return (
              <section className="section" key={sec.id}>
                <h2 data-say={`h:${sec.id}`}>{sec.heading}</h2>
                {sec.paragraph && <p data-say={`p:${sec.id}`}>{sec.paragraph}<Star mem={mem} sectionId={sec.id} itemIndex={-1} text={sec.paragraph} /></p>}
                {sec.items.length > 0 && (
                  <List>
                    {sec.items.map((it, i) => (
                      <li key={i} data-say={`i:${sec.id}:${i}`} className={sec.format === "checklist" ? "check" : undefined}>
                        {sec.format === "checklist" && <input type="checkbox" aria-label="Done" />}
                        <span>
                          {it.text}
                          {it.timestamp != null && <Timestamp gist={gist} seconds={it.timestamp} />}
                          <Star mem={mem} sectionId={sec.id} itemIndex={i} text={it.text} />
                        </span>
                      </li>
                    ))}
                  </List>
                )}
              </section>
            );
          })}

          <TagEditor tags={gist.tags} onChange={(tags) => update({ tags })} />
          <Regenerate gist={gist} onDone={setGist} />
          <p className="muted small" style={{ marginTop: "2rem" }}>
            Summary written by {gist.model?.startsWith("demo") ? "the demo extractor" : "Claude"} from the {gist.source.kind === "web" ? "article" : "transcript"}. Check important details against the{" "}
            {gist.source.url ? <a href={gist.source.url} target="_blank" rel="noreferrer">original</a> : "original"}.
            <button className="btn-ghost btn-danger small" onClick={async () => { if (confirmDelete()) { await api.deleteGist(gist.id); nav("/app/library"); } }}>Delete gist</button>
          </p>
        </>
      )}
      {sharing && gist.summary && <ShareSheet gist={gist} onClose={() => setSharing(false)} />}
    </article>
  );
}

const confirmDelete = () => window.confirm("Delete this gist?");

type Stars = ReturnType<typeof useStars>;

/** Cards made from this gist's takeaways, and starring/unstarring them. */
function useStars(gist: Gist | null) {
  const [cards, setCards] = useState<MemoryCard[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const ready = gist?.status === "ready";
  const gid = gist?.id;
  useEffect(() => {
    if (ready && gid) api.gistCards(gid).then((r) => setCards(r.cards), () => {});
  }, [ready, gid]);
  const say = (m: string) => {
    setNote(m);
    setTimeout(() => setNote(null), 4000);
  };
  const isStarred = (text: string) => cards.some((c) => c.source?.text === text);
  const toggle = async (sectionId: string, itemIndex: number, text: string) => {
    if (!gid || busy.has(text)) return;
    setBusy(new Set(busy).add(text));
    try {
      const mine = cards.filter((c) => c.source?.text === text);
      if (mine.length) {
        await Promise.all(mine.map((c) => api.deleteCard(c.id)));
        setCards((cs) => cs.filter((c) => c.source?.text !== text));
        say("Removed from Memory");
      } else {
        const r = await api.starTakeaways(gid, { items: [{ sectionId, itemIndex }] });
        setCards((cs) => [...cs, ...r.cards]);
        say(r.cards.length ? `Added to Memory: ${r.cards[0].front.slice(0, 70)}${r.cards[0].front.length > 70 ? "…" : ""}` : "Already in Memory");
      }
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(text);
        return n;
      });
    }
  };
  const starAll = async () => {
    if (!gid) return;
    setBusy(new Set(["*"]));
    try {
      const r = await api.starTakeaways(gid, { all: true });
      setCards((cs) => [...cs, ...r.cards]);
      say(r.cards.length ? `Added ${r.cards.length} card${r.cards.length === 1 ? "" : "s"} to Memory` : "Everything here is already in Memory");
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(new Set());
    }
  };
  return { cards, busy, note, isStarred, toggle, starAll };
}

function Star({ mem, sectionId, itemIndex, text }: { mem: Stars; sectionId: string; itemIndex: number; text: string }) {
  const on = mem.isStarred(text);
  return (
    <button
      className={`star${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={on ? "Remove from Memory" : "Remember this"}
      title={on ? "In Memory: tap to remove" : "Remember this: Gist will quiz you on it"}
      disabled={mem.busy.has(text) || mem.busy.has("*")}
      onClick={() => mem.toggle(sectionId, itemIndex, text)}
    >
      {mem.busy.has(text) ? "…" : on ? "★" : "☆"}
    </button>
  );
}

function MemoryBar({ gist, mem }: { gist: Gist; mem: Stars }) {
  const n = mem.cards.length;
  return (
    <div className="memory-bar row small">
      <span>
        <strong>★ Memory</strong>{" "}
        <span className="muted">{n ? `${n} card${n === 1 ? "" : "s"} from this gist` : "Star the takeaways you want to keep, and Gist will quiz you on them."}</span>
      </span>
      <span className="spacer" />
      <button className="btn-ghost small" onClick={mem.starAll} disabled={mem.busy.has("*")}>{mem.busy.has("*") ? "Making cards…" : "Remember all"}</button>
      {n > 0 && <Link className="btn small" to={`/app/review?gist=${gist.id}`}>Review</Link>}
      {n > 1 && <Link className="btn small" to={`/app/quiz?gist=${gist.id}`}>Quiz</Link>}
      {mem.note && <span className="pill pill-accent memory-note" role="status">{mem.note}</span>}
    </div>
  );
}

function icon(g: Gist) {
  return { youtube: "▶", podcast: "🎙", web: "📰", text: "📝" }[g.source.kind];
}

function Timestamp({ gist, seconds }: { gist: Gist; seconds: number }) {
  const link = timestampLink(gist.source.kind, gist.source.url, seconds, gist.source.audioUrl);
  const label = formatTimestamp(seconds);
  return link ? <a className="ts" href={link} target="_blank" rel="noreferrer" title="Jump to this moment">{label}</a> : <span className="ts">{label}</span>;
}

const LINK_ICON = { original: "↗", transcript: "📄", audio: "🎧" } as const;

/** Links back to the original, its transcript and its audio. Gist stores links only, never the source text. */
function Sources({ gist }: { gist: Gist }) {
  const links = sourceLinks(gist.source);
  if (!links.length) return null;
  const notes = links.filter((l) => l.note);
  return (
    <div className="sources" aria-label="Sources">
      <div className="row small">
        {links.map((l) => (
          <a key={l.kind + l.url} className="pill" href={l.url} target="_blank" rel="noreferrer" title={l.note}>
            {LINK_ICON[l.kind]} {l.label}
          </a>
        ))}
      </div>
      {notes.map((l) => <p key={"n" + l.kind} className="muted small" style={{ margin: "0.3rem 0 0" }}>{l.note}</p>)}
    </div>
  );
}

function ExportMenu({ gist }: { gist: Gist }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const s = user?.settings;
  const run = async (label: string, fn: () => Promise<string | void>) => {
    setOpen(false);
    setMsg(`${label}…`);
    try {
      setMsg((await fn()) ?? `${label}: done`);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setTimeout(() => setMsg(null), 6000);
  };
  const send = (target: "notion" | "obsidian" | "webhook") => async () => {
    const r = await api.send(gist.id, target);
    if (r.openOnClient && r.url) openExternal(r.url);
    else if (r.url) window.open(r.url, "_blank", "noopener");
    return target === "obsidian" ? "Opened in Obsidian" : target === "notion" ? "Saved to Notion" : "Sent to your webhook";
  };

  return (
    <div className="menu" ref={ref}>
      <button className="btn-primary" onClick={() => setOpen(!open)} aria-expanded={open}>Send to… ▾</button>
      {msg && <span className="pill" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", whiteSpace: "nowrap" }}>{msg}</span>}
      {open && (
        <div className="menu-pop" role="menu">
          <button role="menuitem" onClick={() => run("Notion", send("notion"))}>Notion {!s?.notionToken && <span className="muted small">(set up)</span>}</button>
          <button role="menuitem" onClick={() => run("Obsidian", send("obsidian"))}>Obsidian {!s?.obsidianVault && <span className="muted small">(set up)</span>}</button>
          <button role="menuitem" onClick={() => run("Evernote file", () => api.download(`/api/gists/${gist.id}/export/evernote`).then(() => "Downloaded .enex — import it in Evernote"))}>Evernote (.enex)</button>
          <button role="menuitem" onClick={() => run("Markdown", () => api.download(`/api/gists/${gist.id}/export/markdown`).then(() => "Downloaded Markdown"))}>Markdown (.md)</button>
          {s?.webhookUrl && <button role="menuitem" onClick={() => run("Webhook", send("webhook"))}>Webhook (Zapier, Make…)</button>}
          <button role="menuitem" onClick={() => run("Copy", () => navigator.clipboard.writeText(toPlainText(gist)).then(() => "Copied to clipboard"))}>Copy as text</button>
          {"share" in navigator && (
            <button role="menuitem" onClick={() => run("Share", () => navigator.share({ title: gist.summary?.title, text: toPlainText(gist) }).then(() => "Shared"))}>Share… (Apple Notes, Keep, OneNote)</button>
          )}
        </div>
      )}
    </div>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    if (draft.trim()) onChange([...tags, draft.trim()]);
    setDraft("");
  };
  return (
    <div className="row" style={{ marginTop: "1.5rem" }}>
      {tags.map((t) => (
        <span key={t} className="pill">
          #{t} <button className="btn-ghost" style={{ padding: 0 }} aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      <input style={{ width: 160 }} placeholder="Add tag" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} onBlur={add} />
    </div>
  );
}

function Regenerate({ gist, onDone }: { gist: Gist; onDone: (g: Gist) => void }) {
  const [templates, setTemplates] = useState<ExtractionTemplate[]>([]);
  const [tpl, setTpl] = useState(gist.templateId);
  const [focus, setFocus] = useState(gist.focus ?? "");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !templates.length) api.templates().then((r) => setTemplates(r.templates), () => {});
  }, [open, templates.length]);
  if (gist.source.kind === "text") return null;
  if (!open) return <button className="btn-ghost small" style={{ marginTop: "1rem" }} onClick={() => setOpen(true)}>↻ Re-run with a different format or focus</button>;
  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <div className="row">
        <select style={{ maxWidth: 260 }} value={tpl} onChange={(e) => setTpl(e.target.value)}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
        </select>
        <input style={{ flex: 1, minWidth: 200 }} placeholder="What are you looking for?" value={focus} onChange={(e) => setFocus(e.target.value)} />
        <button className="btn-primary" onClick={async () => onDone((await api.regenerate(gist.id, tpl, focus)).gist)}>Re-run</button>
      </div>
    </div>
  );
}
