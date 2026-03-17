/**
 * fedmgr CLI — command registry
 *
 * Subcommands:
 *   keys init softkms   Generate encrypted JWK pair via step CLI
 *   trustmark issue     POST to TMI and print the signed JWS
 *   oci attach          Attach a trustmark as a cosign attestation
 */
import { Command } from "commander";
import { registerKeysCommands } from "./commands/keys.js";
import { registerTrustmarkCommands } from "./commands/trustmark.js";
import { registerOciCommands } from "./commands/oci.js";

export const program = new Command("fedmgr")
  .description("fedmgr — OpenID Federation tool for MCP trust management")
  .version("0.0.1")
  .allowUnknownOption(false);

registerKeysCommands(program);
registerTrustmarkCommands(program);
registerOciCommands(program);
