import { useEffect, useRef, useState } from "react";
import { shareLinks, shareMessage, type Gist } from "@gist/core";
import { api, type ShareInfo } from "../api.ts";
import { canvasToBlob, drawShareCard, type CardFormat } from "../lib/shareCard.ts";

const NETWORKS = [
  { key: "x", label: "X" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
] as const;

/** Share sheet: a public link with a preview card, links for X, WhatsApp, Facebook and LinkedIn, and an image for Instagram. */
export function ShareSheet({ gist, onClose }: { gist: Gist; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState<CardFormat>("post");
  const [message, setMessage] = useState(() => shareMessage(gist));
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { api.getShare(gist.id).then((r) => setShare(r.share), () => {}); }, [gist.id]);
  useEffect(() => { if (canvas.current) drawShareCard(canvas.current, gist, format); }, [gist, format]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const links = shareLinks(message, share?.url ?? null);

  async function createLink() {
    setBusy(true);
    setNote(null);
    try {
      // The preview card is always the square post size, which X, Facebook and WhatsApp crop well.
      const off = document.createElement("canvas");
      drawShareCard(off, gist, "post");
      setShare((await api.createShare(gist.id, off.toDataURL("image/png"))).share);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stopSharing() {
    await api.deleteShare(gist.id);
    setShare(null);
    setNote("Sharing is off. The old link no longer works.");
  }
  async function shareImage() {
    const blob = await canvasToBlob(canvas.current!);
    const name = `${gist.summary!.title.replace(/[^\w ]+/g, "").trim().slice(0, 40).replace(/\s+/g, "-").toLowerCase() || "gist"}${format === "story" ? "-story" : ""}.png`;
    const file = new File([blob], name, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: message }); return; } catch { /* cancelled */ return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setNote("Image saved. Post it to Instagram from your phone, or add it to your story.");
  }
  async function copy(text: string, done: string) {
    try { await navigator.clipboard.writeText(text); setNote(done); } catch { setNote("Copying isn't allowed here. Select the text and copy it."); }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sheet-preview">
          <canvas ref={canvas} aria-label="Share image preview" />
          <div className="seg" role="group" aria-label="Image size">
            <button className={format === "post" ? "on" : ""} aria-pressed={format === "post"} onClick={() => setFormat("post")}>Post 1:1</button>
            <button className={format === "story" ? "on" : ""} aria-pressed={format === "story"} onClick={() => setFormat("story")}>Story 9:16</button>
          </div>
        </div>
        <div className="stack">
          <h2 id="share-title" style={{ margin: 0 }}>Share this gist</h2>
          {share ? (
            <div className="share-link">
              <input readOnly value={share.url} aria-label="Share link" onFocus={(e) => e.target.select()} />
              <button onClick={() => copy(share.url, "Link copied")}>Copy link</button>
              <button className="btn-ghost small" onClick={stopSharing}>Stop sharing</button>
            </div>
          ) : (
            <div className="share-link">
              <span className="muted small" style={{ flex: 1 }}>A share link lets anyone read this gist and shows a preview card on X, Facebook and WhatsApp.</span>
              <button className="btn-primary" disabled={busy} onClick={createLink}>{busy ? "Creating…" : "Create share link"}</button>
            </div>
          )}
          <div className="field">
            <label htmlFor="share-msg">Message</label>
            <textarea id="share-msg" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="share-grid">
            {NETWORKS.map((n) => {
              const href = links[n.key];
              return href ? (
                <a key={n.key} className="share-btn" href={href} target="_blank" rel="noopener noreferrer">{n.label}</a>
              ) : (
                <button key={n.key} className="share-btn" onClick={() => setNote(`${n.label} needs a share link. Create one first.`)}>{n.label}</button>
              );
            })}
            <button className="share-btn" onClick={shareImage}>Instagram</button>
            <button className="share-btn" onClick={shareImage}>Save image</button>
            <button className="share-btn" onClick={() => copy(share ? `${message}\n\n${share.url}` : message, "Message copied")}>Copy message</button>
            {"share" in navigator && <button className="share-btn" onClick={() => navigator.share({ title: gist.summary!.title, text: message, url: share?.url }).catch(() => {})}>More…</button>}
          </div>
          {note && <p className="muted small" role="status">{note}</p>}
        </div>
      </div>
    </div>
  );
}
