/** LAWS of the collaborator directory. Protocol fixtures: every "Fixture Person" is invented to
 * exercise the filter; none of these strings is a claim about a real person's work. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { leafId, leafletId, type Leaf } from "@foliage/leaf";
import { filterDiscoveryDirectory, type DiscoveryCandidate, type DiscoveryOrder } from "./discoveryDirectory.ts";
import { reviewForPublication } from "./publish.ts";
import { buildPublishedDocument, type PublishedLeafDocument } from "./publishedDocument.ts";

const provenance = { source: "git", ref: "fixture-ref", observedAt: "2026-08-01T00:00:00Z" };

function person(id: string, subject: string, publishedAt: string, title: string, bio = "Fixture biography"): PublishedLeafDocument {
  const work = leafletId(`${id}-work`);
  const review = reviewForPublication({ declaredExample: false, includePortfolio: true, leaf: {
    id: leafId(id), subject, profile: { bio },
    leaflets: [{ id: work, title, tier: "pending", visibility: "public", provenance }],
  } });
  assert.ok(review.ok);
  const built = buildPublishedDocument({ review, publishedAt, documentDigest: `sha256:${"a".repeat(64)}`,
    policyDigest: `sha256:${"b".repeat(64)}`, documentBytes: 1 });
  assert.ok(built.ok);
  return built.document;
}

const listed = (document: PublishedLeafDocument): DiscoveryCandidate =>
  ({ listing: { kind: "listed", leafId: String(document.leaf.id) }, declaredExample: false, document });

const notListed = person("fixture-unlisted", "Fixture Person Unlisted", "2026-09-30T00:00:00Z", "Fixture accessibility work, not listed");
const people: readonly DiscoveryCandidate[] = [
  listed(person("fixture-cy", "Fixture Person Cy", "2026-08-15T00:00:00Z", "Fixture notes", "Fixture biography about accessibility")),
  { listing: { kind: "not-listed" }, declaredExample: false, document: notListed },
  listed(person("fixture-bea-2", "Fixture Person Bea", "2026-09-20T00:00:00Z", "Fixture accessibility checklist")),
  listed(person("fixture-none", "Fixture Person None", "2026-09-25T00:00:00Z", "Fixture unrelated work")),
  listed(person("fixture-bea-1", "Fixture Person Bea", "2026-09-20T00:00:00Z", "Fixture accessibility review")),
  listed(person("fixture-ada", "Fixture Person Ada", "2026-09-01T00:00:00Z", "Fixture accessibility audit")),
];
const ORDERS: readonly DiscoveryOrder[] = ["name", "recently-published"];
const request = (order: DiscoveryOrder) => ({ terms: "accessibility", order });

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map(rest => [item, ...rest]));
}

test("LAW: shuffling who is in the input never changes the output", () => {
  for (const order of ORDERS) {
    const expected = JSON.stringify(filterDiscoveryDirectory(people, request(order)));
    assert.match(expected, /fixture-bea-1.*fixture-bea-2/, "equal names and dates still have one order");
    for (const shuffled of permutations(people)) {
      assert.equal(JSON.stringify(filterDiscoveryDirectory(shuffled, request(order))), expected);
    }
  }
});

/** What a person's page says, apart from who they are and when they published. Each profile gives
 * the hit different features a relevance sort could key on: its basis, how many records match,
 * and how long the cited title is. */
type Content = (id: string) => Pick<Leaf, "profile" | "achievements" | "leaflets">;
const work = (id: string, slug: string, title: string) =>
  ({ id: leafletId(`${id}-${slug}`), title, tier: "pending" as const, visibility: "public" as const, provenance });
const CONTENTS: readonly Content[] = [
  // Self-described only: the profile is the one matching record.
  id => ({ profile: { bio: "Fixture biography about accessibility" }, leaflets: [work(id, "notes", "Fixture notes")] }),
  // One short piece of work.
  id => ({ profile: { bio: "Fixture biography" }, leaflets: [work(id, "audit", "Fixture accessibility audit")] }),
  // Many matching records of every work kind, plus the longest title.
  id => {
    const cited = work(id, "review", "Fixture accessibility review of every fixture form, menu and dialog");
    return {
      profile: { bio: "Fixture biography about accessibility" },
      achievements: [{ id: "programme", title: "Fixture accessibility programme across many fixture teams and fixture services",
        claims: [{ id: "lead", kind: "contribution", text: "Fixture accessibility lead", citations: [{ leaflet: cited.id, provenance }] }] }],
      leaflets: [cited, work(id, "checklist", "Fixture accessibility checklist for fixture release reviews")],
    };
  },
];

function publishAs(id: string, subject: string, publishedAt: string, content: Content): DiscoveryCandidate {
  const review = reviewForPublication({ declaredExample: false, includePortfolio: true,
    leaf: { id: leafId(id), subject, ...content(id) } });
  assert.ok(review.ok);
  const built = buildPublishedDocument({ review, publishedAt, documentDigest: `sha256:${"a".repeat(64)}`,
    policyDigest: `sha256:${"b".repeat(64)}`, documentBytes: 1 });
  assert.ok(built.ok);
  return listed(built.document);
}

test("LAW: the order of people comes from what the reader chose and nothing else — never from how well they match", () => {
  // Who each person is and when they published stay fixed; what their page says is dealt out in
  // every arrangement. Abe is first by name and most recent; Zed is last by name and oldest.
  const who = [
    ["fixture-abe", "Fixture Person Abe", "2026-09-30T00:00:00Z"],
    ["fixture-mia", "Fixture Person Mia", "2026-08-01T00:00:00Z"],
    ["fixture-zed", "Fixture Person Zed", "2026-07-01T00:00:00Z"],
  ] as const;
  const expected: Readonly<Record<DiscoveryOrder, readonly string[]>> = {
    "name": ["/leaf/fixture-abe", "/leaf/fixture-mia", "/leaf/fixture-zed"],
    "recently-published": ["/leaf/fixture-abe", "/leaf/fixture-mia", "/leaf/fixture-zed"],
  };
  const reordered = [
    ["fixture-abe", "Fixture Person Abe", "2026-07-01T00:00:00Z"],
    ["fixture-mia", "Fixture Person Mia", "2026-09-30T00:00:00Z"],
    ["fixture-zed", "Fixture Person Zed", "2026-08-01T00:00:00Z"],
  ] as const;
  const expectedReordered: Readonly<Record<DiscoveryOrder, readonly string[]>> = {
    "name": ["/leaf/fixture-abe", "/leaf/fixture-mia", "/leaf/fixture-zed"],
    "recently-published": ["/leaf/fixture-mia", "/leaf/fixture-zed", "/leaf/fixture-abe"],
  };
  for (const [people, pagesFor] of [[who, expected], [reordered, expectedReordered]] as const) {
    for (const dealt of permutations(CONTENTS)) {
      const candidates = people.map(([id, subject, at], index) => publishAs(id, subject, at, dealt[index]!));
      for (const order of ORDERS) {
        const result = filterDiscoveryDirectory(candidates, request(order));
        assert.ok(result.kind === "groups");
        assert.deepEqual(new Set(result.groups.map(group => group.hit.basis)), new Set(["work", "self-described"]),
          "the arrangement really mixes work and self-description");
        assert.deepEqual(result.groups.map(group => group.portfolio), pagesFor[order],
          `${order} order changed when ${dealt.map(content => CONTENTS.indexOf(content)).join(",")} was dealt`);
      }
    }
  }
});

test("LAW: every group has exactly the same keys, and none of them is a score, rank or count", () => {
  const shape = ["hit", "hit.basis", "hit.citation", "hit.title", "person", "person.name", "person.nameRedacted",
    "portfolio", "publishedAt"];
  const keys = (value: unknown, at = ""): string[] => typeof value !== "object" || value === null ? [] :
    Object.entries(value).flatMap(([key, inner]) => [`${at}${key}`, ...keys(inner, `${at}${key}.`)]).sort();
  for (const order of ORDERS) {
    const result = filterDiscoveryDirectory(people, request(order));
    assert.deepEqual(Object.keys(result).sort(), ["groups", "kind"]);
    assert.ok(result.kind === "groups" && result.groups.length === 4);
    for (const group of result.groups) assert.deepEqual(keys(group), shape);
  }
});

test("LAW: no numeric field appears; the only date is when the person's page was published", () => {
  const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  const walk = (value: unknown, at: string): void => {
    assert.notEqual(typeof value, "number", `${at} is a number`);
    assert.notEqual(typeof value, "bigint", `${at} is a number`);
    if (typeof value === "string") {
      if (at === "publishedAt") assert.match(value, ISO_INSTANT);
      else assert.doesNotMatch(value, ISO_INSTANT, `${at} carries a date`);
    }
    if (typeof value === "object" && value !== null) for (const [key, inner] of Object.entries(value)) walk(inner, key);
  };
  for (const order of ORDERS) walk(filterDiscoveryDirectory(people, request(order)), "result");
});

test("LAW: a person who did not opt in never appears, however well their work matches", () => {
  const borrowed: DiscoveryCandidate = { listing: { kind: "listed", leafId: "fixture-ada" }, declaredExample: false, document: notListed };
  const unlistedOnly: readonly DiscoveryCandidate[] = [{ listing: { kind: "not-listed" }, declaredExample: false, document: notListed }];
  for (const order of ORDERS) {
    for (const input of [people, unlistedOnly, [borrowed]]) {
      const text = JSON.stringify(filterDiscoveryDirectory(input, request(order)));
      assert.doesNotMatch(text, /fixture-unlisted|Fixture Person Unlisted|not listed/);
    }
    assert.match(JSON.stringify(filterDiscoveryDirectory(people, request(order))), /fixture-ada/, "listed people beside them do appear");
    assert.deepEqual(filterDiscoveryDirectory(unlistedOnly, { terms: "unlisted", order }), { kind: "groups", groups: [] });
  }
});

test("LAW: a directory holding an example document is refused whole, listed or not", () => {
  const example = (listing: DiscoveryCandidate["listing"]): DiscoveryCandidate =>
    ({ listing, declaredExample: true, document: person("fixture-example", "Fixture Example", "2026-09-03T00:00:00Z", "Fixture accessibility example") });
  for (const order of ORDERS) {
    for (const candidate of [example({ kind: "listed", leafId: "fixture-example" }), example({ kind: "not-listed" })]) {
      assert.deepEqual(filterDiscoveryDirectory([...people, candidate], request(order)), { kind: "example-refused" });
    }
    // A caller that never said whether its source is an example is treated as one.
    const unsaid = { ...listed(person("fixture-unsaid", "Fixture Unsaid", "2026-09-03T00:00:00Z", "Fixture accessibility")),
      declaredExample: undefined } as unknown as DiscoveryCandidate;
    assert.deepEqual(filterDiscoveryDirectory([unsaid], request(order)), { kind: "example-refused" });
  }
});

test("LAW: only the published projection can match; text smuggled onto the document is never read", () => {
  const ada = person("fixture-smuggle", "Fixture Person Smuggle", "2026-09-04T00:00:00Z", "Fixture work");
  const smuggled = { ...ada, privateNotes: "zsmuggled", leaf: { ...ada.leaf, privateNotes: "zsmuggled" } } as PublishedLeafDocument;
  assert.deepEqual(filterDiscoveryDirectory([listed(smuggled)], { terms: "zsmuggled", order: "name" }), { kind: "groups", groups: [] });
});
