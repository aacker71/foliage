import { test } from "node:test";
import assert from "node:assert/strict";

import { leafId, leafletId, type Leaf } from "@foliage/leaf";
import { canopySize, treeContaining, treeId, type Canopy } from "./canopy.ts";

const prov = { source: "git", ref: "f0221ec", observedAt: "2026-08-13T00:00:00Z" };

const leaf = (id: string, subject: string): Leaf => ({
  id: leafId(id),
  subject,
  leaflets: [
    { id: leafletId(`${id}-a`), title: "Shipped the gate", tier: "verified", provenance: prov },
  ],
});

const canopy: Canopy = {
  trees: [
    { id: treeId("t1"), company: "Foliage", leaves: [leaf("l1", "A. Acker")] },
    { id: treeId("t2"), company: "Newly Incorporated", leaves: [] },
  ],
};

test("counts trees and leaves, tolerating an empty tree", () => {
  assert.deepEqual(canopySize(canopy), { trees: 2, leaves: 1 });
});

test("size reports counts only — no density, coverage, or composite", () => {
  const size = canopySize(canopy) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(size).sort(), ["leaves", "trees"]);
  for (const v of Object.values(size)) assert.ok(Number.isInteger(v));
});

test("finds the tree containing a leaf", () => {
  const t = treeContaining(canopy, leafId("l1"));
  assert.equal(t?.company, "Foliage");
});

test("a leaf in no tree is undefined, not an error", () => {
  // An individual self-hosting their own leaf outside any company is a normal state.
  assert.equal(treeContaining(canopy, leafId("nope")), undefined);
});

test("an empty canopy is valid", () => {
  assert.deepEqual(canopySize({ trees: [] }), { trees: 0, leaves: 0 });
  assert.equal(treeContaining({ trees: [] }, leafId("l1")), undefined);
});
