import { formatMinutes, formatMoney, type Gist } from "@gist/core";

export type CardFormat = "post" | "story";

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      if (lines.length === maxLines) break;
      line = w;
    } else line = t;
    used++;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(last + "…").width > maxW && last.includes(" ")) last = last.replace(/\s+\S+$/, "");
    lines[lines.length - 1] = last + "…";
  }
  return lines;
}

/** Draws the branded share image: 1080×1080 for posts, 1080×1920 for stories. */
export function drawShareCard(canvas: HTMLCanvasElement, g: Gist, format: CardFormat): void {
  const W = 1080;
  const H = format === "story" ? 1920 : 1080;
  const story = format === "story";
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext("2d")!;
  const INK = "#0c1514", PAPER = "#f4f6f5", TEAL = "#2dd4bf", DOT = "#fbbf24", MUTE = "#9fb0ac";
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  x.fillStyle = INK;
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W * 0.85, H * 0.05, 0, W * 0.85, H * 0.05, W * 0.9);
  glow.addColorStop(0, "rgba(45,212,191,.22)");
  glow.addColorStop(1, "rgba(45,212,191,0)");
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);

  const rr = (X: number, Y: number, w: number, h: number, r: number) => {
    x.beginPath();
    x.moveTo(X + r, Y);
    x.arcTo(X + w, Y, X + w, Y + h, r);
    x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r);
    x.arcTo(X, Y, X + w, Y, r);
    x.closePath();
  };
  const P = 110;
  let y = story ? 190 : 120;
  rr(P, y, 64, 64, 15);
  x.fillStyle = "#0f766e";
  x.fill();
  x.fillStyle = "#fff";
  for (const [a, b, w] of [[14, 20, 30], [14, 30, 36], [14, 40, 22]]) { rr(P + a, y + b, w, 5, 2.5); x.fill(); }
  x.fillStyle = DOT;
  x.beginPath(); x.arc(P + 48, y + 20, 5, 0, Math.PI * 2); x.fill();
  x.font = `800 50px ${sans}`;
  x.fillStyle = PAPER;
  x.fillText("Gıst", P + 84, y + 50);
  const gw = x.measureText("G").width, iw = x.measureText("ı").width;
  x.fillStyle = DOT;
  x.beginPath(); x.arc(P + 84 + gw + iw / 2, y + 8, 6, 0, Math.PI * 2); x.fill();
  const kind = { youtube: "VIDEO", podcast: "PODCAST", web: "ARTICLE", text: "NOTES" }[g.source.kind];
  const mins = g.source.durationSeconds ? ` · ${Math.round(g.source.durationSeconds / 60)} MIN` : "";
  x.font = `600 26px ${mono}`;
  x.fillStyle = MUTE;
  x.textAlign = "right";
  x.fillText(kind + mins, W - P, y + 42);
  x.textAlign = "left";
  y += story ? 190 : 150;

  const s = g.summary!;
  x.font = `800 ${story ? 84 : 66}px ${sans}`;
  x.fillStyle = PAPER;
  const lh = story ? 92 : 76;
  const tl = wrap(x, s.title, W - 2 * P, story ? 4 : 3);
  tl.forEach((l, k) => x.fillText(l, P, y + k * lh));
  y += tl.length * lh + 20;

  x.font = `400 ${story ? 40 : 34}px ${sans}`;
  x.fillStyle = "rgba(244,246,245,.78)";
  const dlh = story ? 56 : 48;
  const dl = wrap(x, s.tldr, W - 2 * P, story ? 5 : 3);
  dl.forEach((l, k) => x.fillText(l, P, y + k * dlh));
  y += dl.length * dlh + (story ? 70 : 44);

  x.font = `500 ${story ? 36 : 31}px ${sans}`;
  const plh = story ? 50 : 43;
  for (const it of s.sections.flatMap((sec) => sec.items).slice(0, story ? 5 : 2)) {
    if (y > H - (story ? 420 : 250)) break;
    x.fillStyle = TEAL;
    x.beginPath(); x.arc(P + 8, y - 11, 8, 0, Math.PI * 2); x.fill();
    x.fillStyle = PAPER;
    const pl = wrap(x, it.text, W - 2 * P - 44, 2);
    pl.forEach((l, k) => x.fillText(l, P + 40, y + k * plh));
    y += pl.length * plh + 22;
  }

  const by = H - (story ? 300 : 150);
  if (g.savings) {
    const sv = `Saved ${formatMinutes(g.savings.minutesSaved)} · ${formatMoney(g.savings.moneySaved, g.savings.currency)} of time`;
    x.font = `700 30px ${sans}`;
    const sw = x.measureText(sv).width + 64;
    rr(P, by - 50, sw, 68, 34);
    x.fillStyle = "rgba(251,191,36,.16)";
    x.fill();
    x.fillStyle = DOT;
    x.fillText(sv, P + 32, by - 5);
  }
  x.font = `500 24px ${mono}`;
  x.fillStyle = MUTE;
  x.fillText(wrap(x, "Source: " + (g.source.author || g.source.title), W - 2 * P, 1)[0] ?? "", P, by + 62);
  if (story) {
    x.font = `600 30px ${sans}`;
    x.fillStyle = PAPER;
    x.textAlign = "center";
    x.fillText("Get to the point. Skip the wait.", W / 2, H - 110);
    x.textAlign = "left";
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the image."))), "image/png"));
}
