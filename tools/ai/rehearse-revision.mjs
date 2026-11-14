#!/usr/bin/env node
/** Opt-in local model rehearsal. Never a Ladybug runtime provider or a cloud fallback. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadLeafDocument } from '../../apps/leaf/src/leafDocument.ts';
import { exportLeafletReview } from '../../apps/leaf/src/leafletRevision.ts';
import { renderSuggestionReview, saveLeafletSuggestion } from '../../apps/leaf/src/leafletJourney.ts';
import { previewWorkflowImport } from '../../apps/canopy/src/workflowImport.ts';
import { DIMENSIONS, digest, parseFindings } from '../../apps/canopy/src/ladybugAssessment.ts';
import { loadWorkspace, savePacket, runAssessment, exportLeafletSuggestion } from '../../apps/canopy/src/ladybugWorkspace.ts';

const { values } = parseArgs({ options: { leaf: { type: 'string' }, leaflet: { type: 'string' }, model: { type: 'string' }, title: { type: 'string' }, run: { type: 'boolean' }, structured: { type: 'boolean' } } });
if (!values.leaf || !values.leaflet || !values.model || !values.title) throw new Error('Use --leaf PATH --leaflet ID --model INSTALLED_MODEL --title REVIEWED_WORDING [--run]. Only --run calls local Ollama and writes a new isolated test directory.');
const sourceBytes = await readFile(values.leaf);
const source = await loadLeafDocument({ FOLIAGE_LEAF: values.leaf });
if (!source.ok || source.source.declaredExample || source.source.bundledExample) throw new Error('A real, readable Leaf is required.');
const request = exportLeafletReview(source.leaf, values.leaflet);
const packet = previewWorkflowImport(JSON.stringify(request), 'local-revision-rehearsal', source.leaf.subject);
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const schema = object({ findings: { type: 'array', minItems: 6, maxItems: 6, items: object({
  dimension: { type: 'string', enum: DIMENSIONS }, observation: { type: 'string' }, caveat: { type: 'string' },
  citations: { type: 'array', minItems: 1, maxItems: 6, items: object({ source: { type: 'string', enum: ['evidence', 'knownWork', 'market'] }, quote: { type: 'string' } }) },
}) } });
if (!values.run) {
  console.log(JSON.stringify({ status: 'preview-only', model: values.model, evidenceCharacters: packet.evidence.length, target: packet.target, next: '--run sends this selected packet to local Ollama only. No cloud request or original-document write occurs.' }, null, 2));
  process.exit(0);
}
const output = await mkdtemp(join(tmpdir(), 'foliage-local-revision-'));
const leafPath = join(output, 'leaf.json');
const workspacePath = join(output, 'assessment.json');
const save = (name, data) => writeFile(join(output, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
await writeFile(leafPath, sourceBytes, { mode: 0o600, flag: 'wx' });
await save('review-request.json', request);
await savePacket(workspacePath, digest(null), packet);
const report = { format: 'foliage.local-revision-rehearsal.v1', at: new Date().toISOString(), runtime: 'local Ollama rehearsal; not Ladybug cloud', model: values.model, structuredOutput: !!values.structured, target: request.target, cloudCalls: 0, localCalls: 0, checks: [], status: 'failed' };
const started = performance.now();
// Exercise the unchanged production request/parser via its existing injected fetch seam.
// The placeholder credential and approval exist only inside this test invocation. No
// request or authorization header is forwarded to Fireworks, and no config is persisted.
const localTransport = async (url, options) => {
  assert.equal(String(url), 'https://api.fireworks.ai/inference/v1/chat/completions');
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  const requested = JSON.parse(options.body);
  assert.equal(requested.store, false);
  report.localCalls++;
  const localRequest = { model: values.model, stream: false, think: false, format: values.structured ? schema : 'json', messages: requested.messages,
    options: { temperature: 0, num_predict: requested.max_tokens, num_ctx: 16384 } };
  await save('local-request.json', localRequest);
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', redirect: 'error', signal: options.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(localRequest),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Local Ollama refused HTTP ${response.status}`); }
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > 256 * 1024) throw new Error('Local response exceeded the rehearsal limit.'); chunks.push(part.value); }
  } finally { await reader.cancel(); }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  report.finishReason = body.done_reason;
  report.inputTokens = body.prompt_eval_count;
  report.outputTokens = body.eval_count;
  // On a timeout there is no final Ollama response; do not invent phase timings.
  for (const [field, name] of [['load_duration', 'loadMs'], ['prompt_eval_duration', 'promptMs'], ['eval_duration', 'generationMs']]) {
    if (Number.isFinite(body[field]) && body[field] >= 0) report[name] = body[field] / 1e6;
  }
  await save('model-answer.json', { runtime: report.runtime, model: values.model, content: body.message?.content, finishReason: body.done_reason });
  // Record why an actual answer failed the same validation, without repairing it.
  try { parseFindings(JSON.parse(body.message.content).findings, packet); }
  catch (error) { report.validationFailure = error.message; }
  try {
    report.findingFailures = JSON.parse(body.message.content).findings.flatMap((finding, index) => {
      try { parseFindings([finding], packet); return []; }
      catch (error) { return [{ index, reason: error.message }]; }
    });
  } catch { /* The whole-response failure above remains authoritative. */ }
  return new Response(JSON.stringify({ choices: [{ finish_reason: body.done === true && body.done_reason === 'stop' ? 'stop' : 'length', message: { content: body.message?.content } }] }));
};
try {
  const draft = await loadWorkspace(workspacePath);
  await runAssessment(workspacePath, digest(draft), packet.id, {
    FOLIAGE_ESCALATED_INFERENCE_MODEL: `local-rehearsal/ollama/${values.model}`,
    FOLIAGE_ESCALATED_INFERENCE_KEY: 'local-test-placeholder-never-sent',
    FOLIAGE_ASSESSMENT_PROVIDER_APPROVED: 'true',
  }, async (url, options) => {
    try { return await localTransport(url, options); }
    catch (error) { report.transportFailure = options.signal?.aborted ? 'Local Ollama exceeded the assessment timeout.' : 'Local Ollama transport or response failed.'; throw error; }
  });
  const assessed = await loadWorkspace(workspacePath);
  if (assessed.status !== 'assessed') throw new Error(assessed.failure || 'No accepted local assessment.');
  report.checks.push('unchanged assessment validation accepted real local-model output');
  const suggestion = exportLeafletSuggestion(assessed, digest(assessed), values.title);
  await save('suggestion.json', suggestion);
  const env = { FOLIAGE_LEAF: leafPath };
  const before = await loadLeafDocument(env); assert.ok(before.ok);
  const html = renderSuggestionReview(before, suggestion);
  assert.ok(html.includes('<h1>Review suggestion.</h1>'));
  await writeFile(join(output, 'review-preview.html'), html, { mode: 0o600, flag: 'wx' });
  const form = new URLSearchParams({ suggestion: JSON.stringify(suggestion), documentRevision: before.source.documentDigest,
    reviewer: 'Codex local model rehearsal', subject: before.leaf.subject });
  await saveLeafletSuggestion(env, form);
  const after = await loadLeafDocument(env); assert.ok(after.ok);
  const original = before.leaf.leaflets.find(l => l.id === values.leaflet);
  const revised = after.leaf.leaflets.find(l => l.id === values.leaflet);
  assert.equal(revised.title, values.title.trim());
  assert.equal(revised.tier, original.tier); assert.equal(revised.visibility, original.visibility);
  assert.deepEqual(revised.provenance, original.provenance);
  assert.deepEqual(revised.body.slice(0, original.body?.length ?? 0), original.body ?? []);
  assert.equal(after.leaf.leaflets.length, before.leaf.leaflets.length);
  assert.deepEqual(after.leaf.leaflets.filter(l => l.id !== values.leaflet), before.leaf.leaflets.filter(l => l.id !== values.leaflet));
  report.checks.push('revision export, local preview and reviewed acceptance', 'original evidence, proof, visibility and unrelated Leaflets preserved');
  const acceptedBytes = await readFile(leafPath);
  await assert.rejects(saveLeafletSuggestion(env, form), /changed/);
  assert.deepEqual(await readFile(leafPath), acceptedBytes);
  report.checks.push('stale replay refused without rewriting the document');
  report.findings = assessed.assessment.findings.length;
  report.status = 'passed-contract-checks';
} catch (error) { report.error = report.transportFailure ?? error.message; if (report.transportFailure) report.assessmentGateFailure = error.message; process.exitCode = 1; }
finally {
  report.originalUnchanged = (await readFile(values.leaf)).equals(sourceBytes);
  if (!report.originalUnchanged) { report.status = 'failed'; report.error = 'Source changed during rehearsal; this harness did not write it.'; process.exitCode = 1; }
  report.durationMs = Math.round(performance.now() - started);
  await save('report.json', report);
  console.log(JSON.stringify({ ...report, output }, null, 2));
}
