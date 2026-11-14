import { test } from "node:test";
import assert from "node:assert/strict";
import { addCell, asanaObservation, draftFromCells, parseCellStore, setCellSourcePermission, retractCell, checkCellDraft, migrateCellStore } from "./cells.ts";
import { parseLeafDocument } from "@foliage/leaf";
import { promoteApproved } from "./promote.ts";
import { parseHarvestDocument, reviewSubjectDigest } from "./harvestDocument.ts";

// Protocol inputs only. Never seeded into an application or presented as career results.
const at = "2026-09-05T10:00:00Z";
const later = "2026-09-05T11:00:00Z";
const observation = { source: "git", scope: "protocol-repository", object: "a".repeat(40),
  sourceRevision: "a".repeat(40), occurredAt: at, actor: "protocol author", text: "Protocol input: capture evidence" };
const empty = () => parseCellStore({ version: 2, subject: "Protocol Input", leafId: "protocol", cells: [], retractions: [], permissions: ["protocol-repository", "different-repo"].map(scope => ({ source: "git", scope, allowed: true, at, reason: "Protocol test grant" })).concat([{ source: "asana-import", scope: "789", allowed: true, at, reason: "Protocol test grant" }]) });
const task = { gid: "123", name: "Protocol task snapshot", completed: false, modified_at: at,
  assignee: { gid: "456" }, projects: [{ gid: "789" }] };

test("cell identity is stable; identical imports preserve original observation and bytes", () => {
  const store = addCell(empty(), observation, at);
  assert.strictEqual(addCell(store, { ...observation }, later), store);
  assert.deepEqual(parseCellStore(JSON.parse(JSON.stringify(store))), store);
  assert.notEqual(addCell(empty(), { ...observation, scope: "different-repo" }, at).cells[0]?.id, store.cells[0]?.id);
  assert.throws(() => parseCellStore({ ...store, cells: [{ ...store.cells[0], text: "tampered" }] }), /digest mismatch/);
  assert.throws(() => parseCellStore({ ...store, cells: [...store.cells, ...store.cells] }), /Duplicate/);
});

test("Asana snapshots are not approvals or actor attribution; import is project scoped", () => {
  const input = asanaObservation(task, "789");
  assert.equal(input.actor, null);
  assert.equal(input.source, "asana-import");
  assert.deepEqual(JSON.parse(input.text), { name: task.name, completed: false, assignee: "456" });
  assert.throws(() => asanaObservation(task, "111"), /selected project/);
  assert.throws(() => asanaObservation({ ...task, completed: undefined }, "789"), /completion/);
  assert.throws(() => asanaObservation({ ...task, score: 1 }, "789"), /Unknown/);
  assert.throws(() => asanaObservation({ ...task, modified_at: "yesterday" }, "789"), /timestamp/);
});

test("changed source revisions retain history and refuse conflicts or time reversal", () => {
  const first = addCell(empty(), asanaObservation(task, "789"), at);
  const updated = asanaObservation({ ...task, name: "Protocol revised snapshot", modified_at: later }, "789");
  const second = addCell(first, updated, later);
  assert.equal(second.cells.length, 2);
  assert.equal(second.cells[0]?.id, second.cells[1]?.id);
  assert.notEqual(second.cells[0]?.revision, second.cells[1]?.revision);
  assert.equal(first.cells[0]?.text, second.cells[0]?.text);
  assert.throws(() => addCell(second, { ...updated, text: "conflict" }, later), /conflicting content/);
  assert.throws(() => addCell(second, { ...updated, occurredAt: "2026-09-04T10:00:00Z", sourceRevision: "older" }, later), /Older/);
  assert.strictEqual(addCell(second, asanaObservation(task, "789"), later), second);
  assert.throws(() => parseCellStore({ ...second, cells: [...second.cells].reverse() }), /history/);
  const conflicting = addCell(empty(), { ...asanaObservation(task, "789"), text: "conflicting snapshot" }, later);
  assert.throws(() => parseCellStore({ ...first, cells: [...first.cells, ...conflicting.cells] }), /conflicting content/);
});

test("explicit mixed-source draft is unreviewed, bound to its subject, with original and snapshot refs", () => {
  let store = addCell(empty(), observation, at);
  store = addCell(store, asanaObservation(task, "789"), at);
  const ids = store.cells.map(c => c.id);
  const draft = draftFromCells(store, ids, "Protocol contribution draft", at);
  assert.equal(draft.subject, store.subject);
  assert.equal(draft.leafId, store.leafId);
  const candidate = draft.candidates[0]!;
  assert.equal(candidate.review.state, "candidate");
  assert.equal(candidate.evidence.length, 4);
  assert.equal(candidate.evidence[0]?.ref, observation.object);
  assert.ok(candidate.evidence[1]?.ref.startsWith(`${store.cells[0]?.id}/${store.cells[0]?.revision}/permission:`));
  assert.throws(() => draftFromCells(store, [], "Empty", at), /Select/);
  assert.throws(() => draftFromCells(store, [ids[0]!, ids[0]!], "Duplicate", at), /distinct/);
  assert.throws(() => draftFromCells(store, ["missing"], "Missing", at), /does not exist/);
  assert.throws(() => draftFromCells(store, ids, "Rated 9/10", at), /Rating/);
  const leaf = parseLeafDocument({ id: "protocol", subject: "Protocol Input", leaflets: [] });
  assert.ok(leaf.ok);
  if (!leaf.ok) return;
  const refused = promoteApproved(draft, leaf.leaf, new Set(), store);
  assert.ok(refused.ok);
  if (refused.ok) assert.equal(refused.promoted.length, 0);
  const approved = parseHarvestDocument({ ...draft, candidates: [{ ...candidate,
    review: { state: "approved", by: "Protocol reviewer", at, subjectDigest: reviewSubjectDigest(candidate) } }] });
  assert.ok(approved.ok);
  if (!approved.ok) return;
  const result = promoteApproved(approved.harvest, leaf.leaf, new Set(), store);
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.leaf.leaflets[0]?.tier, "pending");
    assert.equal(result.leaf.leaflets[0]?.body?.length, 4);
    assert.notEqual(result.leaf.leaflets[0]?.visibility, "public");
  }
});

test("new evidence creates a new draft identity, leaving an exported snapshot unchanged", () => {
  const first = addCell(empty(), asanaObservation(task, "789"), at);
  const ids = first.cells.map(c => c.id);
  const before = draftFromCells(first, ids, "Protocol draft", at);
  const second = addCell(first, asanaObservation({ ...task, modified_at: later, completed: true }, "789"), later);
  const after = draftFromCells(second, ids, "Protocol draft", later);
  assert.notEqual(before.candidates[0]?.id, after.candidates[0]?.id);
  assert.throws(() => checkCellDraft(second, before), /stale/);
  assert.ok(before.candidates[0]?.evidence[0]?.excerpt?.includes('"completed":false'));
});

test("legacy migration preserves evidence but infers no permissions", () => {
  const original = addCell(empty(), observation, at);
  const legacy = { version: 1, subject: original.subject, leafId: original.leafId, cells: original.cells };
  assert.throws(() => parseCellStore(legacy), /version 2/);
  const migrated = migrateCellStore(legacy);
  assert.deepEqual(migrated.cells, original.cells);
  assert.equal(migrated.permissions.length, 0);
  assert.throws(() => addCell(migrated, observation, later), /not allowed/);
  assert.throws(() => draftFromCells(migrated, [original.cells[0]!.id], "Protocol draft", later), /not allowed/);
});

test("denial and permanent retraction invalidate previously approved cell drafts", () => {
  const store = addCell(empty(), observation, at);
  const id = store.cells[0]!.id;
  const draft = draftFromCells(store, [id], "Protocol draft", at);
  const candidate = draft.candidates[0]!;
  const parsed = parseHarvestDocument({ ...draft, candidates: [{ ...candidate, review: { state: "approved", by: "Protocol reviewer", at, subjectDigest: reviewSubjectDigest(candidate) } }] });
  const leaf = parseLeafDocument({ id: store.leafId, subject: store.subject, leaflets: [] });
  assert.ok(parsed.ok && leaf.ok);
  if (!parsed.ok || !leaf.ok) return;
  assert.equal(promoteApproved(parsed.harvest, leaf.leaf).ok, false, "offline promotion fails closed");
  assert.equal(promoteApproved(parsed.harvest, leaf.leaf, new Set(), store).ok, true);
  const denied = setCellSourcePermission(store, "git", observation.scope, false, later, "Protocol denial");
  assert.equal(denied.cells.length, 1, "denial retains private history");
  assert.throws(() => addCell(denied, observation, later), /not allowed/);
  assert.equal(promoteApproved(parsed.harvest, leaf.leaf, new Set(), denied).ok, false);
  assert.throws(() => setCellSourcePermission(denied, "git", observation.scope, true, later, "Protocol new grant"), /must advance/);
  const allowedAgain = setCellSourcePermission(denied, "git", observation.scope, true, "2026-09-05T12:00:00Z", "Protocol new grant");
  assert.equal(promoteApproved(parsed.harvest, leaf.leaf, new Set(), allowedAgain).ok, false, "a new grant cannot revive an old approval");
  const retracted = retractCell(store, id, later, "Protocol removal");
  assert.equal(retracted.cells.length, 0);
  assert.equal(retracted.retractions[0]?.id, id);
  assert.throws(() => addCell(retracted, observation, later), /retracted/);
  assert.strictEqual(retractCell(retracted, id, later, "Retry"), retracted);
  assert.equal(promoteApproved(parsed.harvest, leaf.leaf, new Set(), retracted).ok, false);
  assert.throws(() => parseCellStore({ ...retracted, cells: store.cells }), /content must not remain/);
  assert.throws(() => checkCellDraft({ ...store, leafId: "another" }, draft), /binding/);
  assert.throws(() => checkCellDraft(store, { ...draft, candidates: [{ ...candidate, evidence: candidate.evidence.map(e => ({ ...e, excerpt: "changed" })) }] }), /altered/);
});
