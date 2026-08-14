/**
 * oci verify-trustmark helpers — the supply-chain fix. A cosign signature that
 * "accepts any signer" is theater; and a verified signature that isn't bound to
 * the image digest proves nothing about THIS artifact.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPinnedSigner,
  extractTrustmarkJws,
  digestFromImageRef,
  verifyEmbeddedTrustmark,
} from "../dist/oci-verify.js";
import {
  makeEntity, entityConfig, subordinateStatement, trustMark, federation, pin,
} from "../../oidf-verify/test/harness.mjs";

const MARK = "https://letsfederate.org/tm/mcp-verified";
const DIGEST = "sha256:" + "a".repeat(64);

test("assertPinnedSigner REJECTS wildcard / empty identities", () => {
  for (const id of [".+", ".*", "*", "", undefined]) {
    assert.throws(() => assertPinnedSigner(id, "https://accounts.google.com"), /certificate-identity/);
  }
  for (const iss of [".+", ".*", "", undefined]) {
    assert.throws(() => assertPinnedSigner("ci@letsfederate.org", iss), /oidc-issuer/);
  }
});

test("assertPinnedSigner ACCEPTS a specific identity + issuer", () => {
  assert.doesNotThrow(() =>
    assertPinnedSigner("https://github.com/teamktown/fedmgr/.github/workflows/release.yml@refs/tags/v1", "https://token.actions.githubusercontent.com")
  );
});

test("extractTrustmarkJws finds the JWS in common predicate shapes", () => {
  assert.equal(extractTrustmarkJws({ trustmark_jws: "a.b.c" }), "a.b.c");
  assert.equal(extractTrustmarkJws({ jws: "a.b.c" }), "a.b.c");
  assert.equal(extractTrustmarkJws({ predicate: { trustmark_jws: "a.b.c" } }), "a.b.c");
  assert.equal(extractTrustmarkJws("a.b.c"), "a.b.c");
  assert.equal(extractTrustmarkJws({ nope: 1 }), undefined);
});

test("digestFromImageRef parses digest refs, ignores tags", () => {
  assert.equal(digestFromImageRef(`repo/app@${DIGEST}`), DIGEST);
  assert.equal(digestFromImageRef(DIGEST), DIGEST);
  assert.equal(digestFromImageRef("repo/app:latest"), undefined);
});

async function fixture() {
  const ta = await makeEntity("https://ta.example");
  const tmi = await makeEntity("https://tmi.example");
  const fed = federation();
  fed.setConfig(ta.entityId, await entityConfig(ta, { authorityHints: [] }));
  fed.setConfig(tmi.entityId, await entityConfig(tmi, { authorityHints: [ta.entityId] }));
  fed.setSubordinate(ta.entityId, tmi.entityId, await subordinateStatement(ta, tmi));
  const anchor = pin(ta, { [MARK]: [tmi.entityId] });
  return { ta, tmi, fed, anchor };
}

test("verifyEmbeddedTrustmark: chain-rooted mark bound to the right digest → ok", async () => {
  const { tmi, fed, anchor } = await fixture();
  const mark = await trustMark(tmi, "https://mcp.example", { trustMarkType: MARK, extra: { image_digest: DIGEST } });
  const r = await verifyEmbeddedTrustmark({
    predicate: { trustmark_jws: mark }, trustAnchors: [anchor], expectedDigest: DIGEST, fetchFn: fed.fetchFn,
  });
  assert.equal(r.ok, true, r.reasons.join("; "));
  assert.equal(r.trustMarkType, MARK);
});

test("verifyEmbeddedTrustmark: digest MISMATCH → rejected even if the mark is valid", async () => {
  const { tmi, fed, anchor } = await fixture();
  const mark = await trustMark(tmi, "https://mcp.example", { trustMarkType: MARK, extra: { image_digest: DIGEST } });
  const r = await verifyEmbeddedTrustmark({
    predicate: { trustmark_jws: mark }, trustAnchors: [anchor],
    expectedDigest: "sha256:" + "b".repeat(64), fetchFn: fed.fetchFn,
  });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /image_digest mismatch/);
});

test("verifyEmbeddedTrustmark: forged issuer (not chained) → rejected", async () => {
  const { fed, anchor } = await fixture();
  const attacker = await makeEntity("https://evil.example");
  const forged = await trustMark(attacker, "https://mcp.example", {
    trustMarkType: MARK, extra: { image_digest: DIGEST }, header: { jku: "https://evil.example/jwks.json" },
  });
  const r = await verifyEmbeddedTrustmark({
    predicate: { trustmark_jws: forged }, trustAnchors: [anchor], expectedDigest: DIGEST, fetchFn: fed.fetchFn,
  });
  assert.equal(r.ok, false);
});

test("verifyEmbeddedTrustmark: no JWS in predicate → rejected", async () => {
  const { anchor } = await fixture();
  const r = await verifyEmbeddedTrustmark({ predicate: { unrelated: true }, trustAnchors: [anchor] });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /no trustmark JWS/);
});
