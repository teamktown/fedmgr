#!/usr/bin/env bash
# Stop the local trust lab. State is DURABLE by default: the ta-data volume
# (enrollments/subordinates DB + fedvec index) and registry data survive so
# the lab comes back where you left it.
#
#   ./deploy/lab/down.sh          # stop; keep durable state
#   ./deploy/lab/down.sh --wipe   # stop AND remove all volumes (keys tmpfs,
#                                 # TA db, registry) — full factory reset
set -euo pipefail
cd "$(dirname "$0")/../.."

ARGS=()
for a in "$@"; do
  case "$a" in
    --wipe) ARGS+=("-v") ;;
    *) ARGS+=("$a") ;;
  esac
done

docker compose -f deploy/lab/docker-compose.yml down "${ARGS[@]+"${ARGS[@]}"}"
if [[ " ${ARGS[*]-} " == *" -v "* ]]; then
  # A wipe regenerates Caddy's CA on next up — drop the stale exported root so
  # nothing keeps trusting the old one.
  rm -f deploy/lab/ca/root.crt
  echo "[lab] down — volumes WIPED (fresh state on next up)."
else
  echo "[lab] down — durable state kept (ta-data, registry). Use --wipe for a reset."
fi
