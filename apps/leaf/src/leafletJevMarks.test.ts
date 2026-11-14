/** Stored receipts are protocol fixtures; nothing here measures Jev's accuracy. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leafletJevMarks, parseJevWorkflow, type JevWorkflowState } from './jevWorkflow.ts';
import { workflowJevMarks } from './workflow.ts';
import { JEV_MODEL } from './jevTransport.ts';

const d = (c: string) => `sha256:${c.repeat(64)}`;
const at = '2026-10-01T00:00:00.000Z';
const grant = { id: 'g', source: 's', caller: 'photosynthesis' as const, provider: 'typesafe' as const, policyRevision: d('p'.replace('p', 'a')), grantedAt: at };
function attempt(id: string, packet: string, status: 'completed' | 'interrupted' | 'pending', outcome?: 'keep' | 'pass' | 'unresolved', reason = 'meaningful_work') {
  return { id, grant: 'g', packet, selectionDigest: d('b'), startedAt: at, status,
    ...(status === 'completed' ? { receipt: { selectionDigest: d('b'), caller: 'photosynthesis' as const, subject: 'x', pool: 'source:s', material: packet,
      documentRevision: d('c'), policyRevision: grant.policyRevision, evidenceRefs: ['r'], outcome: outcome!, reason: reason as 'meaningful_work',
      provider: 'typesafe' as const, model: JEV_MODEL, checkedAt: at } } : {}) };
}
const state = (attempts: ReturnType<typeof attempt>[]): JevWorkflowState => parseJevWorkflow({ grants: [grant], attempts });

test('each named item takes the last answered mark; unanswered, unfinished and unnamed give none', () => {
  const marks = leafletJevMarks(state([
    attempt('1', 'kept', 'completed', 'pass', 'outside_purpose'),
    attempt('2', 'kept', 'completed', 'keep'),
    attempt('3', 'down', 'completed', 'unresolved', 'provider_unavailable'),
    attempt('4', 'stopped', 'interrupted'),
    attempt('5', 'unasked', 'completed', 'keep'),
  ]), ['kept', 'down', 'stopped', 'never']);
  assert.deepEqual([...marks], [['kept', 'keep']]);
  assert.equal(leafletJevMarks(undefined, ['kept']).size, 0);
});

test('the file read is read-only and a missing workflow gives no marks', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'foliage-jev-marks-')); t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal((await workflowJevMarks(join(dir, 'workflow.json'), ['a'])).size, 0);
  await writeFile(join(dir, 'workflow.json'), '{not json');
  await assert.rejects(workflowJevMarks(join(dir, 'workflow.json'), ['a']));
});
