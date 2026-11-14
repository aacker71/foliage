#!/usr/bin/env node
/**
 * The retrieval pipeline, end to end.
 *
 *   ROUTER  →  INDEX SCORING  →  NODE RETRIEVAL  →  GRAPH WALK  →  context pack
 *
 * Everything up to the pack is deterministic: no model call, no network. The model is only
 * asked to reason once the evidence set has been reduced to the smallest grounded subset, and
 * the pack states its own provenance so a claim can always be traced to the node that
 * supports it.
 *
 * Usage:
 *   node tools/vault/ask.mjs "<question>" [--budget 6000] [--source brain,memory]
 *                                         [--tags fcra,design] [--max 10] [--json]
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, score } from "./lib/rank.mjs";
import { buildGraph, walk } from "./lib/walk.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const argv = process.argv.slice(2);
const question = argv.filter((a) => !a.startsWith("--"))[0];
if (!question) {
  console.error('usage: node tools/vault/ask.mjs "<question>" [--budget N] [--source a,b] [--tags x,y] [--max N] [--json]');
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const asJson = argv.includes("--json");

/**
 * THE ROUTER — a tiny session scope map, deliberately kept small enough to be free.
 * It narrows scope and sets constraints; it does not decide relevance. Sources act as a hard
 * scope (an explicit operator choice), while tags are a rarity-weighted boost rather than a
 * filter, so a required tag can never hide the one note that answers the question.
 */
const router = {
  sources: flag("source", null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
  mustTags: flag("tags", "")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
  budgetTokens: Number(flag("budget", 6000)),
  maxNodes: Number(flag("max", 10)),
};

let raw;
try {
  raw = await readFile(join(HERE, ".vault", "index.jsonl"), "utf8");
} catch {
  console.error("✗ no index. Run: node tools/vault/build.mjs");
  process.exit(1);
}
const nodes = raw.trim().split("\n").map((l) => JSON.parse(l));
const nodesById = new Map(nodes.map((n) => [n.id, n]));

const t0 = Date.now();
const index = buildIndex(nodes);
const graph = buildGraph(nodes, index);
const ranked = score(index, nodes, question, { now: Date.now(), router });

// SEEDS: the top few by index score. Small on purpose — the walk earns the rest via edges,
// which is more informative than taking the next-best keyword match.
const seeds = ranked.slice(0, 4);
const result = walk(graph, seeds, nodesById, {
  budgetTokens: router.budgetTokens,
  maxNodes: router.maxNodes,
});
const elapsed = Date.now() - t0;

const wholeVault = nodes.reduce((s, n) => s + n.tokensEst, 0);
const reduction = wholeVault > 0 ? 1 - result.spent / wholeVault : 0;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        question,
        router,
        elapsedMs: elapsed,
        candidatesScored: ranked.length,
        selected: result.selected.map((s) => ({
          id: s.id, path: s.node.path, depth: s.depth, via: s.via,
          edge: s.edge, tokensEst: s.node.tokensEst,
        })),
        tokens: { pack: result.spent, wholeVault, reductionPct: +(reduction * 100).toFixed(1) },
        skippedForBudget: result.skippedForBudget,
      },
      null, 2,
    ),
  );
  process.exit(0);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

console.log(bold(`\n${question}`));
console.log(
  dim(
    `router: ${router.sources ? router.sources.join("+") : "all sources"}` +
      `${router.mustTags.length ? ` · tags ${router.mustTags.join(",")}` : ""}` +
      ` · budget ${router.budgetTokens} tok`,
  ),
);
console.log(dim(`scored ${ranked.length} index entries in ${elapsed}ms — no files opened, no model called\n`));

if (result.selected.length === 0) {
  console.log("no nodes matched. Widen the question or drop --tags.");
  process.exit(0);
}

console.log(bold("EVIDENCE SET"));
for (const s of result.selected) {
  const why =
    s.depth === 0
      ? `seed · index score ${s.priority.toFixed(2)}`
      : `${s.edge} ← ${s.via} (depth ${s.depth})`;
  console.log(`  ${s.node.title}`);
  console.log(dim(`    ${s.node.path}`));
  console.log(dim(`    ${why} · ~${s.node.tokensEst} tok`));
  if (s.node.summary) console.log(dim(`    ${s.node.summary.slice(0, 150)}`));
}

console.log(bold("\nCOST"));
console.log(`  pack        ~${result.spent.toLocaleString()} tokens (${result.selected.length} nodes)`);
console.log(`  whole vault ~${wholeVault.toLocaleString()} tokens (${nodes.length} nodes)`);
console.log(`  reduction   ${(reduction * 100).toFixed(1)}%`);
if (result.skippedForBudget.length) {
  console.log(
    dim(`  ${result.skippedForBudget.length} node(s) skipped for budget — raise --budget to include them`),
  );
}
console.log(dim("\n  (token counts are chars/4 estimates, consistent but not exact)\n"));
