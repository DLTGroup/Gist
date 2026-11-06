# Roadmap after the first run

## Next (to get to a private beta)
1. **Live check on a real deployment** with an Anthropic key: YouTube captions, Apple Podcasts, Spotify, RSS and a handful of blogs. Tune the prompt on 20–30 real sources per template.
2. **Name and brand**: pick Gist or Briefly (one constant: `BRAND` in `packages/core/src/sources.ts`), check trade-marks and domains.
3. **Hosting**: one container (Dockerfile) on Fly.io, Render or a Canadian region of AWS/GCP; SQLite on a volume to start, Postgres when there's more than one server.
4. **Accounts**: passwordless sign-in is done (passkeys, Google, emailed codes; see AUTH.md). Next: native passkeys in the mobile app (associated domains), and Sign in with Apple if the iOS app ever offers Google sign-in (App Store rule for third-party logins).
5. **Durable jobs**: move the in-process queue to a jobs table + worker so a restart doesn't drop work in progress.
6. **YouTube robustness**: decide the approach in docs/LEGAL-NOTES.md §3.

## Then
- Billing (Stripe): free tier with a monthly gist allowance; paid tier with longer sources, auto-send and integrations. Show the ROI against the subscription price on the Savings page.
- More destinations: OneNote and Google Docs via OAuth (webhook covers them for now), Readwise, Apple Notes via a Shortcuts action, Logseq.
- Browser extension: "Gist this page/video" button, plus reading captions client-side.
- "Ask this gist" follow-up questions; combine several sources into one brief on a topic.
- Team spaces and shared folders.
- Weekly email: what you saved this week, plus the gists you starred.
- Mobile: offline reading cache, iOS Shortcuts and Android quick-settings tile.
