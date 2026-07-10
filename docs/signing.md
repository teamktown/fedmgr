# Supply Chain Integrity — Signing, SBOM, and Trust Model

> **Principle**: _Say what we do, and do what we say._
> fedmgr is a tool for asserting trustmarks about software.
> This document describes how fedmgr asserts trustmarks **about itself**.

---

## 1. What Gets Signed and How

Every artifact fedmgr produces or depends on carries at least one verifiable signature.

| Artifact | Signed by | Mechanism | Verifiable via |
|---|---|---|---|
| npm package (kms, cli, servers) | GitHub Actions OIDC | npm provenance (Sigstore) | `npm audit signatures` |
| Container image | GitHub Actions OIDC | cosign keyless (Sigstore) | `cosign verify` |
| Container SBOM | GitHub Actions OIDC | cosign attestation (CycloneDX) | `cosign verify-attestation --type cyclonedx` |
| Container trustmark | letsfederate.org TMI | OIDF JWS (fedmgr CLI) | `fedmgr oci verify-trustmark` |

The trustmark layer is the unique part: the container is vouched for through the same
OIDF federation trust chain that fedmgr manages for others.

---

## 2. Trust Chain for Container Trustmarks

```
https://letsfederate.org            ← Trust Anchor (TA)
  ↓  subordinate statement (signed by TA)
https://tmi.letsfederate.org        ← Trustmark Issuer (TMI)
  ↓  trustmark JWS (signed by TMI)
ghcr.io/teamktown/ta-server@sha256:… ← Subject: container image
  │
  └─ attached as cosign attestation (predicate type: OIDF trustmark URI)
```

Anyone with internet access can verify this chain:

```bash
# Verify the trustmark on a ta-server container:
fedmgr oci verify-trustmark \
  --image ghcr.io/teamktown/ta-server:latest

# Verify the OIDF trust chain back to letsfederate.org:
fedmgr trustmark verify \
  --jws <trustmark-jws> \
  --jwks https://tmi.letsfederate.org/.well-known/jwks.json

# Verify the Trust Anchor's subordinate statement:
curl https://letsfederate.org/federation_fetch?sub=https://tmi.letsfederate.org | \
  step crypto jws verify --jwks https://letsfederate.org/.well-known/jwks.json
```

---

## 3. npm Provenance

npm provenance ties each published package to the specific GitHub Actions
workflow run that produced it.

### How it works

1. GitHub Actions runs the release workflow with `id-token: write` permission
2. `npm publish --provenance` requests an OIDC token from GitHub
3. npm sends the token to Sigstore — receives a short-lived signing certificate
4. The certificate includes: repository URL, workflow file, git SHA, run ID
5. A provenance attestation is signed and stored in Sigstore's Rekor transparency log
6. npm registry stores the attestation alongside the package tarball

### Verify a published package

```bash
# Verify signatures on installed packages:
npm audit signatures

# Verbose — shows provenance details for each package:
npm audit signatures --verbose

# Example output for @letsfederate/kms:
# @letsfederate/kms@1.0.0: Signed by:
#   Repository: teamktown/fedmgr
#   Workflow:   .github/workflows/release.yml
#   SHA:        <git-sha>
```

### Requirements

| What | Where |
|---|---|
| `"provenance": true` in `publishConfig` | Each `package.json` ✅ |
| `id-token: write` permission | `release.yml` ✅ |
| `NPM_TOKEN` secret | GitHub repo settings — `Settings → Secrets → NPM_TOKEN` |
| npm account | `@letsfederate` org on npmjs.com |

---

## 4. Container Signing (cosign keyless)

Container images are signed using cosign's keyless mode with Sigstore OIDC.
No long-lived signing keys are stored in CI.

### How it works

1. GitHub Actions provides an OIDC token identifying the workflow
2. `cosign sign` requests a short-lived Fulcio certificate bound to the OIDC identity
3. The signing event is logged in Rekor (public transparency log)
4. The signature is pushed to the OCI registry alongside the image

### Verify a container image

```bash
# Install cosign
brew install cosign          # macOS
# or: https://docs.sigstore.dev/cosign/installation/

# Verify signature:
cosign verify \
  ghcr.io/teamktown/ta-server:latest \
  --certificate-identity-regexp \
    "https://github.com/teamktown/fedmgr/.github/workflows/containers.yml" \
  --certificate-oidc-issuer \
    "https://token.actions.githubusercontent.com"

# Verify SBOM attestation:
cosign verify-attestation \
  --type cyclonedx \
  ghcr.io/teamktown/ta-server:latest \
  --certificate-identity-regexp \
    "https://github.com/teamktown/fedmgr/.github/workflows/containers.yml" \
  --certificate-oidc-issuer \
    "https://token.actions.githubusercontent.com" \
  | jq '.payload | @base64d | fromjson | .predicate'
```

---

## 5. SBOM — Software Bill of Materials

An SBOM is generated for every container image and for every npm release.

| Format | Tool | Attached as |
|---|---|---|
| CycloneDX JSON | Syft | cosign attestation on each container |
| CycloneDX JSON | @cyclonedx/cyclonedx-npm | Release artifact + CI artifact |

### Reading the container SBOM

```bash
cosign verify-attestation \
  --type cyclonedx \
  ghcr.io/teamktown/tmi-server:latest \
  --certificate-identity-regexp \
    "https://github.com/teamktown/fedmgr/.github/workflows/containers.yml" \
  --certificate-oidc-issuer \
    "https://token.actions.githubusercontent.com" \
  | jq -r '.payload | @base64d | fromjson | .predicate.components[].name' \
  | sort
```

### Daily SBOM diff

`scripts/sbom-diff.sh` compares two CycloneDX JSON SBOMs and prints new/removed
components. The daily scan workflow (`daily-scan.yml`) runs this automatically:

```bash
./scripts/sbom-diff.sh sbom-baseline.json sbom-current.json
# NEW:     express@5.0.0     ← flagged for review
# REMOVED: express@4.19.2
# Summary: 1 new, 1 removed
```

Exit code 1 if any new components are found — CI opens a GitHub issue.

---

## 6. Trust Anchor Infrastructure Requirements

For the trustmark self-attestation chain to be publicly verifiable,
the following must be deployed:

| Service | URL | Purpose |
|---|---|---|
| Trust Anchor | `https://letsfederate.org` | Root of the OIDF federation |
| Trust Anchor JWKS | `https://letsfederate.org/.well-known/jwks.json` | TA public key |
| Trust Anchor entity config | `https://letsfederate.org/.well-known/openid-federation` | Self-signed entity statement |
| Trust Anchor federation_fetch | `https://letsfederate.org/federation_fetch?sub=https://tmi.letsfederate.org` | Subordinate statement for TMI |
| TMI | `https://tmi.letsfederate.org` | Issues signed trustmarks |
| TMI JWKS | `https://tmi.letsfederate.org/.well-known/jwks.json` | TMI public key |

### DNS and TLS

- `letsfederate.org` must have a valid TLS certificate (Let's Encrypt is fine)
- The TA server and TMI server can run on the same host with different subdomains
- Use the compose lab (`examples/lab/docker-compose.yml`) as the local model;
  the production setup adds a reverse proxy (nginx/Caddy) in front

### Key material for CI trustmark issuance

The `containers.yml` workflow issues trustmarks during container release.
This requires the TMI signing key accessible in CI:

| Secret name | Value | How to create |
|---|---|---|
| `TMI_PRIV_JWE` | `base64 services/tmi-server/keys/tmi.priv.jwe` | `npm run tmi:keys:init` then encode |
| `TMI_JWE_PASSPHRASE` | The passphrase used during key init | Used at init time |
| `TMI_ISSUER` | `https://tmi.letsfederate.org` | Your TMI deployment URL |
| `TMI_JWKS_URL` | `https://tmi.letsfederate.org/.well-known/jwks.json` | Derived from TMI_ISSUER |
| `NPM_TOKEN` | npm access token | npm.com → Access Tokens → Automation |

```bash
# Encode TMI key for GitHub secret:
base64 -w0 services/tmi-server/keys/tmi.priv.jwe
# Paste the output as TMI_PRIV_JWE in GitHub Settings → Secrets
```

If `TMI_PRIV_JWE` is not set, the containers workflow skips trustmark issuance
(cosign signatures + SBOM attestation still proceed normally).

---

## 7. Commit Convention → Semantic Versioning

Semantic release reads conventional commits to determine version bumps.
Write commits as:

| Commit prefix | Bump | Example |
|---|---|---|
| `fix:` | patch (0.0.X) | `fix(kms): handle expired JWK gracefully` |
| `feat:` | minor (0.X.0) | `feat(ta-server): add pagination to federation_list` |
| `feat!:` or `BREAKING CHANGE:` | major (X.0.0) | `feat!: change trustmark payload schema` |
| `chore:`, `docs:`, `test:` | no release | `docs: update signing guide` |

### Release flow

```
commit to main
    ↓
CI passes (ci.yml)
    ↓
release.yml runs semantic-release per package
    ↓ (if version bump detected)
  - CHANGELOG.md updated
  - package.json version bumped
  - git tag pushed: @letsfederate/kms@1.2.3
  - npm publish (with provenance)
  - GitHub Release created
    ↓
containers.yml triggers on tag
    ↓
  - Docker build (linux/amd64 + linux/arm64)
  - Trivy scan
  - cosign sign
  - SBOM attestation
  - Trustmark issued + attached
```

---

## 8. Verification Quick Reference

```bash
# npm package signatures
npm audit signatures

# Container cosign signature
cosign verify \
  ghcr.io/teamktown/ta-server:1.0.0 \
  --certificate-identity-regexp "https://github.com/teamktown/fedmgr" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

# Container SBOM
cosign verify-attestation --type cyclonedx \
  ghcr.io/teamktown/ta-server:1.0.0 \
  --certificate-identity-regexp "https://github.com/teamktown/fedmgr" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

# OIDF trustmark on container
fedmgr oci verify-trustmark --image ghcr.io/teamktown/ta-server:1.0.0

# OIDF trust chain (manual)
curl -s https://letsfederate.org/.well-known/openid-federation | \
  step crypto jwt inspect --insecure
curl -s "https://letsfederate.org/federation_fetch?sub=https://tmi.letsfederate.org" | \
  step crypto jwt inspect --insecure
```

---

## 9. Secrets Checklist

Before first release, configure these in **GitHub → Settings → Secrets and variables → Actions**:

- [ ] `NPM_TOKEN` — npm automation token for `@letsfederate` org
- [ ] `TMI_PRIV_JWE` — base64-encoded TMI private key JWE _(optional for trustmarks)_
- [ ] `TMI_JWE_PASSPHRASE` — TMI key passphrase _(optional)_
- [ ] `TMI_ISSUER` — TMI public URL _(optional)_
- [ ] `TMI_JWKS_URL` — TMI JWKS URL _(optional)_

The `GITHUB_TOKEN` is automatically provided — no configuration needed.
