/**
 * §10 trust-chain verification — the finding #2 (critical) fix.
 *
 * These tests encode OpenID Federation §10 binding rules against a real
 * (hermetic) federation. They are RED until src/verify.ts implements them.
 * Named red tests from the deep re-assessment: forged chain, key-substitution,
 * expired statement, revoked→INVALID (jku-forgery lives in trustmark.test.mjs).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { verifyTrustChain } from "../dist/index.js";
import {
  makeEntity,
  entityConfig,
  subordinateStatement,
  federation,
  pin,
} from "./harness.mjs";

const past = (s) => Math.floor(Date.now() / 1000) - s;

/** Build the canonical valid federation: leaf → TA (direct subordinate). */
async function validLeafToTA() {
  const ta = await makeEntity("https://ta.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(ta, leaf));
  return { ta, leaf, fed };
}

test("happy path: leaf directly under a pinned TA verifies VALID with correct depth/path", async () => {
  const { ta, leaf, fed } = await validLeafToTA();
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "VALID", r.message);
  assert.equal(r.trustAnchor, ta.entityId);
  assert.equal(r.chainDepth, 1);
  assert.deepEqual(r.path, [leaf.entityId, ta.entityId]);
});

test("RED: key-substitution — leaf EC key not in the superior's subordinate-statement jwks → INVALID", async () => {
  // The core §10 binding. Leaf signs its EC with its real key, but the TA's
  // subordinate statement vouches for a DIFFERENT key (attacker's). A verifier
  // that skips the binding (the old walker) would pass this; we must fail it.
  const ta = await makeEntity("https://ta.example");
  const leaf = await makeEntity("https://mcp.example");
  const attacker = await makeEntity("https://mcp.example"); // different keypair, same id
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  // Subordinate statement lists the ATTACKER's jwks, not the leaf's real one.
  fed.setSubordinate(
    ta.entityId,
    leaf.entityId,
    await subordinateStatement(ta, leaf, { subjectJwksOverride: attacker.jwks })
  );
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID", "leaf key not vouched by superior must fail");
  assert.match(r.message, /bind|key/i);
});

test("RED: forged chain — leaf chains only to a NON-pinned anchor → INVALID", async () => {
  const realTa = await makeEntity("https://real-ta.example");
  const rogueTa = await makeEntity("https://rogue-ta.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(rogueTa.entityId, await entityConfig(rogueTa, { authorityHints: [] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [rogueTa.entityId] }));
  fed.setSubordinate(rogueTa.entityId, leaf.entityId, await subordinateStatement(rogueTa, leaf));
  // Only the real TA is pinned; the rogue anchor is unknown.
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(realTa)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID", "must not terminate at an unpinned anchor");
});

test("forged chain: subordinate statement signed by an impostor (not the pinned TA's key) → INVALID", async () => {
  const ta = await makeEntity("https://ta.example");
  const impostor = await makeEntity("https://ta.example"); // same id, wrong key
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  // Statement about leaf is signed by the impostor's key, not the pinned TA key.
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(impostor, leaf));
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
});

test("RED: expired subordinate statement → INVALID", async () => {
  const ta = await makeEntity("https://ta.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  fed.setSubordinate(
    ta.entityId,
    leaf.entityId,
    await subordinateStatement(ta, leaf, { iat: past(7200), exp: past(3600) })
  );
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
  assert.match(r.message, /expir/i);
});

test("expired leaf entity configuration → INVALID", async () => {
  const ta = await makeEntity("https://ta.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(
    leaf.entityId,
    await entityConfig(leaf, { authorityHints: [ta.entityId], iat: past(7200), exp: past(3600) })
  );
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(ta, leaf));
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
});

test("unpinned anchor: a leaf under a self-asserted TA that is NOT pinned → INVALID (no TOFU)", async () => {
  // Even though the chain is internally consistent, the anchor key was never
  // pinned out-of-band, so trust cannot be established. Finding #2.
  const ta = await makeEntity("https://ta.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(ta, leaf));
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
});

test("tampered leaf EC self-signature → INVALID", async () => {
  const { ta, leaf, fed } = await validLeafToTA();
  // Corrupt the leaf EC signature segment.
  const good = await entityConfig(leaf, { authorityHints: [ta.entityId] });
  const parts = good.split(".");
  parts[2] = parts[2].slice(0, -4) + "AAAA";
  fed.setConfig(leaf.entityId, parts.join("."));
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
});

test("wrong typ on subordinate statement → INVALID (spec: verifiers MUST reject)", async () => {
  const ta = await makeEntity("https://ta.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(ta, leaf, { typ: "JWT" }));
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
});

test("subordinate statement about the WRONG subject → INVALID", async () => {
  const ta = await makeEntity("https://ta.example");
  const leaf = await makeEntity("https://mcp.example");
  const other = await makeEntity("https://other.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  // TA serves, for sub=leaf, a statement whose payload sub is `other`.
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(ta, other));
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
});

test("multi-hop: leaf → intermediate → TA, binding at every hop → VALID depth 2", async () => {
  const ta = await makeEntity("https://ta.example");
  const inter = await makeEntity("https://intermediate.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(inter.entityId, await entityConfig(inter, { authorityHints: [ta.entityId] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [inter.entityId] }));
  fed.setSubordinate(ta.entityId, inter.entityId, await subordinateStatement(ta, inter));
  fed.setSubordinate(inter.entityId, leaf.entityId, await subordinateStatement(inter, leaf));
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "VALID", r.message);
  assert.equal(r.chainDepth, 2);
  assert.deepEqual(r.path, [leaf.entityId, inter.entityId, ta.entityId]);
});

test("follows ALL authority_hints: dead-end hint first, valid hint second → VALID", async () => {
  // Finding: the old walker followed only authority_hints[0]. A dead end must
  // not abort the search when another hint reaches the pinned anchor.
  const ta = await makeEntity("https://ta.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, {
    authorityHints: ["https://dead-end.example", ta.entityId],
  }));
  // dead-end.example has no EC and no subordinate statement (fetch 404s).
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(ta, leaf));
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "VALID", r.message);
});

test("RED: revoked subordinate (federation_fetch 403) → INVALID", async () => {
  const { ta, leaf, fed } = await validLeafToTA();
  fed.revoke(ta.entityId, leaf.entityId); // TA now 403s this sub
  const r = await verifyTrustChain(leaf.entityId, { trustAnchors: [pin(ta)], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
  assert.match(r.message, /revok|403|not found/i);
});

test("cycle in authority_hints does not hang; bounded by maxDepth → INVALID", async () => {
  const a = await makeEntity("https://a.example");
  const b = await makeEntity("https://b.example");
  const ta = await makeEntity("https://ta.example");
  const fed = federation();
  fed.setConfig(a.entityId, await entityConfig(a, { authorityHints: [b.entityId] }));
  fed.setConfig(b.entityId, await entityConfig(b, { authorityHints: [a.entityId] }));
  fed.setSubordinate(b.entityId, a.entityId, await subordinateStatement(b, a));
  fed.setSubordinate(a.entityId, b.entityId, await subordinateStatement(a, b));
  const r = await verifyTrustChain(a.entityId, {
    trustAnchors: [pin(ta)],
    fetchFn: fed.fetchFn,
    maxDepth: 5,
  });
  assert.equal(r.state, "INVALID");
});
