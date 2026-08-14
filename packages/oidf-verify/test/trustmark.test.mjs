/**
 * Trust-mark verification — the finding #1 (critical), #3 & #4 (high) fixes.
 *
 * A trust mark is trusted only when its ISSUER resolves through a verified §10
 * chain to a pinned anchor, the mark is signed by the issuer's chain-resolved
 * federation keys (NEVER the presenter-supplied `jku`), and the anchor's
 * `trust_mark_issuers` authorizes the (trust_mark_type, issuer) pair.
 * RED until src/verify.ts implements verifyTrustMark.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { verifyTrustMark } from "../dist/index.js";
import {
  makeEntity,
  entityConfig,
  subordinateStatement,
  trustMark,
  federation,
  pin,
} from "./harness.mjs";

const MARK_TYPE = "https://letsfederate.org/tm/mcp-verified";
const past = (s) => Math.floor(Date.now() / 1000) - s;

/** TA + a TMI enrolled under it, authorized for MARK_TYPE. */
async function taWithTmi() {
  const ta = await makeEntity("https://ta.example");
  const tmi = await makeEntity("https://tmi.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(tmi.entityId, await entityConfig(tmi, { authorityHints: [ta.entityId] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  fed.setSubordinate(ta.entityId, tmi.entityId, await subordinateStatement(ta, tmi));
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(ta, leaf));
  const anchor = pin(ta, { [MARK_TYPE]: [tmi.entityId] });
  return { ta, tmi, leaf, fed, anchor };
}

test("valid: mark whose issuer chains to the anchor and is authorized → VALID", async () => {
  const { tmi, leaf, fed, anchor } = await taWithTmi();
  const mark = await trustMark(tmi, leaf.entityId, { trustMarkType: MARK_TYPE });
  const r = await verifyTrustMark(mark, { trustAnchors: [anchor], fetchFn: fed.fetchFn });
  assert.equal(r.state, "VALID", r.message);
  assert.equal(r.issuer, tmi.entityId);
  assert.equal(r.subject, leaf.entityId);
  assert.equal(r.trustMarkType, MARK_TYPE);
});

test("RED: jku forgery — self-signed mark with an attacker jku → INVALID", async () => {
  // The finding #1 critical. An attacker signs a mark with their OWN key, hosts
  // a matching JWKS, and sets jku. The mark's signature would verify against
  // that jku, but the issuer has no chain to the pinned anchor, so it must fail
  // — and the verifier must never consult jku in the first place.
  const { fed, anchor } = await taWithTmi();
  const attacker = await makeEntity("https://evil.example");
  const attackerJwksUrl = "https://evil.example/jwks.json";
  fed.setJwksUrl(attackerJwksUrl, attacker.jwks);
  const forged = await trustMark(attacker, "https://mcp.example", {
    trustMarkType: MARK_TYPE,
    header: { jku: attackerJwksUrl },
  });
  const r = await verifyTrustMark(forged, { trustAnchors: [anchor], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID", "a mark from an unchained issuer must be rejected");
});

test("issuer chains to anchor but is NOT authorized for the type → INVALID (finding #4)", async () => {
  const { ta, tmi, leaf, fed } = await taWithTmi();
  // Pin the anchor WITHOUT authorizing tmi for MARK_TYPE.
  const anchor = pin(ta, { [MARK_TYPE]: ["https://someone-else.example"] });
  const mark = await trustMark(tmi, leaf.entityId, { trustMarkType: MARK_TYPE });
  const r = await verifyTrustMark(mark, { trustAnchors: [anchor], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
  assert.match(r.message, /authoriz|trust_mark_issuers/i);
});

test("mark signed by a key the issuer's chain never vouched for → INVALID", async () => {
  const { tmi, leaf, fed, anchor } = await taWithTmi();
  const impostor = await makeEntity("https://tmi.example"); // same id, different key
  const mark = await trustMark(impostor, leaf.entityId, { trustMarkType: MARK_TYPE });
  const r = await verifyTrustMark(mark, { trustAnchors: [anchor], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
});

test("expired trust mark → INVALID", async () => {
  const { tmi, leaf, fed, anchor } = await taWithTmi();
  const mark = await trustMark(tmi, leaf.entityId, {
    trustMarkType: MARK_TYPE,
    iat: past(7200),
    exp: past(3600),
  });
  const r = await verifyTrustMark(mark, { trustAnchors: [anchor], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
  assert.match(r.message, /expir/i);
});

test("wrong typ (not trust-mark+jwt) → INVALID (finding #3)", async () => {
  const { tmi, leaf, fed, anchor } = await taWithTmi();
  const mark = await trustMark(tmi, leaf.entityId, { trustMarkType: MARK_TYPE, typ: "JWT" });
  const r = await verifyTrustMark(mark, { trustAnchors: [anchor], fetchFn: fed.fetchFn });
  assert.equal(r.state, "INVALID");
});

test("legacy `id` claim accepted on read (migration), surfaced as trustMarkType", async () => {
  // Finding #3: emit trust_mark_type going forward, but keep reading the old
  // `id` claim so existing marks still verify during migration.
  const { tmi, leaf, fed, anchor } = await taWithTmi();
  const mark = await trustMark(tmi, leaf.entityId, { legacyId: MARK_TYPE }); // no trust_mark_type
  const r = await verifyTrustMark(mark, { trustAnchors: [anchor], fetchFn: fed.fetchFn });
  assert.equal(r.state, "VALID", r.message);
  assert.equal(r.trustMarkType, MARK_TYPE);
  assert.equal(r.legacyClaim, true);
});

test("relying-party requiredTypes policy: type not required → INVALID", async () => {
  const { tmi, leaf, fed, anchor } = await taWithTmi();
  const mark = await trustMark(tmi, leaf.entityId, { trustMarkType: MARK_TYPE });
  const r = await verifyTrustMark(mark, {
    trustAnchors: [anchor],
    fetchFn: fed.fetchFn,
    requiredTypes: ["https://letsfederate.org/tm/something-else"],
  });
  assert.equal(r.state, "INVALID");
  assert.match(r.message, /requir/i);
});

test("anchor's own EC can supply trust_mark_issuers when not pinned in the descriptor", async () => {
  // trust_mark_issuers is a top-level claim in the TA entity configuration; if
  // the pinned descriptor doesn't carry it, read it from the verified anchor EC.
  const ta = await makeEntity("https://ta.example");
  const tmi = await makeEntity("https://tmi.example");
  const leaf = await makeEntity("https://mcp.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, {
    authorityHints: [],
    trustMarkIssuers: { [MARK_TYPE]: [tmi.entityId] },
  }));
  fed.setConfig(tmi.entityId, await entityConfig(tmi, { authorityHints: [ta.entityId] }));
  fed.setConfig(leaf.entityId, await entityConfig(leaf, { authorityHints: [ta.entityId] }));
  fed.setSubordinate(ta.entityId, tmi.entityId, await subordinateStatement(ta, tmi));
  fed.setSubordinate(ta.entityId, leaf.entityId, await subordinateStatement(ta, leaf));
  const mark = await trustMark(tmi, leaf.entityId, { trustMarkType: MARK_TYPE });
  const r = await verifyTrustMark(mark, {
    trustAnchors: [pin(ta)], // no trustMarkIssuers pinned; must read from EC
    fetchFn: fed.fetchFn,
  });
  assert.equal(r.state, "VALID", r.message);
});
