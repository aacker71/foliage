/**
 * `readQueueCommits`, `sameRepository`, `checkoutPresence`, `commitsHeld` and `queueRepositoryMatch` against REAL
 * throwaway repositories. Every commit here is synthetic input written by this file; no real history is read.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { checkoutPresence, commitsHeld, queueRepositoryMatch, readQueueCommits, sameRepository } from "./gitQueueSource.ts";

const exec = promisify(execFile);
const MINE = "queue-source@example.test";
const THEIRS = "someone-else@example.test";

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix = "foliage-queue-source-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

const git = (repo: string, ...args: string[]) => exec("git", ["-C", repo, ...args], { timeout: 30_000 });

async function commit(repo: string, email: string, subject: string, date: string): Promise<string> {
  const file = `f-${Math.random().toString(16).slice(2)}.txt`;
  await writeFile(join(repo, file), subject, "utf8");
  await git(repo, "add", file);
  await exec("git", ["-C", repo, "-c", "user.name=Queue Source", "-c", `user.email=${email}`, "commit", "-q", "--no-gpg-sign", "-m", subject],
    { timeout: 30_000, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return (await git(repo, "rev-parse", "HEAD")).stdout.trim();
}

async function repoWithHistory(): Promise<{ repo: string; mine: string; branch: string; theirs: string }> {
  const repo = await tempDir();
  await git(repo, "init", "--quiet", "--initial-branch=main");
  const mine = await commit(repo, MINE, "feat: synthetic main input", "2026-08-01T10:00:00+02:00");
  const theirs = await commit(repo, THEIRS, "feat: someone else's input", "2026-08-02T10:00:00Z");
  await git(repo, "checkout", "-q", "-b", "side");
  const branch = await commit(repo, MINE, "fix: synthetic branch input", "2026-08-03T10:00:00Z");
  await git(repo, "checkout", "-q", "main");
  return { repo, mine, branch, theirs };
}

test("readQueueCommits: every local branch, attributed by the domain, each with git's author date", async () => {
  const { repo, mine, branch, theirs } = await repoWithHistory();
  const read = await readQueueCommits(repo, [MINE]);
  assert.ok(read.ok, JSON.stringify(read));
  assert.equal(read.read, 3);
  assert.equal(read.complete, true);
  assert.equal(read.datesUnreadBecause, null);
  const bySha = new Map(read.commits.map((c) => [c.sha, c]));
  assert.deepEqual([...bySha.keys()].sort(), [mine, branch].sort(), "the branch commit is read; the other author's is not drafted");
  assert.equal(Date.parse(bySha.get(mine)!.authoredAt!), Date.parse("2026-08-01T10:00:00+02:00"));
  assert.equal(bySha.get(branch)!.subject, "fix: synthetic branch input");
  assert.deepEqual(read.theirs.map((c) => c.sha), [theirs]);
});

test("readQueueCommits: one broken branch ref makes the read INCOMPLETE and says why", async () => {
  // `complete` is what harvest.mjs propose refuses a --force refresh on, so it is pinned here.
  const { repo, mine } = await repoWithHistory();
  await git(repo, "branch", "broken");
  await writeFile(join(repo, ".git", "refs", "heads", "broken"), `${"0".repeat(39)}1\n`, "utf8");
  const read = await readQueueCommits(repo, [MINE]);
  assert.ok(read.ok, JSON.stringify(read));
  assert.equal(read.complete, false);
  assert.notEqual(read.narrowedBecause, null);
  assert.ok(read.commits.some((c) => c.sha === mine), "the intact HEAD history is still read");
});

test("readQueueCommits: a failed read is a named failure, never an empty queue", async () => {
  const read = await readQueueCommits(join(await tempDir(), "missing"), [MINE]);
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.cause, "read-failed");
});

test("readQueueCommits: no identity is refused by the domain, not read as nobody's work", async () => {
  const { repo } = await repoWithHistory();
  const read = await readQueueCommits(repo, []);
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.cause, "attribution-refused");
});

test("sameRepository: a path, a worktree and a separate clone match; an unrelated repository does not", async () => {
  const { repo } = await repoWithHistory();
  assert.deepEqual(await sameRepository(repo, join(repo, ".")), { kind: "same", by: "git-dir" });

  const worktree = join(await tempDir("foliage-queue-worktree-"), "wt");
  await git(repo, "worktree", "add", "-q", worktree, "side");
  assert.deepEqual(await sameRepository(repo, worktree), { kind: "same", by: "git-dir" });

  const clone = join(await tempDir("foliage-queue-clone-"), "clone");
  await exec("git", ["clone", "-q", repo, clone], { timeout: 30_000 });
  assert.deepEqual(await sameRepository(repo, clone), { kind: "same", by: "root-commit" });

  const other = await tempDir();
  await git(other, "init", "--quiet", "--initial-branch=main");
  await commit(other, MINE, "feat: unrelated input", "2026-08-05T10:00:00Z");
  assert.deepEqual(await sameRepository(repo, other), { kind: "different" });

  const unreadable = await sameRepository(repo, join(other, "missing"));
  assert.equal(unreadable.kind, "unreadable");
});

/** A repository, and a clone of it whose own commit sits on a side branch only the clone has. */
async function cloneWithOwnWork(): Promise<{ repo: string; clone: string; shared: string; cloneOnly: string }> {
  const { repo, mine: shared } = await repoWithHistory();
  const clone = join(await tempDir("foliage-queue-presence-"), "clone");
  await exec("git", ["clone", "-q", repo, clone], { timeout: 30_000 });
  await git(clone, "checkout", "-q", "-b", "clone-side");
  const cloneOnly = await commit(clone, THEIRS, "fix: only in the clone", "2026-08-04T10:00:00Z");
  await git(clone, "checkout", "-q", "main");
  return { repo, clone, shared, cloneOnly };
}

test("checkoutPresence: an enabled clone of the repository holds its own commits, whoever made them", async () => {
  const { repo, clone, shared, cloneOnly } = await cloneWithOwnWork();
  const presence = await checkoutPresence(repo, [{ path: clone, enabled: true }]);
  assert.equal(presence.complete, true);
  assert.ok(presence.present.includes(cloneOnly));
  assert.ok(presence.present.includes(shared));
});

test("checkoutPresence: a checkout of another repository proves nothing either way", async () => {
  const { repo } = await repoWithHistory();
  const other = await tempDir();
  await git(other, "init", "--quiet", "--initial-branch=main");
  await commit(other, MINE, "feat: unrelated input", "2026-08-05T10:00:00Z");
  for (const enabled of [true, false]) assert.deepEqual(await checkoutPresence(repo, [{ path: other, enabled }]), { present: [], complete: true });
});

test("checkoutPresence: a paused clone is not read, and leaves absence unproven", async () => {
  const { repo, clone } = await cloneWithOwnWork();
  assert.deepEqual(await checkoutPresence(repo, [{ path: clone, enabled: false }]), { present: [], complete: false });
});

test("checkoutPresence: an enabled clone that cannot be checked leaves absence unproven", async () => {
  const { repo, clone } = await cloneWithOwnWork();
  await rename(clone, `${clone}.moved`);
  assert.deepEqual(await checkoutPresence(repo, [{ path: clone, enabled: true }]), { present: [], complete: false });
});

test("checkoutPresence: an enabled clone whose history read fails leaves absence unproven", async () => {
  const { repo, clone } = await cloneWithOwnWork();
  // A git on PATH that refuses only the clone's history read; its repository check still answers.
  const bin = await tempDir("foliage-queue-presence-bin-");
  const realGit = `${(await exec("git", ["--exec-path"])).stdout.trim()}/git`;
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, "git"),
    `#!/bin/sh\nfor a in "$@"; do [ "$a" = ${JSON.stringify(clone)} ] && for b in "$@"; do [ "$b" = "--is-inside-work-tree" ] && exit 1; done; done\nexec ${JSON.stringify(realGit)} "$@"\n`,
  );
  await chmod(join(bin, "git"), 0o755);
  assert.equal((await sameRepository(clone, repo)).kind, "same");
  const path = process.env["PATH"];
  process.env["PATH"] = `${bin}${delimiter}${path}`;
  try {
    assert.equal((await sameRepository(clone, repo)).kind, "same", "the shim leaves the repository check answering");
    assert.deepEqual(await checkoutPresence(repo, [{ path: clone, enabled: true }]), { present: [], complete: false });
  } finally {
    process.env["PATH"] = path;
  }
});

test("checkoutPresence: a narrowed walk of an enabled clone is not all it holds", async () => {
  const { repo, clone, shared, cloneOnly } = await cloneWithOwnWork();
  await git(clone, "branch", "broken");
  await writeFile(join(clone, ".git", "refs", "heads", "broken"), `${"0".repeat(39)}1\n`, "utf8");
  const presence = await checkoutPresence(repo, [{ path: clone, enabled: true }]);
  assert.equal(presence.complete, false);
  assert.ok(presence.present.includes(shared), "the intact HEAD history is still read");
  assert.ok(!presence.present.includes(cloneOnly), "the side branch was not read");
});

test("checkoutPresence: one unproven checkout makes the whole answer unproven, and nothing read is lost", async () => {
  const { repo, clone, cloneOnly } = await cloneWithOwnWork();
  const presence = await checkoutPresence(repo, [{ path: clone, enabled: true }, { path: join(clone, "missing"), enabled: true }]);
  assert.equal(presence.complete, false);
  assert.ok(presence.present.includes(cloneOnly));
});

test("commitsHeld: the refs a repository holds as commits, one no branch reaches included; null when git does not answer", async () => {
  const { repo, mine, branch, theirs } = await repoWithHistory();
  const other = await tempDir();
  await git(other, "init", "--quiet", "--initial-branch=main");
  const foreign = await commit(other, MINE, "feat: another repository's input", "2026-08-05T10:00:00Z");
  const tree = (await git(repo, "rev-parse", "HEAD^{tree}")).stdout.trim();
  // A rewrite leaves the commit behind, still held: `git show` still shows it.
  await git(repo, "branch", "-D", "--quiet", "side");
  const held = await commitsHeld(repo, [mine, branch, theirs.slice(0, 12), foreign, tree, "main", "not-a-sha"]);
  assert.deepEqual(held === null ? null : [...held].sort(), [mine, branch, theirs.slice(0, 12)].sort(),
    "another repository's commit, a tree, a branch name and a non-sha are not held commits");
  assert.deepEqual(await commitsHeld(repo, []), new Set(), "nothing asked, git not started");
  assert.equal(await commitsHeld(join(other, "missing"), [mine]), null, "no answer is not an answer of absent");
});

test("commitsHeld: a partial clone is asked without fetching, so a commit only its remote holds is not held and stays unfetched", async () => {
  // MEASURED: `cat-file --batch-check` in a `--filter=blob:none` clone, asked for an object it lacks,
  // lazily ran `git fetch origin` against the promisor remote. The refs asked about are often another
  // repository's by design, so that was a network fetch the local-only rule forbids.
  const { repo } = await repoWithHistory();
  await git(repo, "config", "uploadpack.allowFilter", "true");
  const clone = join(await tempDir("foliage-queue-partial-"), "clone");
  await exec("git", ["clone", "-q", "--filter=blob:none", `file://${repo}`, clone], { timeout: 30_000 });
  assert.equal((await git(clone, "config", "remote.origin.promisor")).stdout.trim(), "true", "the fixture is a partial clone");
  const later = await commit(repo, MINE, "feat: only the remote holds this", "2026-08-06T10:00:00Z");
  assert.deepEqual(await commitsHeld(clone, [later]), new Set());
  await assert.rejects(
    exec("git", ["-C", clone, "cat-file", "-e", later], { timeout: 30_000, env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } }),
    "nothing was fetched into the clone",
  );
});

test("queueRepositoryMatch: a queue with no decision whose repository moved is judged by its drafts' commits, and only then", async () => {
  const { repo, mine, branch } = await repoWithHistory();
  const moved = `${repo}.moved`;
  roots.push(moved);
  await rename(repo, moved);
  assert.equal((await sameRepository(repo, moved)).kind, "unreadable", "the recorded folder is gone");
  const waiting = { decided: 0, refs: [mine, branch] };
  assert.deepEqual(await queueRepositoryMatch(repo, moved, waiting), { kind: "same", by: "queue-commits" });
  // A queue holding a decision is refused as the RC refuses it, whatever the commits say.
  assert.equal((await queueRepositoryMatch(repo, moved, { ...waiting, decided: 1 })).kind, "unreadable");

  // A copy missing one of the queue's commits is not judged the same; neither is another repository.
  const copy = join(await tempDir("foliage-queue-copy-"), "copy");
  await exec("git", ["clone", "-q", "--no-local", "--single-branch", "--branch", "main", moved, copy], { timeout: 30_000 });
  const other = await tempDir();
  await git(other, "init", "--quiet", "--initial-branch=main");
  await commit(other, MINE, "feat: unrelated input", "2026-08-05T10:00:00Z");
  for (const path of [copy, other]) {
    const match = await queueRepositoryMatch(repo, path, waiting);
    assert.equal(match.kind, "unreadable", path);
    assert.match(match.kind === "unreadable" ? match.detail : "", /does not hold every commit in the queue/, path);
  }
  assert.equal((await queueRepositoryMatch(repo, moved, { decided: 0, refs: [] })).kind, "unreadable", "no commits, nothing to judge by");
  // A recorded repository that can be read is answered as before, never by the queue.
  assert.deepEqual(await queueRepositoryMatch(moved, other, waiting), { kind: "different" });
  assert.deepEqual(await queueRepositoryMatch(moved, copy, { decided: 1, refs: [] }), { kind: "same", by: "root-commit" });
});
