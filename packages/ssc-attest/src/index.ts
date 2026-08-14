/**
 * @letsfederate/ssc-attest — signed supply-chain trust evidence.
 *
 * Binds an artifact digest + SBOM digest + scan tally + zero-HIGH/CRITICAL gate
 * verdict into one in-toto Statement, signed as a JWS. A Trust Mark Issuer
 * verifies it before issuing an artifact-bound trust mark, so the SLA actually
 * gates issuance instead of being an advisory log line.
 */
export {
  SSC_STATEMENT_TYPE,
  SSC_PREDICATE_TYPE,
  SSC_JWT_TYP,
  DEFAULT_SLA,
  buildSscStatement,
  verifySscStatement,
  signSscStatementJws,
  verifySscStatementJws,
  unsafeDecodeSscStatement,
} from "./attest.js";
export type { SscStatement, ScanCounts, SscVerdict } from "./attest.js";
