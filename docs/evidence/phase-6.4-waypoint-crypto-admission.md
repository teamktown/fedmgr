# Phase 6.4 — Waypoint cryptographic admission (live lab, 2026-06-12)

Waypoint now requires each downstream's OIDF trust chain to resolve **VALID** to its
anchor before connecting (policy.requireValidChain), via validateTrustChain from
@letsfederate/kms. Run against the live lab (TA:8090, TMI:8080). Raw output.

## Real chain validation (kmsTrustValidator → validateTrustChain)
```
TMI (real subordinate http://localhost:8080)   → valid=true state=VALID
bogus (http://localhost:8099)                  → valid=false state=INVALID
```

## Full Waypoint admission (real kmsTrustValidator + real sdkConnector + live lab)
```
declared id chains to TA (VALID)       admit=true chain=VALID tools=12
declared id does NOT chain (INVALID)   admit=false chain=INVALID tools=0
```

A downstream the accepted-anchor config would accept is still DENIED when its chain
fails to resolve — cryptographic admission is a strictly stronger gate. Unit tests
(fake validator) cover VALID-admit, WARN/INVALID-deny, validator-throws-deny, and
no-validator-deny in packages/waypoint/test/mux.test.mjs.
