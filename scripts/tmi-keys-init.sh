#!/usr/bin/env bash
# scripts/tmi-keys-init.sh
#
# Generates an encrypted EC JWK pair (default P-521 → ES512; KEY_CURVE=P-256
# to override) for the TMI server using Step CLI.
#
# POLICY:
#   - Private key is NEVER stored as plaintext on disk.
#   - step CLI produces a PBES2-encrypted JWE for the private key.
#   - The passphrase is generated randomly and stored in keys/.pass (chmod 600).
#   - The public JWK is plaintext and safe to serve at /.well-known/jwks.json.
#
# Prerequisites:
#   - step CLI installed (https://smallstep.com/docs/step-cli/)
#
# Usage:
#   bash scripts/tmi-keys-init.sh [keys-dir]
#   Default keys-dir: services/tmi-server/keys

set -euo pipefail

KEYS_DIR="${1:-services/tmi-server/keys}"
PASS_FILE="${KEYS_DIR}/.pass"
PUB_JWK="${KEYS_DIR}/tmi.pub.jwk"
PRIV_JWE="${KEYS_DIR}/tmi.priv.jwe"

# Check step CLI is available.
if ! command -v step &>/dev/null; then
  echo "ERROR: 'step' CLI not found. Install from https://smallstep.com/docs/step-cli/" >&2
  exit 1
fi

mkdir -p "${KEYS_DIR}"

# Generate passphrase if it doesn't exist.
if [[ ! -f "${PASS_FILE}" ]]; then
  head -c 32 /dev/urandom | base64 >"${PASS_FILE}"
  chmod 600 "${PASS_FILE}"
  echo "Generated passphrase at ${PASS_FILE} (chmod 600)"
fi

# Generate encrypted JWK pair (EC P-521 → ES512 default; P-256 keys keep
# working because signing/verification derive the alg from the key's curve).
# --password-file ensures the private JWK is PBES2-encrypted; no naked key.
step crypto jwk create "${PUB_JWK}" "${PRIV_JWE}" \
  --kty EC --curve "${KEY_CURVE:-P-521}" \
  --use sig \
  --password-file "${PASS_FILE}" \
  --no-password=false \
  --force

chmod 600 "${PRIV_JWE}" "${PASS_FILE}"

echo ""
echo "Keys created:"
echo "  Public JWK:      ${PUB_JWK}"
echo "  Encrypted priv:  ${PRIV_JWE}  (PBES2, protected)"
echo "  Passphrase:      ${PASS_FILE} (chmod 600 — do not commit)"
echo ""
echo "To start tmi-server, first decrypt via:"
echo "  bash scripts/tmi-decrypt.sh"
echo "Then set:"
echo "  export TMI_PUBLIC_JWK=${PUB_JWK}"
echo "  export TMI_PRIVATE_JWK=/dev/shm/tmi.priv.jwk"
