/**
 * `gatherGit` against real repositories — the SECOND reader of a repository's history, and until
 * now the untested one.
 *
 * WHY THIS FILE EXISTS. The three-pass review found that the widened ref selection
 * (`--branches HEAD`) was implemented in two readers and guarded in only one: reverting
 * `gather.ts` to a bare `git log` left the ENTIRE suite green at 1543/1543, so the ratchet could
 * not hold it and the PR body's claim "mutation-proven both ways" was true only of the two reads
 * inside `gitIntake.ts`. That was an overclaim, and this file is the correction.
 *
 * `gather.ts` is the reader photosynthesis drafts CANDIDATES from, so an unguarded regression here
 * does not merely lose leaflets — it silently empties somebody's review queue of the work they are
 * currently doing.
 *
 * The duplication itself is recorded as a ledger row rather than extracted, on F-026's stated
 * reason; a comment alone was not enough, which is the other half of what the review found.
 *
 * ISOLATION: `gatherGit` spawns git itself, in-process, inheriting THIS process's environment —
 * so the only isolation that reaches it is on `process.env`. `GIT_CONFIG_GLOBAL` and
 * `GIT_CONFIG_SYSTEM` are set for the whole file in `before()` and restored in `after()`.
 * Measured before this existed: a malformed global config failed every case here with
 * `fatal: bad config line 1`.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { gatherGit } from "./gather.ts";

const exec = promisify(execFile);
const EMAIL = "gather@example.test";
const PHOTOSYNTHESIS_CLI = fileURLToPath(new URL("../photosynthesis.mjs", import.meta.url));

const tmpRoots: string[] = [];
const inherited = { global: process.env["GIT_CONFIG_GLOBAL"], system: process.env["GIT_CONFIG_SYSTEM"] };
before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-gather-cfg-"));
  tmpRoots.push(dir);
  const emptyGlobal = join(dir, "gitconfig");
  await writeFile(emptyGlobal, "", "utf8");
  process.env["GIT_CONFIG_GLOBAL"] = emptyGlobal;
  process.env["GIT_CONFIG_SYSTEM"] = "/dev/null";
});
after(async () => {
  if (inherited.global === undefined) delete process.env["GIT_CONFIG_GLOBAL"];
  else process.env["GIT_CONFIG_GLOBAL"] = inherited.global;
  if (inherited.system === undefined) delete process.env["GIT_CONFIG_SYSTEM"];
  else process.env["GIT_CONFIG_SYSTEM"] = inherited.system;
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-gather-"));
  tmpRoots.push(dir);
  await exec("git", ["init", "--quiet", "--initial-branch=main", dir], { timeout: 30_000 });
  await exec("git", ["-C", dir, "config", "user.email", EMAIL], { timeout: 30_000 });
  await exec("git", ["-C", dir, "config", "user.name", "Gather Person"], { timeout: 30_000 });
  return dir;
}

async function commit(dir: string, file: string, subject: string): Promise<void> {
  await writeFile(join(dir, file), subject, "utf8");
  await exec("git", ["-C", dir, "add", file], { timeout: 30_000 });
  await exec("git", ["-C", dir, "commit", "--quiet", "-m", subject], { timeout: 30_000 });
}

async function subjectsOf(dir: string): Promise<readonly string[]> {
  const got = await gatherGit(dir, EMAIL);
  assert.equal(got.ok, true, got.ok ? "" : got.cause);
  return got.ok ? got.data.clusters.flatMap((c) => c.commits.map((x) => x.subject)) : [];
}

test("a commit on an unmerged branch is gathered — candidates are drafted from work in flight", async () => {
  const dir = await repo();
  await commit(dir, "a.txt", "feat: the merged work");
  await exec("git", ["-C", dir, "checkout", "--quiet", "-b", "in-flight"], { timeout: 30_000 });
  await commit(dir, "b.txt", "feat: the work still in flight");
  await exec("git", ["-C", dir, "checkout", "--quiet", "main"], { timeout: 30_000 });

  const subjects = await subjectsOf(dir);
  assert.ok(subjects.includes("feat: the merged work"));
  assert.ok(
    subjects.includes("feat: the work still in flight"),
    `an unmerged branch commit was not gathered — a bare 'git log' walks HEAD alone. Saw: ${subjects.join(", ")}`,
  );
});

test("a DETACHED HEAD's own commit is gathered, which `--branches` alone would drop", async () => {
  const dir = await repo();
  await commit(dir, "a.txt", "feat: on the branch");
  const sha = (await exec("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 30_000 })).stdout.trim();
  await exec("git", ["-C", dir, "checkout", "--quiet", "--detach", sha], { timeout: 30_000 });
  await commit(dir, "c.txt", "feat: written while detached");

  assert.ok((await subjectsOf(dir)).includes("feat: written while detached"));
});

test("a repository holding a file called HEAD is still gathered — the `--` terminator", async () => {
  // Without `--`, git cannot tell whether the bare `HEAD` is a revision or that file, and the whole
  // read dies with "ambiguous argument". A repository that gathered fine before would return a
  // FAILURE — which `gatherGit` reports honestly rather than as zero commits, so the queue would
  // simply stop filling with an explanation nobody reads.
  const dir = await repo();
  await commit(dir, "HEAD", "feat: a file called HEAD");
  await commit(dir, "other.txt", "feat: ordinary work beside it");

  const got = await gatherGit(dir, EMAIL);
  assert.equal(got.ok, true, got.ok ? "" : `gather failed: ${got.cause}`);
  const subjects = await subjectsOf(dir);
  assert.ok(subjects.includes("feat: a file called HEAD"));
});

test("no commit is gathered twice when a branch is merged into HEAD", async () => {
  // `--branches HEAD` is a union of ref walks; git deduplicates by object. If it did not, a merged
  // branch would double every candidate drafted from it.
  const dir = await repo();
  await commit(dir, "a.txt", "feat: shared history");
  await exec("git", ["-C", dir, "checkout", "--quiet", "-b", "topic"], { timeout: 30_000 });
  await commit(dir, "b.txt", "feat: the topic work");
  await exec("git", ["-C", dir, "checkout", "--quiet", "main"], { timeout: 30_000 });
  await exec("git", ["-C", dir, "merge", "--quiet", "--no-ff", "-m", "merge: topic", "topic"], { timeout: 30_000 });

  const subjects = await subjectsOf(dir);
  assert.equal(subjects.filter((s) => s === "feat: the topic work").length, 1);
  assert.ok(!subjects.includes("merge: topic"), "--no-merges must still hold");
});

test("another person's commits are still excluded — widening the refs did not widen attribution", async () => {
  // The identity filter is literal and runs after the read. Reading more history must not mean
  // attributing more of it: a colleague's branch is now READ, and must still be discarded.
  const dir = await repo();
  await commit(dir, "mine.txt", "feat: my own work");
  await exec("git", ["-C", dir, "checkout", "--quiet", "-b", "theirs"], { timeout: 30_000 });
  await exec("git", ["-C", dir, "config", "user.email", "colleague@example.test"], { timeout: 30_000 });
  await commit(dir, "theirs.txt", "feat: a colleague's work");
  await exec("git", ["-C", dir, "checkout", "--quiet", "main"], { timeout: 30_000 });

  const subjects = await subjectsOf(dir);
  assert.ok(subjects.includes("feat: my own work"));
  assert.ok(
    !subjects.includes("feat: a colleague's work"),
    "widening the ref selection must not widen attribution",
  );
});

test("an UNBORN HEAD with work on a branch is gathered — the flagship case, not a hard failure", async () => {
  // One combined `git log --branches HEAD --` exits 128 here ("bad revision 'HEAD'"), which this
  // reader reported as a FAILURE — zero candidates for the person's entire body of work — while
  // `readCommits` over the same repository read it. Probed apart, HEAD costs only HEAD.
  const dir = await repo();
  await exec("git", ["-C", dir, "checkout", "--quiet", "-b", "work"], { timeout: 30_000 });
  await commit(dir, "a.txt", "feat: work with no main yet");
  await exec("git", ["-C", dir, "symbolic-ref", "HEAD", "refs/heads/nothing-here"], { timeout: 30_000 });

  const got = await gatherGit(dir, EMAIL);
  assert.equal(got.ok, true, got.ok ? "" : `an unborn HEAD failed the whole gather: ${got.cause}`);
  if (!got.ok) return;
  assert.ok(
    got.data.clusters.flatMap((c) => c.commits.map((x) => x.subject)).includes("feat: work with no main yet"),
    `an unborn HEAD hid work that exists on a branch: ${got.data.total} commit(s) gathered`,
  );
  // An unborn HEAD is an ordinary state, not a partial read of the branches.
  assert.equal(got.data.narrowedBecause, null);
});

test("one corrupt branch ref narrows the walk to HEAD and SAYS SO — it does not fail the gather", async () => {
  // `--branches` makes every entry in refs/heads load-bearing: one unreadable ref and the combined
  // read died with `fatal: bad object broken`, a regression against the pre-PR bare `git log`,
  // which read HEAD's intact history happily. Narrowing silently would be the other failure.
  const dir = await repo();
  await commit(dir, "a.txt", "feat: intact HEAD work");
  await exec("git", ["-C", dir, "branch", "broken"], { timeout: 30_000 });
  await writeFile(join(dir, ".git", "refs", "heads", "broken"), "not-a-sha\n", "utf8");

  const got = await gatherGit(dir, EMAIL);
  assert.equal(got.ok, true, got.ok ? "" : `one dead branch failed the whole gather: ${got.cause}`);
  if (!got.ok) return;
  assert.ok(got.data.clusters.flatMap((c) => c.commits.map((x) => x.subject)).includes("feat: intact HEAD work"));
  assert.notEqual(got.data.narrowedBecause, null, "the walk narrowed silently");
  assert.match(String(got.data.narrowedBecause), /broken|bad object|could not be read/i);
});

test("the CLI PRINTS the narrowing — the field is reported, not swallowed", async () => {
  // The print is the mechanism. With it commented out, every unit case above stays green, so the
  // real photosynthesis.mjs is spawned against the same corrupt-ref repository and its stdout read.
  const dir = await repo();
  await commit(dir, "a.txt", "feat: intact HEAD work");
  await exec("git", ["-C", dir, "branch", "broken"], { timeout: 30_000 });
  await writeFile(join(dir, ".git", "refs", "heads", "broken"), "not-a-sha\n", "utf8");

  const { stdout } = await exec(
    process.execPath,
    [PHOTOSYNTHESIS_CLI, "--repo", dir, "--subject", "Gather Person", "--identity", EMAIL, "--no-model", "--out", join(dir, "harvest.json")],
    { encoding: "utf8", timeout: 60_000 },
  );
  assert.match(stdout, /read HEAD only — a local branch could not be read/, `no narrowing line on stdout:\n${stdout}`);
  assert.match(stdout, /git said: .*broken/);
});

test("a healthy repository reports NO narrowing — the field is not decorative", async () => {
  const dir = await repo();
  await commit(dir, "a.txt", "feat: fine");
  const got = await gatherGit(dir, EMAIL);
  assert.equal(got.ok, true);
  if (got.ok) assert.equal(got.data.narrowedBecause, null);
});

test("an empty repository is an honest empty, as it is to readCommits — not a failure", async () => {
  // Before the refs were probed apart this was `ok: false` ("does not have any commits yet"). Both
  // readers now give the same answer about the same repository: zero commits, nothing wrong.
  const dir = await repo();
  const got = await gatherGit(dir, EMAIL);
  assert.equal(got.ok, true, got.ok ? "" : got.cause);
  if (got.ok) {
    assert.equal(got.data.total, 0);
    assert.equal(got.data.narrowedBecause, null);
  }
});
