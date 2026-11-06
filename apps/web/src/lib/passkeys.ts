import { WebAuthnAbortService, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, platformAuthenticatorIsAvailable, sendSignal, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ApiError, USES_BEARER, api, type PasskeyList } from "../api.ts";

/** The desktop app loads the site from another origin, where passkeys for the website can't be used. */
export const passkeysSupported = () => !USES_BEARER && browserSupportsWebAuthn();

/** Signals are best-effort hints to the user's passkey manager; browsers without them simply ignore this. */
const signal = (opts: Parameters<typeof sendSignal>[0]) => sendSignal(opts).catch(() => {});

/** Tells the passkey manager which passkeys still work, so removed ones stop being offered. */
export function syncPasskeyManager(list: PasskeyList, email: string | null, name: string | null) {
  void signal({ signalName: "allAcceptedCredentials", rpID: list.rpId, userID: list.userHandle, allAcceptedCredentialIDs: list.passkeys.map((p) => p.id) });
  if (email) void signal({ signalName: "currentUserDetails", rpID: list.rpId, userID: list.userHandle, userName: email, userDisplayName: name ?? "" });
}

/**
 * Signs in with a passkey. With `autofill`, the browser offers saved passkeys in the email field's
 * suggestions (Conditional UI) and this resolves when the person picks one. Returns false if cancelled,
 * or "offer-local" when a phone's passkey was used (QR code) and this device could save its own.
 */
export async function signInWithPasskey(autofill = false): Promise<false | true | "offer-local"> {
  if (autofill && !(await browserSupportsWebAuthnAutofill())) return false;
  const { options, challengeId } = await api.passkeyLoginOptions();
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  } catch (e) {
    if ((e as Error).name === "NotAllowedError" || (e as Error).name === "AbortError") return false;
    throw e;
  }
  try {
    await api.passkeyLoginVerify(challengeId, response);
  } catch (e) {
    if (e instanceof ApiError && e.code === "unknown_credential" && options.rpId) {
      void signal({ signalName: "unknownCredential", rpID: options.rpId, credentialID: response.id });
    }
    throw e;
  }
  if (response.authenticatorAttachment === "cross-platform" && (await platformAuthenticatorIsAvailable().catch(() => false))) return "offer-local";
  return true;
}

/** Stops a waiting autofill request, e.g. before starting another ceremony. */
export const cancelPasskeyAutofill = () => WebAuthnAbortService.cancelCeremony();

/** Creates a passkey for the signed-in account. Returns the updated list, or null if cancelled. */
export async function createPasskey(email: string | null, name: string | null): Promise<PasskeyList | null> {
  const { options } = await api.passkeyRegisterOptions();
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e) {
    const n = (e as Error).name;
    if (n === "NotAllowedError" || n === "AbortError") return null;
    if (n === "InvalidStateError") throw new Error("This device already has a passkey for your account.");
    throw e;
  }
  const list = await api.passkeyRegisterVerify(response);
  syncPasskeyManager(list, email, name);
  return list;
}
