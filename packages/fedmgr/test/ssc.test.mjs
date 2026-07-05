import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTrivyFindings, enforceGate, scanTarget } from "../dist/ssc.js";

function have(bin) {
  try {
    execFileSync("sh", ["-c", `command -v ${bin}`], {
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

// A minimal Trivy fs report shape (real key names), with known severity counts.
const FIXTURE = {
  SchemaVersion: 2,
  Results: [
    {
      Target: "package-lock.json",
      Vulnerabilities: [
        { VulnerabilityID: "CVE-A", PkgName: "a", InstalledVersion: "1.0.0", Severity: "CRITICAL" },
        { VulnerabilityID: "CVE-B", PkgName: "b", InstalledVersion: "1.0.0", Severity: "HIGH" },
        { VulnerabilityID: "CVE-C", PkgName: "c", InstalledVersion: "1.0.0", Severity: "HIGH" },
        { VulnerabilityID: "CVE-D", PkgName: "d", InstalledVersion: "1.0.0", Severity: "MEDIUM" },
        { VulnerabilityID: "CVE-E", PkgName: "e", InstalledVersion: "1.0.0", Severity: "LOW" },
      ],
    },
  ],
};

test("parseTrivyFindings tallies severities from the report", () => {
  const r = parseTrivyFindings(FIXTURE);
  assert.equal(r.critical, 1);
  assert.equal(r.high, 2);
  assert.equal(r.medium, 1);
  assert.equal(r.low, 1);
  assert.equal(r.total, 5);
  assert.equal(r.findings.length, 5);
  assert.equal(r.findings[0].id, "CVE-A");
});

test("parseTrivyFindings is robust to empty/garbage input (no throw)", () => {
  assert.equal(parseTrivyFindings("{}").total, 0);
  assert.equal(parseTrivyFindings("not json").total, 0);
  assert.equal(parseTrivyFindings({ Results: null }).total, 0);
});

test("enforceGate blocks any HIGH/CRITICAL by default", () => {
  assert.equal(enforceGate({ critical: 0, high: 0 }).blocked, false);
  const blockedHigh = enforceGate({ critical: 0, high: 1 });
  assert.equal(blockedHigh.blocked, true);
  assert.ok(blockedHigh.reasons.some((r) => /HIGH/i.test(r)));
  const blockedCrit = enforceGate({ critical: 1, high: 0 });
  assert.equal(blockedCrit.blocked, true);
  assert.ok(blockedCrit.reasons.some((r) => /CRITICAL/i.test(r)));
});

test("enforceGate honors a custom policy (boundary check)", () => {
  const policy = { maxCritical: 0, maxHigh: 5 };
  assert.equal(enforceGate({ critical: 0, high: 3 }, policy).blocked, false);
  assert.equal(enforceGate({ critical: 0, high: 6 }, policy).blocked, true);
  assert.equal(enforceGate({ critical: 1, high: 0 }, policy).blocked, true);
});

test(
  "scanTarget runs trivy and returns a well-shaped result (values not asserted — DB drifts)",
  { skip: have("trivy") ? false : "trivy not available" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "ssc-"));
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({
        name: "vuln-demo",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { dependencies: { lodash: "4.17.11" } },
          "node_modules/lodash": {
            version: "4.17.11",
            resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.11.tgz",
            integrity: "sha512-cQKh8igo5QUhZ7lg38DYWAxMvjSAKG0A8wGSVimP07SIUEK2UO+arSRKbRZWtelMtN5V0Hkwh5ryOto/SshYIg==",
          },
        },
      }),
    );
    try {
      const r = scanTarget(dir);
      assert.equal(typeof r.critical, "number");
      assert.equal(typeof r.high, "number");
      assert.ok(Array.isArray(r.findings));
      assert.equal(r.total, r.critical + r.high + r.medium + r.low + r.unknown);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
