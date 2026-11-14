/** Protocol responses below are explicit stubs, never reported as model quality evidence. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { evaluatePacket, packetContext } from './evaluate.mjs';
import { workflow } from './workflow.mjs';
import { baseURL } from './dify.mjs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
const content = { format: 'foliage-workflow-packet', version: 1, packetId: createHash('sha256').update(sha).digest('hex'),
  sourceId: createHash('sha256').update('repository-under-test').digest('hex'), title: git('show', '-s', '--format=%s', sha),
  capturedAt: null, savedAt: new Date().toISOString(), evidence: [{ sha, title: git('show', '-s', '--format=%s', sha) }], omitted: 0 };
const packet = { ...content, digest: `sha256:${createHash('sha256').update(JSON.stringify(content)).digest('hex')}` };
const config = { baseURL, workflowId: '22222222-2222-2222-2222-222222222222', appId: '11111111-1111-1111-1111-111111111111', apiKey: 'stub-not-a-real-key',
  workflowDigest: createHash('sha256').update(JSON.stringify(workflow, null, 2)).digest('hex') };
const response = (answer) => Response.json({ workflow_run_id: config.appId, data: { status: 'succeeded', outputs: { answer } } });

test('rejects altered evidence and external endpoints before any request', async () => {
  let calls = 0; const fetcher = async () => { calls++; throw new Error(); };
  await assert.rejects(evaluatePacket({ packet: { ...packet, title: 'edited' }, config, fetcher }));
  await assert.rejects(evaluatePacket({ packet, config: { ...config, baseURL: 'https://example.org' }, fetcher }));
  await assert.rejects(evaluatePacket({ packet, config: { ...config, workflowDigest: 'changed' }, fetcher }));
  assert.equal(calls, 0);
  assert.equal('capturedAt' in packetContext(packet).documents[0], false);
});
test('sends explicit context locally with redirects refused; reports only metadata', async () => {
  const answer = 'Contract test sentence [L1].';
  const result = await evaluatePacket({ packet, config, fetcher: async (url, request) => {
    assert.equal(url, `${baseURL}/v1/workflows/${config.workflowId}/run`); assert.equal(request.redirect, 'error');
    assert.ok(request.signal); assert.equal(JSON.parse(JSON.parse(request.body).inputs.context).documentDigest, packet.digest);
    return response(answer);
  } });
  assert.equal(result.report.status, 'passed-contract-checks');
  assert.equal(result.answer, answer);
  for (const privateText of [answer, packet.digest, config.apiKey, packet.title]) assert.ok(!JSON.stringify(result.report).includes(privateText));
});
test('existing local-agent contract checks flag invented citations and rating language', async () => {
  const result = await evaluatePacket({ packet, config, fetcher: async () => response('A claim [L99].') });
  assert.equal(result.report.status, 'needs-review');
  assert.ok(result.report.findings.includes('unknown-citation'));
  const rated = await evaluatePacket({ packet, config, fetcher: async () => response('A 5 out of 5 rating [L1].') });
  assert.ok(rated.report.findings.includes('rating-language'));
});
test('errors do not copy provider response bodies or exception text into diagnostics', async () => {
  for (const [fetcher, code] of [
    [async () => new Response('private runtime detail', { status: 502 }), 'http-502'],
    [async () => { throw new DOMException('private timeout detail', 'TimeoutError'); }, 'timeout'],
    [async () => Response.json({ data: { status: 'failed', error: 'private context' } }), 'workflow-failed'],
    [async () => new Response('x'.repeat(262145)), 'response-too-large'],
  ]) {
    const { report } = await evaluatePacket({ packet, config, fetcher });
    assert.equal(report.code, code); assert.equal(report.status, 'error');
    assert.ok(!JSON.stringify(report).includes('private')); assert.ok(Number.isFinite(report.durationMs));
  }
});
test('workflow has only the explicit local model destination, no model-controlled tool URLs', () => {
  const http = workflow.workflow.graph.nodes.filter(n => n.data.type === 'http-request');
  assert.equal(http.length, 1); assert.equal(http[0].data.url, 'http://host.docker.internal:11434/api/chat');
  assert.deepEqual(workflow.dependencies, []);
});
