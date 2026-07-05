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
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, withSpan, TRUST_SPANS } from "@letsfederate/obs";
import { caPaths, mintLocalCa, acceptCa, verifyCa } from "../ca.js";

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

      // Phases 4 & 5 — planned for the next slices.
      log.info("next phases land in the next slices", {
        pending: ["self-provenance", "ssc-gate"],
      });
      log.info("init complete (spine)", { note: "run 'fedmgr doctor' to check readiness" });
    });
}
