import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Deck, MemoryCard } from "@gist/core";
import { formatInterval } from "@gist/core";
import { api, type DeckMember } from "../api.ts";

export function DeckView() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<{ deck: Deck; cards: MemoryCard[]; members: DeckMember[]; shareUrl: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.deck(id!).then(setData, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { deck, cards, members, shareUrl } = data;
  const canEdit = deck.role !== "viewer";
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };

  return (
    <div>
      <p className="small"><Link to="/app/memory">← Memory</Link></p>
      <div className="row">
        <h1 style={{ margin: 0 }}>{deck.name}</h1>
        <span className="spacer" />
        <button className="btn-primary" disabled={!deck.dueCount && !deck.newCount} onClick={() => nav(`/app/review?deck=${deck.id}`)}>
          Review{deck.dueCount + deck.newCount ? ` ${deck.dueCount + deck.newCount}` : ""}
        </button>
        <button disabled={cards.length < 2} onClick={() => nav(`/app/quiz?deck=${deck.id}`)}>Quiz</button>
      </div>
      {deck.description && <p className="muted">{deck.description}</p>}
      <p className="muted small">
        {deck.cardCount} cards · {deck.dueCount} due · {deck.newCount} new
        {deck.role !== "owner" && <> · shared by {deck.ownerName} · you're a{deck.role === "editor" ? "n editor" : " viewer"}</>}
      </p>

      <section className="section">
        <h2>Share and study together</h2>
        <div className="card stack">
          <p className="small" style={{ margin: 0 }}>
            Everyone in a deck studies the same cards on their own schedule. Viewers study; editors can also add and fix cards.
          </p>
          {canEdit &&
            (shareUrl ? (
              <div className="row">
                <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 220 }} />
                <button onClick={() => navigator.clipboard.writeText(shareUrl).then(() => flash("Link copied"))}>Copy link</button>
                {deck.role === "owner" && <button className="btn-ghost btn-danger" onClick={async () => { await api.unshareDeck(deck.id); load(); }}>Stop sharing</button>}
              </div>
            ) : (
              <button onClick={async () => { await api.shareDeck(deck.id); load(); }}>Make a share link</button>
            ))}
          <ul className="members">
            {members.map((m) => (
              <li key={m.id} className="row">
                <strong>{m.name}{m.you && " (you)"}</strong>
                <span className="muted small">{m.role} · added {m.cardsAdded} card{m.cardsAdded === 1 ? "" : "s"}</span>
                <span className="spacer" />
                {deck.role === "owner" && m.role !== "owner" && (
                  <>
                    <select style={{ width: "auto" }} value={m.role} onChange={async (e) => { await api.setMemberRole(deck.id, m.id, e.target.value as "editor" | "viewer"); load(); }}>
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button className="btn-ghost btn-danger small" onClick={async () => { await api.removeMember(deck.id, m.id); load(); }}>Remove</button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {msg && <span className="pill">{msg}</span>}
        </div>
      </section>

      {canEdit && (
        <section className="section">
          <h2>Add a card</h2>
          <form
            className="card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.addCard(deck.id, front, back);
                setFront("");
                setBack("");
                load();
              } catch (err) {
                flash((err as Error).message);
              }
            }}
          >
            <textarea rows={2} placeholder="Question (or a sentence with [...] for the blank)" value={front} onChange={(e) => setFront(e.target.value)} />
            <textarea rows={2} placeholder="Answer" value={back} onChange={(e) => setBack(e.target.value)} />
            <div><button className="btn-primary" type="submit" disabled={!front.trim() || !back.trim()}>Add card</button></div>
          </form>
        </section>
      )}

      <section className="section">
        <h2>Cards</h2>
        {cards.length === 0 && <p className="muted">No cards yet. Star takeaways in any gist and pick this deck.</p>}
        <div className="list">
          {cards.map((c) => <CardRow key={c.id} card={c} canEdit={canEdit} onChange={load} />)}
        </div>
      </section>

      <p style={{ marginTop: "2rem" }}>
        <button
          className="btn-ghost btn-danger small"
          onClick={async () => {
            if (!window.confirm(deck.role === "owner" ? "Delete this deck and its cards for everyone in it?" : "Leave this deck? Your progress on it will be removed.")) return;
            await api.deleteDeck(deck.id);
            nav("/app/memory");
          }}
        >
          {deck.role === "owner" ? "Delete deck" : "Leave deck"}
        </button>
      </p>
    </div>
  );
}

function CardRow({ card, canEdit, onChange }: { card: MemoryCard; canEdit: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const m = card.memory;
  const due = new Date(m.due).getTime() - Date.now();
  const when = m.state === "new" ? "new" : due <= 0 ? "due now" : `due in ${formatInterval(due)}`;

  if (editing)
    return (
      <div className="card stack">
        <textarea rows={2} value={front} onChange={(e) => setFront(e.target.value)} aria-label="Question" />
        <textarea rows={2} value={back} onChange={(e) => setBack(e.target.value)} aria-label="Answer" />
        <div className="row">
          <button className="btn-primary" onClick={async () => { await api.updateCard(card.id, { front, back }); setEditing(false); onChange(); }}>Save</button>
          <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          <span className="spacer" />
          <button className="btn-ghost btn-danger small" onClick={async () => { await api.deleteCard(card.id); onChange(); }}>Delete card</button>
        </div>
      </div>
    );

  return (
    <div className={`card card-row${card.suspended ? " suspended" : ""}`}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div>{card.front}</div>
        <div className="muted">{card.back}</div>
        <div className="muted small">
          {card.suspended ? "paused" : when}
          {m.reps > 0 && <> · reviewed {m.reps}×</>}
          {m.lapses > 0 && <> · forgot {m.lapses}×</>}
          {card.source?.gistId && <> · <Link to={`/app/g/${card.source.gistId}`}>{card.source.gistTitle}</Link></>}
        </div>
      </div>
      <div className="row">
        <button className="btn-ghost small" onClick={async () => { await api.updateCard(card.id, { suspended: !card.suspended }); onChange(); }}>{card.suspended ? "Resume" : "Pause"}</button>
        {canEdit && <button className="btn-ghost small" onClick={() => setEditing(true)}>Edit</button>}
      </div>
    </div>
  );
}

/** Opened from a shared deck link: shows the deck and adds it to your Memory. */
export function JoinDeck() {
  const { token } = useParams();
  const nav = useNavigate();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.deckInvite>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.deckInvite(token!).then(setInfo, (e) => setError(e.message));
  }, [token]);
  if (error) return <p className="error">{error}</p>;
  if (!info) return <p className="muted">Loading…</p>;
  return (
    <div className="card review-done">
      <p className="muted small">Shared deck{info.deck.ownerName ? ` from ${info.deck.ownerName}` : ""}</p>
      <h1>{info.deck.name}</h1>
      {info.deck.description && <p>{info.deck.description}</p>}
      <p className="muted">{info.deck.cardCount} cards. You'll study them on your own schedule; nothing you do changes anyone else's.</p>
      {info.member ? (
        <Link className="btn btn-primary" to={`/app/memory/decks/${info.deck.id}`}>Open deck</Link>
      ) : (
        <button className="btn-primary" onClick={async () => { const r = await api.joinDeck(token!); nav(`/app/memory/decks/${r.deck.id}`); }}>Add to my Memory</button>
      )}
    </div>
  );
}
