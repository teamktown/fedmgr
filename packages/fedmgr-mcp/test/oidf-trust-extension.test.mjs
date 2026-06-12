/**
 * Phase 6.1 — org.letsfederate/oidf-trust extension + handshake admission policy.
 *
 * Verifies the Tier-1 (in-band, advertised-claims) trust gate: accepted-anchor
 * policy (also the seed mechanism for E5a/E5b), advertised-mark check, and
 * container digest binding (E3/E4). Fail-closed throughout. Cryptographic
 * admission is covered by validate-mcp-invocation*.test.mjs (that is the proof;
 * this is the fast gate).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  OIDF_TRUST_EXTENSION_ID,
  buildOidfTrustExtension,
  evaluateOidfTrust,
} from "../dist/oidf-trust-extension.js";
import { buildServerCapabilities } from "../dist/index.js";
import { MCP_TRUST_MARK_ID } from "../dist/openid-ops.js";

const ANCHOR = "https://trust.letsfederate.org";
const ENTITY = "https://trust.letsfederate.org/mcp/fedmgr-mcp";
// Use the real advertised mark so the patient-zero test matches what the server emits.
const MARK = MCP_TRUST_MARK_ID;

test("extension id is the vendor-prefixed identifier", () => {
  assert.equal(OIDF_TRUST_EXTENSION_ID, "org.letsfederate/oidf-trust");
});

test("buildOidfTrustExtension fills a default federationConfigUrl", () => {
  const ext = buildOidfTrustExtension({ entityId: ENTITY, trustAnchor: ANCHOR, trustMarks: [MARK] });
  assert.equal(ext.entityId, ENTITY);
  assert.equal(ext.trustAnchor, ANCHOR);
  assert.equal(ext.federationConfigUrl, `${ENTITY}/.well-known/openid-federation`);
  assert.deepEqual(ext.trustMarks, [MARK]);
});

test("admits when the trust anchor is accepted and the required mark is advertised", () => {
  const ext = buildOidfTrustExtension({ entityId: ENTITY, trustAnchor: ANCHOR, trustMarks: [MARK] });
  const d = evaluateOidfTrust(ext, { acceptedAnchors: [ANCHOR], requiredTrustMark: MARK });
  assert.equal(d.admit, true);
  assert.equal(d.checks.anchorAccepted, true);
  assert.equal(d.checks.requiredTrustMarkAdvertised, true);
});

test("E5: DENIES when the trust anchor is NOT in the accepted-anchor list", () => {
  const ext = buildOidfTrustExtension({ entityId: ENTITY, trustAnchor: ANCHOR, trustMarks: [MARK] });
  const d = evaluateOidfTrust(ext, { acceptedAnchors: ["https://other.example.org"] });
  assert.equal(d.admit, false);
  assert.equal(d.checks.anchorAccepted, false);
  assert.match(d.reasons.join(" "), /not in the accepted-anchor list/);
});

test("DENIES when the required trust mark is not advertised", () => {
  const ext = buildOidfTrustExtension({ entityId: ENTITY, trustAnchor: ANCHOR, trustMarks: [] });
  const d = evaluateOidfTrust(ext, { acceptedAnchors: [ANCHOR], requiredTrustMark: MARK });
  assert.equal(d.admit, false);
  assert.equal(d.checks.requiredTrustMarkAdvertised, false);
});

test("E3/E4: image digest binding — matches admits, mismatch denies", () => {
  const digest = "sha256:" + "a".repeat(64);
  const ext = buildOidfTrustExtension({ entityId: ENTITY, trustAnchor: ANCHOR, trustMarks: [MARK], imageDigest: digest });
  assert.equal(
    evaluateOidfTrust(ext, { acceptedAnchors: [ANCHOR], expectedImageDigest: digest }).admit,
    true
  );
  const bad = evaluateOidfTrust(ext, { acceptedAnchors: [ANCHOR], expectedImageDigest: "sha256:" + "b".repeat(64) });
  assert.equal(bad.admit, false);
  assert.equal(bad.checks.imageDigestBound, false);
});

test("patient zero: fedmgr-mcp advertises the extension and a matching policy admits it", () => {
  const caps = buildServerCapabilities();
  const ext = caps.extensions[OIDF_TRUST_EXTENSION_ID];
  assert.ok(ext, "fedmgr-mcp must advertise the oidf-trust extension at initialize");
  assert.equal(ext.trustAnchor, ANCHOR);
  assert.match(ext.entityId, /^https:\/\/trust\.letsfederate\.org\/mcp\//);
  assert.deepEqual(ext.trustMarks, [MARK]);
  // A client that accepts our anchor and requires our mark admits us.
  const d = evaluateOidfTrust(ext, { acceptedAnchors: [ANCHOR], requiredTrustMark: MARK });
  assert.equal(d.admit, true);
});

test("fail-closed on malformed or missing extension", () => {
  for (const bad of [undefined, null, {}, { entityId: "not-a-url", trustAnchor: ANCHOR, trustMarks: [] }, { entityId: ENTITY, trustAnchor: "http://insecure", trustMarks: [] }]) {
    const d = evaluateOidfTrust(bad, { acceptedAnchors: [ANCHOR] });
    assert.equal(d.admit, false, `expected deny for ${JSON.stringify(bad)}`);
    assert.equal(d.checks.wellFormed, false);
  }
});
