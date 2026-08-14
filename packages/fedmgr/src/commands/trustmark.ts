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
import fs from "node:fs";
import { importJWK, jwtVerify, decodeProtectedHeader, decodeJwt } from "jose";
import {
  applyPolicy,
  formatTrustMessage,
  assertSafeUrl,
  UrlSafetyError,
  jwsAlgForJwk,
  SUPPORTED_JWS_ALGS,
  type TrustPolicy,
  type TrustResult,
} from "@letsfederate/kms";
import {
  verifyTrustChain,
  verifyTrustMark,
  resolvePinnedAnchor,
  type ChainResult,
  type TrustMarkResult,
  type PinnedAnchor,
} from "@letsfederate/oidf-verify";

const DEFAULT_TMI = "http://localhost:8080";

/** Adapt a §10-verifier result into the TrustResult shape used for formatting/policy. */
function toTrustResult(r: ChainResult | TrustMarkResult): TrustResult {
  const isMark = "issuer" in r;
  return {
    state: r.state,
    subject: r.subject,
    message: r.message,
    ...(r.trustAnchor ? { trustAnchor: r.trustAnchor } : {}),
    ...(isMark && (r as TrustMarkResult).issuer ? { issuer: (r as TrustMarkResult).issuer } : {}),
    ...(isMark && (r as TrustMarkResult).trustMarkType
      ? { trustmarkId: (r as TrustMarkResult).trustMarkType }
      : {}),
    ...("chainDepth" in r && r.chainDepth !== undefined ? { chainDepth: r.chainDepth } : {}),
    ...(r.state !== "VALID"
      ? { recommendedAction: "Ensure the entity/mark chains to your pinned trust anchor with an intact key binding, and (for marks) that the issuer is in the anchor's trust_mark_issuers." }
      : {}),
  };
}

/**
 * Resolve the pinned trust anchor for a CLI trust decision: a --anchor-jwks
 * file (hard pin, preferred) else trust-on-first-use against the anchor URL.
 */
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
        `[TRUST:WARN] trust anchor ${id} not hard-pinned — trusting on first use. ` +
        "Pass --anchor-jwks <file> for a hard pin.\n"
      ),
  });
}
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
    .description(
      "Low-level check that a trustmark JWS verifies against its jku JWKS. " +
      "NOT a trust decision — it trusts the presenter-supplied jku. For an " +
      "authoritative decision, resolve the issuer to a pinned anchor with " +
      "'trustmark check' (chain-rooted, via @letsfederate/oidf-verify)."
    )
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

      process.stderr.write(
        "[TRUST:WARN] 'trustmark verify' checks the signature against the jku JWKS only — " +
        "it does NOT root trust in an anchor. Use 'trustmark check' for an authoritative decision.\n"
      );

      // Try each key in the JWKS until one verifies.
      let verified = false;
      for (const key of jwks.keys) {
        try {
          const jwk = key as Parameters<typeof jwsAlgForJwk>[0];
          const cryptoKey = await importJWK(jwk, jwsAlgForJwk(jwk));
          const { payload } = await jwtVerify(opts.jws, cryptoKey, {
            algorithms: [...SUPPORTED_JWS_ALGS],
          });
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
      "--anchor-jwks <file>",
      "Hard-pin the trust anchor keys from a JWKS JSON file (recommended)"
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
        anchorJwks?: string;
        policy: string;
        json?: boolean;
      }) => {
        const policy = (opts.policy as TrustPolicy) ?? "strict";

        let anchor: PinnedAnchor;
        try {
          anchor = await resolveCliAnchor(opts.ta, opts.anchorJwks);
        } catch (err) {
          process.stderr.write(`${(err as Error).message}\n`);
          process.exit(1);
        }

        // ── Step 1: verify the trust mark (chain-rooted) if provided ─────
        if (opts.jws) {
          const jwsResult = toTrustResult(
            await verifyTrustMark(opts.jws, { trustAnchors: [anchor] })
          );
          if (opts.json) {
            process.stdout.write(JSON.stringify(jwsResult, null, 2) + "\n");
          } else {
            process.stderr.write(formatTrustMessage(jwsResult) + "\n");
            if (jwsResult.recommendedAction) {
              process.stderr.write(`  Recommended: ${jwsResult.recommendedAction}\n`);
            }
          }
          if (jwsResult.state === "INVALID") {
            if (policy === "strict") process.exit(1);
            if (policy === "permissive")
              process.stderr.write("  [TRUST:POLICY] Continuing in permissive mode.\n");
          }
        }

        // ── Step 2: verify the OIDF §10 trust chain ──────────────────────
        const chainResult = toTrustResult(
          await verifyTrustChain(opts.sub, { trustAnchors: [anchor] })
        );

        if (opts.json) {
          process.stdout.write(JSON.stringify(chainResult, null, 2) + "\n");
        } else {
          process.stderr.write(formatTrustMessage(chainResult) + "\n");
          if (chainResult.recommendedAction) {
            process.stderr.write(`  Recommended: ${chainResult.recommendedAction}\n`);
          }
        }

        try {
          applyPolicy(chainResult, policy);
        } catch {
          process.exit(1);
        }
        process.exit(chainResult.state === "VALID" ? 0 : 1);
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
    .option("--ta <url>", "Trust anchor the source mark's issuer must chain to", "https://letsfederate.org")
    .option("--anchor-jwks <file>", "Hard-pin the trust anchor keys from a JWKS JSON file (recommended)")
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
        ta: string;
        anchorJwks?: string;
        id: string;
        ttl: string;
        evidence?: string;
        json?: boolean;
      }) => {
        // ── Validate the source trustmark first — chain-rooted, not jku ───
        process.stderr.write(
          "[trustmark adopt] Verifying source trustmark (chain-rooted) before adoption...\n"
        );
        let sourceResult: TrustResult;
        try {
          const anchor = await resolveCliAnchor(opts.ta, opts.anchorJwks);
          sourceResult = toTrustResult(await verifyTrustMark(opts.source, { trustAnchors: [anchor] }));
        } catch (err) {
          process.stderr.write(`[TRUST:FAIL] ${(err as Error).message}\n`);
          process.exit(1);
        }

        if (sourceResult.state === "INVALID") {
          process.stderr.write(
            formatTrustMessage(sourceResult) + "\n" +
            "  [TRUST:FAIL] Cannot adopt an unverifiable trustmark (issuer must chain to the anchor).\n"
          );
          process.exit(1);
        }
        process.stderr.write(formatTrustMessage(sourceResult) + "\n");

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
