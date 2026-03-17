/**
 * FederationStore — database abstraction for the Trust Anchor.
 *
 * Two implementations:
 *   SqliteFederationStore  — default, zero-config, single-file SQLite
 *   (PostgreSQL adapter — future Increment G)
 *
 * All write operations also append to the audit_log for compliance.
 */

import type { JWK } from "jose";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type SubordinateStatus = "pending" | "active" | "revoked" | "decommissioned";

export interface SubordinateRow {
  entityId: string;
  jwksUrl: string;
  jwks: { keys: JWK[] } | null;
  metadata: Record<string, unknown> | null;
  status: SubordinateStatus;
  isIntermediate: boolean;
  enrolledAt: Date;
  updatedAt: Date;
  revocationReason: string | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  notes: string | null;
}

export interface EnrollmentRequest {
  id: string;
  entityId: string;
  jwksUrl: string;
  nonce: string;
  status: "pending" | "completed" | "expired" | "rejected";
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  rejectedReason: string | null;
}

export interface RevocationRow {
  id: number;
  entityId: string;
  trustmarkId: string;
  reason: string | null;
  revokedAt: Date;
  revokedBy: string | null;
  restoredAt: Date | null;
}

export interface AuditEntry {
  id: number;
  eventType: string;
  entityId: string | null;
  actor: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface FederationStore {
  /** Run database migrations. Called once at startup. */
  migrate(): void;

  // ── Subordinates ──────────────────────────────────────────────────────────

  /** Upsert a subordinate record. */
  upsertSubordinate(
    row: Omit<SubordinateRow, "enrolledAt" | "updatedAt">
  ): void;

  /** Update status (and optional revocation fields). */
  updateSubordinateStatus(
    entityId: string,
    status: SubordinateStatus,
    opts?: { reason?: string; actor?: string }
  ): void;

  /** Look up a single subordinate. Returns null if not found. */
  getSubordinate(entityId: string): SubordinateRow | null;

  /** List all subordinates, optionally filtered by status. */
  listSubordinates(
    filter?: { status?: SubordinateStatus; isIntermediate?: boolean }
  ): SubordinateRow[];

  // ── Enrollment ────────────────────────────────────────────────────────────

  /** Create a new enrollment challenge. */
  createEnrollment(req: Omit<EnrollmentRequest, "createdAt" | "completedAt" | "rejectedReason">): void;

  /** Fetch an enrollment request by ID. */
  getEnrollment(id: string): EnrollmentRequest | null;

  /** Update an enrollment request status. */
  updateEnrollment(
    id: string,
    status: EnrollmentRequest["status"],
    opts?: { reason?: string }
  ): void;

  /** Mark expired enrollment requests as expired (run periodically). */
  expireEnrollments(): number;

  // ── Revocations ───────────────────────────────────────────────────────────

  /** Revoke a specific (sub, trustmark_id) pair. Upserts. */
  revokeItem(
    entityId: string,
    trustmarkId: string,
    opts?: { reason?: string; actor?: string }
  ): void;

  /** Restore (un-revoke) a previously revoked trustmark. */
  restoreItem(entityId: string, trustmarkId: string): void;

  /** Is a (sub, trustmark_id) pair currently active (not revoked)? */
  isActive(entityId: string, trustmarkId: string): boolean;

  /** List all revocations, optionally for a specific entity. */
  listRevocations(entityId?: string): RevocationRow[];

  // ── Audit ─────────────────────────────────────────────────────────────────

  /** Append an audit entry. */
  audit(
    eventType: string,
    entityId: string | null,
    actor: string | null,
    details?: Record<string, unknown>
  ): void;

  /** Fetch recent audit log entries (most recent first). */
  getAuditLog(limit?: number, entityId?: string): AuditEntry[];

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Close the database connection cleanly. */
  close(): void;
}
