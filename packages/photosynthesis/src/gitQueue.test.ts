import { test } from "node:test";
import assert from "node:assert/strict";

import { parseHarvestDocument, reviewSubjectDigest, type HarvestDocument } from "./harvestDocument.ts";
import {
  DRAFT_MAX_REFS,
  DRAFT_MAX_SUBJECT_BYTES,
  clusterBySubjectPrefix,
  composeDeterministicTitle,
  draftKey,
  gitLineage,
  mergeGitQueue,
  withoutUndecidedGitDrafts,
  type QueueCommit,
} from "./gitQueue.ts";

/**
 * Every commit and harvest here is a synthetic MERGE INPUT: made-up shas, subjects and dates that
 * pin one queue decision each. Nothing is read from a repository and nothing here is anyone's work.
 */

const observedAt = "2026-09-01T00:00:00Z";
const later = "2026-09-02T00:00:00Z";
const sha = (n: number): string => n.toString(16).padStart(40, "0");
const commit = (n: number, subject: string, authoredAt: string | null = `2026-08-${String((n % 28) + 1).padStart(2, "0")}T10:00:00Z`): QueueCommit =>
  ({ sha: sha(n), subject, authoredAt });

function harvestOf(candidates: readonly unknown[]): HarvestDocument {
  const parsed = parseHarvestDocument({ subject: "Synthetic", leafId: "leaf:synthetic", repo: "/synthetic/repo", candidates });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.harvest;
}

function valid(document: HarvestDocument): HarvestDocument {
  return harvestOf(JSON.parse(JSON.stringify(document)).candidates);
}

const merge = (previous: HarvestDocument | undefined, commits: readonly QueueCommit[], extra: Partial<Parameters<typeof mergeGitQueue>[0]> = {}) =>
  mergeGitQueue({ previous, commits, heldExtra: new Set(), observedAt: later, complete: true, ...extra });

const byId = (document: HarvestDocument, id: string) => document.candidates.find((c) => c.id === id);

/** A first propose: two docs commits, no previous document. */
const docsCommits = [commit(1, "docs: first page"), commit(2, "docs: second page")];

function decidedDocs(review: Record<string, unknown>): HarvestDocument {
  const first = merge(undefined, docsCommits).document;
  return harvestOf(
    JSON.parse(JSON.stringify(first)).candidates.map((c: Record<string, unknown>) => ({
      ...c,
      review: { ...review, subjectDigest: reviewSubjectDigest(c as never) },
    })),
  );
}

const APPROVED = { state: "approved", by: "Synthetic Reviewer", at: observedAt };
const REJECTED = { state: "rejected", by: "Synthetic Reviewer", at: observedAt, reason: "synthetic reason" };

/** A decided `git-cluster:docs` plus one new docs commit: the decision stands, the commit is generation 2. */
function assertDecisionStands(review: Record<string, unknown>): void {
  const previous = decidedDocs(review);
  const decided = byId(previous, "git-cluster:docs");
  assert.ok(decided, "the fixture must hold the decided lineage");

  const result = merge(previous, [commit(3, "docs: third page"), ...docsCommits]);
  const out = valid(result.document);

  assert.deepEqual(byId(out, "git-cluster:docs"), decided, "the decided candidate is frozen, byte for byte");
  assert.equal(reviewSubjectDigest(byId(out, "git-cluster:docs")!), reviewSubjectDigest(decided));
  const next = byId(out, "git-cluster:docs:2");
  assert.ok(next, "the new commit must come back as its own draft");
  assert.deepEqual(next.evidence.map((e) => e.ref), [sha(3)]);
  assert.equal(next.review.state, "candidate");
  assert.deepEqual(result.drafted, ["git-cluster:docs:2"]);
  assert.equal(result.held, 2);
  assert.equal(out.candidates.length, 2);
  // The document-level binding rides along untouched.
  assert.equal(out.subject, "Synthetic");
  assert.equal(out.repo, "/synthetic/repo");
}

test("AN APPROVAL STANDS: one new commit comes back as generation 2, holding only itself", () => {
  assertDecisionStands(APPROVED);
});

test("A REJECTION STANDS: one new commit comes back as generation 2, holding only itself", () => {
  assertDecisionStands(REJECTED);
});

test("with nothing new, a decided lineage drafts nothing", () => {
  const previous = decidedDocs(APPROVED);
  const result = merge(previous, docsCommits);
  assert.deepEqual(result.document.candidates, previous.candidates);
  assert.deepEqual(result.drafted, []);
});

test("EVERY attributed commit lands in exactly one candidate, and every draft fits one Jev check", () => {
  const prefixes = ["feat", "fix", "docs", "chore(ci)", "refactor"];
  const commits = Array.from({ length: 494 }, (_, n) =>
    commit(
      n + 1,
      // Long, multi-byte subjects every few commits, so the byte cut matters as well as the count.
      n % 7 === 0 ? `${prefixes[n % 5]}: ${"é".repeat(900)} ${n}` : `${prefixes[n % 5]}: synthetic change ${n}`,
      n % 11 === 0 ? null : undefined,
    ),
  );
  const result = merge(undefined, commits);
  const out = valid(result.document);
  const refs = out.candidates.flatMap((c) => c.evidence.map((e) => e.ref));
  assert.equal(refs.length, 494, "no commit dropped");
  assert.equal(new Set(refs).size, 494, "no commit drafted twice");
  for (const c of out.candidates) {
    assert.ok(c.evidence.length <= DRAFT_MAX_REFS, `${c.id} holds ${c.evidence.length} refs`);
    const material = c.evidence.map((e) => e.excerpt ?? "").join("\n");
    assert.ok(material.length <= 16_000, `${c.id} material is ${material.length} characters`);
  }
  assert.equal(result.drafted.length, out.candidates.length);
});

test("the subject-byte cap alone cuts a lineage: 20 long feat subjects become two drafts, each under the cap", () => {
  // ONE lineage, well under 32 refs, so only the byte rule can split it. Each subject is 808 or
  // 809 bytes ("é" is two), so 14 fit under 12,000 and the 15th would not.
  const commits = Array.from({ length: 20 }, (_, n) => commit(n + 1, `feat: ${"é".repeat(400)} ${n}`, `2026-07-01T00:${String(n).padStart(2, "0")}:00Z`));
  const out = valid(merge(undefined, commits).document);
  const bytes = (c: (typeof out.candidates)[number]): number =>
    c.evidence.reduce((sum, e) => sum + new TextEncoder().encode(e.excerpt ?? "").length, 0);
  assert.deepEqual(out.candidates.map((c) => [c.id, c.evidence.length]), [["git-cluster:feat", 14], ["git-cluster:feat:2", 6]]);
  for (const c of out.candidates) assert.ok(bytes(c) <= DRAFT_MAX_SUBJECT_BYTES, `${c.id} holds ${bytes(c)} subject bytes`);
  assert.deepEqual(out.candidates.flatMap((c) => c.evidence.map((e) => e.ref)).sort(), commits.map((c) => c.sha).sort(), "no commit dropped");
});

test("a single subject over the byte cap stands alone in its own draft, verbatim, beside its neighbours", () => {
  const huge = `feat: ${"x".repeat(DRAFT_MAX_SUBJECT_BYTES)}`;
  const commits = [
    commit(1, "feat: before", "2026-07-01T00:01:00Z"),
    commit(2, huge, "2026-07-01T00:02:00Z"),
    commit(3, "feat: after", "2026-07-01T00:03:00Z"),
  ];
  const out = valid(merge(undefined, commits).document);
  assert.deepEqual(
    out.candidates.map((c) => c.evidence.map((e) => e.ref)),
    [[sha(1)], [sha(2)], [sha(3)]],
    "nothing is packed beside an oversized subject, and nothing is dropped",
  );
  assert.equal(out.candidates[1]!.evidence[0]!.excerpt, huge, "the subject is never truncated");
});

test("a sha in heldExtra is never drafted", () => {
  const result = merge(undefined, [commit(1, "feat: kept out"), commit(2, "feat: drafted")], { heldExtra: new Set([sha(1)]) });
  const refs = result.document.candidates.flatMap((c) => c.evidence.map((e) => e.ref));
  assert.deepEqual(refs, [sha(2)]);
  assert.equal(result.held, 1);
});

test("a sha missing from a COMPLETE read leaves its draft; after an INCOMPLETE read it stays", () => {
  const previous = valid(merge(undefined, [commit(1, "feat: one"), commit(2, "feat: two")]).document);

  const complete = merge(previous, [commit(2, "feat: two")]);
  assert.deepEqual(byId(complete.document, "git-cluster:feat")!.evidence.map((e) => e.ref), [sha(2)]);

  const narrowed = merge(previous, [commit(2, "feat: two")], { complete: false });
  assert.deepEqual(
    [...byId(narrowed.document, "git-cluster:feat")!.evidence.map((e) => e.ref)].sort(),
    [sha(1), sha(2)],
  );
  assert.deepEqual(narrowed.drafted, [], "an unchanged draft is not redrafted");
});

test("a complete read keeps a draft whose refs the walk read under another identity, and names what it withdrew", () => {
  const previous = valid(merge(undefined, [commit(1, "feat: by one identity"), commit(2, "docs: by another identity")]).document);

  const narrower = merge(previous, [commit(1, "feat: by one identity")], { present: new Set([sha(1), sha(2)]) });
  assert.deepEqual(byId(narrower.document, "git-cluster:docs")!.evidence.map((e) => e.ref), [sha(2)], "present in the repository, so not gone");
  assert.deepEqual(narrower.drafted, []);
  assert.deepEqual(narrower.withdrawn, []);

  const gone = merge(previous, [commit(1, "feat: by one identity")], { present: new Set([sha(1)]) });
  assert.equal(byId(gone.document, "git-cluster:docs"), undefined, "absent from the whole walk: gone");
  assert.deepEqual(gone.drafted, []);
  assert.deepEqual(gone.withdrawn, ["git-cluster:docs"]);
});

test("an unchanged draft keeps its title, refs and first-observed instants", () => {
  const first = merge(undefined, [commit(1, "feat: one"), commit(2, "feat: two")]).document;
  const retitled = harvestOf(
    JSON.parse(JSON.stringify(first)).candidates.map((c: Record<string, unknown>) => ({ ...c, title: "A title a person or model wrote", extractor: "local-model:synthetic" })),
  );
  const result = merge(retitled, [commit(2, "feat: two"), commit(1, "feat: one")]);
  assert.deepEqual(result.document.candidates, retitled.candidates);
  assert.deepEqual(result.drafted, []);

  // A changed draft is rebuilt, but a sha seen before keeps the instant it was first observed.
  const third = "2026-09-03T00:00:00Z";
  const grown = merge(retitled, [commit(1, "feat: one"), commit(2, "feat: two"), commit(3, "feat: three")], { observedAt: third });
  const feat = byId(grown.document, "git-cluster:feat")!;
  assert.equal(feat.evidence.length, 3);
  assert.equal(feat.evidence.find((e) => e.ref === sha(1))!.observedAt, later);
  assert.equal(feat.evidence.find((e) => e.ref === sha(3))!.observedAt, third);
  assert.deepEqual(grown.drafted, ["git-cluster:feat"]);
});

test("an unchanged draft another extractor titled is rebuilt for the requested one; a decided one is not", () => {
  const first = merge(undefined, [commit(1, "feat: one"), commit(2, "fix: two")]).document;
  const previous = harvestOf(
    JSON.parse(JSON.stringify(first)).candidates.map((c: Record<string, unknown>) =>
      c["id"] === "git-cluster:fix" ? { ...c, review: { ...APPROVED, subjectDigest: reviewSubjectDigest(c as never) } } : c),
  );
  const titles = new Map([[draftKey("git-cluster:feat", [sha(1)]), { title: "Modelled title", extractor: "local-model:synthetic" }]]);
  const result = merge(previous, [commit(1, "feat: one"), commit(2, "fix: two")], { titles, extractor: "local-model:synthetic" });
  assert.deepEqual(result.drafted, ["git-cluster:feat"]);
  assert.equal(byId(result.document, "git-cluster:feat")!.extractor, "local-model:synthetic");
  assert.deepEqual(byId(result.document, "git-cluster:fix"), byId(previous, "git-cluster:fix"));
});

test("photo and imported candidates pass through untouched", () => {
  const others = [
    {
      id: `photo:sha256:${"a".repeat(64)}`,
      title: "Synthetic image",
      evidence: [{ source: "photo", ref: `sha256:${"a".repeat(64)}`, observedAt }],
      extractor: "photo-scan",
      draftedAt: observedAt,
      review: { state: "candidate" },
    },
    {
      id: "observation:synthetic:record",
      title: "Synthetic imported observation",
      evidence: [{ source: "observation", ref: "record-1", observedAt }],
      extractor: "observation-import",
      draftedAt: observedAt,
      review: { state: "rejected", by: "Synthetic Reviewer", at: observedAt, reason: "synthetic" },
    },
  ];
  const previous = harvestOf(others);
  const result = merge(previous, [commit(1, "feat: one")]);
  const out = valid(result.document);
  assert.deepEqual(out.candidates.slice(0, 2), previous.candidates);
  assert.deepEqual(result.drafted, ["git-cluster:feat"]);
});

test("a singleton prefix becomes a draft — there is no minimum size", () => {
  const result = merge(undefined, [commit(1, "perf: the only one")]);
  assert.deepEqual(result.document.candidates.map((c) => c.id), ["git-cluster:perf"]);
  assert.deepEqual(result.document.candidates[0]!.evidence.map((e) => e.ref), [sha(1)]);
});

test("evidence is newest-first, carries subject, observation and author date, and undated sorts last", () => {
  const result = merge(undefined, [
    commit(1, "feat: oldest", "2026-08-01T10:00:00Z"),
    commit(2, "feat: undated", null),
    commit(3, "feat: newest", "2026-08-03T10:00:00+02:00"),
  ]);
  const evidence = result.document.candidates[0]!.evidence;
  assert.deepEqual(evidence.map((e) => e.ref), [sha(3), sha(1), sha(2)]);
  assert.deepEqual(evidence[0], { source: "git", ref: sha(3), observedAt: later, excerpt: "feat: newest", authoredAt: "2026-08-03T10:00:00+02:00" });
  assert.equal("authoredAt" in evidence[2]!, false, "an undated commit carries no invented date");
});

test("a lineage is cut oldest-first into generations that skip the decided ones", () => {
  const first = merge(undefined, Array.from({ length: 40 }, (_, n) => commit(n + 1, `feat: change ${n}`, `2026-07-01T00:${String(n).padStart(2, "0")}:00Z`)));
  assert.deepEqual(first.document.candidates.map((c) => [c.id, c.evidence.length]), [["git-cluster:feat", 32], ["git-cluster:feat:2", 8]]);
  // The oldest 32 are generation 1.
  assert.ok(first.document.candidates[0]!.evidence.every((e) => Number.parseInt(e.ref, 16) <= 32));

  const approvedSecond = harvestOf(
    JSON.parse(JSON.stringify(first.document)).candidates.map((c: Record<string, unknown>) =>
      c["id"] === "git-cluster:feat:2" ? { ...c, review: { state: "approved", by: "Synthetic Reviewer", at: observedAt } } : c,
    ),
  );
  const again = merge(approvedSecond, [commit(99, "feat: newer", "2026-07-02T00:00:00Z"), ...Array.from({ length: 40 }, (_, n) => commit(n + 1, `feat: change ${n}`, `2026-07-01T00:${String(n).padStart(2, "0")}:00Z`))]);
  const ids = again.document.candidates.map((c) => c.id);
  assert.deepEqual([...ids].sort(), ["git-cluster:feat", "git-cluster:feat:2", "git-cluster:feat:3"]);
  assert.deepEqual(byId(again.document, "git-cluster:feat:3")!.evidence.map((e) => e.ref), [sha(99)]);
  assert.equal(byId(again.document, "git-cluster:feat:2")!.review.state, "approved");
});

test("a supplied title applies only to the exact draft it was written for", () => {
  const commits = [commit(1, "feat: one"), commit(2, "fix: two")];
  const titles = new Map([[draftKey("git-cluster:feat", [sha(1)]), { title: "Modelled title", extractor: "local-model:synthetic" }]]);
  const result = merge(undefined, commits, { titles });
  assert.equal(byId(result.document, "git-cluster:feat")!.title, "Modelled title");
  assert.equal(byId(result.document, "git-cluster:feat")!.extractor, "local-model:synthetic");
  assert.equal(byId(result.document, "git-cluster:fix")!.extractor, "git-cluster");
});

test("lineage ids: generation 1 is the bare prefix, later ones carry the number", () => {
  assert.deepEqual(gitLineage("git-cluster:feat"), { prefix: "feat", generation: 1 });
  assert.deepEqual(gitLineage("git-cluster:feat:2"), { prefix: "feat", generation: 2 });
  assert.deepEqual(gitLineage("git-cluster:fix(ui):12"), { prefix: "fix(ui)", generation: 12 });
  assert.equal(gitLineage("photo:sha256:abc"), null);
  // Prefixes are cut at the first ":", so the clusterer never yields one containing a colon.
  assert.deepEqual([...clusterBySubjectPrefix([{ subject: "a: b: c" }]).keys()], ["a"]);
});

test("withoutUndecidedGitDrafts removes only undecided git drafts", () => {
  const previous = decidedDocs(APPROVED);
  const withDraft = valid(merge(previous, [...docsCommits, commit(3, "docs: third")]).document);
  assert.equal(withDraft.candidates.length, 2);
  const cleared = withoutUndecidedGitDrafts(withDraft);
  assert.deepEqual(cleared.candidates, previous.candidates);
  assert.equal(cleared.repo, "/synthetic/repo");
});

/** Every ref of every candidate, so a test can count where one sha landed. */
const allRefs = (document: HarvestDocument): readonly string[] => document.candidates.flatMap((c) => c.evidence.map((e) => e.ref));

test("a draft is kept only when its whole ref set is unchanged: one ref out and one in rebuilds it", () => {
  const previous = valid(merge(undefined, [commit(1, "feat: one")]).document);
  assert.deepEqual(byId(previous, "git-cluster:feat")!.evidence.map((e) => e.ref), [sha(1)]);

  // Same count, different ref: a complete read that lost sha(1) and gained sha(2).
  const result = merge(previous, [commit(2, "feat: two")]);
  const out = valid(result.document);
  assert.deepEqual(byId(out, "git-cluster:feat")!.evidence.map((e) => e.ref), [sha(2)]);
  assert.deepEqual(result.drafted, ["git-cluster:feat"]);
  assert.equal(allRefs(out).filter((r) => r === sha(2)).length, 1, "the new sha lands in exactly one candidate");
  assert.equal(allRefs(out).includes(sha(1)), false, "the lost sha is not kept");
});

test("a supplied title binds to the draft's refs as well as its id: the same id holding more refs is titled from its subjects", () => {
  const titles = new Map([[draftKey("git-cluster:feat", [sha(1)]), { title: "Modelled title", extractor: "local-model:synthetic" }]]);
  const result = merge(undefined, [commit(1, "feat: one"), commit(2, "feat: two")], { titles });
  const feat = byId(result.document, "git-cluster:feat")!;
  assert.deepEqual([...feat.evidence.map((e) => e.ref)].sort(), [sha(1), sha(2)]);
  assert.notEqual(feat.title, "Modelled title");
  assert.equal(feat.title, "feat: two; one");
  assert.equal(feat.extractor, "git-cluster");
});

test("a rebuilt draft keeps an author date recorded earlier when this read has none for that sha", () => {
  const recorded = "2026-08-05T10:00:00Z";
  const previous = valid(merge(undefined, [commit(1, "feat: one", recorded)]).document);

  const result = merge(previous, [commit(1, "feat: one", null), commit(2, "feat: two", "2026-08-06T10:00:00Z")]);
  const feat = byId(valid(result.document), "git-cluster:feat")!;
  assert.deepEqual(result.drafted, ["git-cluster:feat"], "the draft was rebuilt");
  assert.equal(feat.evidence.find((e) => e.ref === sha(1))!.authoredAt, recorded);
  assert.deepEqual(feat.evidence.map((e) => e.ref), [sha(2), sha(1)], "the kept date still orders the draft");
});

test("an INCOMPLETE read never keeps a ref that heldExtra now holds", () => {
  const previous = valid(merge(undefined, [commit(1, "feat: one"), commit(2, "feat: two")]).document);
  const result = merge(previous, [commit(2, "feat: two")], { complete: false, heldExtra: new Set([sha(1)]) });
  const out = valid(result.document);
  assert.deepEqual(allRefs(out), [sha(2)]);
});

test("a commit supplied twice is drafted once", () => {
  const result = merge(undefined, [commit(1, "feat: one"), commit(1, "feat: one")]);
  const out = valid(result.document);
  assert.deepEqual(allRefs(out), [sha(1)]);
  assert.deepEqual(result.drafted, ["git-cluster:feat"]);
});

test("a subjectless commit is drafted as a bare ref, with no excerpt key", () => {
  const result = merge(undefined, [commit(1, "")]);
  const out = valid(result.document);
  assert.deepEqual(out.candidates.map((c) => c.id), ["git-cluster:unprefixed"]);
  const evidence = out.candidates[0]!.evidence[0]!;
  assert.equal(evidence.ref, sha(1));
  assert.equal("excerpt" in evidence, false);
});

/*
 * DRAFT TITLES. Unlike the synthetic inputs above, these subjects are quoted verbatim from this
 * repository's own history, where the UI map observed the titles they produced.
 */

test("a prefix the clusterer cut appears once in its draft's title, however long it is", () => {
  const subject = "Jev in Scarlet and Canopy: marks beside highlights and before publishing (#101)";
  const result = merge(undefined, [commit(1, subject)]);
  // Was "Jev in Scarlet and Canopy: Jev in Scarlet and Canopy: marks beside highlights and".
  assert.equal(byId(result.document, "git-cluster:Jev in Scarlet and Canopy")!.title, subject);
  assert.equal(composeDeterministicTitle("feat", [{ subject: "feat: preview the exact public title before sharing" }]),
    "feat: preview the exact public title before sharing");
});

test("commits with no prefix draft a title in their own words, never the clusterer's key", () => {
  // Was "unprefixed: Add a command line…; Add tests…": the key is the id, the subjects are the title.
  const result = merge(undefined, [commit(1, "Count words and lines in a string"), commit(2, "Add tests for empty input")]);
  const draft = byId(result.document, "git-cluster:unprefixed")!;
  assert.doesNotMatch(draft.title, /unprefixed/);
  assert.match(draft.title, /^(Add tests for empty input|Count words and lines in a string); /);
  assert.equal(composeDeterministicTitle("unprefixed", [{ subject: "" }, { subject: "" }]), "2 commits");
  assert.equal(composeDeterministicTitle("feat", [{ subject: "" }, { subject: "" }]), "feat: 2 commits", "a real prefix still leads");
});

test("a clause clipped to fit a title says so with an ellipsis; one that fits does not", () => {
  assert.equal(
    composeDeterministicTitle("fix(enterprise)", [{ subject: "fix(enterprise): require explicit authority and preserve release audit failures" }]),
    "fix(enterprise): require explicit authority and preserve release audit…",
  );
  assert.equal(
    composeDeterministicTitle("intake", [{ subject: "intake: redact the real address the doc comment was quoting verbatim" }]),
    "intake: redact the real address the doc comment was quoting…",
  );
  // The leading clause ends at ", "; it is that clause, still too long, that is clipped and marked.
  assert.equal(
    composeDeterministicTitle("fix(ui)", [{ subject: "fix(ui): the leaf script writes the same short labels the server renders, and no status claims to be loading" }]),
    "fix(ui): the leaf script writes the same short labels the server…",
  );
  assert.equal(
    composeDeterministicTitle("fix(workflow)", [
      { subject: "fix(workflow): a narrowed or undated read names its cause on the source and the run" },
      { subject: "fix(workflow): an accepted packet never saved to the Leaf keeps its Save to Leaf link" },
      { subject: "fix(workflow): removing a source keeps the drafts while another checkout cannot be checked" },
      { subject: "fix(workflow): collection keeps what the checkout grow reads still holds" },
    ]),
    "fix(workflow): a narrowed or undated read names its cause on the…; an accepted packet never saved to the Leaf keeps its…; " +
      "removing a source keeps the drafts while another… (+1 more)",
  );
});

test("an unchanged draft still holding a title the composer no longer writes is retitled once; a model's or a decision's is not", () => {
  const jev = "Jev in Scarlet and Canopy: marks beside highlights and before publishing (#101)";
  const commits = [commit(1, jev), commit(2, "feat: one"), commit(3, "docs: first page")];
  const stale = "Jev in Scarlet and Canopy: Jev in Scarlet and Canopy: marks beside highlights and";
  const decidedTitle = "docs: docs: first page";
  // The queue as an owner's garden holds it: drafted before the composer changed, then left alone.
  const previous = harvestOf(
    JSON.parse(JSON.stringify(merge(undefined, commits, { observedAt }).document)).candidates.map((c: Record<string, unknown>) =>
      c["id"] === "git-cluster:Jev in Scarlet and Canopy" ? { ...c, title: stale }
      : c["id"] === "git-cluster:feat" ? { ...c, title: "A title a model wrote", extractor: "local-model:synthetic" }
      : { ...c, title: decidedTitle, review: { ...APPROVED, subjectDigest: reviewSubjectDigest({ ...c, title: decidedTitle } as never) } }),
  );
  const id = "git-cluster:Jev in Scarlet and Canopy";

  // The collector passes no extractor, and grow passes the deterministic one; both retitle it.
  for (const extra of [{}, { extractor: "git-cluster" }]) {
    const result = merge(previous, commits, extra);
    assert.ok(result.drafted.map(String).includes(id), JSON.stringify(extra));
    assert.equal(byId(result.document, id)!.title, jev);
    assert.equal(byId(result.document, id)!.draftedAt, later);
    assert.deepEqual(byId(result.document, id)!.evidence, byId(previous, id)!.evidence, "refs and first-observed instants are unchanged");
    assert.deepEqual(byId(result.document, "git-cluster:docs"), byId(previous, "git-cluster:docs"), "a decision is never retitled");
    // Once: the next read keeps the retitled draft exactly as it is.
    const again = merge(valid(result.document), commits, extra);
    assert.deepEqual(again.drafted, []);
    assert.deepEqual(again.document.candidates, valid(result.document).candidates);
  }
  // A model's title is kept: the composer cannot say it is out of date.
  const collected = merge(previous, commits);
  assert.deepEqual(collected.drafted, [id]);
  assert.deepEqual(byId(collected.document, "git-cluster:feat"), byId(previous, "git-cluster:feat"));
});
