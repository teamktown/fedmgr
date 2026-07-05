/**
 * fedmgr CLI — command registry (one openssl-style front door)
 *
 * Subcommands:
 *   init                Mint a local trust ecosystem on this machine
 *   doctor              Check the host can mint/run the ecosystem
 *   keys init softkms   Generate encrypted JWK pair via step CLI
 *   trustmark issue     POST to TMI and print the signed JWS
 *   oci attach          Attach a trustmark as a cosign attestation
 *   search <query>      Semantic search over federation entities
 */
import { Command } from "commander";
import { registerInitCommands } from "./commands/init.js";
import { registerDoctorCommands } from "./commands/doctor.js";
import { registerCbomCommands } from "./commands/cbom.js";
import { registerKeysCommands } from "./commands/keys.js";
import { registerTrustmarkCommands } from "./commands/trustmark.js";
import { registerOciCommands } from "./commands/oci.js";
import { registerSearchCommands } from "./commands/search.js";

export const program = new Command("fedmgr")
  .description("fedmgr — one front door for OpenID Federation trust in MCP")
  .version("0.0.1")
  .allowUnknownOption(false);

registerInitCommands(program);
registerDoctorCommands(program);
registerCbomCommands(program);
registerKeysCommands(program);
registerTrustmarkCommands(program);
registerOciCommands(program);
registerSearchCommands(program);
