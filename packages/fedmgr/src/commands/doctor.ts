/**
 * fedmgr doctor — check the host can mint/run a local trust ecosystem.
 *
 *   fedmgr doctor [--json]
 *
 * Emits a structured diagnosis (one record per check) that is legible to both
 * a human and an LLM/automation. Required checks failing → exit 1. Optional
 * tools only warn — they gate later phases (self-provenance, the SSC gate),
 * not the base lab.
 */
import { type Command } from "commander";
import { execFileSync } from "node:child_process";
import { statfsSync } from "node:fs";
import { createLogger } from "@letsfederate/obs";

type Status = "ok" | "warn" | "fail";

interface Check {
  name: string;
  status: Status;
  detail: string;
  required: boolean;
}

/** Run a command, return trimmed stdout or null if it fails/absent. */
function tryCmd(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 8000,
    }).trim();
  } catch {
    return null;
  }
}

function have(bin: string): boolean {
  // bin is always a hard-coded tool name below — no injection surface.
  try {
    execFileSync("bash", ["-lc", `command -v ${bin}`], {
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function checkNode(): Check {
  const v = process.versions.node;
  const major = Number(v.split(".")[0]);
  return major >= 22
    ? { name: "node", status: "ok", detail: `v${v}`, required: true }
    : {
        name: "node",
        status: "warn",
        detail: `v${v} (engines want >=22; tests run on 18 but images use node:22)`,
        required: true,
      };
}

function checkDocker(): Check {
  if (!have("docker")) {
    return { name: "docker", status: "fail", detail: "not installed — required for the lab", required: true };
  }
  const info = tryCmd("docker", ["info", "--format", "{{.ServerVersion}}"]);
  return info
    ? { name: "docker", status: "ok", detail: `daemon ${info}`, required: true }
    : { name: "docker", status: "fail", detail: "installed but daemon unreachable", required: true };
}

function checkCompose(): Check {
  const v = tryCmd("docker", ["compose", "version", "--short"]);
  return v
    ? { name: "docker compose", status: "ok", detail: `v${v}`, required: true }
    : { name: "docker compose", status: "fail", detail: "docker compose v2 not available", required: true };
}

function checkDisk(): Check {
  try {
    const s = statfsSync(process.cwd());
    const freeGb = (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
    const detail = `${freeGb.toFixed(1)} GB free`;
    // A disk-full event silently NUL-corrupts node_modules (see docs/dev/gotchas.md).
    if (freeGb < 1) return { name: "disk", status: "fail", detail: `${detail} — too low; risk of corrupt installs`, required: true };
    if (freeGb < 3) return { name: "disk", status: "warn", detail: `${detail} — getting tight`, required: false };
    return { name: "disk", status: "ok", detail, required: false };
  } catch {
    return { name: "disk", status: "warn", detail: "could not stat filesystem", required: false };
  }
}

function optional(name: string, bin: string, why: string): Check {
  return have(bin)
    ? { name, status: "ok", detail: "present", required: false }
    : { name, status: "warn", detail: `absent — needed for ${why}`, required: false };
}

function runChecks(): Check[] {
  const checks: Check[] = [
    checkNode(),
    checkDocker(),
    checkCompose(),
    checkDisk(),
    optional("git", "git", "provenance metadata"),
    optional("cosign", "cosign", "signing artifacts (self-provenance)"),
    optional("syft", "syft", "SBOM generation"),
    optional("jq", "jq", "the trust round-trip example"),
  ];
  // SSC scanners gate the trustmark SLA (zero HIGH/CRITICAL).
  const scanners = ["trivy", "osv-scanner", "hadolint", "gitleaks"];
  const present = scanners.filter(have);
  checks.push({
    name: "SSC scanners",
    status: present.length === scanners.length ? "ok" : "warn",
    detail:
      present.length === 0
        ? "none installed — SSC gate disabled (install: SSC/scripts/install-sectools.sh --confirm-install-sectools)"
        : `${present.length}/${scanners.length} present (${present.join(", ")})`,
    required: false,
  });
  return checks;
}

const ICON: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗" };

export function registerDoctorCommands(program: Command): void {
  program
    .command("doctor")
    .description("Check this host can mint and run a local trust ecosystem")
    .option("--json", "Emit the diagnosis as JSON on stdout")
    .action((opts: { json?: boolean }) => {
      const log = createLogger("doctor");
      const checks = runChecks();

      for (const c of checks) {
        const fields = { status: c.status, detail: c.detail, required: c.required };
        if (c.status === "fail") log.error(c.name, fields);
        else if (c.status === "warn") log.warn(c.name, fields);
        else log.info(c.name, fields);
      }

      const requiredFail = checks.some((c) => c.required && c.status === "fail");

      if (opts.json) {
        process.stdout.write(
          JSON.stringify({ ok: !requiredFail, checks }, null, 2) + "\n",
        );
      } else {
        process.stdout.write("\nfedmgr doctor:\n");
        for (const c of checks) {
          process.stdout.write(`  ${ICON[c.status]} ${c.name.padEnd(16)} ${c.detail}\n`);
        }
        process.stdout.write(
          requiredFail
            ? "\n✗ Not ready — resolve the required (✗) items above.\n"
            : "\n✓ Ready to mint a local trust ecosystem (fedmgr init).\n",
        );
      }

      if (requiredFail) process.exit(1);
    });
}
