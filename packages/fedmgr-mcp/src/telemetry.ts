/**
 * Telemetry — leveled logging + OpenTelemetry tracing for the MCP server.
 *
 * For the newcomer:
 *   - "Logging" answers *what happened* (one line per event, at a severity level).
 *   - "Tracing" answers *how a request flowed* — a `span` is a timed unit of work;
 *     spans nest to form a trace. OpenTelemetry (OTel) is the vendor-neutral
 *     standard for both. See https://opentelemetry.io/docs/concepts/
 *
 * Two defensive rules this module enforces:
 *   1. SECURITY/PROTOCOL: an MCP stdio server speaks JSON-RPC on **stdout**. Logs
 *      MUST go to **stderr** or they corrupt the protocol stream. Everything here
 *      writes to stderr.
 *   2. INVARIANT: telemetry must never break the caller. Every emit is wrapped so
 *      a logging/tracing failure is swallowed, not propagated.
 *
 * Tracing is a no-op until an OTel SDK/exporter is registered (see
 * `initTelemetrySdk`). With no SDK, `withSpan` still runs your function — zero
 * config, zero overhead, no exporter required.
 */
import {
  trace,
  isSpanContextValid,
  SpanStatusCode,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

export const SERVICE_NAME = "fedmgr-mcp";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

// Numeric ordering so a message emits only when its level >= the configured floor.
const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/** Configured minimum level via FEDMGR_LOG_LEVEL (default "info"). */
function configuredLevel(): LogLevel {
  const raw = (process.env["FEDMGR_LOG_LEVEL"] ?? "info").toLowerCase();
  return (raw in LEVEL_ORDER ? (raw as LogLevel) : "info");
}

/** The tracer for this service. No-op until an SDK is registered. */
export const tracer: Tracer = trace.getTracer(SERVICE_NAME);

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  try {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;
    // Correlate the log with the active span (W3C trace context) when present,
    // so a log line can be joined to its trace in a backend.
    const span = trace.getActiveSpan();
    const sc = span?.spanContext();
    // Only attach correlation ids when a real SDK has produced a VALID span
    // context — the default no-op tracer yields all-zero ids, which are noise.
    const correlated = sc && isSpanContextValid(sc);
    const record: Record<string, unknown> = {
      level,
      ts: new Date().toISOString(),
      service: SERVICE_NAME,
      msg,
      ...(correlated ? { trace_id: sc.traceId, span_id: sc.spanId } : {}),
      ...(fields ?? {}),
    };
    process.stderr.write(`${JSON.stringify(record)}\n`);
  } catch {
    // INVARIANT: never let telemetry throw into the caller.
  }
}

/** Leveled logger. Usage: `log.info("enrolled", { entityId })`. */
export const log = {
  trace: (msg: string, fields?: Record<string, unknown>) => emit("trace", msg, fields),
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

/**
 * Run `fn` inside a span. The span is marked OK on success, records the exception
 * and ERROR status on throw, and always ends. The error is re-thrown — telemetry
 * observes, it does not swallow application errors.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) span.setAttributes(attributes);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Optionally wire a real OTel SDK so spans are exported. No-op unless
 * OTEL_EXPORTER_OTLP_ENDPOINT is set. The SDK packages are an OPTIONAL dependency
 * — if they aren't installed we log a warning and continue with no-op tracing, so
 * the server never fails to start over telemetry.
 *
 * To enable export:
 *   npm i @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 fedmgr-mcp
 */
export async function initTelemetrySdk(): Promise<void> {
  if (!process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]) return;
  try {
    // Dynamic import via non-literal specifiers keeps these OPTIONAL packages out
    // of both the default install footprint and the type-checker's resolution
    // (tsc won't error if they aren't installed). They are typed `any` here on
    // purpose — this guarded path only runs when the operator opts in.
    const sdkModule = "@opentelemetry/sdk-node";
    const exporterModule = "@opentelemetry/exporter-trace-otlp-http";
    const { NodeSDK } = (await import(sdkModule)) as { NodeSDK: new (cfg: unknown) => { start: () => void } };
    const { OTLPTraceExporter } = (await import(exporterModule)) as { OTLPTraceExporter: new () => unknown };
    const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter() });
    sdk.start();
    log.info("OpenTelemetry SDK started", {
      endpoint: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
    });
  } catch (err) {
    log.warn("OpenTelemetry SDK requested but not available; tracing is no-op", {
      hint: "npm i @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
