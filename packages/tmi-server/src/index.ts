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
 *   PORT            default 8080
 *   TMI_ISSUER      default http://localhost:8080
 *   TMI_JWKS_URL    default http://localhost:8080/.well-known/jwks.json
 *   TMI_PUBLIC_JWK  default keys/tmi.pub.jwk
 *   TMI_PRIVATE_JWK default keys/tmi.priv.jwk (must be decrypted at runtime)
 */

import express, { type Request, type Response } from "express";
import { z } from "zod";
import { SoftKmsProvider } from "@letsfederate/kms";
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

// Validate required configuration at startup — fail fast before accepting
// any requests rather than surfacing errors mid-flight.
if (!ISSUER.startsWith("http")) {
  throw new Error(`TMI_ISSUER must be an HTTP(S) URL, got: ${ISSUER}`);
}
if (!JWKS_URL.startsWith("http")) {
  throw new Error(`TMI_JWKS_URL must be an HTTP(S) URL, got: ${JWKS_URL}`);
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
  async (_req: Request, res: Response): Promise<void> => {
    const jwks = await kms.jwks();
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(jwks);
  }
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
});

app.post(
  "/trustmarks/issue",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = IssueRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { sub, trustmark_id, image_digest, repo, evidence, ttl_s } =
      parsed.data;
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
    };

    // jku points verifiers to our JWKS for signature checking.
    const trustmark_jws = await kms.signJwt(payload, { jku: JWKS_URL });

    res.status(201).json({ trustmark_jws, payload });
  }
);

// ---------------------------------------------------------------------------
// OIDF: GET /.well-known/openid-federation
//
// Returns a self-signed entity statement JWT for the TMI.
// Content-Type: application/entity-statement+jwt (per spec §4.3)
// ---------------------------------------------------------------------------

app.get(
  "/.well-known/openid-federation",
  async (_req: Request, res: Response): Promise<void> => {
    const jws = await signEntityStatement(
      {
        entityId: ISSUER,
        authorityHints: [],          // TMI is a leaf; TA is defined separately
        ttlSeconds: 86400,
        metadata: tmiMetadata(JWKS_URL),
      },
      kms
    );
    res.setHeader("Content-Type", "application/entity-statement+jwt");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(jws);
  }
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

app.listen(PORT, () => {
  process.stdout.write(
    `[tmi-server] listening on :${PORT}  issuer=${ISSUER}\n`
  );
  process.stdout.write(`[tmi-server] JWKS at ${JWKS_URL}\n`);
});

export { app };
