/**
 * ssc-attest — the binding + gate logic that makes the zero-HIGH/CRITICAL SLA
 * real. Real ES256 signing (no mocked crypto).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT, calculateJwkThumbprint } from "jose";
import {
  buildSscStatement,
  verifySscStatement,
  signSscStatementJws,
  verifySscStatementJws,
  SSC_PREDICATE_TYPE,
  SSC_JWT_TYP,
} from "../dist/index.js";

const DIGEST = "sha256:" + "a".repeat(64);
const SBOM = "sha256:" + "b".repeat(64);

async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const pub = await exportJWK(publicKey);
  pub.alg = "ES256";
  pub.kid = await calculateJwkThumbprint(pub);
  const signJwt = (payload, header = {}) =>
    new SignJWT(payload).setProtectedHeader({ alg: "ES256", kid: pub.kid, ...header }).sign(privateKey);
  return { publicJwks: { keys: [pub] }, signJwt };
}

test("build computes gate.passed from the scan (clean → passed)", () => {
  const s = buildSscStatement({ artifactDigest: DIGEST, sbomDigest: SBOM, scan: { critical: 0, high: 0, medium: 3, low: 9 } });
  assert.equal(s.predicateType, SSC_PREDICATE_TYPE);
  assert.equal(s.predicate.gate.passed, true);
  assert.equal(s.subject[0].digest.sha256, "a".repeat(64));
  assert.equal(s.predicate.sbom.digest.sha256, "b".repeat(64));
});

test("build computes gate.passed=false when HIGH/CRITICAL present", () => {
  const s = buildSscStatement({ artifactDigest: DIGEST, scan: { critical: 0, high: 2 } });
  assert.equal(s.predicate.gate.passed, false);
});

test("verify: clean statement with matching digest → ok", () => {
  const s = buildSscStatement({ artifactDigest: DIGEST, scan: { critical: 0, high: 0 } });
  const v = verifySscStatement(s, { expectedArtifactDigest: DIGEST });
  assert.equal(v.ok, true, v.reasons.join("; "));
  assert.equal(v.passed, true);
  assert.equal(v.artifactDigest, DIGEST);
});

test("verify: digest mismatch → rejected", () => {
  const s = buildSscStatement({ artifactDigest: DIGEST, scan: { critical: 0, high: 0 } });
  const v = verifySscStatement(s, { expectedArtifactDigest: "sha256:" + "c".repeat(64) });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(" "), /digest mismatch/);
});

test("verify: blocked gate → rejected under requirePass", () => {
  const s = buildSscStatement({ artifactDigest: DIGEST, scan: { critical: 1, high: 4 } });
  const v = verifySscStatement(s, { expectedArtifactDigest: DIGEST });
  assert.equal(v.ok, false);
  assert.equal(v.passed, false);
  assert.match(v.reasons.join(" "), /did not pass/);
});

test("verify: FORGED gate.passed over dirty counts → rejected (tally authoritative)", () => {
  const s = buildSscStatement({ artifactDigest: DIGEST, scan: { critical: 0, high: 0 } });
  s.predicate.scan.high = 5; // tamper the counts after the fact
  const v = verifySscStatement(s, { expectedArtifactDigest: DIGEST });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(" "), /tally is authoritative|did not pass/);
});

test("JWS round-trip: sign then verify against the signer keys → ok", async () => {
  const { publicJwks, signJwt } = await signer();
  const s = buildSscStatement({ artifactDigest: DIGEST, sbomDigest: SBOM, scan: { critical: 0, high: 0 }, issuedAt: "2026-07-06T00:00:00Z" });
  const jws = await signSscStatementJws(s, signJwt);
  const v = await verifySscStatementJws(jws, { publicJwks, expectedArtifactDigest: DIGEST });
  assert.equal(v.ok, true, v.reasons.join("; "));
  assert.equal(v.sbomDigest, SBOM);
});

test("JWS: wrong signer key → signature rejected", async () => {
  const { signJwt } = await signer();
  const other = await signer();
  const s = buildSscStatement({ artifactDigest: DIGEST, scan: { critical: 0, high: 0 } });
  const jws = await signSscStatementJws(s, signJwt);
  const v = await verifySscStatementJws(jws, { publicJwks: other.publicJwks, expectedArtifactDigest: DIGEST });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(" "), /signature/i);
});

test("JWS: no pinned keys → rejected (fail-closed)", async () => {
  const { signJwt } = await signer();
  const s = buildSscStatement({ artifactDigest: DIGEST, scan: { critical: 0, high: 0 } });
  const jws = await signSscStatementJws(s, signJwt);
  const v = await verifySscStatementJws(jws, { publicJwks: { keys: [] }, expectedArtifactDigest: DIGEST });
  assert.equal(v.ok, false);
});

test("JWS carries the SSC typ header", async () => {
  const { signJwt } = await signer();
  const s = buildSscStatement({ artifactDigest: DIGEST, scan: { critical: 0, high: 0 } });
  const jws = await signSscStatementJws(s, signJwt);
  const header = JSON.parse(Buffer.from(jws.split(".")[0], "base64url").toString());
  assert.equal(header.typ, SSC_JWT_TYP);
});
