# @letsfederate/obs

The observability core for [fedmgr](https://github.com/teamktown/fedmgr): a zero-dependency structured
logger plus OpenTelemetry-API spans named for trust operations.

- **Logging** — a global `LOG_LEVEL`, dual syslog-style / JSON output to stderr, LLM-legible. No forced
  exporter, near-zero cost when a level is disabled.
- **Tracing** — `withSpan` over the OTel API (`@opentelemetry/api`), with `TRUST_SPANS` named for the
  operations that matter (mint-ca, build, sbom, sign, push, trustmark, verify). No-ops unless an SDK is
  wired, so it's safe to depend on everywhere.

```ts
import { log, withSpan, TRUST_SPANS } from "@letsfederate/obs";
log.info("minting CA", { home });
await withSpan(TRUST_SPANS.sign, () => signArtifact());
```

MIT.
