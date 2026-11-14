/**
 * F-011 — the Node floor at the two entry points that still admitted a Node the installer refuses.
 *
 * THE DEFECT, in two halves. `apps/enterprise/server.mjs` gated on `major < 22 || major >= 25`,
 * which PASSES on 22.17.1 — and unflagged type stripping only begins at 22.18.0
 * (`apps/leaf/src/nodeFloor.mjs`, `NODE_FLOOR`), so the whole 22.6–22.17 band was admitted by the
 * very check meant to refuse it. The second half is what made it a refactor rather than an
 * arithmetic fix: that file imported `./src/companyDocument.ts`, `./src/renderCompany.ts` and
 * `./src/releaseStore.ts` with STATIC imports, which HOIST and LINK before any of the module's own
 * code runs. Below the floor the process died during linking with a raw ERR_UNKNOWN_FILE_EXTENSION
 * before line 20's guard was ever evaluated — the guard was unreachable on exactly the versions it
 * existed to catch. Correcting the comparison alone would have changed nothing.
 *
 * HOW THIS IS PROVEN, and it is not by reading source. A real sub-floor Node binary cannot be
 * assumed on the machine running this suite, so the earlier floor tests (canopy's,
 * photosynthesis's) assert the WIRING textually. That catches a reverted import but not a
 * reachability regression. Here each entry point is actually SPAWNED with `process.versions.node`
 * stubbed to a sub-floor version by an `--import` preload — the one field the guard reads — and
 * required to exit 2 carrying the floor's own sentence. Measured 2026-08-28 against the
 * pre-fix file: it BOOTED and served under a stubbed 22.17.1, and this assertion caught it with
 * "did not exit under a sub-floor Node".
 *
 * WHAT THE STUB DOES NOT PROVE, said plainly: it changes what the guard READS, not what the
 * runtime can DO. Type stripping still works in the child, so this proves the REFUSAL, not the
 * crash the refusal stands in front of. That crash is documented in nodeFloor.mjs and is not
 * something a test on a floor-clearing machine can stage.
 *
 * The source assertions are kept as well, and they are not redundant: they name the exact dead
 * expression, so a reviewer reading a failure is told which trap reopened.
 *
 * Every declaration here is top-level and unindented on purpose — tools/ledger/parse.test.mjs
 * refuses to derive a suite total when any of them is generated in a loop, and a refused total
 * is a deleted check.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);

const ENTERPRISE = "apps/enterprise/server.mjs";
const PHOTOSYNTHESIS = "apps/photosynthesis/photosynthesis.mjs";
const PATHS: Record<string, string> = {
  [ENTERPRISE]: fileURLToPath(new URL("../server.mjs", import.meta.url)),
  [PHOTOSYNTHESIS]: fileURLToPath(new URL("../../photosynthesis/photosynthesis.mjs", import.meta.url)),
};

/** The band where `pnpm check` is green and the product then crashes raw, plus one below it. */
const SUB_FLOOR = ["22.17.1", "22.6.0", "22.17.9", "20.11.0"];

/**
 * A preload that reports a sub-floor version and nothing else. `process.versions` is a plain
 * configurable property, so redefining it is enough; a data: URL avoids leaving a fixture on disk
 * that could drift away from the versions named here.
 */
function subFloorPreload(version: string): string {
  const src = `Object.defineProperty(process, "versions", { value: { ...process.versions, node: ${JSON.stringify(version)} }, configurable: true });`;
  return `data:text/javascript,${encodeURIComponent(src)}`;
}

/**
 * Run an entry point under a stubbed version and report what the process DID. A reverted guard
 * leaves a server listening forever, so the timeout is load-bearing: this must FAIL, never hang.
 */
async function runAtVersion(
  name: string,
  version: string,
): Promise<{ code: number | null; killed: boolean; stderr: string; stdout: string }> {
  const path = PATHS[name] ?? "";
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--import", subFloorPreload(version), path], {
      encoding: "utf8",
      timeout: 20_000,
    });
    return { code: 0, killed: false, stderr, stdout };
  } catch (err) {
    const e = err as { code?: number | string; killed?: boolean; stderr?: string; stdout?: string };
    return {
      code: typeof e.code === "number" ? e.code : null,
      killed: e.killed === true,
      stderr: e.stderr ?? "",
      stdout: e.stdout ?? "",
    };
  }
}

/** The shared body, so the two entry points cannot drift into being checked differently. */
async function assertRefusesSubFloor(name: string): Promise<void> {
  for (const version of SUB_FLOOR) {
    const run = await runAtVersion(name, version);
    assert.equal(
      run.killed,
      false,
      `${name} did not exit under a sub-floor Node ${version} — it kept running, which is exactly ` +
        `what a \`major < 22\` gate does on a 22.x below the floor. stdout:\n${run.stdout}`,
    );
    assert.equal(run.code, 2, `${name} on ${version}: expected the usage-class exit code 2; stderr:\n${run.stderr}`);
    // The SHARED guard's own sentence, so a second, looser local copy cannot satisfy this.
    assert.match(run.stderr, /Foliage needs Node 22\.18\.0\+/, `${name} on ${version}`);
    assert.match(run.stderr, new RegExp(`this is ${version.replace(/\./g, "\\.")}`), `${name} must name the version it refused`);
  }
}

function assertWiring(name: string): void {
  const source = readFileSync(PATHS[name] ?? "", "utf8");
  assert.match(
    source,
    /import\(["']\.\.\/leaf\/src\/nodeFloor\.mjs["']\)/,
    `${name} must reach apps/leaf/src/nodeFloor.mjs — the module apps/leaf/server.mjs, intake.mjs, ` +
      `harvest.mjs and apps/canopy/server.mjs already share — rather than a fourth copy of the check`,
  );
  const guardAt = source.indexOf("requireNodeFloor()");
  assert.ok(guardAt >= 0, `${name}: requireNodeFloor is imported but never CALLED`);
  const firstTsImportAt = source.search(/import\(["']\.\/src\/[^"']+\.ts["']\)/);
  assert.ok(firstTsImportAt >= 0, `${name}: no dynamic .ts import found to order the guard against`);
  assert.ok(guardAt < firstTsImportAt, `${name}: the guard must run before the first .ts module is imported`);
  assert.doesNotMatch(
    source,
    /^\s*import\s[^;]*from\s+["']\.\/src\/[^"']+\.ts["']/m,
    `${name}: a static .ts import is hoisted and linked before this file's own code runs, so no ` +
      `guard placed in it can ever be reached below the floor`,
  );
}

function assertNoLocalVersionCheck(name: string): void {
  const source = readFileSync(PATHS[name] ?? "", "utf8");
  // Anchored to lines that are not comment continuations: this file's own prose, and both entry
  // points' headers, quote the dead expression verbatim on purpose.
  assert.doesNotMatch(
    source,
    /^(?!\s*(?:\*|\/\/)).*process\.versions\.node\.split\(/m,
    `${name}: version parsing belongs to nodeFloor.mjs alone — a local copy is how ` +
      `\`major < 22 || major >= 25\` came back`,
  );
  assert.doesNotMatch(
    source,
    /^(?!\s*(?:\*|\/\/)).*major\s*<\s*22/m,
    `${name}: \`major < 22\` passes on 22.17.1, the exact version tools/install/requirements.mjs ` +
      `documents as fatal for type stripping`,
  );
}

test("apps/enterprise/server.mjs REFUSES every sub-floor Node, 22.17.1 included", async () => {
  await assertRefusesSubFloor(ENTERPRISE);
});

test("apps/photosynthesis/photosynthesis.mjs REFUSES every sub-floor Node, 22.17.1 included", async () => {
  await assertRefusesSubFloor(PHOTOSYNTHESIS);
});

test("apps/enterprise/server.mjs calls the shared guard before any .ts module can link", () => {
  assertWiring(ENTERPRISE);
});

test("apps/photosynthesis/photosynthesis.mjs calls the shared guard before any .ts module can link", () => {
  assertWiring(PHOTOSYNTHESIS);
});

test("apps/enterprise/server.mjs carries no hand-rolled major-only version check", () => {
  assertNoLocalVersionCheck(ENTERPRISE);
});

test("apps/photosynthesis/photosynthesis.mjs carries no hand-rolled major-only version check", () => {
  assertNoLocalVersionCheck(PHOTOSYNTHESIS);
});

test("the floor these entry points enforce is still the one the shared module publishes", () => {
  // Not a second definition — a check that the number asserted above is the number nodeFloor.mjs
  // exports. If NODE_FLOOR moves, this file must be re-read, not left passing against a stale
  // literal it no longer describes.
  const floorSource = readFileSync(fileURLToPath(new URL("../../leaf/src/nodeFloor.mjs", import.meta.url)), "utf8");
  assert.match(floorSource, /export const NODE_FLOOR = "22\.18\.0";/);
});

test("the above-floor path still works — the guard did not break normal startup", async () => {
  // photosynthesis.mjs with no arguments must reach its OWN usage validation on this machine's
  // real Node, proving execution passed the guard and every dynamic .ts import cleanly. The
  // enterprise server has no equivalent short-circuit (it listens), and is covered end to end by
  // apps/enterprise/src/shell.test.ts instead.
  const path = PATHS[PHOTOSYNTHESIS] ?? "";
  await assert.rejects(
    exec(process.execPath, [path], { encoding: "utf8", timeout: 20_000 }),
    (err: unknown) => {
      const e = err as { code?: number; stderr?: string };
      assert.equal(e.code, 2, `expected the usage-error exit code; stderr:\n${e.stderr}`);
      assert.match(e.stderr ?? "", /missing required argument\(s\)/);
      return true;
    },
  );
});
