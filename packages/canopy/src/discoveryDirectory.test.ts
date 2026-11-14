/** Protocol fixtures: every "Fixture Person" below is invented to exercise the directory filter.
 * None of these strings is a claim about a real person's work. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { leafId, leafletId, type Leaf } from "@foliage/leaf";
import { filterDiscoveryDirectory, type DiscoveryCandidate } from "./discoveryDirectory.ts";
import { reviewForPublication } from "./publish.ts";
import { buildPublishedDocument, type PublishedLeafDocument } from "./publishedDocument.ts";
import { projectPublishedSearchRecords } from "./publicSearch.ts";

const provenance = { source: "git", ref: "fixture-ref", observedAt: "2026-08-01T00:00:00Z" };

function publish(leaf: Leaf, publishedAt: string): PublishedLeafDocument {
  const review = reviewForPublication({ leaf, declaredExample: false, includePortfolio: true });
  assert.ok(review.ok);
  const built = buildPublishedDocument({ review, publishedAt, documentDigest: `sha256:${"a".repeat(64)}`,
    policyDigest: `sha256:${"b".repeat(64)}`, documentBytes: 1 });
  assert.ok(built.ok);
  return built.document;
}

const listed = (document: PublishedLeafDocument): DiscoveryCandidate =>
  ({ listing: { kind: "listed", leafId: String(document.leaf.id) }, declaredExample: false, document });

/** One fixture with a distinct word in every record kind the public projection emits. */
const evidence = leafletId("fixture-evidence");
const everyKind = publish({
  id: leafId("fixture-every-kind"), subject: "Fixture Person Every Kind",
  profile: { bio: "Fixture biography mentions zprofile and accessibility" },
  achievements: [{ id: "audit", title: "Fixture zachievement accessibility audit", claims: [
    { id: "focus", kind: "contribution", text: "Fixture zclaim keyboard focus order", citations: [{ leaflet: evidence, provenance }] },
  ] }],
  collections: [{ id: "views", title: "Fixture collection", kind: "body-of-work",
    description: "Fixture zcollection description", achievements: ["audit"], leaflets: [evidence] }],
  leaflets: [
    { id: evidence, title: "Fixture zleaflet accessibility fix", tier: "pending", visibility: "public", provenance },
    { id: leafletId("fixture-private"), title: "Fixture zprivate unshared work", tier: "pending", provenance },
  ],
}, "2026-09-01T00:00:00Z");

const groupsOf = (result: ReturnType<typeof filterDiscoveryDirectory>) => {
  assert.equal(result.kind, "groups");
  return result.kind === "groups" ? result.groups : [];
};

test("a listed person appears once, with one hit from their own work and a link to their page", () => {
  const [group, ...rest] = groupsOf(filterDiscoveryDirectory([listed(everyKind)], { terms: "accessibility", order: "name" }));
  assert.equal(rest.length, 0);
  assert.deepEqual(group, {
    person: { name: "Fixture Person Every Kind", nameRedacted: false },
    // The profile also says "accessibility", and the leaflet does too. The hit is the FIRST piece
    // of work in the person's own published order — the achievement — never their self-description.
    hit: { title: "Fixture zachievement accessibility audit", basis: "work",
      citation: "/leaf/fixture-every-kind#achievement-audit" },
    portfolio: "/leaf/fixture-every-kind",
    publishedAt: "2026-09-01T00:00:00Z",
  });
});

test("the hit says whether it came from the person's own description or from their work", () => {
  // Pinned: these are the kinds the public projection emits today. A new kind must be classified
  // on purpose; until it is, the directory never cites it.
  assert.deepEqual(new Set(projectPublishedSearchRecords(everyKind).map(record => record.kind)),
    new Set(["profile", "achievement", "claim", "collection", "leaflet"]));
  const hitFor = (terms: string) => groupsOf(filterDiscoveryDirectory([listed(everyKind)], { terms, order: "name" }))[0]?.hit;
  assert.deepEqual(hitFor("zprofile"), { title: "Fixture Person Every Kind", basis: "self-described",
    citation: "/leaf/fixture-every-kind#personal-subject-h" });
  assert.equal(hitFor("zcollection")?.basis, "self-described");
  assert.equal(hitFor("zachievement")?.basis, "work");
  assert.equal(hitFor("zclaim")?.basis, "work");
  assert.deepEqual(hitFor("zleaflet"), { title: "Fixture zleaflet accessibility fix", basis: "work",
    citation: "/leaf/fixture-every-kind#portfolio-record-fixture-evidence" });
});

test("every word the reader types must appear in the one record cited; nothing is weighted", () => {
  const both = filterDiscoveryDirectory([listed(everyKind)], { terms: "Keyboard  ACCESSIBILITY", order: "name" });
  assert.equal(groupsOf(both)[0]?.hit.citation, "/leaf/fixture-every-kind#achievement-audit");
  const split = filterDiscoveryDirectory([listed(everyKind)], { terms: "zprofile zleaflet", order: "name" });
  assert.deepEqual(groupsOf(split), [], "words found only in two different records do not make a hit");
  assert.deepEqual(groupsOf(filterDiscoveryDirectory([listed(everyKind)], { terms: "access", order: "name" })), [],
    "a word matches whole words, not prefixes");
  // Full-width letters and the "ﬁ" ligature are the same words once compatibility forms are folded.
  assert.equal(groupsOf(filterDiscoveryDirectory([listed(everyKind)], { terms: "ＡＣＣＥＳＳＩＢＩＬＩＴＹ ﬁxture", order: "name" }))[0]?.hit.citation,
    "/leaf/fixture-every-kind#achievement-audit");
});

test("private work and a person with no matching record are absent, not padded", () => {
  assert.deepEqual(groupsOf(filterDiscoveryDirectory([listed(everyKind)], { terms: "zprivate", order: "name" })), []);
  assert.deepEqual(groupsOf(filterDiscoveryDirectory([listed(everyKind)], { terms: "astronomy", order: "name" })), []);
});

test("invalid terms and orders are refused by name", () => {
  const people = [listed(everyKind)];
  for (const terms of ["", "   ", "!!! ---"]) {
    assert.deepEqual(filterDiscoveryDirectory(people, { terms, order: "name" }), { kind: "empty-terms" });
  }
  assert.deepEqual(filterDiscoveryDirectory(people, { terms: "a".repeat(301), order: "name" }), { kind: "terms-too-long" });
  assert.equal(filterDiscoveryDirectory(people, { terms: ` ${"a".repeat(300)} `, order: "name" }).kind, "groups");
  assert.deepEqual(filterDiscoveryDirectory(people, { terms: "accessibility", order: "relevance" as never }),
    { kind: "unknown-order" });
});

test("the reader chooses alphabetical or most recently published; ties fall back to name, then page", () => {
  const person = (id: string, subject: string, publishedAt: string) => publish({ id: leafId(id), subject,
    leaflets: [{ id: leafletId(`${id}-work`), title: "Fixture accessibility work", tier: "pending", visibility: "public", provenance }] },
  publishedAt);
  const people = [
    person("fixture-cy", "Fixture Person Cy", "2026-09-20T00:00:00Z"),
    person("fixture-ada", "fixture person Ada", "2026-08-15T00:00:00Z"),
    person("fixture-bea-2", "Fixture Person Bea", "2026-09-01T00:00:00+02:00"),
    person("fixture-bea-1", "Fixture Person Bea", "2026-08-31T22:00:00Z"),
  ].map(listed);
  const pages = (order: "name" | "recently-published") =>
    groupsOf(filterDiscoveryDirectory(people, { terms: "accessibility", order })).map(group => group.portfolio);
  assert.deepEqual(pages("name"), ["/leaf/fixture-ada", "/leaf/fixture-bea-1", "/leaf/fixture-bea-2", "/leaf/fixture-cy"]);
  // fixture-bea-1 and -2 were published at the same instant, written with different offsets.
  assert.deepEqual(pages("recently-published"),
    ["/leaf/fixture-cy", "/leaf/fixture-bea-1", "/leaf/fixture-bea-2", "/leaf/fixture-ada"]);
});

test("consent is bound to one person's page and two entries for one page are refused", () => {
  const other = publish({ id: leafId("fixture-other"), subject: "Fixture Person Other", leaflets: [
    { id: leafletId("fixture-other-work"), title: "Fixture accessibility notes", tier: "pending", visibility: "public", provenance },
  ] }, "2026-09-02T00:00:00Z");
  const borrowed: DiscoveryCandidate = { listing: { kind: "listed", leafId: "fixture-every-kind" }, declaredExample: false, document: other };
  assert.deepEqual(groupsOf(filterDiscoveryDirectory([borrowed], { terms: "accessibility", order: "name" })), [],
    "a listing recorded for one page never lists another");
  assert.deepEqual(filterDiscoveryDirectory([listed(everyKind), listed(everyKind)], { terms: "accessibility", order: "name" }),
    { kind: "duplicate-person" });
});

test("a redacted name stays labelled as redacted in the directory", () => {
  const redacted = { ...everyKind, leaf: { ...everyKind.leaf, subjectRedacted: true } };
  assert.equal(groupsOf(filterDiscoveryDirectory([listed(redacted)], { terms: "accessibility", order: "name" }))[0]?.person.nameRedacted, true);
});
