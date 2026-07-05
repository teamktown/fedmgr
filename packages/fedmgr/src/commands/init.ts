/**
 * fedmgr init — mint a local trust ecosystem on the machine running it.
 *
 *   fedmgr init [--dry-run] [--accept-ca <ref>] [--no-up]
 *
 * Runs as a sequence of fail-fast, span-instrumented phases so an operator (or
 * an assistant) can watch exactly where trust is established:
 *
 *   1. validate-before-run   verify our own shipped files against a manifest
 *   2. mint-ca               a local root CA (or accept a provider CA)
 *   3. ecosystem             stand up local registry + Trust Anchor + Trustmark Issuer
 *   4. self-provenance       build waypoint -> SBOM -> sign -> push -> trustmark
 *   5. ssc-gate              no trustmark while any HIGH/CRITICAL finding exists
 *
 * This is the spine: phases 1 and 3 are wired to real work; 2/4/5 log their
 * plan and land in subsequent slices. `--dry-run` prints the plan only.
 */
import { type Command } from "commander";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, withSpan, TRUST_SPANS } from "@letsfederate/obs";
import { caPaths, mintLocalCa, acceptCa, verifyCa } from "../ca.js";
import {
  generateSbom,
  validateSbom,
  ensureCosignKeypair,
  signBlob,
  verifyBlobIndependently,
  toolAvailable,
} from "../provenance.js";
import { scanTarget, enforceGate } from "../ssc.js";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface InitOpts {
  dryRun?: boolean;
  acceptCa?: string;
  up?: boolean; // commander sets this false via --no-up
}

/** Walk up from cwd looking for the lab bring-up script (repo mode). */
function findRepoRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, "examples/lab/up.sh"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Phase 1 — validate before run. npm has no code signing, so we ship a
 * checksums manifest inside the package and verify our own files against it,
 * failing fast on any mismatch. Honest about the limit: this proves tarball
 * self-consistency, not authorship — authorship rides npm/sigstore provenance
 * (publishConfig.provenance). When no manifest is shipped yet, warn (not armed)
 * rather than pretend.
 */
function validateSelf(log: ReturnType<typeof createLogger>): void {
  const manifest = resolve(PKG_ROOT, "provenance", "checksums.txt");
  if (!existsSync(manifest)) {
    log.warn("self-validation not armed", {
      reason: "no provenance/checksums.txt shipped in this build",
      manifest,
    });
    return;
  }
  const lines = readFileSync(manifest, "utf8").split("\n").filter((l) => l.trim());
  let checked = 0;
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{64})\s+(.+)$/i);
    if (!m) continue;
    const [, expected, rel] = m;
    const path = resolve(PKG_ROOT, rel);
    if (!existsSync(path)) {
      throw new Error(`validate-before-run: missing file ${rel}`);
    }
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actual !== expected.toLowerCase()) {
      throw new Error(`validate-before-run: checksum mismatch for ${rel}`);
    }
    checked++;
  }
  log.info("self-validation passed", { files: checked });
}

const PLAN: Array<{ n: number; span: string; title: string; detail: string }> = [
  { n: 1, span: "validate", title: "validate-before-run", detail: "verify our own files vs shipped manifest (fail-fast)" },
  { n: 2, span: TRUST_SPANS.mintCa, title: "mint-ca", detail: "local root CA in ~/.letsfederate/ca (or --accept-ca <ref>)" },
  { n: 3, span: TRUST_SPANS.build, title: "ecosystem", detail: "local registry + Trust Anchor + Trustmark Issuer" },
  { n: 4, span: TRUST_SPANS.sign, title: "self-provenance", detail: "build waypoint -> SBOM -> sign -> push -> trustmark" },
  { n: 5, span: TRUST_SPANS.verify, title: "ssc-gate", detail: "no trustmark while any HIGH/CRITICAL finding exists" },
];

export function registerInitCommands(program: Command): void {
  program
    .command("init")
    .description("Mint a local trust ecosystem on this machine")
    .option("--dry-run", "Print the phased plan without making changes")
    .option("--accept-ca <ref>", "Trust a provider CA instead of minting a local one")
    .option("--no-up", "Skip standing up the ecosystem (validate + plan only)")
    .action(async (opts: InitOpts) => {
      const log = createLogger("init");

      log.info("planning local trust ecosystem", {
        dryRun: Boolean(opts.dryRun),
        target: "this machine (the invoker)",
      });
      for (const p of PLAN) {
        process.stdout.write(`  ${p.n}. ${p.title.padEnd(20)} ${p.detail}\n`);
      }
      process.stdout.write("\n");

      if (opts.dryRun) {
        log.info("dry-run: no changes made");
        return;
      }

      // Phase 1 — real.
      try {
        await withSpan("validate", () => validateSelf(log));
      } catch (err) {
        log.error("validate-before-run failed — aborting", {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      }

      // Phase 2 — mint (or accept) the trust root, then verify it independently.
      await withSpan(TRUST_SPANS.mintCa, () => {
        const paths = caPaths();
        if (opts.acceptCa) {
          const r = acceptCa(opts.acceptCa, paths);
          log.info("accepted provider CA", { ref: opts.acceptCa, cert: r.cert });
        } else {
          const existed = existsSync(paths.cert);
          mintLocalCa(paths);
          log.info(existed ? "local root CA present (reused)" : "minted local root CA", {
            dir: paths.dir,
          });
        }
        // Independent cross-check: node's X.509 parser must agree it's a valid
        // CA — a different tool than the one that produced it. Fail-fast if not.
        const verdict = verifyCa(readFileSync(paths.cert));
        if (!verdict.ok) {
          throw new Error(`CA failed independent verification: ${verdict.reasons.join("; ")}`);
        }
        log.info("CA verified independently", {
          subject: verdict.subject,
          notAfter: verdict.notAfter,
        });
      }).catch((err) => {
        log.error("mint-ca failed — aborting", {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      });

      // Phase 3 — ecosystem (real, repo mode).
      const repoRoot = findRepoRoot();
      if (opts.up === false) {
        log.info("skipping ecosystem bring-up (--no-up)");
      } else if (!repoRoot) {
        log.warn("ecosystem bring-up unavailable", {
          reason: "packaged deploy assets not bundled yet; run from a fedmgr checkout for now",
        });
      } else {
        await withSpan(TRUST_SPANS.build, async () => {
          log.info("standing up local ecosystem", { via: "examples/lab/up.sh" });
          const r = spawnSync("bash", [resolve(repoRoot, "examples/lab/up.sh")], {
            stdio: "inherit",
            cwd: repoRoot,
          });
          if (r.status !== 0) throw new Error(`lab bring-up exited ${r.status}`);
          log.info("ecosystem healthy", { ta: "http://localhost:8090", tmi: "http://localhost:8080" });
        }).catch((err) => {
          log.error("ecosystem bring-up failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          process.exit(1);
        });
      }

      // Phase 4 — self-provenance: SBOM the artifact, sign it, verify the
      // signature with an independent tool (node), fail-fast if it doesn't hold.
      // Self-provenance doesn't need the ecosystem, so it runs even with
      // --no-up (a fast "prove my supply chain" path).
      const haveTool = toolAvailable;
      if (!repoRoot) {
        log.warn("self-provenance unavailable", {
          reason: "packaged assets not bundled yet; run from a checkout",
        });
      } else if (!haveTool("syft") || !haveTool("cosign")) {
        log.warn("self-provenance skipped", {
          reason: "need syft + cosign on PATH (see fedmgr doctor)",
          syft: haveTool("syft"),
          cosign: haveTool("cosign"),
        });
      } else {
        const base = resolve(caPaths().dir, "..");
        const provDir = resolve(base, "provenance");
        const keyDir = resolve(base, "cosign");
        mkdirSync(provDir, { recursive: true });
        // SBOM the workspace root — it carries waypoint's full dependency
        // closure (deps hoist here); the package dir alone catalogs nothing.
        const target = repoRoot;
        const sbom = resolve(provDir, "waypoint.sbom.cdx.json");
        const bundle = `${sbom}.bundle.json`;

        await withSpan(TRUST_SPANS.sbom, () => {
          generateSbom(target, sbom);
          const sv = validateSbom(readFileSync(sbom, "utf8"));
          if (!sv.ok) throw new Error(`SBOM invalid: ${sv.reasons.join("; ")}`);
          if (sv.componentCount === 0) {
            // A valid-but-empty SBOM is a red flag, not a success.
            log.warn("SBOM catalogued zero components — check the scan target", { path: sbom });
          }
          log.info("SBOM generated", {
            target: "workspace (waypoint dependency closure)",
            components: sv.componentCount,
            path: sbom,
          });
        }).catch((err) => {
          log.error("sbom failed — aborting", { error: err instanceof Error ? err.message : String(err) });
          process.exit(1);
        });

        await withSpan(TRUST_SPANS.sign, () => {
          const { pub } = ensureCosignKeypair(keyDir);
          signBlob(sbom, keyDir, bundle);
          const verdict = verifyBlobIndependently(sbom, bundle, pub);
          if (!verdict.ok) {
            throw new Error(`signature failed independent verification: ${verdict.reasons.join("; ")}`);
          }
          log.info("SBOM signed + independently verified", {
            bundle,
            verifier: "node:crypto (not cosign)",
          });
        }).catch((err) => {
          log.error("sign failed — aborting", { error: err instanceof Error ? err.message : String(err) });
          process.exit(1);
        });
      }

      // Phase 5 — SSC enforcement gate: scan and compute the block/allow
      // verdict against the SLA (zero HIGH/CRITICAL). Trust-mark issuance
      // (a later slice) consults this verdict before signing.
      if (!repoRoot) {
        log.warn("ssc-gate skipped", { reason: "run from a checkout" });
      } else if (!haveTool("trivy")) {
        log.warn("ssc-gate skipped", { reason: "trivy not on PATH (see fedmgr doctor)" });
      } else {
        await withSpan(TRUST_SPANS.verify, () => {
          const scan = scanTarget(repoRoot);
          const verdict = enforceGate(scan);
          log.info("SSC scan complete", {
            critical: scan.critical,
            high: scan.high,
            medium: scan.medium,
            low: scan.low,
          });
          if (verdict.blocked) {
            log.warn("TRUST MARK BLOCKED — SLA (zero HIGH/CRITICAL) not met", {
              reasons: verdict.reasons,
              top: scan.findings
                .filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH")
                .slice(0, 5)
                .map((f) => `${f.severity} ${f.id} ${f.pkg}@${f.version}`),
            });
          } else {
            log.info("SSC gate PASSED — safe to issue a trust mark");
          }
        }).catch((err) => {
          log.error("ssc-gate scan failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      log.info("init complete", { note: "run 'fedmgr doctor' to check readiness" });
    });
}
