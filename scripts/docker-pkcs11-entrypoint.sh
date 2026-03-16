#!/usr/bin/env bash
# docker-pkcs11-entrypoint.sh
#
# Initialises a SoftHSM2 token, generates an EC P-256 signing key, then runs
# the Pkcs11Provider integration tests (packages/kms/test/pkcs11.test.mjs).
#
# Required environment (set by docker-compose.softhsm-test.yml or at runtime):
#   SOFTHSM2_LIB   path to libsofthsm2.so   (default: auto-detected)
#   PKCS11_PIN     user PIN                  (default: testpin)
#   PKCS11_KEY_LABEL  key label              (default: kms-test-key)

set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Locate libsofthsm2.so
# ---------------------------------------------------------------------------
if [ -z "${SOFTHSM2_LIB:-}" ]; then
  for candidate in \
      /usr/lib/softhsm/libsofthsm2.so \
      /usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so \
      /usr/lib/aarch64-linux-gnu/softhsm/libsofthsm2.so \
      /usr/local/lib/softhsm/libsofthsm2.so; do
    if [ -f "$candidate" ]; then
      SOFTHSM2_LIB="$candidate"
      break
    fi
  done
fi

if [ -z "${SOFTHSM2_LIB:-}" ]; then
  echo "[pkcs11-test] ERROR: libsofthsm2.so not found. Install SoftHSM2." >&2
  exit 1
fi
echo "[pkcs11-test] Using PKCS#11 library: $SOFTHSM2_LIB"

# ---------------------------------------------------------------------------
# 2. Configure SoftHSM2 tokens directory
# ---------------------------------------------------------------------------
export SOFTHSM2_CONF="${SOFTHSM2_CONF:-/etc/softhsm2.conf}"
if [ ! -f "$SOFTHSM2_CONF" ]; then
  SOFTHSM2_CONF="/tmp/softhsm2.conf"
  mkdir -p /tmp/softhsm2/tokens
  cat > "$SOFTHSM2_CONF" <<EOF
directories.tokendir = /tmp/softhsm2/tokens
objectstore.backend = file
EOF
  export SOFTHSM2_CONF
fi
echo "[pkcs11-test] SoftHSM2 config: $SOFTHSM2_CONF"

# ---------------------------------------------------------------------------
# 3. Initialise token and generate EC P-256 key
# ---------------------------------------------------------------------------
PIN="${PKCS11_PIN:-testpin}"
SOPIN="soadmin"
LABEL="${PKCS11_KEY_LABEL:-kms-test-key}"
TOKEN_LABEL="test-token"

echo "[pkcs11-test] Initialising SoftHSM2 token '$TOKEN_LABEL'..."
softhsm2-util --init-token --slot 0 --label "$TOKEN_LABEL" \
  --pin "$PIN" --so-pin "$SOPIN" 2>&1 || true   # ignore if already initialised

echo "[pkcs11-test] Generating EC P-256 key with label '$LABEL'..."
pkcs11-tool --module "$SOFTHSM2_LIB" \
  --login --pin "$PIN" \
  --keypairgen \
  --key-type EC:prime256v1 \
  --label "$LABEL" \
  --id 01 \
  2>&1 || {
    # Key may already exist from a previous run — list to confirm
    echo "[pkcs11-test] Key generation returned non-zero (may already exist)."
    pkcs11-tool --module "$SOFTHSM2_LIB" --list-objects --login --pin "$PIN" 2>&1
  }

echo "[pkcs11-test] Key setup complete."

# ---------------------------------------------------------------------------
# 4. Run integration tests with the HSM-related env vars set
# ---------------------------------------------------------------------------
export SOFTHSM2_MODULE="$SOFTHSM2_LIB"
export PKCS11_PIN="$PIN"
export PKCS11_KEY_LABEL="$LABEL"

echo "[pkcs11-test] Running kms integration tests..."
exec node --test test/pkcs11.test.mjs
