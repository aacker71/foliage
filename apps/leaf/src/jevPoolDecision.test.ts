/** Protocol fixtures over actual repository prose, never model-accuracy or career evidence. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { checkJevPoolSelection, decideJevPool, prepareJevPoolSelection, type JevPoolSelection } from './jevPoolDecision.ts';

const text = (await readFile(new URL('../../../context/product-thesis.md', import.meta.url), 'utf8')).slice(0,800).trim();
const selection: JevPoolSelection = {
  caller: 'photosynthesis', subject: 'protocol-subject', pool: 'protocol-pool',
  purpose: 'Retain product decisions', criteria: 'Keep changes to the product direction.',
  documentRevision: `sha256:${'a'.repeat(64)}`, policyRevision: `sha256:${'b'.repeat(64)}`,
  material: { id: 'protocol-material', text, evidenceRefs: ['protocol-source'] }, existingContext: [],
};
const approval = (value: unknown = selection) => ({ provider: 'typesafe', selectionDigest: prepareJevPoolSelection(value).selectionDigest });
const env = { TYPESAFE_API_KEY: 'protocol-only-not-a-credential' };
const reply = (decision = 'keep', reason = 'meaningful_work', confidence = 0.97) => Response.json({
  model: 'jev-1.13.0', answers: { decision: { type: 'choice', choice: decision, confidence }, reason: { type: 'choice', choice: reason, confidence } },
});

test('both callers use identical minimized provider state with locally distinct receipts', async () => {
  const requests: unknown[] = [];
  for (const caller of ['photosynthesis', 'scarlet'] as const) {
    const input = { ...selection, caller };
    const before = JSON.stringify(input);
    const receipt = await decideJevPool(input, approval(input), env, async (url, init) => {
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      requests.push(body.state);
      assert.deepEqual(body.state, { purpose: input.purpose, criteria: input.criteria, material: text, existingContext: [] });
      for (const privateId of [input.subject, input.pool, input.material.id, ...input.material.evidenceRefs, input.documentRevision]) assert.ok(!String(init?.body).includes(privateId));
      return reply();
    });
    assert.equal(receipt.caller, caller);
    assert.equal(receipt.outcome, 'keep');
    assert.equal(receipt.selectionDigest, approval(input).selectionDigest);
    assert.equal(JSON.stringify(input), before);
    assert.ok(!JSON.stringify(receipt).includes(text));
    assert.deepEqual(receipt.evidenceRefs, input.material.evidenceRefs);
  }
  assert.deepEqual(requests[0], requests[1]);
});

test('transfer binding refuses changed caller, subject, pool, material, context and policy before egress', async () => {
  const noFetch: typeof fetch = async () => { assert.fail('Transfer was not approved'); };
  const changes = [
    { caller: 'scarlet' }, { subject: 'another-subject' }, { pool: 'another-pool' },
    { purpose: 'Publish' }, { criteria: 'Keep everything' },
    { documentRevision: `sha256:${'c'.repeat(64)}` }, { policyRevision: `sha256:${'c'.repeat(64)}` },
    { material: { ...selection.material, text: `${text} changed` } },
    { material: { ...selection.material, evidenceRefs: ['another-source'] } },
    { existingContext: [{ id: 'another', text }] },
  ];
  for (const change of changes) await assert.rejects(decideJevPool({ ...selection, ...change }, approval(), env, noFetch), /changed/);
  for (const invalid of [undefined, { ...approval(), provider: 'other' }, { ...approval(), publish: true }]) {
    await assert.rejects(decideJevPool(selection, invalid, env, noFetch));
  }
});

test('malformed or oversized context never transfers and raw errors do not enter receipts', async () => {
  const noFetch: typeof fetch = async () => { assert.fail('Invalid input must not transfer'); };
  for (const change of [
    { extraSource: '/private/file' }, { caller: 'public-reader' },
    { material: { ...selection.material, evidenceRefs: [] } },
    { material: { ...selection.material, evidenceRefs: ['same', 'same'] } },
    { existingContext: [{ id: 'same', text }, { id: 'same', text }] },
    { existingContext: Array.from({ length: 8 }, (_, i) => ({ id: String(i), text: text.repeat(4) })) },
  ]) await assert.rejects(decideJevPool({ ...selection, ...change }, approval(), env, noFetch));
  for (const provider of [
    async () => new Response('sensitive upstream detail', { status: 429 }),
    async () => new Response('x'.repeat(65537)),
    async () => { throw new Error('sensitive network detail'); },
    async () => reply('invented'), async () => reply('keep', 'meaningful_work', 2),
    async () => Response.json({ model: 'other', answers: {} }),
  ]) {
    let calls = 0;
    const result = await decideJevPool(selection, approval(), env, async () => { calls++; return provider(); });
    assert.equal(calls, 1);
    assert.equal(result.outcome, 'unresolved');
    assert.equal(result.reason, 'provider_unavailable');
    assert.doesNotMatch(JSON.stringify(result), /sensitive/);
  }
});

test('repeated evidence or context references are refused by the check itself, not by a digest', () => {
  assert.equal(checkJevPoolSelection(selection).ok, true);
  for (const change of [
    { material: { ...selection.material, evidenceRefs: ['same', 'same'] } },
    { existingContext: [{ id: 'same', text }, { id: 'same', text }] },
  ]) {
    const checked = checkJevPoolSelection({ ...selection, ...change });
    assert.equal(checked.ok, false);
    if (!checked.ok) assert.match(checked.error.message, /Repeated evidence or context references/);
  }
});

test('missing provider configuration and uncertain or inconsistent decisions remain unresolved', async () => {
  const absent = await decideJevPool(selection, approval(), {}, async () => { assert.fail('No credential'); });
  assert.equal(absent.outcome, 'unresolved');
  assert.match(absent.detail!, /not configured/);
  for (const [decision, reason, confidence, expected] of [
    ['keep', 'meaningful_work', 0.6, 'model_uncertain'],
    ['pass', 'meaningful_work', 0.99, 'inconsistent_decision'],
    ['pass', 'duplicate', 0.99, 'inconsistent_decision'],
    ['keep', 'outside_purpose', 0.99, 'inconsistent_decision'],
    ['unresolved', 'insufficient_context', 0.99, 'insufficient_context'],
  ] as const) {
    const receipt = await decideJevPool(selection, approval(), env, async () => reply(decision, reason, confidence));
    assert.equal(receipt.outcome, 'unresolved'); assert.equal(receipt.reason, expected);
  }
});

test('a selection over 24,000 bytes is refused; one exactly at the limit is accepted', () => {
  // ASCII only, so characters and bytes agree; each context text stays inside its 4,000 limit.
  const sized = (bytes: number): JevPoolSelection => {
    const shell = { ...selection, material: { ...selection.material, text: 'm'.repeat(16000) }, existingContext: [{ id: 'c0', text: 'c' }, { id: 'c1', text: 'c' }] };
    const spare = bytes - Buffer.byteLength(JSON.stringify(shell));
    const first = Math.min(3999, spare);
    return { ...shell, existingContext: [{ id: 'c0', text: 'c'.repeat(1 + first) }, { id: 'c1', text: 'c'.repeat(1 + spare - first) }] };
  };
  const at = sized(24000);
  const over = sized(24001);
  assert.equal(Buffer.byteLength(JSON.stringify(at)), 24000);
  assert.equal(Buffer.byteLength(JSON.stringify(over)), 24001);
  assert.ok(over.existingContext.every(item => item.text.length <= 4000));
  const accepted = checkJevPoolSelection(at);
  assert.ok(accepted.ok);
  const refused = checkJevPoolSelection(over);
  assert.ok(!refused.ok);
  assert.match(refused.error.message, /Narrow this pool selection/);
});

test('pass is purpose-specific, retains references and changes no source or review state', async () => {
  const input = { ...selection, existingContext: [{ id: 'existing-journey', text }] };
  const before = JSON.stringify(input);
  const receipt = await decideJevPool(input, approval(input), env, async () => reply('pass', 'duplicate'));
  assert.equal(receipt.outcome, 'pass');
  assert.deepEqual(receipt.evidenceRefs, selection.material.evidenceRefs);
  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.hasOwn(receipt, 'approved'), false);
  assert.equal(Object.hasOwn(receipt, 'published'), false);
});
