#!/usr/bin/env bash
#
# One-command local trust lab: registry(:5000) + TMI(:8080) + TA(:8090).
# Generates EC P-521 keys (ES512, encrypted at rest) if missing — no host `step` CLI
# needed (uses the smallstep/step-cli image) — then builds and starts the lab
# and waits for health. Idempotent: safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
COMPOSE="deploy/lab/docker-compose.yml"
STEP_IMG="smallstep/step-cli:latest"

gen_keys() { # dir pub jwe
  local dir="$1" pub="$2" jwe="$3"
  [ -f "$dir/$jwe" ] && return 0
  echo "[lab] generating keys in $dir (EC P-521 → ES512, PBES2-encrypted)"
  docker run --rm -v "$PWD/$dir:/keys" --entrypoint sh "$STEP_IMG" -c "
    head -c 32 /dev/urandom | base64 > /keys/.pass && chmod 600 /keys/.pass &&
    step crypto jwk create /keys/$pub /keys/$jwe --kty EC --curve P-521 --use sig --password-file /keys/.pass --force &&
    chmod 644 /keys/$pub && chmod 600 /keys/$jwe"
}

echo "[lab] ensuring TA/TMI keys exist"
gen_keys services/tmi-server/keys tmi.pub.jwk tmi.priv.jwe
gen_keys services/ta-server/keys  ta.pub.jwk  ta.priv.jwe

echo "[lab] building + starting (this builds two Node images on first run)"
docker compose -f "$COMPOSE" up --build -d

echo "[lab] waiting for health..."
wait_health() { # name url
  for _ in $(seq 1 30); do
    curl -fsS "$2" >/dev/null 2>&1 && { echo "[lab] $1 healthy"; return 0; }
    sleep 2
  done
  echo "[lab] $1 did NOT become healthy" >&2
  docker compose -f "$COMPOSE" ps
  return 1
}
wait_health TMI http://localhost:8080/health
wait_health TA  http://localhost:8090/health

# ── TLS edge (option A): export Caddy's internal-CA root for clients ────────
# The public root lands in deploy/lab/ca/root.crt; every https client (host
# Node processes, the TA container itself) trusts it via NODE_EXTRA_CA_CERTS.
# First boot only: the TA started before the root existed — restart it once so
# Node picks the file up.
ROOT_CRT="deploy/lab/ca/root.crt"
for _ in $(seq 1 15); do
  docker compose -f "$COMPOSE" cp caddy:/data/caddy/pki/authorities/local/root.crt "$ROOT_CRT.new" >/dev/null 2>&1 && break
  sleep 2
done
if [ ! -s "$ROOT_CRT.new" ]; then
  echo "[lab] TLS root did NOT appear (caddy pki)" >&2; exit 1
fi
# The TA must trust the CURRENT root (a --wipe regenerates the CA, so compare
# content — mere existence is not enough). On change: swap the file and restart
# the TA pod so Node re-reads NODE_EXTRA_CA_CERTS.
TA_ROOT_SUM=$(docker compose -f "$COMPOSE" exec -T ta-server sha256sum /lab-ca/root.crt 2>/dev/null | cut -d' ' -f1 || true)
NEW_SUM=$(sha256sum "$ROOT_CRT.new" | cut -d' ' -f1)
mv "$ROOT_CRT.new" "$ROOT_CRT"
chmod 644 "$ROOT_CRT"   # PUBLIC cert; containers read it as non-root users
if [ "$TA_ROOT_SUM" != "$NEW_SUM" ]; then
  echo "[lab] TLS root is new/changed — restarting TA pod with the exported root"
  docker compose -f "$COMPOSE" restart ta-server >/dev/null 2>&1
  # Restarting the netns OWNER gives it a fresh namespace; the followers'
  # listeners are stranded in the dead one. They must restart AFTER the owner
  # (`up -d` won't — compose sees them as unchanged-and-running).
  docker compose -f "$COMPOSE" restart entity-host caddy >/dev/null 2>&1
  wait_health TA http://localhost:8090/health
fi
wait_https() { # name url
  for _ in $(seq 1 15); do
    curl -fsS --cacert "$ROOT_CRT" "$2" >/dev/null 2>&1 && { echo "[lab] $1 healthy (TLS)"; return 0; }
    sleep 2
  done
  echo "[lab] $1 did NOT answer over TLS" >&2; return 1
}
wait_https "TA  https://localhost:9443" https://localhost:9443/health
wait_https "TMI https://localhost:9444" https://localhost:9444/health

echo
echo "[lab] UP  →  TA=https://localhost:9443  TMI=https://localhost:9444  statements=https://localhost:9445"
echo "[lab]        (plain http :8090/:8080 remain for debugging; root CA: $ROOT_CRT)"
echo "[lab] TA subordinates: $(curl -fsS http://localhost:8090/federation_list 2>/dev/null || echo '?')"
echo "[lab] Next:"
echo "        ./examples/01-trust-circle/round-trip.sh    # sign+SBOM+trustmark round trip (needs cosign, syft, jq)"
echo "        see docs/walkthroughs/trust-lab-quickstart.md  # incl. how to drive it from Claude Code"
echo "[lab] Stop: ./deploy/lab/down.sh   (state persists; --wipe to reset)"
