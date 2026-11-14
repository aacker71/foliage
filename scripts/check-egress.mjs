#!/usr/bin/env node
/**
 * THE EGRESS GATE — which hosts a plane's code may name.
 *
 * WHY THIS EXISTS, and it is a decision that was about to be made by merge order. Two branches
 * diverged; a merge analysis found five product decisions hidden inside thirteen file conflicts,
 * and D4 was "is `@foliage/cos` open-plane?". `public-boundary.json` merges with ZERO conflicts
 * and puts `@foliage/cos-app` in `open` — while `apps/cos/src/fireworks.ts` names
 * `https://api.fireworks.ai`, and the manifest's own text says of the paid `cloud` plane that
 * crossing it "does NOT license third-party calls". If cloud does not license them, open does not.
 *
 * `check-public-boundary.mjs` passes over it, correctly and by its own admission — its header
 * says "It cannot see a runtime `fetch` to a private URL — that is a separate concern and belongs
 * to an egress test, not here." That test did not exist. So the gate enforced IMPORT TOPOLOGY
 * while the principle it was written to protect is EGRESS, and the two had drifted apart with
 * nothing to notice. This is that test.
 *
 * WHAT IT CHECKS: every literal `http(s)://host` in a plane's sources must be DECLARED in
 * `public-boundary.json`'s `egress` block, with a reason a person wrote. An undeclared host fails.
 *
 * WHAT IT CANNOT CHECK, stated here rather than discovered later: a host assembled at runtime
 * (`"https://" + env.HOST`), a host arriving from configuration, or what a declared host does with
 * the bytes once it has them. This raises the cost of adding an egress from "type a URL" to "type
 * a URL and defend it in a manifest a reviewer reads" — that is the whole of what it buys, and it
 * is worth saying plainly because a gate oversold is worse than no gate.
 *
 *   node scripts/check-egress.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BOLD = "[1m";
const DIM = "[2m";
const RED = "[31m";
const GREEN = "[32m";
const OFF = "[0m";

/**
 * Hosts that CANNOT reach a third party, so naming one is not egress.
 *
 * `.example`, `.invalid`, `.test` and `.localhost` are reserved by RFC 2606 and RFC 6761 and are
 * guaranteed never to resolve to a real service — which is exactly why the refusal tests in this
 * tree use them. Loopback is the machine itself. `0.0.0.0` and the integer/hex spellings of
 * 127.0.0.1 appear in this repo's own loopback-parser tests, whose entire purpose is proving those
 * spellings are REFUSED; a gate that failed on them would forbid testing the guard.
 */
const UNREACHABLE = [
  /^(?:.*\.)?example$/,
  /^(?:.*\.)?invalid$/,
  /^(?:.*\.)?test$/,
  /^(?:.*\.)?localhost$/,
  /^(?:.*\.)?example\.(?:com|org|net)$/,
  /^127\./,
  /^0x7f\./,
  /^127$/,
  /^2130706433$/,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^192\.168\./,
  /^10\./,
  /^HOST$/,
  /^www\.w3\.org$/,
];

const unreachable = (host) => UNREACHABLE.some((re) => re.test(host));

function sourceFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    /*
     * BUILD OUTPUT IS NOT SOURCE. This gate exists so a reader can check which hosts a plane's own
     * CODE names; a bundler's output names every host mentioned in a comment inside every
     * dependency it inlined. Scanning `apps/www/.next` reported 15 "undeclared hosts" — nextjs.org,
     * ns.adobe.com, bugzilla.mozilla.org — none of which anybody here wrote or calls.
     *
     * `.next` is Next.js's `dist`: generated, gitignored, and rebuilt from the source this function
     * DOES read (app/, components/, lib/). Skipping it narrows nothing a reader could check —
     * declaring those hosts instead would have been the real harm, filling the egress block with
     * noise until a genuine entry could not be seen.
     */
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".next" || name === ".vercel") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    /*
     * `.tsx` AND `.jsx` TOO. This filter predates any React in the repo, and the moment a `.tsx`
     * app existed the gate went blind to it: MEASURED by planting
     * `https://tracker.example-analytics.com/collect` in `apps/www/app/page.tsx`, after which this
     * check reported "no undeclared host is named in any plane". Every page and every component of
     * the cloud plane's marketing surface was outside the privacy claim this file exists to make
     * checkable — which is worse than a missing declaration, because it looks like a pass.
     */
    else if (/\.(?:ts|tsx|mjs|js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

const boundary = JSON.parse(readFileSync(join(ROOT, "public-boundary.json"), "utf8"));
const declared = boundary.egress ?? {};

/** Map every workspace package name to its directory, so a plane can be walked. */
const dirs = new Map();
for (const group of ["apps", "packages"]) {
  for (const name of readdirSync(join(ROOT, group))) {
    const manifest = join(ROOT, group, name, "package.json");
    try {
      dirs.set(JSON.parse(readFileSync(manifest, "utf8")).name, join(ROOT, group, name));
    } catch {
      /* a directory with no manifest is not a workspace package */
    }
  }
}

const findings = [];
let scanned = 0;

for (const [plane, packages] of Object.entries(boundary.planes)) {
  const allowed = new Set(Object.keys(declared[plane] ?? {}));
  for (const pkg of packages) {
    const dir = dirs.get(pkg);
    if (dir === undefined) continue;
    for (const file of sourceFiles(dir)) {
      scanned++;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\bhttps?:\/\/([a-zA-Z0-9._-]+)/g)) {
        const host = m[1];
        if (unreachable(host) || allowed.has(host)) continue;
        findings.push({
          plane,
          pkg,
          host,
          where: `${relative(ROOT, file).split(sep).join("/")}`,
        });
      }
    }
  }
}

console.log(`${BOLD}egress gate${OFF}  ${DIM}${scanned} source file(s) across ${Object.keys(boundary.planes).length} planes${OFF}\n`);

for (const [plane, hosts] of Object.entries(declared)) {
  for (const [host, reason] of Object.entries(hosts)) {
    console.log(`  ${DIM}${plane}${OFF}  ${host}\n      ${DIM}${reason}${OFF}`);
  }
}

if (findings.length === 0) {
  console.log(`\n${GREEN}✓ no undeclared host is named in any plane${OFF}`);
  process.exit(0);
}

console.log();
const seen = new Set();
for (const f of findings) {
  const key = `${f.plane}:${f.host}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`${RED}✗ ${f.plane} plane names an undeclared host: ${f.host}${OFF}`);
  console.log(`    ${DIM}${f.pkg} — ${f.where}${OFF}`);
}
console.log(
  `\n${RED}${seen.size} undeclared host(s).${OFF} Declare it in public-boundary.json's \`egress\` ` +
    `block WITH a reason, or stop naming it. A plane that reaches a third party nobody declared is ` +
    `the open-source claim and the privacy claim both resting on something no reader can check.`,
);
process.exit(1);
