/** The name a first record needs is the one `promoteApproved` will accept, not a guess. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHarvestDocument, promoteApproved } from "@foliage/photosynthesis";
import { parseLeafDocument } from "@foliage/leaf";
import { firstRecord, recordStart } from "./recordStart.ts";

const parsed = parseHarvestDocument({ candidates: [{
  id: "git-cluster:start", title: "Contract draft", extractor: "git-cluster", draftedAt: "2026-09-04T00:00:00Z",
  evidence: [{ source: "git", ref: "a".repeat(40), observedAt: "2026-09-04T00:00:00Z" }],
  review: { state: "approved", by: "Contract reviewer", at: "2026-09-05T00:00:00Z" },
}] });
assert.ok(parsed.ok);
const queue = parsed.harvest;

/** Whether a record created from `name` would take this queue's approved draft, by the promote gate itself. */
function addsInto(binding: { subject?: string; leafId?: string }, name: string): boolean {
  const first = firstRecord(name);
  assert.ok(first.ok);
  const leaf = parseLeafDocument({ id: first.id, subject: first.subject, leaflets: [] });
  assert.ok(leaf.ok);
  return promoteApproved({ ...queue, ...binding }, leaf.leaf).ok;
}

test("a bound queue names the one record name its drafts can be added into", () => {
  for (const binding of [{ subject: "Alex A", leafId: "alex-a" }, { subject: "Alex A" }]) {
    const start = recordStart(binding);
    assert.deepEqual(start, { addable: true, name: "Alex A" });
    assert.equal(addsInto(binding, "Alex A"), true);
    assert.equal(addsInto(binding, "Alex Ackerman"), false, "any other name is refused by the promote gate");
  }
  assert.deepEqual(recordStart({}), { addable: true, name: null }, "an unbound queue adds into any name");
  assert.equal(addsInto({}, "Anyone"), true);
});

test("a binding no typed name can meet promises nothing", () => {
  for (const binding of [{ leafId: "alex-a" }, { subject: "Alex A", leafId: "leaf:other" }, { subject: " Alex A" }, { subject: "Alex\nA" }]) {
    assert.deepEqual(recordStart(binding), { addable: false }, JSON.stringify(binding));
  }
});
