import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatMinutes, formatMoney } from "@gist/core";
import { api, type ImportStatus } from "../api.ts";

/** Progress and results for a playlist, show, feed or link-list import. */
export function ImportView() {
  const { id } = useParams();
  const [imp, setImp] = useState<ImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const load = () =>
      api.importStatus(id!).then(
        (r) => {
          if (!alive) return;
          setImp(r.import);
          if (r.import.processing > 0) timer = setTimeout(load, 2500);
        },
        (e) => setError(e.message),
      );
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!imp) return <p className="muted">Loading…</p>;
  const done = imp.ready + imp.failed;
  const pct = imp.total ? Math.round((done / imp.total) * 100) : 0;

  return (
    <div className="stack">
      <div>
        <span className="pill pill-accent">{KIND[imp.kind] ?? "Import"}</span>
        <h1 style={{ marginTop: "0.6rem" }}>{imp.title}</h1>
        <p className="muted small">
          {imp.sourceUrl && <><a href={imp.sourceUrl} target="_blank" rel="noreferrer">Open the original</a> · </>}
          Saved to the folder <Link to={`/app/library?folder=${imp.folderId}`}>{imp.title}</Link>
        </p>
      </div>

      <div className="card">
        <div className="row">
          <strong>{imp.processing > 0 ? `Working on ${imp.total} items…` : `Done: ${imp.ready} of ${imp.total} summarized`}</strong>
          <span className="spacer" />
          <span className="muted small">{done}/{imp.total}</span>
        </div>
        <div className="bar" style={{ gridTemplateColumns: "1fr", marginTop: "0.6rem" }}>
          <div className="track"><div className="fill" style={{ width: `${pct}%`, background: "var(--accent)" }} /></div>
        </div>
        {imp.ready > 0 && (
          <div className="savings-strip" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="stat"><span className="v">{formatMinutes(imp.totals.minutesSaved)}</span><span className="l">time saved</span></div>
            <div className="stat"><span className="v">{formatMoney(imp.totals.moneySaved, imp.totals.currency)}</span><span className="l">value of that time</span></div>
            <div className="stat"><span className="v">{formatMinutes(imp.totals.gistMinutes)}</span><span className="l">to read them all</span></div>
          </div>
        )}
        <div className="row">
          <button disabled={!imp.ready} onClick={() => api.download(`/api/export/markdown?import=${imp.id}`)}>Download all as Markdown</button>
          <button disabled={!imp.ready} onClick={() => api.download(`/api/export/evernote?ids=${(imp.gists ?? []).filter((g) => g.status === "ready").map((g) => g.id).join(",")}`)}>Evernote (.enex)</button>
          {imp.failed > 0 && imp.processing === 0 && (
            <button className="btn-ghost" onClick={async () => { await api.retryImport(imp.id); location.reload(); }}>Retry {imp.failed} failed</button>
          )}
        </div>
      </div>

      <div className="list">
        {(imp.gists ?? []).map((g, i) => (
          <Link key={g.id} to={`/app/g/${g.id}`} className="card gist-row">
            {g.source.thumbnailUrl ? <img src={g.source.thumbnailUrl} alt="" loading="lazy" /> : <div className="thumb">{i + 1}</div>}
            <div>
              <h3>{g.summary?.title ?? g.source.title}</h3>
              <p>{g.status === "processing" ? "Waiting or working…" : g.status === "failed" ? `Couldn't summarize: ${g.error}` : g.summary?.tldr}</p>
            </div>
            <div className="meta-right">
              {g.status === "processing" ? <div className="spinner" /> : g.savings ? <span className="pill pill-save">−{formatMinutes(g.savings.minutesSaved)}</span> : g.status === "failed" ? <span className="pill">failed</span> : null}
            </div>
          </Link>
        ))}
      </div>

      {imp.skipped.length > 0 && (
        <details className="card">
          <summary>{imp.skipped.length} item(s) not imported</summary>
          <ul className="small muted">{imp.skipped.map((s, i) => <li key={i}>{s.title ? `${s.title}: ` : ""}{s.reason}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

const KIND: Record<string, string> = {
  "youtube-playlist": "▶ YouTube playlist",
  "spotify-playlist": "🎧 Spotify playlist",
  "spotify-show": "🎙 Spotify show",
  "apple-show": "🎙 Apple Podcasts show",
  "podcast-feed": "🎙 Podcast feed",
  links: "🔗 Link list",
};
