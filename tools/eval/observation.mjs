/** Selected local receipt projection only; this is not remote execution/trust admission. */
import { canonical, digest, MAX_SOURCE_ARCHIVE_BYTES, STAGES, verifyEvidence } from './contract.mjs';

const fail = () => { throw Error('invalid-local-evaluation-receipt'); };
const requireValue = (condition, value) => condition ? value : fail();
const object = value => requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), value);
const match = (value, pattern) => requireValue(typeof value === 'string' && pattern.test(value), value);
const hash = value => match(value, /^sha256:[a-f0-9]{64}$/);
const gitHash = value => match(value, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const uuid = value => match(value, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const integer = (value, max = Number.MAX_SAFE_INTEGER) => requireValue(Number.isSafeInteger(value) && value >= 0 && value <= max, value);
const oneOf = (value, values) => requireValue(values.includes(value), value);
const nullable = (value, parse) => value === null ? null : parse(value);
const time = value => {
  match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  return requireValue(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, value);
};
const reason = value => nullable(value, item => match(item, /^[a-z]+(?:-[a-z]+)*$/));
const outcome = value => oneOf(value, ['completed', 'failed', 'error', 'cancelled']);
// Node may report a negative OS error code when the client could not be spawned.
const exitCode = value => nullable(value, item => requireValue(Number.isInteger(item) && item >= -2147483648 && item <= 2147483647, item));
const shown = value => value === null ? 'unavailable' : String(value);

export function receiptObservation(receipt, target, signing = null) {
  object(receipt);
  requireValue(receipt.format === 'foliage-evaluation' && receipt.version === 1, true);
  const originalDigest = hash(receipt.digest);
  requireValue(originalDigest === digest(canonical({ format: receipt.format, version: receipt.version, evidence: receipt.evidence })), true);
  let signature = 'unsigned; no signer authenticated';
  if (receipt.signature !== null) {
    if (!signing || !verifyEvidence(receipt, signing.key, signing.keyId)) throw Error('receipt-signature-not-verified');
    match(signing.keyId, /^[a-zA-Z0-9_-]{1,64}$/);
    signature = `original receipt signature checked with selected key ${signing.keyId}; public key ${digest(signing.key.export({ type: 'spki', format: 'der' }))}`;
  } else if (signing !== null) throw Error('selected-receipt-is-unsigned');
  const e = object(receipt.evidence);
  requireValue(e.executor === 'local-docker' && e.trust === 'owner-controlled-locally-reported', true);
  const job = uuid(e.jobId), attempt = uuid(e.attemptId);
  const started = time(e.startedAt), finished = time(e.finishedAt);
  requireValue(started <= finished, true);
  const source = object(e.source), evaluator = object(e.evaluator), runtime = object(e.runtime);
  requireValue(evaluator.version === 1, true);
  const limits = object(runtime.limits), cleanup = object(e.cleanup);
  // These are declared fields, not a verification that restrictions or commands ran.
  const lines = [
    'Selected local executor report. No independent observer measurement is supplied.',
    'This does not establish test correctness, authorship, achievement, impact or attribution to the selected person.',
    `Original payload digest: ${originalDigest}`,
    `Selected envelope digest: ${digest(canonical(receipt))}`,
    `Signature: ${signature}. The signature does not sign this projection.`,
    `Origin: ${e.executor}; ${e.trust}`,
    `Job: ${job}; attempt: ${attempt}`,
    `Started: ${started}; finished: ${finished}`,
    `Declared outcome: ${outcome(e.status)}; reason: ${shown(reason(e.reason))}`,
    `Source commit: ${gitHash(source.commit)}; tree: ${shown(nullable(source.tree, gitHash))}`,
    `Source archive digest: ${shown(nullable(source.archiveDigest, hash))}; bytes: ${shown(nullable(source.archiveBytes, v => integer(v, MAX_SOURCE_ARCHIVE_BYTES)))}`,
    `Scenario digest: ${hash(object(e.scenario).digest)}`,
    `Evaluator version: 1; implementation digest: ${shown(nullable(evaluator.implementationDigest, hash))}`,
    `Runtime image: ${hash(runtime.image)}`,
    `Declared limits: network ${oneOf(limits.network, ['none'])}; CPUs ${integer(limits.cpus, 128)}; memory bytes ${integer(limits.memoryBytes)}; PIDs ${integer(limits.pids)}; work bytes ${integer(limits.workBytes)}; output bytes per step ${integer(limits.outputBytesPerStep, 131072)}`,
    `Cleanup: container ${oneOf(cleanup.container, ['not-created', 'removed', 'unconfirmed'])}; snapshot ${oneOf(cleanup.snapshot, ['not-created', 'removed', 'unconfirmed'])}`,
    `Events digest: ${shown(nullable(object(e.events).digest, hash))}`,
  ];
  if (e.failure === null) lines.push('Executor failure detail: none reported');
  else {
    const f = object(e.failure);
    lines.push(`Executor failure: ${shown(reason(f.operation))}; cause: ${shown(reason(f.cause))}; exit: ${shown(exitCode(f.exitCode))}; duration ms: ${integer(f.durationMs)}`);
  }
  requireValue(Array.isArray(e.steps) && e.steps.length <= 16, true);
  let previousStage = -1;
  for (const [index, step] of e.steps.entries()) {
    object(step);
    requireValue(step.index === index && STAGES.indexOf(step.stage) >= previousStage && step.timeoutMs >= 100, true);
    requireValue(step.status !== 'completed' || (step.exitCode === 0 && step.reason === null && step.terminationSignal === null), true);
    previousStage = STAGES.indexOf(oneOf(step.stage, STAGES));
    const logs = object(step.logs);
    const channels = ['stdout', 'stderr'].map(channel => {
      const log = object(logs[channel]);
      requireValue(typeof log.truncated === 'boolean', true);
      return `${channel} bytes ${integer(log.bytes, 131072)}, digest ${hash(log.digest)}, truncated ${log.truncated}`;
    });
    lines.push(`Step ${index + 1}: ${step.stage}; ${outcome(step.status)}; command digest ${hash(step.commandDigest)}; timeout ms ${integer(step.timeoutMs, 600000)}; exit ${shown(exitCode(step.exitCode))} from ${oneOf(step.exitCodeSource, ['docker-exec-client'])}; reason ${shown(reason(step.reason))}; signal ${shown(nullable(step.terminationSignal, v => match(v, /^SIG[A-Z0-9]{1,16}$/)))}; duration ms ${integer(step.durationMs)}; ${channels.join('; ')}`);
  }
  requireValue(Array.isArray(e.stages) && e.stages.length === STAGES.length, true);
  for (const [index, stage] of e.stages.entries()) {
    object(stage);
    requireValue(stage.stage === STAGES[index], true);
    requireValue(stage.status === (e.steps.some(step => step.stage === stage.stage) ? 'attempted' : 'not-run'), true);
    lines.push(`${e.browser === undefined ? 'Stage' : 'Command stage'} ${stage.stage}: ${stage.status}`);
  }
  if (e.browser !== undefined) {
    const b = object(e.browser), bc = object(b.cleanup);
    requireValue(b.version === 1, true);
    oneOf(b.status, ['not-run', 'completed', 'error', 'cancelled']);
    lines.push(`Browser observation: ${b.status}; reason: ${shown(reason(b.reason))}`);
    lines.push(`Browser cleanup: browser ${oneOf(bc.browser, ['not-created', 'removed', 'unconfirmed'])}; relay ${oneOf(bc.relay, ['not-created', 'removed', 'unconfirmed'])}`);
    if (b.measurements !== null) {
      const m = object(b.measurements);
      lines.push(`Browser measured before recording: horizontal overflow px ${integer(m.horizontalOverflowPx)}; unnamed controls ${integer(m.unnamedControlCount)}; broken images ${integer(m.brokenImageCount)}; console errors ${integer(m.consoleErrors)}; page exceptions ${integer(m.pageExceptions)}; failed requests ${integer(m.failedRequests)}.`);
    }
    if (b.capture !== null) {
      const c = object(b.capture);
      match(c.id, /^capture-[A-Za-z0-9_-]{6,64}$/);
      requireValue(source.tree !== null && source.archiveDigest !== null, true);
      lines.push(`Same-job capture receipt digest: ${hash(c.receiptDigest)}`);
      lines.push(`Captured PNG digest: ${hash(c.screenshotDigest)}; MP4 digest: ${hash(c.videoDigest)}`);
      lines.push('The local observer reached only the selected port inside this job after its command steps. The app used the prepared snapshot from the recorded commit; dependencies came from the selected image and scenario. This is not a deployed-app attestation.');
    }
    requireValue(b.status !== 'completed' || (b.capture !== null && b.reason === null && bc.browser === 'removed' && bc.relay === 'removed'), true);
    requireValue(b.status !== 'not-run' || (b.capture === null && b.measurements === null && bc.browser === 'not-created' && bc.relay === 'not-created'), true);
    requireValue(e.status !== 'completed' || b.status === 'completed', true);
  }
  requireValue(e.status !== 'completed' || (e.steps.some(step => step.stage === 'execute') && e.steps.every(step => step.status === 'completed') &&
    e.reason === null && e.failure === null && cleanup.container === 'removed' && cleanup.snapshot === 'removed' &&
    source.tree !== null && source.archiveDigest !== null && source.archiveBytes !== null && evaluator.implementationDigest !== null && e.events.digest !== null), true);
  lines.push('Raw logs, commands, scenario labels, filesystem paths and host identifiers are omitted. Artifact contents were not opened or verified. Missing values remain unavailable. Human review is required; nothing is approved or published.');
  return { format: 'foliage-observations', version: 1,
    subject: { leafId: target.id, name: target.subject },
    source: { provider: 'foliage-eval', tenantId: null, accountId: digest(canonical([target.id, target.subject])) },
    completion: 'complete', deletedRecordIds: [],
    observations: [{ recordId: `${job}:${attempt}`, revision: 'local-receipt-v1',
      title: 'Selected local evaluation report', excerpt: lines.join('\n'), observedAt: finished }] };
}
