/**
 * Trust Anchor (TA) Server
 *
 * Implements the OIDF Trust Anchor role per draft-43:
 *
 *   GET /.well-known/openid-federation   — self-signed TA entity statement
 *   GET /.well-known/jwks.json           — TA public JWKS
 *   GET /federation_list                 — list of subordinate entity IDs
 *   GET /federation_fetch?sub=<entityId> — signed subordinate statement
 *   GET /health                          — liveness
 *
 * Key policy (same as tmi-server):
 *   TA_PRIVATE_JWK must point to a tmpfs-decrypted file at runtime.
 *   Use scripts/tmi-keys-init.sh --dir packages/ta-server/keys and
 *   scripts/tmi-decrypt.sh (with KEYS_DIR=packages/ta-server/keys).
 *
 * Config (env):
 *   PORT              default 8090
 *   TA_ENTITY_ID      default http://localhost:8090
 *   TA_JWKS_URL       default http://localhost:8090/.well-known/jwks.json
 *   TA_PUBLIC_JWK     default keys/ta.pub.jwk
 *   TA_PRIVATE_JWK    default keys/ta.priv.jwk (decrypted, on tmpfs)
 *   TA_ORG_NAME       default "letsfederate Trust Anchor"
 *
 * Subordinates are registered via TA_SUBORDINATES env var (JSON array):
 *   [{ "entityId": "https://...", "jwksUrl": "https://.../.well-known/jwks.json" }]
 * The TA fetches each subordinate's JWKS at startup to populate the registry.
 */

import express, { type Request, type Response } from "express";
import { SoftKmsProvider } from "@letsfederate/kms";
import {
  signSubordinateStatement,
  SubordinateRegistry,
  type SubordinateEntry,
} from "./federation/subordinate-statements.js";
import {
  signEntityStatement,
  trustAnchorMetadata,
} from "./federation/entity-statements.js";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env["PORT"] ?? 8090);
const ENTITY_ID =
  process.env["TA_ENTITY_ID"] ?? `http://localhost:${PORT}`;
const JWKS_URL =
  process.env["TA_JWKS_URL"] ??
  `http://localhost:${PORT}/.well-known/jwks.json`;
const PUB_JWK =
  process.env["TA_PUBLIC_JWK"] ?? path.resolve("keys", "ta.pub.jwk");
const PRIV_JWK =
  process.env["TA_PRIVATE_JWK"] ?? path.resolve("keys", "ta.priv.jwk");
const ORG_NAME =
  process.env["TA_ORG_NAME"] ?? "letsfederate Trust Anchor";

if (!ENTITY_ID.startsWith("http")) {
  throw new Error(`TA_ENTITY_ID must be an HTTP(S) URL, got: ${ENTITY_ID}`);
}

const kms = new SoftKmsProvider({
  publicJwkPath: PUB_JWK,
  privateJwkPath: PRIV_JWK,
  issuer: ENTITY_ID,
  jwksUrl: JWKS_URL,
});

// ---------------------------------------------------------------------------
// Subordinate registry — populated at startup
// ---------------------------------------------------------------------------

const registry = new SubordinateRegistry();

async function loadSubordinates(): Promise<void> {
  const raw = process.env["TA_SUBORDINATES"];
  if (!raw) {
    process.stdout.write(
      "[ta-server] TA_SUBORDINATES not set — no subordinates registered.\n"
    );
    return;
  }

  let specs: Array<{ entityId: string; jwksUrl: string }>;
  try {
    specs = JSON.parse(raw) as Array<{ entityId: string; jwksUrl: string }>;
  } catch {
    throw new Error(
      `TA_SUBORDINATES must be a JSON array of {entityId, jwksUrl} objects`
    );
  }

  for (const spec of specs) {
    process.stdout.write(
      `[ta-server] Fetching JWKS for subordinate ${spec.entityId}...\n`
    );
    const r = await fetch(spec.jwksUrl);
    if (!r.ok) {
      throw new Error(
        `Failed to fetch JWKS for ${spec.entityId} from ${spec.jwksUrl}: ${r.status}`
      );
    }
    const jwks = (await r.json()) as { keys: unknown[] };
    const entry: SubordinateEntry = {
      entityId: spec.entityId,
      jwks: jwks as SubordinateEntry["jwks"],
    };
    registry.register(entry);
    process.stdout.write(`[ta-server]   ✔ Registered ${spec.entityId}\n`);
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.disable("x-powered-by");

// ---------------------------------------------------------------------------
// GET /.well-known/jwks.json
// ---------------------------------------------------------------------------

app.get("/.well-known/jwks.json", async (_req: Request, res: Response) => {
  const jwks = await kms.jwks();
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(jwks);
});

// ---------------------------------------------------------------------------
// GET /.well-known/openid-federation — TA self-signed entity statement
// ---------------------------------------------------------------------------

app.get(
  "/.well-known/openid-federation",
  async (_req: Request, res: Response): Promise<void> => {
    const jws = await signEntityStatement(
      {
        entityId: ENTITY_ID,
        authorityHints: [], // TA has no authority above it
        ttlSeconds: 86400,
        metadata: trustAnchorMetadata({
          organizationName: ORG_NAME,
          federationFetchEndpoint: `${ENTITY_ID}/federation_fetch`,
          federationListEndpoint: `${ENTITY_ID}/federation_list`,
          trustMarkStatusEndpoint: `${ENTITY_ID}/trust-mark-status`,
        }),
      },
      kms
    );
    res.setHeader("Content-Type", "application/entity-statement+jwt");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(jws);
  }
);

// ---------------------------------------------------------------------------
// GET /federation_list — list of immediate subordinate entity IDs
// Per spec §8.3: returns JSON array of entity ID strings
// ---------------------------------------------------------------------------

app.get("/federation_list", (_req: Request, res: Response) => {
  res.json(registry.listEntityIds());
});

// ---------------------------------------------------------------------------
// GET /federation_fetch?sub=<entityId>
// Per spec §8.1: returns signed subordinate statement JWT
// ---------------------------------------------------------------------------

app.get(
  "/federation_fetch",
  async (req: Request, res: Response): Promise<void> => {
    const sub = req.query["sub"] as string | undefined;

    if (!sub) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required query parameter: sub",
      });
      return;
    }

    const entry = registry.get(sub);
    if (!entry) {
      // Spec requires an error JSON (not a 404 HTML page) for unknown subjects.
      res.status(404).json({
        error: "not_found",
        error_description: `No subordinate statement found for sub: ${sub}`,
      });
      return;
    }

    const jws = await signSubordinateStatement(
      {
        issuerEntityId: ENTITY_ID,
        subjectEntityId: entry.entityId,
        subjectJwks: entry.jwks,
        subjectMetadata: entry.metadata,
        ttlSeconds: 86400,
      },
      kms
    );

    res.setHeader("Content-Type", "application/entity-statement+jwt");
    res.setHeader("Cache-Control", "no-store"); // subordinate statements are per-subject
    res.send(jws);
  }
);

// ---------------------------------------------------------------------------
// GET /trust-mark-status — stub (Increment E)
// ---------------------------------------------------------------------------

app.get("/trust-mark-status", (_req: Request, res: Response) => {
  res.status(501).json({
    error: "not_implemented",
    error_description:
      "Trust mark status endpoint is planned for Increment E.",
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    entity_id: ENTITY_ID,
    subordinates: registry.listEntityIds().length,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

loadSubordinates()
  .then(() => {
    app.listen(PORT, () => {
      process.stdout.write(
        `[ta-server] listening on :${PORT}  entity_id=${ENTITY_ID}\n`
      );
      process.stdout.write(
        `[ta-server] ${registry.listEntityIds().length} subordinate(s) registered\n`
      );
    });
  })
  .catch((err: unknown) => {
    process.stderr.write(`[ta-server] startup failed: ${String(err)}\n`);
    process.exit(1);
  });

export { app, registry };
