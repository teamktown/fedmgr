# init phase 5 — SSC enforcement gate (spec)

**Goal.** Enforce the SLA: **no trust mark while any HIGH/CRITICAL finding
exists.** `init` scans the artifact and computes a block/allow verdict; when
trust-mark issuance lands, issuance consults this verdict.

Spec-first → test-first → code, same as mint-ca / self-provenance.

## Design — separate the deterministic gate from the live scan
Vulnerability databases change daily, so asserting specific CVE counts in tests
would be flaky. We split:

- **`parseTrivyFindings(json)`** — *pure*. Parse a Trivy JSON report into
  `{ critical, high, medium, low, total, findings[] }`. Unit-tested against an
  embedded fixture → deterministic.
- **`enforceGate(counts, policy)`** — *pure*. `policy` defaults to
  `{ maxCritical: 0, maxHigh: 0 }`. Returns `{ ok, blocked, reasons[] }`.
  Unit-tested with synthetic counts, including the boundary (0 = allow, 1 = block).
- **`scanTarget(path)`** — runs `trivy fs` and returns parsed counts. Integration
  test asserts the **shape** (numeric counts, an array of findings), **not**
  specific values — so it never goes red because the vuln DB moved. Skips with a
  reported `# SKIP` when trivy is absent.

## Independence
Trivy emits the raw findings; **our own parser** independently tallies them from
the JSON (we don't trust Trivy's summary line). The gate decision is our code,
not a scanner exit code — so the policy is explicit and auditable. As a second
opinion, `osv-scanner` can be unioned in later (the SSC suite already runs both).

## init phase 5
`scanTarget(workspace)` → `enforceGate(counts)`:
- **allow** → log that the SLA is met (safe to trust-mark).
- **block** → log the verdict with counts + top findings; when issuance is
  wired, it will refuse. Today the repo likely reports HIGH/CRITICAL from its
  dependency tree — so the gate honestly says "blocked," which is the point: it
  surfaces the SLA gap instead of hiding it.

## Test plan (before the code)
Unit (always run):
1. `parseTrivyFindings(fixture)` → the exact counts in the fixture.
2. `parseTrivyFindings("{}")` and malformed input → zero counts, no throw.
3. `enforceGate({critical:0,high:0})` → ok; `{high:1}` → blocked with a reason;
   custom policy `{maxHigh:5}` allows 3 highs. **Boundary + negative cases.**

Integration (trivy-gated — **skips honestly**):
4. `scanTarget(<small dir>)` → returns numeric counts + a findings array
   (shape only, never a hard-coded CVE count).

## Why it matters to users
The gate is auditable policy in code, and its tests are deterministic drift
detection: if Trivy's JSON shape changes, `parseTrivyFindings` fails loudly
rather than silently miscounting and letting a vulnerable build get a trust mark.
