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
import { resolvePinnedAnchor, type PinnedAnchor } from "@letsfederate/oidf-verify";
import {
  assertPinnedSigner,
  verifyEmbeddedTrustmark,
  digestFromImageRef,
} from "../oci-verify.js";

const TRUSTMARK_TYPE = "https://letsfederate.org/oidcfed/trustmark/v1";

/** Resolve a pinned trust anchor for a CLI trust decision (hard-pin | TOFU+warn). */
async function resolveCliAnchor(anchorUrl: string, anchorJwksFile?: string): Promise<PinnedAnchor> {
  let pinnedJwks: { keys: unknown[] } | undefined;
  if (anchorJwksFile) {
    try {
      pinnedJwks = JSON.parse(fs.readFileSync(anchorJwksFile, "utf8")) as { keys: unknown[] };
    } catch (err) {
      throw new Error(`[TRUST:FAIL] cannot read --anchor-jwks ${anchorJwksFile}: ${String(err)}`);
    }
  }
  return resolvePinnedAnchor({
    entityId: anchorUrl,
    ...(pinnedJwks ? { pinnedJwks: pinnedJwks as PinnedAnchor["jwks"] } : {}),
    onTofu: (id) =>
      process.stderr.write(
        `[TRUST:WARN] trust anchor ${id} not hard-pinned — trusting on first use. Pass --anchor-jwks <file>.\n`
      ),
  });
}

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
    .description(
      "Verify the trustmark attestation on an OCI image: a PINNED cosign signer, " +
      "then the embedded trustmark JWS (chain-rooted, §10) bound to the image digest."
    )
    .requiredOption("--image <ref>", "OCI image reference (prefer a digest ref repo@sha256:…)")
    .option("--type <uri>", "Attestation predicate type URI", TRUSTMARK_TYPE)
    .requiredOption(
      "--certificate-identity <id>",
      "Exact cosign signer identity (or use --certificate-identity-regexp with a BOUNDED pattern)"
    )
    .option("--certificate-identity-regexp <re>", "Bounded regexp for the signer identity (not '.+')")
    .requiredOption("--certificate-oidc-issuer <url>", "Exact cosign OIDC issuer")
    .option("--certificate-oidc-issuer-regexp <re>", "Bounded regexp for the OIDC issuer (not '.+')")
    .option("--trust-anchor-url <url>", "Trust anchor the trustmark issuer must chain to", "https://letsfederate.org")
    .option("--anchor-jwks <file>", "Hard-pin the trust anchor keys from a JWKS JSON file")
    .option("--expect-digest <sha256:...>", "Require the trustmark to attest this image digest (else derived from --image)")
    .option("--allow-insecure-registry", "Allow HTTP registry", false)
    .action(async (opts: {
      image: string;
      type: string;
      certificateIdentity?: string;
      certificateIdentityRegexp?: string;
      certificateOidcIssuer?: string;
      certificateOidcIssuerRegexp?: string;
      trustAnchorUrl: string;
      anchorJwks?: string;
      expectDigest?: string;
      allowInsecureRegistry: boolean;
    }) => {
      // 1. Refuse a wildcard signer — the finding was accepting ANY signer.
      //    Checked BEFORE cosign so it fails fast regardless of cosign presence.
      const identity = opts.certificateIdentity ?? opts.certificateIdentityRegexp;
      const issuer = opts.certificateOidcIssuer ?? opts.certificateOidcIssuerRegexp;
      try {
        assertPinnedSigner(identity, issuer);
      } catch (err) {
        process.stderr.write(`${(err as Error).message}\n`);
        process.exit(1);
      }

      assertCosign();

      // 2. cosign verify-attestation, pinning the signer, capturing the DSSE JSON.
      const args = ["verify-attestation", "--type", opts.type];
      if (opts.certificateIdentity) args.push("--certificate-identity", opts.certificateIdentity);
      else args.push("--certificate-identity-regexp", opts.certificateIdentityRegexp!);
      if (opts.certificateOidcIssuer) args.push("--certificate-oidc-issuer", opts.certificateOidcIssuer);
      else args.push("--certificate-oidc-issuer-regexp", opts.certificateOidcIssuerRegexp!);
      if (opts.allowInsecureRegistry) args.push("--allow-insecure-registry");
      args.push(opts.image);

      process.stdout.write(`[oci verify] Running: cosign ${args.join(" ")}\n`);
      const result = spawnSync("cosign", args, { encoding: "utf8" });
      if (result.status !== 0) {
        process.stderr.write((result.stderr ?? "") + "✘ cosign attestation verification failed\n");
        process.exit(1);
      }

      // 3. Verify the EMBEDDED trustmark: chain-rooted + bound to the digest.
      const predicate = extractPredicate(result.stdout);
      if (!predicate) {
        process.stderr.write("[TRUST:FAIL] cosign verified the signature but no attestation predicate could be parsed.\n");
        process.exit(1);
      }
      let anchor: PinnedAnchor;
      try {
        anchor = await resolveCliAnchor(opts.trustAnchorUrl, opts.anchorJwks);
      } catch (err) {
        process.stderr.write(`${(err as Error).message}\n`);
        process.exit(1);
        return;
      }
      const expectedDigest = opts.expectDigest ?? digestFromImageRef(opts.image);
      if (!expectedDigest) {
        process.stderr.write(
          "[TRUST:WARN] no image digest to bind against (pass --image as repo@sha256:… or --expect-digest). " +
          "Verifying the trustmark signature only — NOT that it attests THIS image.\n"
        );
      }
      const verdict = await verifyEmbeddedTrustmark({
        predicate,
        trustAnchors: [anchor],
        ...(expectedDigest ? { expectedDigest } : {}),
      });
      if (!verdict.ok) {
        process.stderr.write(`[TRUST:FAIL] embedded trustmark rejected:\n  - ${verdict.reasons.join("\n  - ")}\n`);
        process.exit(1);
      }
      process.stdout.write(
        `✔ Trustmark attestation verified on ${opts.image}` +
        ` (signer pinned; mark ${verdict.trustMarkType ?? ""} from ${verdict.issuer ?? "?"} chained to ${opts.trustAnchorUrl}` +
        `${expectedDigest ? `; bound to ${expectedDigest}` : ""})\n`
      );
    });
}

/** Extract the attestation predicate from cosign verify-attestation JSON output. */
function extractPredicate(stdout: string | undefined): unknown {
  if (!stdout) return undefined;
  // cosign prints one DSSE envelope per line; the payload is base64 in-toto JSON.
  for (const line of stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    try {
      const env = JSON.parse(line) as { payload?: string };
      if (typeof env.payload === "string") {
        const stmt = JSON.parse(Buffer.from(env.payload, "base64").toString("utf8")) as { predicate?: unknown };
        if (stmt.predicate !== undefined) return stmt.predicate;
      }
    } catch {
      /* not this line */
    }
  }
  return undefined;
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
