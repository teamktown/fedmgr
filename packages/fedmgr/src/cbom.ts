/**
 * CBOM — a Cryptographic Bill of Materials for fedmgr's own primitives, in
 * CycloneDX 1.6 (native `cryptographic-asset` component type). The EO's
 * supply-chain centerpiece: a machine-readable, assessable crypto inventory.
 * See docs/dev/cbom.md and docs/analysis/post-quantum-readiness.html.
 */

export type Primitive = "signature" | "kem" | "hash" | "key-agree";

export interface CryptoAsset {
  /** Display name, e.g. "ECDSA-P256". */
  name: string;
  /** Where it's used, e.g. "trust-chain-jws". */
  use: string;
  primitive: Primitive;
  /** e.g. "P-256", "ML-KEM-768". */
  parameterSet?: string;
  oid?: string;
  /** true if resistant to a cryptographically-relevant quantum computer. */
  quantumSafe: boolean;
  migrateTo?: string;
  deadline?: string;
  note?: string;
}

/** fedmgr's actual crypto surface (kept in sync with the inventory). */
export const FEDMGR_CRYPTO_ASSETS: CryptoAsset[] = [
  { name: "ECDSA-P256", use: "trust-chain-jws", primitive: "signature", parameterSet: "P-256", oid: "1.2.840.10045.4.3.2", quantumSafe: false, migrateTo: "ML-DSA", deadline: "2031-12-31" },
  { name: "ECDSA-P256", use: "local-ca", primitive: "signature", parameterSet: "P-256", oid: "1.2.840.10045.4.3.2", quantumSafe: false, migrateTo: "ML-DSA", deadline: "2031-12-31" },
  { name: "ECDSA-P256", use: "artifact-signing", primitive: "signature", parameterSet: "P-256", oid: "1.2.840.10045.4.3.2", quantumSafe: false, migrateTo: "ML-DSA", deadline: "2031-12-31" },
  { name: "SHA-256", use: "digest", primitive: "hash", parameterSet: "SHA-256", oid: "2.16.840.1.101.3.4.2.1", quantumSafe: true, note: "Grover-weakened to ~128-bit — acceptable" },
  { name: "X25519MLKEM768", use: "edge-key-exchange", primitive: "kem", parameterSet: "X25519MLKEM768", quantumSafe: true, note: "hybrid PQC key establishment at the exposure edge" },
];

export interface CbomComponent {
  type: "cryptographic-asset";
  name: string;
  cryptoProperties: {
    assetType: "algorithm";
    algorithmProperties: {
      primitive: Primitive;
      parameterSetIdentifier?: string;
      nistQuantumSecurityLevel: number; // 0 = not quantum-safe
    };
    oid?: string;
  };
  properties: { name: string; value: string }[];
}

export interface Cbom {
  bomFormat: "CycloneDX";
  specVersion: "1.6";
  version: number;
  metadata: { component: { type: "application"; name: string } };
  components: CbomComponent[];
}

function toComponent(a: CryptoAsset): CbomComponent {
  const properties = [
    { name: "letsfederate:use", value: a.use },
    { name: "letsfederate:quantumVulnerable", value: String(!a.quantumSafe) },
  ];
  if (a.migrateTo) properties.push({ name: "letsfederate:migrateTo", value: a.migrateTo });
  if (a.deadline) properties.push({ name: "letsfederate:deadline", value: a.deadline });
  if (a.note) properties.push({ name: "letsfederate:note", value: a.note });

  return {
    type: "cryptographic-asset",
    name: a.name,
    cryptoProperties: {
      assetType: "algorithm",
      algorithmProperties: {
        primitive: a.primitive,
        ...(a.parameterSet ? { parameterSetIdentifier: a.parameterSet } : {}),
        // 0 = classical (broken by Shor). Hash/KEM that resist a CRQC get >=1.
        nistQuantumSecurityLevel: a.quantumSafe ? 1 : 0,
      },
      ...(a.oid ? { oid: a.oid } : {}),
    },
    properties,
  };
}

/** Build the CycloneDX 1.6 CBOM from a crypto-asset inventory. */
export function buildCbom(assets: CryptoAsset[] = FEDMGR_CRYPTO_ASSETS): Cbom {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: { component: { type: "application", name: "@letsfederate/fedmgr" } },
    components: assets.map(toComponent),
  };
}

export interface CbomVerdict {
  ok: boolean;
  reasons: string[];
  assetCount: number;
  quantumVulnerable: number;
}

/** Structural validation — every component must be a crypto-asset. Never throws. */
export function validateCbom(doc: string | object): CbomVerdict {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let obj: any;
  if (typeof doc === "string") {
    try {
      obj = JSON.parse(doc);
    } catch {
      return { ok: false, reasons: ["not valid JSON"], assetCount: 0, quantumVulnerable: 0 };
    }
  } else {
    obj = doc;
  }

  const reasons: string[] = [];
  if (obj?.bomFormat !== "CycloneDX") reasons.push('bomFormat is not "CycloneDX"');
  if (!obj?.specVersion) reasons.push("missing specVersion");
  const components = Array.isArray(obj?.components) ? obj.components : [];
  if (components.length === 0) reasons.push("no components");

  let quantumVulnerable = 0;
  for (const c of components) {
    if (c?.type !== "cryptographic-asset" || !c?.cryptoProperties) {
      reasons.push(`component ${c?.name ?? "?"} is not a cryptographic-asset`);
      continue;
    }
    const nist = c.cryptoProperties?.algorithmProperties?.nistQuantumSecurityLevel;
    if (nist === 0) quantumVulnerable += 1;
  }

  return { ok: reasons.length === 0, reasons, assetCount: components.length, quantumVulnerable };
}
