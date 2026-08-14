/**
 * Phase 1 — validateMcpInvocation trust-verdict tests (review Findings #1/#4/#5/#8).
 *
 * These drive the verifier against an ES256 trust circle (the real TA/TMI signing
 * alg, via the Phase 0 fixture) instead of the RS256 in-memory OpenBao path, and
 * assert the defensive, fail-closed contract:
 *   - the required trust mark is enforced from the INVOCATION JWT, not subordinate
 *     metadata (#1);
 *   - audience binding lives on the invocation token and a mismatch yields a
 *     verdict, not a thrown error (#4, #8);
 *   - keys are imported with an alg derived from the JWK, so ES256 works (#5);
 *   - malformed / tampered input returns trusted:false, never throws (#8).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  provisionMcpTrustCircle,
  validateMcpInvocation,
  issueMcpInvocationToken,
  MCP_TRUST_MARK_ID,
} from "../dist/openid-ops.js";
import {
  makeEs256Provider,
  makeEs256ProviderFactory,
} from "./fixtures/federation-fixtures.mjs";

const TA_ENTITY_ID = "https://ta.local";

async function buildEs256Circle({ mcpCount = 1 } = {}) {
  const ta = makeEs256Provider({ issuer: TA_ENTITY_ID, keyName: "ta" });
  const circle = await provisionMcpTrustCircle({
    trustAnchorEntityId: TA_ENTITY_ID,
    trustAnchorKms: ta,
    issuerBase: "https://fedmgr.local",
    endpointBase: "https://mcp.local",
    subject: "claude-code:test",
    mcpCount,
    entityKmsFactory: makeEs256ProviderFactory("https://fedmgr.local/mcp"),
  });
  const { keys } = await ta.jwks();
  return { ta, circle, taJwks: { keys } };
}

test("#5 happy path: ES256-signed circle validates to trusted:true", async () => {
  // WHY: before the fix, importJWK(taKey, "RS256") threw on the ES256 TA key.
  const { circle, taJwks } = await buildEs256Circle();
  const reg = circle.registrations[0];
  const result = await validateMcpInvocation({
    trustAnchorJwks: taJwks,
    subordinateStatement: reg.subordinateStatement,
    entityStatement: reg.entityStatement,
    invocationToken: circle.invocationToken,
    endpoint: reg.endpoint,
  });
  assert.equal(result.trusted, true);
  assert.equal(result.entityId, reg.entityId);
  assert.equal(result.checks.subordinateSignatureValid, true);
  assert.equal(result.checks.entitySelfStatementValid, true);
  assert.equal(result.checks.invocationSignatureValid, true);
  assert.equal(result.checks.invocationAudienceValid, true);
  assert.equal(result.checks.requiredTrustMarkPresent, true);
});

test("#1 denies when the required trust mark is absent from the invocation JWT", async () => {
  const { ta, circle } = await buildEs256Circle();
  const reg = circle.registrations[0];
  // Re-issue an invocation token with NO trust marks (everything else valid).
  const tokenWithoutMark = await issueMcpInvocationToken({
    issuer: TA_ENTITY_ID,
    subject: "claude-code:test",
    audiences: circle.audiences,
    kms: ta,
    trustMarks: [],
  });
  const { keys } = await ta.jwks();
  const result = await validateMcpInvocation({
    trustAnchorJwks: { keys },
    subordinateStatement: reg.subordinateStatement,
    entityStatement: reg.entityStatement,
    invocationToken: tokenWithoutMark,
    endpoint: reg.endpoint,
  });
  assert.equal(result.trusted, false);
  assert.equal(result.checks.requiredTrustMarkPresent, false);
  // signatures still valid — only the trust-mark gate fails
  assert.equal(result.checks.invocationSignatureValid, true);
});

test("#1 denies when the invocation JWT carries a DIFFERENT mark than required", async () => {
  const { ta, circle } = await buildEs256Circle();
  const reg = circle.registrations[0];
  const tokenWrongMark = await issueMcpInvocationToken({
    issuer: TA_ENTITY_ID,
    subject: "claude-code:test",
    audiences: circle.audiences,
    kms: ta,
    trustMarks: ["https://letsfederate.org/trustmarks/SomeOtherMark_v1"],
  });
  const { keys } = await ta.jwks();
  const result = await validateMcpInvocation({
    trustAnchorJwks: { keys },
    subordinateStatement: reg.subordinateStatement,
    entityStatement: reg.entityStatement,
    invocationToken: tokenWrongMark,
    endpoint: reg.endpoint,
    requiredTrustMark: MCP_TRUST_MARK_ID,
  });
  assert.equal(result.trusted, false);
  assert.equal(result.checks.requiredTrustMarkPresent, false);
});

test("#4/#8 endpoint absent from aud → verdict trusted:false, no throw", async () => {
  const { circle, taJwks } = await buildEs256Circle();
  const reg = circle.registrations[0];
  const result = await validateMcpInvocation({
    trustAnchorJwks: taJwks,
    subordinateStatement: reg.subordinateStatement,
    entityStatement: reg.entityStatement,
    invocationToken: circle.invocationToken,
    endpoint: "https://mcp.local/not-authorized",
  });
  assert.equal(result.trusted, false);
  assert.equal(result.checks.invocationAudienceValid, false);
});

test("#8 empty trust-anchor JWKS → trusted:false with an error, no throw", async () => {
  const { circle } = await buildEs256Circle();
  const reg = circle.registrations[0];
  const result = await validateMcpInvocation({
    trustAnchorJwks: { keys: [] },
    subordinateStatement: reg.subordinateStatement,
    entityStatement: reg.entityStatement,
    invocationToken: circle.invocationToken,
    endpoint: reg.endpoint,
  });
  assert.equal(result.trusted, false);
  assert.ok(result.error, "expected an error message in the verdict");
});

test("#8 tampered invocation token → trusted:false, no throw", async () => {
  const { circle, taJwks } = await buildEs256Circle();
  const reg = circle.registrations[0];
  // Corrupt the signature segment of the compact JWS.
  const parts = circle.invocationToken.split(".");
  parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "BB" : "AA");
  const result = await validateMcpInvocation({
    trustAnchorJwks: taJwks,
    subordinateStatement: reg.subordinateStatement,
    entityStatement: reg.entityStatement,
    invocationToken: parts.join("."),
    endpoint: reg.endpoint,
  });
  assert.equal(result.trusted, false);
  assert.equal(result.checks.invocationSignatureValid, false);
});

test("#5 still works on the RS256 OpenBao path (alg derived from JWK)", async () => {
  // Guard against a regression: the alg fix must not break the existing RS256
  // in-memory illustration. Imported lazily to avoid a hard dep when unused.
  const { MemoryOpenBaoTransitClient, OpenBaoTransitProvider } = await import("@letsfederate/kms");
  const mcpKeyName = (await import("../dist/openid-ops.js")).mcpKeyName;
  const makeProvider = (issuer, keyName) =>
    new OpenBaoTransitProvider({ issuer, keyName, client: new MemoryOpenBaoTransitClient() });
  const ta = makeProvider(TA_ENTITY_ID, "ta-rsa");
  const circle = await provisionMcpTrustCircle({
    trustAnchorEntityId: TA_ENTITY_ID,
    trustAnchorKms: ta,
    issuerBase: "https://fedmgr.local",
    endpointBase: "https://mcp.local",
    subject: "claude-code:test",
    mcpCount: 1,
    entityKmsFactory: (mcpId) => makeProvider(`https://fedmgr.local/mcp/${mcpId}`, mcpKeyName(mcpId)),
  });
  const { keys } = await ta.jwks();
  const reg = circle.registrations[0];
  const result = await validateMcpInvocation({
    trustAnchorJwks: { keys },
    subordinateStatement: reg.subordinateStatement,
    entityStatement: reg.entityStatement,
    invocationToken: circle.invocationToken,
    endpoint: reg.endpoint,
  });
  assert.equal(result.trusted, true);
});
