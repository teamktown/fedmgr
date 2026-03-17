#!/usr/bin/env bash
# scripts/sbom-diff.sh
#
# Compare two CycloneDX JSON SBOMs and print new/removed components.
#
# Usage:
#   ./scripts/sbom-diff.sh <baseline.json> <current.json>
#
# Output lines:
#   NEW:     <name>@<version>   — component present in current but not baseline
#   REMOVED: <name>@<version>   — component present in baseline but not current
#
# Exit code:
#   0 — no new components
#   1 — at least one NEW component found (use in CI to detect supply chain changes)

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <baseline.json> <current.json>" >&2
  exit 2
fi

BASELINE="$1"
CURRENT="$2"

extract_components() {
  # Extract "name@version" for each component in a CycloneDX JSON SBOM
  jq -r '.components[]? | "\(.name)@\(.version // "unknown")"' "$1" | sort -u
}

baseline_components=$(extract_components "$BASELINE")
current_components=$(extract_components "$CURRENT")

new_components=$(comm -13 \
  <(echo "$baseline_components") \
  <(echo "$current_components"))

removed_components=$(comm -23 \
  <(echo "$baseline_components") \
  <(echo "$current_components"))

if [ -n "$new_components" ]; then
  while IFS= read -r comp; do
    [ -n "$comp" ] && echo "NEW:     $comp"
  done <<< "$new_components"
fi

if [ -n "$removed_components" ]; then
  while IFS= read -r comp; do
    [ -n "$comp" ] && echo "REMOVED: $comp"
  done <<< "$removed_components"
fi

# Summary
new_count=$(echo "$new_components" | grep -c . 2>/dev/null || true)
removed_count=$(echo "$removed_components" | grep -c . 2>/dev/null || true)

echo ""
echo "Summary: ${new_count} new, ${removed_count} removed"

if [ "$new_count" -gt 0 ]; then
  exit 1
fi
exit 0
