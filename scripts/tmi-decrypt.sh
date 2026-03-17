#!/usr/bin/env bash
# scripts/tmi-decrypt.sh
#
# Decrypts the PBES2-encrypted private JWK produced by tmi-keys-init.sh
# into a tmpfs location (/dev/shm) so the private key NEVER touches disk.
#
# After this script runs, set:
#   export TMI_PRIVATE_JWK=/dev/shm/tmi.priv.jwk
# and start tmi-server. The decrypted file is automatically removed on exit
# if you source this script or use the --start flag.
#
# Usage:
#   # Standalone: just decrypt and export
#   source scripts/tmi-decrypt.sh
#
#   # With inline start:
#   bash scripts/tmi-decrypt.sh --start

set -euo pipefail

KEYS_DIR="${KEYS_DIR:-packages/tmi-server/keys}"
PASS_FILE="${KEYS_DIR}/.pass"
PRIV_JWE="${KEYS_DIR}/tmi.priv.jwe"
PUB_JWK="${KEYS_DIR}/tmi.pub.jwk"
TMPFS_KEY="/dev/shm/tmi-${RANDOM}.priv.jwk"

cleanup() {
  if [[ -f "${TMPFS_KEY}" ]]; then
    # Overwrite before removing (belt-and-suspenders for tmpfs).
    dd if=/dev/urandom of="${TMPFS_KEY}" bs=1 count=$(wc -c <"${TMPFS_KEY}") 2>/dev/null || true
    rm -f "${TMPFS_KEY}"
    echo "[tmi-decrypt] Cleared decrypted key from tmpfs."
  fi
}
trap cleanup EXIT INT TERM

# Validate inputs.
for f in "${PASS_FILE}" "${PRIV_JWE}"; do
  if [[ ! -f "${f}" ]]; then
    echo "ERROR: Required file not found: ${f}" >&2
    echo "       Run scripts/tmi-keys-init.sh first." >&2
    exit 1
  fi
done

if ! command -v step &>/dev/null; then
  echo "ERROR: 'step' CLI not found. Install from https://smallstep.com/docs/step-cli/" >&2
  exit 1
fi

# /dev/shm is a tmpfs on Linux; use /tmp as fallback for macOS.
if [[ ! -d "/dev/shm" ]]; then
  TMPFS_KEY="/tmp/tmi-${RANDOM}.priv.jwk"
  echo "WARNING: /dev/shm not found, using /tmp. Key will touch disk." >&2
fi

# Decrypt private JWE → plaintext JWK in tmpfs.
step crypto jwk decrypt \
  --in "${PRIV_JWE}" \
  --out "${TMPFS_KEY}" \
  --password-file "${PASS_FILE}"

chmod 600 "${TMPFS_KEY}"
echo "[tmi-decrypt] Decrypted private key at ${TMPFS_KEY} (tmpfs, chmod 600)"

export TMI_PRIVATE_JWK="${TMPFS_KEY}"
export TMI_PUBLIC_JWK="${PUB_JWK}"

if [[ "${1:-}" == "--start" ]]; then
  echo "[tmi-decrypt] Starting tmi-server..."
  node packages/tmi-server/dist/index.js
fi
