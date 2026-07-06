/**
 * Shared request/response schemas for the Trust Mark Issuer.
 *
 * WHY this is its own module: `index.ts` self-starts an HTTP server on import,
 * so it cannot be imported by clients/tests just to reuse a schema. Keeping the
 * Zod schemas here (no side effects) lets the MCP client and contract tests
 * import the SAME definition the server validates against — a single source of
 * truth that makes request/field drift a build/test failure rather than a
 * silent 400 (review Finding #2).
 *
 * AI-NOTE: the fedmgr-mcp `issue_trustmark` tool builds its POST body against
 * this schema. If you add/rename a field here, update
 * packages/fedmgr-mcp/src/index.ts (buildIssueTrustmarkBody) in the same change.
 */
import { z } from "zod";

/** Body schema for `POST /trustmarks/issue`. */
export const IssueRequestSchema = z.object({
  /** Entity ID of the subject receiving the trustmark. */
  sub: z.string().url("sub must be a URL (entity ID)"),
  /** Trustmark type identifier URI. */
  trustmark_id: z
    .string()
    .url("trustmark_id must be a URL")
    .default(
      "https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1"
    ),
  /** OCI image digest (optional, for container attestations). */
  image_digest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/, "image_digest must be sha256:<hex64>")
    .optional(),
  /** Source repository URL (optional). */
  repo: z.string().url().optional(),
  /** Evidence URL (optional — link to audit report, scan results, etc.). */
  evidence: z.string().url().optional(),
  /**
   * Signed supply-chain evidence (a @letsfederate/ssc-attest JWS) binding the
   * image_digest to its SBOM + scan verdict + zero-HIGH/CRITICAL gate. REQUIRED
   * for artifact-bound marks (when image_digest is set) unless the TMI is
   * explicitly run with TMI_REQUIRE_SSC_EVIDENCE=false. The TMI verifies it
   * against TMI_SSC_SIGNER_JWKS and refuses issuance if the gate did not pass.
   */
  ssc_evidence: z.string().optional(),
  /** Token validity in seconds (60s–24h). */
  ttl_s: z.number().int().min(60).max(86400).default(3600),
  /** Adoption: entity ID of the original trustmark issuer. */
  adopted_from_iss: z.string().url().optional(),
  /** Adoption: trustmark type URI from the original trustmark. */
  adopted_from_id: z.string().url().optional(),
  /**
   * Adoption: the original trustmark JWS (embedded as evidence).
   * Stored verbatim in the issued trustmark so verifiers can check the chain.
   */
  adopted_from_jws: z.string().optional(),
});

export type IssueRequest = z.infer<typeof IssueRequestSchema>;
