import {
  importJWK,
  exportJWK,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";
import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// JWS algorithm policy
// ---------------------------------------------------------------------------

/**
 * The closed set of JWS algorithms this stack signs and verifies with.
 * Interop note: go-oidfed/lighthouse defaults to ES512; we accept the EC
 * family but nothing looser — alg is always derived from the key we hold or
 * checked against this list, never taken from an attacker-supplied header.
 */
export const SUPPORTED_JWS_ALGS = ["ES256", "ES384", "ES512"] as const;
export type SupportedJwsAlg = (typeof SUPPORTED_JWS_ALGS)[number];

const EC_CRV_TO_ALG: Record<string, SupportedJwsAlg> = {
  "P-256": "ES256",
  "P-384": "ES384",
  "P-521": "ES512",
};

/**
 * Derive the JWS alg for a JWK: the key's own `alg` when present (must be in
 * the supported set), else inferred from the EC curve. jose v6 requires an
 * explicit alg for JWKs without one, and step-cli-generated keys carry none.
 */
export function jwsAlgForJwk(jwk: JWK): SupportedJwsAlg {
  if (jwk.alg) {
    if (!(SUPPORTED_JWS_ALGS as readonly string[]).includes(jwk.alg)) {
      throw new Error(`unsupported JWS alg "${jwk.alg}" (supported: ${SUPPORTED_JWS_ALGS.join(", ")})`);
    }
    return jwk.alg as SupportedJwsAlg;
  }
  const alg = jwk.kty === "EC" && jwk.crv ? EC_CRV_TO_ALG[jwk.crv] : undefined;
  if (!alg) {
    throw new Error(`cannot infer JWS alg for kty=${String(jwk.kty)} crv=${String(jwk.crv)}`);
  }
  return alg;
}

// ---------------------------------------------------------------------------
// Core interface — every KMS provider must implement this.
// ---------------------------------------------------------------------------

export interface KeyProvider {
  /** Stable key identifier (kid claim). */
  kid(): Promise<string>;
  /** Public JWKS — safe to expose at /.well-known/jwks.json. */
  jwks(): Promise<{ keys: JWK[] }>;
  /**
   * Sign a JWT payload. The provider handles algorithm selection and key
   * access — callers never touch raw key material.
   */
  signJwt(
    payload: JWTPayload,
    additionalHeader?: Record<string, unknown>
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// SoftKMS provider
//
// Uses a Step CLI-generated JWK pair:
//   - Private key is encrypted at rest (PBES2 JWE via `step crypto jwk create`)
//   - The process must receive the decrypted private JWK path at startup
//     (mounted from tmpfs or decrypted inline by tmi-decrypt.sh).
//   - Public JWK is loaded separately to construct the JWKS endpoint payload.
//
// Policy: this class never writes key material; it only reads from paths
// supplied at construction time. Encryption-at-rest and tmpfs decryption
// are the operator's responsibility (enforced by scripts/tmi-keys-init.sh
// and scripts/tmi-decrypt.sh).
// ---------------------------------------------------------------------------

export type SoftKmsConfig = {
  /** Path to the decrypted private JWK (should be on tmpfs at runtime). */
  privateJwkPath: string;
  /** Path to the plaintext public JWK (safe to store on disk). */
  publicJwkPath: string;
  /** Issuer identifier included in signed tokens. */
  issuer: string;
  /** Full URL to the JWKS endpoint (used for jku header). */
  jwksUrl: string;
};

export class SoftKmsProvider implements KeyProvider {
  private readonly cfg: SoftKmsConfig;
  private _kid: string | undefined;
  private _priv: CryptoKey | undefined;
  private _alg: SupportedJwsAlg | undefined;
  private _pub: JWK | undefined;

  constructor(cfg: SoftKmsConfig) {
    this.cfg = cfg;
  }

  async kid(): Promise<string> {
    await this.ensureLoaded();
    if (!this._pub!.kid) {
      // Derive a stable kid from the JWK thumbprint when the file has none.
      const k = await importJWK(this._pub as JWK, jwsAlgForJwk(this._pub as JWK));
      const exported = await exportJWK(k);
      this._pub!.kid = exported.kid ?? "default";
    }
    this._kid = this._pub!.kid as string;
    return this._kid;
  }

  async jwks(): Promise<{ keys: JWK[] }> {
    await this.ensureLoaded();
    // Strip any private fields before serving. Public JWK file should already
    // contain only public params, but we defensively remove `d`.
    const { d: _d, ...pubOnly } = this._pub as JWK & { d?: string };
    return { keys: [{ ...pubOnly, kid: await this.kid() }] };
  }

  async signJwt(
    payload: JWTPayload,
    additionalHeader: Record<string, unknown> = {}
  ): Promise<string> {
    await this.ensureLoaded();
    return new SignJWT(payload)
      .setProtectedHeader({
        alg: this._alg as SupportedJwsAlg,
        kid: await this.kid(),
        ...additionalHeader,
      })
      .sign(this._priv as CryptoKey);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async ensureLoaded(): Promise<void> {
    if (this._priv && this._pub) return;

    const [privRaw, pubRaw] = await Promise.all([
      fs.readFile(path.resolve(this.cfg.privateJwkPath), "utf8"),
      fs.readFile(path.resolve(this.cfg.publicJwkPath), "utf8"),
    ]);

    const privJwk: JWK = JSON.parse(privRaw) as JWK;
    const pubJwk: JWK = JSON.parse(pubRaw) as JWK;

    // Validate we hold a supported EC key and that the pair is coherent —
    // fail fast rather than sign with a wrong algorithm. jwsAlgForJwk throws
    // on anything outside SUPPORTED_JWS_ALGS.
    const privAlg = jwsAlgForJwk(privJwk);
    const pubAlg = jwsAlgForJwk(pubJwk);
    if (privAlg !== pubAlg) {
      throw new Error(
        `SoftKmsProvider: key pair mismatch — private is ${privAlg}, public is ${pubAlg}`
      );
    }

    this._pub = pubJwk;
    this._alg = privAlg;
    const imported = await importJWK(privJwk, privAlg);
    // importJWK returns CryptoKey | Uint8Array; EC keys are always CryptoKey.
    this._priv = imported as CryptoKey;
  }
}

// ---------------------------------------------------------------------------
// PKCS#11 stub — not yet implemented; placeholder for SoftHSM2/YubiKey.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PKCS#11 provider — implemented in providers/pkcs11.ts
// Requires pkcs11js npm package + a PKCS#11 library (e.g. SoftHSM2).
// Per Decision 2: CI uses SoftKMS only; PKCS#11 tests are integration-gated.
// ---------------------------------------------------------------------------

export { Pkcs11Provider, type Pkcs11Config } from "./providers/pkcs11.js";
export {
  OpenBaoTransitProvider,
  HttpOpenBaoTransitClient,
  MemoryOpenBaoTransitClient,
  type OpenBaoTransitConfig,
  type OpenBaoTransitClient,
} from "./providers/openbao.js";
import { Pkcs11Provider, type Pkcs11Config } from "./providers/pkcs11.js";
import { OpenBaoTransitProvider, type OpenBaoTransitConfig } from "./providers/openbao.js";

// ---------------------------------------------------------------------------
// Trust policy + result formatting.
//
// The trust-DECISION engine moved to @letsfederate/oidf-verify (§10 key
// binding, pinned anchors, no jku). The weak validateTrustmark/validateTrustChain
// were REMOVED — this module now exposes only the policy/formatting layer, which
// is verifier-agnostic.
// ---------------------------------------------------------------------------

export {
  applyPolicy,
  trustPolicyFromEnv,
  formatTrustMessage,
  TrustPolicyError,
  type TrustState,
  type TrustPolicy,
  type TrustResult,
} from "./trust-validator.js";

export { assertSafeUrl, allowedOrigins, UrlSafetyError } from "./validate-url.js";

// ---------------------------------------------------------------------------
// Factory — resolves provider from a string tag.
// ---------------------------------------------------------------------------

export type KmsProviderTag = "softkms" | "pkcs11" | "openbao-transit" | "vault-transit";

export function createProvider(
  tag: KmsProviderTag,
  config: unknown
): KeyProvider {
  switch (tag) {
    case "softkms":
      return new SoftKmsProvider(config as SoftKmsConfig);
    case "pkcs11":
      return new Pkcs11Provider(config as Pkcs11Config);
    case "openbao-transit":
    case "vault-transit":
      return new OpenBaoTransitProvider(config as OpenBaoTransitConfig);
    default: {
      const _exhaustive: never = tag;
      throw new Error(`Unknown KMS provider: ${String(_exhaustive)}`);
    }
  }
}
