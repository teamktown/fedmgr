/**
 * MCP OpenID Federation operations tests.
 *
 * Verifies the convergence contract: OIDF entity/subordinate statements are
 * signed with @letsfederate/ta-server helpers, while endpoint-scoped MCP access
 * is enforced by a separate invocation JWT `aud` claim.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { jwtVerify, importJWK } from "jose";
import { MemoryOpenBaoTransitClient, OpenBaoTransitProvider } from "@letsfederate/kms";
import {
  provisionMcpTrustCircle,
  validateMcpInvocation,
  mcpKeyName,
  MCP_TRUST_MARK_ID,
} from "../dist/openid-ops.js";

function makeProvider(issuer, keyName) {
  return new OpenBaoTransitProvider({ issuer, keyName, client: new MemoryOpenBaoTransitClient() });
}

test("provisions 1 TA and 2 MCP entities with OIDF statements and endpoint audiences", async () => {
  const ta = makeProvider("https://ta.local", "ta-test-key");
  const circle = await provisionMcpTrustCircle({
    trustAnchorEntityId: "https://ta.local",
    trustAnchorKms: ta,
    issuerBase: "https://fedmgr.local",
    endpointBase: "https://mcp.local",
    subject: "claude-code:test",
    mcpCount: 2,
    entityKmsFactory: (mcpId) => makeProvider(`https://fedmgr.local/mcp/${mcpId}`, mcpKeyName(mcpId)),
  });

  assert.equal(circle.registrations.length, 2);
  assert.deepEqual(circle.audiences, ["https://mcp.local/mcp-1", "https://mcp.local/mcp-2"]);
  assert.equal(circle.registrations[0].metadata.federation_entity.trust_marks[0], MCP_TRUST_MARK_ID);

  const { keys } = await ta.jwks();
  const taKey = await importJWK(keys[0], "RS256");
  const access = await jwtVerify(circle.invocationToken, taKey, {
    issuer: "https://ta.local",
    audience: "https://mcp.local/mcp-2",
  });
  assert.deepEqual(access.payload.aud, circle.audiences);

  const result = await validateMcpInvocation({
    trustAnchorJwks: { keys },
    subordinateStatement: circle.registrations[1].subordinateStatement,
    entityStatement: circle.registrations[1].entityStatement,
    invocationToken: circle.invocationToken,
    endpoint: "https://mcp.local/mcp-2",
  });
  assert.equal(result.trusted, true);
  assert.equal(result.entityId, "https://fedmgr.local/mcp/mcp-2");
  assert.equal(result.checks.invocationAudienceValid, true);
});

test("rejects an MCP endpoint absent from the invocation JWT aud claim", async () => {
  const ta = makeProvider("https://ta.local", "ta-test-deny-key");
  const circle = await provisionMcpTrustCircle({
    trustAnchorEntityId: "https://ta.local",
    trustAnchorKms: ta,
    issuerBase: "https://fedmgr.local",
    endpointBase: "https://mcp.local",
    subject: "claude-code:test",
    mcpCount: 1,
    entityKmsFactory: (mcpId) => makeProvider(`https://fedmgr.local/mcp/${mcpId}`, mcpKeyName(mcpId)),
  });
  const { keys } = await ta.jwks();
  await assert.rejects(
    () => validateMcpInvocation({
      trustAnchorJwks: { keys },
      subordinateStatement: circle.registrations[0].subordinateStatement,
      entityStatement: circle.registrations[0].entityStatement,
      invocationToken: circle.invocationToken,
      endpoint: "https://mcp.local/not-authorized",
    }),
    /unexpected "aud" claim value/
  );
});
