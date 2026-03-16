/**
 * Dashboard Router
 *
 * Serves the federation management dashboard at GET /dashboard
 * and a JSON API at GET /dashboard/api/... for the UI.
 *
 * The dashboard provides:
 *   - Federation overview (active/revoked/pending counts)
 *   - Subordinate list with status badges and quick actions
 *   - Enrollment requests (approve/reject)
 *   - Revocation log
 *   - Audit log (last 50 events)
 */

import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FederationStore } from "../db/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createDashboardRouter(
  store: FederationStore,
  entityId: string
): Router {
  const router = Router();

  // ── GET /dashboard — serve the HTML UI ──────────────────────────────────
  router.get("/dashboard", (_req: Request, res: Response): void => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const html = readFileSync(join(__dirname, "ui.html"), "utf8");
      res.send(html);
    } catch {
      // Fallback: inline minimal HTML if file not found (dist not built yet)
      res.send(buildFallbackHtml(entityId));
    }
  });

  // ── GET /dashboard/api/overview ──────────────────────────────────────────
  router.get("/dashboard/api/overview", (_req: Request, res: Response): void => {
    const all = store.listSubordinates();
    const counts = {
      active:          all.filter((s) => s.status === "active").length,
      pending:         all.filter((s) => s.status === "pending").length,
      revoked:         all.filter((s) => s.status === "revoked").length,
      decommissioned:  all.filter((s) => s.status === "decommissioned").length,
      intermediates:   all.filter((s) => s.isIntermediate).length,
      total:           all.length,
    };
    res.json({ entity_id: entityId, counts });
  });

  // ── GET /dashboard/api/subordinates ──────────────────────────────────────
  router.get(
    "/dashboard/api/subordinates",
    (_req: Request, res: Response): void => {
      const rows = store.listSubordinates();
      res.json(
        rows.map((r) => ({
          entity_id:        r.entityId,
          jwks_url:         r.jwksUrl,
          status:           r.status,
          is_intermediate:  r.isIntermediate,
          enrolled_at:      r.enrolledAt.toISOString(),
          updated_at:       r.updatedAt.toISOString(),
          revocation_reason:r.revocationReason,
          revoked_at:       r.revokedAt?.toISOString() ?? null,
          notes:            r.notes,
        }))
      );
    }
  );

  // ── GET /dashboard/api/revocations ────────────────────────────────────────
  router.get(
    "/dashboard/api/revocations",
    (_req: Request, res: Response): void => {
      const rows = store.listRevocations();
      res.json(rows);
    }
  );

  // ── GET /dashboard/api/audit ──────────────────────────────────────────────
  router.get("/dashboard/api/audit", (_req: Request, res: Response): void => {
    const entries = store.getAuditLog(50);
    res.json(entries);
  });

  return router;
}

// ---------------------------------------------------------------------------
// Fallback HTML (shown if dist/ui.html not found)
// ---------------------------------------------------------------------------

function buildFallbackHtml(entityId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>fedmgr dashboard — build required</title>
<style>
  body { font-family: monospace; padding: 2rem; background: #0f172a; color: #94a3b8; }
  h1 { color: #f8fafc; } code { color: #38bdf8; }
</style>
</head>
<body>
  <h1>fedmgr dashboard</h1>
  <p>Trust Anchor: <code>${entityId}</code></p>
  <p>Dashboard UI not found. Run <code>npm run build -w @letsfederate/ta-server</code> to generate it.</p>
  <p>API endpoints are available at <code>/dashboard/api/*</code></p>
</body>
</html>`;
}
