/**
 * Management Router
 *
 * Admin-plane endpoints for managing subordinates, revocations, and audit log.
 *
 * All endpoints should be protected by an admin auth middleware in production.
 * For local dev, they are unprotected (protected only by network access).
 * Set ADMIN_TOKEN env var to enable Bearer token auth on all management routes.
 *
 *   GET  /subordinates                    — list all subordinates
 *   GET  /subordinates/:entityId          — get one subordinate
 *   POST /subordinates/:entityId/revoke   — revoke (mark as revoked)
 *   POST /subordinates/:entityId/restore  — restore a revoked subordinate
 *   DELETE /subordinates/:entityId        — decommission (removes from federation)
 *
 *   GET  /revocations                     — list all trustmark revocations
 *   POST /trustmarks/revoke               — revoke a specific trustmark
 *   POST /trustmarks/restore              — restore a revoked trustmark
 *
 *   GET  /audit                           — recent audit log (last 100 entries)
 *   GET  /audit/:entityId                 — audit log for one entity
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { FederationStore } from "../db/store.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const RevokeSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

const TrustmarkRevokeSchema = z.object({
  entity_id:    z.string().url(),
  trustmark_id: z.string().url(),
  reason:       z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Auth middleware (optional — enabled by ADMIN_TOKEN env var)
// ---------------------------------------------------------------------------

function adminAuth(adminToken: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!adminToken) return next(); // auth disabled
    const auth = req.headers["authorization"] ?? "";
    if (auth === `Bearer ${adminToken}`) return next();
    res.status(401).json({
      error: "unauthorized",
      message:
        "[TRUST:FAIL] Admin authentication required. " +
        "Set Authorization: Bearer <ADMIN_TOKEN> header.",
    });
  };
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createManagementRouter(store: FederationStore): Router {
  const router = Router();
  const adminToken = process.env["ADMIN_TOKEN"];
  const auth = adminAuth(adminToken);

  if (adminToken) {
    process.stderr.write(
      "[ta-server] Management API: ADMIN_TOKEN is set — auth enabled.\n"
    );
  } else {
    process.stderr.write(
      "[ta-server] [TRUST:WARN] Management API: ADMIN_TOKEN not set — " +
      "admin endpoints are unprotected. Set ADMIN_TOKEN=<secret> in production.\n"
    );
  }

  // ── GET /subordinates ─────────────────────────────────────────────────────
  router.get("/subordinates", auth, (req: Request, res: Response): void => {
    const statusFilter = req.query["status"] as string | undefined;
    const typeFilter   = req.query["type"] as string | undefined;

    const rows = store.listSubordinates({
      ...(statusFilter ? { status: statusFilter as never } : {}),
      ...(typeFilter === "intermediate" ? { isIntermediate: true } :
         typeFilter === "leaf"         ? { isIntermediate: false } : {}),
    });

    res.json({
      count: rows.length,
      items: rows.map(formatSubordinate),
    });
  });

  // ── GET /subordinates/:entityId ───────────────────────────────────────────
  router.get(
    "/subordinates/:entityId",
    auth,
    (req: Request, res: Response): void => {
      const entityId = decodeURIComponent(req.params["entityId"] ?? "");
      const row = store.getSubordinate(entityId);
      if (!row) {
        res.status(404).json({
          error: "not_found",
          message: `No subordinate found for entity_id: ${entityId}`,
        });
        return;
      }
      res.json(formatSubordinate(row));
    }
  );

  // ── POST /subordinates/:entityId/revoke ───────────────────────────────────
  router.post(
    "/subordinates/:entityId/revoke",
    auth,
    (req: Request, res: Response): void => {
      const entityId = decodeURIComponent(req.params["entityId"] ?? "");
      const actor    = req.ip ?? "unknown";

      const row = store.getSubordinate(entityId);
      if (!row) {
        res.status(404).json({
          error: "not_found",
          message: `No subordinate found for entity_id: ${entityId}`,
        });
        return;
      }
      if (row.status === "revoked") {
        res.status(409).json({
          error: "already_revoked",
          message: `${entityId} is already revoked. Use /restore to re-activate.`,
        });
        return;
      }
      if (row.status === "decommissioned") {
        res.status(409).json({
          error: "decommissioned",
          message: `${entityId} has been decommissioned and cannot be revoked. It no longer participates in the federation.`,
        });
        return;
      }

      const parsed = RevokeSchema.safeParse(req.body ?? {});
      const reason = parsed.success ? (parsed.data.reason ?? null) : null;

      store.updateSubordinateStatus(entityId, "revoked", { reason: reason ?? undefined, actor });
      store.audit("subordinate_revoked", entityId, actor, { reason });

      process.stderr.write(
        `[ta-server] [TRUST:WARN] Subordinate REVOKED: ${entityId} (reason=${reason ?? "not specified"})\n`
      );

      res.json({
        entity_id:   entityId,
        status:      "revoked",
        revoked_at:  new Date().toISOString(),
        reason,
        message:
          `[TRUST:WARN] ${entityId} has been revoked. ` +
          "federation_fetch for this entity will return a revocation notice. " +
          "To re-activate: POST /subordinates/:entityId/restore",
      });
    }
  );

  // ── POST /subordinates/:entityId/restore ──────────────────────────────────
  router.post(
    "/subordinates/:entityId/restore",
    auth,
    (req: Request, res: Response): void => {
      const entityId = decodeURIComponent(req.params["entityId"] ?? "");
      const actor    = req.ip ?? "unknown";

      const row = store.getSubordinate(entityId);
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (row.status !== "revoked") {
        res.status(409).json({
          error: "not_revoked",
          message: `${entityId} is not currently revoked (status: ${row.status}).`,
        });
        return;
      }

      store.updateSubordinateStatus(entityId, "active", { actor });
      store.audit("subordinate_restored", entityId, actor, {});

      process.stderr.write(
        `[ta-server] [TRUST:VALID] Subordinate RESTORED: ${entityId}\n`
      );

      res.json({
        entity_id:  entityId,
        status:     "active",
        restored_at: new Date().toISOString(),
        message:
          `[TRUST:VALID] ${entityId} has been restored to active status.`,
      });
    }
  );

  // ── DELETE /subordinates/:entityId — decommission ─────────────────────────
  router.delete(
    "/subordinates/:entityId",
    auth,
    (req: Request, res: Response): void => {
      const entityId = decodeURIComponent(req.params["entityId"] ?? "");
      const actor    = req.ip ?? "unknown";
      const reason   = (req.query["reason"] as string | undefined) ?? "decommissioned by administrator";

      const row = store.getSubordinate(entityId);
      if (!row) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      store.updateSubordinateStatus(entityId, "decommissioned", { reason, actor });
      store.audit("subordinate_decommissioned", entityId, actor, { reason });

      process.stderr.write(
        `[ta-server] Subordinate DECOMMISSIONED: ${entityId}\n`
      );

      res.json({
        entity_id:         entityId,
        status:            "decommissioned",
        decommissioned_at: new Date().toISOString(),
        reason,
        message:
          `${entityId} has been decommissioned. It no longer appears in federation_list ` +
          "and federation_fetch returns 404. To re-enroll, start a new enrollment via POST /enroll.",
      });
    }
  );

  // ── GET /revocations ──────────────────────────────────────────────────────
  router.get("/revocations", auth, (req: Request, res: Response): void => {
    const entityId = req.query["entity_id"] as string | undefined;
    const rows = store.listRevocations(entityId);
    res.json({ count: rows.length, items: rows });
  });

  // ── POST /trustmarks/revoke ───────────────────────────────────────────────
  router.post(
    "/trustmarks/revoke",
    auth,
    (req: Request, res: Response): void => {
      const actor  = req.ip ?? "unknown";
      const parsed = TrustmarkRevokeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid_request",
          details: parsed.error.flatten(),
        });
        return;
      }

      const { entity_id, trustmark_id, reason } = parsed.data;

      store.revokeItem(entity_id, trustmark_id, {
        reason: reason ?? undefined,
        actor,
      });
      store.audit("trustmark_revoked", entity_id, actor, {
        trustmark_id,
        reason,
      });

      process.stderr.write(
        `[ta-server] Trustmark REVOKED: sub=${entity_id} id=${trustmark_id}\n`
      );

      res.json({
        entity_id,
        trustmark_id,
        active:     false,
        revoked_at: new Date().toISOString(),
        message:    `[TRUST:WARN] Trustmark ${trustmark_id} for ${entity_id} is now inactive.`,
      });
    }
  );

  // ── POST /trustmarks/restore ──────────────────────────────────────────────
  router.post(
    "/trustmarks/restore",
    auth,
    (req: Request, res: Response): void => {
      const actor  = req.ip ?? "unknown";
      const parsed = TrustmarkRevokeSchema.omit({ reason: true }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid_request",
          details: parsed.error.flatten(),
        });
        return;
      }

      const { entity_id, trustmark_id } = parsed.data;

      store.restoreItem(entity_id, trustmark_id);
      store.audit("trustmark_restored", entity_id, actor, { trustmark_id });

      res.json({
        entity_id,
        trustmark_id,
        active:      true,
        restored_at: new Date().toISOString(),
        message:     `[TRUST:VALID] Trustmark ${trustmark_id} for ${entity_id} is now active.`,
      });
    }
  );

  // ── GET /audit ────────────────────────────────────────────────────────────
  router.get("/audit", auth, (req: Request, res: Response): void => {
    const limit    = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10), 500);
    const entityId = req.query["entity_id"] as string | undefined;
    const entries  = store.getAuditLog(limit, entityId);
    res.json({ count: entries.length, items: entries });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

function formatSubordinate(row: ReturnType<FederationStore["getSubordinate"]> & object) {
  return {
    entity_id:        (row as { entityId: string }).entityId,
    jwks_url:         (row as { jwksUrl: string }).jwksUrl,
    status:           (row as { status: string }).status,
    is_intermediate:  (row as { isIntermediate: boolean }).isIntermediate,
    enrolled_at:      (row as { enrolledAt: Date }).enrolledAt.toISOString(),
    updated_at:       (row as { updatedAt: Date }).updatedAt.toISOString(),
    revocation_reason:(row as { revocationReason: string | null }).revocationReason,
    revoked_at:       (row as { revokedAt: Date | null }).revokedAt?.toISOString() ?? null,
    notes:            (row as { notes: string | null }).notes,
  };
}
