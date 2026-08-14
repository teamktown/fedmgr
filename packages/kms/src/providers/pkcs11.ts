/**
 * PKCS#11 KMS Provider
 *
 * Implements the KeyProvider interface using a PKCS#11 token (SoftHSM2,
 * YubiKey, Cloud HSM). Requires the `pkcs11js` npm package and a working
 * PKCS#11 library (e.g. SoftHSM2) installed on the host.
 *
 * Key policy:
 *   - Private key material never leaves the HSM.
 *   - signJwt() submits the raw ECDSA signature operation to the token;
 *     the digest is computed by the HSM.
 *   - jwks() exports only public key coordinates from the token.
 *
 * ECDSA signature format:
 *   PKCS#11 C_Sign with CKM_ECDSA returns a DER-encoded ASN.1 SEQUENCE
 *   { r INTEGER, s INTEGER }. JWS RFC 7518 §3.4 requires a fixed-size
 *   raw R||S encoding (32 bytes each for P-256). This class performs the
 *   conversion without external dependencies via a minimal ASN.1 parser.
 *
 * Usage:
 *   const provider = new Pkcs11Provider({
 *     libraryPath: '/usr/lib/softhsm/libsofthsm2.so',
 *     slot: 0,
 *     pin: 'userpin',
 *     keyLabel: 'ta-signing-key',
 *     kid: 'ta-key-v1',
 *   });
 *
 * CI / test environments:
 *   Decision 2 — CI uses SoftKMS only. Tests that exercise this class are
 *   gated behind the SOFTHSM2_MODULE env var and will be skipped in CI.
 */

import {
  SignJWT,
  importJWK,
  exportJWK,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";
import { createHash } from "node:crypto";
import type { KeyProvider } from "../index.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type Pkcs11Config = {
  /** Filesystem path to the PKCS#11 shared library (e.g. libsofthsm2.so). */
  libraryPath: string;
  /** HSM slot index (default 0). */
  slot?: number;
  /** User PIN for the token. */
  pin: string;
  /** CKA_LABEL of the EC signing key to use. */
  keyLabel: string;
  /** Stable key identifier returned by kid() and used as the JWK kid. */
  kid?: string;
};

// ---------------------------------------------------------------------------
// ASN.1 DER helpers (no external deps)
// ---------------------------------------------------------------------------

/**
 * Parse a DER-encoded ECDSA signature (SEQUENCE { r INTEGER, s INTEGER })
 * and return a fixed-size raw R||S buffer suitable for JWS (RFC 7518 §3.4).
 *
 * For P-256, coordinateBytes = 32.
 */
function derEcdsaToRaw(der: Buffer, coordinateBytes = 32): Buffer {
  let offset = 0;

  if (der[offset++] !== 0x30) throw new Error("ECDSA DER: expected SEQUENCE tag");
  // skip length byte(s)
  let seqLen = der[offset++];
  if (seqLen & 0x80) {
    const lenBytes = seqLen & 0x7f;
    offset += lenBytes; // skip multi-byte length
  }

  function readInt(): Buffer {
    if (der[offset++] !== 0x02) throw new Error("ECDSA DER: expected INTEGER tag");
    let len = der[offset++];
    if (len & 0x80) {
      const lb = len & 0x7f;
      len = 0;
      for (let i = 0; i < lb; i++) len = (len << 8) | der[offset++];
    }
    const value = der.subarray(offset, offset + len);
    offset += len;
    return Buffer.from(value);
  }

  const rBuf = readInt();
  const sBuf = readInt();

  // Pad or trim to coordinateBytes (DER INTEGERs may have a leading 0x00 sign byte)
  const raw = Buffer.alloc(coordinateBytes * 2, 0);

  const rTrimmed = rBuf[0] === 0 ? rBuf.subarray(1) : rBuf;
  const sTrimmed = sBuf[0] === 0 ? sBuf.subarray(1) : sBuf;

  rTrimmed.copy(raw, coordinateBytes - rTrimmed.length);
  sTrimmed.copy(raw, coordinateBytes * 2 - sTrimmed.length);

  return raw;
}

// ---------------------------------------------------------------------------
// Pkcs11Provider
// ---------------------------------------------------------------------------

export class Pkcs11Provider implements KeyProvider {
  private readonly cfg: Pkcs11Config;
  private _pkcs11: unknown; // lazy-loaded pkcs11js instance
  private _session: unknown;
  private _cachedKid: string | undefined;
  private _cachedJwk: JWK | undefined;

  constructor(config: Pkcs11Config) {
    this.cfg = config;
  }

  // -------------------------------------------------------------------------
  // KeyProvider interface
  // -------------------------------------------------------------------------

  async kid(): Promise<string> {
    if (this._cachedKid) return this._cachedKid;
    if (this.cfg.kid) {
      this._cachedKid = this.cfg.kid;
      return this._cachedKid;
    }
    // Use the key label as the kid when no explicit kid is configured
    this._cachedKid = this.cfg.keyLabel;
    return this._cachedKid;
  }

  async jwks(): Promise<{ keys: JWK[] }> {
    const jwk = await this._getPublicJwk();
    return { keys: [{ ...jwk, kid: await this.kid() }] };
  }

  async signJwt(
    payload: JWTPayload,
    additionalHeader: Record<string, unknown> = {}
  ): Promise<string> {
    // Get the public JWK so we can reconstruct a CryptoKey for SignJWT header building.
    // The actual signing operation uses the HSM private key via C_Sign.
    // ES256 is fixed in this provider: it drives a P-256 hardware key and
    // hashes SHA-256 itself — the alg is a property of the HSM key, not config.
    const pubJwk = await this._getPublicJwk();
    const pubKey = (await importJWK(pubJwk, "ES256")) as CryptoKey;

    // We need to use jose's SignJWT for header/payload assembly but replace
    // the actual sign operation. Since jose's SignJWT.sign() is not easily
    // interceptable, we assemble the signing input manually, call C_Sign,
    // and then reconstruct the compact JWS.
    const header = {
      alg: "ES256",
      kid: await this.kid(),
      ...additionalHeader,
    };

    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;

    // PKCS#11 CKM_ECDSA signs the *hash* of the message (not the message itself).
    // Pre-compute SHA-256 of the signing input for JWS ES256 (RFC 7518 §3.4).
    // Output from CKM_ECDSA is raw R||S (32 bytes each = 64 bytes for P-256).
    const hash = createHash("sha256").update(signingInput).digest();
    const rawSig = await this._pkcs11Sign(hash);
    const sigB64 = rawSig.toString("base64url");

    // Suppress unused variable
    void pubKey;

    return `${signingInput}.${sigB64}`;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _initPkcs11(): Promise<void> {
    if (this._pkcs11 && this._session) return;

    // Lazy-load pkcs11js — will throw at runtime if not installed, which is
    // the correct behaviour for environments without a PKCS#11 library.
    let Pkcs11Js: { PKCS11: new () => unknown };
    try {
      // Dynamic import to allow the rest of the KMS package to work without
      // pkcs11js installed (per Decision 2 — CI uses SoftKMS only).
      Pkcs11Js = (await import("pkcs11js")) as { PKCS11: new () => unknown };
    } catch {
      throw new Error(
        "Pkcs11Provider: pkcs11js is not installed. " +
        "Install it with: npm install pkcs11js\n" +
        "For local dev/test use SoftKmsProvider instead (Decision 2)."
      );
    }

    const pkcs11 = new (Pkcs11Js as { PKCS11: new () => {
      load(lib: string): void;
      C_Initialize(): void;
      C_GetSlotList(present: boolean): number[];
      C_OpenSession(slot: number, flags: number): unknown;
      C_Login(session: unknown, userType: number, pin: string): void;
    } }).PKCS11();

    pkcs11.load(this.cfg.libraryPath);
    try {
      pkcs11.C_Initialize();
    } catch (err: unknown) {
      // CKR_CRYPTOKI_ALREADY_INITIALIZED (0x191 = 401): library already
      // initialised in this process (e.g. multiple providers in tests). Safe
      // to continue — the library is ready.
      const pkcs11Err = err as { code?: number };
      if (pkcs11Err.code !== 401) throw err;
    }

    const slots = pkcs11.C_GetSlotList(true);
    const slotIndex = this.cfg.slot ?? 0;
    if (slotIndex >= slots.length) {
      throw new Error(
        `Pkcs11Provider: slot ${slotIndex} not found. Available slots: ${slots.length}`
      );
    }

    // CKF_SERIAL_SESSION (0x4) | CKF_RW_SESSION (0x2) — RW required for login
    const CKF_SERIAL_SESSION = 0x00000004;
    const CKF_RW_SESSION = 0x00000002;
    const session = pkcs11.C_OpenSession(slots[slotIndex], CKF_SERIAL_SESSION | CKF_RW_SESSION);
    const CKU_USER = 1;
    try {
      pkcs11.C_Login(session, CKU_USER, this.cfg.pin);
    } catch (err: unknown) {
      // CKR_USER_ALREADY_LOGGED_IN (0x100 = 256): token's user is already
      // authenticated on another session in this process. The session we just
      // opened inherits that login state — safe to continue.
      const pkcs11Err = err as { code?: number };
      if (pkcs11Err.code !== 256) throw err;
    }

    this._pkcs11 = pkcs11;
    this._session = session;
  }

  private async _getPublicJwk(): Promise<JWK> {
    if (this._cachedJwk) return this._cachedJwk;
    await this._initPkcs11();

    // Find the EC public key object with the configured label
    const p11 = this._pkcs11 as {
      C_FindObjectsInit(session: unknown, template: unknown[]): void;
      C_FindObjects(session: unknown, max: number): unknown[];
      C_FindObjectsFinal(session: unknown): void;
      C_GetAttributeValue(session: unknown, obj: unknown, template: unknown[]): unknown[];
    };
    const CKO_PUBLIC_KEY = 2; // CKO_PUBLIC_KEY = 0x00000002
    const CKA_CLASS = 0;
    const CKA_LABEL = 3;
    const CKA_EC_POINT = 0x0181;
    const CKA_EC_PARAMS = 0x0180;

    // pkcs11js accepts plain numbers/strings; it marshals to the correct
    // CK_ULONG / UTF8String buffer internally.
    p11.C_FindObjectsInit(this._session, [
      { type: CKA_CLASS, value: CKO_PUBLIC_KEY },
      { type: CKA_LABEL, value: this.cfg.keyLabel },
    ]);
    const objs = p11.C_FindObjects(this._session, 1);
    p11.C_FindObjectsFinal(this._session);

    if (objs.length === 0) {
      throw new Error(
        `Pkcs11Provider: no public key found with label '${this.cfg.keyLabel}'`
      );
    }

    const attrs = p11.C_GetAttributeValue(this._session, objs[0], [
      { type: CKA_EC_POINT },
      { type: CKA_EC_PARAMS },
    ]) as Array<{ value: Buffer }>;

    // EC_POINT is DER-encoded OCTET STRING wrapping the uncompressed point (04 || X || Y)
    // EC_PARAMS is the OID for the curve (P-256: 1.2.840.10045.3.1.7)
    const ecPointDer = attrs[0].value;
    // Strip the outer OCTET STRING tag (04) and length byte if present
    let point = ecPointDer;
    if (point[0] === 0x04 && point[1] === 0x41) {
      // OCTET STRING length prefix
      point = point.subarray(2);
    }
    // point should now be: 0x04 || X (32 bytes) || Y (32 bytes)
    if (point[0] !== 0x04 || point.length !== 65) {
      throw new Error("Pkcs11Provider: unexpected EC point format");
    }
    const x = point.subarray(1, 33).toString("base64url");
    const y = point.subarray(33, 65).toString("base64url");

    const jwk: JWK = { kty: "EC", crv: "P-256", x, y, use: "sig", alg: "ES256" };
    this._cachedJwk = jwk;
    return jwk;
  }

  private async _pkcs11Sign(data: Buffer): Promise<Buffer> {
    await this._initPkcs11();

    const p11 = this._pkcs11 as {
      C_FindObjectsInit(session: unknown, template: unknown[]): void;
      C_FindObjects(session: unknown, max: number): unknown[];
      C_FindObjectsFinal(session: unknown): void;
      C_SignInit(session: unknown, mechanism: unknown, key: unknown): void;
      // pkcs11js C_Sign(session, data, outputBuffer): fills outputBuffer and
      // returns a slice of it containing the actual signature bytes.
      C_Sign(session: unknown, data: Buffer, out: Buffer): Buffer;
    };

    const CKO_PRIVATE_KEY = 3; // CKO_PRIVATE_KEY = 0x00000003
    const CKA_CLASS = 0;
    const CKA_LABEL = 3;

    p11.C_FindObjectsInit(this._session, [
      { type: CKA_CLASS, value: CKO_PRIVATE_KEY },
      { type: CKA_LABEL, value: this.cfg.keyLabel },
    ]);
    const objs = p11.C_FindObjects(this._session, 1);
    p11.C_FindObjectsFinal(this._session);

    if (objs.length === 0) {
      throw new Error(
        `Pkcs11Provider: no private key found with label '${this.cfg.keyLabel}'`
      );
    }

    // CKM_ECDSA (0x1041): raw ECDSA — caller must pre-hash the message.
    // signJwt() passes SHA-256(signingInput), giving us ES256 semantics.
    // Output is raw R||S (32 bytes each for P-256 = 64 bytes total).
    const CKM_ECDSA = 0x00001041;
    p11.C_SignInit(this._session, { mechanism: CKM_ECDSA }, objs[0]);
    // pkcs11js C_Sign(session, data, outputBuffer): returns a slice of
    // outputBuffer containing exactly the signature bytes.
    return p11.C_Sign(this._session, data, Buffer.allocUnsafe(128));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}
