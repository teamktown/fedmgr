/**
 * fedmgr cbom — emit (and optionally sign) a Cryptographic Bill of Materials.
 *
 *   fedmgr cbom                 # print the CycloneDX CBOM (stdout)
 *   fedmgr cbom --out cbom.json # write it to a file
 *   fedmgr cbom --out cbom.json --sign   # + a verifiable cosign signature
 *
 * The EO's "automated crypto-asset assessment" made concrete + honest: it names
 * our ECDSA signatures quantum-vulnerable next to the PQC key exchange we get at
 * the edge. See docs/dev/cbom.md.
 */
import { type Command } from "commander";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@letsfederate/obs";
import { buildCbom, validateCbom } from "../cbom.js";
import { ensureCosignKeypair, signBlob, verifyBlobIndependently, toolAvailable } from "../provenance.js";
import { caPaths } from "../ca.js";

export function registerCbomCommands(program: Command): void {
  program
    .command("cbom")
    .description("Emit a CycloneDX Cryptographic Bill of Materials for fedmgr")
    .option("--out <file>", "Write the CBOM to a file instead of stdout")
    .option("--sign", "Sign the written CBOM via cosign (requires --out; writes <out>.bundle.json)")
    .action((opts: { out?: string; sign?: boolean }) => {
      const log = createLogger("cbom");
      const bom = buildCbom();
      const v = validateCbom(bom);
      const text = JSON.stringify(bom, null, 2);

      if (opts.sign && !opts.out) {
        log.error("--sign requires --out (sign a written file, not a stream)");
        process.exit(1);
      }

      if (!opts.out) {
        process.stdout.write(text + "\n");
        log.info("CBOM emitted", { assets: v.assetCount, quantumVulnerable: v.quantumVulnerable });
        return;
      }

      const out = resolve(opts.out);
      writeFileSync(out, text + "\n");
      log.info("CBOM written", { path: out, assets: v.assetCount, quantumVulnerable: v.quantumVulnerable });

      if (opts.sign) {
        if (!toolAvailable("cosign")) {
          log.error("cannot sign — cosign not on PATH (see fedmgr doctor)");
          process.exit(1);
        }
        const keyDir = resolve(caPaths().dir, "..", "cosign");
        const { pub } = ensureCosignKeypair(keyDir);
        const bundle = `${out}.bundle.json`;
        signBlob(out, keyDir, bundle);
        const verdict = verifyBlobIndependently(out, bundle, pub);
        if (!verdict.ok) {
          log.error("CBOM signature failed independent verification", { reasons: verdict.reasons });
          process.exit(1);
        }
        log.info("CBOM signed + independently verified", { bundle, verifier: "node:crypto (not cosign)" });
      }
    });
}
