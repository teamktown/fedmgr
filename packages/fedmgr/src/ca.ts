/**
 * Local trust root for `fedmgr init` — mint a root CA, or accept a provider CA.
 *
 * Minting is delegated to the smallstep step-cli container (no host `step`
 * dependency). Verification is deliberately done by a *different* tool —
 * Node's own X.509 parser — so an accepted/minted CA is only trusted when two
 * independent implementations agree. See docs/dev/init-mint-ca.md.
 */
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface CaPaths {
  dir: string;
  cert: string;
  key: string;
  pass: string;
}

/** The `~/.letsfederate/ca` layout. `home` is injectable for tests. */
export function caPaths(home: string = homedir()): CaPaths {
  const dir = resolve(home, ".letsfederate", "ca");
  return {
    dir,
    cert: resolve(dir, "root_ca.crt"),
    key: resolve(dir, "root_ca.key"),
    pass: resolve(dir, ".pass"),
  };
}

export interface CaVerdict {
  ok: boolean;
  reasons: string[];
  subject?: string;
  issuer?: string;
  notAfter?: string;
}

/**
 * Independently verify that `pem` is a usable root CA, using node:crypto (NOT
 * the tool that produced it). A cert is accepted only if it parses, is a CA,
 * is self-signed with a signature that verifies against its own key, and is
 * currently valid. `reasons` names every failure so callers/tests can assert
 * *why* a bad cert was rejected.
 */
export function verifyCa(pem: string | Buffer): CaVerdict {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch {
    return { ok: false, reasons: ["not a parseable X.509 certificate"] };
  }

  const reasons: string[] = [];
  if (cert.ca !== true) reasons.push("basicConstraints CA is not TRUE");
  if (cert.subject !== cert.issuer) reasons.push("not self-signed (subject != issuer)");

  try {
    if (!cert.verify(cert.publicKey)) reasons.push("self-signature does not verify");
  } catch {
    reasons.push("self-signature could not be checked");
  }

  const now = Date.now();
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  if (Number.isNaN(from) || now < from) reasons.push("not yet valid");
  if (Number.isNaN(to) || now > to) reasons.push("expired");

  return {
    ok: reasons.length === 0,
    reasons,
    subject: cert.subject,
    issuer: cert.issuer,
    notAfter: cert.validTo,
  };
}

export interface MintOpts {
  force?: boolean;
  stepImage?: string;
  /** Root CA validity in days (default ~10 years). */
  days?: number;
}

/**
 * Mint a local root CA into `paths` via the step-cli container. Idempotent:
 * returns the existing CA untouched unless `opts.force`. Runs the container as
 * the host uid so the files are host-owned. Requires Docker.
 */
export function mintLocalCa(paths: CaPaths = caPaths(), opts: MintOpts = {}): CaPaths {
  if (existsSync(paths.cert) && existsSync(paths.key) && !opts.force) return paths;

  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const image = opts.stepImage ?? "smallstep/step-cli:latest";
  const hours = (opts.days ?? 3650) * 24;

  // Inside the container the CA dir is mounted at /ca. Generate a random
  // password, then a self-signed EC P-256 root CA whose key is encrypted with
  // that password. Public cert -> 0644, private key + password -> 0600.
  const script = [
    "set -e",
    "head -c 32 /dev/urandom | base64 > /ca/.pass && chmod 600 /ca/.pass",
    'step certificate create "letsfederate local root CA" /ca/root_ca.crt /ca/root_ca.key' +
      ` --profile root-ca --password-file /ca/.pass --force --not-after ${hours}h`,
    "chmod 644 /ca/root_ca.crt && chmod 600 /ca/root_ca.key",
  ].join(" && ");

  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;

  execFileSync(
    "docker",
    [
      "run", "--rm",
      "-u", `${uid}:${gid}`,
      "-v", `${paths.dir}:/ca`,
      "--entrypoint", "sh",
      image,
      "-c", script,
    ],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 120000 },
  );

  return paths;
}

/**
 * Accept a provider CA instead of minting one. `ref` is a local PEM file path
 * (URL support is a later slice). The cert is verified before it is installed;
 * a non-CA cert is refused.
 */
export function acceptCa(ref: string, paths: CaPaths = caPaths()): CaPaths {
  if (/^https?:\/\//i.test(ref)) {
    throw new Error("accept-ca: URL refs are not supported yet — pass a local PEM file path");
  }
  if (!existsSync(ref)) {
    throw new Error(`accept-ca: no such file: ${ref}`);
  }
  const pem = readFileSync(ref);
  const verdict = verifyCa(pem);
  if (!verdict.ok) {
    throw new Error(`accept-ca: provided cert is not a valid CA: ${verdict.reasons.join("; ")}`);
  }
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  copyFileSync(ref, paths.cert);
  return paths;
}
