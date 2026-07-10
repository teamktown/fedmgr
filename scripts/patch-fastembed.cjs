#!/usr/bin/env node
// tar 6 -> 7 compatibility for fastembed.
//
// Root `overrides` pin tar to >= 7.5.11 (tar 6 has six HIGH CVEs with no 6.x
// backport). fastembed 2.1.0 still targets tar 6 and breaks on 7 in two ways:
//   - lib/cjs: __importDefault(require("tar")).default is undefined (tar 7's
//     CJS build is ESM-flavored: __esModule + named exports, no default)
//   - lib/esm: `import tar from "tar"` — tar 7's ESM has no default export,
//     so the module fails at import time
// Rewrite both loaders to shapes that work on tar 6 and 7. Idempotent; no-op
// when fastembed isn't installed. Runs from root postinstall — Docker builds
// use `npm ci --ignore-scripts`, so service Dockerfiles that ship fedvec must
// invoke this explicitly after npm ci. Drop when fastembed ships with tar 7.
const fs = require("fs");
const path = require("path");

const edits = [
  {
    file: "node_modules/fastembed/lib/cjs/fastembed.js",
    from: "tar_1.default.x(",
    to: "(tar_1.default ?? tar_1).x(",
  },
  {
    file: "node_modules/fastembed/lib/esm/fastembed.js",
    from: 'import tar from "tar";',
    to: 'import * as tar from "tar";',
  },
];

for (const e of edits) {
  const p = path.resolve(__dirname, "..", e.file);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, "utf8");
  if (src.includes(e.to)) continue; // already patched
  if (!src.includes(e.from)) {
    console.error(
      `patch-fastembed: expected pattern missing in ${e.file} — fastembed layout changed; re-assess the tar 7 compatibility fix`
    );
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(p, src.replace(e.from, e.to));
  console.log(`patch-fastembed: patched ${e.file}`);
}
