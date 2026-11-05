# Gist (working name; alternate: Briefly)

**Get to the point. Skip the wait.** Paste or share a YouTube video, podcast episode or article. Gist pulls out exactly what you asked for, in the format you choose, files it, sends it to your notes app, and shows the time, money and effort you saved.

This is the first end-to-end build: one backend, a web app, a desktop app (macOS, Windows, Linux) and a mobile app (Android, iOS).

## What it does

| Area | What's built |
| --- | --- |
| **Ingestion** | YouTube (public captions, with timestamps); podcasts via Apple Podcasts, Spotify episode links, RSS feeds, show pages or audio files (publisher transcripts first, speech-to-text fallback via Deepgram); articles and blogs (Readability extraction); pasted text. |
| **Bulk import** | Paste a YouTube playlist, a Spotify playlist or show, an Apple Podcasts show, an RSS feed, or a list of links: each item gets its own gist (up to 50 per import) in a new folder named after the playlist, with live progress, combined savings, retry for failures, and one-file Markdown or Evernote export. Music tracks in Spotify playlists are skipped; podcast episodes are summarized. |
| **Summarization** | Hot-swappable and server-side only: `GIST_MODELS` lists provider/model entries in order (Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, Together or any OpenAI-compatible endpoint), with automatic fallback. `npm run compare-models -w @gist/api` compares candidates on speed, tokens and cost. See docs/MODELS.md. A demo extractor runs when no API key is set so everything works locally. |
| **Tailoring** | 8 built-in templates (Quick gist, Takeaways and action items, Study notes, How-to steps, Podcast highlights, Research brief, Decision brief, Recipe card), a template builder (sections, format, length, tone, audience, timestamps), and a per-gist "What are you looking for?" focus. Re-run any gist with another template or focus. |
| **Savings** | Per-gist and cumulative time saved, value of that time, words avoided and % less effort, by week and source type. Assumptions (hourly value, playback speed, reading speed, note-taking overhead) are shown and editable. Landing page has a live savings calculator. |
| **Organization** | Folders, tags (auto-suggested, editable), favourites, full-text search (SQLite FTS5), filters by type. |
| **Exports** | Notion (API), Obsidian (deep link into the vault), Evernote (.enex), Markdown with front matter (Obsidian/Logseq), plain text, JSON, webhook (Zapier/Make/n8n → OneNote, Google Docs, Slack…), the system share sheet (Apple Notes, Keep, OneNote apps), and auto-send of every new gist. |
| **Capture** | Web: installable PWA with a share target. Desktop: Ctrl/⌘+Shift+G gists the link on your clipboard, tray menu, `gist://new?url=…` links. Mobile: share a link to Gist from YouTube, Podcasts, Spotify or a browser. |

## Layout

```
packages/core     Shared TypeScript: types, templates, prompt + JSON schema, savings maths, Markdown/ENEX/Notion renderers
apps/api          Hono + Node 22 (built-in SQLite). Auth, ingestion, Claude, library, exports. Also serves the built web app.
apps/web          React + Vite web app (responsive; PWA)
apps/desktop      Electron shell around the web app with OS-level capture
apps/mobile       Expo (React Native) app for Android and iOS
docs/             LEGAL-NOTES.md, ROADMAP.md
```

## Run it locally

Requires Node 22.5 or later.

```bash
npm install
cp .env.example .env          # set GIST_MODELS and that provider's key; leave blank for demo mode
npm run dev                   # API on :8787, web on http://localhost:5173
npm test                      # unit + API end-to-end tests
```

Production-style single server: `npm run build && npm start`, then open http://localhost:8787. Or `docker build -t gist . && docker run -p 8787:8787 -v gist-data:/data -e ANTHROPIC_API_KEY=… gist`.

**Desktop:** `npm run dev:desktop` (set `GIST_APP_URL` to your deployed URL; defaults to http://localhost:8787). Installers: `npm run dist -w @gist/desktop`.

**Mobile:** `cd apps/mobile && npm install`, set `EXPO_PUBLIC_API_URL` to a URL the phone can reach, then `npx expo run:android` or `npx expo run:ios`. Share-sheet capture uses a native extension, so it needs a development build (not Expo Go). Store builds: `eas build`.

## Deploying the live site

- **Render** (simplest): push this repo to GitHub, then in Render choose New › Blueprint and pick the repo. `render.yaml` sets up the Docker service, a 1 GB disk for the database and the health check; Render asks for `ANTHROPIC_API_KEY` (and optionally `DEEPGRAM_API_KEY`).
- **Fly.io, Toronto region** (keeps data in Canada): see the comments at the top of `fly.toml`.
- Any Docker host works: `docker build -t gist .` and mount a volume at `/data`.

The production build serves the web app and API from one origin, with security headers, sign-in rate limiting and request size limits.

## Configuration

See `.env.example`. Key settings: `ANTHROPIC_API_KEY`, `GIST_MODEL` (default `claude-opus-5-5`), `GIST_EFFORT` (default `medium`), `DEEPGRAM_API_KEY` (podcast audio without a published transcript), `GIST_DB_PATH`, `GIST_CORS_ORIGINS`.

## How savings are estimated

`time saved = original length ÷ playback speed (or words ÷ 238 wpm) × 1.35 for note-taking − time to read the gist`. Money saved is time saved × the user's hourly value (default $35 CAD). Effort reduction is 1 − gist words ÷ source words. All inputs are user-adjustable and shown on the Savings page, so the numbers read as transparent estimates rather than claims.

## Status of this first run

Tested here: 25 automated tests (including playlist, Spotify and feed parsing and the bulk-import API) (parsers for YouTube captions, VTT/SRT/JSON transcripts, RSS feeds and articles; the full API flow from sign-up through gist, organize, search, export, templates, savings and user isolation), plus a browser walkthrough of the web app at desktop and phone widths against a real article page. The mobile app type-checks and its Android bundle builds; the desktop app passes a syntax check.

Not yet tested live: YouTube, Apple Podcasts, Spotify and other external sites were blocked by the build environment's network policy, and no Anthropic or Deepgram key was available, so live ingestion and Claude output need a first check on a real deployment. See docs/ROADMAP.md for what's next.
