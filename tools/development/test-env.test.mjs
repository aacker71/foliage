/**
 * A test run never reaches a person's garden, whatever their shell exports.
 *
 * THE DEFECT (measured at fa29203): dozens of test files hand their children
 * `{ ...process.env, HOME: <temp> }`. Pinning HOME is not enough — `foliage.mjs` reads
 * FOLIAGE_GARDEN before it falls back to `~/.foliage` — so with FOLIAGE_GARDEN exported,
 * `pnpm check` went 5 red AND wrote leaf.json, harvest.json and workflow/ into that garden.
 * On the owner's machine that garden is real data.
 *
 * The fix belongs at the one door every test run comes through (`pnpm test` and
 * `pnpm test:focus`), not in each file that spreads the environment. So this drives that door
 * the way a person does: the real `test:focus` script from package.json, a parent environment
 * pointing every data-path variable at a decoy, and a probe that runs `foliage grow` exactly as
 * the affected tests do (HOME pinned, the rest of the environment spread through).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
/** @type {{ scripts: Record<string, string> }} */
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const cli = join(root, "foliage.mjs");

/**
 * Every variable that names where a person's Foliage data lives, mapped to a decoy location
 * inside one directory. Only the decoy garden is created (empty); the rest must stay absent.
 * @type {Readonly<Record<string, string>>}
 */
const DECOYS = {
  FOLIAGE_GARDEN: "garden",
  FOLIAGE_LEAF: "leaf.json",
  FOLIAGE_HARVEST: "harvest.json",
  FOLIAGE_POLICY: "policy.json",
  FOLIAGE_SOURCES: "sources.json",
  FOLIAGE_WORKFLOW_DIR: "workflow",
  FOLIAGE_PUBLISHED: "published",
  FOLIAGE_MEDIA: "media",
  FOLIAGE_HOSTED_STATUS: "hosted-status.json",
  FOLIAGE_HOSTED_STATE: "hosted-connection.json",
  FOLIAGE_LADYBUG: "ladybug.json",
  FOLIAGE_TREE: "tree.json",
  FOLIAGE_COMPANY: "company.json",
  FOLIAGE_RELEASE: "release.json",
  FOLIAGE_COS_STORE: "tier1.foliage",
  FOLIAGE_SOURCE_REPO: "source-repo",
  FOLIAGE_OPEN_DESIGN_ROOT: "open-design",
  FOLIAGE_SITE: "site",
  FOLIAGE_HOME: "checkout",
};

/** @param {string} dir */
const tree = (dir) => readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

test("the full suite and a focused run go through the same door", () => {
  const focus = manifest.scripts["test:focus"];
  assert.ok(focus, "package.json has no test:focus script");
  assert.ok(
    manifest.scripts["test"]?.startsWith(`${focus} `),
    "`pnpm test` must start with the `test:focus` command, so the full gate cannot skip what a focused run does",
  );
});

test("a test that spreads process.env into `foliage grow` cannot write into an exported garden", (t) => {
  const work = mkdtempSync(join(tmpdir(), "foliage-test-env-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));

  const decoy = join(work, "decoy");
  mkdirSync(join(decoy, "garden"), { recursive: true });
  const before = tree(decoy);

  const home = join(work, "home");
  mkdirSync(home);
  const repo = join(work, "repo");
  const init = spawnSync("git", ["init", "--quiet", "--initial-branch=main", repo], { encoding: "utf8", timeout: 30_000 });
  assert.equal(init.status, 0, init.stderr);

  // The probe is a stand-in for any of those test files: it reports which data-path variables it
  // inherited, then runs a real write (`grow`) with HOME pinned and everything else spread.
  const seen = join(work, "seen.json");
  const probe = join(work, "probe.test.mjs");
  writeFileSync(probe, [
    `import { spawnSync } from "node:child_process";`,
    `import { writeFileSync } from "node:fs";`,
    `writeFileSync(${JSON.stringify(seen)}, JSON.stringify(Object.keys(process.env).filter((name) => name.startsWith("FOLIAGE_")).sort()));`,
    `const grow = spawnSync(process.execPath, [${JSON.stringify(cli)}, "grow", "--repo", ${JSON.stringify(repo)}, "--subject", "Probe Subject", "--identity", "probe@example.com"], {`,
    `  encoding: "utf8", timeout: 60000, env: { ...process.env, HOME: ${JSON.stringify(home)}, NO_COLOR: "1" },`,
    `});`,
    `if (grow.status !== 0) { process.stderr.write(String(grow.stdout) + String(grow.stderr)); process.exit(1); }`,
    ``,
  ].join("\n"));

  /** @type {Record<string, string | undefined>} */
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env["PATH"] ?? ""}`,
    GIT_CONFIG_GLOBAL: join(work, "empty-gitconfig"),
    ...Object.fromEntries(Object.entries(DECOYS).map(([name, at]) => [name, join(decoy, at)])),
  };
  writeFileSync(join(work, "empty-gitconfig"), "");
  // This file is itself running under a test runner; a nested `node --test` that inherits the
  // runner's own child marker behaves as a child, not as the command a person types.
  delete env["NODE_TEST_CONTEXT"];

  const run = spawnSync(`${manifest.scripts["test:focus"]} ${JSON.stringify(probe)}`, {
    cwd: root, shell: true, encoding: "utf8", timeout: 120_000, env,
  });
  const output = `${run.stdout}${run.stderr}`;

  const inherited = /** @type {string[]} */ (JSON.parse(readFileSync(seen, "utf8")));
  assert.deepEqual(
    inherited.filter((name) => Object.hasOwn(DECOYS, name)),
    [],
    "a test process must not inherit the shell's data-path variables",
  );
  assert.deepEqual(tree(decoy), before, "the exported garden (and every other exported data path) must be untouched");
  assert.equal(run.status, 0, `the probe run must pass:\n${output}`);
  // The positive control: grow really wrote — into the HOME-pinned garden the test chose.
  assert.ok(existsSync(join(home, ".foliage", "leaf.json")), `grow must have written into the test's own garden:\n${output}`);
});

// `pnpm test`, `pnpm check` and `check:ledger --verify-tests` all read the door's exit code. If it
// ever reported 0 for a red run, every red suite would read as green and a commit would go
// through a red gate unnoticed. So drive the door with one red test and one green test.
test("a red test run through the door still exits red, and a green one exits green", (t) => {
  const work = mkdtempSync(join(tmpdir(), "foliage-test-exit-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));

  /**
   * @param {string} name
   * @param {string} body
   */
  const probe = (name, body) => {
    const file = join(work, `${name}.test.mjs`);
    writeFileSync(file, [
      `import assert from "node:assert/strict";`,
      `import test from "node:test";`,
      `test(${JSON.stringify(name)}, () => { ${body} });`,
      ``,
    ].join("\n"));
    return file;
  };
  const red = probe("deliberately red", "assert.equal(1, 2);");
  const green = probe("deliberately green", "assert.equal(1, 1);");

  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env["PATH"] ?? ""}` };
  delete env["NODE_TEST_CONTEXT"];
  /** @param {string} file */
  const runFocus = (file) => spawnSync(`${manifest.scripts["test:focus"]} ${JSON.stringify(file)}`, {
    cwd: root, shell: true, encoding: "utf8", timeout: 60_000, env,
  });

  const failing = runFocus(red);
  // The runner itself must have run the probe and counted it red, so exit 1 below is the
  // failing test speaking, not a door that could not start.
  assert.match(failing.stdout, /\bfail 1\b/, `the red probe never reached the runner:\n${failing.stdout}${failing.stderr}`);
  assert.equal(failing.status, 1, `a failing test must fail the run:\n${failing.stdout}${failing.stderr}`);

  const passing = runFocus(green);
  assert.match(passing.stdout, /\bpass 1\b/, `the green probe never reached the runner:\n${passing.stdout}${passing.stderr}`);
  assert.equal(passing.status, 0, `a passing test must pass the run:\n${passing.stdout}${passing.stderr}`);
});
