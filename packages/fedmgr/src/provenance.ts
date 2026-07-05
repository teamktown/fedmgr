/**
 * Self-provenance for `fedmgr init` — generate an SBOM and sign it, then prove
 * the signature with an INDEPENDENT tool (Node's crypto, not cosign).
 *
 * syft and cosign are expected in ~/.local/bin; we augment the child PATH so
 * they're found however this is invoked. See docs/dev/init-self-provenance.md.
 */
import { execFileSync } from "node:child_process";
import { createVerify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const LOCAL_BIN = resolve(homedir(), ".local", "bin");

function toolEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${LOCAL_BIN}:${process.env.PATH ?? ""}`, ...extra };
}

/**
 * Is `bin` runnable? Checks against the SAME augmented PATH the tool calls use
 * (not a login shell — that resets PATH from profile and is HOME-sensitive, so
 * it can disagree with where we'd actually find the tool).
 */
export function toolAvailable(bin: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${bin}`], {
      env: toolEnv(),
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Generate a CycloneDX SBOM of a directory via syft. Returns the output path. */
export function generateSbom(target: string, outPath: string): string {
  execFileSync("syft", [`dir:${target}`, "-o", `cyclonedx-json=${outPath}`, "-q"], {
    env: toolEnv(),
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 180000,
  });
  return outPath;
}

export interface SbomVerdict {
  ok: boolean;
  reasons: string[];
  format?: string;
  componentCount?: number;
}

/**
 * Structural validation of an SBOM (not a crypto check): must be CycloneDX with
 * a specVersion and a components array. Catches malformed/empty/wrong-format
 * SBOMs — drift detection, not decoration.
 */
export function validateSbom(doc: string | object): SbomVerdict {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let obj: any;
  if (typeof doc === "string") {
    try {
      obj = JSON.parse(doc);
    } catch {
      return { ok: false, reasons: ["not valid JSON"] };
    }
  } else {
    obj = doc;
  }

  const reasons: string[] = [];
  if (obj?.bomFormat !== "CycloneDX") reasons.push('bomFormat is not "CycloneDX"');
  if (!obj?.specVersion) reasons.push("missing specVersion");
  // components is OPTIONAL in CycloneDX (a valid SBOM may have zero); only
  // reject it when present-but-malformed.
  if (obj?.components !== undefined && !Array.isArray(obj.components)) {
    reasons.push("components is present but not an array");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    format: typeof obj?.bomFormat === "string" ? obj.bomFormat : undefined,
    componentCount: Array.isArray(obj?.components) ? obj.components.length : 0,
  };
}

export interface CosignKeys {
  key: string;
  pub: string;
}

/** Create a cosign keypair in `dir` if absent (empty password). */
export function ensureCosignKeypair(dir: string): CosignKeys {
  const key = resolve(dir, "cosign.key");
  const pub = resolve(dir, "cosign.pub");
  if (existsSync(key) && existsSync(pub)) return { key, pub };
  mkdirSync(dir, { recursive: true });
  execFileSync("cosign", ["generate-key-pair"], {
    cwd: dir,
    env: toolEnv({ COSIGN_PASSWORD: "" }),
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 60000,
  });
  return { key, pub };
}

/** Sign a blob with cosign, writing a Sigstore bundle to `bundleOut`. */
export function signBlob(blobPath: string, keyDir: string, bundleOut: string): string {
  const key = resolve(keyDir, "cosign.key");
  execFileSync(
    "cosign",
    ["sign-blob", "--key", key, "--yes", "--bundle", bundleOut, blobPath],
    { env: toolEnv({ COSIGN_PASSWORD: "" }), stdio: ["ignore", "ignore", "pipe"], timeout: 60000 },
  );
  return bundleOut;
}

/**
 * Verify a cosign blob signature WITHOUT cosign — extract the signature from
 * the Sigstore bundle and check it with node:crypto against the public key.
 * The independent cross-check.
 */
export function verifyBlobIndependently(
  blobPath: string,
  bundlePath: string,
  pubPath: string,
): { ok: boolean; reasons: string[] } {
  let sigB64: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle: any = JSON.parse(readFileSync(bundlePath, "utf8"));
    sigB64 = bundle?.messageSignature?.signature ?? bundle?.base64Signature;
  } catch {
    return { ok: false, reasons: ["bundle is not valid JSON"] };
  }
  if (typeof sigB64 !== "string" || sigB64.length === 0) {
    return { ok: false, reasons: ["no signature found in bundle"] };
  }

  const reasons: string[] = [];
  try {
    const pub = readFileSync(pubPath);
    const blob = readFileSync(blobPath);
    const sig = Buffer.from(sigB64, "base64");
    const v = createVerify("SHA256");
    v.update(blob);
    v.end();
    if (!v.verify(pub, sig)) reasons.push("signature does not verify against the public key");
  } catch (err) {
    reasons.push(`verification error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ok: reasons.length === 0, reasons };
}
