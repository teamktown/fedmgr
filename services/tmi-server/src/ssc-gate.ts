/**
 * The Trust Mark Issuer's supply-chain gate decision, factored out of the HTTP
 * handler so it is directly testable (index.ts self-starts a server on import).
 *
 * Rule: a trust mark that carries an image_digest ATTESTS that image passed the
 * zero-HIGH/CRITICAL SLA, so the TMI refuses to sign one without signed SSC
 * evidence that (a) is signed by a pinned SSC signer, (b) is for THIS digest,
 * and (c) passed the gate. Marks without image_digest (identity marks) are
 * unaffected. Fail-closed.
 */
import { verifySscStatementJws } from "@letsfederate/ssc-attest";
import type { JWK } from "jose";

export interface SscGateDecision {
  allow: boolean;
  /** HTTP status to send when !allow. */
  status?: number;
  error?: string;
  message?: string;
  reasons?: string[];
}

export async function evaluateSscGate(opts: {
  imageDigest?: string;
  sscEvidence?: string;
  require: boolean;
  signerJwks: { keys: JWK[] } | null;
}): Promise<SscGateDecision> {
  // Identity marks (no artifact) and demo TMIs (require=false) bypass the gate.
  if (!opts.imageDigest || !opts.require) return { allow: true };

  if (!opts.signerJwks) {
    return {
      allow: false,
      status: 503,
      error: "ssc_signer_unconfigured",
      message:
        "[TRUST:FAIL] this TMI cannot issue artifact-bound trustmarks: TMI_SSC_SIGNER_JWKS is not set. " +
        "Pin the SSC signer keys, or run with TMI_REQUIRE_SSC_EVIDENCE=false for a demo.",
    };
  }
  if (!opts.sscEvidence) {
    return {
      allow: false,
      status: 403,
      error: "ssc_evidence_required",
      message:
        `[TRUST:FAIL] issuing a trustmark for image ${opts.imageDigest} requires signed SSC evidence ` +
        "(ssc_evidence: a @letsfederate/ssc-attest JWS) proving it passed the zero-HIGH/CRITICAL gate.",
    };
  }

  const verdict = await verifySscStatementJws(opts.sscEvidence, {
    publicJwks: opts.signerJwks,
    expectedArtifactDigest: opts.imageDigest,
    requirePass: true,
  });
  if (!verdict.ok) {
    return {
      allow: false,
      status: 403,
      error: "ssc_gate_blocked",
      message: "[TRUST:FAIL] SSC evidence did not pass the gate — trustmark refused.",
      reasons: verdict.reasons,
    };
  }
  return { allow: true };
}
