import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { QuizQuestion } from "@gist/core";
import { api } from "../api.ts";

/**
 * Multiple-choice quiz over a deck, a gist or all cards. It's practice: it only moves a card's
 * schedule when that card was already due, in which case the answer counts as its review.
 */
export function QuizPage() {
  const [params] = useSearchParams();
  const deck = params.get("deck") ?? undefined;
  const gist = params.get("gist") ?? undefined;
  const [qs, setQs] = useState<QuizQuestion[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [missed, setMissed] = useState<QuizQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setI(0);
    setPicked(null);
    setScore(0);
    setMissed([]);
    setQs(null);
    api.quiz({ deck, gist, count: 10 }).then((r) => setQs(r.questions), (e) => setError(e.message));
  };
  useEffect(start, [deck, gist]);

  if (error)
    return (
      <div className="card">
        <p className="error">{error}</p>
        <Link to="/app/memory">Back to Memory</Link>
      </div>
    );
  if (!qs) return <p className="muted">Loading…</p>;

  if (i >= qs.length)
    return (
      <div className="card review-done">
        <h1>
          {score} of {qs.length}
        </h1>
        <p className="muted">{score === qs.length ? "Every one. Nicely done." : "Here's what to look at again:"}</p>
        {missed.length > 0 && (
          <ul>
            {missed.map((q) => (
              <li key={q.cardId}>
                {q.prompt} <strong>{q.choices[q.answerIndex]}</strong>
                {q.source?.gistId && <> · <Link to={`/app/g/${q.source.gistId}`}>source</Link></>}
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="btn-primary" onClick={start}>Another round</button>
          <Link className="btn" to="/app/memory">Back to Memory</Link>
        </div>
      </div>
    );

  const q = qs[i];
  const choose = async (k: number) => {
    if (picked != null) return;
    setPicked(k);
    const right = k === q.answerIndex;
    if (right) setScore((s) => s + 1);
    else setMissed((m) => [...m, q]);
    api.answerQuiz(q.cardId, right).catch(() => {});
  };

  return (
    <div className="review">
      <div className="row small muted">
        <span>Question {i + 1} of {qs.length}</span>
        <span className="spacer" />
        <span>{score} right</span>
      </div>
      <div className="flashcard card">
        <p className="flash-front">{q.prompt}</p>
        <div className="choices">
          {q.choices.map((c, k) => (
            <button
              key={k}
              className={picked == null ? "" : k === q.answerIndex ? "choice-right" : k === picked ? "choice-wrong" : ""}
              onClick={() => choose(k)}
              disabled={picked != null && k !== picked && k !== q.answerIndex}
            >
              {c}
            </button>
          ))}
        </div>
        {picked != null && (
          <div className="row" style={{ marginTop: "1rem" }}>
            <span className={picked === q.answerIndex ? "pill pill-accent" : "pill pill-save"}>{picked === q.answerIndex ? "Right" : "Not quite"}</span>
            {q.source?.url && <a className="small" href={q.source.url} target="_blank" rel="noreferrer">open the moment ↗</a>}
            <span className="spacer" />
            <button className="btn-primary" autoFocus onClick={() => { setI(i + 1); setPicked(null); }}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
