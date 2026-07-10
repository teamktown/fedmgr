/**
 * fedmgr keys — key management subcommands
 *
 * keys init softkms [--dir <path>]
 *   Generates an encrypted EC P-256 JWK pair using step CLI.
 *   Private key is PBES2-encrypted (JWE); never stored as plaintext.
 */
import { type Command } from "commander";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_KEYS_DIR = "services/tmi-server/keys";

export function registerKeysCommands(program: Command): void {
  const keys = program.command("keys").description("Key management operations");

  const init = keys
    .command("init")
    .description("Initialize a new signing key pair");

  init
    .command("softkms")
    .description(
      "Generate an EC P-256 JWK pair via step CLI (private key encrypted at rest)"
    )
    .option(
      "--dir <path>",
      "Directory to write keys into",
      DEFAULT_KEYS_DIR
    )
    .option("--force", "Overwrite existing keys", false)
    .action(async (opts: { dir: string; force: boolean }) => {
      assertStepCli();

      const keysDir = path.resolve(opts.dir);
      const passFile = path.join(keysDir, ".pass");
      const pubJwk = path.join(keysDir, "tmi.pub.jwk");
      const privJwe = path.join(keysDir, "tmi.priv.jwe");

      if (!opts.force && fs.existsSync(privJwe)) {
        process.stderr.write(
          `[keys init] Keys already exist at ${keysDir}. Use --force to overwrite.\n`
        );
        process.exit(1);
      }

      fs.mkdirSync(keysDir, { recursive: true });

      // Generate a random passphrase if one doesn't exist.
      if (!fs.existsSync(passFile)) {
        const pass = crypto.randomBytes(32).toString("base64");
        fs.writeFileSync(passFile, pass, { mode: 0o600 });
        process.stdout.write(`[keys init] Generated passphrase at ${passFile}\n`);
      }

      process.stdout.write(`[keys init] Generating EC P-256 JWK pair...\n`);

      execFileSync(
        "step",
        [
          "crypto",
          "jwk",
          "create",
          pubJwk,
          privJwe,
          "--kty",
          "EC",
          "--curve",
          "P-256",
          "--use",
          "sig",
          "--password-file",
          passFile,
          "--force",
        ],
        { stdio: "inherit" }
      );

      // Restrict permissions on encrypted key and passphrase.
      fs.chmodSync(privJwe, 0o600);
      fs.chmodSync(passFile, 0o600);

      process.stdout.write(`\n✔ Keys created:\n`);
      process.stdout.write(`  Public JWK:      ${pubJwk}\n`);
      process.stdout.write(`  Encrypted priv:  ${privJwe}  (PBES2)\n`);
      process.stdout.write(`  Passphrase:      ${passFile}  (chmod 600 — do not commit)\n`);
      process.stdout.write(`\nNext: fedmgr trustmark issue --sub <entity-url>\n`);
    });
}

function assertStepCli(): void {
  try {
    execFileSync("step", ["--version"], { stdio: "pipe" });
  } catch {
    process.stderr.write(
      "[keys init] ERROR: 'step' CLI not found.\n" +
        "Install from https://smallstep.com/docs/step-cli/\n"
    );
    process.exit(1);
  }
}
