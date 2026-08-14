/**
 * Phase 6.0 — the validate_mcp_invocation MCP tool.
 *
 * Drives the exported tool handler (same code path the MCP CallTool switch uses)
 * against an ES256 trust circle, asserting the human-readable verdict text and
 * the fail-closed behaviour. The underlying verdict logic is covered separately
 * in validate-mcp-invocation.test.mjs (Phase 1); here we prove the tool wrapper:
 * arg validation, inline-JWKS resolution, and ALLOWED/DENIED formatting.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { toolValidateMcpInvocation } from "../dist/index.js";
import {
  provisionMcpTrustCircle,
  issueMcpInvocationToken,
} from "../dist/openid-ops.js";
import {
  makeEs256Provider,
  makeEs256ProviderFactory,
} from "./fixtures/federation-fixtures.mjs";

const TA_ID = "https://trust.letsfederate.org";

async function buildCircle() {
  const ta = makeEs256Provider({ issuer: TA_ID, keyName: "ta" });
  const circle = await provisionMcpTrustCircle({
    trustAnchorEntityId: TA_ID,
    trustAnchorKms: ta,
    issuerBase: "https://fedmgr.local",
    endpointBase: "https://mcp.local",
    subject: "claude-code:test",
    mcpCount: 1,
    entityKmsFactory: makeEs256ProviderFactory("https://fedmgr.local/mcp"),
  });
  const { keys } = await ta.jwks();
  return { ta, circle, jwks: { keys }, reg: circle.registrations[0] };
}

test("tool ALLOWS a valid ES256 invocation (inline JWKS, canonical TA id)", async () => {
  const { circle, jwks, reg } = await buildCircle();
  const text = await toolValidateMcpInvocation({
    subordinate_statement: reg.subordinateStatement,
    entity_statement: reg.entityStatement,
    invocation_token: circle.invocationToken,
    endpoint: reg.endpoint,
    trust_anchor_jwks: jwks,
  });
  assert.match(text, /\[TRUST:VALID\] MCP invocation ALLOWED/);
  assert.match(text, /"trusted": true/);
  assert.match(text, /✓ requiredTrustMarkPresent/);
});

test("tool DENIES when the required trust mark is absent from the invocation JWT", async () => {
  const { ta, circle, jwks, reg } = await buildCircle();
  const tokenWithoutMark = await issueMcpInvocationToken({
    issuer: TA_ID,
    subject: "claude-code:test",
    audiences: circle.audiences,
    kms: ta,
    trustMarks: [],
  });
  const text = await toolValidateMcpInvocation({
    subordinate_statement: reg.subordinateStatement,
    entity_statement: reg.entityStatement,
    invocation_token: tokenWithoutMark,
    endpoint: reg.endpoint,
    trust_anchor_jwks: jwks,
  });
  assert.match(text, /\[TRUST:FAIL\] MCP invocation DENIED/);
  assert.match(text, /✗ requiredTrustMarkPresent/);
});

test("tool DENIES when the endpoint is not in the token aud", async () => {
  const { circle, jwks, reg } = await buildCircle();
  const text = await toolValidateMcpInvocation({
    subordinate_statement: reg.subordinateStatement,
    entity_statement: reg.entityStatement,
    invocation_token: circle.invocationToken,
    endpoint: "https://mcp.local/not-authorized",
    trust_anchor_jwks: jwks,
  });
  assert.match(text, /DENIED/);
  assert.match(text, /✗ invocationAudienceValid/);
});

test("tool rejects a missing required argument (fail-closed at the boundary)", async () => {
  await assert.rejects(
    () =>
      toolValidateMcpInvocation({
        subordinate_statement: "x",
        entity_statement: "y",
        invocation_token: "z",
        // endpoint omitted
      }),
    /missing required string argument "endpoint"/
  );
});
