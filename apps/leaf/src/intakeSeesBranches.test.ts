/**
 * WORK IN FLIGHT REACHES THE PORTFOLIO — the branch a person has not merged yet.
 *
 * THE GAP THIS CLOSES. Both readers of a repository's history ran a bare `git log`, which walks
 * HEAD and nothing else. Everything on an unmerged branch was therefore invisible to the person's
 * own portfolio. MEASURED on this repository the day this was written: 253 commits reachable from
 * HEAD, 355 from `--branches` — **102 of the subject's own commits, 29% of their work**, every one
 * carrying their own address. A portfolio that only knows merged history is always weeks behind
 * what somebody is actually doing, which is the difference between "what they have done" and "what
 * they are doing".
 *
 * WHY A REAL REPOSITORY AND NOT A FIXTURE. The claim is about what `git log` walks. A stubbed
 * reader would prove only that the stub was written to agree with the test — so every case below
 * builds a real repository, makes a real commit on a real branch, and reads it back through the
 * real intake path.
 *
 * ISOLATION, and where it actually has to live. `readCommits` runs IN-PROCESS and spawns git with
 * no `env` of its own, so it inherits this test process's environment — an env passed to the
 * setup execs never reaches it. The docblock claimed isolation twice before the file had any that
 * reached the reader; the third-pass review set a malformed `GIT_CONFIG_GLOBAL` on the test process
 * and 0 of 8 passed. So `GIT_CONFIG_GLOBAL` (an empty file this test writes) and
 * `GIT_CONFIG_SYSTEM` are set on `process.env` in `before()` for the whole file, and restored in
 * `after()`. Everything is deleted afterwards.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { readCommits } from "./gitIntake.ts";

const exec = promisify(execFile);
const INTAKE_CLI = fileURLToPath(new URL("../intake.mjs", import.meta.url));
const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

const tmpRoots: string[] = [];
const inherited = { global: process.env["GIT_CONFIG_GLOBAL"], system: process.env["GIT_CONFIG_SYSTEM"] };
before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-branches-cfg-"));
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

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-branches-"));
  tmpRoots.push(dir);
  return dir;
}

const EMAIL = "inflight@example.test";

/** A real repository, with its own identity — never the developer's. */
async function repo(): Promise<string> {
  const dir = await tempDir();
  await exec("git", ["init", "--quiet", "--initial-branch=main", dir], { timeout: 30_000 });
  await exec("git", ["-C", dir, "config", "user.email", EMAIL], { timeout: 30_000 });
  await exec("git", ["-C", dir, "config", "user.name", "In Flight"], { timeout: 30_000 });
  return dir;
}

async function commit(dir: string, file: string, subject: string): Promise<void> {
  await writeFile(join(dir, file), subject, "utf8");
  await exec("git", ["-C", dir, "add", file], { timeout: 30_000 });
  await exec("git", ["-C", dir, "commit", "--quiet", "-m", subject], { timeout: 30_000 });
}

async function subjectsOf(dir: string): Promise<readonly string[]> {
  const read = await readCommits(dir);
  assert.equal(read.ok, true, read.ok ? "" : `${read.cause}: ${read.detail}`);
  return read.ok ? read.commits.map((c) => c.subject) : [];
}

test("a commit on an unmerged branch is READ — this is 'what they are doing'", async () => {
  const dir = await repo();
  await commit(dir, "a.txt", "feat: the merged work");
  await exec("git", ["-C", dir, "checkout", "--quiet", "-b", "in-flight"], { timeout: 30_000 });
  await commit(dir, "b.txt", "feat: the work still in flight");
  // Back to main, so the branch commit is NOT reachable from HEAD — the exact shape of the gap.
  await exec("git", ["-C", dir, "checkout", "--quiet", "main"], { timeout: 30_000 });

  const subjects = await subjectsOf(dir);
  assert.ok(subjects.includes("feat: the merged work"), "merged work must still be read");
  assert.ok(
    subjects.includes("feat: the work still in flight"),
    `an unmerged branch commit was not read — a bare 'git log' walks HEAD alone. Saw: ${subjects.join(", ")}`,
  );
});

test("a DETACHED HEAD's own commit is read, which `--branches` alone would drop", async () => {
  // `--branches` walks local branch tips. A detached HEAD sits on none of them, so the bare flag
  // would silently lose the very commits the person is standing on — which is why HEAD is named
  // alongside it rather than assumed to be covered.
  const dir = await repo();
  await commit(dir, "a.txt", "feat: on the branch");
  const sha = (await exec("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 30_000 })).stdout.trim();
  await exec("git", ["-C", dir, "checkout", "--quiet", "--detach", sha], { timeout: 30_000 });
  await commit(dir, "c.txt", "feat: written while detached");

  const subjects = await subjectsOf(dir);
  assert.ok(subjects.includes("feat: written while detached"), `detached-HEAD work was dropped: ${subjects.join(", ")}`);
  assert.ok(subjects.includes("feat: on the branch"));
});

test("no commit is read twice when a branch is merged into HEAD", async () => {
  // `--branches HEAD` is a UNION of ref walks, not a concatenation: git deduplicates by object, so
  // a commit reachable from both a branch tip and HEAD appears once. If it did not, a merged
  // branch would double every leaflet drafted from it.
  const dir = await repo();
  await commit(dir, "a.txt", "feat: shared history");
  await exec("git", ["-C", dir, "checkout", "--quiet", "-b", "topic"], { timeout: 30_000 });
  await commit(dir, "b.txt", "feat: the topic work");
  await exec("git", ["-C", dir, "checkout", "--quiet", "main"], { timeout: 30_000 });
  await exec("git", ["-C", dir, "merge", "--quiet", "--no-ff", "-m", "merge: topic", "topic"], { timeout: 30_000 });

  const subjects = await subjectsOf(dir);
  const seen = subjects.filter((s) => s === "feat: the topic work");
  assert.equal(seen.length, 1, `a commit on both a branch tip and HEAD was read ${seen.length} times`);
  // The merge commit itself is not work — `--no-merges` still holds.
  assert.ok(!subjects.includes("merge: topic"), "--no-merges must still exclude the merge commit");
});

test("an empty repository is still an honest empty, not a failure", async () => {
  // Widening what is read must not change the answer for an unborn HEAD: zero commits, ok:true.
  const dir = await repo();
  const read = await readCommits(dir);
  assert.equal(read.ok, true);
  if (read.ok) assert.deepEqual(read.commits, []);
});

test("a repository holding a file called HEAD is still read — the `--` terminator", async () => {
  /*
   * `HEAD` is a bare positional, and git resolves a bare positional as EITHER a revision or a path.
   * Without a `--` terminator a repository containing a file named `HEAD` — legal, and built right
   * here — dies with "fatal: ambiguous argument 'HEAD': both revision and filename", so a
   * repository that read FINE before this change would be refused entirely and no document written.
   * Found by the three-pass review, reproduced, and this is its guard.
   */
  const dir = await repo();
  await commit(dir, "HEAD", "feat: a file called HEAD");
  await commit(dir, "other.txt", "feat: ordinary work beside it");

  const read = await readCommits(dir);
  assert.equal(read.ok, true, read.ok ? "" : `${read.cause}: ${read.detail}`);
  const subjects = read.ok ? read.commits.map((c) => c.subject) : [];
  assert.ok(subjects.includes("feat: a file called HEAD"));
  assert.ok(subjects.includes("feat: ordinary work beside it"));
});

/** One intact commit on HEAD and one branch ref holding garbage — the repository three cases below read. */
async function repoWithBrokenBranch(): Promise<string> {
  const dir = await repo();
  await commit(dir, "a.txt", "feat: intact HEAD work");
  await exec("git", ["-C", dir, "branch", "broken"], { timeout: 30_000 });
  await writeFile(join(dir, ".git", "refs", "heads", "broken"), "not-a-sha\n", "utf8");
  return dir;
}

test("one corrupt branch ref narrows the walk to HEAD and SAYS SO — it does not refuse the repository", async () => {
  /*
   * `--branches HEAD` makes every entry in refs/heads load-bearing: one unreadable ref and git
   * exits `fatal: bad object <name>`, so a repository whose HEAD history is completely intact
   * produced NO DOCUMENT AT ALL. Measured by the review as a regression against a bare `git log`,
   * which reads that repository happily.
   *
   * Refusing outright would cost somebody their whole portfolio for one dead branch; narrowing
   * SILENTLY would tell them they have less work than they have. So it narrows and reports.
   */
  const dir = await repoWithBrokenBranch();

  const read = await readCommits(dir);
  assert.equal(read.ok, true, read.ok ? "" : `${read.cause}: ${read.detail}`);
  if (!read.ok) return;
  // The intact history is still read …
  assert.ok(read.commits.map((c) => c.subject).includes("feat: intact HEAD work"));
  // … and the narrowing is reported, not swallowed.
  assert.notEqual(read.narrowedBecause, null, "the walk narrowed silently");
  assert.match(String(read.narrowedBecause), /broken|bad object|could not be read/i);
});

test("intake.mjs PRINTS the narrowing — the print is the mechanism, so it is spawned and read", async () => {
  // With the print commented out, every in-process case in this file stayed green (round-3 review
  // measured it: 97 tests across every file touching intake.mjs). So the real command runs.
  const dir = await repoWithBrokenBranch();
  const { stdout } = await exec(
    process.execPath,
    [INTAKE_CLI, "--repo", dir, "--subject", "In Flight", "--identity", EMAIL, "--out", join(dir, "leaf.json")],
    { encoding: "utf8", timeout: 60_000 },
  );
  assert.match(stdout, /^intake: read HEAD only — a local branch could not be read/m, `no narrowing line on stdout:\n${stdout}`);
  assert.match(stdout, /git said: .*broken/);
});

test("harvest.mjs propose PRINTS the narrowing beside its other honest partials", async () => {
  const dir = await repoWithBrokenBranch();
  const { stdout } = await exec(
    process.execPath,
    [HARVEST_CLI, "propose", "--repo", dir, "--identity", EMAIL, "--out", join(dir, "harvest.json")],
    { encoding: "utf8", timeout: 60_000 },
  );
  assert.match(stdout, /^harvest: read HEAD only — a local branch could not be read/m, `no narrowing line on stdout:\n${stdout}`);
  assert.match(stdout, /git said: .*broken/);
});

test("harvest.mjs propose --force over a narrowed read REFUSES and leaves harvest.json byte-identical", async () => {
  // A healthy read drafts the branch commit; then the branch ref breaks. A --force refresh must not
  // treat the unread branch as removed work, so it refuses before the queue is touched.
  const dir = await repo();
  await commit(dir, "a.txt", "feat: intact HEAD work");
  await exec("git", ["-C", dir, "checkout", "--quiet", "-b", "side"], { timeout: 30_000 });
  await commit(dir, "b.txt", "fix: work only on the branch");
  await exec("git", ["-C", dir, "checkout", "--quiet", "main"], { timeout: 30_000 });
  const out = join(dir, "harvest.json");
  await exec(process.execPath, [HARVEST_CLI, "propose", "--repo", dir, "--identity", EMAIL, "--out", out],
    { encoding: "utf8", timeout: 60_000 });
  const before = await readFile(out, "utf8");
  assert.match(before, /fix: work only on the branch/, "the healthy read drafted the branch commit");

  await writeFile(join(dir, ".git", "refs", "heads", "side"), "not-a-sha\n", "utf8");
  const forced = await exec(process.execPath, [HARVEST_CLI, "propose", "--repo", dir, "--identity", EMAIL, "--out", out, "--force"],
    { encoding: "utf8", timeout: 60_000 }).then(() => null, (error: { code?: number; stderr?: string }) => error);
  assert.notEqual(forced, null, "propose --force over a narrowed read exited 0");
  assert.equal(forced?.code, 1);
  assert.match(String(forced?.stderr), /incomplete history — refusing to replace/);
  assert.equal(await readFile(out, "utf8"), before, "harvest.json changed");
});

test("a healthy repository reports NO narrowing — the field is not decorative", async () => {
  const dir = await repo();
  await commit(dir, "a.txt", "feat: fine");
  const read = await readCommits(dir);
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.narrowedBecause, null);
});

test("an UNBORN HEAD with work on a branch is read, not reported as an empty repository", async () => {
  /*
   * The emptiness gate used to ask only whether HEAD existed, which was right when the walk was
   * HEAD-only. Once the walk widened, the two disagreed: a repository with an unborn HEAD and a
   * populated branch was reported as an HONEST EMPTY — zero commits, ok — while `gatherGit`,
   * reading the same repository, called it a hard failure. One repository, two readers, opposite
   * answers, and the person's work in neither.
   *
   * Caught by mutation while fixing it: reverting the gate to HEAD-only left the whole file green,
   * so the fix was unguarded until this case existed.
   */
  const dir = await repo();
  await exec("git", ["-C", dir, "checkout", "--quiet", "-b", "work"], { timeout: 30_000 });
  await commit(dir, "a.txt", "feat: work with no main yet");
  // HEAD now points at a branch that has never been created: unborn, while `work` holds a commit.
  await exec("git", ["-C", dir, "symbolic-ref", "HEAD", "refs/heads/nothing-here"], { timeout: 30_000 });

  const read = await readCommits(dir);
  assert.equal(read.ok, true, read.ok ? "" : `${read.cause}: ${read.detail}`);
  if (!read.ok) return;
  assert.equal(read.head, null, "HEAD is unborn, so the reported head must be null and not an empty string");
  assert.ok(
    read.commits.map((c) => c.subject).includes("feat: work with no main yet"),
    `an unborn HEAD hid work that exists on a branch: ${read.commits.length} commit(s) read`,
  );
});

test("a HEAD naming a missing object is a failed read, never an empty history", async () => {
  const dir = await repo();
  await commit(dir, "a.txt", "probe: record the missing-object control");
  await writeFile(join(dir, ".git", "refs", "heads", "main"), `${"e".repeat(40)}\n`);

  const read = await readCommits(dir);
  assert.equal(read.ok, false, "git rev-list failed; no successful empty result was observed");
  if (read.ok) return;
  assert.equal(read.cause, "git-failed");
  if (read.cause !== "git-failed") return;
  assert.notEqual(read.exitCode, 0);
  assert.match(read.stderr, /bad object/);
});

async function assertCorruptRefreshPreserves(corruption: "branch" | "HEAD"): Promise<void> {
  const dir = await repo();
  await commit(dir, "main-a.txt", "probe: record first main input");
  await commit(dir, "main-b.txt", "probe: record second main input");
  await exec("git", ["-C", dir, "checkout", "--quiet", "-b", "unmerged"]);
  await commit(dir, "branch-a.txt", "isolation: record first unmerged input");
  await commit(dir, "branch-b.txt", "isolation: record second unmerged input");
  await exec("git", ["-C", dir, "checkout", "--quiet", "main"]);

  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  const grow = [FOLIAGE_CLI, "grow", "--repo", dir, "--garden", garden];
  await exec(process.execPath, grow, { timeout: 60_000 });
  await exec(process.execPath, [HARVEST_CLI, "approve", "git-cluster:isolation", "--by", "In Flight", "--doc", harvestPath]);
  const beforeLeaf = await readFile(leafPath, "utf8");
  const beforeHarvest = await readFile(harvestPath, "utf8");
  const decision = (bytes: string): string | undefined => {
    const document = JSON.parse(bytes) as { candidates: { id: string; review: { state: string } }[] };
    return document.candidates.find((c) => c.id === "git-cluster:isolation")?.review.state;
  };
  assert.equal(decision(beforeHarvest), "approved", "the control must hold a real CLI approval");

  const damagedPath = join(dir, ".git", "refs", "heads", corruption === "HEAD" ? "main" : "broken");
  const original = corruption === "HEAD" ? await readFile(damagedPath, "utf8") : undefined;
  await writeFile(damagedPath, `${"e".repeat(40)}\n`);

  const refused = (error: unknown): boolean => {
    const failure = error as { code?: number; stderr?: string };
    assert.equal(failure.code, 1);
    assert.match(failure.stderr ?? "", /incomplete|git-failed/);
    assert.match(failure.stderr ?? "", /bad object/);
    return true;
  };
  // The direct writer needs its own guard: callers may bypass foliage grow entirely.
  await assert.rejects(exec(process.execPath, [HARVEST_CLI, "propose", "--repo", dir, "--identity", EMAIL, "--out", harvestPath, "--force"], { timeout: 60_000 }), refused);
  assert.equal(await readFile(harvestPath, "utf8"), beforeHarvest);
  await assert.rejects(exec(process.execPath, grow, { timeout: 60_000 }), refused);
  assert.equal(await readFile(leafPath, "utf8"), beforeLeaf, "a refused grow must not refresh the leaf first");
  assert.equal(await readFile(harvestPath, "utf8"), beforeHarvest, "a partial read must not delete an absent branch candidate");

  if (original === undefined) await rm(damagedPath);
  else await writeFile(damagedPath, original);
  await exec(process.execPath, grow, { timeout: 60_000 });
  assert.equal(decision(await readFile(harvestPath, "utf8")), "approved", "repair must not reopen the decision");
}

test("branch corruption preserves both garden documents and reviewed work across repair", { timeout: 120_000 }, async () => {
  await assertCorruptRefreshPreserves("branch");
});

test("HEAD corruption preserves both garden documents and reviewed work across repair", { timeout: 120_000 }, async () => {
  await assertCorruptRefreshPreserves("HEAD");
});
