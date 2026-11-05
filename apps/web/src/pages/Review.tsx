import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ReviewRating } from "@gist/core";
import { RATING_LABELS } from "@gist/core";
import { api, type QueueCard } from "../api.ts";

/** A review session: question, reveal, then Again / Hard / Good / Easy (keys 1–4, space to reveal). */
export function ReviewPage() {
  const [params] = useSearchParams();
  const deck = params.get("deck") ?? undefined;
  const gist = params.get("gist") ?? undefined;
  const [queue, setQueue] = useState<QueueCard[] | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [again, setAgain] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(Date.now());

  const load = useCallback(() => {
    api.reviewQueue({ deck, gist }).then((r) => setQueue(r.cards), (e) => setError(e.message));
  }, [deck, gist]);
  useEffect(load, [load]);

  const card = queue?.[0];
  useEffect(() => {
    started.current = Date.now();
    setShown(false);
  }, [card?.id, done]);

  const answer = useCallback(
    async (rating: ReviewRating) => {
      if (!card) return;
      const ms = Date.now() - started.current;
      try {
        const r = await api.review(card.id, rating, ms);
        setDone((n) => n + 1);
        if (rating === 1) setAgain((n) => n + 1);
        // A card still in (re)learning comes back in this session once its short step has passed.
        const rest = queue!.slice(1);
        const soon = new Date(r.card.memory.due).getTime() - Date.now() < 20 * 60_000;
        if (soon) {
          const fresh = await api.reviewQueue({ deck, gist });
          const back = fresh.cards.find((c) => c.id === card.id);
          setQueue(back ? [...rest, back] : rest);
        } else setQueue(rest);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [card, queue, deck, gist],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!shown && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) answer(Number(e.key) as ReviewRating);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, answer]);

  if (error) return <p className="error">{error}</p>;
  if (!queue) return <p className="muted">Loading…</p>;

  if (!card)
    return (
      <div className="review-done card">
        <h1>{done ? "Done for now" : "Nothing to review"}</h1>
        <p className="muted">
          {done
            ? `You reviewed ${done} card${done === 1 ? "" : "s"}${again ? `, and ${again} will come back sooner` : ""}. Gist will bring each one back just before you'd forget it.`
            : "No cards are due. Star takeaways in a gist to add more, or take a quiz for practice."}
        </p>
        <div className="row">
          <Link className="btn btn-primary" to="/app/memory">Back to Memory</Link>
          <Link className="btn" to={`/app/quiz${deck ? `?deck=${deck}` : gist ? `?gist=${gist}` : ""}`}>Quiz me anyway</Link>
        </div>
      </div>
    );

  return (
    <div className="review">
      <div className="row small muted">
        <span>{queue.length} left</span>
        <span>· {done} done</span>
        <span className="spacer" />
        <span className="pill">{card.memory.state === "new" ? "New" : card.memory.state === "review" ? "Review" : "Relearning"}</span>
      </div>
      <div className="flashcard card" aria-live="polite">
        <p className="flash-front">{card.front}</p>
        {shown ? (
          <>
            <hr />
            <p className="flash-back">{card.back}</p>
            {card.source && (
              <p className="muted small">
                From <Link to={`/app/g/${card.source.gistId}`}>{card.source.gistTitle}</Link>
                {card.source.url && (
                  <>
                    {" · "}
                    <a href={card.source.url} target="_blank" rel="noreferrer">open the moment ↗</a>
                  </>
                )}
                <br />
                <span>“{card.source.text}”</span>
              </p>
            )}
          </>
        ) : (
          <button className="btn-primary reveal" onClick={() => setShown(true)}>Show answer <span className="muted small">(space)</span></button>
        )}
      </div>
      {shown && (
        <div className="rate-row" role="group" aria-label="How well did you remember?">
          {([1, 2, 3, 4] as ReviewRating[]).map((r) => (
            <button key={r} className={`rate rate-${r}`} onClick={() => answer(r)}>
              <strong>{RATING_LABELS[r]}</strong>
              <span className="small">{card.intervals[r].label}</span>
              <kbd className="small muted">{r}</kbd>
            </button>
          ))}
        </div>
      )}
      {shown && <p className="hint">Again if you didn't remember it; Hard if it took real effort; Good if you got it; Easy if it was instant.</p>}
    </div>
  );
}
