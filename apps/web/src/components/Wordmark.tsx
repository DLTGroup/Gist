import { BRAND } from "@gist/core";

/** "Gist" wordmark: the dot on the i is the same yellow as the app icon. */
export function Wordmark({ size = "1.15rem" }: { size?: string }) {
  if (BRAND.name !== "Gist") return <span className="wordmark" style={{ fontSize: size }}>{BRAND.name}</span>;
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="Gist">
      <span aria-hidden>G<span className="wm-i">ı<span className="wm-dot" /></span>st</span>
    </span>
  );
}
