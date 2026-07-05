/**
 * The MCP-facing trust tools (verify_trustmark, check_trust_chain) must route
 * through the shared §10 verifier — NOT the old jku-rooted engine. These tests
 * drive the real handlers over a hermetic federation and confirm a forged
 * jku mark is rejected and a properly-chained one is accepted.
 *
 * The handlers use global fetch, so we install a federation-backed fetch for the
 * duration of each test (restored after) — real ES256 crypto, no mocked verifier.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { __testHandlers } from "../dist/index.js";
import {
  makeEntity,
  entityConfig,
  subordinateStatement,
  trustMark,
  federation,
} from "../../oidf-verify/test/harness.mjs";

const { toolVerifyTrustmark, toolCheckTrustChain } = __testHandlers;
const MARK = "https://letsfederate.org/tm/mcp-verified";

async function withFederation(fed, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = (url) => fed.fetchFn(url);
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

async function labFederation() {
  // Anchor entity id == its reachable URL (lab convention). Use a non-loopback
  // host so the SSRF guard at the tool boundary does not reject it.
  const ta = await makeEntity("https://ta.lab.example");
  const tmi = await makeEntity("https://tmi.lab.example");
  const leaf = await makeEntity("https://mcp.lab.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [], trustMarkIssuers: { [MARK]: [tmi.entityId] } }));
  fed.setConfig(tmi.entityId, await entityConfig(tmi, { authorityHints: [ta.entityId] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  fed.setSubordinate(ta.entityId, tmi.entityId, await subordinateStatement(ta, tmi));
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(ta, leaf));
  return { ta, tmi, leaf, fed };
}

test("verify_trustmark ACCEPTS a chain-rooted, authorized mark", async () => {
  const { ta, tmi, leaf, fed } = await labFederation();
  const mark = await trustMark(tmi, leaf.entityId, { trustMarkType: MARK });
  const out = await withFederation(fed, () =>
    toolVerifyTrustmark({ jws: mark, trust_anchor_url: ta.entityId, trust_anchor_jwks: ta.jwks })
  );
  assert.match(out, /TRUST:VALID/);
  assert.match(out, /"state": "VALID"/);
});

test("verify_trustmark REJECTS a forged jku mark (issuer not chained/authorized)", async () => {
  const { ta, leaf, fed } = await labFederation();
  const attacker = await makeEntity("https://evil.example");
  // Attacker self-signs and points jku at their own JWKS — the old engine would
  // have verified this; the §10 engine must reject it.
  fed.setJwksUrl("https://evil.example/jwks.json", attacker.jwks);
  const forged = await trustMark(attacker, leaf.entityId, {
    trustMarkType: MARK,
    header: { jku: "https://evil.example/jwks.json" },
  });
  const out = await withFederation(fed, () =>
    toolVerifyTrustmark({ jws: forged, trust_anchor_url: ta.entityId, trust_anchor_jwks: ta.jwks })
  );
  assert.match(out, /TRUST:FAIL/);
  assert.match(out, /"state": "INVALID"/);
});

test("check_trust_chain ACCEPTS an enrolled leaf, REJECTS an unvouched one", async () => {
  const { ta, leaf, fed } = await labFederation();
  const good = await withFederation(fed, () =>
    toolCheckTrustChain({ subject_url: leaf.entityId, trust_anchor_url: ta.entityId, trust_anchor_jwks: ta.jwks })
  );
  assert.match(good, /"state": "VALID"/);

  // A leaf that self-asserts but the TA never vouched for (no subordinate stmt).
  const rogue = await makeEntity("https://rogue.lab.example");
  fed.setConfig(rogue.entityId, await entityConfig(rogue, { authorityHints: [ta.entityId] }));
  const bad = await withFederation(fed, () =>
    toolCheckTrustChain({ subject_url: rogue.entityId, trust_anchor_url: ta.entityId, trust_anchor_jwks: ta.jwks })
  );
  assert.match(bad, /"state": "INVALID"/);
});
