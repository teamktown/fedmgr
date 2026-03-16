/**
 * Trust Mark Status Registry
 *
 * Implements the OIDF trust-mark-status endpoint logic per spec §12.
 *
 * A trust mark is considered ACTIVE unless it has been explicitly revoked.
 * The registry is in-memory; persistence is the operator's responsibility
 * (e.g. reload from a JSON file at startup and write on mutation).
 *
 * Usage:
 *   const reg = new TrustMarkStatusRegistry();
 *   reg.revoke(sub, id);       // mark as inactive
 *   reg.restore(sub, id);      // re-activate
 *   reg.isActive(sub, id);     // query
 *
 * HTTP wiring:
 *   app.use("/trust-mark-status", createTrustMarkStatusRouter(reg));
 */

import { Router, type Request, type Response } from "express";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable composite key for a (sub, id) pair. */
export function buildStatusKey(sub: string, id: string): string {
  return `${sub}::${id}`;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class TrustMarkStatusRegistry {
  /** Set of revoked (sub::id) composite keys. */
  private readonly revoked = new Set<string>();

  /** Revoke a trust mark for the given subject + type ID. */
  revoke(sub: string, id: string): void {
    this.revoked.add(buildStatusKey(sub, id));
  }

  /** Restore (un-revoke) a trust mark. No-op if not revoked. */
  restore(sub: string, id: string): void {
    this.revoked.delete(buildStatusKey(sub, id));
  }

  /**
   * Returns true if the trust mark is active (not revoked).
   * All trust marks are active by default unless explicitly revoked.
   */
  isActive(sub: string, id: string): boolean {
    return !this.revoked.has(buildStatusKey(sub, id));
  }
}

// ---------------------------------------------------------------------------
// Express router factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express router for the /trust-mark-status endpoint.
 * Mount at: app.use("/trust-mark-status", createTrustMarkStatusRouter(reg))
 *
 * GET /trust-mark-status?sub=<entityId>&id=<trustMarkTypeUri>
 *   → 200 { active: true | false }
 *   → 400 { error: "invalid_request", error_description: "..." } on missing params
 */
export function createTrustMarkStatusRouter(
  registry: TrustMarkStatusRegistry
): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response) => {
    const sub = req.query["sub"];
    const id  = req.query["id"];

    if (!sub || typeof sub !== "string") {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required query parameter: sub",
      });
      return;
    }

    if (!id || typeof id !== "string") {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required query parameter: id",
      });
      return;
    }

    res.json({ active: registry.isActive(sub, id) });
  });

  return router;
}
