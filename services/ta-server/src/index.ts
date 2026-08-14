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
 * Enrollment & management (new in Increment G):
 *   POST   /enroll                            — start proof-of-key enrollment
 *   POST   /enroll/:id/complete               — complete enrollment with signed proof
 *   GET    /enroll/:id                        — check enrollment status
 *   GET    /subordinates                      — list subordinates (admin)
 *   POST   /subordinates/:entityId/revoke     — revoke a subordinate
 *   POST   /subordinates/:entityId/restore    — restore a revoked subordinate
 *   DELETE /subordinates/:entityId            — decommission a subordinate
 *   GET    /revocations                       — trustmark revocation log
 *   POST   /trustmarks/revoke                 — revoke a specific trustmark
 *   POST   /trustmarks/restore                — restore a revoked trustmark
 *   GET    /audit                             — audit log
 *   GET    /dashboard                         — admin dashboard UI
 *   GET    /dashboard/api/*                   — dashboard JSON API
 *
 * Key policy (same as tmi-server):
 *   TA_PRIVATE_JWK must point to a tmpfs-decrypted file at runtime.
 *   Use scripts/tmi-keys-init.sh --dir services/ta-server/keys and
 *   scripts/tmi-decrypt.sh (with KEYS_DIR=services/ta-server/keys).
 *
 * Config (env):
 *   PORT              default 8090
 *   TA_ENTITY_ID      default http://localhost:8090
 *   TA_JWKS_URL       default http://localhost:8090/.well-known/jwks.json
 *   TA_PUBLIC_JWK     default keys/ta.pub.jwk
 *   TA_PRIVATE_JWK    default keys/ta.priv.jwk (decrypted, on tmpfs)
 *   TA_ORG_NAME       default "letsfederate Trust Anchor"
 *   TA_DB_PATH        default ./ta.db — SQLite database path
 *   ADMIN_TOKEN       optional — if set, enables Bearer auth on management endpoints
 *
 * Startup subordinates (bootstrap only — DB is authoritative afterwards):
 *   TA_SUBORDINATES   JSON array of { entityId, jwksUrl, fetchEndpoint? }
 *                     These are upserted into the DB on first boot.
 *
 * Trust policy:
 *   TRUST_POLICY  strict (default) | permissive | audit
 *   Controls behaviour when JWKS fetch for a subordinate fails at startup.
 *   strict:      startup aborts on any JWKS fetch failure
 *   permissive:  failed subordinates are logged and skipped
 *   audit:       all states logged, never blocks
 */

import express, { type Request, type Response } from "express";
import { SoftKmsProvider, trustPolicyFromEnv } from "@letsfederate/kms";
import {
  signSubordinateStatement,
  isIntermediate,
} from "./federation/subordinate-statements.js";
import {
  signEntityStatement,
  trustAnchorMetadata,
} from "./federation/entity-statements.js";
import { createTrustMarkStatusRouter } from "./federation/trust-mark-status.js";
import { SqliteFederationStore } from "./db/sqlite-store.js";
import { FederationIndex, FastEmbedder } from "@letsfederate/fedvec";
import { createFederationSearchRouter } from "./federation/federation-search.js";
import { createEnrollmentRouter } from "./enrollment/index.js";
import { createManagementRouter } from "./management/index.js";
import { createDashboardRouter } from "./dashboard/index.js";
import path from "node:path";
import type { JWK } from "jose";
import { asyncHandler } from "./utils/async-handler.js";

// Strip private key material from JWK (defense-in-depth for bootstrap JWKS)
const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];
function stripJwkPrivateFields(jwk: JWK): JWK {
  const pub = { ...jwk };
  for (const f of PRIVATE_JWK_FIELDS) delete (pub as Record<string, unknown>)[f];
  return pub;
}

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
const DB_PATH =
  process.env["TA_DB_PATH"] ?? path.resolve("ta.db");
const TRUST_POLICY = trustPolicyFromEnv();

/**
 * TA_TRUST_MARK_ISSUERS — JSON object `{ "<trust_mark_type>": ["<issuer id>"] }`
 * published in the TA entity configuration's top-level `trust_mark_issuers`
 * claim (OIDF §5.1.1). This is how the anchor authorizes which TMI may mint
 * which mark type; verifiers use it instead of trusting a mark's own `jku`.
 */
const TRUST_MARK_ISSUERS: Record<string, string[]> = (() => {
  const raw = process.env["TA_TRUST_MARK_ISSUERS"];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    throw new Error("must be a JSON object of type → issuer-id array");
  } catch (err) {
    process.stderr.write(
      `[ta-server] [TRUST:FAIL] TA_TRUST_MARK_ISSUERS is not valid JSON: ${String(err)}\n` +
      '  Example: TA_TRUST_MARK_ISSUERS=\'{"https://letsfederate.org/tm/mcp":["https://tmi.example"]}\'\n'
    );
    process.exit(78); // EX_CONFIG
  }
})();

if (!ENTITY_ID.startsWith("http")) {
  process.stderr.write(
    `[ta-server] [TRUST:FAIL] TA_ENTITY_ID must be an HTTP(S) URL, got: "${ENTITY_ID}"\n` +
    "  Recommended: Set TA_ENTITY_ID=https://letsfederate.org (your domain)\n"
  );
  process.exit(78); // EX_CONFIG
}

try {
  new URL(JWKS_URL);
} catch {
  process.stderr.write(
    `[ta-server] [TRUST:FAIL] TA_JWKS_URL is not a valid URL: "${JWKS_URL}"\n` +
    "  Recommended: Set TA_JWKS_URL=https://letsfederate.org/.well-known/jwks.json\n"
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
// Persistent store (SQLite) — source of truth for all subordinate state
// ---------------------------------------------------------------------------

const store = new SqliteFederationStore(DB_PATH);
store.migrate();
process.stderr.write(
  `[ta-server] DB opened: ${DB_PATH}\n`
);

// ---------------------------------------------------------------------------
// Semantic search index (fedvec) — a single on-disk RuVector `.rvf` file that
// sits next to the SQLite store. Rebuilt on demand from subordinate metadata;
// zero external services.
//
//   TA_VEC_PATH       override the .rvf location (default: next to the DB)
//   TA_VEC_EMBEDDER   "hash" (default: offline, zero-download, lexical) or
//                     "minilm" (local ONNX all-MiniLM-L6-v2 — higher quality
//                     semantic matching; fetches the model once, then offline)
// ---------------------------------------------------------------------------

const VEC_PATH =
  process.env["TA_VEC_PATH"] ??
  path.join(path.dirname(DB_PATH), "federation.rvf");
const federationIndex = new FederationIndex({
  rvfPath: VEC_PATH,
  ...(process.env["TA_VEC_EMBEDDER"] === "minilm"
    ? { embedder: new FastEmbedder() }
    : {}),
});

// ---------------------------------------------------------------------------
// Bootstrap subordinates from TA_SUBORDINATES env var
// (upserted into DB — subsequent restarts skip entities that already exist)
// ---------------------------------------------------------------------------

async function loadSubordinates(): Promise<void> {
  const raw = process.env["TA_SUBORDINATES"];
  if (!raw) {
    process.stderr.write(
      "[ta-server] TA_SUBORDINATES not set — using DB-only subordinate list.\n"
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
    // Skip if already active in the DB — DB is authoritative
    const existing = store.getSubordinate(spec.entityId);
    if (existing?.status === "active") {
      process.stderr.write(
        `[ta-server] [TRUST:VALID] ${spec.entityId} already active in DB — skipping bootstrap fetch.\n`
      );
      continue;
    }

    process.stderr.write(
      `[ta-server] Fetching JWKS for bootstrap subordinate ${spec.entityId}...\n`
    );
    let jwks: { keys: JWK[] };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      // Use 'unknown' typed variable to avoid collision with Express Response type
      let fetchResponse: Awaited<ReturnType<typeof fetch>>;
      try {
        fetchResponse = await fetch(spec.jwksUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!fetchResponse.ok) {
        throw new Error(`HTTP ${fetchResponse.status} ${fetchResponse.statusText}`);
      }
      const raw = (await fetchResponse.json()) as { keys: JWK[] };
      if (!Array.isArray(raw.keys) || raw.keys.length === 0) {
        throw new Error("JWKS response has no keys");
      }
      // Strip private key material — defense-in-depth in case the remote sends private fields
      jwks = { keys: raw.keys.map(stripJwkPrivateFields) };
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
      process.stderr.write(
        `  [TRUST:POLICY] ${TRUST_POLICY} mode — skipping ${spec.entityId} and continuing startup.\n`
      );
      continue;
    }

    const metadata: Record<string, unknown> | null = spec.fetchEndpoint
      ? { federation_entity: { federation_fetch_endpoint: spec.fetchEndpoint } }
      : null;

    store.upsertSubordinate({
      entityId:         spec.entityId,
      jwksUrl:          spec.jwksUrl,
      jwks:             jwks as { keys: never[] },
      metadata,
      status:           "active",
      isIntermediate:   !!spec.fetchEndpoint,
      revocationReason: null,
      revokedAt:        null,
      revokedBy:        null,
      notes:            "Bootstrapped from TA_SUBORDINATES env var",
    });
    store.audit("subordinate_bootstrapped", spec.entityId, "server-startup", {
      jwks_url: spec.jwksUrl,
    });

    process.stderr.write(
      `[ta-server] [TRUST:VALID] Bootstrapped subordinate: ${spec.entityId}\n`
    );
  }
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.disable("x-powered-by");
// Trust proxy headers (X-Forwarded-For) so req.ip is accurate in audit logs
// when running behind a reverse proxy (nginx, Caddy, AWS ALB, etc.)
app.set("trust proxy", process.env["TRUST_PROXY"] ?? false);
app.use(express.json());

// ---------------------------------------------------------------------------
// GET /.well-known/jwks.json
// ---------------------------------------------------------------------------

app.get("/.well-known/jwks.json", asyncHandler(async (_req, res) => {
  const jwks = await kms.jwks();
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(jwks);
}));

// ---------------------------------------------------------------------------
// GET /.well-known/openid-federation — TA self-signed entity statement
// ---------------------------------------------------------------------------

app.get(
  "/.well-known/openid-federation",
  asyncHandler(async (_req, res) => {
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
        trustMarkIssuers: TRUST_MARK_ISSUERS,
      },
      kms
    );
    res.setHeader("Content-Type", "application/entity-statement+jwt");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(jws);
  })
);

// ---------------------------------------------------------------------------
// GET /federation_list — list of immediate subordinate entity IDs
// Per OIDF draft-43 §8.3: returns JSON array of entity ID strings.
//
// Optional query parameters:
//   entity_type=intermediate  — return only intermediates
//   entity_type=leaf          — return only leaf entities
//   limit=N                   — return at most N results
//   after=<entityId>          — pagination cursor: return entries after this ID
// ---------------------------------------------------------------------------

app.get("/federation_list", (req: Request, res: Response) => {
  // Only active subordinates appear in federation_list
  let rows = store.listSubordinates({ status: "active" });

  const entityType = req.query["entity_type"] as string | undefined;
  if (entityType === "intermediate") {
    rows = rows.filter((r) => r.isIntermediate);
  } else if (entityType === "leaf") {
    rows = rows.filter((r) => !r.isIntermediate);
  }

  let ids = rows.map((r) => r.entityId);

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
// GET /federation_search — semantic (vector) discovery over subordinates.
// See createFederationSearchRouter for details.
// ---------------------------------------------------------------------------

app.use(createFederationSearchRouter(store, federationIndex));

// ---------------------------------------------------------------------------
// GET /federation_fetch?sub=<entityId>
// Per spec §8.1: returns signed subordinate statement JWT.
// Returns 404 for revoked/decommissioned subordinates.
// ---------------------------------------------------------------------------

app.get(
  "/federation_fetch",
  asyncHandler(async (req, res) => {
    const sub = req.query["sub"] as string | undefined;

    if (!sub) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required query parameter: sub",
      });
      return;
    }

    const row = store.getSubordinate(sub);
    if (!row) {
      res.status(404).json({
        error: "not_found",
        error_description: `No subordinate statement found for sub: ${sub}`,
      });
      return;
    }

    if (row.status === "revoked") {
      res.status(403).json({
        error: "subordinate_revoked",
        error_description:
          `[TRUST:WARN] ${sub} has been revoked and cannot be fetched. ` +
          "An administrator may restore it via POST /subordinates/:entityId/restore.",
      });
      return;
    }

    if (row.status === "decommissioned") {
      res.status(404).json({
        error: "not_found",
        error_description: `No subordinate statement found for sub: ${sub}`,
      });
      return;
    }

    if (row.status === "pending") {
      res.status(404).json({
        error: "not_found",
        error_description: `${sub} has a pending enrollment and is not yet active.`,
      });
      return;
    }

    if (!row.jwks) {
      res.status(503).json({
        error: "jwks_unavailable",
        error_description:
          `[TRUST:WARN] No cached JWKS for ${sub}. ` +
          "The subordinate must complete enrollment with proof-of-key to populate its JWKS.",
      });
      return;
    }

    const metadata = row.metadata ?? undefined;
    const subEntry = {
      entityId: row.entityId,
      jwks: row.jwks as { keys: JWK[] },
      metadata,
    };

    const jws = await signSubordinateStatement(
      {
        issuerEntityId:  ENTITY_ID,
        subjectEntityId: row.entityId,
        subjectJwks:     subEntry.jwks,
        subjectMetadata: subEntry.metadata,
        ttlSeconds:      86400,
      },
      kms
    );

    res.setHeader("Content-Type", "application/entity-statement+jwt");
    res.setHeader("Cache-Control", "no-store");
    res.send(jws);
  })
);

// ---------------------------------------------------------------------------
// GET /trust-mark-status — OIDF §12 trust mark status query
// Backed by the DB revocations table.
// ---------------------------------------------------------------------------

const dbStatusChecker = {
  isActive: (sub: string, id: string) => store.isActive(sub, id),
};

app.use("/trust-mark-status", createTrustMarkStatusRouter(dbStatusChecker));

// ---------------------------------------------------------------------------
// GET /intermediates — convenience: list intermediate entity IDs
// ---------------------------------------------------------------------------

app.get("/intermediates", (_req: Request, res: Response) => {
  const rows = store.listSubordinates({ status: "active", isIntermediate: true });
  res.json(rows.map((r) => r.entityId));
});

// ---------------------------------------------------------------------------
// Enrollment router — POST /enroll, POST /enroll/:id/complete, GET /enroll/:id
// ---------------------------------------------------------------------------

app.use("/", createEnrollmentRouter(store, kms, ENTITY_ID, JWKS_URL));

// ---------------------------------------------------------------------------
// Management router — admin CRUD for subordinates, revocations, audit log
// Protected by ADMIN_TOKEN Bearer auth when env var is set.
// ---------------------------------------------------------------------------

app.use("/", createManagementRouter(store));

// ---------------------------------------------------------------------------
// Dashboard router — GET /dashboard (UI) + GET /dashboard/api/*
// ---------------------------------------------------------------------------

app.use("/", createDashboardRouter(store, ENTITY_ID));

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  const active = store.listSubordinates({ status: "active" }).length;
  res.json({
    status: "ok",
    entity_id: ENTITY_ID,
    subordinates: active,
    db_path: DB_PATH,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

loadSubordinates()
  .then(() => {
    app.listen(PORT, () => {
      const active = store.listSubordinates({ status: "active" }).length;
      process.stderr.write(
        `[ta-server] listening on :${PORT}  entity_id=${ENTITY_ID}  policy=${TRUST_POLICY}\n`
      );
      if (active > 0) {
        process.stderr.write(
          `[ta-server] [TRUST:VALID] ${active} active subordinate(s) in DB\n`
        );
      } else {
        process.stderr.write(
          "[ta-server] [TRUST:WARN] No active subordinates in DB — " +
          "federation_list will return an empty array.\n" +
          "  Info: Enroll subordinates via POST /enroll or set TA_SUBORDINATES=[...] for bootstrap.\n"
        );
      }
      process.stderr.write(
        `[ta-server] Dashboard: http://localhost:${PORT}/dashboard\n`
      );
    });
  })
  .catch((err: unknown) => {
    process.stderr.write(
      `[ta-server] [TRUST:FAIL] Startup failed: ${String(err)}\n` +
      "  Recommended: Check TA_ENTITY_ID, key paths, and TA_DB_PATH are correct.\n"
    );
    process.exit(1);
  });

export { app, store };
