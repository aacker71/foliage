/**
 * THE COLLECTOR FILLS THE ONE REVIEW QUEUE. Every test here runs real git in a temp repository
 * and a temp harvest; the commits are synthetic test records, never anyone's work, and everything
 * is deleted. Collection writes harvest.json through the same merge `foliage grow` uses, so an
 * approval stands and new commits come back as their own draft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir, rename, chmod, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHarvestDocument, queuePaused, reviewSubjectDigest, type HarvestDocument } from "@foliage/photosynthesis";
import { openWorkflow, nextWorkflowRun, readShortfall } from "./workflow.ts";

const schedule = {
  cadence: "daily" as const,
  day: "Monday",
  time: "09:00",
  timezone: "America/Denver",
  quiet: true,
  start: "18:00",
  end: "08:00",
  paused: false,
};
const awake = { ...schedule, quiet: false };
const EMAIL = "workflow@foliage.invalid";
const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));

test("calendar cadence handles DST and quiet windows without a second daily run", () => {
  assert.equal(
    nextWorkflowRun(schedule, new Date("2026-03-07T17:00:00Z")),
    "2026-03-08T15:00:00.000Z",
  );
  assert.equal(
    nextWorkflowRun(
      { ...schedule, time: "01:30", quiet: false },
      new Date("2026-11-01T07:30:00Z"),
    ),
    "2026-11-02T08:30:00.000Z",
  );
  assert.equal(
    nextWorkflowRun(
      { ...schedule, time: "06:00" },
      new Date("2026-09-05T17:00:00Z"),
    ),
    "2026-09-06T14:00:00.000Z",
  );
});

/** A temp repository whose commits are synthetic records for one test. */
async function repository(dir: string, name = "repo") {
  const repo = join(dir, name);
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.email", EMAIL);
  git("config", "user.name", "Workflow collector test");
  let n = 0;
  const commit = async (subject: string, at?: string) => {
    n++;
    await writeFile(join(repo, `record-${n}.txt`), `synthetic record ${n}\n`);
    git("add", `record-${n}.txt`);
    execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", subject], {
      env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}) },
    });
    return git("rev-parse", "HEAD");
  };
  return { repo, git, commit };
}

async function readQueue(path: string): Promise<HarvestDocument> {
  const parsed = parseHarvestDocument(JSON.parse(await readFile(path, "utf8")));
  assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.issues));
  return parsed.harvest;
}
const refsOf = (h: HarvestDocument) => h.candidates.flatMap((c) => c.evidence.map((e) => e.ref));
const openIds = (h: HarvestDocument) => h.candidates.filter((c) => c.review.state === "candidate").map((c) => String(c.id)).sort();

/** Approve one candidate the way /review does: its current digest, a named reviewer. */
function approve(harvestPath: string, id: string, digest: string) {
  execFileSync(process.execPath, [HARVEST_CLI, "approve", id, "--by", "Collector Test", "--doc", harvestPath, "--expect-subject-digest", digest], { stdio: "pipe" });
}

test("collection fills the harvest; pauses, quiet hours, failures and restart are durable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-"));
  const { repo, git, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  const first = await commit("feat: exercise the collector");
  let app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await assert.rejects(openWorkflow(join(dir, "state")), /another process/);
    await assert.rejects(app.command({ action: "source", path: repo, email: EMAIL }), /authorization/);
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule });
    // Quiet hours hold the schedule: a due pass at 19:00 Denver waits and leaves no trace.
    await app.tick(new Date(Date.parse(app.snapshot().nextAt!) + 10 * 3_600_000));
    assert.equal(app.snapshot().history.length, 0);
    await assert.rejects(readFile(harvestPath), /ENOENT/);
    // The owner's Collect now at 06:00 Denver, inside the same quiet hours, still runs.
    await app.tick(new Date("2026-09-05T12:00:00Z"), true);
    assert.deepEqual([app.snapshot().history[0]!.at, app.snapshot().history[0]!.run!.trigger], ["2026-09-05T12:00:00.000Z", "manual"]);
    await app.command({ action: "schedule", schedule: awake });
    const queued = await readQueue(harvestPath);
    assert.deepEqual(refsOf(queued), [first]);
    assert.deepEqual(openIds(queued), ["git-cluster:feat"]);
    assert.equal(queued.repo, execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
    assert.equal(app.snapshot().history[0]!.status, "review-ready");
    assert.deepEqual(app.snapshot().history[0]!.run!.sources[0]!.packets, ["git-cluster:feat"]);
    assert.equal(app.snapshot().proposals.length, 0, "collection makes no packets");
    assert.equal("review" in app.snapshot(), false, "the workflow keeps no second review list");
    assert.equal(app.snapshot().sources[0]!.head, git("rev-parse", "HEAD"), "the read's head is recorded");

    // An unchanged repository leaves the queue byte-identical, and never rewrites it.
    const bytes = await readFile(harvestPath, "utf8");
    const written = await stat(harvestPath);
    await app.tick(new Date(), true);
    assert.equal(await readFile(harvestPath, "utf8"), bytes);
    const after = await stat(harvestPath);
    assert.deepEqual([after.ino, after.mtimeMs], [written.ino, written.mtimeMs], "no write for an unchanged queue");
    assert.equal(app.snapshot().history[0]!.status, "unchanged");

    await app.close();
    app = await openWorkflow(join(dir, "state"), { harvestPath });
    await app.command({ action: "schedule", schedule: { ...awake, paused: true } });
    const count = app.snapshot().history.length;
    await assert.rejects(app.tick(new Date(), true), /resume/);
    assert.equal(app.snapshot().history.length, count);
    await app.command({ action: "schedule", schedule: awake });
    const source = app.snapshot().sources[0]!;
    await rename(repo, repo + ".gone");
    await app.tick(new Date(), true);
    assert.ok(app.snapshot().sources[0]!.error);
    assert.equal(app.snapshot().sources[0]!.head, source.head);
    assert.equal(app.snapshot().history[0]!.status, "failed");
    const failedRun = app.snapshot().history[0]!.run!;
    assert.equal(failedRun.sources[0]!.status, "failed");
    assert.equal(failedRun.sources[0]!.error, app.snapshot().sources[0]!.error);
    assert.equal(failedRun.sources[0]!.from, source.head);
    assert.equal(await readFile(harvestPath, "utf8"), bytes, "a failed read changes nothing in the queue");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unavailable source retries five minutes on, the retry survives a restart, and the source recovers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-retry-"));
  const { repo, git, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  const first = await commit("feat: collected before the outage");
  let app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(app.snapshot().nextAt!));
    assert.deepEqual(refsOf(await readQueue(harvestPath)), [first]);
    await rename(repo, repo + ".unavailable");
    const failureAt = new Date(app.snapshot().nextAt!);
    await app.tick(failureAt);
    assert.equal(app.snapshot().attempt, 1);
    const retry = app.snapshot().nextAt!;
    assert.equal(Date.parse(retry) - failureAt.getTime(), 5 * 60_000);
    await app.close();
    app = await openWorkflow(join(dir, "state"), { harvestPath });
    assert.equal(app.snapshot().nextAt, retry);
    assert.equal(app.snapshot().history[0]!.run!.sources[0]!.status, "failed");
    await rename(repo + ".unavailable", repo);
    const later = await commit("fix: made while the source was away");
    await app.tick(new Date(Date.parse(retry) - 1));
    assert.deepEqual(refsOf(await readQueue(harvestPath)), [first], "not due yet: nothing collected");
    await app.tick(new Date(retry));
    assert.deepEqual([...refsOf(await readQueue(harvestPath))].sort(), [first, later].sort());
    assert.equal(app.snapshot().sources[0]!.error, undefined);
    assert.equal(app.snapshot().attempt, 0);
    assert.equal(app.snapshot().sources[0]!.head, git("rev-parse", "HEAD"));
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed state is never replaced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-state-"));
  try {
    await writeFile(join(dir, "workflow.json"), "{broken");
    await assert.rejects(openWorkflow(dir));
    assert.equal(await readFile(join(dir, "workflow.json"), "utf8"), "{broken");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("due windows catch up once and interrupted persisted runs recover on restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-recovery-"));
  const { repo, git, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  await commit("docs: record the recovery test");
  let app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    const due = new Date(Date.parse(app.snapshot().nextAt!) + 3 * 86400000);
    await app.tick(due);
    assert.equal(app.snapshot().history.length, 1);
    const trace = app.snapshot().history[0]!.run!;
    assert.equal(trace.trigger, "catch-up");
    assert.equal(trace.sources[0]!.status, "collected");
    assert.deepEqual(trace.sources[0]!.packets, ["git-cluster:docs"]);
    assert.equal(trace.sources[0]!.head, git("rev-parse", "HEAD"));
    assert.ok(trace.finishedAt);
    await app.tick(due);
    assert.equal(app.snapshot().history.length, 1);
    await app.close();
    const file = join(dir, "state/workflow.json");
    const persisted = JSON.parse(await readFile(file, "utf8"));
    persisted.running = true;
    await writeFile(file, JSON.stringify(persisted));
    app = await openWorkflow(join(dir, "state"), { harvestPath });
    assert.equal(app.snapshot().running, false);
    assert.equal(app.snapshot().history[0]!.status, "interrupted");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a first collection drafts every attributed commit, with no cap and nothing omitted (D3)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-all-"));
  const { repo, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  const shas: string[] = [];
  for (let i = 0; i < 30; i++) shas.push(await commit(`${["feat", "fix", "docs"][i % 3]}: synthetic record ${i}`, `2026-0${(i % 9) + 1}-10T10:00:00Z`));
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    const queued = await readQueue(harvestPath);
    assert.deepEqual([...refsOf(queued)].sort(), [...shas].sort(), "all thirty, each exactly once");
    assert.ok(queued.candidates.every((c) => c.evidence.every((e) => e.authoredAt !== undefined)), "every draft carries its author dates");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a branch switch, an amend and a rebase keep collecting with no source error (D4)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-history-"));
  const { repo, git, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  await commit("feat: the base record");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  const collect = async () => {
    await app.tick(new Date(), true);
    assert.equal(app.snapshot().sources[0]!.error, undefined, JSON.stringify(app.snapshot().history[0]));
    return readQueue(harvestPath);
  };
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await collect();
    git("checkout", "-q", "-b", "side");
    const side = await commit("feat: side branch record");
    git("checkout", "-q", "main");
    assert.ok(refsOf(await collect()).includes(side), "a branch that is not checked out is still read");
    const before = await commit("fix: a record about to be amended");
    git("commit", "-q", "--amend", "-m", "fix: the amended record");
    const amended = git("rev-parse", "HEAD");
    let queued = await collect();
    assert.ok(refsOf(queued).includes(amended));
    assert.ok(!refsOf(queued).includes(before), "an undecided draft follows the rewritten history");
    git("checkout", "-q", "side");
    git("rebase", "-q", "main");
    const rebased = git("rev-parse", "HEAD");
    queued = await collect();
    assert.ok(refsOf(queued).includes(rebased));
    assert.ok(!refsOf(queued).includes(side));
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("two clones and a worktree of one repository give one candidate set; another repository is named and not written (D5)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-clones-"));
  const { repo, git, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  await commit("feat: shared record one");
  await commit("feat: shared record two");
  const clone = join(dir, "clone");
  execFileSync("git", ["clone", "-q", repo, clone]);
  execFileSync("git", ["-C", clone, "config", "user.email", EMAIL]);
  execFileSync("git", ["-C", clone, "config", "user.name", "Workflow collector test"]);
  const worktree = join(dir, "worktree");
  git("worktree", "add", "-q", "-b", "wt", worktree);
  await writeFile(join(clone, "clone-only.txt"), "synthetic\n");
  execFileSync("git", ["-C", clone, "add", "clone-only.txt"]);
  execFileSync("git", ["-C", clone, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fix: only in the clone"]);
  const cloneOnly = execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const other = await repository(dir, "other");
  const otherSha = await other.commit("feat: a different project");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    for (const path of [repo, clone, worktree, other.repo]) await app.command({ action: "source", path, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    const refs = refsOf(await readQueue(harvestPath));
    assert.equal(new Set(refs).size, refs.length, "one commit lands in exactly one candidate");
    assert.equal(refs.length, 3);
    assert.ok(refs.includes(cloneOnly));
    assert.ok(!refs.includes(otherSha), "another repository's commits are never queued");
    const errors = new Map(app.snapshot().sources.map((s) => [s.path.split("/").at(-1)!, s.error]));
    for (const name of ["repo", "clone", "worktree"]) assert.equal(errors.get(name), undefined, name);
    assert.match(errors.get("other")!, /^Different repository/);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a queue whose only enabled checkout is another repository is never written, and says so", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-only-other-"));
  const { repo, commit } = await repository(dir);
  await commit("feat: this repository's undecided draft");
  const other = await repository(dir, "other");
  await other.commit("feat: a different project");
  const harvestPath = join(dir, "harvest.json");
  const state = join(dir, "state");
  let app = await openWorkflow(state, { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    assert.deepEqual(openIds(await readQueue(harvestPath)), ["git-cluster:feat"]);
    const bytes = await readFile(harvestPath, "utf8");
    await app.command({ action: "source", path: other.repo, email: EMAIL, authorized: true });
    await app.close();
    // Only the other repository's checkout is left in the settings: nothing it reads is this queue's.
    const saved = JSON.parse(await readFile(join(state, "workflow.json"), "utf8"));
    saved.sources = saved.sources.filter((s: { path: string }) => s.path.endsWith("/other"));
    await writeFile(join(state, "workflow.json"), JSON.stringify(saved));
    app = await openWorkflow(state, { harvestPath });
    await app.tick(new Date(), true);
    assert.equal(await readFile(harvestPath, "utf8"), bytes, "the undecided draft is not withdrawn by another repository's read");
    assert.match(app.snapshot().sources[0]!.error ?? "", /^Different repository/);
    assert.equal(app.snapshot().history[0]!.status, "failed");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a harvest that records no repository is never written, and says to adopt it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-unadopted-"));
  const { repo, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  await commit("feat: a record the queue must not take yet");
  const legacy = `${JSON.stringify({ candidates: [] }, null, 2)}\n`;
  await writeFile(harvestPath, legacy);
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    assert.equal(await readFile(harvestPath, "utf8"), legacy);
    assert.equal(app.snapshot().sources[0]!.error, "Queue not adopted · foliage migrate-queue");
    assert.equal(app.snapshot().history[0]!.status, "failed");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an approval stands through the collector: a new commit comes back as generation two (decision 4)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-stands-"));
  const { repo, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  await commit("feat: approved work", "2026-05-01T10:00:00Z");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    const drafted = (await readQueue(harvestPath)).candidates.find((c) => c.id === "git-cluster:feat")!;
    approve(harvestPath, "git-cluster:feat", reviewSubjectDigest(drafted));
    const approved = (await readQueue(harvestPath)).candidates.find((c) => c.id === "git-cluster:feat")!;
    const newer = await commit("feat: newer work", "2026-06-01T10:00:00Z");
    await app.tick(new Date(), true);
    const queued = await readQueue(harvestPath);
    assert.deepEqual(queued.candidates.find((c) => c.id === "git-cluster:feat"), approved, "the approval is untouched");
    assert.deepEqual(queued.candidates.find((c) => c.id === "git-cluster:feat:2")?.evidence.map((e) => e.ref), [newer]);
    assert.deepEqual(app.snapshot().history[0]!.run!.sources[0]!.packets, ["git-cluster:feat:2"]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("while another process holds the queue the collector leaves no trace, and the next pass collects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-busy-"));
  const { repo, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  const sha = await commit("feat: waiting for the lock");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  // A real second process holds the harvest lock, exactly as a /review decision or a grow would.
  const localFiles = fileURLToPath(new URL("../../../packages/leaf/src/localFiles.ts", import.meta.url));
  const holder = spawn(process.execPath, ["--input-type=module", "-e", `
    const { withDocumentLocks } = await import(${JSON.stringify(localFiles)});
    await withDocumentLocks([${JSON.stringify(harvestPath)}], () => new Promise((done) => { process.stdout.write("held\\n"); process.stdin.once("data", () => { process.stdin.pause(); done(undefined); }); }));
  `], { stdio: ["pipe", "pipe", "inherit"] });
  try {
    await new Promise<void>((resolve) => holder.stdout.once("data", () => resolve()));
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    const nextAt = app.snapshot().nextAt!;
    const collection = app.snapshot().collection;
    await app.tick(new Date(Date.parse(nextAt) + 1000));
    assert.deepEqual(app.snapshot().collection, collection, "the aborted run is not kept as the last collection");
    assert.deepEqual(JSON.parse(await readFile(join(dir, "state", "workflow.json"), "utf8")).collection, collection, "nor saved");
    assert.equal(app.snapshot().collection?.sources.some((s) => s.status === "reading") ?? false, false, "no source left reading");
    assert.equal(app.snapshot().history.length, 0, "no history line for a busy queue");
    assert.equal(app.snapshot().sources[0]!.error, undefined, "a busy queue is not a source error");
    assert.equal(app.snapshot().nextAt, nextAt, "still due, so the next pass tries again");
    assert.equal(app.snapshot().running, false);
    await assert.rejects(app.tick(new Date(), true), /Queue busy/);
    holder.stdin.end("release\n");
    await new Promise<void>((resolve) => holder.once("exit", () => resolve()));
    await app.tick(new Date(Date.parse(nextAt) + 31_000));
    assert.deepEqual(refsOf(await readQueue(harvestPath)), [sha]);
    assert.equal(app.snapshot().history[0]!.status, "review-ready");
  } finally {
    holder.kill();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("pausing every source pauses the queue view; removing the last source withdraws undecided drafts only (D6)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-remove-"));
  const { repo, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  await commit("feat: approved and kept");
  await commit("docs: undecided and withdrawn");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    const feat = (await readQueue(harvestPath)).candidates.find((c) => c.id === "git-cluster:feat")!;
    approve(harvestPath, "git-cluster:feat", reviewSubjectDigest(feat));
    const approved = (await readQueue(harvestPath)).candidates.find((c) => c.id === "git-cluster:feat")!;
    const id = app.snapshot().sources[0]!.id;
    assert.equal(queuePaused(app.snapshot().sources), false);
    const bytes = await readFile(harvestPath, "utf8");
    await app.command({ action: "source-toggle", id });
    assert.equal(queuePaused(app.snapshot().sources), true);
    assert.equal(await readFile(harvestPath, "utf8"), bytes, "pausing is a view, never a write");
    await app.command({ action: "source-toggle", id });
    await app.command({ action: "source-remove", id });
    const after = await readQueue(harvestPath);
    assert.deepEqual(after.candidates, [approved], "decided work stays; the undecided draft is withdrawn");
    assert.equal(queuePaused(app.snapshot().sources), false, "no sources is not a paused queue");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("commits an accepted or dismissed legacy packet holds are never drafted again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-legacy-"));
  const { repo, git, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  const accepted = await commit("feat: accepted in a legacy packet");
  const dismissed = await commit("feat: dismissed in a legacy packet");
  const pending = await commit("feat: pending in a legacy packet");
  const fresh = await commit("feat: never packeted");
  const path = git("rev-parse", "--show-toplevel");
  const packet = (id: string, sha: string, status: string) => ({
    id, source: "legacy-source", title: "Legacy packet", omitted: 0, status, updatedAt: "2026-08-01T00:00:00.000Z",
    evidence: [{ sha, title: "legacy", email: EMAIL }],
  });
  await mkdir(join(dir, "state"));
  await writeFile(join(dir, "state", "workflow.json"), JSON.stringify({
    version: 1, schedule: null, history: [], nextAt: null, attempt: 0, running: false,
    sources: [{ id: "legacy-source", path, email: EMAIL, enabled: true }],
    proposals: [packet("a", accepted, "accepted"), packet("d", dismissed, "dismissed"), packet("p", pending, "pending")],
  }));
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    assert.deepEqual([...refsOf(await readQueue(harvestPath))].sort(), [pending, fresh].sort());
    assert.equal(app.snapshot().proposals.length, 3, "legacy packets are carried as they were");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a draft grow made for another declared identity stays; one gone from the whole walk is withdrawn and said so", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-identities-"));
  const { repo, git, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  const OTHER = "workflow-other@foliage.invalid";
  await commit("feat: by the source identity");
  await writeFile(join(repo, "other.txt"), "synthetic\n");
  git("add", "other.txt");
  execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "docs: by another declared identity"], {
    env: { ...process.env, GIT_AUTHOR_EMAIL: OTHER, GIT_COMMITTER_EMAIL: OTHER },
  });
  execFileSync(process.execPath, [HARVEST_CLI, "propose", "--repo", repo, "--identity", EMAIL, "--identity", OTHER, "--out", harvestPath], { stdio: "pipe" });
  assert.deepEqual(openIds(await readQueue(harvestPath)), ["git-cluster:docs", "git-cluster:feat"]);
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    assert.deepEqual(openIds(await readQueue(harvestPath)), ["git-cluster:docs", "git-cluster:feat"], "a narrower identity read is not a removal");
    // The other identity's commit leaves every branch: now it is gone, and the run says so.
    git("reset", "-q", "--hard", "HEAD~1");
    await app.tick(new Date(), true);
    assert.deepEqual(openIds(await readQueue(harvestPath)), ["git-cluster:feat"]);
    const last = app.snapshot().history[0]!;
    assert.equal(last.status, "withdrawn");
    assert.equal(last.detail, "0 drafted · 1 withdrawn · 0 failed");
    assert.equal(last.run!.sources[0]!.status, "collected");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

/** Two checkouts of one repository, with one commit only the clone holds. */
async function twoCheckouts(dir: string) {
  const main = await repository(dir);
  await main.commit("feat: shared record");
  const clone = join(dir, "clone");
  execFileSync("git", ["clone", "-q", main.repo, clone]);
  execFileSync("git", ["-C", clone, "config", "user.email", EMAIL]);
  execFileSync("git", ["-C", clone, "config", "user.name", "Workflow collector test"]);
  await writeFile(join(clone, "clone-only.txt"), "synthetic\n");
  execFileSync("git", ["-C", clone, "add", "clone-only.txt"]);
  execFileSync("git", ["-C", clone, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fix: only in the clone"]);
  const cloneOnly = execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { ...main, clone, cloneOnly };
}
const openRefs = (h: HarvestDocument) => h.candidates.filter((c) => c.review.state === "candidate").flatMap((c) => c.evidence.map((e) => e.ref));

test("a checkout that cannot be read keeps the drafts only it holds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-unread-"));
  const { repo, clone, cloneOnly } = await twoCheckouts(dir);
  const harvestPath = join(dir, "harvest.json");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    for (const path of [repo, clone]) await app.command({ action: "source", path, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    assert.ok(openRefs(await readQueue(harvestPath)).includes(cloneOnly));
    await rename(clone, clone + ".gone");
    await app.tick(new Date(), true);
    const cloneSource = app.snapshot().sources.find((s) => s.path.endsWith("/clone"))!;
    assert.ok(cloneSource.error, "the unreadable checkout is named");
    assert.ok(openRefs(await readQueue(harvestPath)).includes(cloneOnly), "one failed checkout never empties the queue of its work");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a read that narrowed or left dates unread names each cause as a label", () => {
  const read = { ok: true, commits: [], theirs: [], read: 0, repoRoot: "/synthetic", head: null, complete: true, narrowedBecause: null, datesUnreadBecause: null } as const;
  assert.equal(readShortfall(read), undefined);
  assert.equal(readShortfall({ ...read, complete: false, narrowedBecause: "bad ref" }), "History narrowed · bad ref");
  assert.equal(readShortfall({ ...read, datesUnreadBecause: "log failed" }), "Dates unread · log failed");
  assert.equal(
    readShortfall({ ...read, complete: false, narrowedBecause: "bad ref", datesUnreadBecause: "log failed" }),
    "History narrowed · bad ref; Dates unread · log failed",
  );
});

test("a narrowed read keeps the drafts it could not see", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-narrow-"));
  const { repo, git, commit } = await repository(dir);
  const harvestPath = join(dir, "harvest.json");
  await commit("feat: on main");
  git("checkout", "-q", "-b", "side");
  const side = await commit("fix: only on a side branch");
  git("checkout", "-q", "main");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    assert.ok(openRefs(await readQueue(harvestPath)).includes(side));
    // One broken branch ref narrows the walk to HEAD: the side branch is no longer read.
    git("branch", "broken");
    await writeFile(join(repo, ".git", "refs", "heads", "broken"), `${"0".repeat(39)}1\n`);
    await app.tick(new Date(), true);
    assert.ok(openRefs(await readQueue(harvestPath)).includes(side), "work a narrowed read missed stays in the queue");
    const narrowed = /^History narrowed · /;
    assert.match(app.snapshot().sources[0]!.error ?? "", narrowed, "the source says why its read narrowed");
    const trace = app.snapshot().collection!.sources[0]!;
    assert.notEqual(trace.status, "failed", "a narrowed read still collected");
    assert.match(trace.error ?? "", narrowed, "the run says why the read narrowed");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("pausing one checkout of a repository keeps the drafts only it holds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-pause-one-"));
  const { repo, clone, cloneOnly } = await twoCheckouts(dir);
  const harvestPath = join(dir, "harvest.json");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    for (const path of [repo, clone]) await app.command({ action: "source", path, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    assert.ok(openRefs(await readQueue(harvestPath)).includes(cloneOnly));
    const cloneId = app.snapshot().sources.find((s) => s.path.endsWith("/clone"))!.id;
    await app.command({ action: "source-toggle", id: cloneId });
    await app.tick(new Date(), true);
    assert.ok(openRefs(await readQueue(harvestPath)).includes(cloneOnly), "pausing is never a delete");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("removing a source clears nothing while another checkout of the repository remains", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-remove-one-"));
  const { repo, clone } = await twoCheckouts(dir);
  const harvestPath = join(dir, "harvest.json");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    for (const path of [repo, clone]) await app.command({ action: "source", path, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    const bytes = await readFile(harvestPath, "utf8");
    assert.ok(openRefs(await readQueue(harvestPath)).length > 0);
    await app.command({ action: "source-remove", id: app.snapshot().sources.find((s) => s.path.endsWith("/clone"))!.id });
    assert.equal(await readFile(harvestPath, "utf8"), bytes);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("removing a source clears nothing while another checkout of the repository cannot be checked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-remove-unreadable-"));
  const { repo, clone } = await twoCheckouts(dir);
  const harvestPath = join(dir, "harvest.json");
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    for (const path of [repo, clone]) await app.command({ action: "source", path, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    const bytes = await readFile(harvestPath, "utf8");
    assert.ok(openRefs(await readQueue(harvestPath)).length > 0);
    await rename(clone, clone + ".gone");
    await app.command({ action: "source-remove", id: app.snapshot().sources.find((s) => s.path.endsWith("/repo"))!.id });
    assert.equal(await readFile(harvestPath, "utf8"), bytes, "an unavailable checkout proves nothing gone");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("removing another repository's source never clears this queue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-remove-other-"));
  const { repo, commit } = await repository(dir);
  await commit("feat: this repository's draft");
  const other = await repository(dir, "other");
  await other.commit("feat: a different project");
  const harvestPath = join(dir, "harvest.json");
  const state = join(dir, "state");
  let app = await openWorkflow(state, { harvestPath });
  try {
    for (const path of [repo, other.repo]) await app.command({ action: "source", path, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    const bytes = await readFile(harvestPath, "utf8");
    assert.ok(openRefs(await readQueue(harvestPath)).length > 0);
    const otherId = app.snapshot().sources.find((s) => s.path.endsWith("/other"))!.id;
    await app.command({ action: "source-remove", id: otherId });
    assert.equal(await readFile(harvestPath, "utf8"), bytes, "a same-repository checkout remains");
    // With this repository's checkout gone from the settings, the other one is all that is left.
    await app.command({ action: "source", path: other.repo, email: EMAIL, authorized: true });
    await app.close();
    const saved = JSON.parse(await readFile(join(state, "workflow.json"), "utf8"));
    saved.sources = saved.sources.filter((s: { path: string }) => s.path.endsWith("/other"));
    await writeFile(join(state, "workflow.json"), JSON.stringify(saved));
    app = await openWorkflow(state, { harvestPath });
    await app.command({ action: "source-remove", id: app.snapshot().sources[0]!.id });
    assert.equal(await readFile(harvestPath, "utf8"), bytes, "the removed checkout was never this queue's");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a harvest that is not JSON, or not a harvest, is named and never written", async () => {
  for (const [bytes, label] of [["{broken\n", /^Harvest is not JSON/], [`${JSON.stringify({ repo: "/synthetic", candidates: [{ id: 7 }] })}\n`, /^Harvest invalid/]] as const) {
    const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-corrupt-"));
    const { repo, commit } = await repository(dir);
    await commit("feat: a record with nowhere to go");
    const harvestPath = join(dir, "harvest.json");
    await writeFile(harvestPath, bytes);
    const app = await openWorkflow(join(dir, "state"), { harvestPath });
    try {
      await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
      await app.command({ action: "schedule", schedule: awake });
      await app.tick(new Date(), true);
      assert.match(app.snapshot().sources[0]!.error ?? "", label);
      assert.equal(app.snapshot().history[0]!.status, "failed");
      assert.equal(await readFile(harvestPath, "utf8"), bytes);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("a queue bound to a repository that cannot be checked is never written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-unchecked-"));
  const { repo, commit } = await repository(dir);
  await commit("feat: a record whose repository cannot be confirmed");
  const harvestPath = join(dir, "harvest.json");
  const bytes = `${JSON.stringify({ repo: join(dir, "moved-away"), candidates: [] }, null, 2)}\n`;
  await writeFile(harvestPath, bytes);
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    assert.match(app.snapshot().sources[0]!.error ?? "", /^Repository check failed/);
    assert.equal(await readFile(harvestPath, "utf8"), bytes);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a checkout whose repository cannot be confirmed keeps the drafts only it holds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-workflow-unconfirmed-"));
  const { repo, clone, cloneOnly } = await twoCheckouts(dir);
  const harvestPath = join(dir, "harvest.json");
  // A git on PATH that refuses only the root-commit query: the clone reads, its repository check fails.
  const bin = join(dir, "bin");
  await mkdir(bin);
  const realGit = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim() + "/git";
  await writeFile(join(bin, "git"), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--max-parents=0" ] && exit 1; done\nexec ${JSON.stringify(realGit)} "$@"\n`);
  await chmod(join(bin, "git"), 0o755);
  const app = await openWorkflow(join(dir, "state"), { harvestPath });
  const path = process.env["PATH"];
  try {
    for (const source of [repo, clone]) await app.command({ action: "source", path: source, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    await app.tick(new Date(), true);
    assert.ok(openRefs(await readQueue(harvestPath)).includes(cloneOnly));
    process.env["PATH"] = `${bin}${delimiter}${path}`;
    await app.tick(new Date(), true);
    process.env["PATH"] = path;
    const cloneSource = app.snapshot().sources.find((s) => s.path.endsWith("/clone"))!;
    assert.match(cloneSource.error ?? "", /^Repository check failed/);
    assert.ok(openRefs(await readQueue(harvestPath)).includes(cloneOnly), "an unconfirmed checkout's work is not proven gone");
  } finally {
    process.env["PATH"] = path;
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a paused, narrowed or unreadable checkout of another repository never keeps rewritten-away work queued (D4)", async () => {
  for (const other of ["paused", "narrowed", "unreadable"] as const) {
    const dir = await realpath(await mkdtemp(join(tmpdir(), `foliage-workflow-other-${other}-`)));
    const { repo, git, commit } = await repository(dir);
    await commit("feat: the base record");
    const second = await repository(dir, "other");
    await second.commit("feat: a different project");
    const harvestPath = join(dir, "harvest.json");
    // A git on PATH that refuses only the other repository's history read; its repository check still answers.
    const bin = join(dir, "bin");
    await mkdir(bin);
    const realGit = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim() + "/git";
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = ${JSON.stringify(second.repo)} ] && for b in "$@"; do [ "$b" = "--is-inside-work-tree" ] && exit 1; done; done\nexec ${JSON.stringify(realGit)} "$@"\n`,
    );
    await chmod(join(bin, "git"), 0o755);
    const path = process.env["PATH"];
    const app = await openWorkflow(join(dir, "state"), { harvestPath });
    const collect = async () => {
      if (other === "unreadable") process.env["PATH"] = `${bin}${delimiter}${path}`;
      try {
        await app.tick(new Date(), true);
      } finally {
        process.env["PATH"] = path;
      }
      const mine = app.snapshot().sources.find((s) => s.path === repo)!;
      assert.equal(mine.error, undefined, `${other}: ${JSON.stringify(app.snapshot().history[0])}`);
      return readQueue(harvestPath);
    };
    try {
      for (const source of [repo, second.repo]) await app.command({ action: "source", path: source, email: EMAIL, authorized: true });
      await app.command({ action: "schedule", schedule: awake });
      await collect();
      const otherSource = app.snapshot().sources.find((s) => s.path === second.repo)!;
      if (other === "paused") await app.command({ action: "source-toggle", id: otherSource.id });
      if (other === "narrowed") {
        second.git("branch", "broken");
        await writeFile(join(second.repo, ".git", "refs", "heads", "broken"), `${"0".repeat(39)}1\n`);
      }
      git("checkout", "-q", "-b", "side");
      const side = await commit("feat: side branch record");
      git("checkout", "-q", "main");
      const before = await commit("fix: a record about to be amended");
      assert.ok(refsOf(await collect()).includes(before), other);
      git("commit", "-q", "--amend", "-m", "fix: the amended record");
      const amended = git("rev-parse", "HEAD");
      let queued = await collect();
      if (other === "unreadable") assert.ok(app.snapshot().sources.find((s) => s.path === second.repo)!.error, "the unreadable checkout is named");
      assert.ok(refsOf(queued).includes(amended), other);
      assert.ok(!refsOf(queued).includes(before), `${other}: the amended-away commit is withdrawn`);
      git("checkout", "-q", "side");
      git("rebase", "-q", "main");
      const rebased = git("rev-parse", "HEAD");
      queued = await collect();
      assert.ok(refsOf(queued).includes(rebased), other);
      assert.ok(!refsOf(queued).includes(side), `${other}: the rebased-away commit is withdrawn`);
    } finally {
      process.env["PATH"] = path;
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("the checkout grow reads keeps what only it holds through a complete collection from another (D5)", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-workflow-grow-checkout-")));
  const { repo, clone, cloneOnly } = await twoCheckouts(dir);
  const cloneGit = (...args: string[]) => execFileSync("git", ["-C", clone, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
  const harvestPath = join(dir, "harvest.json");
  const state = join(dir, "state");
  const grow = () =>
    execFileSync(process.execPath, [HARVEST_CLI, "propose", "--repo", clone, "--identity", EMAIL, "--out", harvestPath, "--workflow", join(state, "workflow.json"), "--force"], { stdio: "pipe" });
  const app = await openWorkflow(state, { harvestPath });
  try {
    await app.command({ action: "source", path: repo, email: EMAIL, authorized: true });
    await app.command({ action: "schedule", schedule: awake });
    grow();
    assert.equal((await readQueue(harvestPath)).repo, clone, "the queue is bound to the checkout grow read");
    assert.ok(openRefs(await readQueue(harvestPath)).includes(cloneOnly));

    await app.tick(new Date(), true);
    assert.equal(app.snapshot().history[0]!.detail, "0 drafted · 0 withdrawn · 0 failed");
    assert.ok(openRefs(await readQueue(harvestPath)).includes(cloneOnly), "a commit still in the bound checkout is not gone");
    const settled = await readFile(harvestPath, "utf8");
    grow();
    assert.equal(await readFile(harvestPath, "utf8"), settled, "grow does not put back what collection took");
    await app.tick(new Date(), true);
    assert.equal(await readFile(harvestPath, "utf8"), settled, "and collection does not take it again");

    // A side branch only the bound checkout holds, then a broken ref narrows its walk.
    cloneGit("checkout", "-q", "-b", "side");
    await writeFile(join(clone, "side.txt"), "synthetic\n");
    cloneGit("add", "side.txt");
    cloneGit("commit", "-q", "-m", "docs: only on the clone side branch");
    const sideOnly = cloneGit("rev-parse", "HEAD");
    cloneGit("checkout", "-q", "main");
    grow();
    await app.tick(new Date(), true);
    assert.ok(openRefs(await readQueue(harvestPath)).includes(sideOnly));
    cloneGit("branch", "broken");
    await writeFile(join(clone, ".git", "refs", "heads", "broken"), `${"0".repeat(39)}1\n`);
    await app.tick(new Date(), true);
    assert.ok(openRefs(await readQueue(harvestPath)).includes(sideOnly), "a narrowed walk of the bound checkout proves nothing gone");

    // Gone from the bound checkout and every source: now it is withdrawn.
    await rm(join(clone, ".git", "refs", "heads", "broken"));
    cloneGit("branch", "-q", "-D", "side");
    await app.tick(new Date(), true);
    assert.ok(!openRefs(await readQueue(harvestPath)).includes(sideOnly));
    assert.equal(app.snapshot().history[0]!.detail, "0 drafted · 1 withdrawn · 0 failed");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
