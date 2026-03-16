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
 *   TA_REGISTRY_PATH  path to JSON subordinate registry (persistent); unset = in-memory
 *
 * Subordinates are registered via TA_SUBORDINATES env var (JSON array):
 *   [{ "entityId": "https://...", "jwksUrl": "https://.../.well-known/jwks.json" }]
 * The TA fetches each subordinate's JWKS at startup to populate the registry.
 *
 * Trust policy:
 *   TRUST_POLICY  strict (default) | permissive | audit
 *   Controls behaviour when JWKS fetch for a subordinate fails at startup.
 *   strict:      startup aborts on any JWKS fetch failure
 *   permissive:  failed subordinates are logged and skipped
 *   audit:       all states logged, never blocks
 *
 * Trust states logged at startup:
 *   [TRUST:VALID]  — subordinate JWKS fetched and cached successfully
 *   [TRUST:WARN]   — subordinate JWKS not yet fetched (registry-only entry)
 *   [TRUST:FAIL]   — JWKS fetch failed (strict: abort; permissive: skip subordinate)
 */

import express, { type Request, type Response } from "express";
import { SoftKmsProvider, trustPolicyFromEnv } from "@letsfederate/kms";
import {
  signSubordinateStatement,
  SubordinateRegistry,
  isIntermediate,
  type SubordinateEntry,
} from "./federation/subordinate-statements.js";
import { FileSubordinateRegistry } from "./federation/file-registry.js";
import {
  signEntityStatement,
  trustAnchorMetadata,
} from "./federation/entity-statements.js";
import {
  TrustMarkStatusRegistry,
  createTrustMarkStatusRouter,
} from "./federation/trust-mark-status.js";
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
const REGISTRY_PATH = process.env["TA_REGISTRY_PATH"];
const TRUST_POLICY = trustPolicyFromEnv();

if (!ENTITY_ID.startsWith("http")) {
  process.stderr.write(
    `[ta-server] [TRUST:FAIL] TA_ENTITY_ID must be an HTTP(S) URL, got: "${ENTITY_ID}"\n` +
    "  Recommended: Set TA_ENTITY_ID=https://letsfederate.org (your domain)\n"
  );
  process.exit(78); // EX_CONFIG
}

const kms = new SoftKmsProvider({
  publicJwkPath: PUB_JWK,
  privateJwkPath: PRIV_JWK,
  issuer: ENTITY_ID,
  jwksUrl: JWKS_URL,
});

// ---------------------------------------------------------------------------
// Subordinate registry and trust-mark status registry — populated at startup
// ---------------------------------------------------------------------------

const registry: SubordinateRegistry = REGISTRY_PATH
  ? new FileSubordinateRegistry(REGISTRY_PATH)
  : new SubordinateRegistry();
const statusRegistry = new TrustMarkStatusRegistry();

async function loadSubordinates(): Promise<void> {
  const raw = process.env["TA_SUBORDINATES"];
  if (!raw) {
    process.stdout.write(
      "[ta-server] TA_SUBORDINATES not set — no subordinates registered.\n"
    );
    return;
  }

  let specs: Array<{ entityId: string; jwksUrl: string; fetchEndpoint?: string }>;
  try {
    specs = JSON.parse(raw) as Array<{ entityId: string; jwksUrl: string; fetchEndpoint?: string }>;
  } catch {
    process.stderr.write(
      "[ta-server] [TRUST:FAIL] TA_SUBORDINATES must be a JSON array of " +
      "{entityId, jwksUrl, fetchEndpoint?} objects\n" +
      "  Recommended: Check TA_SUBORDINATES env var format. " +
      "Example: [{\"entityId\":\"https://tmi.example.com\",\"jwksUrl\":\"https://tmi.example.com/.well-known/jwks.json\"}]\n"
    );
    process.exit(78); // EX_CONFIG
  }

  for (const spec of specs) {
    process.stderr.write(
      `[ta-server] Fetching JWKS for subordinate ${spec.entityId}...\n`
    );
    let jwks: { keys: unknown[] };
    try {
      const r = await fetch(spec.jwksUrl);
      if (!r.ok) {
        throw new Error(`HTTP ${r.status} ${r.statusText}`);
      }
      jwks = (await r.json()) as { keys: unknown[] };
      if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
        throw new Error("JWKS response has no keys");
      }
    } catch (err) {
      const msg =
        `[ta-server] [TRUST:FAIL] JWKS fetch failed for ${spec.entityId} ` +
        `from ${spec.jwksUrl}: ${String(err)}\n` +
        `  Recommended: Verify ${spec.entityId} is deployed and serving JWKS before starting the TA.\n` +
        "  To skip failed subordinates at startup: set TRUST_POLICY=permissive\n";
      process.stderr.write(msg);

      if (TRUST_POLICY === "strict") {
        process.exit(1);
      }
      // permissive/audit: log and skip this subordinate
      process.stderr.write(
        `  [TRUST:POLICY] ${TRUST_POLICY} mode — skipping ${spec.entityId} and continuing startup.\n`
      );
      continue;
    }

    const entry: SubordinateEntry = {
      entityId: spec.entityId,
      jwks: jwks as SubordinateEntry["jwks"],
      ...(spec.fetchEndpoint
        ? {
            metadata: {
              federation_entity: {
                federation_fetch_endpoint: spec.fetchEndpoint,
              },
            },
          }
        : {}),
    };
    registry.register(entry);
    const kind = isIntermediate(entry) ? "intermediate" : "leaf";
    process.stderr.write(
      `[ta-server] [TRUST:VALID] Registered ${spec.entityId} (${kind})\n`
    );
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
// Per OIDF draft-43 §8.3: returns JSON array of entity ID strings.
//
// Optional query parameters:
//   entity_type=intermediate  — return only intermediates (entities with
//                               federation_fetch_endpoint in their metadata)
//   entity_type=leaf          — return only leaf entities
//   limit=N                   — return at most N results
//   after=<entityId>          — pagination cursor: return entries after this ID
// ---------------------------------------------------------------------------

app.get("/federation_list", (req: Request, res: Response) => {
  let ids = registry.listEntityIds();

  const entityType = req.query["entity_type"] as string | undefined;
  if (entityType === "intermediate") {
    ids = ids.filter((id) => {
      const e = registry.get(id);
      return e ? isIntermediate(e) : false;
    });
  } else if (entityType === "leaf") {
    ids = ids.filter((id) => {
      const e = registry.get(id);
      return e ? !isIntermediate(e) : false;
    });
  }

  const after = req.query["after"] as string | undefined;
  if (after) {
    const idx = ids.indexOf(after);
    ids = idx >= 0 ? ids.slice(idx + 1) : [];
  }

  const limitRaw = req.query["limit"];
  if (limitRaw) {
    const limit = parseInt(String(limitRaw), 10);
    if (!isNaN(limit) && limit > 0) ids = ids.slice(0, limit);
  }

  res.setHeader("Content-Type", "application/json");
  res.json(ids);
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
// GET /trust-mark-status — OIDF §12 trust mark status query
// ---------------------------------------------------------------------------

app.use("/trust-mark-status", createTrustMarkStatusRouter(statusRegistry));

// ---------------------------------------------------------------------------
// GET /intermediates — management endpoint: list intermediate entity IDs
// (Not part of OIDF core spec; management-plane convenience only)
// ---------------------------------------------------------------------------

app.get("/intermediates", (_req: Request, res: Response) => {
  const all = registry.listEntityIds();
  const intermediates = all.filter((id) => {
    const entry = registry.get(id);
    return entry ? isIntermediate(entry) : false;
  });
  res.json(intermediates);
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
      const subCount = registry.listEntityIds().length;
      process.stderr.write(
        `[ta-server] listening on :${PORT}  entity_id=${ENTITY_ID}  policy=${TRUST_POLICY}\n`
      );
      if (subCount > 0) {
        process.stderr.write(
          `[ta-server] [TRUST:VALID] ${subCount} subordinate(s) registered\n`
        );
      } else {
        process.stderr.write(
          "[ta-server] [TRUST:WARN] No subordinates registered — " +
          "federation_list will return an empty array.\n" +
          "  Info: Set TA_SUBORDINATES=[{\"entityId\":\"...\",\"jwksUrl\":\"...\"}] " +
          "or use TA_REGISTRY_PATH for a persistent registry.\n"
        );
      }
    });
  })
  .catch((err: unknown) => {
    process.stderr.write(
      `[ta-server] [TRUST:FAIL] Startup failed: ${String(err)}\n` +
      "  Recommended: Check TA_SUBORDINATES, TA_ENTITY_ID, and key paths are correct.\n"
    );
    process.exit(1);
  });

export { app, registry };
