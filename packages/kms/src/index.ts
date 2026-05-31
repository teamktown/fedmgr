import {
  importJWK,
  exportJWK,
  SignJWT,
  type JWK,
  type JWTPayload,
  type KeyLike,
} from "jose";
import fs from "node:fs/promises";
import path from "node:path";

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
  private _priv: KeyLike | undefined;
  private _pub: JWK | undefined;

  constructor(cfg: SoftKmsConfig) {
    this.cfg = cfg;
  }

  async kid(): Promise<string> {
    await this.ensureLoaded();
    if (!this._pub!.kid) {
      // Derive a stable kid from the JWK thumbprint when the file has none.
      const k = await importJWK(this._pub as JWK, "ES256");
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
        alg: "ES256",
        kid: await this.kid(),
        ...additionalHeader,
      })
      .sign(this._priv as KeyLike);
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

    // Validate we have an EC P-256 key — fail fast rather than sign with
    // a wrong algorithm.
    if (privJwk.kty !== "EC" || privJwk.crv !== "P-256") {
      throw new Error(
        `SoftKmsProvider: expected EC P-256 private key, got kty=${privJwk.kty} crv=${privJwk.crv}`
      );
    }
    if (pubJwk.kty !== "EC" || pubJwk.crv !== "P-256") {
      throw new Error(
        `SoftKmsProvider: expected EC P-256 public key, got kty=${pubJwk.kty} crv=${pubJwk.crv}`
      );
    }

    this._pub = pubJwk;
    const imported = await importJWK(privJwk, "ES256");
    // importJWK returns KeyLike | Uint8Array; EC keys are always KeyLike.
    this._priv = imported as KeyLike;
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
// Trust Validator — validate trustmark JWS tokens and OIDF trust chains.
// ---------------------------------------------------------------------------

export {
  validateTrustmark,
  validateTrustChain,
  applyPolicy,
  trustPolicyFromEnv,
  formatTrustMessage,
  TrustPolicyError,
  type TrustState,
  type TrustPolicy,
  type TrustResult,
  type ValidateTrustmarkOptions,
  type ValidateChainOptions,
} from "./trust-validator.js";

export { assertSafeUrl, UrlSafetyError } from "./validate-url.js";

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
