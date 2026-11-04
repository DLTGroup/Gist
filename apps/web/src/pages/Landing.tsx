import { useState } from "react";
import { Link } from "react-router-dom";
import { BRAND, formatMinutes, formatMoney } from "@gist/core";
import { useSession } from "../main.tsx";
import { Wordmark } from "../components/Wordmark.tsx";

/** Marketing page with a live savings calculator: the core pitch is time, money and effort saved. */
export function Landing() {
  const { user } = useSession();
  const [perWeek, setPerWeek] = useState(6);
  const [avgMin, setAvgMin] = useState(35);
  const [rate, setRate] = useState(40);

  // Same model the app uses: watch/read time plus ~35% for manual notes, minus ~2 minutes to read a gist.
  const weeklyMin = perWeek * Math.max(0, avgMin * 1.35 - 2);
  const yearlyHours = (weeklyMin * 48) / 60;
  const yearlyMoney = yearlyHours * rate;

  return (
    <div className="landing">
      <header>
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} /> <Wordmark />
        </div>
        <div className="row">
          {user ? (
            <Link className="btn btn-primary" to="/app/new">Open {BRAND.name}</Link>
          ) : (
            <>
              <Link className="btn btn-ghost" to="/signin">Sign in</Link>
              <Link className="btn btn-primary" to="/signup">Start free</Link>
            </>
          )}
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="pill pill-accent">YouTube · Podcasts · Articles</span>
          <h1 style={{ marginTop: "0.8rem" }}>Get the point.<br />Skip the hour.</h1>
          <p className="lead">
            Paste a link to a video, podcast or blog post. {BRAND.name} pulls out exactly what you asked for, in the format you want, files it, and
            sends it to your notes app. Then it shows you the time and money you just saved.
          </p>
          <div className="row" style={{ marginTop: "1.2rem" }}>
            <Link className="btn btn-primary" to={user ? "/app/new" : "/signup"}>Make your first gist</Link>
            <span className="muted small">Web, desktop, Android and iOS</span>
          </div>
        </div>
        <div className="card calc">
          <h2>What would you save?</h2>
          <div className="field">
            <label>Videos, episodes or long reads per week: {perWeek}</label>
            <input type="range" min={1} max={30} value={perWeek} onChange={(e) => setPerWeek(+e.target.value)} />
          </div>
          <div className="field">
            <label>Average length: {avgMin} min</label>
            <input type="range" min={5} max={180} step={5} value={avgMin} onChange={(e) => setAvgMin(+e.target.value)} />
          </div>
          <div className="field">
            <label>What an hour of your time is worth: {formatMoney(rate)}</label>
            <input type="range" min={15} max={300} step={5} value={rate} onChange={(e) => setRate(+e.target.value)} />
          </div>
          <div className="result">
            <div className="stat card" style={{ background: "var(--save-soft)", color: "var(--save)", boxShadow: "none" }}>
              <span className="v">{formatMinutes(weeklyMin)}</span>
              <span className="l">back each week</span>
            </div>
            <div className="stat card" style={{ background: "var(--save-soft)", color: "var(--save)", boxShadow: "none" }}>
              <span className="v">{Math.round(yearlyHours)} h</span>
              <span className="l">per year</span>
            </div>
            <div className="stat card" style={{ background: "var(--save-soft)", color: "var(--save)", boxShadow: "none" }}>
              <span className="v">{formatMoney(yearlyMoney)}</span>
              <span className="l">of your time, yearly</span>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: "0.8rem" }}>
            Estimate: full-length viewing plus note-taking time, minus about two minutes to read each gist, over 48 weeks.
          </p>
        </div>
      </section>

      <section className="features">
        <div className="card">
          <h3>⚡ Paste, pick, done</h3>
          <p className="muted">Drop in a YouTube, Apple Podcasts, Spotify, RSS or article link. Share straight from your phone's share sheet.</p>
        </div>
        <div className="card">
          <h3>🎯 Only what you want</h3>
          <p className="muted">Choose a template (action items, study notes, recipe, decision brief) or build your own, and tell it what you're looking for.</p>
        </div>
        <div className="card">
          <h3>🗂 Organized and sent</h3>
          <p className="muted">Folders, tags and search. One click to Notion, Obsidian, Evernote, Markdown, or anything via webhook.</p>
        </div>
      </section>

      <p className="muted small">
        {BRAND.name} writes original summaries in its own words with links back to the creator. It doesn't republish transcripts or articles.
      </p>
    </div>
  );
}
