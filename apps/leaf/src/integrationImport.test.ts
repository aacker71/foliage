/** Adversarial format/authority inputs only; none are customer evidence or provider results. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { leafId } from "@foliage/leaf";
import { parseHarvestDocument, reviewSubjectDigest } from "@foliage/photosynthesis";
import { importObservationBatch, isImportedObservationCandidate, parseObservationBatch } from "./integrationImport.ts";

const target = { id: leafId("adversarial-target"), subject: "Adversarial format input", leaflets: [] };
function input() {
  return { format: "foliage-observations", version: 1,
    subject: { leafId: target.id, name: target.subject },
    source: { provider: "adversarial-input", tenantId: null as string | null, accountId: "format-test" },
    completion: "complete", deletedRecordIds: [] as string[],
    observations: [{ recordId: "input-record", revision: "revision-1", title: "Untrusted <input>",
      excerpt: "Literal adversarial parser input, not an achievement", observedAt: "2026-09-08T00:00:00Z" }] };
}
const imported = () => importObservationBatch(parseObservationBatch(input()), target, null);

test("observations become target-bound unreviewed candidates, never provider assertions of proof", () => {
  const result = imported();
  assert.ok(parseHarvestDocument(result.document).ok);
  assert.equal(result.document.subject, target.subject);
  assert.equal(result.document.leafId, target.id);
  const candidate = result.document.candidates[0]!;
  assert.deepEqual(candidate.review, { state: "candidate" });
  assert.equal(candidate.evidence[0]?.excerpt, input().observations[0]?.excerpt);
  assert.equal(candidate.evidence[0]?.source, "integration:adversarial-input");
  assert.match(candidate.evidence[0]!.ref, /"format-test","input-record","revision-1"/);
  assert.equal("tier" in candidate, false);
  assert.equal("visibility" in candidate, false);
  assert.deepEqual(target.leaflets, []);
});

test("replay keeps the first observation clock and the exact human decision", () => {
  const first = imported(); const candidate = first.document.candidates[0]!;
  const previous = { ...first.document, candidates: [{ ...candidate,
    review: { state: "approved" as const, by: "Adversarial review harness", at: "2026-09-08T00:01:00Z", subjectDigest: reviewSubjectDigest(candidate) } }] };
  const repeat = input(); repeat.observations[0]!.observedAt = "2026-09-08T01:00:00Z";
  const result = importObservationBatch(parseObservationBatch(repeat), target, previous);
  assert.deepEqual(result.document, previous);
  assert.deepEqual(result.persisted, []);
  assert.deepEqual(result.unchanged, first.persisted);
});

test("same revision with different material refuses the entire batch; new revisions append separately", () => {
  const previous = imported().document; const before = JSON.stringify(previous);
  const conflict = input(); conflict.observations[0]!.excerpt += " changed";
  assert.throws(() => importObservationBatch(parseObservationBatch(conflict), target, previous), /different material/);
  assert.equal(JSON.stringify(previous), before);
  conflict.observations[0]!.revision = "revision-2";
  const next = importObservationBatch(parseObservationBatch(conflict), target, previous);
  assert.equal(next.document.candidates.length, 2);
  assert.deepEqual(next.document.candidates[0], previous.candidates[0]);
  assert.deepEqual(next.document.candidates[1]?.review, { state: "candidate" });
});

test("a reviewed local title edit is preserved and explicitly conflicts with replay of its original snapshot", () => {
  const first = imported().document; const candidate = { ...first.candidates[0]!, title: "Locally edited adversarial title", extractor: "reviewer:Adversarial review harness" };
  assert.equal(isImportedObservationCandidate(candidate), true);
  assert.equal(isImportedObservationCandidate({ ...candidate, evidence: [{ ...candidate.evidence[0]!, ref: candidate.evidence[0]!.ref + " " }] }), false);
  assert.equal(isImportedObservationCandidate({ ...candidate, evidence: [{ ...candidate.evidence[0]!, source: "integration:another-provider" }] }), false);
  const previous = { ...first, candidates: [{ ...candidate, review: { state: "approved" as const,
    by: "Adversarial review harness", at: "2026-09-08T00:01:00Z", subjectDigest: reviewSubjectDigest(candidate) } }] };
  const before = JSON.stringify(previous);
  assert.throws(() => importObservationBatch(parseObservationBatch(input()), target, previous), /locally edited title.*prior decisions preserved/);
  assert.equal(JSON.stringify(previous), before);
});

test("rating-shaped titles are refused while ordinary observation counts are accepted", () => {
  for (const title of ["Adversarial rating 4/5", "Adversarial rating 80%", "Adversarial rating 4 stars"]) {
    const value = input(); value.observations[0]!.title = title;
    assert.throws(() => parseObservationBatch(value), /rating-shaped/);
  }
  const value = input(); value.observations[0]!.title = "Adversarial parser input: 12 records";
  assert.equal(parseObservationBatch(value).observations[0]?.title, value.observations[0]!.title);
});

test("opaque identifiers support provider base64 records without treating URLs as ids", () => {
  const value = input(); value.observations[0]!.recordId = "AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0A/Q+1==";
  assert.equal(parseObservationBatch(value).observations[0]?.recordId, value.observations[0]!.recordId);
  value.observations[0]!.recordId = "https://example.invalid/record";
  assert.throws(() => parseObservationBatch(value), /opaque identifier/);
});

test("canonical namespaces distinguish providers, null tenants, accounts and separator-shaped ids", () => {
  const keys = new Set([imported().persisted[0]]);
  for (const mutate of [
    (v: ReturnType<typeof input>) => { v.source.provider = "another-input"; },
    (v: ReturnType<typeof input>) => { v.source.tenantId = "null"; },
    (v: ReturnType<typeof input>) => { v.source.accountId = "another-account"; },
    (v: ReturnType<typeof input>) => { v.source.accountId = "a:b"; v.observations[0]!.recordId = "c"; },
    (v: ReturnType<typeof input>) => { v.source.accountId = "a"; v.observations[0]!.recordId = "b:c"; },
  ]) {
    const value = input(); mutate(value);
    keys.add(importObservationBatch(parseObservationBatch(value), target, null).persisted[0]);
  }
  assert.equal(keys.size, 6);
});

test("partial, deleted, duplicate, oversized and privilege-bearing input is refused", () => {
  for (const mutate of [
    (v: ReturnType<typeof input>) => { v.completion = "partial"; },
    (v: ReturnType<typeof input>) => { v.deletedRecordIds = ["input-record"]; },
    (v: ReturnType<typeof input>) => { v.observations.push(v.observations[0]!); },
    (v: ReturnType<typeof input>) => { v.observations = Array.from({ length: 101 }, (_, i) => ({ ...v.observations[0]!, recordId: `adversarial-${i}` })); },
    (v: ReturnType<typeof input>) => { v.observations[0]!.title = "x".repeat(2001); },
    (v: ReturnType<typeof input>) => { Object.assign(v.observations[0]!, { review: { state: "approved" } }); },
    (v: ReturnType<typeof input>) => { Object.assign(v.observations[0]!, { tier: "verified" }); },
    (v: ReturnType<typeof input>) => { Object.assign(v.source, { token: "adversarial-secret-input" }); },
    (v: ReturnType<typeof input>) => { v.source.accountId = "https://localhost:adversarial-secret@example.invalid"; },
    (v: ReturnType<typeof input>) => { v.observations[0]!.observedAt = "yesterday"; },
  ]) { const value = input(); mutate(value); assert.throws(() => parseObservationBatch(value)); }
});

test("different or unbound nonempty targets are never inferred, while a true empty batch is harmless", () => {
  const batch = parseObservationBatch(input());
  assert.throws(() => importObservationBatch(batch, { ...target, subject: "Different declared subject" }, null), /declared subject/);
  assert.throws(() => importObservationBatch(batch, { ...target, id: leafId("different") }, null), /declared subject/);
  assert.throws(() => importObservationBatch(batch, target, { candidates: imported().document.candidates }), /incomplete subject binding/);
  const empty = input(); empty.observations = [];
  const previous = imported().document;
  assert.deepEqual(importObservationBatch(parseObservationBatch(empty), target, previous).document, previous);
});
