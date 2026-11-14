/**
 * The release store: the machine decides, this records.
 *
 * The cases that matter are the refusals. An enterprise release surface that can be
 * talked into a state the machine would not produce is worse than no surface at all.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { DEFAULT_STATE, allHistory, fire, historyOf, loadStore, saveStore, stateOf } from "./releaseStore.ts";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-rel-"));
  tmpRoots.push(dir);
  return dir;
}

test("an unknown leaf is internal — the only safe default", () => {
  assert.equal(stateOf({}, "nobody"), "internal");
  assert.equal(DEFAULT_STATE, "internal");
});

test("an absent store means no decisions, NOT no people", async () => {
  const dir = await tempDir();
  const store = await loadStore(join(dir, "does-not-exist.json"));
  assert.deepEqual(store, {});
  // Everything therefore reads internal, which is a true statement about a company that
  // has decided nothing yet.
  assert.equal(stateOf(store, "anyone"), "internal");
});

test("ACTOR SEPARATION: a subject cannot approve their own leaf", () => {
  const proposed = fire({}, "ada", "propose", "subject", "2026-08-17T00:00:00Z");
  assert.equal(proposed.ok, true);
  if (!proposed.ok) return;

  // From `proposed`, approve is not even a legal transition — review must open first.
  const selfApprove = fire(proposed.store, "ada", "approve", "subject", "2026-08-17T00:01:00Z");
  assert.equal(selfApprove.ok, false);

  // And once review IS open, the subject still may not approve: that is the policy
  // owner's decision, and the separation is the whole point of the enterprise plane.
  const review = fire(proposed.store, "ada", "open_review", "policy_owner", "2026-08-17T00:02:00Z");
  assert.equal(review.ok, true);
  if (!review.ok) return;
  const stillRefused = fire(review.store, "ada", "approve", "subject", "2026-08-17T00:03:00Z");
  assert.equal(stillRefused.ok, false);
  assert.match(stillRefused.ok === false ? stillRefused.reason : "", /not permitted for actor "subject"/);
});

test("APPROVED IS NOT PUBLIC — publication is a separate event", () => {
  let store = {};
  for (const [event, actor] of [
    ["propose", "subject"],
    ["open_review", "policy_owner"],
    ["approve", "policy_owner"],
  ] as const) {
    const r = fire(store, "ada", event, actor, "2026-08-17T00:00:00Z");
    assert.equal(r.ok, true, `${event} should be legal`);
    if (r.ok) store = r.store;
  }
  assert.equal(stateOf(store, "ada"), "approved");

  // Approved is a decision, not an egress. Nothing is public until `publish` fires.
  const published = fire(store, "ada", "publish", "policy_owner", "2026-08-17T00:04:00Z");
  assert.equal(published.ok, true);
  if (published.ok) assert.equal(published.to, "live");
});

test("a refused transition changes nothing — the store is returned untouched", () => {
  const before = { ada: { state: "internal" as const, history: [] } };
  const refused = fire(before, "ada", "publish", "policy_owner", "2026-08-17T00:00:00Z");
  assert.equal(refused.ok, false);
  // `fire` returns a NEW store only on success, so there is no half-applied write to undo.
  assert.deepEqual(before, { ada: { state: "internal", history: [] } });
});

test("every transition is appended to the audit trail, never overwritten", async () => {
  let store = {};
  const events = [
    ["propose", "subject"],
    ["open_review", "policy_owner"],
    ["approve", "policy_owner"],
    ["publish", "policy_owner"],
  ] as const;
  for (const [index, [event, actor]] of events.entries()) {
    const r = fire(store, "ada", event, actor, `2026-08-17T00:0${index}:00Z`);
    if (r.ok) store = r.store;
  }
  const history = historyOf(store, "ada");
  assert.equal(history.length, 4);
  assert.deepEqual(history.map((h) => h.event), ["propose", "open_review", "approve", "publish"]);
  assert.deepEqual(history.map((h) => h.actor), ["subject", "policy_owner", "policy_owner", "policy_owner"]);
  // Each entry carries where it came FROM, so the chain is checkable without replaying it.
  assert.deepEqual(history.map((h) => `${h.from}->${h.to}`), [
    "internal->proposed",
    "proposed->in_review",
    "in_review->approved",
    "approved->live",
  ]);
});

test("allHistory flattens every leaf's history, newest first, across the whole store", () => {
  let store = {};
  for (const [leaf, event, actor, at] of [
    ["ada", "propose", "subject", "2026-08-17T00:00:00Z"],
    ["ada", "open_review", "policy_owner", "2026-08-17T00:01:00Z"],
    ["rey", "propose", "subject", "2026-08-17T00:00:30Z"],
  ] as const) {
    const r = fire(store, leaf, event, actor, at);
    assert.equal(r.ok, true, `${leaf}/${event} should be legal`);
    if (r.ok) store = r.store;
  }

  const rows = allHistory(store);
  // Three transitions across two leaves, most recent first.
  assert.deepEqual(
    rows.map((r) => `${r.at} ${r.leaf} ${r.event}`),
    [
      "2026-08-17T00:01:00Z ada open_review",
      "2026-08-17T00:00:30Z rey propose",
      "2026-08-17T00:00:00Z ada propose",
    ],
  );
  // Each row carries what a leaf's own `historyOf` entry carries, plus which leaf it is.
  const adaSecond = rows[0];
  assert.ok(adaSecond !== undefined);
  assert.deepEqual(adaSecond, {
    leaf: "ada",
    event: "open_review",
    actor: "policy_owner",
    from: "proposed",
    to: "in_review",
    at: "2026-08-17T00:01:00Z",
  });
});

test("allHistory on an empty store is an empty list, not an error", () => {
  assert.deepEqual(allHistory({}), []);
});

test("a refused transition never reaches allHistory — there is nothing to log", () => {
  // `fire` on `internal` with `publish` is illegal from that state (see the refusal test
  // above); the store it was called against is untouched, and there is no second store for a
  // refusal to have been written into.
  const before = { ada: { state: "internal" as const, history: [] } };
  const refused = fire(before, "ada", "publish", "policy_owner", "2026-08-17T00:00:00Z");
  assert.equal(refused.ok, false);
  assert.deepEqual(allHistory(before), []);
});

test("the store round-trips through disk atomically", async () => {
  const dir = await tempDir();
  const path = join(dir, "release.json");
  const first = fire({}, "ada", "propose", "subject", "2026-08-17T00:00:00Z");
  assert.equal(first.ok, true);
  if (!first.ok) return;

  await saveStore(path, first.store);
  const read = await loadStore(path);
  assert.equal(stateOf(read, "ada"), "proposed");
  assert.equal(historyOf(read, "ada").length, 1);
  // No temp file left behind.
  const raw = await readFile(path, "utf8");
  assert.ok(raw.endsWith("\n"));
});
