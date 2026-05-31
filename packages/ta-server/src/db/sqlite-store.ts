/**
 * SqliteFederationStore
 *
 * SQLite-backed FederationStore using better-sqlite3.
 *
 * Local dev: DB_PATH=./ta.db (default) — single file, zero config
 * Production: set DB_PATH to a persistent volume path
 *
 * WAL mode is enabled for better read concurrency (no write conflicts
 * during federation_fetch while enrollment is in progress).
 *
 * better-sqlite3 is synchronous; all methods are sync which keeps the
 * TA server code simple (no async waterfall for every DB read).
 */

import Database, { type Database as DatabaseType } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FederationStore,
  SubordinateRow,
  SubordinateStatus,
  EnrollmentRequest,
  RevocationRow,
  AuditEntry,
} from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = path.join(__dirname, "migrations", "001-init.sql");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(v + (v.endsWith("Z") ? "" : "Z"));
}

function parseJson<T>(v: string | null | undefined): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class SqliteFederationStore implements FederationStore {
  private readonly db: DatabaseType;

  constructor(dbPath: string) {
    const dir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  // ── Migrations ──────────────────────────────────────────────────────────

  migrate(): void {
    const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
    // Execute each statement separately (better-sqlite3 exec handles batches)
    this.db.exec(sql);
  }

  // ── Subordinates ────────────────────────────────────────────────────────

  upsertSubordinate(
    row: Omit<SubordinateRow, "enrolledAt" | "updatedAt">
  ): void {
    this.db
      .prepare(
        `INSERT INTO subordinates
           (entity_id, jwks_url, jwks_json, metadata_json, status,
            is_intermediate, revocation_reason, revoked_at, revoked_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_id) DO UPDATE SET
           jwks_url          = excluded.jwks_url,
           jwks_json         = excluded.jwks_json,
           metadata_json     = excluded.metadata_json,
           status            = excluded.status,
           is_intermediate   = excluded.is_intermediate,
           revocation_reason = excluded.revocation_reason,
           revoked_at        = excluded.revoked_at,
           revoked_by        = excluded.revoked_by,
           notes             = excluded.notes,
           updated_at        = datetime('now','utc')`
      )
      .run(
        row.entityId,
        row.jwksUrl,
        row.jwks ? JSON.stringify(row.jwks) : null,
        row.metadata ? JSON.stringify(row.metadata) : null,
        row.status,
        row.isIntermediate ? 1 : 0,
        row.revocationReason,
        row.revokedAt?.toISOString() ?? null,
        row.revokedBy,
        row.notes
      );
  }

  updateSubordinateStatus(
    entityId: string,
    status: SubordinateStatus,
    opts?: { reason?: string; actor?: string }
  ): void {
    this.db
      .prepare(
        `UPDATE subordinates SET
           status            = ?,
           revocation_reason = CASE WHEN ? IS NOT NULL THEN ? ELSE revocation_reason END,
           revoked_at        = CASE WHEN ? IN ('revoked','decommissioned')
                                    THEN datetime('now','utc')
                                    ELSE revoked_at END,
           revoked_by        = CASE WHEN ? IS NOT NULL THEN ? ELSE revoked_by END,
           updated_at        = datetime('now','utc')
         WHERE entity_id = ?`
      )
      .run(
        status,
        opts?.reason ?? null, opts?.reason ?? null,
        status,
        opts?.actor ?? null, opts?.actor ?? null,
        entityId
      );
  }

  getSubordinate(entityId: string): SubordinateRow | null {
    const row = this.db
      .prepare("SELECT * FROM subordinates WHERE entity_id = ?")
      .get(entityId) as Record<string, unknown> | undefined;
    return row ? this.mapSubordinate(row) : null;
  }

  listSubordinates(
    filter: { status?: SubordinateStatus; isIntermediate?: boolean } = {}
  ): SubordinateRow[] {
    let sql = "SELECT * FROM subordinates WHERE 1=1";
    const params: unknown[] = [];
    if (filter.status) { sql += " AND status = ?"; params.push(filter.status); }
    if (filter.isIntermediate !== undefined) {
      sql += " AND is_intermediate = ?";
      params.push(filter.isIntermediate ? 1 : 0);
    }
    sql += " ORDER BY enrolled_at DESC";
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(this.mapSubordinate.bind(this));
  }

  private mapSubordinate(row: Record<string, unknown>): SubordinateRow {
    return {
      entityId:         row["entity_id"] as string,
      jwksUrl:          row["jwks_url"] as string,
      jwks:             parseJson<{ keys: never[] }>(row["jwks_json"] as string),
      metadata:         parseJson<Record<string, unknown>>(row["metadata_json"] as string),
      status:           row["status"] as SubordinateStatus,
      isIntermediate:   row["is_intermediate"] === 1,
      enrolledAt:       parseDate(row["enrolled_at"] as string)!,
      updatedAt:        parseDate(row["updated_at"] as string)!,
      revocationReason: (row["revocation_reason"] as string | null) ?? null,
      revokedAt:        parseDate(row["revoked_at"] as string | null),
      revokedBy:        (row["revoked_by"] as string | null) ?? null,
      notes:            (row["notes"] as string | null) ?? null,
    };
  }

  // ── Enrollment ──────────────────────────────────────────────────────────

  createEnrollment(
    req: Omit<EnrollmentRequest, "createdAt" | "completedAt" | "rejectedReason">
  ): void {
    this.db
      .prepare(
        `INSERT INTO enrollment_requests
           (id, entity_id, jwks_url, nonce, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.id,
        req.entityId,
        req.jwksUrl,
        req.nonce,
        req.status,
        req.expiresAt.toISOString()
      );
  }

  getEnrollment(id: string): EnrollmentRequest | null {
    const row = this.db
      .prepare("SELECT * FROM enrollment_requests WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapEnrollment(row) : null;
  }

  updateEnrollment(
    id: string,
    status: EnrollmentRequest["status"],
    opts?: { reason?: string }
  ): void {
    this.db
      .prepare(
        `UPDATE enrollment_requests SET
           status           = ?,
           completed_at     = CASE WHEN ? = 'completed' THEN datetime('now','utc') ELSE completed_at END,
           rejected_reason  = CASE WHEN ? IS NOT NULL THEN ? ELSE rejected_reason END
         WHERE id = ?`
      )
      .run(
        status,
        status,
        opts?.reason ?? null, opts?.reason ?? null,
        id
      );
  }

  expireEnrollments(): number {
    const result = this.db
      .prepare(
        `UPDATE enrollment_requests
         SET status = 'expired'
         WHERE status = 'pending' AND expires_at < datetime('now','utc')`
      )
      .run();
    return result.changes;
  }

  private mapEnrollment(row: Record<string, unknown>): EnrollmentRequest {
    return {
      id:              row["id"] as string,
      entityId:        row["entity_id"] as string,
      jwksUrl:         row["jwks_url"] as string,
      nonce:           row["nonce"] as string,
      status:          row["status"] as EnrollmentRequest["status"],
      createdAt:       parseDate(row["created_at"] as string)!,
      expiresAt:       parseDate(row["expires_at"] as string)!,
      completedAt:     parseDate(row["completed_at"] as string | null),
      rejectedReason:  (row["rejected_reason"] as string | null) ?? null,
    };
  }

  // ── Revocations ─────────────────────────────────────────────────────────

  revokeItem(
    entityId: string,
    trustmarkId: string,
    opts?: { reason?: string; actor?: string }
  ): void {
    this.db
      .prepare(
        `INSERT INTO revocations (entity_id, trustmark_id, reason, revoked_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(entity_id, trustmark_id) DO UPDATE SET
           reason      = excluded.reason,
           revoked_at  = datetime('now','utc'),
           revoked_by  = excluded.revoked_by,
           restored_at = NULL`
      )
      .run(entityId, trustmarkId, opts?.reason ?? null, opts?.actor ?? null);
  }

  restoreItem(entityId: string, trustmarkId: string): void {
    this.db
      .prepare(
        `UPDATE revocations
         SET restored_at = datetime('now','utc')
         WHERE entity_id = ? AND trustmark_id = ? AND restored_at IS NULL`
      )
      .run(entityId, trustmarkId);
  }

  isActive(entityId: string, trustmarkId: string): boolean {
    // Revoked if a row exists with restored_at IS NULL
    const row = this.db
      .prepare(
        `SELECT 1 FROM revocations
         WHERE entity_id = ? AND trustmark_id = ? AND restored_at IS NULL`
      )
      .get(entityId, trustmarkId);
    return row === undefined;
  }

  listRevocations(entityId?: string): RevocationRow[] {
    let sql = "SELECT * FROM revocations";
    const params: unknown[] = [];
    if (entityId) { sql += " WHERE entity_id = ?"; params.push(entityId); }
    sql += " ORDER BY revoked_at DESC";
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id:           r["id"] as number,
      entityId:     r["entity_id"] as string,
      trustmarkId:  r["trustmark_id"] as string,
      reason:       (r["reason"] as string | null) ?? null,
      revokedAt:    parseDate(r["revoked_at"] as string)!,
      revokedBy:    (r["revoked_by"] as string | null) ?? null,
      restoredAt:   parseDate(r["restored_at"] as string | null),
    }));
  }

  // ── Audit ────────────────────────────────────────────────────────────────

  audit(
    eventType: string,
    entityId: string | null,
    actor: string | null,
    details?: Record<string, unknown>
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (event_type, entity_id, actor, details_json)
         VALUES (?, ?, ?, ?)`
      )
      .run(eventType, entityId, actor, details ? JSON.stringify(details) : null);
  }

  getAuditLog(limit = 100, entityId?: string): AuditEntry[] {
    let sql =
      "SELECT * FROM audit_log" +
      (entityId ? " WHERE entity_id = ?" : "") +
      " ORDER BY created_at DESC LIMIT ?";
    const params: unknown[] = entityId ? [entityId, limit] : [limit];
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id:        r["id"] as number,
      eventType: r["event_type"] as string,
      entityId:  (r["entity_id"] as string | null) ?? null,
      actor:     (r["actor"] as string | null) ?? null,
      details:   parseJson<Record<string, unknown>>(r["details_json"] as string),
      createdAt: parseDate(r["created_at"] as string)!,
    }));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
