/**
 * fedmgr trustmark — trustmark issuance, verification, chain-check, and adoption
 *
 * trustmark issue  --sub <url> [--id] [--tmi] [--ttl] [--image-digest] ...
 *   POSTs to the TMI and prints the signed JWS trustmark.
 *
 * trustmark verify --jws <token> [--jwks <url>]
 *   Verifies a trustmark JWS against its jku JWKS.
 *
 * trustmark check  --sub <url> [--ta <url>] [--policy strict|permissive|audit]
 *   Fetches and validates the full OIDF trust chain for a subject entity.
 *   Exits 0 = VALID, 1 = INVALID, 2 = WARN.
 *
 * trustmark adopt  --source <jws> --tmi <url> --sub <url> [--id] [--evidence]
 *   Adopts an existing trustmark: issues a new one from your TMI that cites
 *   the original as evidence.  The adopted_from_iss / adopted_from_id claims
 *   let verifiers trace back to the original issuer's chain.
 */
import { type Command } from "commander";
import { importJWK, jwtVerify, decodeProtectedHeader, decodeJwt } from "jose";
import {
  validateTrustmark,
  validateTrustChain,
  applyPolicy,
  formatTrustMessage,
  assertSafeUrl,
  UrlSafetyError,
  type TrustPolicy,
} from "@letsfederate/kms";

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
      const ttlParsed = parseInt(opts.ttl, 10);
      if (isNaN(ttlParsed) || ttlParsed < 60 || ttlParsed > 86400) {
        process.stderr.write(
          `[trustmark issue] Invalid --ttl "${opts.ttl}": must be an integer between 60 and 86400 seconds.\n`
        );
        process.exit(1);
      }

      const body: Record<string, unknown> = {
        sub: opts.sub,
        trustmark_id: opts.id,
        ttl_s: ttlParsed,
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
        const rawJkuUrl = opts.jwks ?? (header["jku"] as string);
        if (!rawJkuUrl) throw new Error("No jku in JWS header and --jwks not supplied");
        // SSRF protection: block private IPs, loopback, non-HTTPS URLs
        assertSafeUrl(rawJkuUrl, "jku");
        jwksUrl = rawJkuUrl;
      } catch (err) {
        const label = err instanceof UrlSafetyError ? "[TRUST:FAIL] SSRF-unsafe URL" : "[trustmark verify] Header decode failed";
        process.stderr.write(`${label}: ${String(err)}\n`);
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
        process.stderr.write(
          "[TRUST:FAIL] Trustmark JWS verification FAILED — no matching key in JWKS at " +
            jwksUrl +
            "\n" +
            "  Recommended: Verify the TMI JWKS endpoint is up-to-date. " +
            "If keys were rotated, re-issue with: fedmgr trustmark issue --sub <url>\n"
        );
        process.exit(1);
      }
    });

  // ----- check -----
  tm.command("check")
    .description(
      "Validate the full OIDF trust chain for a subject entity (JWS + chain to TA)"
    )
    .requiredOption(
      "--sub <url>",
      "Entity ID of the subject to check (TMI entity URL)"
    )
    .option(
      "--ta <url>",
      "Expected Trust Anchor entity ID",
      "https://letsfederate.org"
    )
    .option(
      "--jws <token>",
      "Trustmark JWS to validate (optional — validates JWS then chain)"
    )
    .option(
      "--policy <mode>",
      "Trust policy: strict (exit 1 on INVALID) | permissive | audit",
      "strict"
    )
    .option("--json", "Output result as JSON")
    .action(
      async (opts: {
        sub: string;
        ta: string;
        jws?: string;
        policy: string;
        json?: boolean;
      }) => {
        const policy = (opts.policy as TrustPolicy) ?? "strict";

        // ── Step 1: validate JWS if provided ────────────────────────────
        if (opts.jws) {
          const jwsResult = await validateTrustmark(opts.jws);
          if (opts.json) {
            process.stdout.write(JSON.stringify(jwsResult, null, 2) + "\n");
          } else {
            process.stderr.write(formatTrustMessage(jwsResult) + "\n");
            if (jwsResult.recommendedAction) {
              process.stderr.write(
                `  Recommended: ${jwsResult.recommendedAction}\n`
              );
            }
          }

          if (jwsResult.state === "INVALID") {
            if (policy === "strict") process.exit(1);
            if (policy === "permissive")
              process.stderr.write(
                "  [TRUST:POLICY] Continuing in permissive mode.\n"
              );
          }
          if (jwsResult.state === "WARN" && policy === "strict") {
            process.exit(2);
          }
        }

        // ── Step 2: validate the OIDF trust chain ────────────────────────
        const chainResult = await validateTrustChain(opts.sub, opts.ta);

        if (opts.json) {
          process.stdout.write(JSON.stringify(chainResult, null, 2) + "\n");
        } else {
          process.stderr.write(formatTrustMessage(chainResult) + "\n");
          if (chainResult.recommendedAction) {
            process.stderr.write(
              `  Recommended: ${chainResult.recommendedAction}\n`
            );
          }
        }

        try {
          applyPolicy(chainResult, policy);
        } catch {
          process.exit(chainResult.state === "WARN" ? 2 : 1);
        }

        if (chainResult.state === "VALID") process.exit(0);
        if (chainResult.state === "WARN") process.exit(2);
        process.exit(1);
      }
    );

  // ----- adopt -----
  tm.command("adopt")
    .description(
      "Adopt an existing trustmark: issue a new one from your TMI that cites the original. " +
        "Creates an 'adopted_from_iss' / 'adopted_from_id' claim chain so verifiers can " +
        "trace back to the original issuer."
    )
    .requiredOption(
      "--source <jws>",
      "The existing trustmark JWS being adopted"
    )
    .requiredOption(
      "--sub <url>",
      "Entity ID of the subject (usually same as in source JWS)"
    )
    .option("--tmi <url>", "Your TMI server base URL", DEFAULT_TMI)
    .option(
      "--id <url>",
      "Your trustmark type URI",
      DEFAULT_TRUSTMARK_ID
    )
    .option("--ttl <seconds>", "Token lifetime in seconds", "3600")
    .option(
      "--evidence <url>",
      "Optional additional evidence URL (source JWS is always included)"
    )
    .option("--json", "Output full JSON response")
    .action(
      async (opts: {
        source: string;
        sub: string;
        tmi: string;
        id: string;
        ttl: string;
        evidence?: string;
        json?: boolean;
      }) => {
        // ── Validate the source trustmark first ──────────────────────────
        process.stderr.write(
          "[trustmark adopt] Validating source trustmark before adoption...\n"
        );
        const sourceResult = await validateTrustmark(opts.source);

        if (sourceResult.state === "INVALID") {
          process.stderr.write(
            formatTrustMessage(sourceResult) + "\n" +
            "  [TRUST:FAIL] Cannot adopt an invalid trustmark.\n" +
            "  Recommended: Obtain a valid trustmark for the source entity first.\n"
          );
          process.exit(1);
        }

        if (sourceResult.state === "WARN") {
          process.stderr.write(
            formatTrustMessage(sourceResult) + "\n" +
            "  [TRUST:WARN] Source trustmark has warnings — proceeding with adoption.\n" +
            "  Recommended: Consider re-issuing the source trustmark before adopting.\n"
          );
        } else {
          process.stderr.write(formatTrustMessage(sourceResult) + "\n");
        }

        // ── Extract source claims for the adopted_from fields ────────────
        let sourceIss = "(unknown)";
        let sourceId = "(unknown)";
        try {
          const decoded = decodeJwt(opts.source) as Record<string, unknown>;
          sourceIss = (decoded["iss"] as string | undefined) ?? "(unknown)";
          sourceId = (decoded["id"] as string | undefined) ?? "(unknown)";
        } catch {
          // Non-fatal — best effort
        }

        // ── Issue the adoption trustmark via your TMI ────────────────────
        const body: Record<string, unknown> = {
          sub: opts.sub,
          trustmark_id: opts.id,
          ttl_s: parseInt(opts.ttl, 10),
          adopted_from_iss: sourceIss,
          adopted_from_id: sourceId,
          adopted_from_jws: opts.source,  // source trustmark embedded as evidence
        };
        if (opts.evidence) body["evidence"] = opts.evidence;

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
            `[TRUST:FAIL] Cannot reach your TMI at ${url}: ${String(err)}\n` +
            "  Recommended: Verify your TMI server is running with: " +
            "npm run tmi:dev  (local) or check the deployment at " + opts.tmi + "\n"
          );
          process.exit(1);
        }

        if (!res.ok) {
          const text = await res.text();
          process.stderr.write(
            `[TRUST:FAIL] TMI returned ${res.status}: ${text}\n` +
            "  Recommended: Check TMI logs for the reason the issuance was rejected.\n"
          );
          process.exit(1);
        }

        const data = (await res.json()) as {
          trustmark_jws: string;
          payload: unknown;
        };

        process.stderr.write(
          `[TRUST:VALID] Adoption trustmark issued — sub=${opts.sub} ` +
          `adopted_from=${sourceIss}\n`
        );

        if (opts.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + "\n");
        } else {
          process.stdout.write(data.trustmark_jws + "\n");
        }
      }
    );
}
