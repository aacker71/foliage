/** Protocol/adversarial probes below are tests of the evaluator, not portfolio achievements. */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonical, parseScenario, sealEvidence, verifyEvidence } from './contract.mjs';
import { containerArgs, runLocal } from './local.mjs';
import { command } from './process.mjs';

const scenario = { version: 1, id: 'protocol-probe', steps: [{ stage: 'execute', argv: ['node', '--version'], timeoutMs: 1000 }] };
test('scenario requires explicit bounded commands and ordered stages; cannot smuggle executor options', () => {
  assert.deepEqual(parseScenario(scenario), scenario);
  for (const value of [null, { ...scenario, network: 'host' }, { ...scenario, steps: [] },
    { ...scenario, steps: [{ ...scenario.steps[0], timeoutMs: 0 }] },
    { ...scenario, steps: [{ ...scenario.steps[0], argv: ['x\0y'] }] },
    { ...scenario, steps: [{ stage: 'observe', argv: ['true'], timeoutMs: 1000 }, ...scenario.steps] },
    { ...scenario, steps: [{ ...scenario.steps[0], mounts: ['/'] }] },
  ]) assert.throws(() => parseScenario(value), /invalid-scenario/);
});
test('Docker restrictions are explicit and source archive is the only host mount', () => {
  const args = containerArgs('owned-job', `sha256:${'1'.repeat(64)}`, '/private/snapshot.tar');
  for (const flag of ['--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=10001:10001', '--pids-limit=128', '--memory=1g', '--cpus=2']) assert.ok(args.includes(flag), flag);
  assert.equal(args.filter(arg => arg === '--mount').length, 1);
  assert.ok(args.includes('type=bind,source=/private/snapshot.tar,target=/input/source.tar,readonly'));
  assert.ok(!args.some(arg => /docker.sock|--privileged|--publish|--volume/.test(arg)));
});
test('browser selection is a bounded in-job launch, never an existing app origin', () => {
  const browser = { argv: ['node', 'server.mjs'], port: 4321, path: '/', readyTimeoutMs: 1000, durationSeconds: 8 };
  assert.deepEqual(parseScenario({ ...scenario, browser }).browser, browser);
  for (const changed of [
    { url: 'http://127.0.0.1:64292' }, { port: 80 }, { port: 65536 }, { path: '//external.invalid/' },
    { path: '/\\external.invalid/' }, { path: 'http://external.invalid/' }, { argv: ['node\0'] },
    { durationSeconds: 16 }, { readyTimeoutMs: 15001 }, { image: 'another-image' },
  ]) assert.throws(() => parseScenario({ ...scenario, browser: { ...browser, ...changed } }), /invalid-browser-scenario/);
});
test('signatures reject tampering and an untrusted signer; they do not add a proof tier', () => {
  const signer = generateKeyPairSync('ed25519'), stranger = generateKeyPairSync('ed25519');
  const evidence = { status: 'completed', steps: [{ exitCode: 0 }], trust: 'owner-controlled-locally-reported' };
  const result = sealEvidence(evidence, { key: signer.privateKey, keyId: 'test-key' });
  assert.equal(verifyEvidence(result, signer.publicKey, 'test-key'), true);
  assert.equal(verifyEvidence(result, stranger.publicKey, 'test-key'), false);
  assert.equal(verifyEvidence(result, signer.publicKey, 'other-key'), false);
  assert.equal(verifyEvidence({ ...result, signature: { ...result.signature, keyId: 'renamed-key' } }, signer.publicKey, 'renamed-key'), false);
  assert.equal(verifyEvidence({ ...result, evidence: { ...evidence, steps: [{ exitCode: 1 }] } }, signer.publicKey, 'test-key'), false);
  assert.equal(verifyEvidence(sealEvidence(evidence), signer.publicKey, 'test-key'), false);
  assert.equal('tier' in result.evidence, false);
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
});
test('subprocess timeout, cancellation, nonzero and bounded output are distinct actual outcomes', async () => {
  const nonzero = await command(process.execPath, ['-e', 'process.exit(7)']);
  assert.equal(nonzero.code, 7); assert.equal(nonzero.reason, null);
  const timed = await command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 });
  assert.equal(timed.reason, 'timeout');
  const noisy = await command(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { maxBytes: 100 });
  assert.equal(noisy.reason, 'output-limit'); assert.equal(noisy.stdout.length + noisy.stderr.length, 100);
  const cancel = new AbortController(); cancel.abort();
  assert.equal((await command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: cancel.signal })).reason, 'cancelled');
  assert.equal((await command('/foliage-no-such-executable', [])).reason, 'spawn-error');
});
test('refused inputs never dispatch code; absent Docker produces an error receipt and no success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'foliage-eval-contract-'));
  const base = { repo: root, commit: 'a'.repeat(40), image: `sha256:${'b'.repeat(64)}`, scenario, output: join(root, 'results.json'), docker: '/foliage-no-such-docker' };
  try {
    await assert.rejects(runLocal(base), /owner-controlled-code-required/);
    await assert.rejects(runLocal({ ...base, trustedLocalCode: true, commit: 'HEAD' }), /exact-commit-required/);
    await assert.rejects(runLocal({ ...base, trustedLocalCode: true, image: 'node:latest' }), /local-image-id-required/);
    const result = await runLocal({ ...base, trustedLocalCode: true });
    assert.equal(result.evidence.status, 'error'); assert.equal(result.evidence.reason, 'docker-unavailable');
    assert.equal(result.evidence.failure.cause, 'spawn-error');
    assert.deepEqual(result.evidence.steps, []);
    assert.equal(result.evidence.cleanup.container, 'not-created');
    assert.deepEqual(JSON.parse(await readFile(base.output, 'utf8')), result);
    assert.ok(!JSON.stringify(result).includes(root));
    await assert.rejects(runLocal({ ...base, trustedLocalCode: true }), /EEXIST/);
    assert.deepEqual(JSON.parse(await readFile(base.output, 'utf8')), result);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('host command does not inherit application secrets', async () => {
  process.env.FOLIAGE_EVAL_TEST_SECRET = 'test-only-not-a-credential';
  try {
    const result = await command(process.execPath, ['-e', 'process.stdout.write(String(process.env.FOLIAGE_EVAL_TEST_SECRET))']);
    assert.equal(result.stdout.toString(), 'undefined');
  } finally { delete process.env.FOLIAGE_EVAL_TEST_SECRET; }
});
test('artifact collisions do not reserve an empty receipt; receipt collisions remove only the new empty directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'foliage-eval-reservation-'));
  const output = join(root, 'results.json'), artifacts = `${output}.artifacts`;
  const options = { repo: root, commit: 'a'.repeat(40), image: `sha256:${'b'.repeat(64)}`, scenario,
    output, docker: '/foliage-no-such-docker', trustedLocalCode: true };
  try {
    await mkdir(artifacts); await writeFile(join(artifacts, 'retained'), 'existing artifact');
    await assert.rejects(runLocal(options), { code: 'EEXIST' });
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    assert.equal(await readFile(join(artifacts, 'retained'), 'utf8'), 'existing artifact');
    await rm(artifacts, { recursive: true });
    await writeFile(output, 'existing receipt');
    await assert.rejects(runLocal(options), { code: 'EEXIST' });
    assert.equal(await readFile(output, 'utf8'), 'existing receipt');
    await assert.rejects(readFile(artifacts), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('POSIX deadline closes pipes inherited by a descendant after its parent exits', { skip: process.platform === 'win32' }, async () => {
  const program = `require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2500)'],{stdio:'inherit'}).unref()`;
  const result = await command(process.execPath, ['-e', program], { timeoutMs: 300 });
  assert.equal(result.reason, 'timeout');
  assert.ok(result.durationMs < 1800, `descendant kept command open for ${result.durationMs}ms`);
});
test('remote Docker is refused before source access; later calls pin the inspected local socket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'foliage-eval-engine-probe-'));
  try {
    for (const [name, endpoint] of [['remote', 'tcp://example.invalid:2375'], ['local', 'unix:///tmp/protocol-probe.sock']]) {
      const log = join(root, `${name}.calls`), docker = join(root, `${name}.mjs`);
      await writeFile(docker, `#!/usr/bin/env node\nimport {appendFileSync} from 'node:fs';\nconst args=process.argv.slice(2);appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');\nif(args[0]==='context' && args[1]==='show') console.log('selected-context');\nelse if(args[0]==='context' && args[1]==='inspect') console.log(${JSON.stringify(JSON.stringify(endpoint))});\nelse process.exit(1);\n`, { mode: 0o700 });
      const result = await runLocal({ repo: join(root, 'absent-repository'), commit: 'a'.repeat(40), image: `sha256:${'b'.repeat(64)}`,
        scenario, output: join(root, `${name}.json`), docker, trustedLocalCode: true });
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.equal(result.evidence.source.archiveDigest, null);
      if (name === 'remote') {
        assert.equal(result.evidence.reason, 'local-docker-required'); assert.equal(calls.length, 2);
      } else {
        assert.equal(result.evidence.reason, 'image-unavailable');
        assert.deepEqual(calls[2].slice(0, 4), ['--host', endpoint, 'image', 'inspect']);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
