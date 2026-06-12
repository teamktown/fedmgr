# Phase 6.1 — test evidence (oidf-trust extension + E1 scaffolding)

Run date: 2026-06-12 (UTC). Node: v22.22.3. Raw, unedited runner output.

## oidf-trust extension + accepted-anchor policy — `test/oidf-trust-extension.test.mjs`
```
ok 1 - extension id is the vendor-prefixed identifier
ok 2 - buildOidfTrustExtension fills a default federationConfigUrl
ok 3 - admits when the trust anchor is accepted and the required mark is advertised
ok 4 - E5: DENIES when the trust anchor is NOT in the accepted-anchor list
ok 5 - DENIES when the required trust mark is not advertised
ok 6 - E3/E4: image digest binding — matches admits, mismatch denies
ok 7 - patient zero: fedmgr-mcp advertises the extension and a matching policy admits it
ok 8 - fail-closed on malformed or missing extension
# tests 8
# pass 8
# fail 0
```

## Full fedmgr-mcp suite (regression)
```
# tests 30
# pass 30
# fail 0
# skipped 0
# todo 0
```

## Container round trip — LAB-GATED, honestly not executed here

cosign/syft/SoftHSM are absent in the build sandbox, so `examples/01-trust-circle/round-trip.sh`
cannot perform the real signing. Per the no-glossing rule its preflight ABORTS rather than fake a
result. Captured run (note the non-zero exit 69 = EX_UNAVAILABLE):
```
[TRUST:FAIL] required tool 'cosign' is not installed.
[TRUST:FAIL] required tool 'syft' is not installed.

This round trip needs: docker, cosign, syft, jq (and a running lab with the local
OCI registry + TA + TMI from examples/lab/docker-compose.yml, plus SoftHSM for the
signing key). Install them, start the lab, then re-run. Aborting rather than
producing an unsigned/under-verified result.
exit=69
```

Run the full loop in the lab (docker + cosign + syft + SoftHSM) to produce signed-artifact evidence.
