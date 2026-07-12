/**
 * Option G — FEDMGR_ALLOW_ORIGINS: explicit, exact-origin exceptions to the
 * strict transport/locality rules, replacing the global NODE_ENV=development
 * foot-gun. Written BEFORE the implementation (TDD).
 *
 * Contract under test:
 *  - unset/empty ⇒ strictest posture (today's production behavior, unchanged)
 *  - an entry allows exactly ONE origin (scheme+host+port): http scheme,
 *    loopback hostnames, and private-IP literals become legal FOR THAT ORIGIN
 *  - anything not listed keeps today's rules (incl. NODE_ENV=development legacy)
 *  - malformed entries fail LOUDLY (misconfig must never fail open or silent)
 *  - non-http(s) schemes and IPv6 link-local stay blocked unconditionally
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeUrl, UrlSafetyError } from "../dist/index.js";

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
const ok = (url) => assert.equal(assertSafeUrl(url).href, new URL(url).href);
const blocked = (url) => assert.throws(() => assertSafeUrl(url), UrlSafetyError);

test("unset ⇒ strict: http, loopback https, private IPs all blocked in prod", () => {
  withEnv({}, () => {
    blocked("http://internal.example:8080/jwks.json");
    blocked("https://localhost:9443/health");
    blocked("http://10.9.9.9:8080/x");
  });
});

test("empty string behaves exactly like unset", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "" }, () => {
    blocked("http://internal.example:8080/x");
  });
});

test("an allowlisted http origin passes in prod — path and query are irrelevant", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "http://internal.example:8080" }, () => {
    ok("http://internal.example:8080/jwks.json");
    ok("http://internal.example:8080/deep/path?q=1");
  });
});

test("the exception is EXACT: other port, host, or scheme is still blocked", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "http://internal.example:8080" }, () => {
    blocked("http://internal.example:9090/x");   // other port
    blocked("http://other.example:8080/x");      // other host
    blocked("http://internal.example/x");        // default port ≠ :8080
  });
});

test("allowlisted https loopback origin passes in prod (option A lab identities)", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "https://localhost:9443,https://localhost:9445" }, () => {
    ok("https://localhost:9443/.well-known/openid-federation");
    ok("https://localhost:9445/mcp/fedmgr-mcp/jwks.json");
    blocked("https://localhost:9999/x"); // loopback port not listed
  });
});

test("allowlisted private-IP origin passes; unlisted private IPs stay blocked even in dev", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "http://10.9.9.9:8080" }, () => {
    ok("http://10.9.9.9:8080/jwks.json");
    blocked("http://10.9.9.10:8080/jwks.json");
  });
  withEnv({ NODE_ENV: "development" }, () => {
    blocked("http://10.9.9.9:8080/jwks.json"); // dev mode never allowed private IPs
  });
});

test("entries normalize: whitespace, trailing slash, host case", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "  http://Internal.Example:8080/ , https://LOCALHOST:9443 " }, () => {
    ok("http://internal.example:8080/x");
    ok("https://localhost:9443/x");
  });
});

test("a malformed entry fails LOUDLY on use, naming the variable", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "http://good.example:8080,not a url" }, () => {
    assert.throws(() => assertSafeUrl("http://good.example:8080/x"), /FEDMGR_ALLOW_ORIGINS/);
  });
});

test("non-http(s) schemes and IPv6 link-local are blocked even when listed", () => {
  withEnv({ FEDMGR_ALLOW_ORIGINS: "ftp://files.example:21" }, () => {
    // the malformed-ish entry is tolerated at parse (it IS a URL) but the
    // scheme check on the *checked* URL still rules:
    blocked("ftp://files.example:21/x");
  });
  withEnv({ FEDMGR_ALLOW_ORIGINS: "http://[fe80::1]:80" }, () => {
    blocked("http://[fe80::1]:80/x");
  });
});

test("legacy NODE_ENV=development behavior is unchanged (back-compat)", () => {
  withEnv({ NODE_ENV: "development" }, () => {
    ok("http://localhost:8090/health");
    ok("http://127.0.0.1:9631/x");
    ok("https://localhost:9443/x");
  });
});
