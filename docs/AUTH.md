# Accounts and sign-in

Gist has no passwords. People sign in three ways:

| Method | When it's used | How it works |
| :--- | :--- | :--- |
| **Passkey** | The main way back in | WebAuthn discoverable credential, `userVerification: "required"` (Face ID, fingerprint or device PIN). Offered in the email field's autofill (Conditional UI) and by a "Sign in with a passkey" button. |
| **Continue with Google** | One-tap sign-up or sign-in | OpenID Connect authorization code flow with PKCE (S256), `state` and `nonce`. The ID token is verified against Google's published keys, and only a verified Google email is accepted. |
| **Emailed code** | Sign-up by email, and recovery | A 6-digit, single-use code valid for 5 minutes, bound to the browser that asked for it. After sign-up, the person is offered a passkey. |

No password, password hash or other shared secret is stored. Sessions are random tokens. Only their SHA-256 hash is kept, and the website receives the token as an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when the site is served over https).

## Trying Gist before signing up

Someone who opens `/app/new` without an account gets a guest session automatically. A guest can:

- make their first gist (`GIST_GUEST_GISTS`, default 1; a failed gist doesn't count);
- read it;
- share it: share links and share pages need no account.

Everything else asks them to create a free account, and the server enforces it with `403 { code: "login_required" }`. That covers sending to Notion, Obsidian or a webhook, downloading, imports, connected accounts, settings, custom templates, editing and re-running. The allowlist is in `apps/api/src/app.ts` (`GUEST_ALLOWED`), and anything not on it is refused.

When the guest signs up or signs in (by any method), their gists, folders and share links move to the account and the guest record is deleted. Guests who never sign up are removed after 30 days, with their gists and share links.

## Recovery (lost device)

An emailed code for an account that already has passkeys counts as recovery:

1. The code must be entered in the browser that asked for it. The website is bound by an `HttpOnly` cookie, so a code typed into another browser is rejected.
2. On the website, a correct code opens a **5-minute session that can only add a passkey**. Every other request answers `403 { code: "passkey_required" }`, and the app sends the person to the "Add a passkey on this device" screen. Adding the passkey turns it into a normal session.
3. A security alert is emailed straight away.
4. For 24 hours, existing passkeys can't be removed (`403 { code: "recovery_cooldown" }`). That stops someone who got into the person's email from locking them out.

## Passkey details

- **Registration options:** `pubKeyCredParams` −8 (Ed25519), −7 (ES256), −257 (RS256); `residentKey: "required"`; `userVerification: "required"`; `attestation: "none"`; `credProps`; 60-second challenge; `excludeCredentials` lists the account's existing passkeys. `authenticatorAttachment` is left unset, so phones (QR code), security keys and built-in authenticators all work.
- **WebAuthn user handle:** 32 random bytes, kept apart from the email (`users.webauthn_user_handle`).
- **Stored per credential (`credentials` table):** credential id, COSE public key, AAGUID, sign count, backup eligible (BE), backup state (BS), transports, friendly name, created and last-used times. The friendly name comes from known AAGUIDs (iCloud Keychain, Google Password Manager, 1Password, Bitwarden, Windows Hello), and people can rename it.
- **Sign-in:** user verification is required, the sign count and backup state are updated, and challenges are single-use. Login challenges last 5 minutes, because Conditional UI asks for one when the page loads.
- **Signal API** (browsers that support it; others ignore it):
  - `signalUnknownCredential` when the server doesn't recognise a passkey;
  - `signalAllAcceptedCredentials` and `signalCurrentUserDetails` whenever Settings shows the passkey list, and after adding or removing one.
- **Backup readiness:** if the only passkey is device-bound (BE false), Settings asks the person to add a second one.
- **Phone sign-in:** after signing in with a phone's passkey on a computer that has its own authenticator, the person is offered a passkey on that computer.

## Setup

| Setting | Purpose |
| :--- | :--- |
| `GIST_PUBLIC_URL` | **Required in production.** The site's address, e.g. `https://gist.example.ca`. Passkeys are bound to its domain. |
| `GIST_RP_ID` | Optional: passkey domain if it should be a parent of the site's host, e.g. `example.ca` for `app.example.ca`. |
| `RESEND_API_KEY`, `GIST_EMAIL_FROM` | Sends codes through [Resend](https://resend.com). `GIST_EMAIL_FROM` must use a domain verified in Resend. Without them, development prints codes to the server log and production turns email sign-in off. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Console › APIs & Services › Credentials › OAuth client (Web application). Add the redirect URI `<GIST_PUBLIC_URL>/api/auth/google/callback`. The same client serves YouTube import (see CONNECTED_ACCOUNTS.md). |
| `GIST_TOKEN_KEY` | Signs email codes and encrypts connected-account tokens. Render generates it. |
| `GIST_GUEST_GISTS` | Gists allowed before sign-up (default 1). |
| `GIST_BUSINESS_NAME`, `GIST_MAILING_ADDRESS`, `GIST_CONTACT_EMAIL` | The details Canada's anti-spam law requires in a request for consent to marketing email (SOR/2012-36, s. 4). The optional, unticked box on sign-up and in Settings appears only once all three are set. |
| `GIST_ADMIN_EMAILS` | Comma-separated emails of people who can download the mailing list as a CSV from Settings. |

## Marketing email consent

- **The box.** Sign-up offers one separate, unticked box for news, tips and offers. It names who is asking, gives the mailing address and contact, and says consent can be withdrawn. Signing in never depends on it. (CRTC 2012-549, paras 5-6; CRTC 2012-548, paras 16 and 18; SOR/2012-36, s. 4.)
- **The record.** Every grant and withdrawal goes into `consent_log`, with the date and time, the exact wording shown, how it was given (email sign-up, Google sign-up, sign-in, Settings or the unsubscribe link), the IP address and the browser. The sender has to prove consent (CRTC 2012-548, paras 26-27).
- **Confirmation and unsubscribing.** A confirmation email with a personal unsubscribe link (`/u/<token>`) is sent once consent is given. The link opens a page with an Unsubscribe button, so mail scanners can't unsubscribe people by opening it. A POST to the link also works as one-click unsubscribe. People can switch it off in Settings too.
- **Signing in again** without ticking the box never withdraws consent that was given earlier.
- **The CSV** lists only people who currently agree: email, name, when and how they agreed, when they signed up, and their unsubscribe link. Cells that a spreadsheet would run as formulas are escaped.
- **Sending.** Gist doesn't send marketing email itself. If you import the CSV into an email service, keep the two lists in step: honour unsubscribes from either side within 10 business days, and include the sender details and an unsubscribe link in every message.

Cross-site request forgery: the website's session is a cookie, so every request that changes something must also carry the `x-gist-client` header, which another site can't add without CORS approval. Native apps send a bearer token instead.

## Where this differs from the passkey specification

These are deliberate, and can change:

1. **Google sign-in is offered to everyone.** The specification describes OIDC for enterprise tenants with RFC 9470 phishing-resistant claims. Gist sells to individuals only, so Google is plain consumer OIDC. Google decides how its users sign in (it may use a password), so an account created with Google is only as strong as the person's Google sign-in.
2. **The emailed code also handles ordinary sign-up**, not just recovery. A new account starts with a verified email and is then offered a passkey. "Not now" is allowed, and that person signs in with codes or Google until they add one.
3. **The mobile app signs in with emailed codes and doesn't have passkeys yet.** Native passkeys need the app linked to the website's domain (Apple associated domains, Android Digital Asset Links). Until then, recovery from the mobile app gives a normal session, still with the email alert and the 24-hour pause, instead of the add-a-passkey-only session. The desktop app uses emailed codes for the same reason.
4. **The 24-hour pause covers removing passkeys.** The specification also lists changing email and exporting sensitive data. Gist has no email change yet, and exports are the person's own gists.
5. **No Redis.** Challenges, codes and sign-in states live in SQLite tables with expiry times, which suits a single server.
6. **Account status** (`active`, `suspended`, `recovery_locked`) exists in the schema. There is no admin screen for it yet.
