import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIndex, entryText, recencyBoost, score, tagWeight, tokenize } from "./rank.mjs";
import { deriveKeyterms, extractHeadings, extractLinks, parseFrontmatter } from "./vault.mjs";

const node = (over = {}) => ({
  id: "memory:n",
  source: "memory",
  path: "/n.md",
  title: "n",
  tags: [],
  summary: "",
  headings: [],
  keyterms: [],
  updated: 0,
  tokensEst: 100,
  wikiLinks: [],
  mdLinks: [],
  ...over,
});

test("tokenize drops stopwords and single characters", () => {
  assert.deepEqual(tokenize("The a of X appId change"), ["appid", "change"]);
});

test("non-Latin work can be retrieved while one-character noise is still dropped", () => {
  assert.deepEqual(tokenize("Решение και πρόοδος 東京開発 京"), ["решение", "και", "πρόοδος", "東京開発"]);
  assert.deepEqual(tokenize("re\u0301sume\u0301 résumé"), ["résumé", "résumé"]);
  const nodes = [node({ id: "work:design", title: "Решение для проекта", summary: "Разработка приложения" }),
    node({ id: "work:other", title: "Unrelated project" })];
  assert.deepEqual(score(buildIndex(nodes), nodes, "решение", { now: 0 }).map(hit => hit.id), ["work:design"]);
});

test("a rare term outranks a common one", () => {
  const nodes = [
    node({ id: "a", title: "release policy", summary: "release release release" }),
    node({ id: "b", title: "fcra posture", summary: "release fcra" }),
    ...Array.from({ length: 8 }, (_, i) => node({ id: `f${i}`, summary: "release notes" })),
  ];
  const idx = buildIndex(nodes);
  const ranked = score(idx, nodes, "fcra release", { now: 0 });
  assert.equal(ranked[0].id, "b", "the node matching the RARE term must win");
});

test("recency is multiplicative with a floor, so it cannot promote an irrelevant node", () => {
  const now = 100 * 86_400_000;
  const fresh = recencyBoost(now, now);
  const ancient = recencyBoost(0, now);
  assert.ok(fresh > ancient);
  assert.ok(ancient >= 0.6, "old-but-canonical notes must stay reachable");
  assert.ok(fresh <= 1.0);
  // zero relevance stays zero regardless of freshness
  const nodes = [node({ id: "old", summary: "policy", updated: 0 }), node({ id: "new", summary: "unrelated", updated: now })];
  const ranked = score(buildIndex(nodes), nodes, "policy", { now });
  assert.deepEqual(ranked.map((r) => r.id), ["old"]);
});

test("tagWeight ranks a unique tag far above a universal one", () => {
  const nodes = Array.from({ length: 10 }, (_, i) =>
    node({ id: `n${i}`, tags: i === 0 ? ["everywhere", "unique"] : ["everywhere"] }),
  );
  const idx = buildIndex(nodes);
  const universal = tagWeight(idx, "everywhere");
  const unique = tagWeight(idx, "unique");

  assert.equal(unique, 1, "a tag on exactly one node is maximally informative");
  // The number that matters is not an arbitrary threshold but the walk's edge gate: a
  // universal tag must fall BELOW it, or same_tag edges connect everything to everything.
  const WALK_EDGE_GATE = 0.35;
  assert.ok(
    universal < WALK_EDGE_GATE,
    `a universal tag (${universal.toFixed(3)}) must fall below the walk's ${WALK_EDGE_GATE} gate`,
  );
  assert.ok(unique > universal * 3, "and be dwarfed by a rare one");
  assert.equal(tagWeight(idx, "never-used"), 0);
});

test("router sources scope hard; router tags boost but never hide", () => {
  const nodes = [
    node({ id: "brain:x", source: "brain", summary: "release policy" }),
    node({ id: "memory:y", source: "memory", summary: "release policy", tags: ["rare"] }),
  ];
  const idx = buildIndex(nodes);
  const scoped = score(idx, nodes, "release", { now: 0, router: { sources: ["brain"] } });
  assert.deepEqual(scoped.map((r) => r.id), ["brain:x"], "sources are a hard scope");

  const tagged = score(idx, nodes, "release", { now: 0, router: { mustTags: ["rare"] } });
  assert.equal(tagged[0].id, "memory:y", "the tagged node is boosted to the top");
  assert.equal(tagged.length, 2, "but the untagged node is NOT filtered away");
});

test("REGRESSION: keyterms surface body vocabulary the summary omits", () => {
  // The real bug this fixes: "appid" appeared twice in a note's body and zero times in any
  // index entry, so index-only scoring could not find it at any budget.
  const target = node({
    id: "memory:rebrand",
    title: "foliage-rebrand",
    summary: "Rebrand notes, brand rationale and blast radius",
    _body: "The appId is com.coeadapt.janus. Changing appId orphans auto-update. appId again.",
  });
  const filler = Array.from({ length: 5 }, (_, i) =>
    node({ id: `n${i}`, summary: "unrelated notes", _body: "nothing relevant here at all" }),
  );
  const nodes = [target, ...filler];

  const before = buildIndex(nodes.map((n) => ({ ...n, keyterms: [] })));
  assert.equal(score(before, nodes, "appId", { now: 0 }).length, 0, "unfindable before the fix");

  deriveKeyterms(nodes);
  assert.ok(target.keyterms.includes("appid"), "appid must be extracted as a keyterm");
  const after = score(buildIndex(nodes), nodes, "appId", { now: 0 });
  assert.equal(after[0]?.id, "memory:rebrand", "findable after the fix");
});

test("deriveKeyterms never persists the body", () => {
  const nodes = [node({ _body: "some body text here that must not survive" })];
  deriveKeyterms(nodes);
  assert.equal(nodes[0]._body, undefined, "the body must be dropped, not indexed");
});

test("deriveKeyterms discards a term present in every document", () => {
  const nodes = Array.from({ length: 4 }, (_, i) =>
    node({ id: `n${i}`, _body: `ubiquitous word plus distinct${i} distinct${i}` }),
  );
  deriveKeyterms(nodes);
  for (const n of nodes) assert.ok(!n.keyterms.includes("ubiquitous"));
});

test("entryText weights title above summary", () => {
  const t = entryText(node({ title: "alpha", summary: "beta" }));
  assert.equal((t.match(/alpha/g) ?? []).length, 3);
  assert.equal((t.match(/beta/g) ?? []).length, 1);
});

test("frontmatter, headings and links parse out of real note shapes", () => {
  const text = `---\nname: thing\ndescription: "a thing"\nmetadata:\n  type: project\n---\n\n# Title\n\n## Section\n\nSee [[other-note]] and [x](./y.md).\n`;
  const { data, body } = parseFrontmatter(text);
  assert.equal(data.name, "thing");
  assert.equal(data.description, "a thing");
  assert.equal(data.metadata.type, "project");
  assert.deepEqual(extractHeadings(body), ["Title", "Section"]);
  const links = extractLinks(body);
  assert.deepEqual(links.wiki, ["other-note"]);
  assert.deepEqual(links.md, ["./y.md"]);
});

test("malformed frontmatter costs no node", () => {
  const { data, body } = parseFrontmatter("---\nnot: [closed\n\nbody here");
  assert.equal(typeof data, "object");
  assert.ok(body.length > 0);
});
