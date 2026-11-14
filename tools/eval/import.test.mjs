/** Real local failure receipts and explicit adversarial mutations; never customer achievements. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sealEvidence } from './contract.mjs';
import { importReceipt } from './import.mjs';
import { runLocal } from './local.mjs';
import { receiptObservation } from './observation.mjs';

const execute = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(repo, 'tools/eval/cli.mjs');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'foliage-eval-import-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'receipt.json'), into = join(dir, 'leaf.json'), out = join(dir, 'harvest.json');
  const target = { id: 'evaluator-import-regression', subject: 'Evaluator import regression harness', leaflets: [] };
  await writeFile(into, JSON.stringify(target));
  const { stdout } = await execute('git', ['-C', repo, 'rev-parse', 'HEAD']);
  const receipt = await runLocal({ repo, commit: stdout.trim(), image: `sha256:${'0'.repeat(64)}`,
    scenario: { version: 1, id: 'unavailable-engine-probe', steps: [{ stage: 'execute', argv: ['node', '--version'], timeoutMs: 1000 }] },
    output: input, docker: join(dir, 'deliberately-absent-docker'), trustedLocalCode: true });
  assert.equal(receipt.evidence.reason, 'docker-unavailable');
  return { dir, input, into, out, target, receipt, args: ['--input', input, '--into', into] };
}

test('actual executor failure previews without writing; selected import retains missing and unrun states', async t => {
  const f = await fixture(t);
  const before = await readFile(f.into, 'utf8');
  const { stdout } = await execute(process.execPath, [cli, 'import', ...f.args]);
  const preview = JSON.parse(stdout);
  assert.equal(preview.status, 'local-evaluation-preview');
  const observation = preview.batch.observations[0];
  assert.match(observation.excerpt, /Declared outcome: error; reason: docker-unavailable/);
  assert.ok(observation.excerpt.includes(`cause: spawn-error; exit: ${f.receipt.evidence.failure.exitCode ?? 'unavailable'}`));
  assert.match(observation.excerpt, /archive digest: unavailable; bytes: unavailable/);
  assert.match(observation.excerpt, /Stage execute: not-run/);
  assert.match(observation.excerpt, /unsigned; no signer authenticated/);
  assert.match(observation.excerpt, /does not establish test correctness/);
  assert.equal(JSON.stringify(preview).includes(f.dir), false);
  assert.equal(JSON.stringify(preview).includes('unavailable-engine-probe'), false);
  await assert.rejects(stat(f.out), { code: 'ENOENT' });
  const imported = await importReceipt([...f.args, '--out', f.out]);
  assert.equal(imported.persisted.length, 1);
  const saved = JSON.parse(await readFile(f.out, 'utf8'));
  assert.deepEqual(saved.candidates[0].review, { state: 'candidate' });
  assert.equal('tier' in saved.candidates[0], false);
  assert.equal(await readFile(f.into, 'utf8'), before);
  assert.equal((await stat(f.out)).mode & 0o777, 0o600);
  await execute(process.execPath, [join(repo, 'apps/leaf/harvest.mjs'), 'approve', imported.persisted[0], '--by', f.target.subject, '--doc', f.out]);
  const reviewed = await readFile(f.out, 'utf8');
  assert.equal(JSON.parse(reviewed).candidates[0].review.state, 'approved');
  assert.deepEqual((await importReceipt([...f.args, '--out', f.out])).unchanged, imported.persisted);
  assert.equal(await readFile(f.out, 'utf8'), reviewed);
  assert.equal(await readFile(f.into, 'utf8'), before);
});

test('same attempt replays without duplication and changed original bytes preserve the existing queue', async t => {
  const f = await fixture(t);
  const args = [...f.args, '--out', f.out];
  const first = await importReceipt(args), before = await readFile(f.out, 'utf8');
  assert.deepEqual((await importReceipt(args)).unchanged, first.persisted);
  assert.equal(await readFile(f.out, 'utf8'), before);
  // Even an omitted private field is bound to the original digest, not silently reinterpreted.
  const changed = sealEvidence({ ...f.receipt.evidence, scope: 'adversarial changed private text' });
  await writeFile(f.input, JSON.stringify(changed));
  await assert.rejects(importReceipt(args), /different material/);
  assert.equal(await readFile(f.out, 'utf8'), before);
});

test('selected signature verifies original bytes only; wrong, absent or renamed keys are refused', async t => {
  const f = await fixture(t), signer = generateKeyPairSync('ed25519'), stranger = generateKeyPairSync('ed25519');
  const signed = sealEvidence(f.receipt.evidence, { key: signer.privateKey, keyId: 'regression-key' });
  assert.throws(() => receiptObservation(signed, f.target), /signature-not-verified/);
  for (const signing of [{ key: stranger.publicKey, keyId: 'regression-key' }, { key: signer.publicKey, keyId: 'renamed' }])
    assert.throws(() => receiptObservation(signed, f.target, signing), /signature-not-verified/);
  const key = join(f.dir, 'public.pem');
  await writeFile(key, signer.publicKey.export({ type: 'spki', format: 'pem' }));
  await writeFile(f.input, JSON.stringify(signed));
  const preview = await importReceipt([...f.args, '--public-key', key, '--key-id', 'regression-key']);
  assert.match(preview.batch.observations[0].excerpt, /original receipt signature checked/);
  assert.match(preview.batch.observations[0].excerpt, /does not sign this projection/);
  assert.equal(JSON.stringify(preview).includes(signed.signature.value), false);
  assert.throws(() => receiptObservation(f.receipt, f.target, { key: signer.publicKey, keyId: 'regression-key' }), /receipt-is-unsigned/);
});

test('malformed, tampered and contradictory declarations are refused before queue creation', async t => {
  const f = await fixture(t);
  const tampered = structuredClone(f.receipt); tampered.evidence.scope = 'adversarial unsigned edit to original bytes';
  assert.throws(() => receiptObservation(tampered, f.target));
  for (const change of [
    e => { e.status = 'completed'; e.reason = null; },
    e => { e.executor = 'remote-cloud'; },
    e => { e.source.archiveBytes = -1; },
    e => { e.jobId = '../private'; },
    e => { e.finishedAt = 'yesterday'; },
    e => { e.stages[1].status = 'attempted'; },
    e => { delete e.evaluator.implementationDigest; },
    e => { e.steps = Array(17).fill({}); },
    e => { e.reason = 'private\ntext'; },
  ]) {
    const evidence = structuredClone(f.receipt.evidence); change(evidence);
    await writeFile(f.input, JSON.stringify(sealEvidence(evidence)));
    await assert.rejects(importReceipt([...f.args, '--out', f.out]));
    await assert.rejects(stat(f.out), { code: 'ENOENT' });
  }
});

test('omitted artifact references are never followed; admission bounds paths, bytes and diagnostics', async t => {
  const f = await fixture(t);
  const e = structuredClone(f.receipt.evidence);
  e.scenario.file = '/private/adversarial-private-secret-path'; e.scenario.id = 'adversarial-private-label';
  e.events.file = 'https://example.invalid/adversarial-private-token'; e.evaluator.hostNode = 'adversarial-private-host';
  await writeFile(f.input, JSON.stringify(sealEvidence(e)));
  const preview = JSON.stringify(await importReceipt(f.args));
  assert.equal(preview.includes('adversarial-private'), false);
  const original = await readFile(f.input, 'utf8');
  await assert.rejects(importReceipt([...f.args, '--out', f.input]), /distinct-import-files/);
  assert.equal(await readFile(f.input, 'utf8'), original);
  await assert.rejects(importReceipt([...f.args, '--input', f.input]), /duplicate-import-option/);
  const link = join(f.dir, 'link'); await symlink(f.input, link);
  await assert.rejects(importReceipt(['--input', link, '--into', f.into]));
  await writeFile(f.input, 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(importReceipt(f.args), /exceeds/);
  await writeFile(f.input, 'adversarial-private-document');
  await assert.rejects(execute(process.execPath, [cli, 'import', ...f.args]), error => {
    assert.match(error.stderr, /receipt-import-refused/);
    assert.equal(error.stderr.includes('adversarial-private-document'), false);
    return true;
  });
});
