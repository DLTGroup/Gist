import { useEffect, useMemo, useRef, useState } from "react";
import { listenMinutes, speechSegments, type Gist } from "@gist/core";

const RATES = [0.75, 1, 1.25, 1.5, 2];

/**
 * Reads a gist aloud with the browser's built-in speech, one point at a time, highlighting each point
 * (elements marked data-say="<segment key>") as it is read.
 */
export function ListenBar({ gist }: { gist: Gist }) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const segs = useMemo(() => speechSegments(gist), [gist]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(() => Number(localStorage.getItem("gist.rate")) || 1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState(() => localStorage.getItem("gist.voice") ?? "");
  const token = useRef(0);

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", load);
      token.current++;
      speechSynthesis.cancel();
      clearHighlight();
    };
  }, [supported]);

  const voice = voices.find((v) => v.name === voiceName) ?? voices.find((v) => /en-CA/i.test(v.lang)) ?? voices.find((v) => v.default) ?? voices[0];

  function clearHighlight() {
    document.querySelectorAll(".speaking").forEach((e) => e.classList.remove("speaking"));
  }
  function speakFrom(k: number, r = rate, v = voice) {
    const t = ++token.current;
    speechSynthesis.cancel();
    clearHighlight();
    if (k >= segs.length) { setI(0); setPlaying(false); return; }
    setI(k);
    setPlaying(true);
    const el = document.querySelector(`[data-say="${CSS.escape(segs[k].key)}"]`);
    el?.classList.add("speaking");
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const u = new SpeechSynthesisUtterance(segs[k].text);
    u.rate = r;
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-CA";
    u.onend = () => { if (t === token.current) speakFrom(k + 1, r, v); };
    u.onerror = (e) => { if (t === token.current && e.error !== "interrupted" && e.error !== "canceled") { setPlaying(false); clearHighlight(); } };
    speechSynthesis.speak(u);
  }
  function pause() {
    token.current++;
    speechSynthesis.cancel();
    clearHighlight();
    setPlaying(false);
  }

  if (!supported || !segs.length) return null;
  const left = Math.max(0, listenMinutes(segs.slice(i), rate));
  return (
    <div className="listen" role="group" aria-label="Listen to this gist">
      <button className="listen-skip" onClick={() => (playing ? speakFrom(Math.max(0, i - 1)) : setI(Math.max(0, i - 1)))} aria-label="Previous point">⏮</button>
      <button className="listen-play" onClick={() => (playing ? pause() : speakFrom(i))} aria-label={playing ? "Pause" : "Listen"}>{playing ? "❚❚" : "▶"}</button>
      <button className="listen-skip" onClick={() => (playing ? speakFrom(Math.min(segs.length - 1, i + 1)) : setI(Math.min(segs.length - 1, i + 1)))} aria-label="Next point">⏭</button>
      <div className="listen-meta">
        <div className="row small"><strong>{playing ? "Listening…" : i > 0 ? "Paused" : "Listen to this gist"}</strong><span className="spacer" /><span className="muted">{Math.floor(left)}:{String(Math.round((left % 1) * 60)).padStart(2, "0")} left</span></div>
        <div className="listen-track">{segs.map((s, k) => <button key={s.key} className={k < i ? "done" : k === i && playing ? "now" : ""} onClick={() => speakFrom(k)} aria-label={`Play from point ${k + 1}`} />)}</div>
      </div>
      <select aria-label="Speed" value={rate} onChange={(e) => { const r = Number(e.target.value); setRate(r); localStorage.setItem("gist.rate", String(r)); if (playing) speakFrom(i, r); }}>
        {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
      </select>
      {voices.length > 1 && (
        <select aria-label="Voice" value={voice?.name ?? ""} onChange={(e) => { setVoiceName(e.target.value); localStorage.setItem("gist.voice", e.target.value); if (playing) speakFrom(i, rate, voices.find((v) => v.name === e.target.value)); }}>
          {voices.map((v) => <option key={v.name} value={v.name}>{v.name.replace(/^(Microsoft|Google)\s+/, "")} ({v.lang})</option>)}
        </select>
      )}
    </div>
  );
}
