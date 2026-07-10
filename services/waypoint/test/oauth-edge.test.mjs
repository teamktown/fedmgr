/**
 * OAuth edge (identity plane) — verify inbound OAuth/OIDC bearer tokens.
 * Fail-closed: wrong issuer/audience, expired, tampered, or unconfigured → reject.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { makeOAuthEdge } from "../dist/oauth-edge.js";

const ISS = "https://idp.example", AUD = "https://waypoint.example";
let priv, pub;
async function keys() {
  if (!priv) { const k = await generateKeyPair("ES256", { extractable: true }); priv = k.privateKey; pub = k.publicKey; }
}
async function mint(over = {}) {
  await keys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: over.scope ?? "mcp.invoke", azp: over.azp ?? "cli-x" })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(over.iss ?? ISS)
    .setAudience(over.aud ?? AUD)
    .setSubject(over.sub ?? "user-1")
    .setIssuedAt(now)
    .setExpirationTime(over.exp ?? now + 3600)
    .sign(priv);
}
const edge = async () => { await keys(); return makeOAuthEdge({ issuer: ISS, audience: AUD, key: pub }); };

test("valid token → AuthInfo with clientId, scopes, expiresAt", async () => {
  const info = await (await edge()).verifyAccessToken(await mint());
  assert.equal(info.clientId, "cli-x");
  assert.deepEqual(info.scopes, ["mcp.invoke"]);
  assert.equal(typeof info.expiresAt, "number");
  assert.equal(info.extra.sub, "user-1");
});
test("wrong issuer → reject", async () => {
  const v = await edge();
  const t = await mint({ iss: "https://evil.example" });
  await assert.rejects(() => v.verifyAccessToken(t));
});
test("wrong audience → reject", async () => {
  const v = await edge();
  const t = await mint({ aud: "https://other.example" });
  await assert.rejects(() => v.verifyAccessToken(t));
});
test("expired token → reject", async () => {
  const v = await edge();
  const now = Math.floor(Date.now() / 1000);
  const t = await mint({ exp: now - 30 });
  await assert.rejects(() => v.verifyAccessToken(t));
});
test("tampered signature → reject", async () => {
  const v = await edge();
  const t = await mint();
  const bad = t.slice(0, -3) + (t.endsWith("AAA") ? "BBB" : "AAA");
  await assert.rejects(() => v.verifyAccessToken(bad));
});
test("config without key or jwksUri throws (fail-closed)", () => {
  assert.throws(() => makeOAuthEdge({ issuer: ISS, audience: AUD }));
});

// Rejections must be the SDK's InvalidTokenError so requireBearerAuth returns
// 401 — a raw jose error becomes a 500 (leaks nothing useful and looks like a
// server fault on attacker input). Regression guard for that.
test("malformed / invalid tokens reject as InvalidTokenError (=> 401, not 500)", async () => {
  const v = await edge();
  const cases = [
    "not.a.jwt",
    "garbage",
    await mint({ iss: "https://evil.example" }),
    await mint({ aud: "https://other.example" }),
  ];
  for (const t of cases) {
    await assert.rejects(
      () => v.verifyAccessToken(t),
      (e) => e instanceof InvalidTokenError,
      `expected InvalidTokenError for token: ${t.slice(0, 12)}…`,
    );
  }
});
