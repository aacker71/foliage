/**
 * `foliage grow` WITHOUT A WORKING GIT, through the real `foliage.mjs`.
 *
 * Measured on the 0.3.0 candidate: with git off PATH, `grow --repo <repo>` exited 2 with "no
 * --identity given and the repo has no git user.email", and with --identity it blamed user.name.
 * Both were false: git was missing. Grow now asks git first and says so in one sentence, with the
 * Mac remedy. A Mac without the Command Line Tools has a /usr/bin/git that only fails, so a git
 * that does not run is named too.
 *
 * ISOLATION: PATH is a folder this test made (empty, or holding a stand-in git that only fails),
 * HOME and the garden are temporary folders, and nothing is read from the developer's own setup.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scene(): Promise<{ readonly root: string; readonly home: string; readonly garden: string; readonly repo: string }> {
  const root = await mkdtemp(join(tmpdir(), "foliage-grow-no-git-"));
  roots.push(root);
  const home = join(root, "home"), repo = join(root, "repo");
  await mkdir(home);
  await mkdir(repo);
  await writeFile(join(repo, "notes.txt"), "A folder standing in for a repository; git never reads it.\n");
  return { root, home, garden: join(root, "garden"), repo };
}

const remedy = process.platform === "darwin"
  ? "on a Mac, git comes with the Xcode Command Line Tools: run 'xcode-select --install'"
  : "install git, then run this again";

function grow(path: string, home: string, args: readonly string[]) {
  return spawnSync(process.execPath, [FOLIAGE_CLI, "grow", ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: { PATH: path, HOME: home, NO_COLOR: "1" },
  });
}

test("grow with no git on PATH says git is missing and how a Mac gets it, never that user.email is unset", async () => {
  const { root, home, garden, repo } = await scene();
  const empty = join(root, "empty-path");
  await mkdir(empty);
  for (const args of [
    ["--repo", repo, "--garden", garden],
    ["--repo", repo, "--garden", garden, "--identity", "someone@example.test", "--subject", "Someone"],
    ["--garden", garden],
  ]) {
    const ran = grow(empty, home, args);
    assert.equal(ran.status, 2, ran.stderr);
    assert.equal(ran.stdout, "", "nothing is printed as if grow had started");
    assert.equal(ran.stderr, `foliage: grow needs git to read your repository, and git is not installed here (${remedy}).\n`);
    assert.doesNotMatch(ran.stderr, /user\.email|user\.name/);
  }
  await assert.rejects(lstat(garden), { code: "ENOENT" }, "the garden is not made before git is found");
});

test("grow with a git that does not run, as on a Mac without the Command Line Tools, says so", async () => {
  const { root, home, garden, repo } = await scene();
  const bin = join(root, "bin");
  await mkdir(bin);
  // A stand-in for the macOS /usr/bin/git shim when the Command Line Tools are absent: it only fails.
  await writeFile(join(bin, "git"), "#!/bin/sh\necho 'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun' >&2\nexit 1\n");
  await chmod(join(bin, "git"), 0o755);
  const ran = grow(bin, home, ["--repo", repo, "--garden", garden]);
  assert.equal(ran.status, 2, ran.stderr);
  assert.equal(ran.stderr, `foliage: grow needs git to read your repository, and the git here does not run (${remedy}).\n`);
  await assert.rejects(lstat(garden), { code: "ENOENT" });
});
