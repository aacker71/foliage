/** History/projection protocol cases. Repository text is not a claimed career achievement. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseLeafDocument, type Leaf } from '@foliage/leaf';
import { workReflection, renderWorkReflection } from './workReflection.ts';
const words = readFileSync(new URL('../../../context/product-thesis.md', import.meta.url), 'utf8').split('\n').filter(line => line.trim()).slice(0, 4);
const since = '2026-09-22T00:00:00Z', until = '2026-09-29T00:00:00Z';
function record(): Leaf {
  const claim = { id: 'protocol-claim', kind: 'decision', text: words[1], citations: [] };
  const achievement = { id: 'protocol-journey', title: words[0], claims: [claim] };
  const parsed = parseLeafDocument({ id: 'reflection-protocol', subject: 'Reflection protocol', leaflets: [], achievements: [achievement],
    journeyHistory: [{ id: 'first-edit', achievement: achievement.id, at: '2026-09-28T12:00:00Z', actor: 'manual', before: null, after: achievement }] });
  assert.ok(parsed.ok); return parsed.leaf;
}
test('reflection keeps meaningful current statements, not activity counts, empty titles or imagined work', () => {
  const leaf = record(), before = JSON.stringify(leaf);
  const result = workReflection(leaf, since, until);
  assert.equal(result.journeys[0]?.statements[0]?.text, words[1]);
  assert.equal(result.journeys[0]?.statements[0]?.actor, 'manual');
  assert.deepEqual(result.journeys[0]?.statements[0]?.support, []);
  assert.equal(JSON.stringify(leaf), before);
  assert.deepEqual(workReflection({ ...leaf, journeyHistory: [] }, since, until).journeys, []);
  assert.deepEqual(workReflection({ ...leaf, achievements: [] }, since, until).journeys, []);
  assert.throws(() => workReflection(leaf, until, since));
  assert.throws(() => workReflection(leaf, '2020-01-01', until));
});
test('rewrites collapse to current words, restored original words disappear, and later corrections never leak into an earlier window', () => {
  const leaf = record(), first = leaf.journeyHistory![0]!, original = first.after;
  const edited = { ...original, claims: original.claims.map(c => ({ ...c, text: words[2]! })) };
  const changed: Leaf = { ...leaf, achievements: [edited], journeyHistory: [{ id: 'rewrite', achievement: original.id, at: '2026-09-28T16:00:00Z', actor: 'agent', before: original, after: edited }, first] };
  assert.equal(workReflection(changed, since, until).journeys[0]?.statements.length, 1);
  assert.equal(workReflection(changed, since, until).journeys[0]?.statements[0]?.text, words[2]);
  const reverted: Leaf = { ...leaf, journeyHistory: [{ id: 'restore', achievement: original.id, at: '2026-09-28T18:00:00Z', actor: 'manual', before: edited, after: original }, changed.journeyHistory![0]! ] };
  assert.deepEqual(workReflection(reverted, since, until).journeys, []);
  const later: Leaf = { ...changed, journeyHistory: [{ ...changed.journeyHistory![0]!, at: '2026-09-30T00:00:00Z' }, first] };
  assert.deepEqual(workReflection(later, since, until).journeys, []);
});
test('private reflection links current evidence and collaboration without claiming delivery or independent proof', () => {
  const leaf = record();
  const load = { ok: true as const, leaf, source: { path: '/protocol-only', bytes: 1, documentDigest: `sha256:${'a'.repeat(64)}`, readAt: until, declaredExample: false, bundledExample: false } };
  const html = renderWorkReflection(load, new URLSearchParams(), new Date(until));
  assert.match(html, /Past week/); assert.match(html, /Past day/);
  assert.match(html, /Self-reported · No citations/); assert.match(html, /Recorded/);
  assert.match(html, /Reflect with Scarlet/); assert.match(html, /Nothing sent/);
  assert.throws(() => renderWorkReflection(load, new URLSearchParams('period=month')));
  assert.throws(() => renderWorkReflection(load, new URLSearchParams('period=day&period=week')));
});
