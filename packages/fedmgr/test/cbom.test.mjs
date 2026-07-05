import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCbom, validateCbom, FEDMGR_CRYPTO_ASSETS } from "../dist/cbom.js";

test("buildCbom emits a valid CycloneDX 1.6 crypto-asset BOM", () => {
  const bom = buildCbom();
  assert.equal(bom.bomFormat, "CycloneDX");
  assert.equal(bom.specVersion, "1.6");
  assert.ok(Array.isArray(bom.components) && bom.components.length > 0);
  for (const c of bom.components) {
    assert.equal(c.type, "cryptographic-asset");
    assert.equal(c.cryptoProperties.assetType, "algorithm");
    assert.ok(c.cryptoProperties.algorithmProperties.primitive);
  }
});

test("every asset carries a use + a truthful quantum-vulnerable flag", () => {
  const bom = buildCbom();
  for (const c of bom.components) {
    const props = Object.fromEntries(c.properties.map((p) => [p.name, p.value]));
    assert.ok(props["letsfederate:use"], `${c.name} missing use`);
    assert.ok(["true", "false"].includes(props["letsfederate:quantumVulnerable"]));
    // nistQuantumSecurityLevel: 0 for classical, >=1 for PQC/hash-safe
    const nist = c.cryptoProperties.algorithmProperties.nistQuantumSecurityLevel;
    const vulnerable = props["letsfederate:quantumVulnerable"] === "true";
    assert.equal(nist === 0, vulnerable, `${c.name} nist level vs vuln flag mismatch`);
  }
});

test("the ECDSA signatures are flagged vulnerable; KEM + hash are not (tells the truth)", () => {
  const bom = buildCbom();
  const byUse = Object.fromEntries(
    bom.components.map((c) => [
      Object.fromEntries(c.properties.map((p) => [p.name, p.value]))["letsfederate:use"],
      c,
    ]),
  );
  const vuln = (c) =>
    Object.fromEntries(c.properties.map((p) => [p.name, p.value]))["letsfederate:quantumVulnerable"] === "true";
  assert.equal(vuln(byUse["trust-chain-jws"]), true);
  assert.equal(vuln(byUse["local-ca"]), true);
  assert.equal(vuln(byUse["artifact-signing"]), true);
  assert.equal(vuln(byUse["digest"]), false);
  assert.equal(vuln(byUse["edge-key-exchange"]), false);
});

test("validateCbom accepts a built CBOM, rejects junk and an SBOM (not a rubber stamp)", () => {
  const good = validateCbom(buildCbom());
  assert.equal(good.ok, true, good.reasons.join("; "));
  assert.equal(good.assetCount, FEDMGR_CRYPTO_ASSETS.length);
  assert.ok(good.quantumVulnerable >= 3, "at least the 3 ECDSA uses are vulnerable");

  assert.equal(validateCbom({}).ok, false);
  // an ordinary SBOM (components are 'library', no cryptoProperties) must be rejected
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.6", components: [{ type: "library", name: "x" }] };
  const r = validateCbom(sbom);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /crypto/i.test(x)), r.reasons.join("; "));
});

test("validateCbom accepts a JSON string too", () => {
  assert.equal(validateCbom(JSON.stringify(buildCbom())).ok, true);
});
