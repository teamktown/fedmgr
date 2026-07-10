#!/usr/bin/env bash
# Stop the local trust lab and remove its volumes (keys + DB are ephemeral).
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose -f deploy/lab/docker-compose.yml down -v "$@"
echo "[lab] down."
