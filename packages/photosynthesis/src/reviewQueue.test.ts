import { test } from "node:test";
import assert from "node:assert/strict";

import { parseHarvestDocument, type HarvestCandidate } from "./harvestDocument.ts";
import { orderReviewQueue, queuePaused, shownQueue, type JevMark } from "./reviewQueue.ts";

/**
 * Synthetic queue rows: made-up ids, shas and dates that each pin one ordering rule. Nothing here
 * is read from a repository and nothing is anyone's work.
 */

const sha = (n: number): string => n.toString(16).padStart(40, "0");
let next = 0;

function row(id: string, authored: readonly (string | null)[], review: Record<string, unknown> = { state: "candidate" }): Record<string, unknown> {
  return {
    id,
    title: `synthetic ${id}`,
    extractor: "git-cluster",
    draftedAt: "2026-09-01T00:00:00Z",
    review,
    evidence: authored.map((at) => ({
      source: "git",
      ref: sha(++next),
      observedAt: "2026-09-01T00:00:00Z",
      ...(at === null ? {} : { authoredAt: at }),
    })),
  };
}

function candidates(rows: readonly Record<string, unknown>[]): readonly HarvestCandidate[] {
  const parsed = parseHarvestDocument({ candidates: rows });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.issues));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.harvest.candidates;
}

const ids = (entries: readonly { readonly candidate: HarvestCandidate }[]) => entries.map((e) => String(e.candidate.id));
const APPROVED = (at: string) => ({ state: "approved", by: "Synthetic Reviewer", at });
const REJECTED = (at: string) => ({ state: "rejected", by: "Synthetic Reviewer", at, reason: "synthetic reason" });

test("keep comes before the unmarked and unsure, which come before pass", () => {
  const queue = candidates([
    row("git-cluster:a", ["2026-08-01T00:00:00Z"]),
    row("git-cluster:b", ["2026-08-02T00:00:00Z"]),
    row("git-cluster:c", ["2026-08-03T00:00:00Z"]),
    row("git-cluster:d", ["2026-08-04T00:00:00Z"]),
  ]);
  const marks = new Map<string, JevMark>([
    ["git-cluster:d", "pass"],
    ["git-cluster:a", "keep"],
    ["git-cluster:b", "unresolved"],
  ]);
  const ordered = orderReviewQueue(queue, marks);
  assert.deepEqual(ids(ordered.open), ["git-cluster:a", "git-cluster:c", "git-cluster:b", "git-cluster:d"]);
  assert.deepEqual(ordered.open.map((e) => e.group), ["keep", "open", "open", "pass"]);
});

test("within a group the newest author date is first, undated is last, and ties break by id", () => {
  const queue = candidates([
    row("git-cluster:undated", [null]),
    row("git-cluster:old", ["2026-01-01T00:00:00Z"]),
    row("git-cluster:tie-b", ["2026-05-01T00:00:00Z"]),
    row("git-cluster:new", ["2026-02-01T00:00:00Z", "2026-09-01T00:00:00+02:00"]),
    row("git-cluster:tie-a", ["2026-05-01T00:00:00Z"]),
    row("git-cluster:also-undated", [null, null]),
  ]);
  const ordered = orderReviewQueue(queue, new Map());
  assert.deepEqual(ids(ordered.open), [
    "git-cluster:new",
    "git-cluster:tie-a",
    "git-cluster:tie-b",
    "git-cluster:old",
    "git-cluster:also-undated",
    "git-cluster:undated",
  ]);
  // The newest evidence date, verbatim, not the first entry's.
  assert.equal(ordered.open[0]!.workedAt, "2026-09-01T00:00:00+02:00");
  assert.equal(ordered.open.at(-1)!.workedAt, null);
});

test("an undated keep still outranks a dated open row, and a dated pass still sinks", () => {
  const queue = candidates([
    row("git-cluster:kept", [null]),
    row("git-cluster:fresh", ["2026-09-01T00:00:00Z"]),
    row("git-cluster:passed", ["2026-09-02T00:00:00Z"]),
  ]);
  const ordered = orderReviewQueue(queue, new Map<string, JevMark>([["git-cluster:kept", "keep"], ["git-cluster:passed", "pass"]]));
  assert.deepEqual(ids(ordered.open), ["git-cluster:kept", "git-cluster:fresh", "git-cluster:passed"]);
});

test("the order is identical across 200 shuffles of the same queue", () => {
  const rows = Array.from({ length: 24 }, (_, i) =>
    row(`git-cluster:p${i % 5}${i >= 5 ? `:${i}` : ""}`, [i % 4 === 0 ? null : `2026-0${(i % 9) + 1}-1${i % 3}T00:00:00Z`]),
  );
  const queue = candidates(rows);
  const cycle = ["keep", "pass", "unresolved"] as const;
  const marks = new Map<string, JevMark>(queue.flatMap((c, i) => (i % 2 === 0 ? [[c.id, cycle[(i / 2) % 3]!] as const] : [])));
  const expected = ids(orderReviewQueue(queue, marks).open);
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let round = 0; round < 200; round++) {
    const shuffled = [...queue].map((c) => [random(), c] as const).sort(([a], [b]) => a - b).map(([, c]) => c);
    assert.deepEqual(ids(orderReviewQueue(shuffled, marks).open), expected);
  }
});

test("decided candidates never appear in the open list and are ordered by decision time, then id", () => {
  const queue = candidates([
    row("git-cluster:open", ["2026-08-01T00:00:00Z"]),
    row("git-cluster:approved-early", ["2026-08-02T00:00:00Z"], APPROVED("2026-08-10T00:00:00Z")),
    row("git-cluster:rejected-late", ["2026-08-03T00:00:00Z"], REJECTED("2026-08-20T00:00:00Z")),
    row("git-cluster:approved-tie-b", ["2026-08-04T00:00:00Z"], APPROVED("2026-08-15T00:00:00Z")),
    row("git-cluster:approved-tie-a", ["2026-08-05T00:00:00Z"], APPROVED("2026-08-15T00:00:00Z")),
  ]);
  // A mark on a decided id is ignored; it never pulls a decided row back into the list.
  const ordered = orderReviewQueue(queue, new Map<string, JevMark>([["git-cluster:approved-early", "keep"]]));
  assert.deepEqual(ids(ordered.open), ["git-cluster:open"]);
  assert.deepEqual(ordered.decided.map((c) => String(c.id)), [
    "git-cluster:rejected-late",
    "git-cluster:approved-tie-a",
    "git-cluster:approved-tie-b",
    "git-cluster:approved-early",
  ]);
});

test("a mark for an id the queue does not hold changes nothing", () => {
  const queue = candidates([row("git-cluster:a", ["2026-08-01T00:00:00Z"]), row("git-cluster:b", ["2026-08-02T00:00:00Z"])]);
  const bare = orderReviewQueue(queue, new Map());
  const marked = orderReviewQueue(queue, new Map<string, JevMark>([["git-cluster:missing", "keep"]]));
  assert.deepEqual(marked, bare);
});

test("the ordered queue carries no number of its own: only the candidates, labels and author dates", () => {
  const queue = candidates([row("git-cluster:a", ["2026-08-01T00:00:00Z"]), row("git-cluster:b", [null])]);
  const ordered = orderReviewQueue(queue, new Map<string, JevMark>([["git-cluster:a", "keep"]]));
  for (const entry of ordered.open) {
    assert.deepEqual(Object.keys(entry).sort(), ["candidate", "group", "workedAt"]);
    assert.equal(typeof entry.group, "string");
    assert.ok(entry.workedAt === null || typeof entry.workedAt === "string");
  }
});

test("the queue is paused only when every source is paused, and no sources is not a pause", () => {
  assert.equal(queuePaused([]), false);
  assert.equal(queuePaused([{ enabled: true }, { enabled: false }]), false);
  assert.equal(queuePaused([{ enabled: false }, { enabled: false }]), true);
});

test("a paused queue hides only its undecided git drafts, and counts them", () => {
  const queue = candidates([
    row("git-cluster:open", ["2026-08-01T00:00:00Z"]),
    row("git-cluster:open:2", ["2026-08-02T00:00:00Z"]),
    row("git-cluster:decided", ["2026-08-03T00:00:00Z"], APPROVED("2026-08-10T00:00:00Z")),
    { ...row("integration-observation-import:v1:synthetic", ["2026-08-04T00:00:00Z"]), extractor: "integration-observation-import:v1" },
  ]);
  const running = shownQueue(queue, false);
  assert.equal(running.shown, queue);
  assert.deepEqual([running.open, running.hidden], [3, 0]);
  const paused = shownQueue(queue, true);
  assert.deepEqual(paused.shown.map((c) => String(c.id)), ["git-cluster:decided", "integration-observation-import:v1:synthetic"]);
  assert.deepEqual([paused.open, paused.hidden], [1, 2]);
});
