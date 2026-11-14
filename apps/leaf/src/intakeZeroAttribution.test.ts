/**
 * `intake.mjs` when the declared `--identity` matches NONE of a repository's commits — every
 * one is, by the domain's own rule, `excluded`. Before this fix the report stopped at
 * `verified 0  pending 0  excluded N`, a fact a reader had to reverse-engineer into "my
 * --identity is probably wrong", with no hint that a census command exists to check it.
 * `harvest.mjs`'s `propose` already prints exactly this diagnosis for the identical situation
 * (see its "0 candidates, and NOT because the history is thin" message); this pins the same
 * shape now appearing on `intake.mjs`'s own path.
 *
 * Real git, real commits, real CLI — the same discipline `gitIntake.test.ts` uses: a temporary
 * repository this file builds and tears down, never a fixture standing in for one.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const INTAKE_CLI = fileURLToPath(new URL("../intake.mjs", import.meta.url));

const OTHER_AUTHOR = "someone.else@example.com";
const DECLARED_IDENTITY = "subject@example.com";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-intake-zero-"));
  tmpRoots.push(dir);
  return dir;
}

/** `git` in a directory, non-interactive, with the ambient config neutralised — same discipline
 * as `gitIntake.test.ts`, so a developer's own global config cannot change what this measures. */
async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(
    "git",
    ["-C", dir, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    },
  );
  return stdout;
}

async function initRepo(): Promise<string> {
  const dir = await tempDir();
  await git(dir, "init", "--quiet", "--initial-branch=main");
  return dir;
}

async function commit(dir: string, message: string, email: string): Promise<void> {
  await writeFile(join(dir, `f-${Math.random().toString(36).slice(2)}.txt`), message, "utf8");
  await git(dir, "add", "-A");
  await git(dir, "-c", "user.name=Test Author", "-c", `user.email=${email}`, "commit", "-m", message);
}

test("every commit excluded (declared identity matches nobody) prints the census diagnosis", async () => {
  const repo = await initRepo();
  await commit(repo, "fix: a bug only the other author touched", OTHER_AUTHOR);
  await commit(repo, "feat: another commit from the same other author", OTHER_AUTHOR);

  const out = join(repo, "leaf.json");
  const r = await exec(
    process.execPath,
    [
      INTAKE_CLI,
      "--repo",
      repo,
      "--subject",
      "Test Subject",
      "--identity",
      DECLARED_IDENTITY,
      "--out",
      out,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    },
  );
  assert.match(r.stdout, /verified 0 {2}pending 0 {2}excluded 2/);
  assert.match(
    r.stdout,
    new RegExp(`0 of the 2 commit\\(s\\) in .* are attributed to ${DECLARED_IDENTITY}`),
    `expected the zero-attribution diagnosis; got:\n${r.stdout}`,
  );
  assert.match(
    r.stdout,
    /git -C .* log --no-merges --format=%ae \| sort -u/,
    "the census command must be printed, exactly as harvest.mjs's own diagnosis prints it",
  );
  assert.match(r.stdout, /re-run with the --identity that history actually carries/);

  // The document was still written — an honest, fully-excluded leaf, not a refusal.
  const doc = JSON.parse(await readFile(out, "utf8"));
  assert.equal(doc.leaflets.length, 2);
  assert.ok(doc.leaflets.every((l: { tier: string }) => l.tier === "excluded"));
});

test("SOME attributed commits do NOT trigger the zero-attribution diagnosis", async () => {
  const repo = await initRepo();
  await commit(repo, "fix: this one is the declared subject's own work", DECLARED_IDENTITY);
  await commit(repo, "feat: so is this one", DECLARED_IDENTITY);
  await commit(repo, "chore: but this one belongs to somebody else", OTHER_AUTHOR);

  const out = join(repo, "leaf.json");
  const r = await exec(
    process.execPath,
    [
      INTAKE_CLI,
      "--repo",
      repo,
      "--subject",
      "Test Subject",
      "--identity",
      DECLARED_IDENTITY,
      "--out",
      out,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    },
  );
  assert.doesNotMatch(
    r.stdout,
    /are attributed to/,
    "the zero-attribution diagnosis must not fire when some commits ARE attributed",
  );
});
