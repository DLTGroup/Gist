# Connected accounts (YouTube and Spotify)

Users can connect YouTube or Spotify in **Settings → Connected accounts**, then pick a saved list on the **New** page. Each item becomes its own gist through the normal bulk import (50-item cap, one folder per import, music skipped).

Gist asks only for read-only access. Tokens are encrypted at rest (AES-256-GCM, key from `GIST_TOKEN_KEY`). Disconnecting deletes them, and for Google it also revokes the grant.

## What each platform allows (checked 5 November 2026)

| | YouTube (Google) | Spotify |
|---|---|---|
| Scope | `youtube.readonly` | `user-library-read playlist-read-private playlist-read-collaborative` |
| Readable | Playlists the user made or saved; Liked videos | Saved episodes; playlists the user owns or collaborates on |
| Not readable | Watch Later and watch history (removed from the API in 2016) | Other people's playlists (Spotify returns 403 since February 2026) |
| Before launch | Google OAuth app verification; unverified apps get an "unverified app" screen and a 100-new-user cap | **Development mode allows only 5 allowlisted users, and the app owner needs Premium.** Extended access is only granted to registered businesses with at least 250,000 monthly active users. |

Sources: [YouTube Data API revision history](https://developers.google.com/youtube/v3/revision_history), [Google unverified apps](https://support.google.com/cloud/answer/7454865), [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), [Spotify February 2026 changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026).

Whether `youtube.readonly` counts as a "sensitive" or "restricted" scope for Google's review was not confirmed. Check the scope list in Google Cloud Console when you submit for verification.

## Setup

1. **Google:** in Google Cloud Console, create a project, enable *YouTube Data API v3*, configure the OAuth consent screen and create a *Web application* OAuth client. Add the redirect URI `https://<your host>/api/connections/youtube/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
2. **Spotify:** at developer.spotify.com, create an app with the redirect URI `https://<your host>/api/connections/spotify/callback`. Add each tester's Spotify email under *User Management* (5 maximum). Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
3. Set `GIST_PUBLIC_URL` to the public address, and `GIST_TOKEN_KEY` to 32 or more random characters. Render generates the key automatically from render.yaml.

Until a provider's keys are set, its row in Settings says "Not set up on this server yet" and the New page doesn't offer it.
