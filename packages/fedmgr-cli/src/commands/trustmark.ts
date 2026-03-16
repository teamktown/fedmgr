/**
 * fedmgr trustmark — trustmark issuance commands
 *
 * trustmark issue --sub <url> [--id <url>] [--tmi <url>] [--ttl <seconds>]
 *   POSTs to the TMI server and prints the signed JWS trustmark.
 *
 * trustmark verify --jws <token> [--jwks <url>]
 *   Verifies a trustmark JWS against its jku JWKS.
 */
import { type Command } from "commander";
import { importJWK, jwtVerify, decodeProtectedHeader } from "jose";

const DEFAULT_TMI = "http://localhost:8080";
const DEFAULT_TRUSTMARK_ID =
  "https://letsfederate.org/trustmarks/AssessedAndPasses_minQuality_v1";

export function registerTrustmarkCommands(program: Command): void {
  const tm = program
    .command("trustmark")
    .description("Trustmark issuance and verification");

  // ----- issue -----
  tm.command("issue")
    .description("Issue a signed trustmark JWS via the TMI server")
    .requiredOption("--sub <url>", "Entity ID of the subject (URL)")
    .option("--id <url>", "Trustmark type URI", DEFAULT_TRUSTMARK_ID)
    .option("--tmi <url>", "TMI server base URL", DEFAULT_TMI)
    .option("--ttl <seconds>", "Token lifetime in seconds (60-86400)", "3600")
    .option("--image-digest <sha256:...>", "OCI image digest (optional)")
    .option("--repo <url>", "Source repository URL (optional)")
    .option("--evidence <url>", "Evidence URL (optional)")
    .option("--json", "Output full JSON response instead of just the JWS")
    .action(async (opts: {
      sub: string;
      id: string;
      tmi: string;
      ttl: string;
      imageDigest?: string;
      repo?: string;
      evidence?: string;
      json?: boolean;
    }) => {
      const body: Record<string, unknown> = {
        sub: opts.sub,
        trustmark_id: opts.id,
        ttl_s: parseInt(opts.ttl, 10),
      };
      if (opts.imageDigest) body["image_digest"] = opts.imageDigest;
      if (opts.repo)        body["repo"] = opts.repo;
      if (opts.evidence)    body["evidence"] = opts.evidence;

      const url = `${opts.tmi.replace(/\/$/, "")}/trustmarks/issue`;

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        process.stderr.write(
          `[trustmark issue] Cannot reach TMI at ${url}: ${String(err)}\n`
        );
        process.exit(1);
      }

      if (!res.ok) {
        const text = await res.text();
        process.stderr.write(
          `[trustmark issue] TMI returned ${res.status}: ${text}\n`
        );
        process.exit(1);
      }

      const data = (await res.json()) as { trustmark_jws: string; payload: unknown };

      if (opts.json) {
        process.stdout.write(JSON.stringify(data, null, 2) + "\n");
      } else {
        process.stdout.write(data.trustmark_jws + "\n");
      }
    });

  // ----- verify -----
  tm.command("verify")
    .description("Verify a trustmark JWS against its jku JWKS")
    .requiredOption("--jws <token>", "The compact JWS trustmark to verify")
    .option(
      "--jwks <url>",
      "Override JWKS URL (defaults to jku in JWS header)"
    )
    .action(async (opts: { jws: string; jwks?: string }) => {
      let jwksUrl: string;
      try {
        const header = decodeProtectedHeader(opts.jws);
        jwksUrl = opts.jwks ?? (header["jku"] as string);
        if (!jwksUrl) throw new Error("No jku in JWS header and --jwks not supplied");
      } catch (err) {
        process.stderr.write(`[trustmark verify] Header decode failed: ${String(err)}\n`);
        process.exit(1);
      }

      let jwks: { keys: unknown[] };
      try {
        const r = await fetch(jwksUrl);
        if (!r.ok) throw new Error(`JWKS fetch returned ${r.status}`);
        jwks = (await r.json()) as { keys: unknown[] };
      } catch (err) {
        process.stderr.write(`[trustmark verify] JWKS fetch failed (${jwksUrl}): ${String(err)}\n`);
        process.exit(1);
      }

      // Try each key in the JWKS until one verifies.
      let verified = false;
      for (const key of jwks.keys) {
        try {
          const cryptoKey = await importJWK(key as Parameters<typeof importJWK>[0], "ES256");
          const { payload } = await jwtVerify(opts.jws, cryptoKey);
          process.stdout.write("✔ Trustmark JWS verified\n");
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
          verified = true;
          break;
        } catch {
          // Try next key
        }
      }

      if (!verified) {
        process.stderr.write("✘ Trustmark JWS verification FAILED — no matching key in JWKS\n");
        process.exit(1);
      }
    });
}
