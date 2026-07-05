#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# install-sectools.sh — verified-checksum installer for the six-tool security
# scanner toolchain that scripts/scan-all.sh orchestrates.
#
# This script is the ONE file in the repo that reaches out to the internet
# and writes executables to your machine. By design, it refuses to do so
# without an explicit consent flag (`--confirm-install-sectools`).
#
# What it installs (all to ~/.local/bin/, no sudo, no system mutation):
#
#   trivy        v0.69.3   container/fs/IaC/secrets/license   (Aqua, Apache 2.0)
#   syft         v1.44.0   CycloneDX SBOM generator           (Anchore, Apache 2.0)
#   hadolint     v2.14.0   Dockerfile linter                  (community, GPLv3)
#   gitleaks     v8.30.1   secrets across git history         (community, MIT)
#   osv-scanner  v2.3.6    multi-ecosystem vuln scan          (Google, Apache 2.0)
#   bandit       latest    Python static security analysis    (PyCQA, Apache 2.0)
#
# Bandit is pip-installed into a dedicated venv at `~/.venv-sectools` and
# symlinked into ~/.local/bin so it sits alongside the binaries. PEP 668
# does NOT apply inside venvs, so this works on Debian-style hosts without
# --break-system-packages.
#
# Supply-chain posture:
#   * Each binary is downloaded from its project's official GitHub Releases
#     page (release-assets.githubusercontent.com).
#   * The CHECKSUM file from the same release is fetched separately and
#     used to verify the tarball BEFORE extraction. A mismatch aborts.
#   * No `curl | bash` patterns. No third-party mirrors.
#   * Idempotent: if the right version is already present, skip.
#   * Logs the URL and resolved SHA256 of every download. Auditable.
#
# Cross-platform:
#   * Linux  x86_64  ✓ (primary)
#   * Linux  arm64   ✓ (Graviton, Apple Silicon devcontainers)
#   * macOS  x86_64  ✓ (Intel Macs)
#   * macOS  arm64   ✓ (Apple Silicon Macs)
#   * Windows native ✗ — use WSL2.
#
# Usage:
#   scripts/install-sectools.sh                          # prints the banner; installs nothing
#   scripts/install-sectools.sh --confirm-install-sectools         # installs everything
#   scripts/install-sectools.sh --confirm-install-sectools trivy   # one tool only
#   scripts/install-sectools.sh --check                  # what's installed at what version
#   scripts/install-sectools.sh -h                       # this banner
#
# Exit codes:
#   0   install succeeded / banner printed / --check OK
#   1   bad arguments
#   2   missing dependency on host (curl, tar, sha256sum)
#   3   network or download failure
#   4   checksum mismatch — STOP and investigate, do not retry blindly
#   5   platform not supported

set -euo pipefail
IFS=$'\n\t'

# ─── pinned versions ───────────────────────────────────────────────────────
TRIVY_VERSION="0.69.3"
SYFT_VERSION="1.44.0"
HADOLINT_VERSION="2.14.0"
GITLEAKS_VERSION="8.30.1"
OSV_VERSION="2.3.6"
# Bandit pulled latest from PyPI in a venv; pin in venv-create step if you
# want it deterministic.

INSTALL_DIR="$HOME/.local/bin"
VENV_DIR="$HOME/.venv-sectools"

# ─── ui ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLU=$'\033[36m'; DIM=$'\033[2m'; RST=$'\033[0m'
else
  RED=""; GRN=""; YEL=""; BLU=""; DIM=""; RST=""
fi
ok()    { printf "  ${GRN}✓${RST} %s\n" "$*"; }
info()  { printf "  ${BLU}·${RST} %s\n" "$*"; }
warn()  { printf "  ${YEL}!${RST} %s\n" "$*" >&2; }
# die exits with $EXIT_RC if set by the caller (prefix-assignment style),
# else 3 (the generic network/io failure code).
die()   { printf "  ${RED}✗${RST} %s\n" "$*" >&2; exit "${EXIT_RC:-3}"; }
section() { printf "\n${DIM}── %s ──${RST}\n" "$*"; }

print_banner() {
  cat >&2 <<EOF

${YEL}══════════════════════════════════════════════════════════════════════${RST}
${YEL}  CONSENT REQUIRED — install-sectools.sh${RST}
${YEL}══════════════════════════════════════════════════════════════════════${RST}

This script will REACH OUT TO THE INTERNET and download executables that
will be placed on your PATH. You should know what it does before allowing
it to proceed.

What it would install into ${INSTALL_DIR}/:

  trivy v${TRIVY_VERSION}        from github.com/aquasecurity/trivy
  syft  v${SYFT_VERSION}        from github.com/anchore/syft
  hadolint v${HADOLINT_VERSION}      from github.com/hadolint/hadolint
  gitleaks v${GITLEAKS_VERSION}      from github.com/gitleaks/gitleaks
  osv-scanner v${OSV_VERSION}    from github.com/google/osv-scanner

  bandit (latest)        from PyPI, isolated in a venv at ${VENV_DIR}/

For each download, the published SHA256 from the project's release page
is fetched separately and used to verify the tarball BEFORE extraction.
A mismatch aborts with no files written. URLs and resolved SHAs are
printed as they happen — auditable.

Estimated total download: ~150 MB.
Estimated install time:   1–3 min.

${BLU}To proceed, re-run with the consent flag:${RST}

    scripts/install-sectools.sh --confirm-install-sectools

${BLU}To install only one tool:${RST}

    scripts/install-sectools.sh --confirm-install-sectools trivy

${BLU}To check what's already installed and what their versions are:${RST}

    scripts/install-sectools.sh --check

This script reads:  ${BASH_SOURCE[0]}  (review before running)

${YEL}══════════════════════════════════════════════════════════════════════${RST}

EOF
}

# ─── dependency probes ─────────────────────────────────────────────────────
check_host_deps() {
  local missing=()
  for cmd in curl tar sha256sum python3; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    EXIT_RC=2 die "missing host commands: ${missing[*]}"
  fi
}

# ─── platform detection ────────────────────────────────────────────────────
# Two separate functions because `IFS=$'\n\t'` at the top of this script
# would prevent `local os; os=$(detect_os); local arch; arch=$(detect_arch)` from splitting on space.
# Two getters dodge the gotcha entirely.
detect_os() {
  case "$(uname -s)" in
    Linux)  printf "linux" ;;
    Darwin) printf "darwin" ;;
    *)      EXIT_RC=5 die "unsupported OS: $(uname -s); supported: Linux, Darwin (use WSL2 on Windows)" ;;
  esac
}
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  printf "x86_64" ;;
    arm64|aarch64) printf "arm64" ;;
    *)             EXIT_RC=5 die "unsupported arch: $(uname -m)" ;;
  esac
}

# ─── verified download helper ──────────────────────────────────────────────
# verified_download <url> <expected-sha256> <out-path>
# fetches, verifies, fails loudly on mismatch.
verified_download() {
  local url="$1" expected="$2" out="$3"
  info "fetching $url"
  curl -fsSLo "$out" "$url" \
    || { EXIT_RC=3; die "download failed: $url"; }
  local actual
  actual=$(sha256sum "$out" | awk '{print $1}')
  if [ "$actual" != "$expected" ]; then
    rm -f "$out"
    EXIT_RC=4 die "SHA256 mismatch on $(basename "$out")
       expected: $expected
       got:      $actual
       deleted the bad download — investigate before retrying"
  fi
  ok "verified sha256 $actual"
}

# Look up the SHA256 for a given asset filename inside a checksums file we
# fetch from the same release. Most projects publish a single `checksums.txt`
# (one line per platform). Avoids having to embed per-platform SHAs.
sha_for_asset() {
  local checksums_url="$1" asset_name="$2"
  local sha
  sha=$(curl -fsSL "$checksums_url" 2>/dev/null \
        | grep -F "  $asset_name" \
        | head -1 | awk '{print $1}') \
    || { EXIT_RC=3; die "could not fetch checksums file: $checksums_url"; }
  if [ -z "$sha" ] || [ "${#sha}" -ne 64 ]; then
    EXIT_RC=3 die "no SHA256 for $asset_name in $checksums_url"
  fi
  printf "%s" "$sha"
}

# ─── per-tool installers ───────────────────────────────────────────────────

install_trivy() {
  section "trivy v${TRIVY_VERSION}"
  if command -v trivy >/dev/null 2>&1 && \
     trivy --version 2>&1 | grep -q "$TRIVY_VERSION"; then
    ok "already installed at the pinned version, skipping"
    return 0
  fi
  local os arch
  local os; os=$(detect_os); local arch; arch=$(detect_arch)
  # Trivy uses {Linux,macOS}-64bit / ARM64 in its asset names.
  local os_tag arch_tag asset
  case "$os" in linux) os_tag="Linux" ;; darwin) os_tag="macOS" ;; esac
  case "$arch" in x86_64) arch_tag="64bit" ;; arm64) arch_tag="ARM64" ;; esac
  asset="trivy_${TRIVY_VERSION}_${os_tag}-${arch_tag}.tar.gz"
  local checksums="https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_checksums.txt"
  local sha; sha=$(sha_for_asset "$checksums" "$asset")
  local tmp; tmp=$(mktemp -d)
  verified_download "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/${asset}" "$sha" "$tmp/$asset"
  tar -xzf "$tmp/$asset" -C "$tmp" trivy
  install -m 0755 "$tmp/trivy" "$INSTALL_DIR/trivy"
  rm -rf "$tmp"
  ok "installed: $($INSTALL_DIR/trivy --version 2>&1 | head -1)"
}

install_syft() {
  section "syft v${SYFT_VERSION}"
  if command -v syft >/dev/null 2>&1 && \
     syft version 2>/dev/null | grep -q "Version:[[:space:]]*v\?${SYFT_VERSION}"; then
    ok "already installed at the pinned version, skipping"
    return 0
  fi
  local os arch
  local os; os=$(detect_os); local arch; arch=$(detect_arch)
  case "$arch" in x86_64) arch="amd64" ;; esac
  local asset="syft_${SYFT_VERSION}_${os}_${arch}.tar.gz"
  local checksums="https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/syft_${SYFT_VERSION}_checksums.txt"
  local sha; sha=$(sha_for_asset "$checksums" "$asset")
  local tmp; tmp=$(mktemp -d)
  verified_download "https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/${asset}" "$sha" "$tmp/$asset"
  tar -xzf "$tmp/$asset" -C "$tmp" syft
  install -m 0755 "$tmp/syft" "$INSTALL_DIR/syft"
  rm -rf "$tmp"
  ok "installed: $($INSTALL_DIR/syft version 2>&1 | head -1)"
}

install_hadolint() {
  section "hadolint v${HADOLINT_VERSION}"
  if command -v hadolint >/dev/null 2>&1 && \
     hadolint --version 2>&1 | grep -q "$HADOLINT_VERSION"; then
    ok "already installed at the pinned version, skipping"
    return 0
  fi
  # hadolint ships a single binary, not a tarball, with a separate .sha256
  # file per asset. Naming: hadolint-{Linux,Darwin}-{x86_64,arm64}
  local os arch
  local os; os=$(detect_os); local arch; arch=$(detect_arch)
  case "$os" in linux) os="Linux" ;; darwin) os="Darwin" ;; esac
  local asset="hadolint-${os}-${arch}"
  local sha_url="https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/${asset}.sha256"
  # The .sha256 file format is `<sha>  <filename>`.
  local sha; sha=$(curl -fsSL "$sha_url" 2>/dev/null | awk '{print $1}')
  [ -z "$sha" ] && { EXIT_RC=3 die "could not fetch hadolint checksum"; }
  local tmp; tmp=$(mktemp -d)
  verified_download "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/${asset}" "$sha" "$tmp/hadolint"
  install -m 0755 "$tmp/hadolint" "$INSTALL_DIR/hadolint"
  rm -rf "$tmp"
  ok "installed: $($INSTALL_DIR/hadolint --version 2>&1 | head -1)"
}

install_gitleaks() {
  section "gitleaks v${GITLEAKS_VERSION}"
  if command -v gitleaks >/dev/null 2>&1 && \
     gitleaks version 2>&1 | grep -q "$GITLEAKS_VERSION"; then
    ok "already installed at the pinned version, skipping"
    return 0
  fi
  local os arch
  local os; os=$(detect_os); local arch; arch=$(detect_arch)
  # gitleaks: linux_x64 / linux_arm64 / darwin_x64 / darwin_arm64
  case "$arch" in x86_64) arch="x64" ;; esac
  local asset="gitleaks_${GITLEAKS_VERSION}_${os}_${arch}.tar.gz"
  local checksums="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_checksums.txt"
  local sha; sha=$(sha_for_asset "$checksums" "$asset")
  local tmp; tmp=$(mktemp -d)
  verified_download "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${asset}" "$sha" "$tmp/$asset"
  tar -xzf "$tmp/$asset" -C "$tmp" gitleaks
  install -m 0755 "$tmp/gitleaks" "$INSTALL_DIR/gitleaks"
  rm -rf "$tmp"
  ok "installed: $($INSTALL_DIR/gitleaks version 2>&1 | head -1)"
}

install_osv() {
  section "osv-scanner v${OSV_VERSION}"
  if command -v osv-scanner >/dev/null 2>&1 && \
     osv-scanner --version 2>&1 | grep -q "$OSV_VERSION"; then
    ok "already installed at the pinned version, skipping"
    return 0
  fi
  local os arch
  local os; os=$(detect_os); local arch; arch=$(detect_arch)
  # osv-scanner: osv-scanner_linux_amd64 (no .tar.gz, just bare binary)
  case "$arch" in x86_64) arch="amd64" ;; esac
  local asset="osv-scanner_${os}_${arch}"
  # OSV publishes its checksums file as `osv-scanner_SHA256SUMS`, not the
  # `checksums.txt` convention most projects use. Format same as elsewhere:
  # `<sha>  <filename>`.
  local checksums="https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_SHA256SUMS"
  local sha
  sha=$(curl -fsSL "$checksums" 2>/dev/null | grep "  $asset$" | awk '{print $1}')
  [ -z "$sha" ] && { EXIT_RC=3 die "no SHA256 for $asset in OSV checksums"; }
  local tmp; tmp=$(mktemp -d)
  verified_download "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/${asset}" "$sha" "$tmp/osv-scanner"
  install -m 0755 "$tmp/osv-scanner" "$INSTALL_DIR/osv-scanner"
  rm -rf "$tmp"
  ok "installed: $($INSTALL_DIR/osv-scanner --version 2>&1 | head -1)"
}

install_bandit() {
  section "bandit (latest from PyPI, isolated venv)"
  if command -v bandit >/dev/null 2>&1 && \
     [ -x "$INSTALL_DIR/bandit" ] && \
     [ -d "$VENV_DIR" ]; then
    ok "already installed (use 'pip install -U bandit' inside ${VENV_DIR} to bump)"
    return 0
  fi
  # Build the venv. Same PEP-668-aware pattern as scripts/shim-smoke-test.sh:
  # try `python3 -m venv` first; fall back to --without-pip + get-pip.py
  # if the host has no `ensurepip` payload (Debian slim).
  if [ ! -x "$VENV_DIR/bin/python" ]; then
    if ! python3 -m venv "$VENV_DIR" 2>/dev/null; then
      python3 -m venv --without-pip "$VENV_DIR" || { EXIT_RC=3 die "python3 -m venv failed"; }
    fi
  fi
  if [ ! -x "$VENV_DIR/bin/pip" ]; then
    local tmp; tmp=$(mktemp -t get-pip.XXXXXX.py)
    info "bootstrapping pip into $VENV_DIR"
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$tmp"
    "$VENV_DIR/bin/python" "$tmp" --quiet
    rm -f "$tmp"
  fi
  "$VENV_DIR/bin/pip" install --quiet --upgrade pip
  "$VENV_DIR/bin/pip" install --quiet bandit bandit_sarif_formatter
  # Symlink so PATH resolution finds it.
  ln -sf "$VENV_DIR/bin/bandit" "$INSTALL_DIR/bandit"
  ok "installed: $($INSTALL_DIR/bandit --version 2>&1 | head -1)"
}

# ─── argument handling ────────────────────────────────────────────────────
CONFIRMED=0
ONLY_TOOL=""
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --confirm-install-sectools) CONFIRMED=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      print_banner
      exit 0 ;;
    trivy|syft|hadolint|gitleaks|osv-scanner|bandit)
      ONLY_TOOL="$arg" ;;
    *) EXIT_RC=1 die "unknown argument: $arg (try --help)" ;;
  esac
done

# ─── --check mode: report what's installed at what version, no installs ────
if [ "$CHECK_ONLY" -eq 1 ]; then
  printf "Installed security tooling on this host:\n\n"
  for t in trivy syft hadolint gitleaks osv-scanner bandit; do
    if command -v "$t" >/dev/null 2>&1; then
      v=$("$t" --version 2>/dev/null | head -1 || "$t" version 2>/dev/null | head -1 || echo "?")
      printf "  ${GRN}✓${RST} %-12s %s\n" "$t" "$v"
    else
      printf "  ${YEL}–${RST} %-12s ${DIM}not installed${RST}\n" "$t"
    fi
  done
  exit 0
fi

# ─── consent check ────────────────────────────────────────────────────────
if [ "$CONFIRMED" -ne 1 ]; then
  print_banner
  exit 0
fi

# ─── do the install ───────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
check_host_deps

# Ensure ~/.local/bin is on PATH for this session — many shells include it
# by default but not all. We don't mutate ~/.bashrc.
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) export PATH="$INSTALL_DIR:$PATH"
     warn "added $INSTALL_DIR to PATH for this session only — add to your shell rc to make permanent" ;;
esac

if [ -n "$ONLY_TOOL" ]; then
  case "$ONLY_TOOL" in
    trivy)       install_trivy ;;
    syft)        install_syft ;;
    hadolint)    install_hadolint ;;
    gitleaks)    install_gitleaks ;;
    osv-scanner) install_osv ;;
    bandit)      install_bandit ;;
  esac
else
  install_trivy
  install_syft
  install_hadolint
  install_gitleaks
  install_osv
  install_bandit
fi

printf "\n${GRN}══ install-sectools: DONE ══${RST}\n"
printf "Run ${BLU}scripts/install-sectools.sh --check${RST} to verify, or\n"
printf "    ${BLU}scripts/scan-all.sh${RST} to produce a report.\n"
