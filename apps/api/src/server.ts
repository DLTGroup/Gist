import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";
import { createSummarizer } from "./models/router.ts";

const port = Number(process.env.PORT ?? 8787);
const db = openDb(process.env.GIST_DB_PATH ?? "./gist.db");
const summarizer = createSummarizer();
const corsOrigins = (process.env.GIST_CORS_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean);
const app = createApp({ db, summarizer, corsOrigins });

// Serve the built web app from the same origin in production (npm run build first).
const webDist = resolve(process.env.GIST_WEB_DIST ?? "../web/dist");
if (existsSync(webDist)) {
  const indexHtml = readFileSync(resolve(webDist, "index.html"), "utf8");
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Not found" }, 404) : c.html(indexHtml)));
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`Gist API on http://localhost:${port} — summarizer: ${summarizer.model}${summarizer.model.startsWith("demo") ? " (demo mode: set GIST_MODELS and a provider API key; see docs/MODELS.md)" : ""}`);
});
