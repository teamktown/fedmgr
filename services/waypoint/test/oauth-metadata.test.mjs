import test from "node:test";
import assert from "node:assert/strict";
import { buildProtectedResourceMetadata } from "../dist/oauth-metadata.js";

test("PRM echoes the resource and lists the authorization server (RFC 9728)", () => {
  const prm = buildProtectedResourceMetadata({
    resource: "https://waypoint.example",
    authorizationServers: ["https://idp.example"],
  });
  assert.equal(prm.resource, "https://waypoint.example");
  assert.deepEqual(prm.authorization_servers, ["https://idp.example"]);
  assert.ok(Array.isArray(prm.bearer_methods_supported) && prm.bearer_methods_supported.length > 0);
});

test("PRM fails closed on missing resource or empty authorization_servers", () => {
  assert.throws(() => buildProtectedResourceMetadata({ resource: "", authorizationServers: ["x"] }));
  assert.throws(() => buildProtectedResourceMetadata({ resource: "https://w", authorizationServers: [] }));
});
