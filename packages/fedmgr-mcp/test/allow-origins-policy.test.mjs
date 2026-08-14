/**
 * Option G at the policy layer — evaluateOidfTrust's identity well-formedness
 * check (isHttpsUrl) must honor FEDMGR_ALLOW_ORIGINS the same way the kms SSRF
 * guard does, so waypoint admission works in prod posture for explicitly
 * excepted origins. Written BEFORE the implementation (TDD).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildOidfTrustExtension, evaluateOidfTrust } from "../dist/index.js";

const ENV = ["FEDMGR_ALLOW_ORIGINS", "NODE_ENV"];
function withEnv(env, fn) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    return fn();
  } finally {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const ANCHOR = "http://localhost:8090";
const ext = buildOidfTrustExtension({
  entityId: "http://localhost:9631/mcp/fedmgr-mcp",
  trustAnchor: ANCHOR,
  trustMarks: [],
});

test("prod + no allowlist: http identities are malformed ⇒ deny (fail-closed, unchanged)", () => {
  withEnv({}, () => {
    const d = evaluateOidfTrust(ext, { acceptedAnchors: [ANCHOR] });
    assert.equal(d.admit, false);
    assert.match(d.reasons.join(" "), /https/);
  });
});

test("prod + allowlisted origins: the same identities admit", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "http://localhost:9631,http://localhost:8090" }, () => {
    const d = evaluateOidfTrust(ext, { acceptedAnchors: [ANCHOR] });
    assert.equal(d.admit, true, d.reasons.join("; "));
  });
});

test("allowlist is exact: listing only the entity origin still rejects the http anchor", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "http://localhost:9631" }, () => {
    const d = evaluateOidfTrust(ext, { acceptedAnchors: [ANCHOR] });
    assert.equal(d.admit, false);
  });
});

test("legacy NODE_ENV=development still admits (back-compat)", () => {
  withEnv({ NODE_ENV: "development" }, () => {
    const d = evaluateOidfTrust(ext, { acceptedAnchors: [ANCHOR] });
    assert.equal(d.admit, true);
  });
});
