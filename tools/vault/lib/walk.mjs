/**
 * Stages 4–5 — NODE RETRIEVAL and GRAPH WALK.
 *
 * Scoring (rank.mjs) picks a handful of SEEDS without opening anything. This module expands
 * those seeds along edges and stops when a token budget is spent, so the model receives the
 * smallest grounded evidence set rather than everything that matched.
 *
 * WHY THIS IS NOT A REIMPLEMENTATION OF GRAPHIFY.
 * graphify owns the CODE graph and gets its edges free from an AST. This graph is markdown,
 * where graphify's free path extracts nothing and its document path needs LLM extraction. But
 * a hand-maintained vault already states its edges: 371 `[[wikilinks]]` here, authored by a
 * human, which is better evidence of relatedness than anything inferred. So the edges are
 * read, not derived, and the whole build costs zero tokens.
 *
 * EDGE TYPES, and why each earns its weight:
 *   links_to   1.00  an explicit wikilink or markdown link. A deliberate human assertion.
 *   linked_by  0.85  the reverse. Slightly weaker: being cited is less specific than citing.
 *   same_tag   ≤0.60 scaled by tag RARITY. Sharing `project` with 40 notes means nothing;
 *                    sharing `fcra` means a lot. Without rarity weighting this edge type
 *                    connects everything to everything and the walk degenerates.
 *
 * Complexity: O(V + E) bounded by the budget, which in practice stops after a few nodes.
 */

import { tagWeight } from "./rank.mjs";

export const EDGE_WEIGHT = Object.freeze({ links_to: 1.0, linked_by: 0.85, same_tag: 0.6 });

/**
 * Resolve a link target to a node id.
 *
 * Wikilinks name a note, not a path, so resolution is by frontmatter name, then title, then
 * basename. Ambiguity resolves to the first match in a stable order rather than throwing — a
 * vault with two notes of the same name is a real and survivable state.
 */
export function buildResolver(nodes) {
  const byName = new Map();
  const add = (key, id) => {
    if (!key) return;
    const k = String(key).toLowerCase();
    if (!byName.has(k)) byName.set(k, id);
  };
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    add(n.id, n.id);
    add(n.id.split(":").pop(), n.id);
    add(n.title, n.id);
    add(n.id.split("/").pop(), n.id);
  }
  return (target) => {
    const t = String(target).replace(/\.(md|mdx|markdown)$/i, "").toLowerCase();
    return byName.get(t) ?? byName.get(t.split("/").pop()) ?? null;
  };
}

/** Adjacency with typed, weighted edges. Built once per vault build. */
export function buildGraph(nodes, index) {
  const resolve = buildResolver(nodes);
  const adj = new Map(nodes.map((n) => [n.id, []]));
  const seen = new Set();

  const link = (from, to, type) => {
    if (!from || !to || from === to) return;
    const key = `${from}|${to}|${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    adj.get(from)?.push({ to, type, weight: EDGE_WEIGHT[type] });
  };

  let resolved = 0;
  let dangling = 0;
  for (const n of nodes) {
    for (const target of [...n.wikiLinks, ...n.mdLinks]) {
      const to = resolve(target);
      if (!to) {
        dangling++;
        continue;
      }
      resolved++;
      link(n.id, to, "links_to");
      link(to, n.id, "linked_by");
    }
  }

  // Tag edges, rarity-weighted, and only for tags rare enough to be informative.
  const byTag = new Map();
  for (const n of nodes) {
    for (const tag of n.tags) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(n.id);
    }
  }
  for (const [tag, ids] of byTag) {
    const w = tagWeight(index, tag);
    // A tag shared by most of the vault is not a relationship. 0.35 is the cut where a tag
    // stops discriminating on a corpus this size.
    if (w < 0.35 || ids.length > 12) continue;
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const key = `${a}|${b}|same_tag`;
        if (seen.has(key)) continue;
        seen.add(key);
        adj.get(a)?.push({ to: b, type: "same_tag", weight: EDGE_WEIGHT.same_tag * w, tag });
      }
    }
  }

  return { adj, stats: { resolved, dangling, nodes: nodes.length } };
}

/**
 * Budgeted best-first expansion from scored seeds.
 *
 * Best-first rather than breadth-first: with a hard token budget we want the most promising
 * node next, not the nearest one. A frontier ordered by (seed score × edge weight × decay)
 * spends the budget on evidence instead of on whatever happened to be one hop away.
 *
 * Returns what was selected AND what was rejected for budget, because "we ran out of room"
 * is information the caller needs — silently truncating is how a retrieval layer starts
 * lying about coverage.
 */
export function walk(graph, seeds, nodesById, { budgetTokens = 6000, maxNodes = 12, decay = 0.55 } = {}) {
  const selected = [];
  const chosen = new Set();
  let spent = 0;
  const skippedForBudget = [];

  // frontier: {id, priority, depth, via}
  const frontier = seeds.map((s) => ({
    id: s.id,
    priority: s.score,
    depth: 0,
    via: null,
    edge: null,
  }));

  while (frontier.length > 0 && selected.length < maxNodes) {
    frontier.sort((a, b) => b.priority - a.priority);
    const cur = frontier.shift();
    if (chosen.has(cur.id)) continue;
    const node = nodesById.get(cur.id);
    if (!node) continue;

    if (spent + node.tokensEst > budgetTokens) {
      skippedForBudget.push({ id: cur.id, tokensEst: node.tokensEst, depth: cur.depth });
      continue; // keep trying smaller nodes rather than stopping dead
    }

    chosen.add(cur.id);
    spent += node.tokensEst;
    selected.push({
      id: cur.id,
      node,
      depth: cur.depth,
      via: cur.via,
      edge: cur.edge,
      priority: cur.priority,
    });

    for (const e of graph.adj.get(cur.id) ?? []) {
      if (chosen.has(e.to)) continue;
      frontier.push({
        id: e.to,
        priority: cur.priority * e.weight * decay,
        depth: cur.depth + 1,
        via: cur.id,
        edge: e.type,
      });
    }
  }

  return { selected, spent, budgetTokens, skippedForBudget };
}
