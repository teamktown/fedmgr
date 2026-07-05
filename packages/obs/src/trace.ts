/**
 * OpenTelemetry spans for fedmgr — via the OTel *API* only.
 *
 * We depend on @opentelemetry/api (tiny, no exporter). With no SDK registered
 * the API returns no-op spans, so instrumenting code costs ~nothing until an
 * operator opts in by wiring an SDK/collector (a compose profile). This keeps
 * the base dependency-light while making every trust operation traceable.
 *
 * Span names map 1:1 to trust operations so an assistant (or a human) can see
 * exactly where trust was established or broke.
 */
import { trace, SpanStatusCode, type Span, type Attributes } from "@opentelemetry/api";

/** Canonical span names for the trust pipeline. */
export const TRUST_SPANS = {
  mintCa: "mint-ca",
  build: "build",
  sbom: "sbom",
  sign: "sign",
  push: "push",
  trustmark: "trustmark",
  verify: "verify",
} as const;

export type TrustSpan = (typeof TRUST_SPANS)[keyof typeof TRUST_SPANS];

const tracer = trace.getTracer("fedmgr");

/**
 * Run `fn` inside an active span. Sets OK on success, ERROR (with message) on
 * throw, and always ends the span. Returns whatever `fn` returns.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attrs: Attributes = {},
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined) span.setAttribute(k, v as never);
      }
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
