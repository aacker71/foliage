import assert from "node:assert/strict";
import { test } from "node:test";
import { leafId, leafletId, parseLeafDocument, type Leaf } from "@foliage/leaf";
import { brainRecords } from "./brainPages.ts";
import { parseHarvestDocument } from "./harvestDocument.ts";
import { promoteApproved } from "./promote.ts";
import { gardenSearchRecords, searchRecords } from "./searchGarden.ts";

test("shared work retrieval returns bounded source text and citations without a rating", () => {
  const records = [
    { id: "source:rank", kind: "source", title: "Ranker implementation", text: "BM25 ranks source entries using term frequency and document frequency.", citation: "source:tools/vault/lib/rank.mjs" },
    { id: "source:search", kind: "source", title: "Search implementation", text: "The private record search reads selected local documents.", citation: "source:packages/photosynthesis/src/searchGarden.ts" },
  ];
  const hits = searchRecords(records, "document frequency", { limit: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.id, "source:rank");
  assert.equal(hits[0]?.citation, records[0]?.citation);
  assert.equal(hits[0]?.snippet, records[0]?.text);
  assert.ok(!("score" in hits[0]!));
  assert.equal(searchRecords(records, "absentterm").length, 0);
  assert.throws(() => searchRecords(records, "frequency", { limit: 11 }), /1–10/);
  assert.throws(() => searchRecords([records[0]!, records[0]!], "frequency"), /unique/);
});

test("shared private and public retrieval can return cited non-Latin work without a score", () => {
  const hits = searchRecords([{ id: "work:design", kind: "work", title: "東京開発", text: "東京開発の記録", citation: "/leaf/design#work" }], "東京開発");
  assert.deepEqual(hits, [{ id: "work:design", kind: "work", title: "東京開発", snippet: "東京開発の記録", citation: "/leaf/design#work" }]);
});

test("an excluded leaflet's hit is its reason, never an excerpt of its body", () => {
  // Synthetic fixture: the 500-character body stands in for another contributor's work.
  const provenance = { source: "git", ref: "synthetic-ref", observedAt: "2026-10-10T00:00:00Z" };
  const reason = "Synthetic reason: this work belongs to a different author.";
  const body = "Bodymarker synthetic stand-in paragraph written by someone else. ".repeat(10).slice(0, 500);
  assert.equal(body.length, 500);
  const leaf: Leaf = { id: leafId("synthetic-excluded"), subject: "Synthetic subject", leaflets: [
    { id: leafletId("outside"), title: "Quillwort migration notes", tier: "excluded", reason, body: [{ text: body, provenance }] },
    { id: leafletId("own"), title: "Quillwort own account", tier: "pending", provenance, body: [{ text: "Own pending account", provenance }] },
  ] };
  const records = gardenSearchRecords({ leaf });
  const outside = records.find(record => record.id === "leaflet:outside");
  assert.equal(outside?.reason, reason);
  // The body is not even searchable text, so no query can probe which words it holds.
  assert.equal(outside?.text, reason);
  assert.ok(records.every(record => record.id === "leaflet:outside" || !("reason" in record)));
  // A title-only match and a reason match both return only the reason.
  for (const query of ["Quillwort", "different author"]) {
    const hits = searchRecords(records, query);
    const excluded = hits.find(hit => hit.id === "leaflet:outside");
    assert.ok(excluded, query);
    assert.equal(excluded.snippet, reason);
    assert.equal(excluded.reason, reason);
    assert.doesNotMatch(JSON.stringify(hits), /bodymarker/i);
  }
  // A word found only in the excluded body finds nothing.
  assert.deepEqual(searchRecords(records, "Bodymarker"), []);
  const own = searchRecords(records, "Quillwort").find(hit => hit.id === "leaflet:own");
  assert.ok(own && !("reason" in own), "only an excluded hit carries a reason");
  // Even a record whose text holds a body shows only its reason. A reason longer than an excerpt
  // is bounded in the snippet and whole in the reason field.
  const long = `${"Synthetic longer reason. ".repeat(12)}`.trim();
  const [hit] = searchRecords([{ id: "x", kind: "excluded leaflet", title: "Quillwort", text: body, citation: "leaf:x", reason: long }], "Quillwort");
  assert.equal(hit?.reason, long);
  assert.ok(hit && hit.snippet.length <= 240 && long.includes(hit.snippet));
});

test("a promoted leaflet's commit is one piece of evidence in its search record, as on /leaf and in the export", () => {
  // Parser inputs through the real gates and the real promotion; no person or work is represented.
  const at = "2026-10-10T00:00:00Z";
  const leaf = parseLeafDocument({ id: "synthetic-promoted", subject: "Synthetic subject", leaflets: [] });
  const harvest = parseHarvestDocument({ leafId: "synthetic-promoted", subject: "Synthetic subject", candidates: [{
    id: "git-cluster:feat", title: "feat: synthetic sedge index", extractor: "git-cluster", draftedAt: at,
    review: { state: "approved", by: "synthetic reviewer", at },
    evidence: [{ source: "git", ref: "1".repeat(40), observedAt: at, excerpt: "feat: synthetic sedge index" },
      { source: "git", ref: "2".repeat(40), observedAt: at, excerpt: "feat: synthetic sedge filter" }],
  }] });
  assert.ok(leaf.ok && harvest.ok);
  const promoted = promoteApproved(harvest.harvest, leaf.leaf);
  assert.ok(promoted.ok);
  const input = { leaf: promoted.leaf, harvest: harvest.harvest };
  const one = (source: string, ref: string) => ({ source, ref, observedAt: at });
  const record = gardenSearchRecords(input).find(entry => entry.id === "leaflet:git-cluster:feat");
  // Promotion wrote the first commit twice: as the drafter's handle and as the first body element.
  assert.equal(promoted.leaf.leaflets[0]?.provenance?.source, "photosynthesis:git-cluster");
  assert.deepEqual(record?.evidence, [one("git", "1".repeat(40)), one("git", "2".repeat(40))]);
  // foliage search and foliage_search answer from brainRecords; the hit lists each commit once.
  const hit = searchRecords(brainRecords(input), "sedge").find(found => found.id === "leaflet:git-cluster:feat");
  assert.ok(hit, "the promoted leaflet is found");
  assert.deepEqual(hit?.evidence, [one("git", "1".repeat(40)), one("git", "2".repeat(40))]);
  assert.doesNotMatch(JSON.stringify(hit), /photosynthesis:/);
  // A drafter's provenance that is not a body element's (another instant) is a second fact and stays.
  const later = { ...promoted.leaf, leaflets: promoted.leaf.leaflets.map(leaflet => ({ ...leaflet, provenance: { ...leaflet.provenance!, observedAt: "2026-10-11T00:00:00Z" } })) };
  assert.equal(gardenSearchRecords({ leaf: later }).find(entry => entry.id === "leaflet:git-cluster:feat")?.evidence?.length, 3);
});

test("a draft promoted into the Leaf is found once, as its leaflet; unpromoted and rejected drafts are found as before", () => {
  // Parser inputs through the real gates and the real promotion; no person or work is represented.
  const at = "2026-10-10T00:00:00Z";
  const candidate = (id: string, title: string, ref: string, review: Record<string, string>) => ({ id, title, extractor: "git-cluster", draftedAt: at, review,
    evidence: [{ source: "git", ref: ref.repeat(40), observedAt: at, excerpt: `${title}, the synthetic commit` }] });
  const approved = { state: "approved", by: "synthetic reviewer", at };
  const harvestDoc = { leafId: "synthetic-twice", subject: "Synthetic subject", candidates: [
    candidate("git-cluster:feat", "feat: synthetic rushwort index", "1", approved),
    candidate("git-cluster:docs", "docs: synthetic rushwort guide", "2", { state: "candidate" }),
    candidate("git-cluster:chore", "chore: synthetic rushwort sweep", "3", { state: "rejected", by: "synthetic reviewer", at, reason: "Synthetic: not this person's work." }),
  ] };
  const leaf = parseLeafDocument({ id: "synthetic-twice", subject: "Synthetic subject", leaflets: [] });
  const harvest = parseHarvestDocument(harvestDoc);
  assert.ok(leaf.ok && harvest.ok);
  const ids = (input: Parameters<typeof gardenSearchRecords>[0]) => searchRecords(brainRecords(input), "rushwort").map(hit => hit.id).sort();

  // Approved but not promoted yet: the draft is the only record of that work.
  assert.deepEqual(ids({ leaf: leaf.leaf, harvest: harvest.harvest }), ["draft:git-cluster:chore", "draft:git-cluster:docs", "draft:git-cluster:feat"]);

  const promoted = promoteApproved(harvest.harvest, leaf.leaf);
  assert.ok(promoted.ok);
  assert.deepEqual(promoted.promoted, ["git-cluster:feat"]);
  const input = { leaf: promoted.leaf, harvest: harvest.harvest };
  // Promoted: the leaflet only. The unreviewed and the rejected draft stay as they were.
  assert.deepEqual(ids(input), ["draft:git-cluster:chore", "draft:git-cluster:docs", "leaflet:git-cluster:feat"]);
  assert.deepEqual(gardenSearchRecords(input).map(record => record.id).filter(id => id.endsWith("git-cluster:feat")), ["leaflet:git-cluster:feat"],
    "the promoted draft is not a search record at all, so the brain holds no page for it either");
  const leaflet = searchRecords(brainRecords(input), "rushwort index").find(hit => hit.id === "leaflet:git-cluster:feat");
  assert.deepEqual(leaflet?.evidence, [{ source: "git", ref: "1".repeat(40), observedAt: at }], "the leaflet carries the draft's evidence");

  // A leaflet of the same id that promotion did not write (its provenance names no drafter) is other work: the approved draft stays.
  const handWritten = { ...leaf.leaf, leaflets: [{ id: leafletId("git-cluster:feat"), title: "Synthetic hand-written rushwort entry", tier: "pending" as const,
    provenance: { source: "git", ref: "1".repeat(40), observedAt: at } }] };
  assert.deepEqual(ids({ leaf: handWritten, harvest: harvest.harvest }),
    ["draft:git-cluster:chore", "draft:git-cluster:docs", "draft:git-cluster:feat", "leaflet:git-cluster:feat"]);
});
