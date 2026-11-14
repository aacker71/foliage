/** Form/protocol inputs: these strings are not claims about a real person's outcomes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { leafId, leafletId, parsePublishPolicy, type Leaf } from "@foliage/leaf";
import { reviewForPublication } from "./publish.ts";
import { buildPublishedDocument, parsePublishedDocument, toArtifactJson } from "./publishedDocument.ts";
import { publicCitationAnchor, publicClaimAnchor } from "./publicPortfolio.ts";
import { diffPublications } from "./republish.ts";
const provenance = { source: "git", ref: "retained-protocol-ref", observedAt: "2026-09-11T00:00:00Z" };
const citation = { leaflet: leafletId("public-input"), provenance };
const leaf: Leaf = { id: leafId("authored-protocol"), subject: "Authored protocol", headline: "Authored introduction input", profile: { bio: "Biography form input", direction: "Direction form input", passions: ["Interaction design"] }, achievements: [{ id: "keystone", title: "Achievement form input", claims: [{ id: "statement", kind: "contribution", text: "Contribution form input", citations: [citation] }, { id: "unsupported", kind: "outcome", text: "Unsupported outcome form input" }] }], collections: [{ id: "selected", title: "Selected collection input", kind: "body-of-work", leaflets: [citation.leaflet], achievements: ["keystone"] }, { id: "private-collection", title: "Unadmitted collection name", kind: "company", leaflets: [leafletId("private-input")], achievements: [] }], leaflets: [{ id: citation.leaflet, title: "Public protocol evidence", tier: "pending", visibility: "public", body: [{ text: "Retained evidence input", provenance }] }, { id: leafletId("private-input"), title: "Unadmitted evidence title", tier: "pending", provenance }] };
function build(source: Leaf = leaf, includePortfolio = true) {
  const review = reviewForPublication({ leaf: source, declaredExample: false, includePortfolio }); assert.ok(review.ok);
  const built = buildPublishedDocument({ review, publishedAt: provenance.observedAt, documentDigest: `sha256:${"a".repeat(64)}`, policyDigest: `sha256:${"b".repeat(64)}`, documentBytes: 1 }); assert.ok(built.ok);
  return { review, document: built.document, json: toArtifactJson(built.document) };
}
test("authored context is absent by default, exact selected claims survive v5, and private omissions never serialize", () => {
  const before = JSON.stringify(leaf), plain = build(leaf, false), selected = build();
  assert.equal(plain.document.leaf.portfolio, undefined);
  assert.equal(selected.document.artifactVersion, 5);
  assert.equal(selected.document.leaf.portfolio?.headline, leaf.headline);
  assert.deepEqual(selected.document.leaf.portfolio?.achievements?.[0]?.claims.map(c => c.id), ["statement"]);
  assert.deepEqual(selected.document.leaf.portfolio?.achievements?.[0]?.claims[0]?.citations, [citation]);
  const wire = JSON.stringify(selected.json); assert.doesNotMatch(wire, /Unsupported outcome|unsupported|Unadmitted|private-input|private-collection|portfolioOmissions/);
  assert.equal(selected.review.portfolioOmissions?.length, 2);
  assert.deepEqual(selected.document.withheld, plain.document.withheld, "authored omissions do not disclose private claim or collection counts");
  const parsed = parsePublishedDocument(selected.json); assert.ok(parsed.ok); assert.deepEqual(toArtifactJson(parsed.document), selected.json);
  assert.equal(diffPublications(plain.document, selected.document).portfolioChanged, true); assert.equal(diffPublications(plain.document, selected.document).identical, false);
  assert.equal(JSON.stringify(leaf), before);
});

test('private journey recovery history never enters publication and cannot be smuggled into its parser', () => {
  const current = leaf.achievements![0]!;
  const privateHistory = [{id:'private-edit',at:provenance.observedAt,actor:'manual' as const,achievement:current.id,
    before:{...current,title:'Private recovery protocol wording'},after:current}];
  const result = build({...leaf,journeyHistory:privateHistory});
  assert.doesNotMatch(JSON.stringify(result.json),/journeyHistory|private-edit|Private recovery protocol wording/);
  const injected = structuredClone(result.json) as any;
  injected.leaf.portfolio.journeyHistory=privateHistory;
  assert.equal(parsePublishedDocument(injected).ok,false);
});
test("one missing, stale, excluded, private, unlisted or policy-denied citation keeps the entire claim private", () => {
  const publicRecord = leaf.leaflets[0]!;
  const alternatives: Leaf[] = [
    { ...leaf, leaflets: [] },
    { ...leaf, leaflets: [{ ...publicRecord, body: [{ text: "Changed evidence input", provenance: { ...provenance, observedAt: "2026-09-12T00:00:00Z" } }] }] },
    { ...leaf, leaflets: [{ ...publicRecord, tier: "excluded", reason: "Protocol: another actor" }] },
    ...(["private", "unlisted"] as const).map(visibility => ({ ...leaf, leaflets: [{ ...publicRecord, visibility }] })),
    { ...leaf, achievements: [{ ...leaf.achievements![0]!, claims: [{ ...leaf.achievements![0]!.claims[0]!, citations: [citation, { ...citation, leaflet: leafletId("private-input") }] }] }] },
  ];
  for (const source of alternatives) assert.equal(build(source).document.leaf.portfolio?.achievements, undefined);
  const policy = parsePublishPolicy({ rules: [{ id: "deny", effect: "deny", match: { kind: "evidence-ref", ref: provenance.ref }, reason: "Protocol refusal" }] }); assert.ok(policy.ok);
  const review = reviewForPublication({ leaf, policy: policy.policy, declaredExample: false, includePortfolio: true }); assert.ok(review.ok); assert.equal(review.published.portfolio?.achievements, undefined);
});
test("public claims keep only numbers present in their exact cited retained evidence", () => {
  const cited = { ...leaf.leaflets[0]!, body: [
    { text: "Protocol input records 12 steps and four passes", provenance },
    { text: "Uncited protocol input records 999 steps and five passes", provenance: { ...provenance, ref: "other-protocol-ref" } },
  ] };
  const claims = [
    { id: "digit-supported", kind: "contribution" as const, text: "Recorded 12 steps", citations: [citation] },
    { id: "digit-unsupported", kind: "contribution" as const, text: "Recorded 999 steps", citations: [citation] },
    { id: "word-supported", kind: "contribution" as const, text: "Recorded four passes", citations: [citation] },
    { id: "word-unsupported", kind: "contribution" as const, text: "Recorded five passes", citations: [citation] },
  ];
  const source: Leaf = { ...leaf, leaflets: [cited, leaf.leaflets[1]!], achievements: [{ ...leaf.achievements![0]!, claims }] };
  const selected = build(source);
  assert.deepEqual(selected.document.leaf.portfolio?.achievements?.[0]?.claims.map(claim => claim.id), ["digit-supported", "word-supported"]);
  assert.deepEqual(selected.review.portfolioOmissions?.filter(omission => omission.at.includes(".claims[")).map(omission => omission.at), ["achievements[0].claims[1]", "achievements[0].claims[3]"]);
  assert.doesNotMatch(JSON.stringify(selected.json), /999|five passes|digit-unsupported|word-unsupported/);
  assert.ok(parsePublishedDocument(selected.json).ok);
});
test("signs, compound numbers, percentage units and version identifiers cannot borrow fragments", () => {
  const cited = { ...leaf.leaflets[0]!, body: [{
    text: "The retained record cites $10 cost, twenty teams, one pilot, 50 participants, protocol v2, and two checks.",
    provenance,
  }] };
  const claims = [
    { id: "cost", kind: "contribution" as const, text: "Recorded $10 cost", citations: [citation] },
    { id: "negative-cost", kind: "contribution" as const, text: "Saved -$10", citations: [citation] },
    { id: "negative-word", kind: "contribution" as const, text: "Saved negative $10", citations: [citation] },
    { id: "team-count", kind: "contribution" as const, text: "Supported twenty teams", citations: [citation] },
    { id: "compound-count", kind: "contribution" as const, text: "Supported twenty-one teams", citations: [citation] },
    { id: "participants", kind: "contribution" as const, text: "Reached 50 participants", citations: [citation] },
    { id: "percentage", kind: "contribution" as const, text: "Reached 50 percent adoption", citations: [citation] },
    { id: "version", kind: "contribution" as const, text: "Worked on protocol v2", citations: [citation] },
    { id: "different-version", kind: "contribution" as const, text: "Worked on protocol v3", citations: [citation] },
  ];
  const source: Leaf = { ...leaf, leaflets: [cited, leaf.leaflets[1]!], achievements: [{ ...leaf.achievements![0]!, claims }] };
  const selected = build(source);
  assert.deepEqual(selected.document.leaf.portfolio?.achievements?.[0]?.claims.map(claim => claim.id),
    ["cost", "team-count", "participants", "version"]);
  assert.doesNotMatch(JSON.stringify(selected.json), /negative-cost|negative-word|compound-count|percentage|different-version/);
  assert.ok(parsePublishedDocument(selected.json).ok);
});
test("public reader refuses unsafe text, private references, unknown fields, unsupported claims and older-version smuggling", () => {
  const selected = build();
  for (const mutate of [
    (x: any) => { x.artifactVersion = 4; },
    (x: any) => { x.leaf.portfolio.profile.bio = "/Users/protocol/private-note"; },
    (x: any) => { x.leaf.portfolio.profile.contact = "unexpected"; },
    (x: any) => { x.leaf.portfolio.achievements[0].claims[0].citations[0].leaflet = "private-input"; },
    (x: any) => { x.leaf.portfolio.achievements[0].claims[0].citations = []; },
    (x: any) => { x.leaf.portfolio.achievements[0].claims = []; },
    (x: any) => { x.leaf.portfolio.collections[0].leaflets.push("private-input"); },
    (x: any) => { x.leaf.portfolio.collections[0].achievements = []; x.leaf.portfolio.collections[0].leaflets = []; },
  ]) { const input = structuredClone(selected.json); mutate(input); assert.equal(parsePublishedDocument(input).ok, false); }
  const unsafe = build({ ...leaf, profile: { bio: "contact@private.invalid", direction: "Safe direction input" } });
  assert.equal(unsafe.document.leaf.portfolio?.profile?.bio, undefined); assert.equal(unsafe.document.leaf.portfolio?.profile?.direction, "Safe direction input");
});
test("exact claim and evidence anchors survive reordering and distinguish ambiguous ID pairs and observation changes", () => {
  assert.notEqual(publicClaimAnchor("a-b", "c"), publicClaimAnchor("a", "b-c"));
  assert.equal(publicClaimAnchor("a-b", "c"), publicClaimAnchor("a-b", "c"));
  assert.notEqual(publicCitationAnchor(citation), publicCitationAnchor({ ...citation, provenance: { ...provenance, observedAt: "2026-09-12T00:00:00Z" } }));
});

test("presentation survives reviewed publication while private targets cannot cross", () => {
  const source: Leaf = { ...leaf, presentation: { style: { typography: "clean", spacing: "compact", palette: "quiet", layout: "linear", hero: "stacked", media: "immersive" }, collections: [
    { id: "selected", style: { spacing: "airy", palette: "source", layout: "branching", hero: "split", media: "contained" } },
    { id: "private-collection", style: { typography: "editorial" } },
  ], leaflets: [
    { id: "public-input", style: { typography: "editorial" } },
    { id: "private-input", style: { spacing: "airy" } },
  ], history: [{ id: "private-edit", at: "2026-09-17T00:00:00.000Z", actor: "agent", scope: "portfolio", before: {}, after: { typography: "clean" } }] } };
  const selected = build(source);
  assert.deepEqual(selected.document.leaf.portfolio?.presentation, { style: { typography: "clean", spacing: "compact", palette: "quiet", layout: "linear", hero: "stacked", media: "immersive" }, collections: [{ id: "selected", style: { spacing: "airy", palette: "source", layout: "branching", hero: "split", media: "contained" } }], leaflets: [{ id: "public-input", style: { typography: "editorial" } }] });
  assert.equal(build(source, false).document.leaf.portfolio, undefined);
  assert.ok(parsePublishedDocument(selected.json).ok);
  assert.doesNotMatch(JSON.stringify(selected.json), /private-input|private-collection|private-edit|"history"/);
  const corrupted = structuredClone(selected.json) as any;
  corrupted.leaf.portfolio.presentation.leaflets.push({ id: "private-input", style: {} });
  assert.equal(parsePublishedDocument(corrupted).ok, false);
  corrupted.leaf.portfolio.presentation.leaflets.pop();
  corrupted.leaf.portfolio.presentation.collections.push({ id: "private-collection", style: {} });
  assert.equal(parsePublishedDocument(corrupted).ok, false);
  corrupted.leaf.portfolio.presentation.collections.pop();
  corrupted.leaf.portfolio.presentation.history = [];
  assert.equal(parsePublishedDocument(corrupted).ok, false);
  corrupted.leaf.portfolio.presentation = { style: { typography: "clean", score: 4 } };
  assert.equal(parsePublishedDocument(corrupted).ok, false);
});
