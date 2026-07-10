# syntax=docker/dockerfile:1
# Trust Anchor Server — multi-stage build (mirrors Dockerfile.tmi-server)

FROM node:22-slim AS builder

WORKDIR /build

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/kms/package.json        packages/kms/
COPY packages/fedvec/package.json     packages/fedvec/
COPY services/ta-server/package.json  services/ta-server/

# --ignore-scripts skips ALL native postinstall builds (avoids pkcs11js, which we
# don't need here). better-sqlite3 IS needed by the TA, so we rebuild just that one
# with a toolchain. WHY: without this the TA crashes at boot ("better_sqlite3.node
# not found").
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm ci --ignore-scripts
RUN npm rebuild better-sqlite3

# --ignore-scripts also skips the root postinstall, which adapts fastembed to
# the security-pinned tar >= 7 (see scripts/patch-fastembed.cjs). Run it
# explicitly — without it, FastEmbedder (TA_VEC_EMBEDDER=minilm) breaks at
# model download.
COPY scripts/patch-fastembed.cjs scripts/
RUN node scripts/patch-fastembed.cjs

COPY packages/kms/      packages/kms/
COPY packages/fedvec/   packages/fedvec/
COPY services/ta-server/ services/ta-server/

# ta-server references @letsfederate/fedvec (semantic federation_search), which
# in turn pulls @ruvector/rvf (native glibc prebuilt — matches node:22-slim) and
# fastembed. Build kms + fedvec before ta-server so tsc -b's project references
# resolve.
RUN npm run build -w @letsfederate/kms
RUN npm run build -w @letsfederate/fedvec
RUN npm run build -w @letsfederate/ta-server

# Keep production deps but DON'T re-run install scripts (would drop the rebuilt
# better-sqlite3 binary on some npm versions); prune is safe for that.
RUN npm prune --production

FROM node:22-slim AS runtime

RUN addgroup --system ta && adduser --system --ingroup ta ta

WORKDIR /app

COPY --from=builder --chown=ta:ta /build/node_modules             ./node_modules
COPY --from=builder --chown=ta:ta /build/packages/kms/dist        ./packages/kms/dist
COPY --from=builder --chown=ta:ta /build/packages/fedvec/dist     ./packages/fedvec/dist
COPY --from=builder --chown=ta:ta /build/services/ta-server/dist  ./services/ta-server/dist
COPY --from=builder --chown=ta:ta /build/packages/kms/package.json       ./packages/kms/package.json
COPY --from=builder --chown=ta:ta /build/packages/fedvec/package.json    ./packages/fedvec/package.json
COPY --from=builder --chown=ta:ta /build/services/ta-server/package.json ./services/ta-server/package.json

RUN mkdir -p /app/keys && chown ta:ta /app/keys

USER ta

ENV PORT=8090 \
    TA_ENTITY_ID=http://localhost:8090 \
    TA_JWKS_URL=http://localhost:8090/.well-known/jwks.json \
    TA_PUBLIC_JWK=/app/keys/ta.pub.jwk \
    TA_PRIVATE_JWK=/run/secrets/ta.priv.jwk

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s \
    CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/ta-server/dist/index.js"]
