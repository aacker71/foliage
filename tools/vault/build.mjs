#!/usr/bin/env node
/**
 * Build the vault index. Stage 1 + the index half of stages 2-3.
 * Deterministic, zero token cost, no network. Re-run whenever the vault changes.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { intake, deriveKeyterms } from "./lib/vault.mjs";
import { buildIndex } from "./lib/rank.mjs";
import { buildGraph } from "./lib/walk.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = join(HERE, ".vault");

const cfg = JSON.parse(await readFile(join(HERE, "sources.json"), "utf8"));
// `~/` is expanded HERE, at the one place the config is read, so sources.json can stay
// machine-portable instead of hardcoding an absolute home directory into a committed file —
// which is a username disclosure once the repo has a remote, and a broken config on any
// other machine. Only a LEADING ~/ is meaningful; ~elsewhere is a literal character.
for (const s of cfg.sources) {
  if (s.root.startsWith("~/")) s.root = join(homedir(), s.root.slice(2));
}
const t0 = Date.now();
const { nodes, skipped } = await intake(cfg.sources);
if (nodes.length === 0) {
  console.error("✗ no nodes found — check sources.json roots");
  process.exit(1);
}
deriveKeyterms(nodes);
const index = buildIndex(nodes);
const graph = buildGraph(nodes, index);

await mkdir(OUT, { recursive: true });
// The INDEX: one line per node, and nothing that requires opening a file to produce.
await writeFile(
  join(OUT, "index.jsonl"),
  nodes
    .map((n) =>
      JSON.stringify({
        id: n.id, source: n.source, path: n.path, title: n.title, tags: n.tags,
        summary: n.summary, headings: n.headings, keyterms: n.keyterms,
        updated: n.updated, tokensEst: n.tokensEst,
        wikiLinks: n.wikiLinks, mdLinks: n.mdLinks,
      }),
    )
    .join("\n") + "\n",
);
await writeFile(
  join(OUT, "graph.json"),
  JSON.stringify({ builtAt: Date.now(), stats: graph.stats,
    adj: Object.fromEntries([...graph.adj].filter(([, v]) => v.length)) }, null, 0),
);

const totalTokens = nodes.reduce((s, n) => s + n.tokensEst, 0);
const edges = [...graph.adj.values()].reduce((s, v) => s + v.length, 0);
console.log(`✓ vault indexed in ${Date.now() - t0}ms`);
console.log(`  ${nodes.length} nodes · ${edges} edges · ${graph.stats.resolved} links resolved, ${graph.stats.dangling} dangling`);
console.log(`  whole vault ≈ ${totalTokens.toLocaleString()} tokens (estimate) — this is what we avoid reading`);
for (const s of cfg.sources) {
  const n = nodes.filter((x) => x.source === s.name).length;
  console.log(`  ${s.name.padEnd(8)} ${String(n).padStart(4)} nodes`);
}
if (skipped.length) console.log(`  skipped ${skipped.length}: ${skipped.slice(0,3).map(s=>s.reason).join("; ")}`);
