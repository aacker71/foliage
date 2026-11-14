/**
 * A NEXT STEP NAMES THE COMMAND THE QUICKSTART TEACHES.
 *
 * `foliage grow` used to print, before its own YOUR TURN block,
 *   intake: serve it with  FOLIAGE_LEAF=<garden>/leaf.json node apps/leaf/server.mjs
 *   harvest: next  node apps/leaf/harvest.mjs review --doc <garden>/harvest.json
 * and `foliage review --resume` echoed the first form again: internal scripts that only run from
 * the checkout root, beside the `foliage` commands the quickstart teaches. A document in a garden
 * (`<dir>/leaf.json`, `<dir>/harvest.json`) now names `foliage up|review --garden <dir>`, quoted
 * like the launcher's own steps so it runs from any directory. A document anywhere else keeps the
 * lower-level step, because no `foliage` command can address it.
 *
 * Real CLIs over a real temporary Git repository with a labelled fixture identity.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const INTAKE = fileURLToPath(new URL("../intake.mjs", import.meta.url));
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const INTERNAL_SCRIPT = /node apps\/leaf\//;

// The launcher's quoting (foliage.mjs nextCommand): a printed step pastes and runs as is.
const shellWord = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const foliageCommand = (...args: string[]) => [process.execPath, LAUNCHER, ...args].map(shellWord).join(" ");

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  for (const name of ["FOLIAGE_GARDEN", "FOLIAGE_LEAF", "FOLIAGE_HARVEST", "FOLIAGE_POLICY", "FOLIAGE_WORKFLOW_DIR"]) delete env[name];
  return env;
}

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "foliage-next-step-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repository");
  const garden = join(dir, "garden with 'quote'");
  const git = (args: string[]) => execute("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { timeout: 10_000 });
  await execute("git", ["init", "--quiet", "--initial-branch=main", repo]);
  await git(["config", "user.name", "Next step fixture"]);
  await git(["config", "user.email", "next-step@foliage.invalid"]);
  await writeFile(join(repo, "fixture.txt"), "fixture\n");
  await git(["add", "fixture.txt"]);
  await git(["commit", "--no-gpg-sign", "-qm", "feat: add the next-step fixture file"]);
  return { dir, repo, garden };
}

const grow = (repo: string, garden: string) =>
  execute(process.execPath, [LAUNCHER, "grow", "--repo", repo, "--subject", "Next step fixture", "--identity", "next-step@foliage.invalid", "--garden", garden], { env: cleanEnv(), timeout: 30_000 });

test("foliage grow: intake and harvest name foliage up/review for this garden, never an internal script", { timeout: 60_000 }, async t => {
  const { repo, garden } = await fixture(t);
  const { stdout } = await grow(repo, garden);
  const lines = stdout.split("\n");
  assert.ok(lines.includes(`intake: serve it with  ${foliageCommand("up", "--garden", garden)}`), stdout);
  assert.ok(lines.includes(`harvest: next  ${foliageCommand("review", "--garden", garden)}`), stdout);
  assert.deepEqual(lines.filter(line => INTERNAL_SCRIPT.test(line)), []);
  // Intake has just written the commits into the leaf as pending; what waits for the person is the drafts.
  assert.match(stdout, /YOUR TURN — no draft joins the leaf without you/);
  assert.doesNotMatch(stdout, /nothing joins the leaf/);
  // The printed review step runs as printed, from another directory: it reads, decides nothing.
  const review = await execute(process.execPath, [LAUNCHER, "review", "--garden", garden], { env: cleanEnv(), cwd: tmpdir(), timeout: 15_000 });
  assert.match(review.stdout, /\/review/);
});

test("foliage review --resume: the promotion's serve step is foliage up for this garden", { timeout: 60_000 }, async t => {
  const { repo, garden } = await fixture(t);
  await grow(repo, garden);
  const { stdout } = await execute(process.execPath, [LAUNCHER, "review", "--resume", "--garden", garden], { env: cleanEnv(), timeout: 30_000 });
  const lines = stdout.split("\n").map(line => line.trim());
  assert.ok(lines.includes(`harvest: serve it with  ${foliageCommand("up", "--garden", garden)}`), stdout);
  assert.deepEqual(lines.filter(line => INTERNAL_SCRIPT.test(line)), []);
});

test("a leaf outside any garden keeps the lower-level serve step: no foliage command can address it", { timeout: 60_000 }, async t => {
  const { dir, repo } = await fixture(t);
  const out = join(dir, "elsewhere.leaf.json");
  const { stdout } = await execute(process.execPath, [INTAKE, "--repo", repo, "--subject", "Next step fixture", "--identity", "next-step@foliage.invalid", "--out", out], { env: cleanEnv(), timeout: 30_000 });
  assert.ok(stdout.split("\n").includes(`intake: serve it with  FOLIAGE_LEAF=${out} node apps/leaf/server.mjs`), stdout);
});

test("the checkout's own apps/leaf documents are the bare server's defaults, not a garden", async () => {
  const { foliageNextStep } = await import("./foliageNextStep.ts");
  const garden = join(tmpdir(), "g");
  assert.equal(foliageNextStep("up", join(APP_DIR, "leaf.json")), null);
  assert.equal(foliageNextStep("review", join(APP_DIR, "harvest.json")), null);
  assert.equal(foliageNextStep("up", join(garden, "notes.json")), null);
  assert.equal(foliageNextStep("up", join(garden, "harvest.json")), null, "a harvest is not what up serves");
  assert.equal(foliageNextStep("review", join(garden, "leaf.json")), null, "a leaf is not what review reads");
  assert.equal(foliageNextStep("up", join(garden, "leaf.json")), foliageCommand("up", "--garden", garden));
  assert.equal(foliageNextStep("review", join(garden, "harvest.json")), foliageCommand("review", "--garden", garden));
});
