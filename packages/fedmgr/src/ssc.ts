/**
 * SSC enforcement gate for `fedmgr init` — scan an artifact, tally findings
 * ourselves (not trusting a scanner's summary), and decide block/allow against
 * an explicit policy. See docs/dev/init-ssc-gate.md.
 *
 * The gate LOGIC (parse + policy) is pure and deterministic so its tests don't
 * flake against a moving vuln DB; the live scan is separate.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

const LOCAL_BIN = resolve(homedir(), ".local", "bin");

export interface Finding {
  id: string;
  pkg: string;
  version: string;
  severity: string;
  target?: string;
}

export interface ScanResult {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  total: number;
  findings: Finding[];
}

function empty(): ScanResult {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, total: 0, findings: [] };
}

/** Parse a Trivy JSON report into our own severity tally. Never throws. */
export function parseTrivyFindings(report: string | object): ScanResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let obj: any;
  if (typeof report === "string") {
    try {
      obj = JSON.parse(report);
    } catch {
      return empty();
    }
  } else {
    obj = report;
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  const findings: Finding[] = [];
  const results = Array.isArray(obj?.Results) ? obj.Results : [];
  for (const r of results) {
    const vulns = Array.isArray(r?.Vulnerabilities) ? r.Vulnerabilities : [];
    for (const v of vulns) {
      const sev = String(v?.Severity ?? "UNKNOWN").toUpperCase();
      const key: keyof typeof counts =
        sev === "CRITICAL" ? "critical" : sev === "HIGH" ? "high" : sev === "MEDIUM" ? "medium" : sev === "LOW" ? "low" : "unknown";
      counts[key] += 1;
      findings.push({
        id: String(v?.VulnerabilityID ?? "?"),
        pkg: String(v?.PkgName ?? "?"),
        version: String(v?.InstalledVersion ?? "?"),
        severity: sev,
        target: typeof r?.Target === "string" ? r.Target : undefined,
      });
    }
  }
  const total = counts.critical + counts.high + counts.medium + counts.low + counts.unknown;
  return { ...counts, total, findings };
}

export interface GatePolicy {
  maxCritical: number;
  maxHigh: number;
}

export interface GateVerdict {
  ok: boolean;
  blocked: boolean;
  reasons: string[];
}

/** The SLA: zero HIGH/CRITICAL by default. Pure + explicit. */
export function enforceGate(
  counts: { critical: number; high: number },
  policy: GatePolicy = { maxCritical: 0, maxHigh: 0 },
): GateVerdict {
  const reasons: string[] = [];
  if (counts.critical > policy.maxCritical) {
    reasons.push(`${counts.critical} CRITICAL finding(s) exceed the allowed ${policy.maxCritical}`);
  }
  if (counts.high > policy.maxHigh) {
    reasons.push(`${counts.high} HIGH finding(s) exceed the allowed ${policy.maxHigh}`);
  }
  const blocked = reasons.length > 0;
  return { ok: !blocked, blocked, reasons };
}

/** Run `trivy fs` on a target and return our parsed tally. Requires trivy. */
export function scanTarget(target: string, opts: { timeoutMs?: number } = {}): ScanResult {
  const env = { ...process.env, PATH: `${LOCAL_BIN}:${process.env.PATH ?? ""}` };
  const json = execFileSync(
    "trivy",
    [
      "fs", "--quiet", "--format", "json",
      "--severity", "CRITICAL,HIGH,MEDIUM,LOW",
      "--skip-dirs", "node_modules,SSC/raw,.git",
      target,
    ],
    { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 180000 },
  );
  return parseTrivyFindings(json);
}
