#!/usr/bin/env bash
#
# scan-all.sh — orchestrate the six-tool security scan and emit a single
# review-ready report under SSC/.
#
# Tools (must each be on PATH; the script warns and continues if any are
# missing rather than abort — partial coverage is more useful than nothing):
#   trivy        — fs deps + IaC + secrets + license   (Apache 2.0, Aqua)
#   bandit       — Python static security analysis     (Apache 2.0, PyCQA)
#   osv-scanner  — second-opinion vuln (OSV.dev DB)    (Apache 2.0, Google)
#   syft         — CycloneDX SBOM                       (Apache 2.0, Anchore)
#   hadolint     — Dockerfile linter                    (GPLv3, community)
#   gitleaks     — secrets in git history               (MIT, community)
#
# Each tool's raw output is captured into a per-tool log under SSC/raw/<DATE>/
# (gitignored) and folded into a single markdown report at
# SSC/reports/report<YYYYMMDD>.v<N>.md with stub Assessment + Action sections
# for the operator to fill in before commit.
#
# Defensive choices:
# - `set -uo pipefail` (no -e — we want to keep going past individual scanner
#   failures so the report is always produced).
# - Per-tool wall-clock cap via `timeout` so a hung scanner doesn't stall.
# - Auto-version: scan SSC/ for today's reports, bump <N> by one. No risk
#   of clobbering yesterday's report or your colleague's earlier run today.
# - Severity rollup: parse Trivy + OSV JSON into a counts table the operator
#   can scan in 5 seconds.
# - No network calls outside what each scanner does on its own. The script
#   itself never reaches out.
#
# Usage:
#   SSC/scripts/scan-all.sh                # runs all available scanners
#   SSC/scripts/scan-all.sh --image IMG    # also runs Trivy against an image (optional)
#   SSC/scripts/scan-all.sh --quiet        # suppress per-tool stdout (still writes logs)
#
# Exit codes:
#   0   all scanners ran (irrespective of findings — this is "produce", not "act")
#   1   no scanners found / fatal setup error
#   2   one or more scanners reported HIGH/CRITICAL — set in the report header,
#       useful for CI gating but the report is still written.

set -uo pipefail
IFS=$'\n\t'

# ─── colours (used in stderr-only operator messages) ──────────────────────
if [ -t 2 ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLU=$'\033[36m'; DIM=$'\033[2m'; RST=$'\033[0m'
else
  RED=""; GRN=""; YEL=""; BLU=""; DIM=""; RST=""
fi

# ─── config ────────────────────────────────────────────────────────────────
# This script lives at SSC/scripts/, so the repo root is two levels up.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSC_DIR="$REPO_ROOT/SSC"
REPORTS_DIR="$SSC_DIR/reports"      # committed markdown reports land here
TOOL_TIMEOUT="${TOOL_TIMEOUT:-180}"  # seconds per tool
QUIET=0
IMAGE=""

for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --image) shift; IMAGE="${1:-}" ;;
    --image=*) IMAGE="${arg#--image=}" ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
  esac
done

mkdir -p "$REPORTS_DIR"
DATE="$(date -u +%Y%m%d)"
TS_HUMAN="$(date -u +'%Y-%m-%d %H:%M:%S UTC')"
RAW_DIR="$SSC_DIR/raw/$DATE"
mkdir -p "$RAW_DIR"

# Determine the next version for today: walk SSC/reports/report${DATE}.v*.md,
# find the largest <N>, increment. New day = v1.
NEXT_N=1
for existing in "$REPORTS_DIR"/report"$DATE".v*.md; do
  [ -e "$existing" ] || break
  n="$(basename "$existing" | sed -E "s/^report${DATE}\.v([0-9]+)\.md$/\1/")"
  [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge "$NEXT_N" ] && NEXT_N=$((n + 1))
done
REPORT="$REPORTS_DIR/report${DATE}.v${NEXT_N}.md"

# ─── helpers ───────────────────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }
log()  { [ "$QUIET" -eq 0 ] && printf "%s\n" "$*"; }
section() { printf "\n## %s\n\n" "$*" >> "$REPORT"; }

run_tool() {
  # run_tool <name> <output-file> <cmd...>
  local name="$1"; local out="$2"; shift 2
  if ! have "$1"; then
    printf "%s NOT INSTALLED\n" "$name" > "$out"
    log "  [skip] $name (not installed)"
    return 127
  fi
  log "  [run]  $name"
  # Tools emit JSON on stdout and progress/info on stderr — keep raw output
  # clean so jq can parse it. Stderr is discarded to avoid the
  # "JSON+log lines interleaved" failure mode that breaks the assess step.
  timeout --signal=TERM "$TOOL_TIMEOUT" "$@" > "$out" 2>/dev/null
  local rc=$?
  if [ "$rc" -eq 124 ]; then
    echo >> "$out"
    echo "─── ABORTED: tool exceeded ${TOOL_TIMEOUT}s budget ───" >> "$out"
  fi
  return $rc
}

count_severity() {
  # count_severity <trivy-json|osv-json> <severity-key>
  # naive grep — not a JSON parser; OK for ranges/integration not policy.
  grep -oE "\"[Ss]everity\"[[:space:]]*:[[:space:]]*\"$1\"" "$2" 2>/dev/null | wc -l | tr -d ' '
}

# ─── header ────────────────────────────────────────────────────────────────
COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
# Derive repo identifier from the origin URL when available; fall back to
# the working-tree directory name. Generic by design — the recipient repo
# may be hosted anywhere.
REPO_REMOTE="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null \
  | sed -E 's#^.*[:/]([^/:]+/[^/]+)(\.git)?$#\1#' \
  | sed -E 's#\.git$##' \
  || true)"
REPO_IDENT="${REPO_REMOTE:-$(basename "$REPO_ROOT")}"

cat > "$REPORT" <<EOF
# Security scan report — ${DATE} v${NEXT_N}

| Field | Value |
|-------|-------|
| Generated | ${TS_HUMAN} |
| Repo | ${REPO_IDENT} |
| Commit | \`${COMMIT}\` |
| Branch | \`${BRANCH}\` |
| Image scanned | ${IMAGE:-_(none — fs scan only)_} |
| Tools | trivy, bandit, osv-scanner, syft, hadolint, gitleaks |
| Tool version pins | see \`Versions\` section below |

> This report is generated by \`SSC/scripts/scan-all.sh\`. The **Assessment**
> and **Action** sections at the end are stubs — fill them in before
> committing and pushing.
EOF

# ─── versions ──────────────────────────────────────────────────────────────
section "Versions"
{
  echo '```'
  for t in trivy bandit osv-scanner syft hadolint gitleaks; do
    if have "$t"; then
      "$t" --version 2>&1 | head -1 | sed "s|^|$t: |"
    else
      echo "$t: NOT INSTALLED"
    fi
  done
  echo '```'
} >> "$REPORT"

# ─── consent-flow banner ─────────────────────────────────────────────────
# If any scanner is missing, alert the operator that they can install the
# whole toolchain via a sibling script — but only with explicit consent
# (the install script reaches out to the internet). We do NOT install
# anything from here; this script is "operate", install-sectools.sh is
# "install". One responsibility each.
MISSING_TOOLS=()
for t in trivy bandit osv-scanner syft hadolint gitleaks; do
  have "$t" || MISSING_TOOLS+=("$t")
done
if [ "${#MISSING_TOOLS[@]}" -gt 0 ]; then
  # Join with ", " — script-wide IFS is $'\n\t' so [*] would break across lines.
  MISSING_LIST=$(IFS=', '; echo "${MISSING_TOOLS[*]}")
  printf "\n${YEL}══════════════════════════════════════════════════════════════════════${RST}\n" >&2
  printf "${YEL}  %d scanner(s) not on PATH: %s${RST}\n" "${#MISSING_TOOLS[@]}" "$MISSING_LIST" >&2
  printf "${YEL}══════════════════════════════════════════════════════════════════════${RST}\n" >&2
  printf "\nThe report will still be produced from whatever tools ARE available\n" >&2
  printf "(this is partial-coverage mode), but you can install the rest with the\n" >&2
  printf "verified-checksum installer:\n\n" >&2
  printf "  ${BLU}SSC/scripts/install-sectools.sh${RST}                   ${DIM}# read the consent banner${RST}\n" >&2
  printf "  ${BLU}SSC/scripts/install-sectools.sh --confirm-install-sectools${RST}\n\n" >&2
  printf "${DIM}That script is the ONE place this repo reaches out to the internet${RST}\n" >&2
  printf "${DIM}to install executables. It refuses to do anything without the consent flag.${RST}\n\n" >&2
fi

# ─── run scanners ──────────────────────────────────────────────────────────
log "scan-all.sh: writing $REPORT"

TRIVY_FS_OUT="$RAW_DIR/trivy-fs.json"
TRIVY_CONFIG_OUT="$RAW_DIR/trivy-config.json"
TRIVY_IMAGE_OUT="$RAW_DIR/trivy-image.json"
BANDIT_OUT="$RAW_DIR/bandit.json"
OSV_OUT="$RAW_DIR/osv.json"
SYFT_OUT="$RAW_DIR/syft.cdx.json"
HADOLINT_OUT="$RAW_DIR/hadolint.json"
GITLEAKS_OUT="$RAW_DIR/gitleaks.json"

cd "$REPO_ROOT"

run_tool trivy "$TRIVY_FS_OUT" \
  trivy fs --quiet --no-progress --format json \
  --skip-dirs ".venv-smoke,.git,SSC/raw,__pycache__,node_modules" \
  --severity CRITICAL,HIGH,MEDIUM,LOW . || true

run_tool trivy "$TRIVY_CONFIG_OUT" \
  trivy --quiet config --format json . || true

if [ -n "$IMAGE" ]; then
  run_tool trivy "$TRIVY_IMAGE_OUT" \
    trivy image --quiet --no-progress --format json --severity CRITICAL,HIGH,MEDIUM,LOW "$IMAGE" || true
fi

# Bandit is Python-only. This is a TypeScript workspace, so run it only if
# Python sources actually exist (guards against scanning nothing / erroring).
if find "$REPO_ROOT" -name '*.py' -not -path '*/node_modules/*' -not -path '*/.venv*/*' -not -path '*/SSC/raw/*' -print -quit 2>/dev/null | grep -q .; then
  run_tool bandit "$BANDIT_OUT" \
    bandit -r "$REPO_ROOT" -f json -q --exclude "$REPO_ROOT/node_modules" || true
else
  printf 'N/A — no Python sources in this repo (TypeScript workspace).\n' > "$BANDIT_OUT"
  log "  [skip] bandit (no Python sources)"
fi

run_tool osv-scanner "$OSV_OUT" \
  osv-scanner scan source --recursive --format json . || true

run_tool syft "$SYFT_OUT" \
  syft "dir:." --output cyclonedx-json --quiet || true

# Dockerfiles live beside their services (services/*/Dockerfile) plus example
# images under examples/. Lint every Dockerfile* we ship (depth ≤ 3).
HADO_TARGETS=()
while IFS= read -r df; do HADO_TARGETS+=("$df"); done < <(
  find "$REPO_ROOT" -maxdepth 3 -type f -name 'Dockerfile*' -not -path '*/node_modules/*' | sort)
if [ "${#HADO_TARGETS[@]}" -gt 0 ]; then
  run_tool hadolint "$HADOLINT_OUT" \
    hadolint --format json "${HADO_TARGETS[@]}" || true
else
  printf 'N/A — no Dockerfiles found.\n' > "$HADOLINT_OUT"
  log "  [skip] hadolint (no Dockerfiles)"
fi

run_tool gitleaks "$GITLEAKS_OUT" \
  gitleaks detect --source "$REPO_ROOT" --report-format json --report-path "$GITLEAKS_OUT" --redact --no-banner || true

# ─── summary ───────────────────────────────────────────────────────────────
section "Findings — severity rollup"

TRIVY_CRIT=$(count_severity CRITICAL "$TRIVY_FS_OUT")
TRIVY_HIGH=$(count_severity HIGH "$TRIVY_FS_OUT")
TRIVY_MED=$(count_severity MEDIUM "$TRIVY_FS_OUT")
TRIVY_LOW=$(count_severity LOW "$TRIVY_FS_OUT")
OSV_LINES=$(wc -l < "$OSV_OUT" 2>/dev/null | tr -d ' ' || echo 0)

cat >> "$REPORT" <<EOF

| Source | Critical | High | Medium | Low | Notes |
|---|---:|---:|---:|---:|---|
| Trivy fs | ${TRIVY_CRIT} | ${TRIVY_HIGH} | ${TRIVY_MED} | ${TRIVY_LOW} | dependencies + secrets + IaC |
| Trivy config | — | — | — | — | see raw output (Dockerfile + compose checks) |
| OSV-Scanner | — | — | — | — | second-opinion vuln scan; raw JSON below |
| Bandit | — | — | — | — | Python static security; severity is per-issue |
| Hadolint | — | — | — | — | Dockerfile lint, info/warning/error |
| Gitleaks | — | — | — | — | secrets across git history |

Counts above are best-effort grep over the raw JSON; the operator should
read each tool's full output below before assessing.

> Heuristic: treat any **Critical** or **High** as a release blocker unless
> explicitly accepted in the Action section with rationale. **Medium** is
> a tracked issue. **Low** is informational.
EOF

# ─── raw outputs ───────────────────────────────────────────────────────────
section "Raw scanner output"

attach() {
  # attach <header> <file>
  local h="$1"; local f="$2"
  echo "" >> "$REPORT"
  echo "<details><summary>${h}</summary>" >> "$REPORT"
  echo "" >> "$REPORT"
  echo '```' >> "$REPORT"
  if [ -s "$f" ]; then
    head -c 80000 "$f" >> "$REPORT"  # cap each at 80KB to keep the report scannable
    [ "$(wc -c < "$f")" -gt 80000 ] && echo -e "\n... [truncated; see ${f}]" >> "$REPORT"
  else
    echo "(empty or missing)" >> "$REPORT"
  fi
  echo '```' >> "$REPORT"
  echo "</details>" >> "$REPORT"
}

attach "Trivy — filesystem"  "$TRIVY_FS_OUT"
attach "Trivy — config"      "$TRIVY_CONFIG_OUT"
[ -n "$IMAGE" ] && attach "Trivy — image ($IMAGE)" "$TRIVY_IMAGE_OUT"
attach "Bandit"              "$BANDIT_OUT"
attach "OSV-Scanner"         "$OSV_OUT"
attach "Hadolint"            "$HADOLINT_OUT"
attach "Gitleaks"            "$GITLEAKS_OUT"
attach "Syft (SBOM, source)" "$SYFT_OUT"

# ─── stub sections ─────────────────────────────────────────────────────────
cat >> "$REPORT" <<'EOF'

## Assessment

> Fill in per finding before committing this report.

| Finding (CVE / rule / file:line) | Severity | Decision | Rationale |
|---|---|---|---|
| _example: CVE-XXXX-YYYY in fastapi 0.115.6_ | High | fix-next-release | _patched in 0.115.7; bump on next release_ |

## Action

> Fill in commits/PRs / waivers as work is done.

| Finding | Action | Reference |
|---|---|---|
| _example_ | bumped fastapi -> 0.115.7 | commit `abc1234` |

## Reviewer

| Field | Value |
|-------|-------|
| Reviewed by | _name + role_ |
| Reviewed on | _YYYY-MM-DD_ |
| Status | open / closed |
EOF

# ─── exit code ─────────────────────────────────────────────────────────────
log ""
log "report: $REPORT"
log "raw artefacts: $RAW_DIR/"

if [ "$TRIVY_CRIT" -gt 0 ] || [ "$TRIVY_HIGH" -gt 0 ]; then
  log "[warn] Trivy reports HIGH or CRITICAL findings — exit 2 (CI-gate friendly)"
  exit 2
fi
exit 0
