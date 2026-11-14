#!/usr/bin/env node
/** Read-only local garden search. The root foliage command supplies fixed document paths. */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { requireNodeFloor } from "./src/nodeFloor.mjs";
requireNodeFloor();

try {
  const parsed = parseArgs({ args: process.argv.slice(2), options: {
    into: { type: "string" }, out: { type: "string" }, limit: { type: "string" }, help: { type: "boolean", short: "h" },
  }, allowPositionals: true, strict: true, tokens: true });
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new Error(`Duplicate --${token.name} is refused.`);
    seen.add(token.name);
  }
  if (parsed.values.help) {
    process.stdout.write("Usage: foliage search <words> --garden <path> [--limit 1–10]\nSearches the selected local work record only. retrieval in the answer names the search that ordered the hits, and because\nsays why the garden's brain did not: in keyword mode (the default) it is not used here. With local embeddings on\n(foliage brain embed --local ollama:<model>) the brain orders the first hits when it is current. foliage brain search reads the brain.\n");
  } else {
    if (!parsed.values.into?.trim() || !parsed.values.out?.trim()) throw new Error("Explicit Leaf and harvest paths are required.");
    const query = parsed.positionals.join(" ").trim();
    if (!query) throw new Error("Search needs words.");
    const limit = parsed.values.limit === undefined ? 8 : Number(parsed.values.limit);
    const { searchLocalGarden } = await import("./src/localSearch.ts");
    const { refreshDetached } = await import("./src/brainUpkeep.ts");
    // Foliage's own search over the record, saying why the brain did not answer (`retrieval`,
    // `because`): keyword-mode reads skip the brain and start no process (localSearch.ts). With
    // local embeddings on, the brain orders the first hits when it is current; this command ends
    // once it answers, so a brain behind the record is updated in place by a detached `foliage brain
    // refresh --in-place`, which never rebuilds, and the search waits for it up to its bound.
    const found = await searchLocalGarden(resolve(parsed.values.into), resolve(parsed.values.out), query, limit, undefined, { refreshElsewhere: refreshDetached });
    process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`foliage search: ${error instanceof Error ? error.message : "Search failed."}\n`);
  process.exitCode = 1;
}
