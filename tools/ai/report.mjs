#!/usr/bin/env node
/** Summarize content-free JSONL from ai:eval or a Leaf server's stdout. */
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { stateDir } from './dify.mjs';
const path = process.argv[2] ?? join(stateDir, 'evaluations.jsonl');
if (!existsSync(path)) { console.log('No recorded runs. Run an explicit evaluation or provide the Leaf server log.'); process.exit(0); }
const groups = new Map(); let malformed = 0;
for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
  if (!line.startsWith('{')) continue;
  let value; try { value = JSON.parse(line); } catch { malformed++; continue; }
  if (!['foliage.ai.eval.v1', 'foliage.photosynthesis.run.v1', 'foliage.ladybug.run.v1'].includes(value.schema)) continue;
  const allowed = ['error', 'answered', 'refused', 'abandoned', 'passed-contract-checks', 'needs-review'];
  if (!allowed.includes(value.status) || !Number.isFinite(value.durationMs) || value.durationMs < 0) { malformed++; continue; }
  const key = `${value.schema} / ${value.status}`;
  const group = groups.get(key) ?? [];
  group.push(value.durationMs); groups.set(key, group);
}
if (!groups.size) console.log('No valid completed run records found.');
for (const [group, durations] of groups) {
  durations.sort((a, b) => a - b);
  const percentile = p => durations[Math.max(0, Math.ceil(durations.length * p) - 1)];
  console.log(`${group}: ${durations.length} runs; median ${percentile(0.5)} ms; p95 ${percentile(0.95)} ms; max ${durations.at(-1)} ms`);
}
if (malformed) { console.error(`${malformed} malformed JSON record(s); results are incomplete.`); process.exitCode = 1; }
