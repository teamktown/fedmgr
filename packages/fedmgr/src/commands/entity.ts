/**
 * fedmgr entity — mint the leaf's own OpenID Federation entity configuration
 * (ADR 0002 G1, the issuing/hosting step).
 *
 *   entity config --entity-id <url> --authority <ta-url> [--endpoint <url>]
 *                 [--key-out <dir>] [--out <file>] [--name <org>] [--require-mark <type>...]
 *
 * Generates (or reuses) the leaf's ES256 keypair, self-signs its entity
 * configuration, and prints it for the operator to host at
 * `<entity-id>/.well-known/openid-federation`. The leaf then enrolls with the TA
 * (proof-of-key) so the TA serves a subordinate statement binding this key — at
 * which point a §10 verifier can resolve the leaf.
 */
import { type Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { type JWK } from "jose";
import { mintLeafKeypair, buildLeafEntityConfig, buildEnrollmentProof } from "../entity-config.js";

export function registerEntityCommands(program: Command): void {
  const entity = program
    .command("entity")
    .description("Mint and manage this entity's OpenID Federation configuration");

  entity
    .command("config")
    .description("Mint the self-signed entity configuration for a leaf (e.g. an MCP server)")
    .requiredOption("--entity-id <url>", "This entity's identifier (its base URL)")
    .requiredOption("--authority <url...>", "Superior entity ID(s) — the TA/intermediate to enroll under")
    .option("--endpoint <url>", "The MCP server's public endpoint (adds mcp_server metadata)")
    .option("--name <org>", "Organization name")
    .option("--require-mark <type...>", "Trust mark type(s) this server requires (advisory)")
    .option("--ttl <seconds>", "Configuration lifetime in seconds", "86400")
    .option("--key-out <dir>", "Directory to write the generated keypair (default: alongside --out or cwd)")
    .option("--out <file>", "Write the entity configuration JWT here (default: stdout)")
    .action(async (opts: {
      entityId: string;
      authority: string[];
      endpoint?: string;
      name?: string;
      requireMark?: string[];
      ttl: string;
      keyOut?: string;
      out?: string;
    }) => {
      const ttl = parseInt(opts.ttl, 10);
      if (Number.isNaN(ttl) || ttl < 60 || ttl > 86400 * 30) {
        process.stderr.write(`[entity config] --ttl must be 60..${86400 * 30} seconds\n`);
        process.exit(1);
      }

      const keyDir = path.resolve(opts.keyOut ?? (opts.out ? path.dirname(path.resolve(opts.out)) : process.cwd()));
      const privPath = path.join(keyDir, "leaf.priv.jwk");
      const pubPath = path.join(keyDir, "leaf.pub.jwk");

      let publicJwk: JWK;
      let privateJwk: JWK;
      if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
        privateJwk = JSON.parse(fs.readFileSync(privPath, "utf8")) as JWK;
        publicJwk = JSON.parse(fs.readFileSync(pubPath, "utf8")) as JWK;
        process.stderr.write(`[entity config] reusing existing keypair at ${keyDir}\n`);
      } else {
        const kp = await mintLeafKeypair();
        publicJwk = kp.publicJwk;
        privateJwk = kp.privateJwk;
        fs.mkdirSync(keyDir, { recursive: true });
        fs.writeFileSync(privPath, JSON.stringify(privateJwk, null, 2), { mode: 0o600 });
        fs.writeFileSync(pubPath, JSON.stringify(publicJwk, null, 2));
        process.stderr.write(`[entity config] minted new ES256 keypair → ${privPath} (0600), ${pubPath}\n`);
      }

      let jwt: string;
      try {
        jwt = await buildLeafEntityConfig({
          entityId: opts.entityId,
          authorityHints: opts.authority,
          privateJwk,
          publicJwk,
          ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
          ...(opts.name ? { organizationName: opts.name } : {}),
          ...(opts.requireMark ? { requiredTrustMarks: opts.requireMark } : {}),
          ttlSeconds: ttl,
        });
      } catch (err) {
        process.stderr.write(`${(err as Error).message}\n`);
        process.exit(1);
      }

      if (opts.out) {
        fs.writeFileSync(opts.out, jwt + "\n");
        process.stderr.write(`[entity config] wrote entity configuration → ${opts.out}\n`);
      } else {
        process.stdout.write(jwt + "\n");
      }

      process.stderr.write(
        "\n[TRUST:NEXT] Host this JWT at:\n" +
        `  ${opts.entityId.replace(/\/$/, "")}/.well-known/openid-federation\n` +
        "  (Content-Type: application/entity-statement+jwt)\n" +
        "Then enroll with your Trust Anchor (proof-of-key) so it serves a subordinate\n" +
        "statement binding this key; a verifier can then resolve your entity.\n"
      );
    });

  entity
    .command("enroll")
    .description("Enroll this entity with a Trust Anchor (proof-of-key, two-step)")
    .requiredOption("--entity-id <url>", "This entity's identifier (must match the hosted configuration)")
    .requiredOption("--ta <url>", "Trust Anchor base URL (e.g. http://localhost:8090)")
    .requiredOption("--jwks-url <url>", "URL where the TA can fetch this entity's JWKS")
    .requiredOption("--key <file>", "Path to the entity's private JWK (from `entity config`)")
    .action(async (opts: { entityId: string; ta: string; jwksUrl: string; key: string }) => {
      const ta = opts.ta.replace(/\/$/, "");
      const privateJwk = JSON.parse(fs.readFileSync(path.resolve(opts.key), "utf8")) as JWK;

      const startRes = await fetch(`${ta}/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity_id: opts.entityId, jwks_url: opts.jwksUrl }),
      });
      const start = (await startRes.json()) as {
        enrollment_id?: string; nonce?: string; error?: string; message?: string;
      };
      if (!startRes.ok || !start.enrollment_id || !start.nonce) {
        process.stderr.write(`[entity enroll] TRUST:FAIL enroll rejected (HTTP ${startRes.status}): ${start.message ?? start.error ?? "unknown"}\n`);
        process.exit(1);
      }
      process.stderr.write(`[entity enroll] challenge received (id=${start.enrollment_id}); signing proof of key ownership\n`);

      const proofJws = await buildEnrollmentProof(start.nonce, opts.entityId, privateJwk);
      const doneRes = await fetch(`${ta}/enroll/${start.enrollment_id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proof_jws: proofJws }),
      });
      const done = (await doneRes.json()) as { entity_id?: string; error?: string; message?: string };
      if (!doneRes.ok) {
        process.stderr.write(`[entity enroll] TRUST:FAIL completion rejected (HTTP ${doneRes.status}): ${done.message ?? done.error ?? "unknown"}\n`);
        process.exit(1);
      }

      process.stderr.write(
        `[entity enroll] TRUST:OK ${opts.entityId} is now an active subordinate of ${ta}\n` +
        `  subordinate statement: ${ta}/federation_fetch?sub=${encodeURIComponent(opts.entityId)}\n` +
        "A §10 verifier can now resolve this entity's chain to the anchor.\n"
      );
    });
}
