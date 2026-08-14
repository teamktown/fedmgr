/**
 * Shared trust-fabric test fixtures — ES256 edition.
 *
 * WHY: the MCP trust-circle illustration (`provision_mcp_trust_circle`) is wired
 * to `OpenBaoTransitProvider` + `MemoryOpenBaoTransitClient`, which sign with
 * RS256. The *real* Trust Anchor and Trust Mark Issuer servers, however, sign
 * with `SoftKmsProvider` — EC P-256 / ES256 (see packages/kms/src/index.ts).
 * Tests that only ever exercise the RS256 in-memory path cannot catch the
 * interop bug where `validateMcpInvocation` is fed ES256-signed statements from
 * the real TA/TMI (review Finding #5). This fixture mints a federation that
 * signs with the SAME ES256 algorithm production uses, so Phase 1 tests can
 * prove the verifier works against real TA/TMI artefacts.
 *
 * INVARIANT: every provider here signs with alg=ES256 over an EC P-256 key.
 *   `federation-fixtures.test.mjs` asserts this so the fixture can never silently
 *   drift back to RS256 and re-mask the bug.
 *
 * AI-NOTE: `Es256MemoryProvider` deliberately mirrors the `KeyProvider` contract
 *   in packages/kms/src/index.ts (kid/jwks/signJwt). It is an in-memory, ephemeral
 *   analogue of `SoftKmsProvider` — same alg and key type, but keys are generated
 *   per-instance instead of read from disk. Keep the two in lockstep on alg/kty.
 */
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  calculateJwkThumbprint,
  decodeProtectedHeader,
} from "jose";

/** Algorithm + curve the whole real trust fabric uses. Do not change in isolation. */
export const FIXTURE_ALG = "ES256";
export const FIXTURE_CRV = "P-256";

/**
 * In-memory ES256 KeyProvider. Implements the same surface as
 * `@letsfederate/kms` providers so it can be passed anywhere a
 * `trustAnchorKms` / `entityKms` is expected (e.g. `provisionMcpTrustCircle`,
 * `registerMcpEntity`, `issueMcpInvocationToken`).
 */
export class Es256MemoryProvider {
  /**
   * @param {{ issuer?: string, keyName?: string }} [cfg]
   *   issuer is informational (parity with SoftKmsConfig); keyName, when given,
   *   becomes the stable `kid`. Otherwise the kid is the JWK thumbprint.
   */
  constructor(cfg = {}) {
    this.issuer = cfg.issuer;
    this._keyName = cfg.keyName;
    /** @type {import('jose').KeyLike | undefined} */
    this._priv = undefined;
    /** @type {import('jose').JWK | undefined} */
    this._pub = undefined;
    /** @type {string | undefined} */
    this._kid = undefined;
  }

  /**
   * Lazily generate the keypair on first use.
   * WHY lazy: mirrors SoftKmsProvider.ensureLoaded() and lets the constructor
   * stay synchronous so it works as an `entityKmsFactory: (id) => KeyProvider`.
   */
  async #ensureLoaded() {
    if (this._priv && this._pub) return;
    // extractable:true so exportJWK can serialise the public key on all runtimes.
    const { privateKey, publicKey } = await generateKeyPair(FIXTURE_ALG, {
      extractable: true,
    });
    const pub = await exportJWK(publicKey);
    // SECURITY: advertise alg/use on the public JWK. The Phase 1 verifier fix
    // (#5) infers the import algorithm from `jwk.alg`; populating it here keeps
    // the fixture representative of well-formed JWKS.
    pub.alg = FIXTURE_ALG;
    pub.use = "sig";
    pub.kid = this._keyName ?? (await calculateJwkThumbprint(pub));
    this._pub = pub;
    this._priv = privateKey;
    this._kid = pub.kid;
  }

  /** @returns {Promise<string>} stable key id (kid claim). */
  async kid() {
    await this.#ensureLoaded();
    return /** @type {string} */ (this._kid);
  }

  /**
   * Public JWKS — safe to expose. INVARIANT: never includes the private `d`.
   * @returns {Promise<{ keys: import('jose').JWK[] }>}
   */
  async jwks() {
    await this.#ensureLoaded();
    const { d: _d, ...pubOnly } = /** @type {any} */ (this._pub);
    return { keys: [{ ...pubOnly }] };
  }

  /**
   * Sign a JWT payload with ES256.
   * @param {import('jose').JWTPayload} payload
   * @param {Record<string, unknown>} [additionalHeader]
   * @returns {Promise<string>} compact JWS
   */
  async signJwt(payload, additionalHeader = {}) {
    await this.#ensureLoaded();
    return new SignJWT(payload)
      .setProtectedHeader({
        alg: FIXTURE_ALG,
        kid: /** @type {string} */ (this._kid),
        ...additionalHeader,
      })
      .sign(/** @type {any} */ (this._priv));
  }
}

/**
 * Convenience constructor.
 * @param {{ issuer?: string, keyName?: string }} [cfg]
 * @returns {Es256MemoryProvider}
 */
export function makeEs256Provider(cfg = {}) {
  return new Es256MemoryProvider(cfg);
}

/**
 * Build an `entityKmsFactory` for `provisionMcpTrustCircle` that hands each MCP
 * its own ES256 provider.
 * @param {string} issuerBase e.g. "https://fedmgr.local/mcp"
 * @returns {(mcpId: string) => Es256MemoryProvider}
 */
export function makeEs256ProviderFactory(issuerBase) {
  return (mcpId) =>
    new Es256MemoryProvider({ issuer: `${issuerBase}/${mcpId}`, keyName: mcpId });
}

/**
 * Read the `alg` from a compact JWS protected header — used by tests to assert
 * the ES256 INVARIANT without fully verifying the signature.
 * @param {string} jws
 * @returns {string | undefined}
 */
export function protectedHeaderAlg(jws) {
  return decodeProtectedHeader(jws).alg;
}
