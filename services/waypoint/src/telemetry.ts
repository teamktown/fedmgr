/**
 * Telemetry for waypoint — leveled stderr logging + OpenTelemetry spans.
 *
 * Mirrors @letsfederate/fedmgr-mcp's telemetry (service name differs); the two
 * could be extracted into a shared package later. Same two rules: logs go to
 * STDERR (stdout is the MCP protocol channel), and telemetry never throws into
 * the caller. Tracing is a no-op until an SDK is registered.
 */
import {
  trace,
  isSpanContextValid,
  SpanStatusCode,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

export const SERVICE_NAME = "waypoint";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
const LEVEL_ORDER: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

function configuredLevel(): LogLevel {
  const raw = (process.env["WAYPOINT_LOG_LEVEL"] ?? process.env["FEDMGR_LOG_LEVEL"] ?? "info").toLowerCase();
  return (raw in LEVEL_ORDER ? (raw as LogLevel) : "info");
}

export const tracer: Tracer = trace.getTracer(SERVICE_NAME);

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  try {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;
    const sc = trace.getActiveSpan()?.spanContext();
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
    /* never let telemetry throw */
  }
}

export const log = {
  trace: (m: string, f?: Record<string, unknown>) => emit("trace", m, f),
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
};

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

/** Optional OTel SDK bootstrap; no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set. */
export async function initTelemetrySdk(): Promise<void> {
  if (!process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]) return;
  try {
    const sdkModule = "@opentelemetry/sdk-node";
    const exporterModule = "@opentelemetry/exporter-trace-otlp-http";
    const { NodeSDK } = (await import(sdkModule)) as { NodeSDK: new (cfg: unknown) => { start: () => void } };
    const { OTLPTraceExporter } = (await import(exporterModule)) as { OTLPTraceExporter: new () => unknown };
    new NodeSDK({ traceExporter: new OTLPTraceExporter() }).start();
    log.info("OpenTelemetry SDK started");
  } catch (err) {
    log.warn("OpenTelemetry SDK requested but not available; tracing is no-op", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
