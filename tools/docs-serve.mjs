#!/usr/bin/env node
// docs-serve — zero-config local preview server for the docs/ tree.
// Renders Markdown as HTML, lists directories (inlining any README), and
// serves static assets. Nothing else: no writes, no outbound requests, and
// it binds to loopback unless you explicitly opt in to a LAN address.
//
//   npm run docs               → http://127.0.0.1:8092/
//   npm run docs -- 9000       → custom port
//   DOCS_HOST=0.0.0.0 npm run docs   → LAN exposure (deliberate opt-in)
//
// Dependency posture: the only import is `marked` (Markdown renderer),
// declared as an exact-pinned root devDependency with zero dependencies of
// its own — same SSC gate as the rest of the workspace.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(repoRoot, "docs");
const port = Number(process.argv[2] ?? process.env.DOCS_PORT ?? 8092);
const host = process.env.DOCS_HOST ?? "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
};

const PAGE = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 60rem; margin: 2rem auto; padding: 0 1.5rem 4rem;
         font: 16px/1.6 system-ui, sans-serif; }
  pre { padding: 1rem; overflow-x: auto; border-radius: 6px;
        background: rgba(127,127,127,.12); }
  code { font-family: ui-monospace, monospace; font-size: .9em; }
  :not(pre) > code { background: rgba(127,127,127,.15); padding: .1em .35em; border-radius: 4px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid rgba(127,127,127,.4); padding: .35em .7em; }
  a { color: #2a7ae2; } a:visited { color: #8a63d2; }
  nav.crumbs { font-size: .85em; margin-bottom: 1.5rem; opacity: .8; }
  ul.listing { list-style: none; padding: 0; }
  ul.listing li { padding: .15em 0; }
</style></head><body>${body}</body></html>`;

const crumbs = (rel) => {
  const parts = rel.split("/").filter(Boolean);
  let acc = "";
  const links = ['<a href="/">docs</a>'];
  for (const p of parts) { acc += "/" + p; links.push(`<a href="${acc}/">${p}</a>`); }
  return `<nav class="crumbs">${links.join(" / ")}</nav>`;
};

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400).end("bad request"); return; }
  const file = path.normalize(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end("forbidden"); return; }

  let stat;
  try { stat = fs.statSync(file); } catch { res.writeHead(404).end("not found"); return; }

  if (stat.isDirectory()) {
    const entries = fs.readdirSync(file, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    const items = entries.map((e) => {
      const href = path.posix.join(rel, e.name) + (e.isDirectory() ? "/" : "");
      return `<li>${e.isDirectory() ? "📁" : "📄"} <a href="${href}">${e.name}</a></li>`;
    }).join("\n");
    const readme = entries.find((e) => e.name.toLowerCase() === "readme.md");
    let intro = "";
    if (readme) intro = "<hr>" + marked.parse(fs.readFileSync(path.join(file, readme.name), "utf8"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE("docs" + rel, `${crumbs(rel)}<h1>docs${rel}</h1><ul class="listing">${items}</ul>${intro}`));
    return;
  }

  if (file.endsWith(".md")) {
    const html = marked.parse(fs.readFileSync(file, "utf8"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE(path.basename(file), crumbs(path.posix.dirname(rel)) + html));
    return;
  }

  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
}).listen(port, host, () => console.log(`[docs] serving ${root} at http://${host}:${port}/`));
