/** Real local Git evidence; provider replies are protocol fixtures, not model accuracy or career evidence. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLeafDocument } from './leafDocument.ts';
import { savePresentation } from './portfolioPresentation.ts';
import { prepareJourney } from './journeyCollaboration.ts';
import { renderJourneyWorkspace } from './journeyWorkspace.ts';
import { journeyAction } from './journeyActions.ts';
import { createAssessmentConnection } from './assessmentConnection.ts';
import { JEV_HIGHLIGHT_CONSENT, JEV_HIGHLIGHT_POLICY, prepareHighlightChecks } from './jevHighlights.ts';

const root = new URL('../../../', import.meta.url).pathname;
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'foliage-jev-highlights-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { FOLIAGE_LEAF: join(dir, 'leaf.json'), TYPESAFE_API_KEY: 'protocol-only-not-a-credential' };
  const identity = execFileSync('git', ['log', '-1', '--format=%ae'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync(process.execPath, ['apps/leaf/intake.mjs', '--repo', root, '--identity', identity, '--subject', 'Jev highlight protocol', '--out', env.FOLIAGE_LEAF], { cwd: root, timeout: 15000 });
  let load = await loadLeafDocument(env); assert.ok(load.ok);
  await savePresentation(env, new URLSearchParams({ action: 'achievement', leafId: load.leaf.id, subject: load.leaf.subject, documentRevision: load.source.documentDigest, achievement: '', title: 'Selected repository protocol' }));
  load = await loadLeafDocument(env); assert.ok(load.ok);
  const achievement = load.leaf.achievements![0]!.id, source = load.leaf.leaflets.find(l => l.tier !== 'excluded' && l.provenance)!;
  await savePresentation(env, new URLSearchParams({ action: 'claim', leafId: load.leaf.id, subject: load.leaf.subject, documentRevision: load.source.documentDigest, achievement, claim: '', kind: 'summary', text: source.title, citation: JSON.stringify([source.id, source.provenance!.source, source.provenance!.ref, source.provenance!.observedAt]) }));
  const ready = await loadLeafDocument(env); assert.ok(ready.ok);
  const context = prepareJourney(ready, achievement, 'Which work belongs as a highlight?');
  const proposal = { reply: 'Protocol response.', edits: [], featuredLeaflets: [source.id] };
  return { env, ready, achievement, source, context, proposal };
}
const reply = (decision: string, reason: string) => Response.json({
  model: 'jev-1.13.0', answers: { decision: { type: 'choice', choice: decision, confidence: 0.97 }, reason: { type: 'choice', choice: reason, confidence: 0.97 } },
});
const form = (f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, string> = {}, proposal: unknown = f.proposal) => new URLSearchParams({
  action: 'jev-highlights', achievement: f.achievement, revision: f.ready.ok ? f.ready.source.documentDigest : '',
  proposal: JSON.stringify(proposal), history: '[]', message: 'Which work belongs as a highlight?', ...extra,
});
const connection = createAssessmentConnection({});

test('each proposed highlight becomes a Scarlet selection bound to its journey, refs and policy', async t => {
  const f = await fixture(t);
  const [check] = prepareHighlightChecks(f.context, f.proposal.featuredLeaflets);
  assert.ok(check?.ok);
  assert.equal(check.selection.caller, 'scarlet');
  assert.equal(check.selection.pool, `journey:${f.achievement}`);
  assert.equal(check.selection.policyRevision, JEV_HIGHLIGHT_POLICY);
  assert.equal(check.selection.documentRevision, f.context.revision);
  assert.deepEqual(check.selection.material.evidenceRefs, [f.source.provenance!.ref]);
  assert.ok(check.selection.material.text.startsWith(f.source.title));
  assert.deepEqual(prepareHighlightChecks(f.context, ['not-in-this-journey']), [{ leaflet: 'not-in-this-journey', ok: false }]);
});

test('nothing reaches Jev without the named consent, or for a highlight Scarlet invented', async t => {
  const f = await fixture(t);
  const noFetch: typeof fetch = async () => assert.fail('Nothing may be sent');
  await assert.rejects(journeyAction(form(f, { consent: 'yes' }), f.env, connection, undefined, noFetch), /Nothing was sent/);
  await assert.rejects(journeyAction(form(f), f.env, connection, undefined, noFetch), /Unexpected|Nothing was sent/);
  await assert.rejects(journeyAction(form(f, { consent: JEV_HIGHLIGHT_CONSENT }, { ...f.proposal, featuredLeaflets: ['invented'] }), f.env, connection, undefined, noFetch), /unavailable highlights/);
});

test('with consent each highlight gets its own mark; private ids never leave, and the page shows advice only', async t => {
  const f = await fixture(t);
  const sent: string[] = [];
  const result = await journeyAction(form(f, { consent: JEV_HIGHLIGHT_CONSENT }), f.env, connection, undefined, async (_url, init) => {
    sent.push(String(init?.body)); return reply('keep', 'meaningful_work');
  });
  assert.equal(sent.length, 1);
  for (const privateId of [f.achievement, f.source.id, f.source.provenance!.ref, f.context.revision]) assert.ok(!sent[0]!.includes(privateId));
  assert.ok('jev' in result);
  assert.deepEqual(result.jev, { [f.source.id]: 'keep' });
  const unavailable = await journeyAction(form(f, { consent: JEV_HIGHLIGHT_CONSENT }), f.env, connection, undefined, async () => new Response('', { status: 503 }));
  assert.ok('jev' in unavailable);
  assert.deepEqual(unavailable.jev, { [f.source.id]: 'unavailable' });

  const status = { ready: true, connected: true, detail: '' } as Parameters<typeof renderJourneyWorkspace>[1];
  const before = renderJourneyWorkspace(f.ready, status, undefined, {}, { achievement: f.achievement, response: f.proposal });
  assert.match(before, /data-jev-highlights/);
  assert.ok(!before.includes('data-jev-mark'));
  const after = renderJourneyWorkspace(f.ready, status, undefined, {}, { achievement: f.achievement, response: f.proposal, jev: result.jev });
  assert.match(after, /data-jev-mark="keep"[^>]*>Jev: keep</);
  assert.ok(!after.includes('data-jev-highlights'));
  // The marks themselves carry no score; the rest of the page lists real commit titles, which may.
  for (const mark of after.match(/<span class="fol-label" data-jev-mark="[^"]*">[^<]*<\/span>/g) ?? []) assert.doesNotMatch(mark, /\b\d+\s*%|score/i);
  assert.ok(after.match(/data-jev-mark=/g)?.length);
});
