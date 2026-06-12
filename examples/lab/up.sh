#!/usr/bin/env bash
#
# One-command local trust lab: registry(:5000) + TMI(:8080) + TA(:8090).
# Generates EC P-256 keys (encrypted at rest) if missing — no host `step` CLI
# needed (uses the smallstep/step-cli image) — then builds and starts the lab
# and waits for health. Idempotent: safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
COMPOSE="examples/lab/docker-compose.yml"
STEP_IMG="smallstep/step-cli:latest"

gen_keys() { # dir pub jwe
  local dir="$1" pub="$2" jwe="$3"
  [ -f "$dir/$jwe" ] && return 0
  echo "[lab] generating keys in $dir (EC P-256, PBES2-encrypted)"
  docker run --rm -v "$PWD/$dir:/keys" --entrypoint sh "$STEP_IMG" -c "
    head -c 32 /dev/urandom | base64 > /keys/.pass && chmod 600 /keys/.pass &&
    step crypto jwk create /keys/$pub /keys/$jwe --kty EC --curve P-256 --use sig --password-file /keys/.pass --force &&
    chmod 644 /keys/$pub && chmod 600 /keys/$jwe"
}

echo "[lab] ensuring TA/TMI keys exist"
gen_keys packages/tmi-server/keys tmi.pub.jwk tmi.priv.jwe
gen_keys packages/ta-server/keys  ta.pub.jwk  ta.priv.jwe

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

echo
echo "[lab] UP  →  TA=http://localhost:8090  TMI=http://localhost:8080  registry=localhost:5000"
echo "[lab] TA subordinates: $(curl -fsS http://localhost:8090/federation_list 2>/dev/null || echo '?')"
echo "[lab] Next:"
echo "        ./examples/01-trust-circle/round-trip.sh    # sign+SBOM+trustmark round trip (needs cosign, syft, jq)"
echo "        see docs/walkthroughs/trust-lab-quickstart.md  # incl. how to drive it from Claude Code"
echo "[lab] Stop & clean: ./examples/lab/down.sh"
