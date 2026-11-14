/** Protocol checks over this repository's real source text, not career or impact claims. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { parseLeafDocument } from './document.ts';
import { privateBrainRecords, searchBrain, readBrainRecord, boundedBrainResult, BrainError, BRAIN_LIMITS, relatedBrainRecords } from './brain.ts';
const text = readFileSync(new URL('./brain.ts', import.meta.url), 'utf8');
const provenance = { source: 'local-source-protocol-test', ref: createHash('sha256').update(text).digest('hex'), observedAt: '2026-09-29T00:00:00Z' };
function source() {
  const parsed = parseLeafDocument({ id: 'brain-test', subject: 'Brain source protocol test',
    leaflets: [{ id: 'retained', title: 'brain.ts source', tier: 'pending', provenance, body: [{ provenance, text }] },
      { id: 'excluded', title: 'excluded-protocol-marker', tier: 'excluded', reason: 'Excluded input for protocol isolation.' }],
    achievements: [{ id: 'reading', title: 'Inspect retrieval source', claims: [{ id: 'source', kind: 'learning', text: text.slice(0, 100), citations: [{ leaflet: 'retained', provenance }] }] }],
    collections: [{ id: 'selected', title: 'Selected source', kind: 'body-of-work', achievements: ['reading'], leaflets: [] },
      { id: 'empty', title: 'Empty view', kind: 'body-of-work', achievements: [], leaflets: [] }] });
  assert.ok(parsed.ok, JSON.stringify(parsed)); return parsed.leaf;
}
test('named views follow explicit claim references while excluded work never enters retrieval', () => {
  const records = privateBrainRecords(source(), 'selected');
  assert.ok(records.some(r => r.kind === 'claim'));
  assert.ok(records.some(r => r.kind === 'excerpt'));
  assert.ok(!JSON.stringify(records).includes('excluded-protocol-marker'));
  const claim = records.find(r => r.kind === 'claim')!;
  assert.equal(claim.citations[0]!.status, 'current');
  assert.ok(privateBrainRecords(source(), 'empty').every(r => r.kind === 'view'));
  assert.throws(() => privateBrainRecords(source(), 'unknown'), /unavailable/);
  const stale = source();
  const changed = { ...stale, leaflets: stale.leaflets.map(l => l.id === 'retained' ? { ...l, provenance: { ...provenance, ref: 'changed' }, body: [] } : l) };
  assert.equal(privateBrainRecords(changed).find(r => r.kind === 'claim')!.citations[0]!.status, 'stale');
});
test('long excerpts round-trip with stable IDs, exact offsets and bounded pagination', () => {
  const records = privateBrainRecords(source());
  const record = records.find(r => r.kind === 'excerpt')!;
  assert.ok(text.length > BRAIN_LIMITS.excerpt);
  let start = 0, combined = '';
  for (;;) {
    const page = readBrainRecord(records, record.id, start); combined += page.text;
    assert.equal(page.start, start); assert.equal(page.offsetUnit, 'utf16-code-units');
    if (page.nextStart === null) break;
    start = page.nextStart;
  }
  assert.equal(combined, text);
  const page = searchBrain(records, { query: 'brain', limit: 1 });
  assert.equal(page.results.length, 1); assert.equal(page.nextOffset, 1);
  const second = searchBrain(records, { query: 'brain', limit: 1, offset: page.nextOffset! });
  assert.notEqual(second.results[0]!.id, page.results[0]!.id);
  assert.deepEqual(searchBrain(records, { query: 'unmatched-protocol-marker-9807' }).results, []);
  for (const query of ['', 'x'.repeat(257)]) assert.throws(() => searchBrain(records, { query }), BrainError);
  assert.throws(() => searchBrain(records, { query: 'brain', limit: 21 }), BrainError);
  assert.throws(() => readBrainRecord(records, record.id, text.length + 1), BrainError);
  assert.throws(() => boundedBrainResult({ text: text.repeat(100) }), BrainError);
});

test('related records follow exact citations and named views without inventing relationships', () => {
  const records = privateBrainRecords(source());
  const claim = records.find(r => r.kind === 'claim')!;
  const related = relatedBrainRecords(records, { id: claim.id });
  assert.deepEqual(related.results.filter(r => r.relationships.includes('cites')).map(r => r.record.kind), ['leaflet', 'excerpt']);
  assert.deepEqual(related.results.filter(r => r.relationships.includes('in-view')).map(r => r.record.view), ['selected']);
  const excerpt = related.results.find(r => r.record.kind === 'excerpt')!.record;
  assert.equal(excerpt.truncated, true);
  const reverse = relatedBrainRecords(records, { id: excerpt.id });
  assert.ok(reverse.results.some(r => r.record.id === claim.id && r.relationships.includes('cited-by')));
  const view = records.find(r => r.view === 'selected')!;
  const members = relatedBrainRecords(records, { id: view.id, limit: 1 });
  assert.equal(members.results.length, 1); assert.equal(members.nextOffset, 1);
  assert.deepEqual(members.results[0]!.relationships, ['contains']);
  assert.equal(relatedBrainRecords(records, { id: view.id, offset: members.nextOffset! }).results.length, 2);
  const empty = privateBrainRecords(source(), 'empty');
  assert.deepEqual(relatedBrainRecords(empty, { id: empty[0]!.id }).results, []);
  assert.throws(() => relatedBrainRecords(empty, { id: claim.id }), /unavailable/);
  assert.throws(() => relatedBrainRecords(records, { id: claim.id, limit: 21 }), BrainError);
  assert.throws(() => relatedBrainRecords(records, { id: claim.id, offset: -1 }), BrainError);
});
test('stale support and same-leaflet references never become exact citation edges', () => {
  const leaf = source();
  const changed = { ...leaf, leaflets: leaf.leaflets.map(l => l.id === 'retained' ? { ...l, provenance: { ...provenance, ref: 'changed-reference' }, body: [] } : l) };
  const records = privateBrainRecords(changed);
  const claim = records.find(r => r.kind === 'claim')!;
  const found = relatedBrainRecords(records, { id: claim.id });
  assert.ok(found.results.every(r => !r.relationships.includes('cites')));
  assert.ok(!JSON.stringify(found).includes('excluded-protocol-marker'));
});
