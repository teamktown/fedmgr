#!/usr/bin/env bash
# Prove the lab's durable-state contract end to end, with real containers:
#
#   1. up  → assert the TA db is NOT on /tmp
#   2. create state (start an enrollment → durable row in the TA db)
#   3. down (default, non-destructive) → up
#   4. assert the enrollment record survived the restart
#
# Exit 0 = durability holds. Any other exit = state was lost — treat as a
# regression in the ta-data volume wiring. Runs in ~1-2 min with warm images.
set -euo pipefail
cd "$(dirname "$0")/../.."

TA=http://localhost:8090
say() { echo "[verify-durability] $*"; }

say "1/4 lab up"
./deploy/lab/up.sh >/dev/null

DB_PATH=$(curl -fsS "$TA/health" | python3 -c "import json,sys; print(json.load(sys.stdin)['db_path'])")
case "$DB_PATH" in
  /tmp/*) say "FAIL: TA db is on /tmp ($DB_PATH) — not durable"; exit 1 ;;
  *)      say "db_path=$DB_PATH (durable mount)" ;;
esac

say "2/4 creating durable state (enrollment challenge)"
# entity-host origin satisfies the TA's same-origin + SSRF rules in the lab.
EID="http://localhost:9631/mcp/durability-probe-$$"
RESP=$(curl -fsS -X POST "$TA/enroll" -H 'content-type: application/json' \
  -d "{\"entity_id\":\"$EID\",\"jwks_url\":\"$EID/jwks.json\"}")
ENROLL_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['enrollment_id'])")
say "enrollment_id=$ENROLL_ID"

say "3/4 restart cycle (down → up, durable default)"
./deploy/lab/down.sh >/dev/null
./deploy/lab/up.sh   >/dev/null

say "4/4 checking the enrollment survived"
STATUS=$(curl -fsS -o /dev/null -w '%{http_code}' "$TA/enroll/$ENROLL_ID")
if [ "$STATUS" = "200" ]; then
  say "PASS: enrollment record present after restart — durable state holds."
else
  say "FAIL: GET /enroll/$ENROLL_ID returned $STATUS after restart — state lost."
  exit 1
fi
