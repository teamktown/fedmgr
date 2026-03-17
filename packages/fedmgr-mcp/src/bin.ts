#!/usr/bin/env node
import { startMcpServer } from "./index.js";
startMcpServer().catch((err) => {
  process.stderr.write(`[fedmgr-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
