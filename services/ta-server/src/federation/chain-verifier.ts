/**
 * OIDF Trust Chain Verifier
 *
 * Walks the trust chain from a leaf entity up to a trust anchor, verifying
 * each JWT signature along the way.
 *
 * Algorithm (per OpenID Federation 1.0 draft-43 §9):
 *  1. Fetch the leaf's self-signed entity statement; extract authority_hints
 *  2. Follow authority_hints upward:
 *     a. Fetch the authority's self-signed entity statement (to get their JWKS
 *        and federation_fetch_endpoint)
 *     b. Fetch the authority's subordinate statement for the current entity
 *        (GET <federation_fetch_endpoint>?sub=<currentEntityId>)
 *     c. Verify the subordinate statement signature with the authority's JWKS
 *     d. Record the verified link
 *     e. If the authority is the expected trust anchor → done
 *     f. Otherwise fetch the authority's authority_hints → move up
 *  3. Chain is complete when we reach the trust anchor
 *
 * This module is intentionally free of server-level imports so it can be
 * extracted into its own package in a future increment.
 */

import { jwtVerify, decodeJwt, importJWK, type CryptoKey, type JWK, type JWTPayload } from "jose";
import { jwsAlgForJwk, SUPPORTED_JWS_ALGS } from "@letsfederate/kms";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type TrustChainLink = {
  /** Authority entity ID that issued this subordinate statement. */
  iss: string;
  /** Subject entity being vouched for. */
  sub: string;
  /** The raw JWS string of the subordinate statement. */
  jwt: string;
};

export type TrustChainResult =
  | { ok: true; chain: TrustChainLink[] }
  | { ok: false; error: string; chain?: TrustChainLink[] };

export type TrustChainOptions = {
  /** Maximum number of hops to traverse (default 10). */
  maxDepth?: number;
  /** Clock tolerance in seconds (default 60). */
  clockTolerance?: number;
  /** Injectable fetch function (default: global fetch). */
  fetchFn?: FetchFn;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the self-signed entity statement JWT from the
 * /.well-known/openid-federation endpoint of the given entity.
 */
export async function resolveFederationStatement(
  entityId: string,
  fetchFn: FetchFn = fetch as unknown as FetchFn
): Promise<string> {
  const url = `${entityId}/.well-known/openid-federation`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch entity statement for ${entityId}: HTTP ${res.status}`
    );
  }
  return res.text();
}

/**
 * Verify the full trust chain from `leafEntityId` up to `trustAnchorEntityId`.
 */
export async function verifyTrustChain(
  leafEntityId: string,
  trustAnchorEntityId: string,
  options: TrustChainOptions = {}
): Promise<TrustChainResult> {
  const maxDepth = options.maxDepth ?? 10;
  const clockTolerance = `${options.clockTolerance ?? 60}s`;
  const fetchFn: FetchFn = (options.fetchFn as FetchFn | undefined) ??
    (fetch as unknown as FetchFn);

  const chain: TrustChainLink[] = [];
  const seen = new Set<string>();

  // -------------------------------------------------------------------------
  // Start: fetch and decode the leaf's self-signed entity statement
  // -------------------------------------------------------------------------
  let currentEntityId = leafEntityId;
  let currentSelfJwt: string;
  let currentPayload: JWTPayload;

  try {
    currentSelfJwt = await resolveFederationStatement(currentEntityId, fetchFn);
    currentPayload = decodeJwt(currentSelfJwt);
  } catch (err: unknown) {
    return {
      ok: false,
      error: `Failed to fetch leaf entity statement for ${currentEntityId}: ${(err as Error).message}`,
      chain,
    };
  }

  // Walk up the authority_hints chain
  for (let depth = 0; depth < maxDepth; depth++) {
    if (seen.has(currentEntityId)) {
      return { ok: false, error: `Cycle detected: ${currentEntityId} seen twice`, chain };
    }
    seen.add(currentEntityId);

    // Extract authority_hints from the current entity's self-signed statement
    const authorityHints = currentPayload["authority_hints"] as string[] | undefined;
    const authorityId = authorityHints?.[0];

    if (!authorityId) {
      // No authority hints → this entity thinks it's self-sovereign.
      // If it's the expected trust anchor, we're done (TA has no authority above it).
      // Otherwise the chain can't be completed.
      if (currentEntityId === trustAnchorEntityId) {
        // Verify the TA's own self-signed statement signature against its own JWKS
        const taJwksKeys = (currentPayload.jwks as { keys: JWK[] } | undefined)?.keys;
        if (!taJwksKeys || taJwksKeys.length === 0) {
          return { ok: false, error: `Trust anchor ${currentEntityId} has no JWKS`, chain };
        }
        // TA is already in the chain via a subordinate statement from the previous hop.
        // Just verify its self-signature here as a final sanity check.
        try {
          const taKey = await importFirstKey(taJwksKeys);
          await jwtVerify(currentSelfJwt, taKey, { clockTolerance, algorithms: [...SUPPORTED_JWS_ALGS] });
        } catch (err: unknown) {
          return {
            ok: false,
            error: `Trust anchor self-signature invalid: ${(err as Error).message}`,
            chain,
          };
        }
        return { ok: true, chain };
      }
      return {
        ok: false,
        error: `Chain terminated at ${currentEntityId} but expected trust anchor ${trustAnchorEntityId}`,
        chain,
      };
    }

    // -----------------------------------------------------------------------
    // Fetch the authority's self-signed statement (to get their JWKS and
    // federation_fetch_endpoint)
    // -----------------------------------------------------------------------
    let authoritySelfJwt: string;
    let authorityPayload: JWTPayload;
    try {
      authoritySelfJwt = await resolveFederationStatement(authorityId, fetchFn);
      authorityPayload = decodeJwt(authoritySelfJwt);
    } catch (err: unknown) {
      return {
        ok: false,
        error: `Failed to fetch entity statement for authority ${authorityId}: ${(err as Error).message}`,
        chain,
      };
    }

    const authorityJwksKeys = (authorityPayload.jwks as { keys: JWK[] } | undefined)?.keys;
    if (!authorityJwksKeys || authorityJwksKeys.length === 0) {
      return { ok: false, error: `Authority ${authorityId} has no JWKS`, chain };
    }
    const authorityKey = await importFirstKey(authorityJwksKeys);

    // -----------------------------------------------------------------------
    // Verify authority's own self-signed statement (signature check)
    // -----------------------------------------------------------------------
    try {
      await jwtVerify(authoritySelfJwt, authorityKey, { clockTolerance, algorithms: [...SUPPORTED_JWS_ALGS] });
    } catch (err: unknown) {
      return {
        ok: false,
        error: `Authority ${authorityId} self-signature invalid: ${(err as Error).message}`,
        chain,
      };
    }

    // -----------------------------------------------------------------------
    // Fetch the authority's subordinate statement for the current entity
    // -----------------------------------------------------------------------
    const authorityFe = (authorityPayload.metadata as Record<string, unknown> | undefined)
      ?.["federation_entity"] as Record<string, unknown> | undefined;
    const fetchEndpoint = authorityFe?.["federation_fetch_endpoint"] as string | undefined;

    if (!fetchEndpoint) {
      return {
        ok: false,
        error: `Authority ${authorityId} has no federation_fetch_endpoint`,
        chain,
      };
    }

    const subStmtUrl = `${fetchEndpoint}?sub=${encodeURIComponent(currentEntityId)}`;
    let subStmtJwt: string;
    try {
      const r = await fetchFn(subStmtUrl);
      if (!r.ok) {
        return {
          ok: false,
          error: `${authorityId} returned HTTP ${r.status} for subordinate statement of ${currentEntityId}`,
          chain,
        };
      }
      subStmtJwt = await r.text();
    } catch (err: unknown) {
      return {
        ok: false,
        error: `Failed to fetch subordinate statement from ${subStmtUrl}: ${(err as Error).message}`,
        chain,
      };
    }

    // -----------------------------------------------------------------------
    // Verify the subordinate statement using the authority's JWKS
    // -----------------------------------------------------------------------
    try {
      await jwtVerify(subStmtJwt, authorityKey, { clockTolerance, algorithms: [...SUPPORTED_JWS_ALGS] });
    } catch (err: unknown) {
      return {
        ok: false,
        error: `Signature verification failed for subordinate statement of ${currentEntityId}: ${(err as Error).message}`,
        chain,
      };
    }

    chain.push({ iss: authorityId, sub: currentEntityId, jwt: subStmtJwt });

    // -----------------------------------------------------------------------
    // Move up: the authority becomes the current entity for the next hop
    // -----------------------------------------------------------------------
    if (authorityId === trustAnchorEntityId) {
      // We've just verified the TA's subordinate statement for the entity below it.
      // The chain is complete.
      return { ok: true, chain };
    }

    // Continue upward: fetch the authority's self-signed stmt to get its authority_hints
    currentEntityId = authorityId;
    currentSelfJwt = authoritySelfJwt;
    currentPayload = authorityPayload;
  }

  return {
    ok: false,
    error: `Trust chain exceeded max depth of ${maxDepth}`,
    chain,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function importFirstKey(keys: JWK[]): Promise<CryptoKey> {
  let lastErr: Error | undefined;
  for (const key of keys) {
    try {
      // jwsAlgForJwk throws for keys outside the supported EC family, which
      // moves us on to the next candidate rather than importing a key we
      // would never accept at verification time.
      return (await importJWK(key, jwsAlgForJwk(key))) as CryptoKey;
    } catch (err: unknown) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error("No importable key found in JWKS");
}
