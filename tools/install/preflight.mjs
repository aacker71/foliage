#!/usr/bin/env node
/**
 * PREFLIGHT — ask this machine what it actually is, then let `requirements.mjs` judge it.
 *
 *   node tools/install/preflight.mjs        # exit 0 if this machine can run Foliage
 *
 * Deliberately PURE JAVASCRIPT with no `.ts` in its import graph, because the thing it most
 * needs to diagnose is a Node that cannot load `.ts` at all. A preflight that crashes on the
 * failure it exists to explain is not a preflight — and that is exactly what happens today
 * in `apps/leaf/server.mjs`, which imports `./src/preflight.ts` statically and therefore
 * dies before its own explanation can run.
 *
 * It runs `node --version` on ITSELF (this process is the Node that will run everything) and
 * spawns `pnpm --version` and `bun --version` once each. No network, no writes, no state.
 */

import { spawnSync } from "node:child_process";

import { findAside, inspectAside } from './aside.mjs';

import { checkBun, checkNode, checkPnpm } from "./requirements.mjs";

/** @param {string} s */
const red = (s) => `\x1b[31m${s}\x1b[0m`;
/** @param {string} s */
const green = (s) => `\x1b[32m${s}\x1b[0m`;
/** @param {string} s */
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/**
 * What pnpm (or bun) this shell would use, or null. `spawnSync` rather than `which`, because the
 * question is not "is there a file called pnpm" but "does running pnpm produce a version".
 * A shim that exists and fails is a missing pnpm as far as the install is concerned.
 *
 * @param {string} tool
 * @returns {string | null}
 */
function toolVersion(tool) {
  try {
    const r = spawnSync(tool, ["--version"], { encoding: "utf8", timeout: 30_000 });
    if (r.status !== 0 || typeof r.stdout !== "string") return null;
    const line = r.stdout.trim();
    return line === "" ? null : line;
  } catch {
    return null;
  }
}

/** @param {string} label @param {import("./requirements.mjs").Requirement} r */
function report(label, r) {
  if (r.ok) {
    console.log(green(`✓ ${label} ${r.version}`));
    return true;
  }
  console.error(red(`\n✗ ${label} — ${r.reason}`));
  console.error("");
  console.error(r.message);
  console.error("");
  return false;
}

// process.features.typescript is the capability itself, reported by the runtime that would
// have to do the work. Reading the version and inferring it would be a proxy for this.
const node = checkNode({
  version: process.version,
  typescript: process.features.typescript,
});

let allGood = report("node", node);

// pnpm is asked about even when Node already failed, so a machine missing both learns both
// in one run rather than one per attempt. Two round trips to fix two problems is a bad
// install experience and an entirely avoidable one.
const pnpm = checkPnpm({ version: toolVersion("pnpm") });
allGood = report("pnpm", pnpm) && allGood;

// bun builds this checkout's browser bundles and stages the local brain; asked like pnpm.
allGood = report("bun", checkBun({ version: toolVersion("bun") })) && allGood;

if (!allGood) {
  console.error(
    dim("Nothing was installed and nothing on this machine was changed. Fix the above and re-run."),
  );
  process.exit(1);
}

console.log(dim("  Node runs the TypeScript sources directly — no build step, no dist/."));
console.log(dim("  pnpm is needed once, to link the workspace packages. It is not a runtime dependency."));
console.log(dim("  bun builds this checkout's browser bundles and stages the local brain. The packaged release does not need it."));

// Aside is required for browser learning capture, not for offline Git capture.
const aside=await findAside();
console.log(dim(aside?`  Aside CLI: ${inspectAside(aside).detail}; browser connection unverified.`:'  Aside: not installed. Browser learning capture unavailable; repository capture remains usable.'));
