/**
 * Phase 5 — canonical SSRF URL guard (review Finding #10).
 *
 * assertSafeUrl is the SINGLE source of truth now imported by kms, fedmgr-mcp,
 * ta-server and fedmgr-cli (the three duplicate copies were deleted). This suite
 * pins the union of behaviours those copies had, so the consolidation can never
 * silently weaken SSRF protection.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeUrl, UrlSafetyError } from "../dist/index.js";

/** Run `fn` with NODE_ENV forced to `env`, restoring it afterwards. */
function withEnv(env, fn) {
  const saved = process.env["NODE_ENV"];
  try {
    if (env === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = env;
    fn();
  } finally {
    if (saved === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = saved;
  }
}

const blocked = (url, field = "url") =>
  assert.throws(() => assertSafeUrl(url, field), UrlSafetyError, `expected ${url} blocked`);
const allowed = (url) => assert.ok(assertSafeUrl(url) instanceof URL, `expected ${url} allowed`);

test("allows public HTTPS URLs", () => {
  withEnv(undefined, () => {
    allowed("https://ta.example.com/.well-known/openid-federation");
    allowed("https://8.8.8.8/jwks"); // public IP literal
  });
});

test("rejects malformed URLs and non-HTTP(S) schemes", () => {
  withEnv(undefined, () => {
    blocked("not a url");
    blocked("ftp://example.com");
    blocked("file:///etc/passwd");
  });
});

test("http: blocked in production, allowed in development", () => {
  withEnv("production", () => blocked("http://example.com"));
  withEnv(undefined, () => blocked("http://example.com")); // default = prod
  withEnv("development", () => allowed("http://example.com"));
});

test("loopback hostnames blocked in prod (localhost, localhost., ::1), allowed in dev", () => {
  withEnv(undefined, () => {
    blocked("https://localhost/x");
    blocked("https://localhost./x"); // trailing-dot variant (was ta-server-only)
    blocked("https://[::1]/x");
  });
  withEnv("development", () => {
    allowed("http://localhost:8090/x");
  });
});

test("private IPv4 ranges blocked (10/172.16-31/192.168/169.254/127)", () => {
  withEnv(undefined, () => {
    blocked("https://10.0.0.5");
    blocked("https://172.16.3.4");
    blocked("https://172.31.255.255");
    blocked("https://192.168.1.1");
    blocked("https://169.254.0.1");
    blocked("https://127.0.0.1");
  });
});

test("127.0.0.1 allowed only in development", () => {
  withEnv("development", () => allowed("http://127.0.0.1:8090"));
  withEnv(undefined, () => blocked("https://127.0.0.1"));
});

test("IPv6 link-local (fe80::) blocked", () => {
  withEnv(undefined, () => {
    blocked("https://[fe80::1]");
  });
});
