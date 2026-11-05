import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Folder, Gist } from "@gist/core";
import { formatMinutes, sourcePlatform } from "@gist/core";
import { PlatformIcon } from "../lib/platformIcons.tsx";
import { api, type ImportStatus } from "../api.ts";

export function Library() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const folder = params.get("folder") ?? "";
  const tag = params.get("tag") ?? "";
  const kind = params.get("kind") ?? "";
  const favourite = params.get("favourite") ?? "";
  const [gists, setGists] = useState<Gist[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [search, setSearch] = useState(q);
  const [imports, setImports] = useState<ImportStatus[]>([]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => search !== q && set("q", search), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    api.gists({ q, folder, tag, kind, favourite }).then((r) => setGists(r.gists), () => setGists([]));
  }, [q, folder, tag, kind, favourite]);
  const reloadFolders = () => api.folders().then((r) => setFolders(r.folders), () => {});
  useEffect(() => {
    reloadFolders();
    api.tags().then((r) => setTags(r.tags), () => {});
    api.imports().then((r) => setImports(r.imports), () => {});
  }, []);

  const current = folders.find((f) => f.id === folder);

  return (
    <div>
      <div className="row" style={{ marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>{current ? current.name : "Library"}</h1>
        <span className="spacer" />
        {current && (
          <button className="btn-ghost btn-danger small" onClick={async () => { if (confirm(`Delete the folder "${current.name}"? Gists in it are kept.`)) { await api.deleteFolder(current.id); set("folder", ""); reloadFolders(); } }}>
            Delete folder
          </button>
        )}
        <button onClick={async () => { const name = prompt("Folder name"); if (name?.trim()) { await api.createFolder(name.trim()); reloadFolders(); } }}>＋ New folder</button>
        <button onClick={() => api.download("/api/export/evernote")} title="Export everything as an Evernote file">Export all</button>
      </div>

      {imports.length > 0 && !folder && (
        <div className="row small" style={{ marginBottom: "0.8rem" }}>
          <span className="muted">Imports:</span>
          {imports.slice(0, 6).map((i) => (
            <Link key={i.id} to={`/app/imports/${i.id}`} className="pill">
              {i.title} · {i.processing ? `${i.ready + i.failed}/${i.total}` : `${i.ready} gists`}
            </Link>
          ))}
        </div>
      )}
      <div className="filters">
        <input type="search" placeholder="Search your gists…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <select value={folder} onChange={(e) => set("folder", e.target.value)} aria-label="Folder">
          <option value="">All folders</option>
          <option value="none">Unfiled</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.gistCount})</option>)}
        </select>
        <select value={kind} onChange={(e) => set("kind", e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="youtube">Videos</option>
          <option value="podcast">Podcasts</option>
          <option value="web">Articles</option>
          <option value="text">Pasted text</option>
        </select>
      </div>

      <div className="tag-cloud">
        <button className={favourite ? "on" : ""} onClick={() => set("favourite", favourite ? "" : "1")}>★ Favourites</button>
        {tags.slice(0, 30).map((t) => (
          <button key={t.tag} className={tag === t.tag ? "on" : ""} onClick={() => set("tag", tag === t.tag ? "" : t.tag)}>
            #{t.tag} <span className="muted">{t.count}</span>
          </button>
        ))}
      </div>

      {gists === null ? (
        <p className="muted">Loading…</p>
      ) : gists.length === 0 ? (
        <div className="card">
          <p>{q || folder || tag || kind || favourite ? "Nothing matches those filters." : "No gists yet."}</p>
          <Link className="btn btn-primary" to="/app/new">Make a gist</Link>
        </div>
      ) : (
        <div className="list">
          {gists.map((g) => (
            <Link key={g.id} to={`/app/g/${g.id}`} className="card gist-row">
              
              <div>
                <h3>{g.favourite && "★ "}{g.summary?.title ?? g.source.title}</h3>
                <p>{g.status === "processing" ? "Working on it…" : g.status === "failed" ? `Couldn't make this gist: ${g.error}` : g.summary?.tldr}</p>
                <div className="row" style={{ marginTop: "0.35rem" }}>{g.tags.slice(0, 4).map((t) => <span key={t} className="pill">#{t}</span>)}</div>
              </div>
              <div className="meta-right" style={{ textAlign: "right" }}>
                {g.savings && <span className="pill pill-save">−{formatMinutes(g.savings.minutesSaved)}</span>}
                <div className="muted small" style={{ marginTop: "0.3rem" }}>{new Date(g.createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</div>
              </div>
              <span className="pf-mark"><PlatformIcon platform={sourcePlatform(g.source)} size={15} /></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
