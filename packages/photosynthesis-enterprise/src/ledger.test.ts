import { test } from "node:test";
import assert from "node:assert/strict";

import { SCORE_SHAPED } from "@foliage/leaf";

import {
  RELEASE_STATES,
  parseEnterpriseDocument,
  type EnterpriseArtifact,
} from "./artifactDocument.ts";
import { contributionLedger } from "./ledger.ts";
import { boughId, branchId, leafId, subjectKey, treeId, type Subject } from "./subject.ts";

/**
 * Every artifact here is a PARSER INPUT built to pin one tally, run through the real gate
 * first. The people are placeholder ids; nothing in this file is a real company's evidence.
 */

const instant = "2026-08-16T00:00:00Z";

const ref = (n: number) => ({ source: "git", ref: `ref-${n}`, observedAt: instant });
const refs = (n: number) => Array.from({ length: n }, (_, i) => ref(i));

const membership = (branch = "billing-core", bough = "payments") => ({
  tree: "acme",
  bough,
  branch,
});

const person = (leaf: string, branches: readonly Record<string, unknown>[] = [membership()]) => ({
  kind: "leaf",
  tree: "acme",
  leaf,
  branches,
});

const BRANCH: Subject = {
  kind: "branch",
  tree: treeId("acme"),
  bough: boughId("payments"),
  branch: branchId("billing-core"),
};

const TREE: Subject = { kind: "tree", tree: treeId("acme") };

function documentOf(artifacts: readonly Record<string, unknown>[]): readonly EnterpriseArtifact[] {
  const parsed = parseEnterpriseDocument({ artifacts });
  assert.equal(parsed.ok, true, parsed.ok ? "" : JSON.stringify(parsed.issues, null, 2));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.document.artifacts;
}

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "parser-input:one",
    title: "parser input: a branch artifact",
    subject: { kind: "branch", tree: "acme", bough: "payments", branch: "billing-core" },
    contributors: [],
    evidence: refs(1),
    extractor: "git-cluster",
    draftedAt: instant,
    review: { state: "candidate" },
    release: "internal",
    ...overrides,
  };
}

test("A BRANCH ARTIFACT WITH SEVERAL CONTRIBUTORS PRODUCES NO RANKING", () => {
  // Counts deliberately out of order, so a sort of any direction would be visible.
  const artifacts = documentOf([
    artifact({
      contributors: [
        { subject: person("a-person"), evidence: refs(1) },
        { subject: person("b-person"), evidence: refs(5) },
        { subject: person("c-person"), evidence: refs(3) },
      ],
    }),
  ]);
  const ledger = contributionLedger(artifacts, BRANCH);

  // FIRST APPEARANCE order — the company's own record order, not a league table.
  assert.deepEqual(
    ledger.contributors.map((c) => c.subject.leaf),
    ["a-person", "b-person", "c-person"],
  );
  const counts = ledger.contributors.map((c) => c.evidenceRefs);
  assert.deepEqual(counts, [1, 5, 3]);
  assert.notDeepEqual(counts, [...counts].sort((x, y) => y - x), "must not be ranked descending");
  assert.notDeepEqual(counts, [...counts].sort((x, y) => x - y), "must not be ranked ascending");
});

test("the ledger exposes NO ratio, percentage, composite or rating — checked by name", () => {
  const artifacts = documentOf([
    artifact({
      contributors: [
        { subject: person("a-person"), evidence: refs(1) },
        { subject: person("b-person"), evidence: refs(3) },
      ],
    }),
  ]);
  const ledger = contributionLedger(artifacts, BRANCH);

  // The same refusal list the three document gates use, applied to the OUTPUT this time.
  const keys = [
    ...Object.keys(ledger),
    ...ledger.contributors.flatMap((c) => Object.keys(c)),
    ...Object.keys(ledger.byReleaseState),
  ];
  for (const key of keys) {
    assert.equal(SCORE_SHAPED.has(key.toLowerCase()), false, `"${key}" is score-shaped`);
  }

  // And no fractional number anywhere: a ratio cannot hide in a differently-named field.
  const numbers = [
    ledger.artifacts,
    ledger.evidenceRefs,
    ledger.artifactsWithNoNamedContributor,
    ledger.outOfScope,
    ...Object.values(ledger.byReleaseState),
    ...ledger.contributors.flatMap((c) => [c.artifacts, c.evidenceRefs]),
  ];
  for (const n of numbers) assert.ok(Number.isInteger(n), `${n} is not a count`);
});

test("there is no top contributor, no maximum, and no aggregate over people", () => {
  const ledger = contributionLedger(documentOf([artifact()]), BRANCH);
  for (const forbidden of ["top", "topContributor", "leader", "mostActive", "total", "share"]) {
    assert.equal(forbidden in ledger, false, `the ledger must not expose "${forbidden}"`);
  }
});

test("counts accumulate across artifacts, per person and per subject", () => {
  const artifacts = documentOf([
    artifact({
      id: "one",
      evidence: refs(2),
      contributors: [
        { subject: person("a-person"), evidence: refs(2) },
        { subject: person("b-person"), evidence: refs(1) },
      ],
    }),
    artifact({
      id: "two",
      evidence: refs(3),
      contributors: [{ subject: person("a-person"), evidence: refs(4) }],
    }),
  ]);
  const ledger = contributionLedger(artifacts, BRANCH);

  assert.equal(ledger.artifacts, 2);
  assert.equal(ledger.evidenceRefs, 5);
  assert.deepEqual(
    ledger.contributors.map((c) => [c.subject.leaf, c.artifacts, c.evidenceRefs]),
    [
      ["a-person", 2, 6],
      ["b-person", 1, 1],
    ],
  );
  // The key is the grouping key, and it does not depend on which branches the person is on.
  const keyOf = (id: string): string =>
    subjectKey({
      kind: "leaf",
      tree: treeId("acme"),
      leaf: leafId(id),
      branches: [],
    });
  assert.deepEqual(
    ledger.contributors.map((c) => c.key),
    [keyOf("a-person"), keyOf("b-person")],
  );
});

test("AN ARTIFACT THAT NAMES NOBODY IS COUNTED HONESTLY, not dropped", () => {
  const artifacts = documentOf([
    artifact({ id: "branch-work" }),
    artifact({
      id: "named",
      contributors: [{ subject: person("a-person"), evidence: refs(1) }],
    }),
  ]);
  const ledger = contributionLedger(artifacts, BRANCH);
  assert.equal(ledger.artifacts, 2);
  assert.equal(ledger.artifactsWithNoNamedContributor, 1);
  assert.equal(ledger.contributors.length, 1);
});

test("an empty portfolio tallies to zeroes, and that is an honest empty state", () => {
  const ledger = contributionLedger([], BRANCH);
  assert.equal(ledger.artifacts, 0);
  assert.equal(ledger.outOfScope, 0);
  assert.deepEqual(ledger.contributors, []);
  for (const state of RELEASE_STATES) assert.equal(ledger.byReleaseState[state], 0);
});

test("ARTIFACTS OUT OF SCOPE ARE REPORTED, so a small number cannot mean 'we filtered it'", () => {
  const artifacts = documentOf([
    artifact({ id: "ours" }),
    artifact({
      id: "another-branch",
      subject: { kind: "branch", tree: "acme", bough: "platform", branch: "ledgering" },
    }),
  ]);
  const ledger = contributionLedger(artifacts, BRANCH);
  assert.equal(ledger.artifacts, 1);
  assert.equal(ledger.outOfScope, 1);

  // The tree above both contains both — the same artifacts, a wider subject.
  const wider = contributionLedger(artifacts, TREE);
  assert.equal(wider.artifacts, 2);
  assert.equal(wider.outOfScope, 0);
});

test("scope is decided by containment: a person's own artifact rolls up to their branch", () => {
  const artifacts = documentOf([
    artifact({ id: "personal", subject: person("a-person"), contributors: [] }),
  ]);
  assert.equal(contributionLedger(artifacts, BRANCH).artifacts, 1);
  assert.equal(contributionLedger(artifacts, TREE).artifacts, 1);
  assert.equal(
    contributionLedger(artifacts, {
      kind: "branch",
      tree: treeId("acme"),
      bough: boughId("platform"),
      branch: branchId("ledgering"),
    }).outOfScope,
    1,
  );
});

test("release states are tallied per state, and the keys are the policy machine's own", () => {
  const artifacts = documentOf([
    artifact({ id: "a", release: "internal" }),
    artifact({ id: "b", release: "internal" }),
    artifact({
      id: "c",
      release: "live",
      review: { state: "approved", by: "a-reviewer", role: "policy_owner", at: instant },
    }),
  ]);
  const ledger = contributionLedger(artifacts, BRANCH);
  assert.deepEqual(Object.keys(ledger.byReleaseState).sort(), [...RELEASE_STATES].sort());
  assert.equal(ledger.byReleaseState.internal, 2);
  assert.equal(ledger.byReleaseState.live, 1);
  assert.equal(ledger.byReleaseState.approved, 0);
  assert.equal(
    Object.values(ledger.byReleaseState).reduce((n, v) => n + v, 0),
    ledger.artifacts,
    "every in-scope artifact lands in exactly one state",
  );
});

test("the ledger and its tallies are frozen", () => {
  const ledger = contributionLedger(
    documentOf([artifact({ contributors: [{ subject: person("a-person"), evidence: refs(1) }] })]),
    BRANCH,
  );
  assert.ok(Object.isFrozen(ledger));
  assert.ok(Object.isFrozen(ledger.contributors));
  assert.ok(Object.isFrozen(ledger.contributors[0]));
  assert.ok(Object.isFrozen(ledger.byReleaseState));
});
