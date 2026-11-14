/**
 * `watch`, `verify` and the /workflow Sources API WITHOUT A WORKING GIT, as `grow` already is
 * (foliageGrowNoGit.test.ts). With git off PATH, or a stand-in for the git a Mac without the
 * Command Line Tools has (it only fails), each used to say the folder "is not a git repository"
 * or "not inside a git repository", or that git could not open it, which sends a person to choose
 * another folder. Each now asks git first and says the same sentence, with the Mac remedy.
 *
 * ISOLATION: PATH is a folder this test made (empty, or holding a stand-in git that only fails),
 * HOME, the garden and the workflow state are temporary folders, and the "repository" is a plain
 * folder git never reads.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gitNeeded, gitRemedy } from "./gitNeeded.ts";
import { openWorkflow } from "./workflow.ts";

const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map(dir => rm(dir, { recursive: true, force: true })));
});

/** A folder standing in for a repository, an empty PATH, and a PATH whose only git fails as the macOS stub does. */
async function scene() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "foliage-git-needed-")));
  roots.push(root);
  const home = join(root, "home"), repo = join(root, "repo"), empty = join(root, "empty-path"), stub = join(root, "stub-path");
  for (const dir of [home, repo, empty, stub]) await mkdir(dir);
  await writeFile(join(repo, "notes.txt"), "A folder standing in for a repository; git never reads it.\n");
  await writeFile(join(stub, "git"), "#!/bin/sh\necho 'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun' >&2\nexit 1\n");
  await chmod(join(stub, "git"), 0o755);
  return { root, home, repo, garden: join(root, "garden"), empty, stub };
}

/** Each PATH, and what grow already says of it. */
const CASES = [["empty", "git is not installed here"], ["stub", "the git here does not run"]] as const;

function foliage(path: string, home: string, args: readonly string[], cwd?: string) {
  return spawnSync(process.execPath, [FOLIAGE_CLI, ...args], { encoding: "utf8", timeout: 60_000, cwd, env: { PATH: path, HOME: home, NO_COLOR: "1" } });
}

test("the sentence is grow's, with the Mac remedy on a Mac", () => {
  assert.equal(gitNeeded("grow", "git is not installed here", "darwin"),
    "grow needs git to read your repository, and git is not installed here (on a Mac, git comes with the Xcode Command Line Tools: run 'xcode-select --install').");
  assert.equal(gitRemedy("linux"), "install git, then run this again");
});

test("watch with no working git says git is needed, never that the folder is not inside a git repository, and records nothing", async () => {
  const s = await scene();
  for (const [which, absence] of CASES) {
    const ran = foliage(s[which], s.home, ["watch", s.repo, "--garden", s.garden]);
    assert.equal(ran.status, 1, ran.stderr);
    assert.equal(ran.stdout, "");
    assert.equal(ran.stderr, `sources: ${gitNeeded("watch", absence)}\n`, which);
    assert.doesNotMatch(ran.stderr, /not inside a git repository|user\.(email|name)/);
  }
  await assert.rejects(lstat(join(s.garden, "sources.json")), { code: "ENOENT" }, "nothing was watched");
});

test("verify, with --repo or from the folder, with no working git says git is needed, never that the folder is not a git repository", async () => {
  const s = await scene();
  for (const [which, absence] of CASES) {
    for (const [args, cwd] of [[["verify", "--repo", s.repo, "--garden", s.garden], undefined], [["verify", "--garden", s.garden], s.repo]] as const) {
      const ran = foliage(s[which], s.home, args, cwd);
      assert.equal(ran.status, 2, ran.stderr);
      assert.equal(ran.stdout, "", "nothing is printed as if verify had started");
      assert.equal(ran.stderr, `foliage: ${gitNeeded("verify", absence)}\n`, `${which} ${args.join(" ")}`);
    }
  }
  await assert.rejects(lstat(s.garden), { code: "ENOENT" }, "verify made nothing");
});

test("the /workflow Sources API with no working git says git is needed, never 'choose the repository root'", { timeout: 60_000 }, async () => {
  const s = await scene();
  const app = await openWorkflow(join(s.root, "state"), { harvestPath: join(s.root, "harvest.json") });
  const path = process.env["PATH"];
  try {
    for (const [which, absence] of CASES) {
      process.env["PATH"] = s[which];
      await assert.rejects(app.command({ action: "source", path: s.repo, email: "synthetic@foliage.invalid", authorized: true }),
        (error: Error) => error.message === gitNeeded("Foliage", absence) || assert.fail(`${which}: ${error.message}`));
    }
    assert.equal(app.snapshot().sources.length, 0, "nothing was connected");
  } finally {
    process.env["PATH"] = path;
    await app.close();
  }
});

test("collecting from a source connected while git worked, once git is missing or does not run, records git's sentence, never 'not-a-repo' or git's own words", { timeout: 60_000 }, async () => {
  const s = await scene();
  // A real repository, connected while git still works.
  const repo = join(s.root, "connected");
  await mkdir(repo);
  const git = (...args: string[]) => spawnSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", timeout: 30_000 });
  git("init", "--quiet", "--initial-branch=main");
  await writeFile(join(repo, "record.txt"), "A synthetic record for this test.\n");
  git("add", "record.txt");
  git("-c", "user.name=Synthetic collector", "-c", "user.email=synthetic@foliage.invalid", "commit", "-q", "-m", "feat: a synthetic record");
  const app = await openWorkflow(join(s.root, "collect-state"), { harvestPath: join(s.root, "collect-harvest.json") });
  const path = process.env["PATH"];
  try {
    await app.command({ action: "source", path: repo, email: "synthetic@foliage.invalid", authorized: true });
    await app.command({ action: "schedule", schedule: { cadence: "daily", day: "Monday", time: "09:00", timezone: "UTC", quiet: false, start: "22:00", end: "07:00", paused: false } });
    for (const [which, absence] of CASES) {
      process.env["PATH"] = s[which];
      await app.tick(new Date(), true);
      const source = app.snapshot().sources[0]!;
      const run = app.snapshot().history[0]!.run!;
      assert.equal(source.error, gitNeeded("Foliage", absence), which);
      assert.equal(run.sources[0]!.error, gitNeeded("Foliage", absence), which);
      assert.equal(run.sources[0]!.status, "failed");
    }
  } finally {
    process.env["PATH"] = path;
    await app.close();
  }
});
