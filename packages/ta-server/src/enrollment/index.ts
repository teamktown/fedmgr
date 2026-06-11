/**
 * Enrollment Router
 *
 * Implements a two-step proof-of-key-ownership enrollment flow:
 *
 *   POST /enroll
 *     Body: { entity_id, jwks_url, notes? }
 *     → returns { enrollment_id, nonce, expires_at }
 *     The nonce must be signed by the enrolling entity's private key.
 *
 *   POST /enroll/:enrollmentId/complete
 *     Body: { proof_jws }
 *     The proof_jws must be a JWS with payload { nonce, entity_id }
 *     signed by a key from the entity's JWKS.
 *     → returns { entity_id, signed_entity_statement }
 *
 *   GET /enroll/:enrollmentId
 *     Returns current enrollment status.
 *
 * After successful completion, the entity is marked 'active' in the
 * FederationStore and can be included in federation_list / federation_fetch.
 *
 * Trust audit logging:
 *   Every step is recorded in audit_log with event_type:
 *     enroll_started | enroll_completed | enroll_rejected | enroll_expired
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  jwtVerify,
  importJWK,
  decodeJwt,
  type JWK,
} from "jose";
import { randomBytes, randomUUID } from "node:crypto";
import type { FederationStore } from "../db/store.js";
import type { KeyProvider } from "@letsfederate/kms";
import {
  signSubordinateStatement,
} from "../federation/subordinate-statements.js";
// SSRF guard — single source of truth lives in @letsfederate/kms (Finding #10).
import { assertSafeUrl, UrlSafetyError } from "@letsfederate/kms";

// Maximum JWKS response body size (64 KB) to prevent memory exhaustion
const JWKS_MAX_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const EnrollStartSchema = z.object({
  entity_id: z.string().url("entity_id must be a valid URL"),
  jwks_url:  z.string().url("jwks_url must be a valid URL"),
  notes:     z.string().max(500).optional(),
});

const EnrollCompleteSchema = z.object({
  proof_jws: z.string().min(1, "proof_jws is required"),
});

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createEnrollmentRouter(
  store: FederationStore,
  kms: KeyProvider,
  entityId: string,       // TA entity ID (used in signed entity statement)
  jwksUrl: string
): Router {
  const router = Router();
  router.use(require_json_or_nothing);

  // ── POST /enroll — initiate enrollment ──────────────────────────────────
  router.post("/enroll", async (req: Request, res: Response): Promise<void> => {
    const actor = req.ip ?? "unknown";
    const parsed = EnrollStartSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { entity_id, jwks_url, notes } = parsed.data;

    // Reject unsafe JWKS URLs (SSRF protection)
    try {
      assertSafeUrl(jwks_url, "jwks_url");
      assertSafeUrl(entity_id, "entity_id");
    } catch (err) {
      if (err instanceof UrlSafetyError) {
        // Preserve the [TRUST:FAIL] signal in the client response; the shared
        // validator keeps messages prefix-free (presentation is the caller's job).
        res.status(400).json({ error: "invalid_request", message: `[TRUST:FAIL] ${err.message}` });
        return;
      }
      throw err;
    }

    // Entity binding: jwks_url must share the same origin as entity_id.
    // This prevents an attacker from enrolling a victim entity (entity_id=victim)
    // with their own JWKS (jwks_url=attacker), gaining a TA-signed statement for
    // an entity they don't control.
    {
      const eid = new URL(entity_id);
      const jwk = new URL(jwks_url);
      if (eid.origin !== jwk.origin) {
        res.status(400).json({
          error: "origin_mismatch",
          message:
            `jwks_url origin (${jwk.origin}) must match entity_id origin (${eid.origin}). ` +
            "Serve your JWKS from the same host as your entity_id to prove ownership.",
        });
        return;
      }
    }

    // Reject if already active
    const existing = store.getSubordinate(entity_id);
    if (existing?.status === "active") {
      res.status(409).json({
        error: "already_enrolled",
        message: `${entity_id} is already an active subordinate. Use /subordinates/${encodeURIComponent(entity_id)} to manage it.`,
      });
      return;
    }

    // Reject if revoked — require explicit decommission first
    if (existing?.status === "revoked") {
      res.status(409).json({
        error: "revoked",
        message:
          `${entity_id} was previously revoked. To re-enroll, an administrator ` +
          `must first decommission it via DELETE /subordinates/${encodeURIComponent(entity_id)}.`,
      });
      return;
    }

    // Expire any stale pending enrollments for this entity
    store.expireEnrollments();

    const nonce = randomBytes(32).toString("hex");
    const enrollmentId = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    store.createEnrollment({
      id:        enrollmentId,
      entityId:  entity_id,
      jwksUrl:   jwks_url,
      nonce,
      status:    "pending",
      expiresAt,
    });

    // Pre-register as pending subordinate
    store.upsertSubordinate({
      entityId:         entity_id,
      jwksUrl:          jwks_url,
      jwks:             null,
      metadata:         null,
      status:           "pending",
      isIntermediate:   false,
      revocationReason: null,
      revokedAt:        null,
      revokedBy:        null,
      notes:            notes ?? null,
    });

    store.audit("enroll_started", entity_id, actor, {
      enrollment_id: enrollmentId,
      jwks_url,
    });

    process.stderr.write(
      `[ta-server] Enrollment started: ${entity_id} (id=${enrollmentId})\n`
    );

    res.status(202).json({
      enrollment_id: enrollmentId,
      nonce,
      expires_at:   expiresAt.toISOString(),
      instructions:
        "Sign the nonce field value using your entity's private key. " +
        `Create a JWS with payload {"nonce":"<nonce_value>","entity_id":"${entity_id}"} ` +
        `and POST it to /enroll/${enrollmentId}/complete as {"proof_jws":"<compact-jws>"}.`,
    });
  });

  // ── POST /enroll/:id/complete — verify proof and activate ────────────────
  router.post(
    "/enroll/:enrollmentId/complete",
    async (req: Request, res: Response): Promise<void> => {
      const actor = req.ip ?? "unknown";
      const { enrollmentId } = req.params as { enrollmentId: string };

      const enrollment = store.getEnrollment(enrollmentId);
      if (!enrollment) {
        res.status(404).json({
          error: "not_found",
          message: `Enrollment ${enrollmentId} not found.`,
        });
        return;
      }

      if (enrollment.status === "expired" || enrollment.expiresAt < new Date()) {
        store.updateEnrollment(enrollmentId, "expired");
        res.status(410).json({
          error: "enrollment_expired",
          message:
            "The enrollment challenge has expired (10 minute window). " +
            "Start a new enrollment by POSTing to /enroll.",
        });
        return;
      }

      if (enrollment.status !== "pending") {
        res.status(409).json({
          error: "enrollment_not_pending",
          message: `Enrollment is in '${enrollment.status}' state, not 'pending'.`,
        });
        return;
      }

      const parsed = EnrollCompleteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid_request",
          details: parsed.error.flatten(),
        });
        return;
      }

      const { proof_jws } = parsed.data;

      // ── Fetch the entity's JWKS ────────────────────────────────────────
      let keys: JWK[];
      try {
        const r = await fetch(enrollment.jwksUrl);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Guard against oversized responses (max 64 KB) to prevent memory exhaustion
        const contentLength = Number(r.headers.get("content-length") ?? 0);
        if (contentLength > JWKS_MAX_BYTES) {
          throw new Error(`JWKS response too large (${contentLength} bytes, max ${JWKS_MAX_BYTES})`);
        }
        const text = await r.text();
        if (text.length > JWKS_MAX_BYTES) {
          throw new Error(`JWKS response too large (${text.length} bytes, max ${JWKS_MAX_BYTES})`);
        }
        const body = JSON.parse(text) as { keys?: JWK[] };
        if (!Array.isArray(body.keys) || body.keys.length === 0) {
          throw new Error("JWKS has no keys");
        }
        keys = body.keys;
      } catch (err) {
        process.stderr.write(
          `[ta-server] [TRUST:FAIL] Enrollment ${enrollmentId}: ` +
          `JWKS fetch failed (${enrollment.jwksUrl}): ${String(err)}\n`
        );
        res.status(502).json({
          error: "jwks_fetch_failed",
          message:
            `Cannot fetch JWKS from ${enrollment.jwksUrl}: ${String(err)}. ` +
            "Ensure your JWKS endpoint is publicly accessible before completing enrollment.",
        });
        return;
      }

      // ── Verify proof JWS ──────────────────────────────────────────────
      let proofPayload: Record<string, unknown> | null = null;
      for (const jwk of keys) {
        try {
          // importJWK pins the algorithm; jwtVerify algorithms option prevents
          // algorithm confusion attacks (e.g. RS256/HS256 substitution)
          const cryptoKey = await importJWK(jwk, "ES256");
          const { payload } = await jwtVerify(proof_jws, cryptoKey, {
            clockTolerance: 60,
            algorithms: ["ES256"],
          });
          proofPayload = payload as Record<string, unknown>;
          break;
        } catch {
          // try next key
        }
      }

      if (!proofPayload) {
        store.updateEnrollment(enrollmentId, "rejected", {
          reason: "proof_jws signature verification failed",
        });
        store.audit("enroll_rejected", enrollment.entityId, actor, {
          enrollment_id: enrollmentId,
          reason: "signature_invalid",
        });
        res.status(401).json({
          error: "proof_invalid",
          message:
            "[TRUST:FAIL] Proof JWS signature verification failed — " +
            "no key in your JWKS produced a valid signature. " +
            "Ensure you signed with the same private key whose public JWK is at " +
            enrollment.jwksUrl,
        });
        return;
      }

      // ── Verify nonce and entity_id in payload ─────────────────────────
      if (proofPayload["nonce"] !== enrollment.nonce) {
        store.updateEnrollment(enrollmentId, "rejected", {
          reason: "nonce_mismatch",
        });
        res.status(401).json({
          error: "nonce_mismatch",
          message:
            "[TRUST:FAIL] Nonce in proof JWS does not match the issued nonce. " +
            "Use the exact nonce from the enrollment response.",
        });
        return;
      }

      if (proofPayload["entity_id"] !== enrollment.entityId) {
        store.updateEnrollment(enrollmentId, "rejected", {
          reason: "entity_id_mismatch",
        });
        res.status(401).json({
          error: "entity_id_mismatch",
          message:
            `[TRUST:FAIL] entity_id in proof ("${String(proofPayload["entity_id"])}") ` +
            `does not match enrollment entity_id ("${enrollment.entityId}").`,
        });
        return;
      }

      // ── Activate the subordinate ──────────────────────────────────────
      store.upsertSubordinate({
        entityId:         enrollment.entityId,
        jwksUrl:          enrollment.jwksUrl,
        jwks:             { keys: keys as { keys: never[] }["keys"] },
        metadata:         null,
        status:           "active",
        isIntermediate:   false,
        revocationReason: null,
        revokedAt:        null,
        revokedBy:        null,
        notes:            null,
      });

      store.updateEnrollment(enrollmentId, "completed");
      store.audit("enroll_completed", enrollment.entityId, actor, {
        enrollment_id: enrollmentId,
      });

      // ── Issue signed subordinate statement ────────────────────────────
      const signedStatement = await signSubordinateStatement(
        {
          issuerEntityId:  entityId,
          subjectEntityId: enrollment.entityId,
          subjectJwks:     { keys: keys as JWK[] },
        },
        kms
      );

      process.stderr.write(
        `[ta-server] [TRUST:VALID] Enrollment completed: ${enrollment.entityId}\n`
      );

      res.status(200).json({
        entity_id:               enrollment.entityId,
        status:                  "active",
        signed_entity_statement: signedStatement,
        message:
          `[TRUST:VALID] ${enrollment.entityId} is now an active subordinate of ${entityId}. ` +
          "The signed_entity_statement is your subordinate statement JWT — " +
          "verify it with: fedmgr trustmark check --sub " + enrollment.entityId,
      });
    }
  );

  // ── GET /enroll/:id — check enrollment status ────────────────────────────
  router.get("/enroll/:enrollmentId", (req: Request, res: Response): void => {
    const { enrollmentId } = req.params as { enrollmentId: string };
    const enrollment = store.getEnrollment(enrollmentId);
    if (!enrollment) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const expired =
      enrollment.status === "pending" && enrollment.expiresAt < new Date();
    res.json({
      enrollment_id: enrollment.id,
      entity_id:     enrollment.entityId,
      status:        expired ? "expired" : enrollment.status,
      expires_at:    enrollment.expiresAt.toISOString(),
      completed_at:  enrollment.completedAt?.toISOString() ?? null,
    });
  });

  return router;
}

// Middleware: parse JSON or fall through
function require_json_or_nothing(
  req: Request,
  res: Response,
  next: () => void
): void {
  if (req.is("application/json") || req.method === "GET") return next();
  if (!req.headers["content-type"]) return next();
  res.status(415).json({
    error: "unsupported_media_type",
    message: "Content-Type must be application/json",
  });
}
