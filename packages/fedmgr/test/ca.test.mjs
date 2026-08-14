import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caPaths, verifyCa, acceptCa, mintLocalCa } from "../dist/ca.js";

/*
 * Fixtures below were minted by `step` (smallstep) — see docs/dev/init-mint-ca.md.
 * They are verified in these tests by Node's OWN X.509 parser (node:crypto),
 * a DIFFERENT tool than the one that produced them. That cross-tool agreement
 * is the whole point: a green here means two independent implementations concur.
 */
const GOOD_CA = `-----BEGIN CERTIFICATE-----
MIIBcjCCARigAwIBAgIRAKCjY7kSy6bbyOyzlN4kIJwwCgYIKoZIzj0EAwIwFzEV
MBMGA1UEAxMMdGVzdCByb290IGNhMB4XDTI2MDcwNTAyMzgyMFoXDTM2MDcwMjAy
MzgyMFowFzEVMBMGA1UEAxMMdGVzdCByb290IGNhMFkwEwYHKoZIzj0CAQYIKoZI
zj0DAQcDQgAETdhfaSc5yN8/6WXY/gOiSk2pU6ndJI3i5TYgrAGnD6Cf3i6rRKCJ
dN8kY1sEnxVX2LpW5svpWcoKYcMIqaJsOKNFMEMwDgYDVR0PAQH/BAQDAgEGMBIG
A1UdEwEB/wQIMAYBAf8CAQEwHQYDVR0OBBYEFCWzCMuwvTIGuilvWYduSgrkDGH/
MAoGCCqGSM49BAMCA0gAMEUCIQDCiaCkCOVrVkCBJL7F4FcbYlaIc7qF8XUG34ty
mEX52QIgH8u7D1WO7WFRKTlOliaS0NDfInQE2rb4AQeT5nMG6ZQ=
-----END CERTIFICATE-----
`;

const LEAF = `-----BEGIN CERTIFICATE-----
MIIBtDCCAVmgAwIBAgIRAOQahp3SpECzF2AHHh8JcIkwCgYIKoZIzj0EAwIwFzEV
MBMGA1UEAxMMdGVzdCByb290IGNhMB4XDTI2MDcwNTAyMzgyMFoXDTI3MDcwNTAy
MzgyMFowFDESMBAGA1UEAxMJdGVzdCBsZWFmMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEWCkQwrX2tXCGjsv4PPP976u8fP1VAFnJmyatxvCCyEDul5FTzMy87mik
IvUpvl+tfyvLDGzlLF99/tzOP5MHn6OBiDCBhTAOBgNVHQ8BAf8EBAMCB4AwHQYD
VR0lBBYwFAYIKwYBBQUHAwEGCCsGAQUFBwMCMB0GA1UdDgQWBBQYeWSd72OssBJd
v/4TEg2D66CKPjAfBgNVHSMEGDAWgBQlswjLsL0yBropb1mHbkoK5Axh/zAUBgNV
HREEDTALggl0ZXN0IGxlYWYwCgYIKoZIzj0EAwIDSQAwRgIhAKznL2r2CIlPPpWD
ENBWAYfzrw4JvJRrfuPnxSM12bSwAiEAyZ1tSg5uERuUUXMle1HfIqQbtchF0AEA
Z1VQFKPq2Dk=
-----END CERTIFICATE-----
`;

function dockerAvailable() {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

test("caPaths returns the ~/.letsfederate/ca layout", () => {
  const p = caPaths("/home/someone");
  assert.equal(p.dir, "/home/someone/.letsfederate/ca");
  assert.equal(p.cert, "/home/someone/.letsfederate/ca/root_ca.crt");
  assert.equal(p.key, "/home/someone/.letsfederate/ca/root_ca.key");
  assert.equal(p.pass, "/home/someone/.letsfederate/ca/.pass");
});

test("verifyCa rejects non-certificate input", () => {
  const v = verifyCa("not a certificate");
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => /x\.?509|parse/i.test(r)), v.reasons.join("; "));
});

test("verifyCa accepts a real root CA (minted by step, checked by node)", () => {
  const v = verifyCa(GOOD_CA);
  assert.equal(v.ok, true, v.reasons.join("; "));
  assert.match(v.subject ?? "", /test root ca/i);
});

test("verifyCa rejects a leaf cert — proves the check is not a rubber stamp", () => {
  const v = verifyCa(LEAF);
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => /CA|self-signed/i.test(r)), v.reasons.join("; "));
});

test("acceptCa installs a valid CA and refuses a leaf", () => {
  const home = mkdtempSync(join(tmpdir(), "ca-accept-"));
  const paths = caPaths(home);
  const goodFile = join(home, "good.crt");
  const leafFile = join(home, "leaf.crt");
  writeFileSync(goodFile, GOOD_CA);
  writeFileSync(leafFile, LEAF);
  try {
    const r = acceptCa(goodFile, paths);
    assert.ok(existsSync(r.cert), "accepted cert written");
    assert.equal(verifyCa(readFileSync(r.cert)).ok, true);
    assert.throws(() => acceptCa(leafFile, paths), /not a valid CA|CA/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test(
  "mintLocalCa really mints a CA that node independently accepts (idempotent)",
  { skip: dockerAvailable() ? false : "docker not available" },
  () => {
    const home = mkdtempSync(join(tmpdir(), "ca-mint-"));
    const paths = caPaths(home);
    try {
      const r = mintLocalCa(paths);
      assert.ok(existsSync(r.cert), "cert written");
      const v = verifyCa(readFileSync(r.cert));
      assert.equal(v.ok, true, v.reasons.join("; "));
      assert.match(v.subject ?? "", /letsfederate/i);

      // idempotent: a second call must not regenerate the cert
      const before = readFileSync(r.cert);
      mintLocalCa(paths);
      assert.deepEqual(readFileSync(r.cert), before);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
