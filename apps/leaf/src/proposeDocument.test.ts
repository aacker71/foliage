/**
 * `prepareProposedDocument` — THE SHARED STEP all three propose producers use (PR #17 review,
 * blockers 1 and 2). Unit tests of the function directly, with no subprocess involved.
 *
 * `foliageGarden.test.ts` drives the real CLI end to end and proves the binding survives a
 * real `propose`/`propose-photos`/`propose-brain` re-run. What belongs HERE is the one thing a
 * real CLI run cannot demonstrate deterministically: that this function's own read happens at
 * CALL TIME and not before it — the exact property blocker 2 restores. A real race needs two
 * concurrent processes and unpredictable timing; this function makes the same guarantee
 * checkable with two ordinary, sequential calls and a file mutation between them.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { prepareProposedDocument, queuedRepository } from "./proposeDocument.ts";
import { importObservationBatch, parseObservationBatch } from "./integrationImport.ts";
import { leafId } from "@foliage/leaf";
import { reviewSubjectDigest } from "@foliage/photosynthesis";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-prepare-proposed-"));
  tmpRoots.push(dir);
  return dir;
}

/** The freshly-drafted candidate a real propose command would hand this function, unreviewed. */
const CANDIDATE = {
  id: "git-cluster:feat",
  title: "feat: 2 commits",
  evidence: [{ source: "git", ref: "a".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
  extractor: "git-cluster",
  draftedAt: "2026-08-29T00:00:00.000Z",
  review: { state: "candidate" as const },
};

/** The commit CANDIDATE was drafted from, as the git producer hands it over. */
const COMMIT = { sha: "a".repeat(40), subject: "feat: one", authoredAt: "2026-08-28T12:00:00Z" };
const LATER = "2026-08-30T00:00:00.000Z";

test("unrelated proposals preserve explicitly imported snapshots and their review decisions", async () => {
  const out = join(await tempDir(), "harvest.json");
  const target = { id: leafId("adversarial-import-target"), subject: "Adversarial preservation input", leaflets: [] };
  const batch = parseObservationBatch({ format: "foliage-observations", version: 1,
    subject: { leafId: target.id, name: target.subject }, source: { provider: "adversarial-input", tenantId: null, accountId: "test" },
    completion: "complete", deletedRecordIds: [], observations: [{ recordId: "test", revision: "one", title: "Adversarial input",
      excerpt: "Preservation mechanism input", observedAt: "2026-09-08T00:00:00Z" }] });
  const imported = importObservationBatch(batch, target, null).document;
  const kept = { ...imported.candidates[0]!, review: { state: "rejected" as const, by: "Test harness", at: "2026-09-08T00:01:00Z", reason: "Adversarial test decision" } };
  await writeFile(out, JSON.stringify({ ...imported, repo: "/explicit/test/repository", candidates: [kept] }));
  const result = prepareProposedDocument({ mode: "carry", out, candidates: [CANDIDATE], target: undefined });
  assert.ok(result.ok);
  assert.deepEqual(result.document.candidates, [CANDIDATE, kept]);
  assert.equal(result.document.subject, target.subject); assert.equal(result.document.leafId, target.id);
  assert.equal(result.document.repo, "/explicit/test/repository"); assert.equal(result.carried, 1);
});

test("THE RACE, CLOSED: a call reads whatever is on disk AT CALL TIME, never a value cached from an earlier call (PR #17 review, blocker 2)", async () => {
  const dir = await tempDir();
  const out = join(dir, "harvest.json");

  // STATE A: unreviewed, bound to Subject/leaf-1 — as if an earlier propose had just written it.
  await writeFile(
    out,
    JSON.stringify({ subject: "Subject", leafId: "leaf-1", candidates: [CANDIDATE] }, null, 2),
    "utf8",
  );
  const first = prepareProposedDocument({ mode: "git", out, commits: [COMMIT], complete: true, present: new Set([COMMIT.sha]), heldExtra: new Set(), observedAt: LATER, target: undefined });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("unreachable");
  assert.equal(first.document.candidates[0]?.review.state, "candidate");

  // THE WINDOW: standing in for a real propose command's slow phase (a git read;
  // --draft-with-local-model, measured 33-180s) — during which a decision is recorded
  // elsewhere. The web review panel approving the EXACT candidate a real propose run is
  // mid-redraft of is the concrete scenario the review named.
  const approvedElsewhere = {
    ...CANDIDATE,
    review: { state: "approved" as const, by: "Reviewer", at: "2026-08-29T00:05:00.000Z" },
  };
  await writeFile(
    out,
    JSON.stringify({ subject: "Subject", leafId: "leaf-1", candidates: [approvedElsewhere] }, null, 2),
    "utf8",
  );

  // THE SECOND CALL stands in for the point in a real propose command where the slow work has
  // JUST finished and this function is about to run, immediately before the write. A stale read
  // here — one taken before the window, or a value cached from the FIRST call above — would
  // silently revert the approval that was just recorded the moment the caller writes.
  const second = prepareProposedDocument({ mode: "git", out, commits: [COMMIT], complete: true, present: new Set([COMMIT.sha]), heldExtra: new Set(), observedAt: LATER, target: undefined });
  assert.equal(second.ok, true);
  if (!second.ok) throw new Error("unreachable");
  assert.equal(
    second.document.candidates[0]?.review.state,
    "approved",
    "the SECOND call must read the mutation made after the first — a stale read would silently revert it",
  );
  assert.equal(second.carried, 1, "the approval recorded during the window must be CARRIED, not lost");
  // And the binding rode along unchanged — this is a candidate-decision race, not a binding one.
  assert.equal(second.document.subject, "Subject");
  assert.equal(second.document.leafId, "leaf-1");
});

test("no target, and an existing binding: it is carried forward and flagged as PRESERVED", async () => {
  const dir = await tempDir();
  const out = join(dir, "harvest.json");
  await writeFile(
    out,
    JSON.stringify({ subject: "Alice", leafId: "leaf-alice", candidates: [] }, null, 2),
    "utf8",
  );

  const result = prepareProposedDocument({ mode: "carry", out, candidates: [CANDIDATE], target: undefined });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.document.subject, "Alice");
  assert.equal(result.document.leafId, "leaf-alice");
  assert.deepEqual(result.bindingPreservedWithoutTarget, { subject: "Alice", leafId: "leaf-alice" });
});

test("a target AGREEING with the existing binding: no disagreement, the target's own values are recorded, and nothing is flagged as merely preserved", async () => {
  const dir = await tempDir();
  const out = join(dir, "harvest.json");
  await writeFile(
    out,
    JSON.stringify({ subject: "Alice", leafId: "leaf-alice", candidates: [] }, null, 2),
    "utf8",
  );

  const result = prepareProposedDocument({
    mode: "carry",
    out,
    candidates: [CANDIDATE],
    target: { subject: "Alice", id: "leaf-alice" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.document.subject, "Alice");
  assert.equal(result.document.leafId, "leaf-alice");
  // THIS run gave --into, so it SET the binding rather than merely carrying one forward — the
  // caller's "binding preserved" print belongs only to the --into-less path.
  assert.equal(result.bindingPreservedWithoutTarget, null);
});

test("a target DISAGREEING with the existing binding: refused by name, both values carried in the result, nothing built", async () => {
  const dir = await tempDir();
  const out = join(dir, "harvest.json");
  await writeFile(
    out,
    JSON.stringify({ subject: "Alice", leafId: "leaf-alice", candidates: [] }, null, 2),
    "utf8",
  );

  const result = prepareProposedDocument({
    mode: "carry",
    out,
    candidates: [CANDIDATE],
    target: { subject: "Bob", id: "leaf-bob" },
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.cause, "rebind-disagreement");
  assert.deepEqual(result.existing, { subject: "Alice", leafId: "leaf-alice" });
  assert.deepEqual(result.attempted, { subject: "Bob", id: "leaf-bob" });
});

test("a target agreeing on subject but disagreeing on leaf id alone still refuses — a leaf can be renamed without its id changing", async () => {
  const dir = await tempDir();
  const out = join(dir, "harvest.json");
  await writeFile(
    out,
    JSON.stringify({ subject: "Alice", leafId: "leaf-old", candidates: [] }, null, 2),
    "utf8",
  );

  const result = prepareProposedDocument({
    mode: "carry",
    out,
    candidates: [CANDIDATE],
    target: { subject: "Alice", id: "leaf-new" },
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.cause, "rebind-disagreement");
});

test("the recorded repository is carried when this producer has none, and replaced when it has one", async () => {
  // THE DOCUMENTED SEQUENCE: `grow` records the repository, then `propose-photos --force` on the
  // same harvest — a producer with no repository — must not erase it, or the next `grow` falls into
  // the one window its guard cannot close and a different repository's harvest replaces the queue
  // unchecked. Found by the round-3 seams pass: dropping the carry left the whole gate green.
  const dir = await tempDir();
  const out = join(dir, "harvest.json");
  await writeFile(out, JSON.stringify({ repo: "/work/mine", candidates: [CANDIDATE] }, null, 2), "utf8");

  const carried = prepareProposedDocument({ mode: "carry", out, candidates: [CANDIDATE], target: undefined });
  assert.equal(carried.ok, true);
  if (!carried.ok) throw new Error("unreachable");
  assert.equal(carried.document.repo, "/work/mine", "a producer with no repository must carry the recorded one");

  const replaced = prepareProposedDocument({ mode: "carry", out, candidates: [CANDIDATE], target: undefined, repo: "/work/theirs" });
  assert.equal(replaced.ok, true);
  if (!replaced.ok) throw new Error("unreachable");
  assert.equal(replaced.document.repo, "/work/theirs", "this run's own repository wins over the recorded one");
});

test("the queue's repository is guarded for a draft still waiting for a decision, not only for a decision", async () => {
  // `harvest.mjs propose` refuses another repository's run on this answer. A waiting git draft is
  // withdrawn by the git merge when the other repository does not hold its commits, so it counts.
  const out = join(await tempDir(), "harvest.json");
  await writeFile(out, JSON.stringify({ repo: "/work/mine", candidates: [CANDIDATE] }), "utf8");
  assert.deepEqual(queuedRepository(out), { repo: "/work/mine", decided: [], waiting: ["git-cluster:feat"], refs: ["a".repeat(40)] });
  const approved = {
    ...CANDIDATE,
    id: "git-cluster:docs",
    evidence: [{ ...CANDIDATE.evidence[0]!, ref: "b".repeat(40) }],
    review: { state: "approved" as const, by: "Reviewer", at: LATER },
  };
  await writeFile(out, JSON.stringify({ repo: "/work/mine", candidates: [CANDIDATE, approved] }), "utf8");
  // The commits the waiting drafts name, not the decided work's: a queue with no decision is what a
  // moved repository is judged by (`queueRepositoryMatch`).
  assert.deepEqual(queuedRepository(out), {
    repo: "/work/mine",
    decided: ["git-cluster:docs"],
    waiting: ["git-cluster:feat"],
    refs: ["a".repeat(40)],
  });
  // Nothing to replace, or no record of where it came from: nothing to guard.
  await writeFile(out, JSON.stringify({ repo: "/work/mine", candidates: [] }), "utf8");
  assert.equal(queuedRepository(out), null);
  await writeFile(out, JSON.stringify({ candidates: [CANDIDATE] }), "utf8");
  assert.equal(queuedRepository(out), null);
});

test("no existing document at all: unbound, nothing preserved, and a fresh --into simply sets the binding", async () => {
  const dir = await tempDir();
  const out = join(dir, "harvest.json"); // never written

  const unbound = prepareProposedDocument({ mode: "carry", out, candidates: [CANDIDATE], target: undefined });
  assert.equal(unbound.ok, true);
  if (!unbound.ok) throw new Error("unreachable");
  assert.equal(unbound.document.subject, undefined);
  assert.equal(unbound.document.leafId, undefined);
  assert.equal(unbound.bindingPreservedWithoutTarget, null);

  const bound = prepareProposedDocument({
    mode: "carry",
    out,
    candidates: [CANDIDATE],
    target: { subject: "Alice", id: "leaf-alice" },
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) throw new Error("unreachable");
  assert.equal(bound.document.subject, "Alice");
  assert.equal(bound.document.leafId, "leaf-alice");
});

/* ------------------------------------------------ git: an approval stands (decision 4) ---- */

test("GIT: a decided candidate's digest never changes across a propose, and new material comes back under the next generation", async () => {
  const out = join(await tempDir(), "harvest.json");
  const approved = {
    ...CANDIDATE,
    review: { state: "approved" as const, by: "Reviewer", at: "2026-08-29T00:05:00.000Z" },
  };
  const digest = reviewSubjectDigest(approved);
  await writeFile(out, JSON.stringify({ repo: "/work/mine", candidates: [{ ...approved, review: { ...approved.review, subjectDigest: digest } }] }), "utf8");

  const newer = { sha: "b".repeat(40), subject: "feat: two", authoredAt: "2026-08-29T12:00:00Z" };
  const result = prepareProposedDocument({ mode: "git", out, commits: [newer, COMMIT], complete: true, present: new Set([newer.sha, COMMIT.sha]), heldExtra: new Set(), observedAt: LATER, target: undefined });
  assert.ok(result.ok);
  const kept = result.document.candidates.find((c) => c.id === "git-cluster:feat");
  assert.ok(kept);
  assert.equal(kept.review.state, "approved");
  assert.equal(reviewSubjectDigest(kept), digest, "the approved material is exactly what was approved");
  assert.equal((kept.review as { subjectDigest?: string }).subjectDigest, digest);
  const next = result.document.candidates.find((c) => c.id === "git-cluster:feat:2");
  assert.ok(next, "the new commit must come back as its own draft");
  assert.deepEqual(next.evidence.map((e) => e.ref), [newer.sha]);
  assert.deepEqual(result.reopened, [], "nothing is reopened");
  assert.deepEqual(result.drafted, ["git-cluster:feat:2"]);
  assert.equal(result.carried, 1);
  assert.equal(result.held, 1);
});

test("CARRY: a photo refresh over a harvest holding git drafts keeps every one of them", async () => {
  const out = join(await tempDir(), "harvest.json");
  const git = prepareProposedDocument({ mode: "git", out, commits: [COMMIT], complete: true, present: new Set([COMMIT.sha]), heldExtra: new Set(), observedAt: LATER, target: undefined, repo: "/work/mine" });
  assert.ok(git.ok);
  await writeFile(out, JSON.stringify(git.document), "utf8");

  const photo = {
    id: `photo:sha256:${"c".repeat(64)}`,
    title: "Synthetic image input",
    evidence: [{ source: "photo", ref: `sha256:${"c".repeat(64)}`, observedAt: LATER }],
    extractor: "photo-scan",
    draftedAt: LATER,
    review: { state: "candidate" as const },
  };
  const refreshed = prepareProposedDocument({ mode: "carry", out, candidates: [photo], target: undefined });
  assert.ok(refreshed.ok);
  assert.deepEqual(refreshed.document.candidates, [photo, ...git.document.candidates]);
  assert.equal(refreshed.document.repo, "/work/mine");
});
