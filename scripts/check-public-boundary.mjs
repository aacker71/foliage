#!/usr/bin/env node
/**
 * Licensing-boundary gate.
 *
 * The business model is open core, and the boundary runs between LEAF and CANOPY: the compound
 * leaf — one person's portfolio and its leaflets — is open source, while revenue comes from
 * gathering many leaves into a hosted canopy (`cloud`) and from the Enterprise plane
 * (`enterprise`). Two commitments follow, and both are enforced here at build time rather than
 * asserted in a document:
 *
 *   1. The OPEN set must stand alone. A fork holding only the open packages has to be a
 *      working product. The moment an open package needs a proprietary one, the published
 *      repository is a shell and "open source" becomes marketing.
 *   2. "No server holds both sides" — the public plane must not be able to reach the
 *      enterprise plane, which holds internal portfolios and company release policy.
 *
 * Dependencies in the other direction are fine and expected: `cloud` and `enterprise` build
 * ON TOP OF `open`. That asymmetry is open core working as intended.
 *
 * The check is deliberately boring and static: it reads the declared planes from
 * public-boundary.json, then for every package in `open` it inspects
 *   (a) its package.json dependency sets, and
 *   (b) every import/require/export-from specifier in its source,
 * and fails if any of them names a workspace package outside `open`.
 *
 * Static analysis is the right tool here: the property we want is "cannot reach", which
 * is a reachability question over the import graph, and a transitive closure over
 * declared edges answers it without running anything. It cannot see a runtime `fetch`
 * to a private URL — that is a separate concern and belongs to an egress test, not here.
 *
 * Complexity: O(files + edges). Runs in well under a second on a repo this size, which
 * matters because a gate that is slow gets skipped.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIR = new Set(["node_modules", "dist", "build", ".next", ".vercel", "coverage", ".git", ".turbo"]);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** Recursively collect source files, skipping build output and vendor trees. */
function sourceFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) sourceFiles(join(dir, e.name), acc);
    } else if (SRC_EXT.has(e.name.slice(e.name.lastIndexOf(".")))) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

/**
 * Extract module specifiers. Covers static import, export-from, bare `import "x"`,
 * dynamic import(), and require(). A specifier hidden behind a computed expression is
 * NOT detectable here — see the note in the header about what this gate does not cover.
 */
const SPECIFIER_PATTERNS = [
  /\bimport\s+[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
  /\bexport\s+[^;'"]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function specifiersIn(file) {
  const text = readFileSync(file, "utf8");
  const found = new Set();
  for (const re of SPECIFIER_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  }
  return found;
}

/** Discover workspace packages from pnpm-workspace.yaml's glob roots. */
function workspacePackages() {
  const pkgs = new Map(); // name -> { dir, json }
  for (const root of ["apps", "packages"]) {
    const base = join(ROOT, root);
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(base, e.name);
      const manifest = join(dir, "package.json");
      try {
        statSync(manifest);
      } catch {
        continue;
      }
      const json = JSON.parse(readFileSync(manifest, "utf8"));
      if (json.name) pkgs.set(json.name, { dir, json });
    }
  }
  return pkgs;
}

const boundary = JSON.parse(readFileSync(join(ROOT, "public-boundary.json"), "utf8"));
const planes = boundary.planes ?? {};
if (!Array.isArray(planes.open)) {
  console.error(red("✗ public-boundary.json must declare planes.open as an array"));
  process.exit(1);
}

/** The open-source set. Nothing here may reach outside itself. */
const publicSet = new Set(planes.open);
/** Every closed plane, flattened — which plane a package sits in matters for the message. */
const planeOf = new Map();
for (const [plane, names] of Object.entries(planes)) {
  for (const n of names ?? []) planeOf.set(n, plane);
}
const closedSet = new Set([...planeOf.keys()].filter((n) => !publicSet.has(n)));
const pkgs = workspacePackages();

const violations = [];
const undeclared = [];

for (const [name, { dir, json }] of pkgs) {
  if (!planeOf.has(name)) {
    undeclared.push(name);
    continue;
  }
  // cloud and enterprise may depend on open — that direction is open core working as
  // intended. Only the open set is constrained.
  if (!publicSet.has(name)) continue;

  // (a) declared dependencies
  const deps = {
    ...(json.dependencies ?? {}),
    ...(json.peerDependencies ?? {}),
    ...(json.optionalDependencies ?? {}),
    ...(json.devDependencies ?? {}),
  };
  for (const dep of Object.keys(deps)) {
    if (pkgs.has(dep) && !publicSet.has(dep)) {
      violations.push({
        from: name,
        to: dep,
        toPlane: planeOf.get(dep) ?? "undeclared",
        where: "package.json dependency",
      });
    }
  }

  // (b) source imports
  for (const file of sourceFiles(dir)) {
    for (const spec of specifiersIn(file)) {
      // Match the package name, or a subpath export of it.
      for (const other of pkgs.keys()) {
        if (spec !== other && !spec.startsWith(other + "/")) continue;
        if (!publicSet.has(other)) {
          violations.push({
            from: name,
            to: other,
            toPlane: planeOf.get(other) ?? "undeclared",
            where: `${relative(ROOT, file).split(sep).join("/")} → import "${spec}"`,
          });
        }
      }
    }
  }
}

let failed = false;

if (undeclared.length) {
  failed = true;
  console.error(red("\n✗ Packages missing from public-boundary.json:"));
  for (const n of undeclared) console.error(`    ${n}`);
  console.error(
    dim(
      "\n  Every workspace package must be declared in exactly one plane (open, cloud, or\n" +
        "  enterprise). Defaulting silently is how a licensing boundary rots.",
    ),
  );
}

if (violations.length) {
  failed = true;
  console.error(red("\n✗ open → closed boundary violations:"));
  for (const v of violations) {
    console.error(`    ${v.from}  ──▶  ${v.to}  ${dim(`(${v.toPlane})`)}`);
    console.error(dim(`      at ${v.where}`));
  }
  console.error(
    dim(
      "\n  The open set must build and run on its own — otherwise the published repository is a\n" +
        "  shell and the open-source claim is marketing. cloud and enterprise may depend on open;\n" +
        "  never the other way round.",
    ),
  );
}

if (failed) process.exit(1);

console.log(green("✓ licensing boundary intact"));
for (const plane of ["open", "cloud", "enterprise"]) {
  const names = (planes[plane] ?? []).join(", ") || "(none)";
  console.log(dim(`  ${plane.padEnd(10)} ${names}`));
}
console.log(dim(`  ${pkgs.size} workspace package(s) checked, ${closedSet.size} closed`));
