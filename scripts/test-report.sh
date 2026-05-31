#!/usr/bin/env bash
# scripts/test-report.sh
#
# Run all package test suites with dual output:
#   - spec (human-readable) → stdout
#   - junit XML             → test-results/<package>.junit.xml
#
# Optional: run HSM integration tests when SOFTHSM2_MODULE is set.
#
# Usage:
#   ./scripts/test-report.sh                  # standard suites
#   SOFTHSM2_MODULE=/usr/lib/softhsm/libsofthsm2.so \
#     PKCS11_PIN=testpin \
#     PKCS11_KEY_LABEL=kms-test-key \
#     ./scripts/test-report.sh                # + HSM integration tests

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS="$ROOT/test-results"
mkdir -p "$RESULTS"

# Write a summary line with timestamp
SUMMARY="$RESULTS/summary.log"
echo "=== Test run: $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" > "$SUMMARY"

run_pkg() {
  local pkg="$1"
  local label="$2"
  local xml="$RESULTS/${label}.junit.xml"
  local log="$RESULTS/${label}.log"

  echo ""
  echo "────────────────────────────────────────────"
  echo " $label"
  echo "────────────────────────────────────────────"

  # Build first
  (cd "$ROOT/packages/$pkg" && npm run build --silent) 2>&1

  # Run tests with dual reporter
  (cd "$ROOT/packages/$pkg" && \
    node --test test/*.test.mjs \
      --test-reporter=spec \
      --test-reporter-destination=stdout \
      --test-reporter=junit \
      --test-reporter-destination="$xml" \
  ) 2>&1 | tee "$log"

  # Append pass/fail summary
  local pass fail skip
  pass=$(grep -c '✔' "$log" 2>/dev/null || true)
  fail=$(grep -c '✖' "$log" 2>/dev/null || true)
  skip=$(grep -c '﹣' "$log" 2>/dev/null || true)
  echo "  $label: pass=$pass fail=$fail skip=$skip" >> "$SUMMARY"
}

run_pkg "kms" "kms"
run_pkg "ta-server" "ta-server"
run_pkg "fedmgr-mcp" "fedmgr-mcp"

# ── HSM integration tests (only when SOFTHSM2_MODULE is set) ──────────────
if [ -n "${SOFTHSM2_MODULE:-}" ]; then
  echo ""
  echo "────────────────────────────────────────────"
  echo " kms-hsm (SoftHSM2 integration)"
  echo "────────────────────────────────────────────"
  HSM_LOG="$RESULTS/kms-hsm.log"
  HSM_XML="$RESULTS/kms-hsm.junit.xml"
  (cd "$ROOT/packages/kms" && \
    SOFTHSM2_MODULE="$SOFTHSM2_MODULE" \
    PKCS11_PIN="${PKCS11_PIN:-testpin}" \
    PKCS11_KEY_LABEL="${PKCS11_KEY_LABEL:-kms-test-key}" \
    node --test test/pkcs11.test.mjs \
      --test-reporter=spec \
      --test-reporter-destination=stdout \
      --test-reporter=junit \
      --test-reporter-destination="$HSM_XML" \
  ) 2>&1 | tee "$HSM_LOG"

  pass=$(grep -c '✔' "$HSM_LOG" 2>/dev/null || true)
  fail=$(grep -c '✖' "$HSM_LOG" 2>/dev/null || true)
  skip=$(grep -c '﹣' "$HSM_LOG" 2>/dev/null || true)
  echo "  kms-hsm: pass=$pass fail=$fail skip=$skip" >> "$SUMMARY"
else
  echo "" >> "$SUMMARY"
  echo "  kms-hsm: SKIPPED (SOFTHSM2_MODULE not set)" >> "$SUMMARY"
fi

echo ""
echo "════════════════════════════════════════════"
cat "$SUMMARY"
echo "════════════════════════════════════════════"
echo "JUnit XML:  $RESULTS/*.junit.xml"
echo "Spec logs:  $RESULTS/*.log"
