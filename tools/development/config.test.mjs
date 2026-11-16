/** Development contracts, checked against the real workspace configuration. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { checkNode } from "../install/requirements.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
/** @param {string} path */
const read = (path) => readFileSync(join(root, path), "utf8");
const manifest = JSON.parse(read("package.json"));

/** @param {string} dir */
function config(dir) {
  const path = join(root, dir, "tsconfig.json");
  const loaded = ts.readConfigFile(path, ts.sys.readFile);
  assert.equal(loaded.error, undefined, `unreadable ${path}`);
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, join(root, dir));
  assert.deepEqual(parsed.errors, [], `invalid ${path}`);
  return parsed;
}

test("every workspace participates in strict, no-emit typechecking", () => {
  let count = 0;
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${parent}/${entry.name}`;
      if (!existsSync(join(root, dir, "package.json"))) continue;
      const pkg = JSON.parse(read(`${dir}/package.json`));
      assert.ok(pkg.scripts?.typecheck.split(" && ").includes("tsc --noEmit -p tsconfig.json"), `${dir} must not silently skip typechecking`);
      const parsed = config(dir);
      assert.equal(parsed.options.strict, true, dir);
      assert.equal(parsed.options.noEmit, true, dir);
      assert.ok(parsed.fileNames.length > 0, `${dir} typecheck cannot be empty`);
      count++;
    }
  }
  assert.ok(count > 0, "no workspace packages discovered");
});

test("every Leaf CLI and Node bootstrap is included in checkJs", () => {
  const parsed = config("apps/leaf");
  assert.equal(parsed.options.allowJs, true);
  assert.equal(parsed.options.checkJs, true);
  const included = new Set(parsed.fileNames.map(path => resolve(path)));
  for (const dir of ["apps/leaf", "apps/leaf/src"]) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".mjs")) {
        assert.ok(included.has(join(root, dir, entry.name)), `${dir}/${entry.name} is outside typechecking`);
      }
    }
  }
});

test("runtime pin is exact and within the supported installer range", () => {
  const pin = read(".nvmrc").trim();
  assert.match(pin, /^\d+\.\d+\.\d+$/);
  assert.equal(checkNode({ version: pin, typescript: "strip" }).ok, true);
  assert.match(manifest.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
  assert.match(read("pnpm-workspace.yaml"), /^engineStrict: true$/m);
});

test("the root typecheck includes strict tool-script checking", () => {
  assert.ok(manifest.scripts.typecheck.split(" && ").includes("pnpm run typecheck:tools"));
  assert.equal(manifest.scripts["typecheck:tools"], "tsc --noEmit -p tools/tsconfig.json");
  const parsed = config("tools");
  assert.equal(parsed.options.checkJs, true);
  assert.equal(parsed.options.strict, true);
  assert.equal(parsed.options.noEmit, true);
  const included = new Set(parsed.fileNames.map(path => resolve(path)));
  for (const file of ["install/preflight.mjs", "install/requirements.mjs", "verify/serve.mjs", "verify/serve-worker.ts", "verify/managed.ts", "verify/surfaces.mjs"]) {
    assert.ok(included.has(join(root, "tools", file)), `tools/${file} must be checked`);
  }
});

test("CI invokes the same full gate as local development", () => {
  const workflow = read(".github/workflows/ci.yml");
  const primaryJob = workflow.split("  check:")[1]?.split("  boundary-gate-is-real:")[0];
  const macJob = workflow.split("  check-macos:")[1];
  assert.ok(primaryJob, "primary CI job is missing");
  assert.ok(macJob, "the macOS CI job is missing");
  // `pnpm check` is check:portable then the brain offline gate, so a gate added to check:portable
  // runs on both CI machines. Linux runs check:portable; the Mac runs all of `pnpm check`.
  assert.equal(manifest.scripts.check, "pnpm run check:portable && pnpm run check:brain-offline");
  assert.equal(manifest.scripts["check:portable"], "pnpm run build:bundles && pnpm run check:static && pnpm run test");
  assert.match(primaryJob, /run: pnpm run check:portable\s/);
  assert.match(primaryJob, /pnpm install --frozen-lockfile/);
  assert.match(primaryJob, /node-version-file: \.nvmrc/);
  // The brain offline gate runs the staged gbrain (unit 38): part of the full gate, never of the
  // static subset (DEVELOPMENT.md), and the Mac stages the pinned gbrain before the full gate.
  assert.ok(!manifest.scripts["check:static"].includes("check:brain-offline"), "check:static must not run the brain offline gate");
  assert.equal(manifest.scripts["check:brain-offline"], "node scripts/check-brain-offline.mjs");
  assert.match(macJob, /run: [^\n]*node tools\/brain\/stage-gbrain\.mjs && pnpm check\s/, "the Mac must stage gbrain, then run the full gate");
  // The brain offline gate is a gate, not a signal: `check` waits for the Mac and fails unless it
  // passed, and the Mac job may not swallow its own failure.
  assert.match(primaryJob, /^ {4}needs: check-macos$/m, "check must wait for the Mac's brain offline gate");
  assert.match(primaryJob, /MAC_RESULT: \$\{\{ needs\.check-macos\.result \}\}/, "check must read the Mac's result");
  assert.match(primaryJob, /\[ "\$MAC_RESULT" = success \]/, "check must fail unless the Mac passed");
  assert.doesNotMatch(macJob, /continue-on-error/, "a failed brain offline gate must fail the run");
  assert.match(workflow, /\n {2}egress-gate-is-real:\n/, "the brain offline gate's negative control job is missing");
  assert.ok(manifest.scripts["build:bundles"].includes("pnpm --filter @foliage/canopy-app workspace:build"), "the full gate must refresh Canopy's generated shared-control stylesheet");
  for (const gate of ["doctor", "check:boundary", "check:egress", "check:dup", "check:findings", "typecheck"]) {
    assert.ok(manifest.scripts["check:static"].split(" && ").includes(`pnpm run ${gate}`), `missing ${gate}`);
  }
});

test("Dependabot proposes only releases pnpm will install, in small grouped weekly batches", () => {
  const minimumReleaseAge = Number(read("pnpm-workspace.yaml").match(/^minimumReleaseAge: (\d+)$/m)?.[1]);
  assert.ok(minimumReleaseAge > 0, "pnpm-workspace.yaml must keep its minimum release age");
  const updates = read(".github/dependabot.yml").split(/^  - package-ecosystem: /m).slice(1);
  /** @param {string} update */
  const ecosystemOf = update => update.match(/^"([\w-]+)"/)?.[1];
  // Dependabot's npm updater runs only on Node 24: on the Node 22 line every npm update fails, and
  // the move to Node 24 must bring npm updates back.
  const nodeMajor = Number(read(".nvmrc").trim().split(".")[0]);
  assert.deepEqual(updates.map(ecosystemOf).sort(), nodeMajor >= 24 ? ["github-actions", "npm"] : ["github-actions"]);
  for (const update of updates) {
    const ecosystem = ecosystemOf(update);
    assert.match(update, /^ {4}directory: "\/"$/m, `${ecosystem} must cover the workspace root`);
    assert.match(update, /^ {6}interval: "weekly"$/m, ecosystem);
    const limit = Number(update.match(/^ {4}open-pull-requests-limit: (\d+)$/m)?.[1]);
    assert.ok(limit >= 1 && limit <= 3, `${ecosystem} may hold at most 3 open PRs, found ${limit}`);
    assert.match(update, /^ {8}update-types: \["minor", "patch"\]$/m, `${ecosystem} must group minor and patch bumps`);
    // A shorter cooldown would propose releases pnpm refuses to install (minimumReleaseAge, in minutes).
    const cooldownDays = Number(update.match(/^ {6}default-days: (\d+)$/m)?.[1]);
    assert.ok(cooldownDays * 24 * 60 >= minimumReleaseAge, `${ecosystem} cooldown of ${cooldownDays} days is under pnpm's release age`);
  }
});

test("Draft pull requests never run a billed runner, and marking one ready runs them all", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /^ {2}pull_request:\n {4}types: \[opened, synchronize, reopened, ready_for_review\]$/m, "ready_for_review must start the billed jobs a draft skipped");
  const jobs = workflow.split(/^jobs:$/m)[1]?.split(/^ {2}(?=[\w-]+:$)/m).slice(1) ?? [];
  const billed = jobs.filter(job => /^ {4}runs-on: ubuntu-/m.test(job));
  assert.ok(billed.length >= 3, "expected the ubuntu check, boundary and egress jobs");
  for (const job of billed) {
    const condition = job.match(/^ {4}if: (.*)$/m)?.[1] ?? "";
    assert.ok(condition.includes("github.event_name != 'pull_request' || !github.event.pull_request.draft"), `${job.split(":")[0]} runs billed minutes on draft PRs`);
  }
});

test("No CI job runs on a self-hosted runner, and the macOS gate runs on a hosted one", () => {
  // This repository is public. A self-hosted runner would execute a fork's pull request on someone's own machine.
  const jobs = read(".github/workflows/ci.yml").split(/^jobs:$/m)[1]?.split(/^ {2}(?=[\w-]+:$)/m).slice(1) ?? [];
  assert.ok(jobs.length > 0, "no CI jobs found");
  for (const job of jobs) assert.doesNotMatch(job, /^ {4}runs-on: .*self-hosted/m, `${job.split(":")[0]} must not use a self-hosted runner`);
  const mac = jobs.find(job => job.startsWith("check-macos:"));
  assert.ok(mac, "check-macos job not found; update this test if it moved");
  assert.match(mac, /^ {4}runs-on: macos-/m, "the brain offline gate and the mac path need a hosted macOS runner");
});
