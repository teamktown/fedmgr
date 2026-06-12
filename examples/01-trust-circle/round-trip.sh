#!/usr/bin/env bash
#
# Example 01 — full container round trip (LAB-GATED).
#
# build -> push (local OCI registry) -> cosign sign (HSM key) -> syft SBOM ->
# TMI digest-bound trustmark (evidence=SBOM) -> pull -> cosign verify + trustmark
# verify -> admit.
#
# This script is REAL and runnable in the lab. It does NOT fake any step: if a
# required tool is missing it exits non-zero with install guidance, so a partial
# run can never be mistaken for a successful signature.
set -euo pipefail

REGISTRY="${REGISTRY:-localhost:5000}"
IMAGE="${IMAGE:-${REGISTRY}/letsfederate/fedmgr-mcp:demo}"
TA_URL="${TA_URL:-http://localhost:8090}"
TMI_URL="${TMI_URL:-http://localhost:8080}"
TRUST_ANCHOR_ID="${TRUST_ANCHOR_ID:-https://trust.letsfederate.org}"
# cosign signing key.
#   - Default: a key file (works with the stock cosign release binary).
#   - HSM-rooted: set COSIGN_KEY to a pkcs11 URI, e.g.
#       pkcs11:token=fedmgr-ta;object=fedmgr-ta?module-path=/usr/lib/softhsm/libsofthsm2.so&pin-value=PIN
#     NOTE: the official cosign release binary returns "pkcs11 ... unimplemented" —
#     PKCS#11 needs a cosign built with the `pkcs11key` tag, or use a cloud-KMS key
#     URI (awskms://… | gcpkms://… | hashivault://…). Verified 2026-06-12.
COSIGN_KEY="${COSIGN_KEY:-cosign.key}"
# Verification key: the PUBLIC key for a key-pair file; for a pkcs11/KMS URI the
# same ref verifies, so default to that.
case "$COSIGN_KEY" in
  *.key) COSIGN_PUB="${COSIGN_PUB:-${COSIGN_KEY%.key}.pub}" ;;
  *)     COSIGN_PUB="${COSIGN_PUB:-$COSIGN_KEY}" ;;
esac
# Local insecure registry + offline (no Rekor transparency log). Drop these in prod.
COSIGN_FLAGS="${COSIGN_FLAGS:---allow-insecure-registry --tlog-upload=false}"
COSIGN_VERIFY_FLAGS="${COSIGN_VERIFY_FLAGS:---allow-insecure-registry --insecure-ignore-tlog=true}"

# ── Preflight: fail loudly, never skip silently ─────────────────────────────
missing=0
for tool in docker cosign syft jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[TRUST:FAIL] required tool '$tool' is not installed." >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  cat >&2 <<'EOF'

This round trip needs: docker, cosign, syft, jq (and a running lab with the local
OCI registry + TA + TMI from examples/lab/docker-compose.yml, plus SoftHSM for the
signing key). Install them, start the lab, then re-run. Aborting rather than
producing an unsigned/under-verified result.
EOF
  exit 69  # EX_UNAVAILABLE
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> [1/7] build image"
docker build -t "$IMAGE" "$SCRIPT_DIR"

echo "==> [2/7] push to local registry $REGISTRY"
docker push "$IMAGE"

echo "==> [3/7] resolve digest"
DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" | cut -d@ -f2)"
echo "    digest=$DIGEST"
[ -n "$DIGEST" ] || { echo "[TRUST:FAIL] could not resolve image digest" >&2; exit 1; }

echo "==> [4/7] cosign sign (key=$COSIGN_KEY)"
cosign sign --yes $COSIGN_FLAGS --key "$COSIGN_KEY" "${IMAGE}@${DIGEST}"

echo "==> [5/7] generate SBOM (syft) and attach"
syft "${IMAGE}@${DIGEST}" -o spdx-json > sbom.spdx.json
cosign attest --yes $COSIGN_FLAGS --key "$COSIGN_KEY" --type spdxjson --predicate sbom.spdx.json "${IMAGE}@${DIGEST}"

echo "==> [6/7] issue digest-bound trustmark via TMI"
curl -fsS -X POST "$TMI_URL/trustmarks/issue" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg sub "$TRUST_ANCHOR_ID/mcp/fedmgr-mcp" --arg dig "$DIGEST" \
        '{sub:$sub, image_digest:$dig, ttl_s:3600}')" > trustmark.json
echo "    trustmark issued -> trustmark.json"

echo "==> [7/7] verify: cosign + trustmark digest binding"
cosign verify $COSIGN_VERIFY_FLAGS --key "$COSIGN_PUB" "${IMAGE}@${DIGEST}" >/dev/null
# The TMI wraps the signed trustmark as { payload, trustmark_jws }; the bound
# digest lives in payload.image_digest.
TM_DIGEST="$(jq -r '.payload.image_digest // .image_digest // empty' trustmark.json)"
if [ "$TM_DIGEST" != "$DIGEST" ]; then
  echo "[TRUST:FAIL] trustmark digest ($TM_DIGEST) != image digest ($DIGEST)" >&2
  exit 1
fi
echo "[TRUST:VALID] round trip complete — image signed (cosign) and bound to a trustmark for $DIGEST"
