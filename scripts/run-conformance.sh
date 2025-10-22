#!/bin/bash

# run-conformance.sh - Run OpenID Federation conformance suite
# This script is triggered by the `npm version` lifecycle event.
# Results are stored under build/conformance/<version>/ and compared
# against the previous run. The build fails on regression.

set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
RESULTS_DIR="build/conformance/$VERSION"
mkdir -p "$RESULTS_DIR"

CONFORMANCE_IMAGE=${CONFORMANCE_IMAGE:-"ghcr.io/openid/conformance-suite:latest"}

echo "📋 Running conformance suite for version $VERSION..."

docker run --rm \
  -v "$(pwd)":/workspace \
  -v "$(pwd)/$RESULTS_DIR":/workspace/results \
  "$CONFORMANCE_IMAGE" > "$RESULTS_DIR/output.log" 2>&1

echo "✅ Conformance results stored in $RESULTS_DIR" 

# Regression detection
PREV_VERSION=$(ls build/conformance | grep -v "$VERSION" | sort -V | tail -n 1 || true)
if [ -n "$PREV_VERSION" ] && [ -f "build/conformance/$PREV_VERSION/report.json" ] && [ -f "$RESULTS_DIR/report.json" ]; then
    prev_fail=$(jq '.stats.failures' "build/conformance/$PREV_VERSION/report.json")
    new_fail=$(jq '.stats.failures' "$RESULTS_DIR/report.json")
    if [ "$new_fail" -gt "$prev_fail" ]; then
        echo "❌ Conformance regression detected: $new_fail failures (was $prev_fail)" >&2
        exit 1
    fi
fi

ln -sfn "$VERSION" build/conformance/latest

echo "🎉 Conformance suite completed"
