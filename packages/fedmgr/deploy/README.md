# fedmgr deploy assets

These assets travel inside the published `@letsfederate/fedmgr` package so
`fedmgr init` can stand up a local trust ecosystem.

## Status (honest)
- **From a checkout:** `fedmgr init` finds `examples/lab/` and builds the TA/TMI
  images from source — works today.
- **Standalone (`npx @letsfederate/fedmgr init` with no checkout):** needs
  **pre-built images** pulled from a registry, because an npm tarball can't
  build a Docker image from source it doesn't carry. We do **not** publish
  images yet (no operational registry) — so standalone image-based bring-up is
  the remaining gap. `docker-compose.standalone.yml` is the target shape for
  when images are published; today it references images that don't exist.

## What IS standalone today
Even without a checkout, `fedmgr init` runs the parts that need no source build:
validate-before-run, mint-and-verify the local CA, and (with syft/cosign) the
signed-SBOM self-provenance. `fedmgr doctor` reports exactly what's available.
