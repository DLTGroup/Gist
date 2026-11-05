# Roadmap after the first run

## Next (to get to a private beta)
1. **Live check on a real deployment** with an Anthropic key: YouTube captions, Apple Podcasts, Spotify, RSS and a handful of blogs. Tune the prompt on 20–30 real sources per template.
2. **Name and brand**: pick Gist or Briefly (one constant: `BRAND` in `packages/core/src/sources.ts`), check trade-marks and domains.
3. **Hosting**: one container (Dockerfile) on Fly.io, Render or a Canadian region of AWS/GCP; SQLite on a volume to start, Postgres when there's more than one server.
4. **Accounts**: email verification, password reset, sign in with Google/Apple (Apple sign-in is required on iOS if other social logins are offered).
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

## Memory (spaced repetition) next steps
- Push reminders when the app is closed: Web Push (VAPID keys) for the PWA and desktop, and Expo local notifications on phones. Today's reminders are the calendar feed and in-app/browser notifications while Gist is open.
- Email digest of what's due (needs an email provider account, e.g. Postmark or Resend).
- Per-person FSRS optimization: once someone has a few hundred reviews, re-fit the 21 FSRS-6 parameters to their history (`@open-spaced-repetition/binding`), and suggest a target recall from their workload.
- Card quality: let the user regenerate one card, choose Q&A vs fill-in-the-blank, and try `GIST_CARD_MODEL=claude-haiku-5-5` against Opus on 50 real takeaways before switching for cost.
- Shared decks: activity feed (who added what), comments on a card, suggested edits from viewers, and a public deck gallery.
- Typed-answer quizzes and "explain it back" questions graded by Claude.
- Anki import/export (.apkg) so people can bring decks in and take them out.
