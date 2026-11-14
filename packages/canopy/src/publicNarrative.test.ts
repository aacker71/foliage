/** Contract inputs only; no person, provider result or public portfolio is fabricated. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { leafId, leafletId, parsePublishPolicy, type Leaf } from "@foliage/leaf";
import { reviewForPublication } from "./publish.ts";
import { buildPublishedDocument, parsePublishedDocument, toArtifactJson } from "./publishedDocument.ts";
import { diffPublications } from "./republish.ts";

const ref = { source: "git", ref: "abcdef1234567890", observedAt: "2026-09-09T00:00:00Z" };
const leaf: Leaf = { id: leafId("narrative-contract"), subject: "Narrative contract", leaflets: [
  { id: leafletId("work"), title: "Contract input", tier: "pending", visibility: "public", body: [
    { text: "First chosen paragraph.", provenance: ref }, { text: "Second private paragraph.", provenance: ref },
  ] },
  { id: leafletId("private"), title: "Private input", tier: "pending", body: [{ text: "Never offered.", provenance: ref }] },
] };
function build(narrative?: readonly { leaflet: number; element: number }[]) {
  const review = reviewForPublication({ leaf, declaredExample: false, ...(narrative ? { narrative } : {}) });
  assert.ok(review.ok);
  const built = buildPublishedDocument({ review, publishedAt: ref.observedAt, documentDigest: `sha256:${"a".repeat(64)}`, policyDigest: `sha256:${"b".repeat(64)}`, documentBytes: 100 });
  assert.ok(built.ok); return built.document;
}

test("narrative is absent by default and only chosen paragraphs survive canonical serialization", () => {
  const plain = build(); assert.equal(plain.leaf.leaflets[0]?.narrative, undefined);
  const selected = build([{ leaflet: 0, element: 0 }]), json = toArtifactJson(selected);
  assert.equal(selected.artifactVersion, 5);
  assert.match(JSON.stringify(json), /First chosen/); assert.doesNotMatch(JSON.stringify(json), /Second private|Never offered/);
  const parsed = parsePublishedDocument(json); assert.ok(parsed.ok);
  assert.deepEqual(toArtifactJson(parsed.document), json);
  const diff = diffPublications(plain, selected); assert.equal(diff.identical, false); assert.equal(diff.changed[0]?.narrativeChanged, true);
  assert.equal(diffPublications(selected, plain).changed[0]?.narrativeChanged, true);
  assert.equal(leaf.leaflets[0]?.body?.length, 2);
});

test("private, missing, duplicate and media selections are refused instead of widening sharing", () => {
  for (const narrative of [[{ leaflet: 1, element: 0 }], [{ leaflet: 0, element: 10 }], [{ leaflet: -1, element: 0 }], [{ leaflet: 0, element: 0 }, { leaflet: 0, element: 0 }]]) {
    assert.equal(reviewForPublication({ leaf, declaredExample: false, narrative }).ok, false);
  }
  const media: Leaf = { ...leaf, leaflets: [{ ...leaf.leaflets[0]!, body: [{ provenance: { ...ref, ref: `sha256:${"a".repeat(64)}` }, text: "Caption", media: { mediaType: "image/png", dimensions: { known: false, why: "Contract input" } } }] }] };
  assert.equal(reviewForPublication({ leaf: media, declaredExample: false, narrative: [{ leaflet: 0, element: 0 }] }).ok, false);
});

test("selected narrative obeys the leaflet policy gate, including absolute denial", () => {
  const excluded: Leaf = { ...leaf, leaflets: [{ ...leaf.leaflets[0]!, tier: "excluded", reason: "Contract: not this subject" }] };
  assert.equal(reviewForPublication({ leaf: excluded, declaredExample: false, narrative: [{ leaflet: 0, element: 0 }] }).ok, false);
  assert.equal(reviewForPublication({ leaf, declaredExample: true, narrative: [{ leaflet: 0, element: 0 }] }).ok, false);
  const denied = parsePublishPolicy({ rules: [{ id: "deny-context-ref", effect: "deny", match: { kind: "evidence-ref", ref: ref.ref }, reason: "Contract input is withheld" }] });
  assert.ok(denied.ok);
  assert.equal(reviewForPublication({ leaf, declaredExample: false, policy: denied.policy, narrative: [{ leaflet: 0, element: 0 }] }).ok, false);
});

test("read boundary rejects identifying prose, local paths, malformed refs and injected fields", () => {
  const raw = () => JSON.parse(JSON.stringify(toArtifactJson(build([{ leaflet: 0, element: 0 }]))));
  const corruptions = [
    (p: any) => { p.text = "Reach other@example.invalid"; },
    (p: any) => { p.text = "Read /Users/private-owner/work.txt"; },
    (p: any) => { p.provenance.ref = "file:///tmp/private.txt"; },
    (p: any) => { p.provenance.observedAt = "yesterday"; },
    (p: any) => { p.media = { url: "https://example.invalid/image" }; },
    (p: any) => { p.provenance.token = "private"; },
    (p: any) => { p.text = "x".repeat(4001); },
  ];
  for (const change of corruptions) { const value = raw(); change(value.leaf.leaflets[0].narrative[0]); assert.equal(parsePublishedDocument(value).ok, false); }
  for (const version of [1, 2, 3]) { const value = raw(); value.artifactVersion = version; assert.equal(parsePublishedDocument(value).ok, false, `legacy v${version} cannot smuggle narrative`); }
  const empty = raw(); empty.leaf.leaflets[0].narrative = []; assert.equal(parsePublishedDocument(empty).ok, false);
  const tooMany = raw(); tooMany.leaf.leaflets[0].narrative = Array(65).fill(tooMany.leaf.leaflets[0].narrative[0]); assert.equal(parsePublishedDocument(tooMany).ok, false);
});

test("version 3 stays readable and round-trips without silently acquiring narrative", () => {
  const json = { ...toArtifactJson(build()), artifactVersion: 3 };
  const parsed = parsePublishedDocument(json); assert.ok(parsed.ok);
  assert.deepEqual(toArtifactJson(parsed.document), json);
});
