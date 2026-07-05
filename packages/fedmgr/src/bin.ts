#!/usr/bin/env node
/**
 * fedmgr CLI entry point.
 *
 * Registers all command groups and delegates to commander.
 */
import { program } from "./index.js";

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`[fedmgr] fatal: ${String(err)}\n`);
  process.exit(1);
});
