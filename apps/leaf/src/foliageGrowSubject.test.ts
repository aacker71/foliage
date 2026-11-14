/**
 * `foliage grow --subject`, END TO END — a real `git init` repository, the real `foliage.mjs`
 * entry point, and real subprocesses (`intake.mjs`, `harvest.mjs`) exactly as a person's terminal
 * would run them.
 *
 * THE BUG: `--subject` fell back with `value("--subject") ?? spawnSync(...).stdout?.trim() ??
 * "You"`. `??` is nullish coalescing — it only replaces `null`/`undefined` — but `git config
 * user.name` on a repository with no configured name returns an EMPTY STRING, not undefined.
 * `"" ?? "You"` still evaluates to `""`, so `grow` silently passed `--subject ""` through to
 * `intake.mjs`, whose own argument gate treats a blank subject as MISSING and dumps its entire
 * USAGE block — the wrong response to "this repo just hasn't set git identity yet", and not the
 * clean one-line instruction every other missing-argument path in this CLI gives (see the
 * `--identity`/`user.email` fallback immediately above it in `foliage.mjs`, which this fix now
 * mirrors).
 *
 * ISOLATION: every spawn points `GIT_CONFIG_GLOBAL` at either an empty file or one this test
 * wrote itself — the same technique `gitIntake.test.ts`'s `withMachineConfig` uses — so these
 * assertions depend on nothing the developer running them happens to have in `~/.gitconfig`.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-grow-subject-"));
  tmpRoots.push(dir);
  return dir;
}

/** A real, empty (zero-commit) repository — `intake.mjs` and `harvest.mjs` are both total over
 * this case (see the header) and this test only cares which SUBJECT reached them, not the leaf
 * they draft. */
async function emptyRepo(): Promise<string> {
  const repo = await tempDir();
  await exec("git", ["init", "--quiet", "--initial-branch=main", repo], { timeout: 30_000 });
  return repo;
}

/** A machine-scope git config file, empty or carrying one `user.name` — this test's own,
 * never the real developer's `~/.gitconfig`. */
async function machineConfig(entries: readonly (readonly [string, string])[]): Promise<string> {
  const path = join(await tempDir(), "machine-gitconfig");
  await writeFile(path, "", "utf8");
  for (const [key, value] of entries) {
    await exec("git", ["config", "--file", path, key, value], { timeout: 30_000 });
  }
  return path;
}

interface GrowResult {
  readonly status: number;
  readonly output: string;
}

async function runGrow(args: readonly string[], gitConfigGlobal: string, home: string): Promise<GrowResult> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [FOLIAGE_CLI, "grow", ...args], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: gitConfigGlobal, NO_COLOR: "1" },
    });
    return { status: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

test("grow --subject is used verbatim, even when the repo's own git user.name differs", async () => {
  const repo = await emptyRepo();
  await exec("git", ["-C", repo, "config", "user.name", "Local Git Name"], { timeout: 30_000 });
  const emptyGlobal = await machineConfig([]);
  const home = await tempDir();

  const result = await runGrow(
    ["--repo", repo, "--subject", "Explicit Subject", "--identity", "test@example.com"],
    emptyGlobal,
    home,
  );
  assert.equal(result.status, 0, `grow must succeed on an empty repo:\n${result.output}`);
  assert.match(result.output, /AS\s+Explicit Subject/, "the --subject override must win");
  assert.doesNotMatch(result.output, /Local Git Name/, "the repo's own git name must not leak through an override");
});

test("grow with no --subject derives one from the repo's own git user.name, and states it as AS <name> <identity>", async () => {
  const repo = await emptyRepo();
  await exec("git", ["-C", repo, "config", "user.name", "Ada Lovelace"], { timeout: 30_000 });
  const emptyGlobal = await machineConfig([]);
  const home = await tempDir();

  const result = await runGrow(["--repo", repo, "--identity", "ada@example.com"], emptyGlobal, home);
  assert.equal(result.status, 0, `grow must succeed:\n${result.output}`);
  assert.match(result.output, /AS\s+Ada Lovelace\s+<ada@example\.com>/, "the derived subject and identity are both stated");
  // And the derivation actually reached intake.mjs — no usage dump, no missing-argument refusal.
  assert.doesNotMatch(result.output, /missing required argument/);
  assert.doesNotMatch(result.output, /Evidence intake — build a leaf document/);
});

test("grow with no --subject and no git user.name (repo or machine) refuses with ONE clean line, not intake.mjs's usage dump", async () => {
  const repo = await emptyRepo();
  // Deliberately no `git config user.name` anywhere this process can see: no repo-local config,
  // and GIT_CONFIG_GLOBAL points at a config file this test wrote with only user.email in it —
  // the ambient developer's ~/.gitconfig is never consulted.
  const barelyConfiguredGlobal = await machineConfig([["user.email", "nobody@example.com"]]);
  const home = await tempDir();

  const result = await runGrow(["--repo", repo, "--identity", "test@example.com"], barelyConfiguredGlobal, home);
  assert.equal(result.status, 2, `a repo with no git user.name must refuse with EXIT_USAGE (2):\n${result.output}`);
  assert.match(
    result.output,
    /foliage: no --subject given and the repo has no git user\.name\. Pass --subject "<name>"\./,
  );
  // THE REGRESSION: this must be the ONE line above, never intake.mjs's full USAGE block, which
  // is what an empty-string --subject silently produced before this fix.
  assert.doesNotMatch(result.output, /Evidence intake — build a leaf document/);
  assert.doesNotMatch(result.output, /missing required argument/);
  assert.doesNotMatch(result.output, /--subject "<name>"\s+display name/);
});

/*
 * 0.3.1 (round-4 archive retest): a newcomer whose git has neither user.email nor user.name met two
 * refusals in a row, --identity first and --subject after it, and the first one had already made
 * ~/.foliage, empty. One message now names both flags, and a grow that stops leaves no garden
 * folder it made: not on a refusal, and not when intake itself fails.
 */
test("grow with neither --identity nor --subject, and no git user.email or user.name, names both flags in ONE line and leaves no garden folder behind", async () => {
  const repo = await emptyRepo();
  const emptyGlobal = await machineConfig([]);
  const home = await tempDir();

  const ambient = await runGrow(["--repo", repo], emptyGlobal, home);
  assert.equal(ambient.status, 2, ambient.output);
  assert.equal(ambient.output, 'foliage: no --identity or --subject given, and the repo has no git user.email or user.name. Pass --identity <email> --subject "<name>".\n');
  await assert.rejects(stat(join(home, ".foliage")), { code: "ENOENT" }, "the refusal made no ~/.foliage");

  const named = join(home, "gardens", "mine");
  const refused = await runGrow(["--repo", repo, "--garden", named], emptyGlobal, home);
  assert.equal(refused.status, 2, refused.output);
  await assert.rejects(stat(join(home, "gardens")), { code: "ENOENT" }, "the refusal made no garden folder");

  // Only one missing still says only that one.
  const onlyEmail = await runGrow(["--repo", repo, "--subject", "Explicit Subject", "--garden", named], emptyGlobal, home);
  assert.equal(onlyEmail.output, "foliage: no --identity given and the repo has no git user.email. Pass --identity <email>.\n");
  await assert.rejects(stat(join(home, "gardens")), { code: "ENOENT" });

  // Intake refusing a folder that is not a repository leaves no garden folder this run made either.
  const plain = await tempDir();
  const failed = await runGrow(["--repo", plain, "--identity", "test@example.com", "--subject", "Explicit Subject", "--garden", named], emptyGlobal, home);
  assert.notEqual(failed.status, 0, failed.output);
  await assert.rejects(stat(join(home, "gardens")), { code: "ENOENT" }, "a failed intake left the garden folder it made");
  // A garden folder that was there before is left there.
  await mkdir(named, { recursive: true });
  const again = await runGrow(["--repo", plain, "--identity", "test@example.com", "--subject", "Explicit Subject", "--garden", named], emptyGlobal, home);
  assert.notEqual(again.status, 0, again.output);
  assert.ok((await stat(named)).isDirectory(), "a folder the person made stays");
});

/*
 * 0.3.1 (retest): the garden root (~/.foliage, or --garden) was made 755, readable by every
 * account on the computer, while brain/ and workflow/ inside it are 700. Foliage makes it owner
 * only now, and never changes the mode of a folder that was already there.
 */
test("grow and watch make the garden folder owner-only (700), ~/.foliage and --garden alike, and leave an existing folder's mode alone", async () => {
  const repo = await emptyRepo();
  const emptyGlobal = await machineConfig([]);
  const home = await tempDir();
  const mode = async (path: string) => (await stat(path)).mode & 0o777;
  const args = ["--repo", repo, "--identity", "test@example.com", "--subject", "Explicit Subject"];

  const ambient = await runGrow(args, emptyGlobal, home);
  assert.equal(ambient.status, 0, ambient.output);
  assert.equal(await mode(join(home, ".foliage")), 0o700, "~/.foliage is owner-only");

  const named = join(home, "gardens", "mine");
  const grown = await runGrow([...args, "--garden", named], emptyGlobal, home);
  assert.equal(grown.status, 0, grown.output);
  assert.equal(await mode(named), 0o700, "a --garden this run made is owner-only");

  // `foliage watch`, which writes the garden's first file itself, makes it owner-only too.
  const watched = join(home, "watched-garden");
  await exec(process.execPath, [FOLIAGE_CLI, "watch", repo, "--garden", watched, "--identity", "test@example.com", "--subject", "Explicit Subject"], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: emptyGlobal, NO_COLOR: "1" },
  });
  assert.equal(await mode(watched), 0o700, "a garden `watch` made is owner-only");

  // A folder the person made, with the mode they chose, keeps it.
  const theirs = join(home, "their-garden");
  await mkdir(theirs);
  await chmod(theirs, 0o755);
  const kept = await runGrow([...args, "--garden", theirs], emptyGlobal, home);
  assert.equal(kept.status, 0, kept.output);
  assert.equal(await mode(theirs), 0o755, "an existing folder is never chmod-ed");
});
