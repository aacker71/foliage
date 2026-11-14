/** Explicit opt-in Docker rehearsal. Failure probes are evaluator checks, not portfolio evidence. */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEvidence } from './contract.mjs';
import { runLocal } from './local.mjs';
import { command } from './process.mjs';
import { importReceipt } from './import.mjs';

const [image, docker = 'docker'] = process.argv.slice(2);
if (!/^sha256:[a-f0-9]{64}$/.test(image ?? '')) throw Error('Pass the exact local runtime image id, then optionally the Docker binary.');
const repo = fileURLToPath(new URL('../..', import.meta.url));
const revision = await command('git', ['-C', repo, 'rev-parse', 'HEAD']);
assert.equal(revision.code, 0);
const commit = revision.stdout.toString().trim();
const tree = (await command('git', ['-C', repo, 'rev-parse', `${commit}^{tree}`])).stdout.toString().trim();
const directory = await mkdtemp(join(tmpdir(), 'foliage-eval-smoke-'));
const keys = generateKeyPairSync('ed25519');
const into = join(directory, 'regression-leaf.json'), out = join(directory, 'regression-harvest.json');
const publicKey = join(directory, 'regression-public.pem');
await writeFile(into, JSON.stringify({ id: 'runtime-import-rehearsal', subject: 'Runtime import rehearsal', leaflets: [] }), { mode: 0o600 });
await writeFile(publicKey, keys.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
async function checkImport(result, input) {
  const args = ['--input', input, '--into', into, '--out', out,
    ...(result.signature === null ? [] : ['--public-key', publicKey, '--key-id', 'ephemeral-smoke-key'])];
  const imported = await importReceipt(args);
  assert.equal(imported.persisted.length, 1);
  const before = await readFile(out, 'utf8');
  const candidate = JSON.parse(before).candidates.find(item => item.id === imported.persisted[0]);
  assert.deepEqual(candidate.review, { state: 'candidate' });
  assert.ok(candidate.evidence[0].excerpt.includes(`Declared outcome: ${result.evidence.status}`));
  for (const step of result.evidence.steps) {
    assert.ok(candidate.evidence[0].excerpt.includes(`Step ${step.index + 1}: ${step.stage}; ${step.status}`));
    assert.ok(candidate.evidence[0].excerpt.includes(`truncated ${step.logs.stdout.truncated}`));
  }
  assert.deepEqual((await importReceipt(args)).unchanged, imported.persisted);
  assert.equal(await readFile(out, 'utf8'), before);
  assert.deepEqual(JSON.parse(await readFile(into, 'utf8')).leaflets, []);
}
const domain = JSON.parse(await readFile(new URL('./scenarios/leaf-domain.json', import.meta.url), 'utf8'));
const controls = `const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
assert.equal(process.getuid(),10001);
assert.deepEqual(Object.keys(process.env).sort(),['HOME','PATH']);
assert.equal(fs.existsSync('/var/run/docker.sock'),false);
assert.deepEqual(Object.keys(os.networkInterfaces()),['lo']);
assert.throws(()=>fs.writeFileSync('/input/source.tar','alteration'),e=>['EROFS','EACCES'].includes(e.code));
assert.throws(()=>fs.writeFileSync('/host-write-probe','alteration'),e=>['EROFS','EACCES'].includes(e.code));
const status=fs.readFileSync('/proc/self/status','utf8');
assert.match(status,/CapEff:\\s+0+\\n/);assert.match(status,/NoNewPrivs:\\s+1/);assert.match(status,/Seccomp:\\s+2/);
console.log('Runtime restriction probes passed.');`;
const scenarios = [
  { ...domain, steps: [...domain.steps, { stage: 'observe', argv: ['node', '-e', controls], timeoutMs: 10000 }] },
  { version: 1, id: 'nonzero-probe', steps: [{ stage: 'execute', argv: ['node', '-e', 'process.exit(7)'], timeoutMs: 10000 }] },
  { version: 1, id: 'timeout-probe', steps: [{ stage: 'execute', argv: ['node', '-e', 'setInterval(()=>{},1000)'], timeoutMs: 200 }] },
  { version: 1, id: 'output-bound-probe', steps: [{ stage: 'execute', argv: ['node', '-e', 'process.stdout.write("x".repeat(200000))'], timeoutMs: 10000 }] },
];
const expected = ['completed', 'failed', 'error', 'error'];
const summaries = [];
for (const [index, scenario] of scenarios.entries()) {
  const result = await runLocal({ repo, commit, image, scenario, docker, trustedLocalCode: true,
    output: join(directory, `${scenario.id}.json`), signing: { key: keys.privateKey, keyId: 'ephemeral-smoke-key' } });
  assert.equal(result.evidence.status, expected[index], JSON.stringify({ directory, evidence: result.evidence }));
  if (index === 1) assert.equal(result.evidence.steps[0].exitCode, 7);
  if (index === 2) assert.equal(result.evidence.reason, 'timeout');
  if (index === 3) assert.equal(result.evidence.reason, 'output-limit');
  assert.equal(verifyEvidence(result, keys.publicKey, 'ephemeral-smoke-key'), true);
  assert.equal(result.evidence.source.tree, tree);
  assert.notEqual(result.evidence.attemptId, result.evidence.jobId);
  assert.deepEqual(result.evidence.cleanup, { container: 'removed', snapshot: 'removed' });
  const inspect = await command(docker, ['inspect', `foliage-eval-${result.evidence.jobId}`]);
  assert.notEqual(inspect.code, 0, 'job container must no longer exist');
  const trace = await readFile(join(directory, `${scenario.id}.json.artifacts`, 'events.jsonl'), 'utf8');
  assert.ok(trace.includes('job-started') && trace.includes('step-finished') && trace.includes('job-finished'));
  for (const entry of trace.trim().split('\n').map(line => JSON.parse(line))) assert.equal(entry.attemptId, result.evidence.attemptId);
  await checkImport(result, join(directory, `${scenario.id}.json`));
  summaries.push({ scenario: scenario.id, status: result.evidence.status, reason: result.evidence.reason, cleanup: result.evidence.cleanup });
}
// Cancel only after the executor has recorded a started step, rather than cancelling preflight.
const controller = new AbortController();
const cancelOutput = join(directory, 'cancellation-probe.json');
let cancelling = false;
const watch = setInterval(async () => {
  if (cancelling) return;
  try {
    const trace = await readFile(`${cancelOutput}.artifacts/events.jsonl`, 'utf8');
    if (trace.includes('step-started')) {
      cancelling = true;
      setTimeout(() => controller.abort(), 100);
    }
  } catch { /* The job has not created its trace yet; no evidence is asserted from this probe. */ }
}, 25);
try {
  const result = await runLocal({ repo, commit, image, docker, trustedLocalCode: true, output: cancelOutput, signal: controller.signal,
    scenario: { version: 1, id: 'cancellation-probe', steps: [{ stage: 'execute', argv: ['node', '-e', 'setInterval(()=>{},1000)'], timeoutMs: 10000 }] } });
  assert.equal(result.evidence.status, 'cancelled');
  assert.equal(result.evidence.reason, 'cancelled');
  assert.deepEqual(result.evidence.cleanup, { container: 'removed', snapshot: 'removed' });
  assert.notEqual((await command(docker, ['inspect', `foliage-eval-${result.evidence.jobId}`])).code, 0);
  await checkImport(result, cancelOutput);
  summaries.push({ scenario: 'cancellation-probe', status: result.evidence.status, cleanup: result.evidence.cleanup });
} finally { clearInterval(watch); }
// Fault injection at the transport boundary: execute real code, refuse its first cleanup,
// inspect the CLI's actual failure summary, then remove the owned container for real.
const refusedCleanup = join(directory, 'refused-cleanup.json');
const wrapper = join(directory, 'docker-cleanup-fault.mjs');
const failedScenario = join(directory, 'cleanup-scenario.json');
const failedOutput = join(directory, 'cleanup-probe.json');
await writeFile(failedScenario, JSON.stringify(scenarios[1]), { mode: 0o600 });
await writeFile(wrapper, `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);
if(args.includes('rm')){writeFileSync(${JSON.stringify(refusedCleanup)},JSON.stringify(args));process.exit(1);}
const result=spawnSync(${JSON.stringify(docker)},args,{stdio:'inherit'});process.exit(result.status??1);\n`, { mode: 0o700 });
try {
  const cli = await command(process.execPath, [fileURLToPath(new URL('./cli.mjs', import.meta.url)), 'run',
    '--repo', repo, '--commit', commit, '--image', image, '--scenario', failedScenario,
    '--output', failedOutput, '--docker', wrapper, '--trusted-local-code'], { timeoutMs: 60000 });
  assert.equal(cli.code, 1);
  const summary = JSON.parse(cli.stdout.toString());
  assert.equal(summary.reason, 'command-or-executor-nonzero');
  assert.equal(summary.cleanup.container, 'unconfirmed');
  assert.equal(summary.status, 'error');
  await checkImport(JSON.parse(await readFile(failedOutput, 'utf8')), failedOutput);
  summaries.push({ scenario: 'cleanup-failure-probe', status: summary.status, reason: summary.reason, cleanup: summary.cleanup });
} finally {
  const cleanupArgs = JSON.parse(await readFile(refusedCleanup, 'utf8'));
  const cleanup = await command(docker, cleanupArgs);
  assert.equal(cleanup.code, 0, 'fault-injection container must be removed by the real transport');
  assert.notEqual((await command(docker, [...cleanupArgs.slice(0, 2), 'inspect', cleanupArgs.at(-1)])).code, 0);
}
console.log(JSON.stringify({ directory, commit, image, results: summaries }, null, 2));
