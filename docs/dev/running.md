# Running fedmgr from this repo

The published front door is `@letsfederate/fedmgr` (`bin: fedmgr`). Until it's
published to npm, run it from a checkout.

## One-time setup
```bash
cd /home/vagrant/fedmgr      # the repo root
npm install                  # install workspace deps
npm run build                # compile all packages (tsc -b)
```

## Invoke it
The built entrypoint is always runnable directly:
```bash
node packages/fedmgr/dist/bin.js --help
node packages/fedmgr/dist/bin.js doctor            # host readiness check
node packages/fedmgr/dist/bin.js doctor --json     # machine/LLM-readable
node packages/fedmgr/dist/bin.js init --dry-run    # show the phased plan
```

Prefer a short command? Add a shell alias (or `npm link`):
```bash
# alias — simplest, no global install:
alias fedmgr='node /home/vagrant/fedmgr/packages/fedmgr/dist/bin.js'
fedmgr doctor

# or expose a real `fedmgr` on PATH via npm:
npm link -w @letsfederate/fedmgr
fedmgr doctor
```

## Logging / telemetry knobs
Logs go to **stderr**; machine-readable command output goes to **stdout** (so
you can pipe `--json` cleanly while still seeing the narration).
```bash
LOG_LEVEL=debug fedmgr init --dry-run     # error|warn|info|debug|trace (default info)
LOG_FORMAT=json fedmgr doctor             # force structured logs (default: text on a TTY)
```

## The trust lab (what `init` stands up)
```bash
./examples/lab/up.sh      # build + start registry + Trust Anchor + Trustmark Issuer, wait healthy
./examples/lab/down.sh    # stop & clean
curl -s localhost:8090/health                       # Trust Anchor
curl -s localhost:8080/health                       # Trustmark Issuer
curl -s 'localhost:8090/federation_search?q=trust'  # semantic search (fedvec)
```

## Tests (verify your environment isn't drifting)
```bash
npm test                                  # all packages (node --test)
npm test -w @letsfederate/fedmgr          # just the CLI package
node --test packages/fedmgr/test/ca.test.mjs   # a single suite
```
Integration tests that need Docker (e.g. the CA mint) **skip with a clear
`# SKIP` line** when Docker is absent — a skip is reported as a skip, never
counted as a pass. See `docs/dev/gotchas.md` for the why.
