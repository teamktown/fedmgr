# @letsfederate/kms

Pluggable signing for [fedmgr](https://github.com/teamktown/fedmgr) — one `KeyProvider` interface
(`kid` / `jwks` / `signJwt`) over three backends:

- **SoftKMS** — encrypted local JWKs (step-cli minted), for dev and the trust lab.
- **PKCS#11** — HSM / SoftHSM-backed keys (`pkcs11js`).
- **OpenBao / Vault Transit** — provider-owned signing that never exposes the private key.

Also ships the shared **SSRF URL guard** (`assertSafeUrl`) and the verifier-agnostic **trust policy**
layer (`applyPolicy` — strict / permissive / audit — and `formatTrustMessage`). The trust-*decision*
engine lives separately in [`@letsfederate/oidf-verify`](https://www.npmjs.com/package/@letsfederate/oidf-verify).

```ts
import { SoftKmsProvider } from "@letsfederate/kms";
const kms = new SoftKmsProvider({ publicJwkPath, privateJwkPath, issuer, jwksUrl });
const jws = await kms.signJwt({ sub: "…" }, { typ: "entity-statement+jwt" });
```

MIT.
