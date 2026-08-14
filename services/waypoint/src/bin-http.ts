#!/usr/bin/env node
/**
 * waypoint HTTP entrypoint — remote MCP over Streamable HTTP, behind the OAuth edge.
 *
 * Env:
 *   WAYPOINT_CONFIG          path to the waypoint config JSON (downstreams + policy)
 *   WAYPOINT_OIDC_ISSUER     IdP issuer (e.g. https://accounts.google.com)
 *   WAYPOINT_OIDC_AUDIENCE   this waypoint's audience/identifier
 *   WAYPOINT_OIDC_JWKS_URI   the IdP's JWKS endpoint
 *   WAYPOINT_HTTP_PORT       listen port (default 8077)
 *   WAYPOINT_RESOURCE_METADATA_URL  public PRM URL to advertise on 401
 *                            (default ${AUDIENCE}/.well-known/oauth-protected-resource;
 *                            set to the public URL when behind a tunnel)
 *
 * Inbound = OAuth/OIDC (identity plane). Downstream = OpenID Federation.
 */
import { readFile } from "node:fs/promises";
import { Waypoint } from "./mux.js";
import { sdkConnector } from "./connector.js";
import { kmsTrustValidator } from "./trust-validator.js";
import { makeOAuthEdge } from "./oauth-edge.js";
import { startHttpWaypoint } from "./http-server.js";
import { log, initTelemetrySdk } from "./telemetry.js";
import type { WaypointConfig } from "./types.js";

async function loadConfig(): Promise<WaypointConfig> {
  const path = process.env["WAYPOINT_CONFIG"];
  if (!path) throw new Error("[TRUST:FAIL] WAYPOINT_CONFIG must point to a waypoint config JSON file");
  const cfg = JSON.parse(await readFile(path, "utf8")) as WaypointConfig;
  if (!Array.isArray(cfg.downstreams) || !cfg.policy || !Array.isArray(cfg.policy.acceptedAnchors)) {
    throw new Error("[TRUST:FAIL] invalid config: need { downstreams:[...], policy:{ acceptedAnchors:[...] } }");
  }
  return cfg;
}

function oauthConfig(): { issuer: string; audience: string; jwksUri: string } {
  const issuer = process.env["WAYPOINT_OIDC_ISSUER"];
  const audience = process.env["WAYPOINT_OIDC_AUDIENCE"];
  const jwksUri = process.env["WAYPOINT_OIDC_JWKS_URI"];
  if (!issuer || !audience || !jwksUri) {
    throw new Error(
      "[TRUST:FAIL] OAuth edge requires WAYPOINT_OIDC_ISSUER, WAYPOINT_OIDC_AUDIENCE, WAYPOINT_OIDC_JWKS_URI"
    );
  }
  return { issuer, audience, jwksUri };
}

async function main(): Promise<void> {
  await initTelemetrySdk();
  const waypoint = new Waypoint(await loadConfig(), sdkConnector, { trustValidator: kmsTrustValidator });
  await waypoint.start();
  const oc = oauthConfig();
  const verifier = makeOAuthEdge(oc);
  const resourceMetadataUrl =
    process.env["WAYPOINT_RESOURCE_METADATA_URL"] ??
    `${oc.audience.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
  startHttpWaypoint({
    waypoint,
    verifier,
    oauthMetadata: {
      resource: oc.audience,
      authorizationServers: [oc.issuer],
      scopesSupported: ["mcp"],
      resourceMetadataUrl,
    },
  });
  const admitted = waypoint.admissions().filter((a) => a.admit).map((a) => a.name);
  log.info("waypoint HTTP ready", { admitted, tools: waypoint.listTools().length });
}

main().catch((err) => {
  process.stderr.write(`[waypoint-http] fatal: ${String(err)}\n`);
  process.exit(1);
});
