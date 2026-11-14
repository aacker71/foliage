/**
 * The installer's version logic, pinned.
 *
 * These tests exist because the interesting cases are the ones nobody has the runtime for:
 * the machine that is on 22.17.1 (satisfies `engines.node`, still crashes), and the machine
 * on 25 (runs the servers, refuses the harvest command). Both are unreachable from a test
 * process running a single Node, and both are pure functions of two strings — so they are
 * checked here as data.
 *
 * NOTHING HERE TOUCHES THE NETWORK OR SPAWNS A PROCESS. `preflight.mjs` owns the spawning;
 * this file owns the decision, which is the part that can be wrong in a way a user pays for.
 */

import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  BUN_FLOOR,
  NODE_REFUSED_MAJOR,
  NODE_TYPE_STRIPPING_FLOOR,
  PNPM_FLOOR_MAJOR,
  checkBun,
  checkNode,
  checkPnpm,
  parseVersion,
} from "./requirements.mjs";

test("parseVersion reads both the v-prefixed and bare forms", () => {
  deepStrictEqual(parseVersion("v22.18.0"), { major: 22, minor: 18, patch: 0 });
  deepStrictEqual(parseVersion("11.4.0"), { major: 11, minor: 4, patch: 0 });
  deepStrictEqual(parseVersion("  v24.18.0  "), { major: 24, minor: 18, patch: 0 });
});

test("parseVersion refuses to guess at anything that is not three numbers", () => {
  strictEqual(parseVersion("not a version"), null);
  strictEqual(parseVersion("22"), null);
  strictEqual(parseVersion("22.18"), null);
  strictEqual(parseVersion(undefined), null);
  strictEqual(parseVersion(null), null);
});

test("a Node that reports type stripping is accepted", () => {
  const r = checkNode({ version: "v22.18.0", typescript: "strip" });
  strictEqual(r.ok, true);
  strictEqual(r.version, "v22.18.0");
});

test("Node 24 with type stripping is accepted — the floor is a floor, not a pin", () => {
  strictEqual(checkNode({ version: "v24.18.0", typescript: "strip" }).ok, true);
});

test("a Node reporting 'transform' is accepted — it can also load .ts", () => {
  strictEqual(checkNode({ version: "v23.6.0", typescript: "transform" }).ok, true);
});

test("THE CASE package.json's engines field misses: 22.17.1 passes >=22 <25 and still cannot run", () => {
  const r = checkNode({ version: "v22.17.1", typescript: false });
  strictEqual(r.ok, false);
  strictEqual(r.reason, "no-type-stripping");
  strictEqual(r.found, "v22.17.1");
  // The message must name the real floor and the exact error the user would otherwise see,
  // because that stack trace is the thing they will paste into a search box.
  match(r.message, new RegExp(NODE_TYPE_STRIPPING_FLOOR.replace(/\./g, "\\.")));
  match(r.message, /ERR_UNKNOWN_FILE_EXTENSION/);
  match(r.message, /nvm install 22/);
});

test("the capability probe, not the version number, is what decides", () => {
  // A hypothetical 22.30 with the feature switched off is still refused: the requirement is
  // the capability. Deciding on the number instead would let this pass and then crash.
  const r = checkNode({ version: "v22.30.0", typescript: false });
  strictEqual(r.ok, false);
  strictEqual(r.reason, "no-type-stripping");
});

test("Node 20 is refused with the same actionable message", () => {
  const r = checkNode({ version: "v20.16.0", typescript: undefined });
  strictEqual(r.ok, false);
  strictEqual(r.reason, "no-type-stripping");
});

test(`Node ${NODE_REFUSED_MAJOR} is refused even though the servers boot on it`, () => {
  const r = checkNode({ version: "v25.9.0", typescript: "strip" });
  strictEqual(r.ok, false);
  strictEqual(r.reason, "too-new");
  // The refusal has to say WHY, because "too new" is otherwise indistinguishable from
  // conservatism, and the reason here is a real half-broken install.
  match(r.message, /photosynthesis\.mjs/);
  match(r.message, /exits 2/);
});

test("a missing Node is a distinct reason from an unusable one", () => {
  const r = checkNode({ version: null, typescript: undefined });
  strictEqual(r.ok, false);
  strictEqual(r.reason, "absent");
  strictEqual(r.found, null);
  match(r.message, /not on this shell's PATH/);
});

test("an unreadable Node version is reported as unreadable, never assumed good", () => {
  const r = checkNode({ version: "some-vendor-build", typescript: "strip" });
  strictEqual(r.ok, false);
  strictEqual(r.reason, "unreadable");
});

test(`pnpm ${PNPM_FLOOR_MAJOR} and above is accepted`, () => {
  strictEqual(checkPnpm({ version: "11.4.0" }).ok, true);
  strictEqual(checkPnpm({ version: "12.0.1" }).ok, true);
});

test("pnpm 10 is refused, and the message names what protection would be lost", () => {
  const r = checkPnpm({ version: "10.11.0" });
  strictEqual(r.ok, false);
  strictEqual(r.reason, "too-old");
  match(r.message, /minimumReleaseAge/);
  match(r.message, /corepack enable/);
});

test("a missing pnpm names the cheapest route first", () => {
  const r = checkPnpm({ version: null });
  strictEqual(r.ok, false);
  strictEqual(r.reason, "absent");
  const corepackAt = r.message.indexOf("corepack enable");
  const npmAt = r.message.indexOf("npm install -g pnpm");
  ok(corepackAt > -1 && npmAt > corepackAt, "corepack should be offered before a global npm install");
});

test("every refusal carries an instruction, not just a complaint", () => {
  const refusals = [
    checkNode({ version: null, typescript: undefined }),
    checkNode({ version: "v20.16.0", typescript: undefined }),
    checkNode({ version: "v25.9.0", typescript: "strip" }),
    checkNode({ version: "weird", typescript: "strip" }),
    checkPnpm({ version: null }),
    checkPnpm({ version: "9.0.0" }),
    checkPnpm({ version: "weird" }),
  ];
  for (const r of refusals) {
    strictEqual(r.ok, false);
    ok(r.message.length > 80, `message too thin to act on: ${r.message}`);
    ok(
      /nvm|fnm|brew|nodejs\.org|corepack|npm install/.test(r.message),
      `no remedy named in: ${r.message}`,
    );
  }
});

test(`bun ${BUN_FLOOR} and above is accepted for a checkout, including the CI pin`, () => {
  strictEqual(checkBun({ version: "1.3.10" }).ok, true);
  strictEqual(checkBun({ version: "1.3.14" }).ok, true);
  strictEqual(checkBun({ version: "1.4.0" }).ok, true);
  strictEqual(checkBun({ version: "2.0.0" }).ok, true);
});

test("bun below the floor, missing or unreadable is refused with the fix and the reason it is needed", () => {
  for (const [version, reason] of /** @type {const} */ ([["1.3.9", "too-old"], ["1.2.20", "too-old"], ["0.9.9", "too-old"], [null, "absent"], ["canary", "unreadable"]])) {
    const r = checkBun({ version });
    strictEqual(r.ok, false);
    if (r.ok) continue;
    strictEqual(r.reason, reason);
    match(r.message, /brew install oven-sh\/bun\/bun/);
    match(r.message, new RegExp(BUN_FLOOR.replace(/\./g, "\\.")));
  }
  match(/** @type {{ message: string }} */ (checkBun({ version: null })).message, /stage the\nlocal brain/);
});
