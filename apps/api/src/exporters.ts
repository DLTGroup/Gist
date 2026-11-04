import type { ExportTarget, Gist, UserSettings } from "@gist/core";
import { obsidianUri, toMarkdown, toNotionBlocks } from "@gist/core";

export class ExportError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface SendResult {
  target: ExportTarget;
  /** Link to the created note, or a deep link the client should open (Obsidian). */
  url: string | null;
  openOnClient?: boolean;
}

export async function sendToTarget(g: Gist, target: ExportTarget, s: UserSettings): Promise<SendResult> {
  if (!g.summary) throw new ExportError("This gist isn't ready yet.");
  switch (target) {
    case "notion":
      return sendToNotion(g, s);
    case "webhook":
      return sendToWebhook(g, s);
    case "obsidian":
      if (!s.obsidianVault) throw new ExportError("Add your Obsidian vault name in Settings first.");
      return { target, url: obsidianUri(g, s.obsidianVault, s.obsidianFolder), openOnClient: true };
    default:
      throw new ExportError(`"${target}" is a download, not a send target.`);
  }
}

async function sendToNotion(g: Gist, s: UserSettings): Promise<SendResult> {
  if (!s.notionToken || !s.notionParentPageId) throw new ExportError("Connect Notion in Settings (integration token and a parent page).");
  const parentId = s.notionParentPageId.replace(/^.*?([0-9a-f]{32})(?:\?.*)?$/i, "$1");
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { authorization: `Bearer ${s.notionToken}`, "notion-version": "2022-06-28", "content-type": "application/json" },
    body: JSON.stringify({
      parent: { page_id: parentId },
      icon: { type: "emoji", emoji: "⚡" },
      properties: { title: { title: [{ type: "text", text: { content: g.summary!.title.slice(0, 2000) } }] } },
      children: toNotionBlocks(g),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ExportError(`Notion said: ${body.message ?? res.statusText}. Check that the page is shared with your integration.`, 502);
  }
  const page = (await res.json()) as { url?: string };
  return { target: "notion", url: page.url ?? null };
}

/** Generic webhook: lets people pipe gists into Zapier, Make, n8n, OneNote, Google Docs, Slack, etc. */
async function sendToWebhook(g: Gist, s: UserSettings): Promise<SendResult> {
  if (!s.webhookUrl) throw new ExportError("Add a webhook URL in Settings first.");
  const res = await fetch(s.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Gist-Webhook/1.0" },
    body: JSON.stringify({ event: "gist.ready", gist: g, markdown: toMarkdown(g, { frontMatter: false }) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new ExportError(`Your webhook returned ${res.status}.`, 502);
  return { target: "webhook", url: null };
}
