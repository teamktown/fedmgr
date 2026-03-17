/**
 * Trustmark Issuer (TMI) Server
 *
 * Exposes two endpoints:
 *   GET  /.well-known/jwks.json  — public JWKS for JWS verification
 *   POST /trustmarks/issue       — mint a signed trustmark JWS
 *
 * Key policy:
 *   - Private key is NEVER written by this process.
 *   - At startup, TMI_PRIVATE_JWK must point to a decrypted JWK that lives
 *     on tmpfs (mounted by scripts/tmi-decrypt.sh). The file is read once
 *     on first signing request and held in memory only.
 *   - TMI_PUBLIC_JWK points to the plaintext public JWK on disk.
 *   - Both paths default to keys/tmi.{priv,pub}.jwk for local dev; override
 *     with env vars in production.
 *
 * Config (12-factor, all via env):
 *   PORT              default 8080
 *   TMI_ISSUER        default http://localhost:8080
 *   TMI_JWKS_URL      default http://localhost:8080/.well-known/jwks.json
 *   TMI_PUBLIC_JWK    default keys/tmi.pub.jwk
 *   TMI_PRIVATE_JWK   default keys/tmi.priv.jwk (must be decrypted at runtime)
 *   TMI_AUTHORITY_HINTS  JSON array of Trust Anchor entity IDs (e.g. ["https://letsfederate.org"])
 *
 * Trust policy (controls behaviour when SELF_TRUSTMARK_JWS is set):
 *   TRUST_POLICY      strict (default) | permissive | audit
 *   SELF_TRUSTMARK_JWS  compact JWS of this TMI's own trustmark (issued by the TA-registered TMI)
 *                       When set, the server validates its own trustmark at startup.
 *
 * Trust states logged at startup:
 *   [TRUST:VALID]  — trustmark verified and chain rooted in TA
 *   [TRUST:WARN]   — trustmark valid but advisory (expiring, chain not fully verified)
 *   [TRUST:FAIL]   — trustmark invalid (strict: server halts; permissive/audit: warns only)
 *   [TRUST:SKIP]   — SELF_TRUSTMARK_JWS not set; no self-attestation validation
 */

import express, { type Request, type Response } from "express";
import { asyncHandler } from "./utils/async-handler.js";
import { z } from "zod";
import {
  SoftKmsProvider,
  validateTrustmark,
  applyPolicy,
  trustPolicyFromEnv,
  formatTrustMessage,
  TrustPolicyError,
} from "@letsfederate/kms";
import {
  signEntityStatement,
  tmiMetadata,
} from "./federation/entity-statements.js";
import path from "node:path";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const PORT = Number(process.env["PORT"] ?? 8080);
const ISSUER = process.env["TMI_ISSUER"] ?? "http://localhost:8080";
const JWKS_URL =
  process.env["TMI_JWKS_URL"] ??
  "http://localhost:8080/.well-known/jwks.json";
const PUB_JWK =
  process.env["TMI_PUBLIC_JWK"] ?? path.resolve("keys", "tmi.pub.jwk");
const PRIV_JWK =
  process.env["TMI_PRIVATE_JWK"] ?? path.resolve("keys", "tmi.priv.jwk");
const AUTHORITY_HINTS: string[] = (() => {
  const raw = process.env["TMI_AUTHORITY_HINTS"];
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    process.stderr.write(
      `[tmi-server] [TRUST:WARN] TMI_AUTHORITY_HINTS is not valid JSON: "${raw}" — authority_hints will be empty.\n` +
      "  Recommended: Set TMI_AUTHORITY_HINTS=[\"https://letsfederate.org\"] to enable chain verification.\n"
    );
    return [];
  }
})();
const TRUST_POLICY = trustPolicyFromEnv();
const SELF_TRUSTMARK_JWS = process.env["SELF_TRUSTMARK_JWS"];
const TMI_ISSUE_TOKEN = process.env["TMI_ISSUE_TOKEN"];

if (!TMI_ISSUE_TOKEN) {
  process.stderr.write(
    "[tmi-server] [TRUST:WARN] TMI_ISSUE_TOKEN not set — " +
    "POST /trustmarks/issue is unprotected. Set TMI_ISSUE_TOKEN=<secret> in production.\n"
  );
}

// ── Validate required configuration — fail fast before accepting requests ──
if (!ISSUER.startsWith("http")) {
  process.stderr.write(
    `[tmi-server] [TRUST:FAIL] TMI_ISSUER must be an HTTP(S) URL, got: "${ISSUER}"\n` +
    "  Recommended: Set TMI_ISSUER=https://tmi.letsfederate.org (or your deployment URL)\n"
  );
  process.exit(78); // EX_CONFIG
}
if (!JWKS_URL.startsWith("http")) {
  process.stderr.write(
    `[tmi-server] [TRUST:FAIL] TMI_JWKS_URL must be an HTTP(S) URL, got: "${JWKS_URL}"\n` +
    "  Recommended: Set TMI_JWKS_URL=https://tmi.letsfederate.org/.well-known/jwks.json\n"
  );
  process.exit(78); // EX_CONFIG
}

const kms = new SoftKmsProvider({
  publicJwkPath: PUB_JWK,
  privateJwkPath: PRIV_JWK,
  issuer: ISSUER,
  jwksUrl: JWKS_URL,
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "256kb" }));

// Disable fingerprinting headers.
app.disable("x-powered-by");

// ---------------------------------------------------------------------------
// GET /.well-known/jwks.json
// ---------------------------------------------------------------------------

app.get(
  "/.well-known/jwks.json",
  asyncHandler(async (_req, res) => {
    const jwks = await kms.jwks();
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(jwks);
  })
);

// ---------------------------------------------------------------------------
// POST /trustmarks/issue
// ---------------------------------------------------------------------------

const IssueRequestSchema = z.object({
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

app.post(
  "/trustmarks/issue",
  asyncHandler(async (req, res) => {
    // Bearer token auth — required when TMI_ISSUE_TOKEN is set
    if (TMI_ISSUE_TOKEN) {
      const auth = req.headers["authorization"] ?? "";
      if (auth !== `Bearer ${TMI_ISSUE_TOKEN}`) {
        res.status(401).json({
          error: "unauthorized",
          message:
            "[TRUST:FAIL] POST /trustmarks/issue requires Authorization: Bearer <TMI_ISSUE_TOKEN>.",
        });
        return;
      }
    }

    const parsed = IssueRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
      return;
    }

    const {
      sub,
      trustmark_id,
      image_digest,
      repo,
      evidence,
      ttl_s,
      adopted_from_iss,
      adopted_from_id,
      adopted_from_jws,
    } = parsed.data;
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: ISSUER,
      sub,
      id: trustmark_id,
      iat: now,
      exp: now + ttl_s,
      ...(image_digest !== undefined ? { image_digest } : {}),
      ...(repo !== undefined ? { repo } : {}),
      ...(evidence !== undefined ? { evidence } : {}),
      // Adoption provenance — carries forward the original issuer/id so
      // verifiers can trace the endorsement chain.
      ...(adopted_from_iss !== undefined ? { adopted_from_iss } : {}),
      ...(adopted_from_id !== undefined ? { adopted_from_id } : {}),
      ...(adopted_from_jws !== undefined ? { adopted_from_jws } : {}),
    };

    // jku points verifiers to our JWKS for signature checking.
    const trustmark_jws = await kms.signJwt(payload, { jku: JWKS_URL });

    res.status(201).json({ trustmark_jws, payload });
  })
);

// ---------------------------------------------------------------------------
// OIDF: GET /.well-known/openid-federation
//
// Returns a self-signed entity statement JWT for the TMI.
// Content-Type: application/entity-statement+jwt (per spec §4.3)
// ---------------------------------------------------------------------------

app.get(
  "/.well-known/openid-federation",
  asyncHandler(async (_req, res) => {
    const jws = await signEntityStatement(
      {
        entityId: ISSUER,
        authorityHints: AUTHORITY_HINTS,
        ttlSeconds: 86400,
        metadata: tmiMetadata(JWKS_URL),
      },
      kms
    );
    res.setHeader("Content-Type", "application/entity-statement+jwt");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(jws);
  })
);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", issuer: ISSUER });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Startup — validate own trustmark then begin listening
// ---------------------------------------------------------------------------

async function startServer(): Promise<void> {
  // ── Self-trustmark validation ──────────────────────────────────────────
  if (SELF_TRUSTMARK_JWS) {
    process.stderr.write(
      "[tmi-server] Validating self-trustmark (SELF_TRUSTMARK_JWS)...\n"
    );
    const result = await validateTrustmark(SELF_TRUSTMARK_JWS);
    process.stderr.write(formatTrustMessage(result) + "\n");
    if (result.recommendedAction) {
      process.stderr.write(`  Recommended: ${result.recommendedAction}\n`);
    }
    try {
      applyPolicy(result, TRUST_POLICY);
    } catch (err) {
      if (err instanceof TrustPolicyError) {
        process.stderr.write(
          "[tmi-server] [TRUST:FAIL] Startup aborted — self-trustmark validation failed " +
          `under TRUST_POLICY=${TRUST_POLICY}.\n` +
          "  To override for debugging: set TRUST_POLICY=permissive\n"
        );
        process.exit(78); // EX_CONFIG
      }
      throw err;
    }
  } else {
    process.stderr.write(
      "[tmi-server] [TRUST:SKIP] SELF_TRUSTMARK_JWS not set — " +
      "operating without self-attestation validation.\n" +
      "  Info: Set SELF_TRUSTMARK_JWS=<jws> to enable startup trust check.\n"
    );
  }

  app.listen(PORT, () => {
    process.stdout.write(
      `[tmi-server] listening on :${PORT}  issuer=${ISSUER}  policy=${TRUST_POLICY}\n`
    );
    process.stdout.write(`[tmi-server] JWKS at ${JWKS_URL}\n`);
    if (AUTHORITY_HINTS.length > 0) {
      process.stdout.write(
        `[tmi-server] authority_hints=${JSON.stringify(AUTHORITY_HINTS)}\n`
      );
    }
  });
}

startServer().catch((err: unknown) => {
  process.stderr.write(
    `[tmi-server] Fatal startup error: ${String(err)}\n`
  );
  process.exit(1);
});

export { app };
