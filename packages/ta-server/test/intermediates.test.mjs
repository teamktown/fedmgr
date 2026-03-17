/**
 * Tests for intermediate entity support in the Trust Anchor server.
 *
 * Tests:
 *  1. isIntermediate() returns false for entry without metadata
 *  2. isIntermediate() returns false for entry with metadata but no federation_fetch_endpoint
 *  3. isIntermediate() returns true for entry with a valid federation_fetch_endpoint
 *  4. Intermediate appears in registry.listEntityIds()
 *  5. SubordinateRegistry.has() returns true for registered intermediate
 *  6. Subordinate statement for an intermediate includes metadata.federation_entity.federation_fetch_endpoint
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { generateKeyPair, exportJWK, decodeJwt } from "jose";
import { SoftKmsProvider } from "@letsfederate/kms";
import {
  signSubordinateStatement,
  SubordinateRegistry,
  isIntermediate,
} from "../dist/federation/subordinate-statements.js";

// ---------------------------------------------------------------------------
// Ephemeral keys for signing
// ---------------------------------------------------------------------------

const TMP = new URL("./.tmp/", import.meta.url).pathname;
const PUB_PATH = `${TMP}inter-ta.pub.jwk`;
const PRIV_PATH = `${TMP}inter-ta.priv.jwk`;

await fs.mkdir(TMP, { recursive: true });

const { publicKey, privateKey } = await generateKeyPair("ES256");
const pubJwk = { ...(await exportJWK(publicKey)), kty: "EC", crv: "P-256", use: "sig", kid: "inter-ta-kid" };
const privJwk = { ...(await exportJWK(privateKey)), kty: "EC", crv: "P-256", use: "sig", kid: "inter-ta-kid" };

await fs.writeFile(PUB_PATH, JSON.stringify(pubJwk), "utf8");
await fs.writeFile(PRIV_PATH, JSON.stringify(privJwk), "utf8");

const TA_KMS = new SoftKmsProvider({
  privateJwkPath: PRIV_PATH,
  publicJwkPath: PUB_PATH,
  issuer: "https://ta.example.org",
  jwksUrl: "https://ta.example.org/.well-known/jwks.json",
});

const INTERMEDIATE_JWKS = { keys: [pubJwk] };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("isIntermediate() returns false for entry without metadata", () => {
  assert.equal(
    isIntermediate({ entityId: "https://leaf.example.org", jwks: INTERMEDIATE_JWKS }),
    false
  );
});

test("isIntermediate() returns false for entry with metadata but no federation_fetch_endpoint", () => {
  assert.equal(
    isIntermediate({
      entityId: "https://leaf.example.org",
      jwks: INTERMEDIATE_JWKS,
      metadata: { federation_entity: { organization_name: "Leaf" } },
    }),
    false
  );
});

test("isIntermediate() returns true for entry with federation_fetch_endpoint", () => {
  assert.equal(
    isIntermediate({
      entityId: "https://intermediate.example.org",
      jwks: INTERMEDIATE_JWKS,
      metadata: {
        federation_entity: {
          federation_fetch_endpoint: "https://intermediate.example.org/federation_fetch",
        },
      },
    }),
    true
  );
});

test("intermediate appears in registry.listEntityIds()", () => {
  const reg = new SubordinateRegistry();
  reg.register({
    entityId: "https://intermediate.example.org",
    jwks: INTERMEDIATE_JWKS,
    metadata: {
      federation_entity: {
        federation_fetch_endpoint: "https://intermediate.example.org/federation_fetch",
      },
    },
  });
  assert.ok(reg.listEntityIds().includes("https://intermediate.example.org"));
});

test("registry.has() returns true for registered intermediate", () => {
  const reg = new SubordinateRegistry();
  reg.register({
    entityId: "https://intermediate.example.org",
    jwks: INTERMEDIATE_JWKS,
    metadata: {
      federation_entity: {
        federation_fetch_endpoint: "https://intermediate.example.org/federation_fetch",
      },
    },
  });
  assert.equal(reg.has("https://intermediate.example.org"), true);
});

test("subordinate statement for intermediate includes federation_fetch_endpoint in metadata", async () => {
  const fetchEndpoint = "https://intermediate.example.org/federation_fetch";
  const jws = await signSubordinateStatement(
    {
      issuerEntityId: "https://ta.example.org",
      subjectEntityId: "https://intermediate.example.org",
      subjectJwks: INTERMEDIATE_JWKS,
      subjectMetadata: {
        federation_entity: {
          federation_fetch_endpoint: fetchEndpoint,
        },
      },
    },
    TA_KMS
  );

  const payload = decodeJwt(jws);
  const fe = payload.metadata?.["federation_entity"];
  assert.ok(fe, "metadata.federation_entity should be present");
  assert.equal(fe["federation_fetch_endpoint"], fetchEndpoint);
});
