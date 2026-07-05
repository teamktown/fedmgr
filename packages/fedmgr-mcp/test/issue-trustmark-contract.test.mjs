/**
 * Phase 2 — MCP ↔ TMI/TA contract tests (review Findings #2 and #7).
 *
 * #2: the `issue_trustmark` tool builds a POST body for the TMI. These tests
 *     validate that body against the SAME schema the TMI server enforces
 *     (`IssueRequestSchema`, imported from @letsfederate/tmi-server) so field
 *     drift fails here instead of silently dropping the caller's ttl / trustmark
 *     type (Zod strips unknown keys and applies defaults).
 * #7: trustmarks are signed by the TMI, so any JWKS override for verification
 *     must point at the TMI, never the TA.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildIssueTrustmarkBody } from "../dist/index.js";
import { IssueRequestSchema } from "@letsfederate/tmi-server/dist/schemas.js";

const CUSTOM_MARK = "https://letsfederate.org/trustmarks/Custom_v1";

test("#2 issue body validates against the TMI schema and PRESERVES ttl + trustmark type", () => {
  const body = buildIssueTrustmarkBody({
    subject_url: "https://mcp.example.com",
    ttl_seconds: 7200,
    trustmark_id: CUSTOM_MARK,
  });
  const parsed = IssueRequestSchema.safeParse(body);
  assert.equal(
    parsed.success,
    true,
    `schema rejected body: ${JSON.stringify(parsed.error?.flatten?.())}`
  );
  // The caller's values must SURVIVE into the validated request — not be
  // silently dropped to schema defaults (the Finding #2 bug).
  assert.equal(parsed.data.ttl_s, 7200);
  assert.equal(parsed.data.trustmark_id, CUSTOM_MARK);
});

test("#2 issue body uses the schema field names (ttl_s/trustmark_id), not ttl/id", () => {
  const body = buildIssueTrustmarkBody({
    subject_url: "https://mcp.example.com",
    ttl_seconds: 7200,
    trustmark_id: CUSTOM_MARK,
  });
  assert.equal(body.ttl_s, 7200);
  assert.equal(body.trustmark_id, CUSTOM_MARK);
  assert.equal(body.ttl, undefined, "must not emit the wrong key `ttl`");
  assert.equal(body.id, undefined, "must not emit the wrong key `id`");
});

test("#2 issue body omits unset optionals; TMI applies its defaults", () => {
  const body = buildIssueTrustmarkBody({ subject_url: "https://mcp.example.com" });
  const parsed = IssueRequestSchema.safeParse(body);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.sub, "https://mcp.example.com");
  assert.equal(parsed.data.ttl_s, 3600); // schema default
});

// #7 (obsolete): the old jku-override path is gone. verify_trustmark no longer
// trusts the mark's jku at all — it resolves the issuer through the pinned trust
// anchor (§10) and checks trust_mark_issuers. See verify-trustmark.test.mjs.
