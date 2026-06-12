# Phase 6.1 — LAB round trip (executed in the VM, 2026-06-12)

Real container-signing round trip run **in this VM** (docker 29.5.3, cosign 2.4.1,
syft 1.45.1, SoftHSM 2.6.1). Raw outputs — nothing simulated.

## 1. HSM-rooted key (SoftHSM, EC P-256)
```
Public Key Object; EC  EC_POINT 256 bits
  label:      fedmgr-ta
Private Key Object; EC
  label:      fedmgr-ta
```

## 2. Image pushed to local registry → digest
```
image=localhost:5000/letsfederate/fedmgr-mcp:demo
digest=sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
```

## 3. cosign verify (key-based signature in the registry)
```
The following checks were performed on each of these signatures:
  - The signatures were verified against the specified public key
```

## 4. SBOM (syft, SPDX)
```
spdx packages: 15
```

## 5. Digest-bound trustmark (our ES256 signing) + admission
```
trustmark signature: VALID (ES256)
trustmark.image_digest === pushed digest: true
admit (matching digest): true
admit (rebuilt/rogue digest): false
```

## Honest limitation (not glossed)

The official cosign **release binary lacks PKCS#11** support, so signing the image
directly with the SoftHSM key fails:
```
Error: ... opening pkcs11 token key: unimplemented
```
HSM-rooted *image* signing therefore needs cosign built with the `pkcs11key` tag, or
a cloud-KMS key URI (`--key awskms://…|gcpkms://…|hashivault://…`). The SoftHSM EC key
is real (§1); the image round trip above used a key-based cosign signature, and the
OIDF trustmark used our ES256 signing (where the `KeyProvider`/HSM seam lives).
