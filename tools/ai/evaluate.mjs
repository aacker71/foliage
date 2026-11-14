#!/usr/bin/env node
/** Explicit real-packet evaluation through the local Dify service. */
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseWorkflowTransfer } from '../../apps/leaf/src/workflowTransfer.ts';
import { reviewScarletAnswer } from '../../apps/leaf/src/scarletAnswerReview.ts';
import { stateDir, baseURL } from './dify.mjs';
import { workflow } from './workflow.mjs';

export function packetContext(value) {
  const p = parseWorkflowTransfer(value);
  return { tool: { name: 'read_workflow', id: p.packetId }, documentDigest: p.digest, purpose: 'review', matched: 1, omitted: p.omitted,
    documents: [{ citation: 'L1', id: p.packetId, title: p.title, body: [],
      workflowEvidence: p.evidence.map(e => ({ ...e, email: '' })),
      ...(p.capturedAt ? { capturedAt: p.capturedAt } : {}),
      notes: ['Commit subjects only; patches were not read. Integrity does not prove authorship.',
        `${p.omitted} additional commits omitted.`, ...(p.capturedAt ? [] : ['Capture time is unknown. Saved time is not observation time.'])] }] };
}
export async function evaluatePacket({ packet, config, model = 'llama3.2:3b', fetcher = fetch, timeoutMs = 240000 }) {
  const context = packetContext(packet);
  if (config.baseURL !== baseURL || !/^[a-f0-9-]{36}$/.test(config.appId) || !/^[a-f0-9-]{36}$/.test(config.workflowId) || typeof config.apiKey !== 'string' || !config.apiKey) throw new Error('Invalid local Dify configuration.');
  const workflowDigest = createHash('sha256').update(JSON.stringify(workflow, null, 2)).digest('hex');
  if (config.workflowDigest !== workflowDigest) throw new Error('Workflow revision differs from the locally provisioned revision. Review and provision it first.');
  const traceId = randomUUID();
  const started = performance.now();
  const report = { schema: 'foliage.ai.eval.v1', traceId, at: new Date().toISOString(), workflowDigest, workflowId: config.workflowId, status: 'error' };
  let answer;
  try {
    const response = await fetcher(`${baseURL}/v1/workflows/${config.workflowId}/run`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ inputs: { context: JSON.stringify(context), model }, response_mode: 'blocking', user: traceId }),
    });
    if (!response.ok) { report.code = `http-${response.status}`; return { report }; }
    // Bounded stream: never buffer an unbounded upstream error or response.
    const reader = response.body.getReader(); let raw = ''; let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 262144) { await reader.cancel(); report.code = 'response-too-large'; return { report }; }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    const result = JSON.parse(raw + decoder.decode());
    const data = result.data;
    if (/^[a-f0-9-]{36}$/.test(result.workflow_run_id ?? '')) report.difyRunId = result.workflow_run_id;
    if (data?.status !== 'succeeded') { report.code = 'workflow-failed'; return { report }; }
    if (typeof data.outputs?.answer !== 'string' || !data.outputs.answer.trim()) { report.code = 'missing-answer'; return { report }; }
    const review = reviewScarletAnswer(data.outputs.answer, context);
    report.status = review.findings.length ? 'needs-review' : 'passed-contract-checks';
    report.findings = review.findings.map(f => f.code);
    for (const [out, key] of [['inputTokens', 'input_tokens'], ['outputTokens', 'output_tokens']]) {
      const value = data.outputs[key]; if (Number.isSafeInteger(value) && value >= 0) report[out] = value;
    }
    answer = data.outputs.answer;
    return { report, answer };
  } catch (error) {
    report.code = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'transport-or-response-error';
    return { report };
  } finally { report.durationMs = Math.round(performance.now() - started); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const packetPath = args[args.indexOf('--packet') + 1];
    if (!args.includes('--packet') || !packetPath) throw new Error('Use --packet /path/to/reviewed-export.json [--send] [--model installed-name].');
    const packet = JSON.parse(readFileSync(packetPath, 'utf8')); const context = packetContext(packet);
    if (!args.includes('--send')) console.log(`Valid packet: ${context.documents[0].workflowEvidence.length} retained commit references, ${context.omitted} omitted. --send stores this private context and model output in local Dify traces.`);
    else {
      const config = JSON.parse(readFileSync(join(stateDir, 'workflow.json'), 'utf8'));
      const modelAt = args.indexOf('--model');
      const { report } = await evaluatePacket({ packet, config, ...(modelAt < 0 ? {} : { model: args[modelAt + 1] }) });
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      appendFileSync(join(stateDir, 'evaluations.jsonl'), JSON.stringify(report) + '\n', { mode: 0o600 });
      console.log(JSON.stringify(report, null, 2));
      console.log(`Inspect node inputs and outputs: ${baseURL}/app/${config.appId}/logs`);
      if (report.status !== 'passed-contract-checks') process.exitCode = 1;
    }
  } catch { console.error('Evaluation could not start. Check packet integrity, local provisioning and command arguments. No evidence was printed.'); process.exitCode = 1; }
}
