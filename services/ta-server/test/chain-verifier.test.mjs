/**
 * Tests for the trust chain verifier.
 *
 * Uses ephemeral in-memory keys and an injectable fetchFn to avoid real HTTP.
 * All key material is generated at module level (not per-test) to avoid
 * concurrent write races.
 *
 * Tests:
 *  1. Rejects when issuer's entity statement fetch fails
 *  2. Resolves a 2-entity chain: leaf directly under TA
 *  3. Resolves a 3-entity chain: leaf → intermediate → TA
 *  4. Rejects when a subordinate statement signature is tampered
 *  5. Rejects when chain depth exceeds maxDepth
 *  6. Rejects when resolved TA does not match expected trustAnchorEntityId
 *  7. resolveFederationStatement constructs the correct /.well-known URL
 *  8. TrustChainResult.chain contains links from leaf to TA
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { generateKeyPair, exportJWK } from "jose";
import { SoftKmsProvider } from "@letsfederate/kms";
import { signEntityStatement } from "../dist/federation/entity-statements.js";
import { signSubordinateStatement } from "../dist/federation/subordinate-statements.js";
import {
  verifyTrustChain,
  resolveFederationStatement,
} from "../dist/federation/chain-verifier.js";

// ---------------------------------------------------------------------------
// Setup: create all key material once at module level
// ---------------------------------------------------------------------------

const TMP = new URL("./.tmp/cv/", import.meta.url).pathname;
await fs.mkdir(TMP, { recursive: true });

async function makeKms(label) {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const pubJwk = { ...(await exportJWK(publicKey)), kty: "EC", crv: "P-256", use: "sig", kid: `${label}-kid` };
  const privJwk = { ...(await exportJWK(privateKey)), kty: "EC", crv: "P-256", use: "sig", kid: `${label}-kid` };
  const pubPath = `${TMP}${label}.pub.jwk`;
  const privPath = `${TMP}${label}.priv.jwk`;
  await fs.writeFile(pubPath, JSON.stringify(pubJwk), "utf8");
  await fs.writeFile(privPath, JSON.stringify(privJwk), "utf8");
  return new SoftKmsProvider({
    privateJwkPath: privPath,
    publicJwkPath: pubPath,
    issuer: `https://${label}.example.org`,
    jwksUrl: `https://${label}.example.org/.well-known/jwks.json`,
  });
}

// 2-entity chain: leaf → TA
const TA2_ID   = "https://ta2.example.org";
const LEAF2_ID = "https://leaf2.example.org";
const ta2   = await makeKms("cv-ta2");
const leaf2 = await makeKms("cv-leaf2");

const taSelf2 = await signEntityStatement(
  { entityId: TA2_ID, authorityHints: [], ttlSeconds: 3600,
    metadata: { federation_entity: {
      organization_name: "TA2",
      federation_fetch_endpoint: `${TA2_ID}/federation_fetch`,
      federation_list_endpoint: `${TA2_ID}/federation_list`,
      federation_trust_mark_status_endpoint: `${TA2_ID}/trust-mark-status`,
    }},
  },
  ta2
);
const leafSelf2 = await signEntityStatement(
  { entityId: LEAF2_ID, authorityHints: [TA2_ID], ttlSeconds: 3600 },
  leaf2
);
const leaf2Jwks = await leaf2.jwks();
const taSub2 = await signSubordinateStatement(
  { issuerEntityId: TA2_ID, subjectEntityId: LEAF2_ID, subjectJwks: leaf2Jwks },
  ta2
);

const urlMap2 = new Map([
  [`${LEAF2_ID}/.well-known/openid-federation`, leafSelf2],
  [`${TA2_ID}/.well-known/openid-federation`, taSelf2],
  [`${TA2_ID}/federation_fetch?sub=${encodeURIComponent(LEAF2_ID)}`, taSub2],
]);

// 3-entity chain: leaf → intermediate → TA
const TA3_ID    = "https://ta3.example.org";
const INTER3_ID = "https://inter3.example.org";
const LEAF3_ID  = "https://leaf3.example.org";
const ta3    = await makeKms("cv-ta3");
const inter3 = await makeKms("cv-inter3");
const leaf3  = await makeKms("cv-leaf3");

const taSelf3 = await signEntityStatement(
  { entityId: TA3_ID, authorityHints: [], ttlSeconds: 3600,
    metadata: { federation_entity: {
      organization_name: "TA3",
      federation_fetch_endpoint: `${TA3_ID}/federation_fetch`,
      federation_list_endpoint: `${TA3_ID}/federation_list`,
      federation_trust_mark_status_endpoint: `${TA3_ID}/trust-mark-status`,
    }},
  },
  ta3
);
const interSelf3 = await signEntityStatement(
  { entityId: INTER3_ID, authorityHints: [TA3_ID], ttlSeconds: 3600,
    metadata: { federation_entity: {
      organization_name: "Inter3",
      federation_fetch_endpoint: `${INTER3_ID}/federation_fetch`,
    }},
  },
  inter3
);
const leafSelf3 = await signEntityStatement(
  { entityId: LEAF3_ID, authorityHints: [INTER3_ID], ttlSeconds: 3600 },
  leaf3
);
const inter3Jwks = await inter3.jwks();
const leaf3Jwks  = await leaf3.jwks();
const taSubInter3 = await signSubordinateStatement(
  { issuerEntityId: TA3_ID, subjectEntityId: INTER3_ID, subjectJwks: inter3Jwks,
    subjectMetadata: { federation_entity: { federation_fetch_endpoint: `${INTER3_ID}/federation_fetch` } },
  },
  ta3
);
const interSubLeaf3 = await signSubordinateStatement(
  { issuerEntityId: INTER3_ID, subjectEntityId: LEAF3_ID, subjectJwks: leaf3Jwks },
  inter3
);

const urlMap3 = new Map([
  [`${LEAF3_ID}/.well-known/openid-federation`, leafSelf3],
  [`${INTER3_ID}/.well-known/openid-federation`, interSelf3],
  [`${TA3_ID}/.well-known/openid-federation`, taSelf3],
  [`${INTER3_ID}/federation_fetch?sub=${encodeURIComponent(LEAF3_ID)}`, interSubLeaf3],
  [`${TA3_ID}/federation_fetch?sub=${encodeURIComponent(INTER3_ID)}`, taSubInter3],
]);

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

function makeMockFetch(urlMap) {
  return async (url) => {
    const body = urlMap.get(url);
    if (body === undefined) {
      return { ok: false, status: 404, text: async () => `Not found: ${url}` };
    }
    return { ok: true, status: 200, text: async () => body };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("rejects when issuer's entity statement fetch fails", async () => {
  const map = new Map(urlMap2); // copy
  map.delete(`${TA2_ID}/.well-known/openid-federation`);
  const result = await verifyTrustChain(LEAF2_ID, TA2_ID, { fetchFn: makeMockFetch(map) });
  assert.equal(result.ok, false);
  assert.ok(result.error, "should have error message");
});

test("resolves a 2-entity chain (leaf directly under TA)", async () => {
  const result = await verifyTrustChain(LEAF2_ID, TA2_ID, { fetchFn: makeMockFetch(urlMap2) });
  assert.equal(result.ok, true, result.error ?? "unexpected failure");
  assert.ok(Array.isArray(result.chain));
  assert.ok(result.chain.length >= 1);
});

test("resolves a 3-entity chain (leaf → intermediate → TA)", async () => {
  const result = await verifyTrustChain(LEAF3_ID, TA3_ID, { fetchFn: makeMockFetch(urlMap3) });
  assert.equal(result.ok, true, result.error ?? "unexpected failure");
  assert.ok(result.chain.length >= 2, `expected >=2 links, got ${result.chain.length}`);
});

test("rejects when a subordinate statement signature is tampered", async () => {
  const map = new Map(urlMap2);
  const tampered = "eyJhbGciOiJFUzI1NiIsInR5cCI6ImVudGl0eS1zdGF0ZW1lbnQrand0In0.eyJpc3MiOiJodHRwczovL3RhLmV4YW1wbGUub3JnIiwic3ViIjoiaHR0cHM6Ly9sZWFmLmV4YW1wbGUub3JnIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjIwMDAwMDAwMDB9.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  map.set(`${TA2_ID}/federation_fetch?sub=${encodeURIComponent(LEAF2_ID)}`, tampered);
  const result = await verifyTrustChain(LEAF2_ID, TA2_ID, { fetchFn: makeMockFetch(map) });
  assert.equal(result.ok, false);
});

test("rejects when chain depth exceeds maxDepth", async () => {
  const result = await verifyTrustChain(LEAF3_ID, TA3_ID, {
    maxDepth: 1,
    fetchFn: makeMockFetch(urlMap3),
  });
  assert.equal(result.ok, false);
  assert.ok(result.error?.includes("depth") || result.error?.includes("max"), result.error);
});

test("rejects when resolved TA does not match expected trustAnchorEntityId", async () => {
  const result = await verifyTrustChain(LEAF2_ID, "https://wrong-ta.example.org", {
    fetchFn: makeMockFetch(urlMap2),
  });
  assert.equal(result.ok, false);
});

test("resolveFederationStatement constructs the correct /.well-known URL", async () => {
  let capturedUrl;
  const mockFetch = async (url) => {
    capturedUrl = url;
    return { ok: false, status: 404, text: async () => "not found" };
  };
  await resolveFederationStatement("https://entity.example.org", mockFetch).catch(() => {});
  assert.equal(capturedUrl, "https://entity.example.org/.well-known/openid-federation");
});

test("TrustChainResult.chain contains links from leaf to TA", async () => {
  const result = await verifyTrustChain(LEAF3_ID, TA3_ID, { fetchFn: makeMockFetch(urlMap3) });
  assert.equal(result.ok, true, result.error ?? "unexpected failure");
  assert.equal(result.chain[0].sub, LEAF3_ID);
  assert.equal(result.chain[result.chain.length - 1].iss, TA3_ID);
});
