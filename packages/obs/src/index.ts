/**
 * @letsfederate/obs — fedmgr observability core.
 *
 * Structured/syslog dual-format logging (one LOG_LEVEL) + OpenTelemetry-API
 * spans named for trust operations. Logs to stderr; near-zero cost; no forced
 * exporter. See logger.ts and trace.ts for detail.
 */
export { createLogger, log, type Logger, type Level, type Fields } from "./logger.js";
export { withSpan, TRUST_SPANS, type TrustSpan } from "./trace.js";
