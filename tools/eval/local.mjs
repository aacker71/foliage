/** Local owner-controlled execution only. Docker is not the external-submission trust boundary. */
import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, mkdtemp, open, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { canonical, digest, MAX_SOURCE_ARCHIVE_BYTES, parseScenario, sealEvidence, STAGES } from './contract.mjs';
import { command } from './process.mjs';
import { observeJobBrowser } from './browser.mjs';

const LIMITS = { network: 'none', cpus: 2, memoryBytes: 1073741824, pids: 128, workBytes: 536870912, outputBytesPerStep: 131072 };
export function containerArgs(name, image, archive) {
  return ['create', '--pull=never', '--name', name, '--label', `foliage.eval.job=${name}`, '--network=none',
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=10001:10001',
    '--pids-limit=128', '--memory=1g', '--memory-swap=1g', '--cpus=2', '--ulimit=nofile=1024:1024',
    '--tmpfs=/work:rw,nosuid,nodev,size=512m,uid=10001,gid=10001,mode=0700',
    '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=64m,uid=10001,gid=10001,mode=0700',
    '--mount', `type=bind,source=${archive},target=/input/source.tar,readonly`, '--workdir=/work',
    '--entrypoint=/bin/sh', image, '-c', 'tar -xf /input/source.tar -C /work && touch /tmp/foliage-ready && exec sleep infinity'];
}

export async function runLocal({ repo, commit, image, scenario, output, docker = 'docker', trustedLocalCode = false, signal, signing = null }) {
  if (!trustedLocalCode) throw Error('owner-controlled-code-required');
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit ?? '')) throw Error('exact-commit-required');
  if (!/^sha256:[a-f0-9]{64}$/.test(image ?? '')) throw Error('local-image-id-required');
  scenario = parseScenario(scenario);
  repo = resolve(repo); output = resolve(output);
  // Reserve the receipt before execution: never run over an existing result or overwrite it.
  const artifacts = `${output}.artifacts`;
  await mkdir(artifacts, { mode: 0o700 });
  let receipt;
  try { receipt = await open(output, 'wx', 0o600); }
  catch (error) {
    try { await rmdir(artifacts); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'receipt-reservation-and-artifact-cleanup-failed'); }
    throw error;
  }
  const startedAt = new Date().toISOString(), jobId = randomUUID(), attemptId = randomUUID();
  const name = `foliage-eval-${jobId}`;
  const events = [];
  const event = async (kind, detail = {}) => {
    const entry = { sequence: events.length, jobId, attemptId, at: new Date().toISOString(), kind, ...detail };
    events.push(entry);
    await appendFile(join(artifacts, 'events.jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  };
  const evidence = { jobId, attemptId, startedAt, finishedAt: null, executor: 'local-docker', evaluator: { version: 1, implementationDigest: null, hostNode: process.version }, trust: 'owner-controlled-locally-reported',
    source: { commit, tree: null, archiveDigest: null, archiveBytes: null }, scenario: { id: scenario.id, digest: digest(canonical(scenario)), file: `${basename(artifacts)}/scenario.json` },
    runtime: { image, platform: null, engineVersion: null, limits: LIMITS }, status: 'error', reason: null, failure: null,
    steps: [], stages: [], cleanup: { container: 'not-created', snapshot: 'not-created' },
    scope: 'Command outcomes under the recorded scenario; not authorship, achievement, impact or independent verification.' };
  if (scenario.browser) evidence.browser = { version: 1, status: 'not-run', reason: 'command-steps-incomplete', capture: null, measurements: null,
    cleanup: { browser: 'not-created', relay: 'not-created' } };
  let temp, createAttempted = false, dockerEndpoint = null;
  // Pin the inspected socket, so another session changing Docker's current context cannot
  // redirect this job's later source mount, execution or cleanup to a different engine.
  const invokeDocker = (args, options = {}) => command(docker, dockerEndpoint === null ? args : ['--host', dockerEndpoint, ...args], options);
  const checked = async (binary, args, code, options = {}) => {
    const result = await (binary === docker ? invokeDocker(args, { signal, ...options }) : command(binary, args, { signal, ...options }));
    if (result.reason || result.code !== 0) {
      evidence.failure = { operation: code, cause: result.reason ?? 'nonzero-exit', exitCode: result.code, durationMs: result.durationMs };
      throw Error(result.reason === 'cancelled' ? 'cancelled' : code);
    }
    return result.stdout;
  };
  try {
    const implementation = await Promise.all(['local.mjs', 'process.mjs', 'contract.mjs', 'cli.mjs', 'browser.mjs', '../capture/capture.mjs', '../capture/cdp.mjs'].map(async file =>
      ({ file, digest: digest(await readFile(new URL(file, import.meta.url))) })));
    evidence.evaluator.implementationDigest = digest(canonical(implementation));
    await writeFile(join(artifacts, 'scenario.json'), `${JSON.stringify(scenario, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await event('job-started');
    // Do not send proprietary source to an operator's remotely selected Docker engine.
    const context = (await checked(docker, ['context', 'show'], 'docker-unavailable')).toString().trim();
    const endpoint = JSON.parse((await checked(docker, ['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'], 'docker-context-unavailable')).toString());
    if (typeof endpoint !== 'string' || !endpoint.startsWith('unix://')) throw Error('local-docker-required');
    dockerEndpoint = endpoint;
    const metadata = JSON.parse((await checked(docker, ['image', 'inspect', image], 'image-unavailable')).toString())[0];
    if (metadata?.Id !== image || metadata?.Os !== 'linux') throw Error('invalid-runtime-image');
    evidence.runtime.platform = `${metadata.Os}/${metadata.Architecture}`;
    evidence.runtime.engineVersion = (await checked(docker, ['version', '--format', '{{.Server.Version}}'], 'docker-unavailable')).toString().trim();
    const revision = (await checked('git', ['-C', repo, 'rev-parse', '--verify', `${commit}^{commit}`], 'commit-unavailable')).toString().trim();
    if (revision !== commit) throw Error('commit-mismatch');
    evidence.source.tree = (await checked('git', ['-C', repo, 'rev-parse', '--verify', `${commit}^{tree}`], 'tree-unavailable')).toString().trim();
    const bytes = await checked('git', ['-C', repo, 'archive', '--format=tar', commit], 'snapshot-failed', { maxBytes: MAX_SOURCE_ARCHIVE_BYTES, timeoutMs: 30_000 });
    evidence.source.archiveDigest = digest(bytes); evidence.source.archiveBytes = bytes.length;
    temp = await mkdtemp(join(tmpdir(), 'foliage-eval-')); await chmod(temp, 0o700);
    const archive = join(temp, 'source.tar');
    await writeFile(archive, bytes, { mode: 0o444, flag: 'wx' });
    createAttempted = true;
    await checked(docker, containerArgs(name, image, archive), 'container-create-failed');
    await checked(docker, ['start', name], 'container-start-failed');
    await checked(docker, ['exec', name, '/bin/sh', '-c', 'i=0; until test -f /tmp/foliage-ready; do i=$((i+1)); test "$i" -lt 100 || exit 1; sleep 0.1; done'], 'snapshot-extraction-failed');
    await event('runtime-ready');
    evidence.status = 'completed';
    for (const [index, step] of scenario.steps.entries()) {
      if (signal?.aborted) throw Error('cancelled');
      await event('step-started', { index, stage: step.stage });
      const result = await invokeDocker(['exec', '--workdir=/work', name, '/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp', ...step.argv],
        { timeoutMs: step.timeoutMs, maxBytes: LIMITS.outputBytesPerStep, signal });
      const stem = `step-${index + 1}`;
      const logs = {};
      for (const channel of ['stdout', 'stderr']) {
        const file = `${stem}.${channel}.log`;
        await writeFile(join(artifacts, file), result[channel], { mode: 0o600, flag: 'wx' });
        logs[channel] = { file: `${basename(artifacts)}/${file}`, bytes: result[channel].length, digest: digest(result[channel]), truncated: result.truncated };
      }
      const status = result.reason === 'cancelled' ? 'cancelled' : result.reason ? 'error' : result.code === 0 ? 'completed' : 'failed';
      evidence.steps.push({ index, stage: step.stage, commandDigest: digest(canonical(step.argv)), timeoutMs: step.timeoutMs,
        status, exitCode: result.code, exitCodeSource: 'docker-exec-client', terminationSignal: result.signal, reason: result.reason, durationMs: result.durationMs, logs });
      await event('step-finished', { index, stage: step.stage, status, reason: result.reason, durationMs: result.durationMs });
      if (status !== 'completed') { evidence.status = status; evidence.reason = result.reason ?? 'command-or-executor-nonzero'; break; }
    }
    if (scenario.browser && evidence.status === 'completed') {
      await event('browser-started');
      evidence.browser = await observeJobBrowser({ docker, endpoint: dockerEndpoint, name, selected: scenario.browser,
        artifacts, invoke: invokeDocker, signal });
      await event('browser-finished', { status: evidence.browser.status, reason: evidence.browser.reason });
      if (evidence.browser.status !== 'completed') {
        evidence.status = evidence.browser.status; evidence.reason = evidence.browser.reason;
      }
    }
  } catch (error) {
    evidence.status = error.message === 'cancelled' ? 'cancelled' : 'error';
    // Known local codes only; provider, source, and filesystem error text never enters receipts.
    evidence.reason = /^[a-z]+(?:-[a-z]+)*$/.test(error.message) ? error.message : 'executor-error';
  } finally {
    if (createAttempted) {
      const cleanup = await invokeDocker(['rm', '--force', name], { timeoutMs: 10_000 });
      evidence.cleanup.container = cleanup.code === 0 && !cleanup.reason ? 'removed' : 'unconfirmed';
    }
    if (temp) {
      try { await rm(temp, { recursive: true, force: true }); evidence.cleanup.snapshot = 'removed'; }
      catch { evidence.cleanup.snapshot = 'unconfirmed'; }
    }
    if (Object.values(evidence.cleanup).includes('unconfirmed')) { evidence.status = 'error'; evidence.reason ??= 'cleanup-unconfirmed'; }
  }
  evidence.stages = STAGES.map(stage => ({ stage, status: evidence.steps.some(step => step.stage === stage) ? 'attempted' : 'not-run' }));
  evidence.finishedAt = new Date().toISOString();
  try {
    try { await event('job-finished', { status: evidence.status, reason: evidence.reason, cleanup: evidence.cleanup }); }
    catch { evidence.status = 'error'; evidence.reason ??= 'trace-write-failed'; }
    try {
      const trace = await readFile(join(artifacts, 'events.jsonl'));
      evidence.events = { file: `${basename(artifacts)}/events.jsonl`, digest: digest(trace) };
    } catch { evidence.events = { file: null, digest: null }; evidence.status = 'error'; evidence.reason ??= 'trace-unavailable'; }
    const envelope = sealEvidence(evidence, signing);
    await receipt.writeFile(`${JSON.stringify(envelope, null, 2)}\n`);
    await receipt.sync();
    return envelope;
  } finally { await receipt.close(); }
}
