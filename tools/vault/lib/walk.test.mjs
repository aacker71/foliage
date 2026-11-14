import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIndex } from "./rank.mjs";
import { buildGraph, buildResolver, EDGE_WEIGHT, walk } from "./walk.mjs";

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

test("a wikilink creates links_to forward and linked_by reverse", () => {
  const nodes = [
    node({ id: "memory:a", title: "a", wikiLinks: ["b"] }),
    node({ id: "memory:b", title: "b" }),
  ];
  const g = buildGraph(nodes, buildIndex(nodes));
  assert.deepEqual(
    g.adj.get("memory:a").map((e) => [e.to, e.type]),
    [["memory:b", "links_to"]],
  );
  assert.deepEqual(
    g.adj.get("memory:b").map((e) => [e.to, e.type]),
    [["memory:a", "linked_by"]],
  );
  assert.equal(g.stats.resolved, 1);
  assert.equal(g.stats.dangling, 0);
});

test("an unresolvable wikilink is counted as dangling, not fatal", () => {
  const nodes = [node({ id: "memory:a", title: "a", wikiLinks: ["nope"] })];
  const g = buildGraph(nodes, buildIndex(nodes));
  assert.equal(g.stats.dangling, 1);
  assert.deepEqual(g.adj.get("memory:a"), []);
});

test("a universal tag creates NO edges — otherwise the walk degenerates", () => {
  const nodes = Array.from({ length: 10 }, (_, i) => node({ id: `n${i}`, title: `n${i}`, tags: ["memory"] }));
  const g = buildGraph(nodes, buildIndex(nodes));
  const edges = [...g.adj.values()].reduce((s, v) => s + v.length, 0);
  assert.equal(edges, 0, "a tag shared by every node is not a relationship");
});

test("a rare shared tag DOES create edges", () => {
  const nodes = [
    node({ id: "a", title: "a", tags: ["fcra", "memory"] }),
    node({ id: "b", title: "b", tags: ["fcra", "memory"] }),
    ...Array.from({ length: 8 }, (_, i) => node({ id: `f${i}`, title: `f${i}`, tags: ["memory"] })),
  ];
  const g = buildGraph(nodes, buildIndex(nodes));
  const fromA = g.adj.get("a").filter((e) => e.type === "same_tag");
  assert.equal(fromA.length, 1);
  assert.equal(fromA[0].to, "b");
  assert.ok(fromA[0].weight > 0 && fromA[0].weight <= EDGE_WEIGHT.same_tag);
});

test("the resolver matches by id, title and basename", () => {
  const nodes = [node({ id: "brain:projects/deep-thing", title: "Deep Thing" })];
  const r = buildResolver(nodes);
  assert.equal(r("Deep Thing"), "brain:projects/deep-thing");
  assert.equal(r("deep-thing"), "brain:projects/deep-thing");
  assert.equal(r("projects/deep-thing"), "brain:projects/deep-thing");
  assert.equal(r("deep-thing.md"), "brain:projects/deep-thing");
  assert.equal(r("missing"), null);
});

test("walk respects the token budget and reports what it skipped", () => {
  const nodes = [
    node({ id: "a", title: "a", tokensEst: 400, wikiLinks: ["b"] }),
    node({ id: "b", title: "b", tokensEst: 5000 }),
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const g = buildGraph(nodes, buildIndex(nodes));
  const r = walk(g, [{ id: "a", score: 10 }], byId, { budgetTokens: 1000 });
  assert.deepEqual(r.selected.map((s) => s.id), ["a"]);
  assert.ok(r.spent <= 1000);
  assert.equal(r.skippedForBudget.length, 1);
  assert.equal(r.skippedForBudget[0].id, "b", "over-budget nodes are reported, not silently dropped");
});

test("an over-budget node does not stop the walk — smaller nodes still get in", () => {
  const nodes = [
    node({ id: "seed", title: "seed", tokensEst: 100, wikiLinks: ["huge", "small"] }),
    node({ id: "huge", title: "huge", tokensEst: 9000 }),
    node({ id: "small", title: "small", tokensEst: 50 }),
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const g = buildGraph(nodes, buildIndex(nodes));
  const r = walk(g, [{ id: "seed", score: 10 }], byId, { budgetTokens: 500 });
  assert.deepEqual(r.selected.map((s) => s.id).sort(), ["seed", "small"]);
});

test("expansion is best-first: a stronger seed's neighbour beats a weaker seed", () => {
  const nodes = [
    node({ id: "strong", title: "strong", tokensEst: 10, wikiLinks: ["strongkid"] }),
    node({ id: "strongkid", title: "strongkid", tokensEst: 10 }),
    node({ id: "weak", title: "weak", tokensEst: 10 }),
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const g = buildGraph(nodes, buildIndex(nodes));
  const r = walk(
    g,
    [{ id: "strong", score: 100 }, { id: "weak", score: 1 }],
    byId,
    { budgetTokens: 1000, maxNodes: 3 },
  );
  // strong (100) → strongkid (100 × 1.0 × 0.55 = 55) → weak (1)
  assert.deepEqual(r.selected.map((s) => s.id), ["strong", "strongkid", "weak"]);
});

test("every selected node carries provenance", () => {
  const nodes = [
    node({ id: "a", title: "a", tokensEst: 10, wikiLinks: ["b"] }),
    node({ id: "b", title: "b", tokensEst: 10 }),
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const g = buildGraph(nodes, buildIndex(nodes));
  const r = walk(g, [{ id: "a", score: 5 }], byId, {});
  const b = r.selected.find((s) => s.id === "b");
  assert.equal(b.via, "a");
  assert.equal(b.edge, "links_to");
  assert.equal(b.depth, 1);
});

test("maxNodes caps the pack", () => {
  const nodes = Array.from({ length: 20 }, (_, i) =>
    node({ id: `n${i}`, title: `n${i}`, tokensEst: 5, wikiLinks: [`n${i + 1}`] }),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const g = buildGraph(nodes, buildIndex(nodes));
  const r = walk(g, [{ id: "n0", score: 9 }], byId, { budgetTokens: 100000, maxNodes: 4 });
  assert.equal(r.selected.length, 4);
});
