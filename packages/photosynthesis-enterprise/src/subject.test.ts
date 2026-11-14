import { test } from "node:test";
import assert from "node:assert/strict";

// Imported from the OPEN PLANE on purpose: the leaf level of this hierarchy is @foliage/leaf's
// leaf, and these tests build subjects with the open plane's own id constructor to prove it.
import { leafId as openPlaneLeafId, type LeafId } from "@foliage/leaf";

import {
  boughId,
  branchId,
  containment,
  describeSubject,
  leafId,
  subjectKey,
  treeId,
  type BranchPath,
  type Subject,
} from "./subject.ts";

/**
 * Every subject in this file is a TEST INPUT — an id an organization might use, chosen to pin
 * one containment decision each. Nothing here describes a real company, team or person.
 */

const ACME = treeId("acme");
const OTHER = treeId("other-co");
const PAYMENTS = boughId("payments");
const PLATFORM = boughId("platform");
const BILLING = branchId("billing-core");
const LEDGERING = branchId("ledgering");

const tree = (t = ACME): Subject => ({ kind: "tree", tree: t });
const bough = (b = PAYMENTS, t = ACME): Subject => ({
  kind: "bough",
  tree: t,
  bough: b,
});
const branch = (b = BILLING, o = PAYMENTS, t = ACME): Subject => ({
  kind: "branch",
  tree: t,
  bough: o,
  branch: b,
});
const membership = (b = BILLING, o = PAYMENTS, t = ACME): BranchPath => ({
  tree: t,
  bough: o,
  branch: b,
});
const leaf = (
  id: string,
  branches: readonly BranchPath[] = [membership()],
  t = ACME,
): Subject => ({
  kind: "leaf",
  tree: t,
  leaf: leafId(id),
  branches,
});

function assertContains(outer: Subject, inner: Subject): string {
  const r = containment(outer, inner);
  assert.equal(
    r.relation,
    "contains",
    `${describeSubject(outer)} should contain ${describeSubject(inner)}: ${
      r.relation === "separate" ? r.why : ""
    }`,
  );
  return r.relation === "contains" ? r.via : "";
}

function assertSeparate(outer: Subject, inner: Subject): string {
  const r = containment(outer, inner);
  assert.equal(
    r.relation,
    "separate",
    `${describeSubject(outer)} should NOT contain ${describeSubject(inner)}`,
  );
  return r.relation === "separate" ? r.why : "";
}

test("a tree contains its boughs, branches and people — and itself", () => {
  assertContains(tree(), tree());
  assertContains(tree(), bough());
  assertContains(tree(), branch());
  assertContains(tree(), leaf("a-person"));
});

test("THE LEAF LEVEL IS THE OPEN PLANE'S LEAF — the same brand, not a parallel id", () => {
  // The design point, checked rather than asserted in a comment: an id minted by @foliage/leaf
  // is accepted at the bottom of this hierarchy with no cast and no conversion. If this package
  // ever declared its own person brand, this file would stop compiling — which is the whole
  // reason the leaf level is imported instead of redefined.
  const fromOpenPlane: LeafId = openPlaneLeafId("a-person");
  const subject: Subject = { kind: "leaf", tree: ACME, leaf: fromOpenPlane, branches: [] };
  assertContains(tree(), subject);
  assert.equal(subjectKey(subject), subjectKey(leaf("a-person", [])));
  assert.equal(describeSubject(subject), `leaf "a-person"`);
});

test("containment never crosses a tree — that boundary is the tenancy", () => {
  const why = assertSeparate(tree(ACME), branch(BILLING, PAYMENTS, OTHER));
  assert.match(why, /never crosses a tree/);
  assertSeparate(bough(PAYMENTS, ACME), bough(PAYMENTS, OTHER));
});

test("A MEMBERSHIP NAMING ANOTHER TREE IS NOT CONTAINMENT, even when the ids match", () => {
  // The hole this closes: both subjects were on "acme", so the tree check passed, and then the
  // branch lookup matched on bough/branch alone — so a membership of a RIVAL company's tree,
  // "payments/billing-core", was read as containment. Ids are scoped per tree; a shared string
  // is not a shared branch.
  const foreignMember = leaf("a-person", [membership(BILLING, PAYMENTS, OTHER)]);
  assert.match(assertSeparate(bough(PAYMENTS, ACME), foreignMember), /no recorded branch/);
  assert.match(
    assertSeparate(branch(BILLING, PAYMENTS, ACME), foreignMember),
    /not a recorded member/,
  );

  // The same person also holding the real membership IS contained — the check filters the
  // foreign row rather than poisoning the whole list.
  const both = leaf("a-person", [
    membership(BILLING, PAYMENTS, OTHER),
    membership(BILLING, PAYMENTS, ACME),
  ]);
  assertContains(bough(PAYMENTS, ACME), both);
  assertContains(branch(BILLING, PAYMENTS, ACME), both);
});

test("a bough contains its own branches, and not a sibling limb's", () => {
  assertContains(bough(PAYMENTS), branch(BILLING, PAYMENTS));
  const why = assertSeparate(bough(PLATFORM), branch(BILLING, PAYMENTS));
  assert.match(why, /not to "platform"/);
});

test("a bough contains a person through a recorded branch membership", () => {
  const via = assertContains(bough(PAYMENTS), leaf("a-person"));
  assert.match(via, /belongs to bough "payments"/);

  const why = assertSeparate(bough(PLATFORM), leaf("a-person"));
  assert.match(why, /no recorded branch membership/);
});

test("a person on no branch is a real state, contained only by their tree", () => {
  const soloist = leaf("a-person", []);
  assertContains(tree(), soloist);
  assertSeparate(bough(), soloist);
  assertSeparate(branch(), soloist);
});

test("a branch contains its members and no one else", () => {
  assertContains(branch(BILLING), leaf("a-person", [membership(BILLING)]));
  const why = assertSeparate(branch(LEDGERING), leaf("a-person", [membership(BILLING)]));
  assert.match(why, /not a recorded member of branch "ledgering"/);
});

test("containment runs one way: a branch does not contain the bough or tree above it", () => {
  assert.match(assertSeparate(branch(), bough()), /the other way/);
  assert.match(assertSeparate(branch(), tree()), /the other way/);
  assert.match(assertSeparate(bough(), tree()), /the other way/);
});

test("a person is a leaf of the hierarchy and contains no other subject", () => {
  const ada = leaf("a-person");
  assertContains(ada, ada);
  assert.match(assertSeparate(ada, leaf("b-person")), /a person is a leaf/);
  assertSeparate(ada, branch());
});

test("a NEGATIVE answer always carries prose — a bare false would be the unexplained absence", () => {
  const r = containment(branch(LEDGERING), leaf("a-person", [membership(BILLING)]));
  assert.equal(r.relation, "separate");
  if (r.relation !== "separate") return;
  assert.ok(r.why.trim().length > 0, "a separate answer must say why");
});

test("subject keys are kind-qualified, so same-named subjects of different kinds cannot merge", () => {
  // The branded id types stop this at compile time; they erase at runtime, and a Map does not.
  assert.notEqual(subjectKey(branch(branchId("billing"))), subjectKey(leaf("billing")));
  assert.notEqual(subjectKey(tree(treeId("billing"))), subjectKey(leaf("billing")));
});

test("a separator inside an id cannot forge a different subject's key", () => {
  const spliced = bough(boughId("x"), treeId("acme/payments"));
  const plain = bough(boughId("payments/x"), ACME);
  assert.notEqual(subjectKey(spliced), subjectKey(plain));
});

test("the same subject always yields the same key", () => {
  assert.equal(subjectKey(leaf("a-person")), subjectKey(leaf("a-person", [])));
});

test("containment is total: every pair of subjects gets an answer, never a throw", () => {
  const subjects: Subject[] = [
    tree(),
    tree(OTHER),
    bough(),
    bough(PLATFORM),
    branch(),
    branch(LEDGERING, PLATFORM),
    leaf("a-person"),
    leaf("b-person", []),
    leaf("c-person", [membership(LEDGERING, PLATFORM)]),
  ];
  for (const outer of subjects) {
    for (const inner of subjects) {
      const r = containment(outer, inner);
      assert.ok(
        r.relation === "contains" || r.relation === "separate",
        `${subjectKey(outer)} vs ${subjectKey(inner)} produced no relation`,
      );
      assert.ok(Object.isFrozen(r));
    }
  }
});

test("every subject contains itself", () => {
  for (const s of [tree(), bough(), branch(), leaf("a-person")]) {
    assert.equal(containment(s, s).relation, "contains", subjectKey(s));
  }
});
