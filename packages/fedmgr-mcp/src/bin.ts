#!/usr/bin/env node
import { startMcpServer } from "./index.js";
import { initTelemetrySdk } from "./telemetry.js";

// Wire the OTel SDK if OTEL_EXPORTER_OTLP_ENDPOINT is set (no-op otherwise).
// Guarded inside initTelemetrySdk so telemetry never blocks startup.
await initTelemetrySdk();

startMcpServer().catch((err) => {
  process.stderr.write(`[fedmgr-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
