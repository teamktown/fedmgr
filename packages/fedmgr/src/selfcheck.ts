/**
 * Validate-before-run — since npm has no code signing, we ship a checksums
 * manifest inside the package and verify our own files against it, failing fast
 * on mismatch. Honest about the limit: this proves tarball self-consistency,
 * not authorship (authorship rides npm/sigstore provenance). See
 * docs/dev/init-mint-ca.md's sibling: the manifest is generated at publish by
 * scripts/gen-provenance.mjs.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Recursively list files under `dir` matching one of `exts`. */
export function listFilesRec(dir: string, exts: string[] = [".js"]): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFilesRec(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/** Write a `<sha256>  <relpath>` manifest for `files` (relative to `root`). */
export function writeChecksums(root: string, files: string[], outPath: string): number {
  const lines = files
    .map((f) => {
      const rel = relative(root, f);
      const hash = createHash("sha256").update(readFileSync(f)).digest("hex");
      return `${hash}  ${rel}`;
    })
    .sort();
  writeFileSync(outPath, lines.join("\n") + "\n");
  return lines.length;
}

export interface ChecksumVerdict {
  ok: boolean;
  reasons: string[];
  checked: number;
}

/** Verify files under `root` against the manifest. `ok` requires at least one
 *  checked file and zero mismatches/missing. Never throws. */
export function verifyChecksums(root: string, manifestPath: string): ChecksumVerdict {
  if (!existsSync(manifestPath)) {
    return { ok: false, reasons: [`no manifest at ${manifestPath}`], checked: 0 };
  }
  const lines = readFileSync(manifestPath, "utf8").split("\n").filter((l) => l.trim());
  const reasons: string[] = [];
  let checked = 0;
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{64})\s+(.+)$/i);
    if (!m) continue;
    const [, expected, rel] = m;
    const path = resolve(root, rel);
    if (!existsSync(path)) {
      reasons.push(`missing file ${rel}`);
      continue;
    }
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (actual !== expected.toLowerCase()) reasons.push(`checksum mismatch for ${rel}`);
    else checked += 1;
  }
  if (checked === 0 && reasons.length === 0) reasons.push("manifest had no entries");
  return { ok: reasons.length === 0 && checked > 0, reasons, checked };
}
