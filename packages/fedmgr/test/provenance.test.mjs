import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateSbom,
  validateSbom,
  ensureCosignKeypair,
  signBlob,
  verifyBlobIndependently,
  toolAvailable,
} from "../dist/provenance.js";

function have(bin) {
  try {
    execFileSync("bash", ["-lc", `command -v ${bin}`], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const MINIMAL_CDX = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  components: [{ type: "library", name: "demo", version: "1.0.0" }],
};

test("toolAvailable finds a real binary and misses a fake one", () => {
  assert.equal(toolAvailable("node"), true);
  assert.equal(toolAvailable("definitely-not-a-real-binary-xyz-123"), false);
});

test("validateSbom accepts a minimal CycloneDX doc", () => {
  const v = validateSbom(MINIMAL_CDX);
  assert.equal(v.ok, true, v.reasons.join("; "));
  assert.equal(v.format, "CycloneDX");
  assert.equal(v.componentCount, 1);
});

test("validateSbom rejects an empty object and an SPDX doc (not a rubber stamp)", () => {
  assert.equal(validateSbom({}).ok, false);
  const spdx = validateSbom({ spdxVersion: "SPDX-2.3", packages: [] });
  assert.equal(spdx.ok, false);
  assert.ok(spdx.reasons.some((r) => /CycloneDX|bomFormat/i.test(r)), spdx.reasons.join("; "));
});

test("validateSbom accepts a JSON string too", () => {
  assert.equal(validateSbom(JSON.stringify(MINIMAL_CDX)).ok, true);
});

test(
  "generateSbom produces a validate-able CycloneDX SBOM (syft produces, our validator checks)",
  { skip: have("syft") ? false : "syft not available" },
  () => {
    const outDir = mkdtempSync(join(tmpdir(), "sbom-"));
    const target = mkdtempSync(join(tmpdir(), "sbom-src-"));
    // Give syft a real dependency to catalog (via package-lock) so the SBOM
    // isn't an empty shell — we assert it actually found a component.
    writeFileSync(
      join(target, "package.json"),
      JSON.stringify({ name: "demo", version: "1.0.0", dependencies: { "left-pad": "1.3.0" } }),
    );
    writeFileSync(
      join(target, "package-lock.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "demo", version: "1.0.0", dependencies: { "left-pad": "1.3.0" } },
          "node_modules/left-pad": {
            version: "1.3.0",
            resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
            integrity: "sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA==",
          },
        },
      }),
    );
    const out = join(outDir, "sbom.cdx.json");
    try {
      generateSbom(target, out);
      assert.ok(existsSync(out), "SBOM written");
      const v = validateSbom(readFileSync(out, "utf8"));
      assert.equal(v.ok, true, v.reasons.join("; "));
      assert.ok(v.componentCount >= 1, `expected >=1 component, got ${v.componentCount}`);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  },
);

test(
  "cosign signs and node independently verifies; a tampered blob is rejected",
  { skip: have("cosign") ? false : "cosign not available" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "sign-"));
    try {
      const { pub } = ensureCosignKeypair(dir);
      const blob = join(dir, "artifact.txt");
      writeFileSync(blob, "waypoint provenance payload\n");
      const bundle = join(dir, "artifact.bundle.json");
      signBlob(blob, dir, bundle);

      // INDEPENDENT: node:crypto, not cosign.
      const good = verifyBlobIndependently(blob, bundle, pub);
      assert.equal(good.ok, true, good.reasons.join("; "));

      // negative: tamper the payload, signature must no longer verify
      writeFileSync(blob, "TAMPERED\n");
      const bad = verifyBlobIndependently(blob, bundle, pub);
      assert.equal(bad.ok, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
