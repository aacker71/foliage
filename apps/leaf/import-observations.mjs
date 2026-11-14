#!/usr/bin/env node
/** Explicit local import into the existing human review queue. No network or model calls. */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { requireNodeFloor } from "./src/nodeFloor.mjs";
requireNodeFloor();
const { writeGuard } = await import("@foliage/photosynthesis");
const { OBSERVATION_INPUT_BYTES } = await import("./src/integrationImport.ts");
const { boundedIntegrationFile, integrationJson, persistIntegrationObservations } = await import("./src/integrationStore.ts");

const USAGE = `Import selected observations into local human review; no provider is connected.

  node apps/leaf/import-observations.mjs --input <file|-> --into <existing leaf.json> --out <harvest.json>

All paths are explicit. Input is a bounded foliage-observations version 1 batch.
Format: docs/INTEGRATIONS.md#selected-observation-format
No source is fetched, no model runs, and nothing is approved, shared or published.
Partial/deletion batches are refused. New revisions are separate unreviewed snapshots.
Next: foliage up --garden <dir>, then /review. <dir>/harvest.json is --out.
`;

async function boundedStdin() {
  if (process.stdin.isTTY) throw new Error("--input - requires a piped observation batch.");
  const timer = setTimeout(() => process.stdin.destroy(new Error("Observation input did not finish within 30 seconds.")), 30_000);
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > OBSERVATION_INPUT_BYTES) throw new Error(`Observation input exceeds ${OBSERVATION_INPUT_BYTES} bytes.`);
      chunks.push(bytes);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { clearTimeout(timer); }
}

try {
  const { values, tokens } = parseArgs({ options: {
    input: { type: "string" }, into: { type: "string" }, out: { type: "string" }, help: { type: "boolean" },
  }, strict: true, tokens: true });
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new Error(`Duplicate --${token.name} is refused; choose one explicit value.`);
    seen.add(token.name);
  }
  if (values.help) { process.stdout.write(USAGE); }
  else {
    const guard = writeGuard({ "--input": values.input, "--into": values.into, "--out": values.out });
    if (!guard.ok) throw new Error(`Explicit ${guard.missing.join(", ")} required. No ambient garden was selected.`);
    const input = /** @type {string} */ (values.input).trim();
    const into = resolve(/** @type {string} */ (values.into).trim());
    const out = resolve(/** @type {string} */ (values.out).trim());
    if (into === out) throw new Error("The leaf and harvest must be different files.");
    const batch = integrationJson(input === "-" ? await boundedStdin() : await boundedIntegrationFile(resolve(input), OBSERVATION_INPUT_BYTES), "Observation input");
    const receipt = await persistIntegrationObservations(batch, into, out);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
} catch (error) {
  process.stderr.write(`import-observations: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
