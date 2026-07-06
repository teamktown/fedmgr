/**
 * TMI SSC gate decision — the zero-HIGH/CRITICAL SLA enforced in code. An
 * artifact-bound trustmark (image_digest) is only issued with signed SSC
 * evidence that passed the gate for THIS digest. Tests the exact decision
 * function the issuance handler runs (index.ts self-starts a server on import,
 * so the logic is factored into ssc-gate.ts for testability).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT, calculateJwkThumbprint } from "jose";
import { buildSscStatement, signSscStatementJws } from "@letsfederate/ssc-attest";
import { evaluateSscGate } from "../dist/ssc-gate.js";

const DIGEST = "sha256:" + "a".repeat(64);
const OTHER = "sha256:" + "c".repeat(64);

async function sscSigner() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const pub = await exportJWK(publicKey);
  pub.alg = "ES256";
  pub.kid = await calculateJwkThumbprint(pub);
  const signJwt = (payload, header = {}) =>
    new SignJWT(payload).setProtectedHeader({ alg: "ES256", kid: pub.kid, ...header }).sign(privateKey);
  return { publicJwks: { keys: [pub] }, signJwt };
}

async function evidence(signer, { digest = DIGEST, scan = { critical: 0, high: 0 } } = {}) {
  return signSscStatementJws(
    buildSscStatement({ artifactDigest: digest, scan, sbomDigest: "sha256:" + "b".repeat(64) }),
    signer.signJwt
  );
}

test("identity mark (no image_digest) bypasses the gate → allow", async () => {
  const s = await sscSigner();
  const d = await evaluateSscGate({ require: true, signerJwks: s.publicJwks });
  assert.equal(d.allow, true);
});

test("demo TMI (require=false) bypasses the gate → allow", async () => {
  const d = await evaluateSscGate({ imageDigest: DIGEST, require: false, signerJwks: null });
  assert.equal(d.allow, true);
});

test("artifact mark with NO signer keys configured → 503 refuse", async () => {
  const d = await evaluateSscGate({ imageDigest: DIGEST, require: true, signerJwks: null });
  assert.equal(d.allow, false);
  assert.equal(d.status, 503);
  assert.equal(d.error, "ssc_signer_unconfigured");
});

test("artifact mark with NO evidence → 403 refuse", async () => {
  const s = await sscSigner();
  const d = await evaluateSscGate({ imageDigest: DIGEST, require: true, signerJwks: s.publicJwks });
  assert.equal(d.allow, false);
  assert.equal(d.status, 403);
  assert.equal(d.error, "ssc_evidence_required");
});

test("passing evidence for the right digest → allow", async () => {
  const s = await sscSigner();
  const d = await evaluateSscGate({
    imageDigest: DIGEST, sscEvidence: await evidence(s), require: true, signerJwks: s.publicJwks,
  });
  assert.equal(d.allow, true, JSON.stringify(d));
});

test("BLOCKED evidence (HIGH/CRITICAL) → 403 refuse with reasons", async () => {
  const s = await sscSigner();
  const blocked = await evidence(s, { scan: { critical: 1, high: 3 } });
  const d = await evaluateSscGate({ imageDigest: DIGEST, sscEvidence: blocked, require: true, signerJwks: s.publicJwks });
  assert.equal(d.allow, false);
  assert.equal(d.status, 403);
  assert.equal(d.error, "ssc_gate_blocked");
  assert.ok(d.reasons.some((r) => /did not pass/.test(r)));
});

test("evidence for a DIFFERENT digest → 403 refuse", async () => {
  const s = await sscSigner();
  const forWrongImage = await evidence(s, { digest: OTHER });
  const d = await evaluateSscGate({ imageDigest: DIGEST, sscEvidence: forWrongImage, require: true, signerJwks: s.publicJwks });
  assert.equal(d.allow, false);
  assert.ok(d.reasons.some((r) => /digest mismatch/.test(r)));
});

test("evidence signed by an UNPINNED signer → 403 refuse", async () => {
  const s = await sscSigner();
  const attacker = await sscSigner();
  const forged = await evidence(attacker); // valid statement, wrong signer
  const d = await evaluateSscGate({ imageDigest: DIGEST, sscEvidence: forged, require: true, signerJwks: s.publicJwks });
  assert.equal(d.allow, false);
});
