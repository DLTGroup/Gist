# Legal notes: copyright posture and platform terms

Working notes for the product, not legal advice. Prepared from the earlier project discussion and checked where possible. Items marked UNVERIFIED were not confirmed against a primary source in this session.

## 1. Design decisions already built in

| Risk | What the product does |
| --- | --- |
| Reproducing protected expression | The system prompt requires summaries in the model's own words, at most two quotations of 20 words or fewer per gist (the Full extraction template allows up to ten of 25 words or fewer, a limit chosen for fair dealing: it records far more of a source than other templates, so its quotations are capped rather than unlimited), no verbatim lyrics, scripts or jokes, and no imitation of the creator's style (`packages/core/src/prompt.ts`). |
| Substituting for the original (market harm) | Gists are short by design (≈150 / 400 / 900 words by length), always link back to the source and name the creator, and the UI tells users to check the original. |
| Storing copies of transcripts or articles | Source text is used in memory only and is **not persisted**. Only the summary and metadata (title, author, URL, length, word count) are stored. Re-running a gist re-fetches the source. |
| Attribution | Every export (Markdown, Notion, Evernote, text) ends with the source title, link and author. |
| Fabrication | The model is told to leave sections empty rather than guess. |

## 2. Canadian copyright (Ontario users; Canadian company)

- **Fair dealing.** *Copyright Act*, R.S.C. 1985, c. C-42, s. 29: "Fair dealing for the purpose of research, private study, education, parody or satire does not infringe copyright." Sections 29.1 (criticism or review) and 29.2 (news reporting) add a condition that the source and, if given in the source, the author's name be mentioned. Verified against Justice Laws: https://laws-lois.justice.gc.ca/eng/acts/C-42/page-6.html (confidence: high).
- A user summarizing a video or article for their own notes fits most naturally within **research** or **private study**. The service's own role (making the summary for the user) is the weaker point; Canadian courts have looked at the dealing from the user's perspective, but how that applies to an AI service has not been tested (confidence: moderate).
- **CCH Canadian Ltd. v. Law Society of Upper Canada**, 2004 SCC 13: sets the fairness factors (purpose, character, amount, alternatives, nature of the work, effect of the dealing) and says the allowable purposes get a large and liberal interpretation. UNVERIFIED in this session (CanLII refused automated access); pinpoints from memory are paras. 51 and 53. Check at https://www.canlii.org/en/ca/scc/doc/2004/2004scc13/2004scc13.html before relying on it.
- The earlier project chats discussed U.S. "fair use." That is U.S. doctrine and is only persuasive context in Canada; it matters if the service targets U.S. users or is hosted there.
- Copyright protects expression, not facts or ideas. Short, original, factual summaries are the lowest-risk output. This is a general principle in both countries (confidence: high).

## 3. Platform terms (the larger practical risk)

- **YouTube.** The ingestion reads the public caption track that any viewer can display. YouTube's Terms of Service restrict automated access to the service, and YouTube actively changes its internals to block it. Expect breakage and possible enforcement against the server's IP addresses. Options, in order of robustness: (a) a licensed transcript provider behind `fetchYouTube()`; (b) user-side capture (desktop/mobile reads captions on the user's device); (c) the official YouTube Data API, whose caption download only works for videos you own or have permission for (confidence: moderate; confirm current terms before launch).
- **Spotify.** Audio and feeds aren't exposed; Gist finds the same episode in public podcast directories by title, and says so when an episode is Spotify-exclusive.
- **Podcasts.** Publisher transcripts (`<podcast:transcript>`) are preferred because the publisher has chosen to make them available. Speech-to-text on audio is a fallback.
- **Paywalled articles.** The extractor only reads what the server can fetch without logging in. Don't add paywall workarounds.

## 4. Before public launch

1. IP and technology counsel review of this posture, the terms of service and the privacy policy (PIPEDA; Quebec Law 25 if serving Quebec).
2. Terms of service that make users responsible for their use and reserve the right to remove content; a notice-and-notice / takedown contact.
3. Decide the YouTube approach in section 3.
4. Encrypt stored third-party tokens (Notion) at rest; currently stored as plain text in the database.
