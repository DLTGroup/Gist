import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class IngestError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  );
}

/** Rejects URLs that point at the server's own network (SSRF guard). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new IngestError("That doesn't look like a valid link.");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new IngestError("Only http and https links are supported.");
  if (process.env.GIST_ALLOW_PRIVATE_URLS === "1") return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new IngestError(`Couldn't reach ${u.hostname}.`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new IngestError("That address isn't publicly reachable.");
  return u;
}

export async function fetchWithLimits(
  url: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Response & { bodyText: () => Promise<string> }> {
  await assertPublicUrl(url);
  const { timeoutMs = 20_000, maxBytes = 15_000_000, ...rest } = init;
  const res = await fetch(url, {
    redirect: "follow",
    ...rest,
    headers: { "user-agent": BROWSER_UA, "accept-language": "en-CA,en;q=0.9", ...(rest.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e: Error) => {
    throw new IngestError(`Couldn't fetch the link (${e.name === "TimeoutError" ? "timed out" : e.message}).`, 502);
  });
  const bodyText = async () => {
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new IngestError("That page is too large to process.", 413);
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  };
  return Object.assign(res, { bodyText });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
