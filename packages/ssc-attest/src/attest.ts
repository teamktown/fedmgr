/**
 * Supply-chain trust evidence — one signed, verifiable object that BINDS an
 * artifact digest to its SBOM digest, its vulnerability-scan tally, and the
 * zero-HIGH/CRITICAL gate verdict (deep-reassessment supply-chain finding: today
 * these are unbound side-by-side artifacts and the SLA gates nothing).
 *
 * Shape is an in-toto Statement v1; the predicate carries the SBOM digest, scan
 * counts, and the gate result. `signSscStatementJws` wraps it as a JWS (the
 * caller supplies a signer); a Trust Mark Issuer calls `verifySscStatementJws`
 * before issuing an artifact-bound trust mark, and refuses when the gate did not
 * pass or the digest does not match.
 */
import { jwtVerify, importJWK, decodeJwt, type JWK } from "jose";

export const SSC_STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const SSC_PREDICATE_TYPE = "https://letsfederate.org/ssc-gate/v1";
export const SSC_JWT_TYP = "application/vnd.letsfederate.ssc-gate+jwt";
export const DEFAULT_SLA = "zero-high-critical";

export interface ScanCounts {
  critical: number;
  high: number;
  medium?: number;
  low?: number;
}

export interface SscStatement {
  _type: string;
  subject: Array<{ name?: string; digest: { sha256: string } }>;
  predicateType: string;
  predicate: {
    sbom?: { digest: { sha256: string }; format?: string };
    scan: { critical: number; high: number; medium: number; low: number; scanner?: string };
    gate: { sla: string; passed: boolean };
    issuedAt?: string;
  };
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const norm = (d: string): string => d.trim().toLowerCase();

/**
 * Build the SSC statement. The gate result is COMPUTED here from the scan
 * (passed ⇔ zero critical and zero high) — a caller cannot assert a passing
 * gate over a failing scan.
 */
export function buildSscStatement(opts: {
  artifactDigest: string;
  artifactName?: string;
  sbomDigest?: string;
  scan: ScanCounts;
  scanner?: string;
  sla?: string;
  issuedAt?: string;
}): SscStatement {
  if (!SHA256.test(norm(opts.artifactDigest))) {
    throw new Error(`[TRUST:FAIL] artifactDigest must be sha256:<hex64>, got "${opts.artifactDigest}"`);
  }
  if (opts.sbomDigest && !SHA256.test(norm(opts.sbomDigest))) {
    throw new Error(`[TRUST:FAIL] sbomDigest must be sha256:<hex64>`);
  }
  const scan = {
    critical: opts.scan.critical,
    high: opts.scan.high,
    medium: opts.scan.medium ?? 0,
    low: opts.scan.low ?? 0,
    ...(opts.scanner ? { scanner: opts.scanner } : {}),
  };
  const passed = scan.critical === 0 && scan.high === 0;
  return {
    _type: SSC_STATEMENT_TYPE,
    subject: [
      {
        ...(opts.artifactName ? { name: opts.artifactName } : {}),
        digest: { sha256: norm(opts.artifactDigest).replace(/^sha256:/, "") },
      },
    ],
    predicateType: SSC_PREDICATE_TYPE,
    predicate: {
      ...(opts.sbomDigest
        ? { sbom: { digest: { sha256: norm(opts.sbomDigest).replace(/^sha256:/, "") }, format: "cyclonedx" } }
        : {}),
      scan,
      gate: { sla: opts.sla ?? DEFAULT_SLA, passed },
      ...(opts.issuedAt ? { issuedAt: opts.issuedAt } : {}),
    },
  };
}

export interface SscVerdict {
  ok: boolean;
  reasons: string[];
  passed: boolean;
  artifactDigest?: string;
  sbomDigest?: string;
  critical?: number;
  high?: number;
}

/**
 * Verify an SSC statement structurally + against policy. With
 * `expectedArtifactDigest`, the statement's subject digest must match. With
 * `requirePass` (default true), the gate must have passed AND the scan counts
 * must be consistent (a forged `gate.passed:true` over HIGH/CRITICAL counts is
 * rejected — the tally is authoritative, not the boolean).
 */
export function verifySscStatement(
  statement: unknown,
  opts: { expectedArtifactDigest?: string; requirePass?: boolean } = {},
): SscVerdict {
  const requirePass = opts.requirePass ?? true;
  const reasons: string[] = [];
  const s = statement as Partial<SscStatement> | null;

  if (!s || typeof s !== "object") return { ok: false, reasons: ["statement is not an object"], passed: false };
  if (s._type !== SSC_STATEMENT_TYPE) reasons.push(`unexpected _type "${s._type}"`);
  if (s.predicateType !== SSC_PREDICATE_TYPE) reasons.push(`unexpected predicateType "${s.predicateType}"`);

  const subjDigest = s.subject?.[0]?.digest?.sha256;
  const artifactDigest = subjDigest ? `sha256:${norm(subjDigest).replace(/^sha256:/, "")}` : undefined;
  if (!artifactDigest || !SHA256.test(artifactDigest)) reasons.push("subject has no valid sha256 digest");

  const pred = s.predicate;
  const scan = pred?.scan;
  const critical = scan?.critical;
  const high = scan?.high;
  if (typeof critical !== "number" || typeof high !== "number") {
    reasons.push("predicate.scan is missing critical/high counts");
  }
  const gatePassed = pred?.gate?.passed === true;
  // Authoritative recompute: the counts, not the boolean, decide the gate.
  const countsClean = critical === 0 && high === 0;
  if (gatePassed && !countsClean) {
    reasons.push(`gate claims passed but scan has ${critical} critical / ${high} high — tally is authoritative`);
  }

  if (opts.expectedArtifactDigest) {
    const want = `sha256:${norm(opts.expectedArtifactDigest).replace(/^sha256:/, "")}`;
    if (artifactDigest !== want) {
      reasons.push(`artifact digest mismatch: statement ${artifactDigest ?? "none"}, expected ${want}`);
    }
  }

  const passed = gatePassed && countsClean;
  if (requirePass && !passed) {
    reasons.push(`gate did not pass (${critical ?? "?"} critical / ${high ?? "?"} high, sla=${pred?.gate?.sla ?? "?"})`);
  }

  const sbomDigest = pred?.sbom?.digest?.sha256
    ? `sha256:${norm(pred.sbom.digest.sha256).replace(/^sha256:/, "")}`
    : undefined;

  return {
    ok: reasons.length === 0,
    reasons,
    passed,
    ...(artifactDigest ? { artifactDigest } : {}),
    ...(sbomDigest ? { sbomDigest } : {}),
    ...(typeof critical === "number" ? { critical } : {}),
    ...(typeof high === "number" ? { high } : {}),
  };
}

/** Sign an SSC statement as a JWS. `signJwt` is a KeyProvider.signJwt-compatible fn. */
export async function signSscStatementJws(
  statement: SscStatement,
  signJwt: (payload: Record<string, unknown>, header?: Record<string, unknown>) => Promise<string>,
): Promise<string> {
  return signJwt(statement as unknown as Record<string, unknown>, { typ: SSC_JWT_TYP });
}

/**
 * Verify a signed SSC statement: signature against the pinned SSC signer keys
 * (ES256), then the structural + policy checks. Fail-closed.
 */
export async function verifySscStatementJws(
  jws: string,
  opts: {
    publicJwks: { keys: JWK[] };
    expectedArtifactDigest?: string;
    requirePass?: boolean;
  },
): Promise<SscVerdict> {
  const keys = opts.publicJwks?.keys ?? [];
  if (keys.length === 0) return { ok: false, reasons: ["no SSC signer keys pinned"], passed: false };

  let payload: Record<string, unknown> | null = null;
  let sawMismatch = false;
  for (const jwk of keys) {
    try {
      const key = await importJWK(jwk, "ES256");
      const res = await jwtVerify(jws, key, { algorithms: ["ES256"], typ: SSC_JWT_TYP });
      payload = res.payload as Record<string, unknown>;
      break;
    } catch (err) {
      if ((err as { code?: string })?.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
        sawMismatch = true;
        continue;
      }
      return { ok: false, reasons: [`SSC statement rejected: ${(err as Error).message}`], passed: false };
    }
  }
  if (!payload) {
    return { ok: false, reasons: [sawMismatch ? "SSC statement signature verification failed" : "no usable SSC signer key"], passed: false };
  }
  return verifySscStatement(payload, {
    ...(opts.expectedArtifactDigest ? { expectedArtifactDigest: opts.expectedArtifactDigest } : {}),
    ...(opts.requirePass !== undefined ? { requirePass: opts.requirePass } : {}),
  });
}

/** Decode an SSC JWS without verifying — for display only, never a decision. */
export function unsafeDecodeSscStatement(jws: string): SscStatement {
  return decodeJwt(jws) as unknown as SscStatement;
}
