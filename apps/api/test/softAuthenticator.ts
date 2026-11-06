import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

/** A minimal software passkey (ES256, "none" attestation) for exercising the real WebAuthn verification. */
export class SoftAuthenticator {
  private key: KeyObject;
  readonly credentialId = randomBytes(16);
  private count = 0;
  userHandle: string | null = null;
  constructor(private rpId: string, private origin: string, private flags = { backupEligible: true, backedUp: true }) {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.key = privateKey;
  }
  get id() {
    return this.credentialId.toString("base64url");
  }
  private authData(withCredential: boolean) {
    const rpHash = createHash("sha256").update(this.rpId).digest();
    let f = 0x01 | 0x04; // user present, user verified
    if (this.flags.backupEligible) f |= 0x08;
    if (this.flags.backedUp) f |= 0x10;
    if (withCredential) f |= 0x40;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.count);
    const parts = [rpHash, Buffer.from([f]), counter];
    if (withCredential) {
      const jwk = this.key.export({ format: "jwk" });
      const cose = new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]);
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, Buffer.from(isoCBOR.encode(cose)));
    }
    return Buffer.concat(parts);
  }
  private clientData(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }
  /** Answers navigator.credentials.create(). */
  register(options: { challenge: string; user: { id: string } }) {
    this.userHandle = options.user.id;
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", this.authData(true)]]) as never);
    return {
      id: this.id, rawId: this.id, type: "public-key" as const, clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: this.clientData("webauthn.create", options.challenge).toString("base64url"), attestationObject: Buffer.from(attestationObject).toString("base64url"), transports: ["internal", "hybrid"] as ("internal" | "hybrid")[] },
    };
  }
  /** Answers navigator.credentials.get(). */
  login(options: { challenge: string }) {
    const authData = this.authData(false);
    const cd = this.clientData("webauthn.get", options.challenge);
    const signature = sign("sha256", Buffer.concat([authData, createHash("sha256").update(cd).digest()]), this.key);
    return {
      id: this.id, rawId: this.id, type: "public-key" as const, clientExtensionResults: {},
      response: { clientDataJSON: cd.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url"), userHandle: this.userHandle ?? undefined },
    };
  }
}
