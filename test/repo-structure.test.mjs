// Repo-structure guards for the packages/ vs services/ split.
//
// packages/*  → npm is the artifact (publishable libraries + CLI + MCP tool)
// services/*  → a container image is the artifact (never npm-published)
//
// These tests keep that boundary self-enforcing: manifests, dependency
// direction, Dockerfile placement, SSC scan coverage, and the lab compose
// wiring all break loudly here instead of silently in CI or a release.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (p) => JSON.parse(readFileSync(join(repoRoot, p), "utf8"));
const workspaceDirs = (parent) =>
  readdirSync(join(repoRoot, parent), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(repoRoot, parent, d.name, "package.json")))
    .map((d) => `${parent}/${d.name}`);

const services = workspaceDirs("services");
const packages = workspaceDirs("packages");
const serviceNames = new Set(services.map((s) => readJson(`${s}/package.json`).name));

// Known debt, tracked explicitly: fedmgr-mcp imports entity/subordinate-statement
// signing from ta-server (src/openid-ops.ts) and a schema from tmi-server in a
// test. Until that code is extracted into a library, fedmgr-mcp MUST NOT be
// released to npm. Do not add new entries here — extract a library instead.
const BOUNDARY_DEBT_ALLOWLIST = {
  "@letsfederate/fedmgr-mcp": new Set([
    "@letsfederate/ta-server",
    "@letsfederate/tmi-server",
  ]),
};

test("root workspaces include packages/*, services/* and site", () => {
  const root = readJson("package.json");
  for (const ws of ["packages/*", "services/*", "site"]) {
    assert.ok(root.workspaces.includes(ws), `workspaces missing "${ws}"`);
  }
});

test("every service is private and has no publishConfig", () => {
  assert.ok(services.length >= 3, `expected >=3 services, found ${services.length}`);
  for (const s of services) {
    const pkg = readJson(`${s}/package.json`);
    assert.equal(pkg.private, true, `${s} must set "private": true (services ship as containers, not npm packages)`);
    assert.equal(pkg.publishConfig, undefined, `${s} must not carry publishConfig`);
    if (pkg.repository?.directory) {
      assert.equal(pkg.repository.directory, s, `${s} repository.directory is stale`);
    }
  }
});

test("no package depends on a service (npm units must not depend on container units)", () => {
  for (const p of packages) {
    const pkg = readJson(`${p}/package.json`);
    const allowed = BOUNDARY_DEBT_ALLOWLIST[pkg.name] ?? new Set();
    for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const dep of Object.keys(pkg[depField] ?? {})) {
        if (serviceNames.has(dep) && !allowed.has(dep)) {
          assert.fail(
            `${p} (${depField}) depends on service "${dep}". ` +
              `Packages publish to npm; services don't exist there. ` +
              `Extract the shared code into a library under packages/ instead.`
          );
        }
      }
    }
  }
});

test("containerized services keep their Dockerfile beside the code, self-consistent", () => {
  // waypoint is intentionally exempt until its containerization is designed
  // (stdio MCP multiplexer — downstream-in-image story is an open question).
  for (const s of ["services/ta-server", "services/tmi-server"]) {
    const df = join(repoRoot, s, "Dockerfile");
    assert.ok(existsSync(df), `${s}/Dockerfile missing`);
    const body = readFileSync(df, "utf8");
    const stale = body.match(new RegExp(`packages/${s.split("/")[1]}`, "g"));
    assert.equal(stale, null, `${s}/Dockerfile still references packages/${s.split("/")[1]}`);
  }
});

test("every tracked Dockerfile sits within SSC hadolint reach (find -maxdepth 3)", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((f) => /(^|\/)Dockerfile[^/]*$/.test(f));
  assert.ok(tracked.length >= 2, `expected >=2 tracked Dockerfiles, found: ${tracked}`);
  const scanner = readFileSync(join(repoRoot, "SSC/scripts/scan-all.sh"), "utf8");
  const m = scanner.match(/-maxdepth (\d+)[^\n]*-name 'Dockerfile\*'/);
  assert.ok(m, "scan-all.sh no longer finds Dockerfiles with a -maxdepth find — update this test");
  const maxdepth = Number(m[1]);
  for (const f of tracked) {
    const depth = f.split("/").length;
    assert.ok(
      depth <= maxdepth,
      `${f} is at depth ${depth}, beyond scan-all.sh -maxdepth ${maxdepth}: hadolint would silently skip it`
    );
  }
});

test("no private key material is tracked by git", () => {
  // Lab keys are generated into services/*/keys by up.sh. The .gitignore rules
  // are path-anchored — a directory move can silently un-ignore them (this
  // exact miss happened when packages/*/keys became services/*/keys).
  const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" }).split("\n");
  const leaked = tracked.filter((f) =>
    /(^|\/)keys\/\.pass$|\.priv\.(jwe|jwk)$|(^|\/)keys\/.*\.(jwk|jwe)$/.test(f)
  );
  assert.deepEqual(leaked, [], `key material tracked by git: ${leaked.join(", ")}`);
});

test("lab compose build contexts and mounts resolve to real files", () => {
  const composePath = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .find((f) => /lab\/docker-compose\.yml$/.test(f));
  assert.ok(composePath, "lab docker-compose.yml not found in the repo");
  const composeDir = join(repoRoot, dirname(composePath));
  const body = readFileSync(join(repoRoot, composePath), "utf8");

  // Every `dockerfile:` must exist relative to its build context (context is
  // declared just above in this file; all lab builds use the repo root ../..).
  for (const [, df] of body.matchAll(/dockerfile:\s*(\S+)/g)) {
    assert.ok(existsSync(join(repoRoot, df)), `compose dockerfile does not exist at repo root: ${df}`);
  }
  // Every relative bind/source path must exist (keys dirs, configs, …).
  for (const [, src] of body.matchAll(/source:\s*(\.\.?\/\S+)/g)) {
    const target = resolve(composeDir, src);
    // key *files* are generated by up.sh — require their parent dir instead
    const mustExist = /\.(jwk|jwe)$/.test(src) ? dirname(target) : target;
    assert.ok(existsSync(mustExist), `compose mount path does not resolve: ${src} (from ${composePath})`);
  }
});
