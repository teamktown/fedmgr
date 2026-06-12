# Phase 6.1 — full TA/TMI lab, round-trip.sh end-to-end (VM, 2026-06-12)

The full lab (`examples/lab/docker-compose.yml`) is up and `examples/01-trust-circle/round-trip.sh`
completes end-to-end against the **live TMI**. Raw outputs; several latent compose/build bugs
were fixed to get here (see the commit).

## Lab status
```
trust-lab-registry	Up 6 minutes
trust-lab-ta	Up 44 seconds (healthy)
trust-lab-tmi	Up 2 minutes (healthy)
```

## Trust chain established (TA has the TMI as a subordinate)
```
GET /federation_list  -> ["http://localhost:8080"]
TA  /health           -> {"status":"ok","entity_id":"http://localhost:8090","subordinates":1,"db_path":"/tmp/ta.db"}
TMI /health           -> {"status":"ok","issuer":"http://localhost:8080"}
```

## round-trip.sh — end-to-end (exit 0)

build -> push (local registry) -> cosign sign -> syft SBOM -> **live TMI digest-bound
trustmark** -> cosign verify + trustmark digest binding:
```
==> [1/7] build image
==> [2/7] push to local registry localhost:5000
==> [3/7] resolve digest
    digest=sha256:dfae50058dabce6c6254c1c4dfd3bab3a4151674fd9651a4b3e988dd18a2fe72
==> [4/7] cosign sign (key=/tmp/cosign.key)
==> [5/7] generate SBOM (syft) and attach
==> [6/7] issue digest-bound trustmark via TMI
==> [7/7] verify: cosign + trustmark digest binding
  - The cosign claims were validated
  - The signatures were verified against the specified public key
[TRUST:VALID] round trip complete — image signed (cosign) and bound to a trustmark for sha256:dfae50058dabce6c6254c1c4dfd3bab3a4151674fd9651a4b3e988dd18a2fe72
exit=0
```

## Independent check — live TMI trustmark JWS verifies against its published JWKS
```
{"kty":"EC","crv":"P-256","alg":"ES256"}  (TMI JWKS)
trustmark_jws signature: VALID against http://localhost:8080/.well-known/jwks.json (jose createRemoteJWKSet)
payload.image_digest == pushed image digest: YES
```
