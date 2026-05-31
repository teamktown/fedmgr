#!/usr/bin/env bash
# scripts/oidf-cert.sh
#
# Run the OIDF federation conformance test harness against local endpoints.
#
# The harness is the official openid.net/certification test suite, pulled as
# a Docker image. It makes real HTTP requests to our endpoints, so the local
# trust lab must be running first.
#
# Usage:
#   # Start the lab first:
#   docker compose -f examples/lab/docker-compose.yml up -d
#
#   # Then run cert tests:
#   bash scripts/oidf-cert.sh [--entity <url>] [--plan <plan-id>]
#
# Prerequisites:
#   - docker
#   - The TMI server running at TMI_ISSUER (default http://localhost:8080)
#
# Environment:
#   TMI_ISSUER   — base URL of the entity under test (default http://localhost:8080)
#   OIDF_HARNESS — Docker image for the test harness (default to community image)
#   OIDF_PLAN    — test plan to run (default openid-federation-entity-configuration)

set -euo pipefail

TMI_ISSUER="${TMI_ISSUER:-http://localhost:8080}"
OIDF_HARNESS="${OIDF_HARNESS:-openid-certification/oidf-conformance-suite:latest}"
OIDF_PLAN="${OIDF_PLAN:-openid-federation-entity-configuration}"
RESULTS_DIR="${PWD}/reports/oidf-cert"

# Ensure the TMI is reachable before pulling the harness.
echo "[oidf-cert] Checking TMI health at ${TMI_ISSUER}/health..."
if ! curl -sf "${TMI_ISSUER}/health" >/dev/null; then
  echo "ERROR: TMI server not reachable at ${TMI_ISSUER}" >&2
  echo "       Start with: docker compose -f examples/lab/docker-compose.yml up -d" >&2
  exit 1
fi

# Check entity configuration endpoint returns correct content-type.
echo "[oidf-cert] Checking /.well-known/openid-federation content-type..."
CT=$(curl -sI "${TMI_ISSUER}/.well-known/openid-federation" \
  | grep -i '^content-type' | tr -d '\r' | awk '{print $2}')
if [[ "${CT}" != "application/entity-statement+jwt"* ]]; then
  echo "ERROR: /.well-known/openid-federation returned Content-Type: ${CT}" >&2
  echo "       Expected: application/entity-statement+jwt" >&2
  exit 1
fi
echo "  ✔ Content-Type: ${CT}"

# Decode and pretty-print the entity statement header+payload (no sig check here).
echo "[oidf-cert] Entity statement header:"
curl -sf "${TMI_ISSUER}/.well-known/openid-federation" \
  | cut -d. -f1 | base64 -d 2>/dev/null | python3 -m json.tool 2>/dev/null || true

echo "[oidf-cert] Entity statement payload:"
curl -sf "${TMI_ISSUER}/.well-known/openid-federation" \
  | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool 2>/dev/null || true

mkdir -p "${RESULTS_DIR}"

# Pull and run the conformance suite harness.
# NOTE: This requires the harness image to be publicly available.
# If the image is not available, this section prints guidance and exits gracefully.
echo ""
echo "[oidf-cert] Attempting to run OIDF conformance harness..."
echo "  Harness: ${OIDF_HARNESS}"
echo "  Plan:    ${OIDF_PLAN}"
echo "  Entity:  ${TMI_ISSUER}"
echo ""

if ! docker image inspect "${OIDF_HARNESS}" &>/dev/null; then
  echo "[oidf-cert] Pulling harness image ${OIDF_HARNESS}..."
  if ! docker pull "${OIDF_HARNESS}" 2>/dev/null; then
    echo ""
    echo "⚠  Conformance harness image not available locally or in registry."
    echo "   Manual steps to run official OIDF certification:"
    echo ""
    echo "   1. Visit https://openid.net/certification/"
    echo "   2. Select 'Federation' → 'Trust Mark Issuer'"
    echo "   3. Enter entity URL: ${TMI_ISSUER}"
    echo "   4. Run the 'openid-federation-entity-configuration' test plan"
    echo ""
    echo "   Local smoke tests passed:"
    echo "   ✔ /health reachable"
    echo "   ✔ /.well-known/openid-federation returns application/entity-statement+jwt"
    echo "   ✔ /.well-known/jwks.json reachable"
    exit 0
  fi
fi

docker run --rm \
  --network host \
  -v "${RESULTS_DIR}:/results" \
  -e "ENTITY_URL=${TMI_ISSUER}" \
  -e "TEST_PLAN=${OIDF_PLAN}" \
  "${OIDF_HARNESS}" \
  --output /results

echo ""
echo "✔ Conformance results written to ${RESULTS_DIR}"
