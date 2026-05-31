-- fedmgr Trust Anchor — initial schema
-- Supports SQLite (local dev) and PostgreSQL (production) with compatible syntax.
-- Run via FederationStore.migrate() at startup.

PRAGMA journal_mode = WAL;   -- SQLite: better read concurrency
PRAGMA foreign_keys = ON;

-- ── subordinates ──────────────────────────────────────────────────────────
-- Every entity the TA can vouch for (leaf or intermediate).
-- status: pending | active | revoked | decommissioned
--   pending       — enrollment started, nonce not yet verified
--   active        — JWKS verified, TA will issue subordinate statements
--   revoked       — explicitly revoked; still in list but marked inactive
--   decommissioned — removed from federation_list, subordinate statements 404

CREATE TABLE IF NOT EXISTS subordinates (
  entity_id          TEXT    PRIMARY KEY,
  jwks_url           TEXT    NOT NULL,
  jwks_json          TEXT,                -- JSON: cached { keys: [...] }
  metadata_json      TEXT,                -- JSON: federation_entity metadata block
  status             TEXT    NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','active','revoked','decommissioned')),
  is_intermediate    INTEGER NOT NULL DEFAULT 0,   -- 1 if has federation_fetch_endpoint
  enrolled_at        TEXT    NOT NULL DEFAULT (datetime('now','utc')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now','utc')),
  revocation_reason  TEXT,
  revoked_at         TEXT,
  revoked_by         TEXT,
  notes              TEXT
);

CREATE INDEX IF NOT EXISTS idx_subordinates_status ON subordinates (status);

-- ── enrollment_requests ───────────────────────────────────────────────────
-- Pending enrollment challenges (nonce-based proof-of-key-ownership).
-- status: pending | completed | expired | rejected

CREATE TABLE IF NOT EXISTS enrollment_requests (
  id           TEXT PRIMARY KEY,              -- UUID
  entity_id    TEXT NOT NULL,
  jwks_url     TEXT NOT NULL,
  nonce        TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','completed','expired','rejected')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','utc')),
  expires_at   TEXT NOT NULL,                -- ISO-8601; 10 min default
  completed_at TEXT,
  rejected_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_enrollment_entity ON enrollment_requests (entity_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_status ON enrollment_requests (status);

-- ── revocations ───────────────────────────────────────────────────────────
-- Trust-mark revocations: individual trustmarks revoked without decommissioning
-- the entire entity. Also used by the /trust-mark-status endpoint.

CREATE TABLE IF NOT EXISTS revocations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id     TEXT    NOT NULL,
  trustmark_id  TEXT    NOT NULL,
  reason        TEXT,
  revoked_at    TEXT    NOT NULL DEFAULT (datetime('now','utc')),
  revoked_by    TEXT,
  restored_at   TEXT,                -- NULL = still revoked; set when un-revoked
  UNIQUE (entity_id, trustmark_id)   -- only one active revocation per (sub, id) pair
);

CREATE INDEX IF NOT EXISTS idx_revocations_entity ON revocations (entity_id);

-- ── audit_log ─────────────────────────────────────────────────────────────
-- Immutable record of every significant federation event.
-- Never deleted; supports compliance and incident investigation.

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type   TEXT    NOT NULL,  -- enroll_started | enroll_completed | enroll_rejected
                                   -- subordinate_activated | subordinate_revoked
                                   -- subordinate_decommissioned | trustmark_revoked
                                   -- trustmark_restored | config_changed
  entity_id    TEXT,
  actor        TEXT,               -- IP, user-agent, or service identifier
  details_json TEXT,               -- event-specific JSON payload
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','utc'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_event  ON audit_log (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_time   ON audit_log (created_at);
