/** These are publication contract inputs, not records of a real person's outcomes. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPublishPolicy, leafId, leafletId, type Leaf } from "@foliage/leaf";
import { buildPublishedDocument, projectLeaf, projectLiveSearchRecords, projectPublishedSearchRecords,
  reviewForPublication } from "@foliage/canopy";
import { renderPublishedPage } from "./renderPublished.ts";
import { searchPublished } from "./searchPublished.ts";

const provenance = { source: "git", ref: "public-contract-ref", observedAt: "2026-09-09T00:00:00Z" };
const publicId = leafletId("selected"), privateId = leafletId("private"), unlistedId = leafletId("unlisted");
const leaf: Leaf = { id: leafId("public-contract"), subject: "Published contract",
  headline: "Selected headline", profile: { bio: "Selected biography", passions: ["Selected interest"] },
  achievements: [{ id: "account", title: "Selected achievement", claims: [
    { id: "contribution", kind: "contribution", text: "Selected contribution", citations: [{ leaflet: publicId, provenance }] },
    { id: "unsupported", kind: "outcome", text: "Unreviewed outcome claim" },
  ] }],
  collections: [{ id: "selected-collection", title: "Selected body of work", kind: "body-of-work",
    description: "Selected collection context", achievements: ["account"], leaflets: [publicId] }],
  leaflets: [
    { id: publicId, title: "Pending public work", tier: "pending", visibility: "public", provenance,
      body: [{ text: "Selected account from the person", provenance }, { text: "Private unselected paragraph", provenance }] },
    { id: privateId, title: "Private source title", tier: "pending", provenance },
    { id: unlistedId, title: "Unlisted linked work", tier: "pending", visibility: "unlisted", provenance },
    { id: leafletId("excluded"), title: "Excluded third party work", tier: "excluded", visibility: "public",
      reason: "Belongs to another actor" },
  ] };

function published() {
  const review = reviewForPublication({ leaf, declaredExample: false, includePortfolio: true,
    narrative: [{ leaflet: 0, element: 0 }] });
  assert.ok(review.ok);
  const built = buildPublishedDocument({ review, publishedAt: provenance.observedAt,
    documentDigest: `sha256:${"a".repeat(64)}`, policyDigest: `sha256:${"b".repeat(64)}`, documentBytes: 100 });
  assert.ok(built.ok);
  return built.document;
}

test("public search records cite text and anchors actually rendered by the admitted page", () => {
  const document = published(), records = projectPublishedSearchRecords(document);
  const byKind = new Set(records.map(record => record.kind));
  assert.deepEqual(byKind, new Set(["profile", "achievement", "claim", "collection", "leaflet"]));
  assert.equal(document.leaf.leaflets[0]?.tier, "pending");
  assert.ok(records.some(record => record.text.includes("Selected account from the person")));
  const page = renderPublishedPage({ ok: true, document, id: document.leaf.id,
    source: { path: "/protocol/published.json", bytes: 1, artifactDigest: `sha256:${"c".repeat(64)}`,
      readAt: provenance.observedAt } });
  for (const record of records) {
    const anchor = new URL(record.citation, "https://folio.invalid").hash.slice(1);
    assert.match(page, new RegExp(`id="${anchor}"`), `${record.id} has no page anchor`);
    assert.ok(page.includes(record.title), `${record.id} title is absent from the page`);
  }
  const index = JSON.stringify(records);
  const collection = records.find(record => record.id === "collection:selected-collection");
  assert.ok(collection);
  assert.equal(new URL(collection.citation, "https://folio.invalid").searchParams.get("collection"), "selected-collection");
  assert.match(collection.text, /Selected collection context/);
  assert.match(page, /<section class="lp-collection-fallback" id="portfolio-collection" aria-label="Leaf views"><ul><li><h2>Selected body of work<\/h2><p>Selected collection context<\/p>/);
  const enhancedPage = renderPublishedPage({ ok: true, document, id: document.leaf.id,
    source: { path: "/protocol/published.json", bytes: 1, artifactDigest: `sha256:${"c".repeat(64)}`,
      readAt: provenance.observedAt } }, { enhancePortfolio: true });
  assert.equal((enhancedPage.match(/id="portfolio-collection"/g) ?? []).length, 1,
    "the enhanced control and fallback must never duplicate a citation target");
  assert.match(enhancedPage, /data-description="Selected collection context"/);
  for (const forbidden of ["Private source title", "Unlisted linked work", "Excluded third party work",
    "Belongs to another actor", "Unreviewed outcome claim", "Private unselected paragraph", "score", "journeyHistory"]) {
    assert.doesNotMatch(index, new RegExp(forbidden));
  }
  // Published records never carry an exclusion reason, so public hits keep their { id, snippet } shape.
  assert.ok(records.every(record => !("reason" in record)));
  const selected = searchPublished(document, "pending", 10);
  assert.ok(selected.some(hit => hit.id === "leaflet:selected"));
  for (const hit of selected) {
    assert.deepEqual(Object.keys(hit), ["id", "snippet"]);
    const source = records.find(record => record.id === hit.id);
    assert.ok(source); assert.ok(source.text.includes(hit.snippet));
  }
  assert.deepEqual(searchPublished(document, "another actor", 10), []);
});

test("the live tree projection indexes listed work only; unlisted needs its separate link", () => {
  const policy = defaultPublishPolicy(); assert.ok(policy.ok);
  const person = projectLeaf(leaf, policy.policy), records = projectLiveSearchRecords(person);
  assert.deepEqual(records.map(record => record.id), ["profile", "leaflet:selected"]);
  assert.equal(records.find(record => record.id === "leaflet:selected")?.citation,
    "/leaf/public-contract#portfolio-record-selected");
  const onlyUnlisted = projectLeaf({ ...leaf, leaflets: [leaf.leaflets[2]!] }, policy.policy);
  assert.deepEqual(projectLiveSearchRecords(onlyUnlisted), []);
  assert.equal(reviewForPublication({ leaf, declaredExample: true }).ok, false);
});
