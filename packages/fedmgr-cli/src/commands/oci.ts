/**
 * fedmgr oci — OCI image attestation commands
 *
 * oci attach-trustmark --image <ref> --jws <token> [--registry <url>]
 *   Attaches a trustmark JWS as a cosign attestation on an OCI image.
 *   Requires cosign v2+ in PATH.
 *
 * oci verify-trustmark --image <ref> [--registry <url>] [--jwks <url>]
 *   Fetches and verifies the trustmark attestation on an OCI image.
 */
import { type Command } from "commander";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TRUSTMARK_TYPE = "https://letsfederate.org/oidcfed/trustmark/v1";

export function registerOciCommands(program: Command): void {
  const oci = program
    .command("oci")
    .description("OCI image attestation via cosign");

  // ----- attach-trustmark -----
  oci
    .command("attach-trustmark")
    .description("Attach a trustmark JWS as a cosign attestation")
    .requiredOption("--image <ref>", "OCI image reference (e.g. localhost:5000/myapp:latest)")
    .requiredOption("--jws <token>", "Signed trustmark JWS from `fedmgr trustmark issue`")
    .option("--type <uri>", "Attestation predicate type URI", TRUSTMARK_TYPE)
    .option(
      "--allow-insecure-registry",
      "Allow HTTP (non-TLS) registry (local lab only)",
      false
    )
    .action(async (opts: {
      image: string;
      jws: string;
      type: string;
      allowInsecureRegistry: boolean;
    }) => {
      assertCosign();

      // Write predicate JSON to a temp file — cosign attest requires a file path.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fedmgr-attest-"));
      const predicatePath = path.join(tmpDir, "predicate.json");

      try {
        const predicate = {
          _type: opts.type,
          predicateType: opts.type,
          subject: [],
          predicate: {
            trustmark_jws: opts.jws,
          },
        };
        fs.writeFileSync(predicatePath, JSON.stringify(predicate));

        const args = [
          "attest",
          "--type", opts.type,
          "--predicate", predicatePath,
          "--yes",                         // non-interactive
        ];
        if (opts.allowInsecureRegistry) {
          args.push("--allow-insecure-registry");
        }
        args.push(opts.image);

        process.stdout.write(`[oci attach] Running: cosign ${args.join(" ")}\n`);
        execFileSync("cosign", args, { stdio: "inherit" });
        process.stdout.write(`✔ Trustmark attestation attached to ${opts.image}\n`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

  // ----- verify-trustmark -----
  oci
    .command("verify-trustmark")
    .description("Verify the trustmark attestation on an OCI image")
    .requiredOption("--image <ref>", "OCI image reference")
    .option("--type <uri>", "Attestation predicate type URI", TRUSTMARK_TYPE)
    .option("--jwks <url>", "JWKS URL to verify the trustmark JWS against")
    .option("--certificate-identity-regexp", ".+", "cosign --certificate-identity-regexp")
    .option("--certificate-oidc-issuer-regexp", ".+", "cosign --certificate-oidc-issuer-regexp")
    .option("--allow-insecure-registry", "Allow HTTP registry", false)
    .action((opts: {
      image: string;
      type: string;
      jwks?: string;
      allowInsecureRegistry: boolean;
    }) => {
      assertCosign();

      const args = [
        "verify-attestation",
        "--type", opts.type,
        "--certificate-identity-regexp", ".+",
        "--certificate-oidc-issuer-regexp", ".+",
      ];
      if (opts.allowInsecureRegistry) {
        args.push("--allow-insecure-registry");
      }
      args.push(opts.image);

      process.stdout.write(`[oci verify] Running: cosign ${args.join(" ")}\n`);
      const result = spawnSync("cosign", args, { stdio: "inherit", encoding: "utf8" });
      if (result.status !== 0) {
        process.stderr.write("✘ Attestation verification failed\n");
        process.exit(1);
      }
      process.stdout.write(`✔ Trustmark attestation verified on ${opts.image}\n`);
    });
}

function assertCosign(): void {
  try {
    execFileSync("cosign", ["version"], { stdio: "pipe" });
  } catch {
    process.stderr.write(
      "[oci] ERROR: 'cosign' not found. Install from https://docs.sigstore.dev/cosign/system_config/installation/\n"
    );
    process.exit(1);
  }
}
