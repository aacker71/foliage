/** Synthetic transport contract inputs only; no portfolio or search-quality claims. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLISHED_ARTIFACT, parsePublishedDocument } from '@foliage/canopy';
import { hostedPublicSearch, type SearchPublished } from './hostedPublicSearch.ts';
import type { HostedPublicRead } from './hostedStore.ts';

const parsed = parsePublishedDocument({ artifact: PUBLISHED_ARTIFACT, artifactVersion: 3,
  publishedAt: '2026-09-08T00:00:00Z',
  source: { documentDigest: `sha256:${'a'.repeat(64)}`, documentBytes: 1, policyDigest: `sha256:${'b'.repeat(64)}` },
  leaf: { id: 'transport-contract', subject: 'Synthetic transport input', subjectRedacted: false, leaflets: [{ id: 'contract-input', title: 'Synthetic hit', tier: 'pending', titleRedacted: false }] },
  withheld: { count: 0, kinds: [] } });
assert.ok(parsed.ok);
const publication: HostedPublicRead = { document: parsed.document, revisionId: 'revision-one', generation: 1, artifactDigest: `sha256:${'c'.repeat(64)}` };
const url = (query = 'q=contract') => new URL(`https://transport.invalid/leaf/transport-contract/search.json?${query}`);
const empty: SearchPublished = () => [];

test('search sees the current published object only and rebinds fields to its admitted projection', async () => {
  let reads = 0;
  const result = await hostedPublicSearch(url('q=%20contract%20&limit=1'), 'GET', 'transport-contract', {
    async readPublic(id) { assert.equal(id, 'transport-contract'); reads++; return publication; },
  }, (document, query, limit) => {
    assert.equal(document, publication.document); assert.equal(query, 'contract'); assert.equal(limit, 1);
    return [{ id: 'leaflet:contract-input', snippet: 'Synthetic hit', score: 99, privateMetadata: 'must not serialize' }];
  });
  assert.equal(result.status, 200); assert.equal(reads, 2);
  assert.deepEqual(JSON.parse(result.body), { portfolio: '/leaf/transport-contract', revision: 'revision-one',
    results: [{ id: 'leaflet:contract-input', title: 'Synthetic hit', excerpt: 'Synthetic hit',
      citation: '/leaf/transport-contract#portfolio-record-contract-input' }] });
});

test('invalid queries and writes refuse before authority or search access', async () => {
  const store = { async readPublic(): Promise<null> { assert.fail('must not read'); } };
  for (const query of ['', 'q=', 'q=a&q=b', 'q=a&limit=0', 'q=a&limit=21', 'q=a&limit=1&limit=2', 'q=a&garden=private', `q=${'a'.repeat(513)}`, 'q=a%00b']) {
    assert.equal((await hostedPublicSearch(url(query), 'GET', 'transport-contract', store, empty)).status, 400, query);
  }
  assert.equal((await hostedPublicSearch(url(), 'POST', 'transport-contract', store, empty)).status, 405);
});

test('missing or withdrawn publications never reach the ranker; missing adapter is unavailable', async () => {
  const fail: SearchPublished = () => { assert.fail('must not search'); };
  assert.equal((await hostedPublicSearch(url(), 'GET', 'transport-contract', { async readPublic() { return null; } }, fail)).status, 404);
  assert.equal((await hostedPublicSearch(url(), 'GET', 'transport-contract', { async readPublic() { return publication; } }, undefined)).status, 503);
});

test('withdrawal and replacement during processing invalidate GET and HEAD without stale results', async () => {
  for (const method of ['GET', 'HEAD']) {
    for (const next of [null, { ...publication, generation: 2 }, { ...publication, revisionId: 'replacement' }, { ...publication, artifactDigest: 'different' }]) {
      let reads = 0;
      const result = await hostedPublicSearch(url(), method, 'transport-contract', { async readPublic() { return reads++ ? next : publication; } }, empty);
      assert.equal(result.status, next ? 409 : 404); assert.doesNotMatch(result.body, /results/);
    }
  }
});

test('authority and search errors are unavailable, never empty success or diagnostic disclosure', async () => {
  const store = { async readPublic() { return publication; } };
  const badSearch: SearchPublished = () => { throw new Error('private storage diagnostic'); };
  for (const [reader, search] of [[{ async readPublic() { throw new Error('private storage diagnostic'); } }, empty], [store, badSearch]] as const) {
    const result = await hostedPublicSearch(url(), 'GET', 'transport-contract', reader, search);
    assert.equal(result.status, 503); assert.equal(result.body, '{"code":"public-search-unavailable"}');
  }
  const overflow: SearchPublished = () => Array.from({ length: 21 }, () => ({ id: 'leaflet:contract-input', snippet: '' }));
  assert.equal((await hostedPublicSearch(url(), 'GET', 'transport-contract', store, overflow)).status, 503);
});


test('an unpublished hit refuses the whole result while an admitted pending-tier leaflet is allowed', async () => {
  const store = { async readPublic() { return publication; } };
  const published = { id: 'leaflet:contract-input', snippet: 'Synthetic hit' };
  assert.equal(publication.document.leaf.leaflets[0]!.tier, 'pending');
  const permitted = await hostedPublicSearch(url(), 'GET', 'transport-contract', store, () => [published]);
  assert.equal(permitted.status, 200);
  assert.deepEqual(JSON.parse(permitted.body).results, [{ id: published.id, title: 'Synthetic hit', excerpt: published.snippet,
    citation: '/leaf/transport-contract#portfolio-record-contract-input' }]);
  const denied = await hostedPublicSearch(url(), 'GET', 'transport-contract', store, () => [published,
    { id: 'leaflet:unpublished-input', snippet: 'Must never leave' }]);
  assert.equal(denied.status, 503);
  assert.doesNotMatch(denied.body, /Private|Must never leave|results/);
  const injected = await hostedPublicSearch(url(), 'GET', 'transport-contract', store, () => [
    { id: published.id, snippet: 'Private notes do not appear in the publication' }]);
  assert.equal(injected.status, 503);
  const profile = await hostedPublicSearch(url(), 'GET', 'transport-contract', store, () => [
    { id: 'profile', snippet: 'Synthetic transport input' }]);
  assert.equal(profile.status, 200);
  assert.deepEqual(JSON.parse(profile.body).results, [{ id: 'profile', title: 'Synthetic transport input',
    excerpt: 'Synthetic transport input', citation: '/leaf/transport-contract#personal-subject-h' }]);
});
