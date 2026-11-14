/** Disposable Postgres + delivery-service protocol test. No real accounts or external writes. */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createDistributionStore } from '../../apps/canopy/src/distributionStore.ts';
import { createHostedDistribution } from '../../apps/canopy/src/hostedDistribution.ts';
import { createHostedApp } from '../../apps/canopy/src/hostedApp.ts';
import { reviewForPublication, buildPublishedDocument, documentDigest, toArtifactJson } from '../../packages/canopy/src/index.ts';
const runtime = process.env.FOLIAGE_PGLITE_MODULE;
if (!runtime) throw new Error('Set FOLIAGE_PGLITE_MODULE to run the disposable SQL contract.');
const db = new (createRequire(import.meta.url)(runtime).PGlite)();
after(() => db.close());
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(bucket_id text); alter table storage.objects enable row level security;`);
for (const name of ['202609080001_hosted_publications.sql','202609080002_owner_notifications.sql','202609150001_clerk_actors.sql','202609230001_distribution.sql']) {
  await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}
async function rpc(name, params) {
  assert.match(name, /^foliage_[a-z_]+$/);
  const entries = Object.entries(params); entries.forEach(([key]) => assert.match(key, /^p_[a-z_]+$/));
  return (await db.query(`select public.${name}(${entries.map(([key], i) => `${key} => $${i+1}`).join(',')}) as value`, entries.map(([, value]) => value))).rows[0].value;
}
const receipts = createDistributionStore(rpc);
const actor = { id: await rpc('foliage_resolve_actor', { p_issuer: 'https://identity.example', p_subject: 'user_ProtocolOwner' }) };
const foreign = { id: await rpc('foliage_resolve_actor', { p_issuer: 'https://identity.example', p_subject: 'user_ProtocolOther' }) };
const origin = 'https://portfolio.example';
const target = { connectionId: 'protocol-connection', candidateId: randomUUID() };
const hash = n => `sha256:${n.repeat(64)}`;
async function harness() {
  const subjectId = `protocol-${randomUUID()}`;
  const review = reviewForPublication({ leaf: { id: subjectId, subject: 'Empty interface protocol', leaflets: [] }, declaredExample: false });
  assert.ok(review.ok);
  const built = buildPublishedDocument({ review, publishedAt: '2026-09-23T00:00:00.000Z', documentDigest: hash('a'), policyDigest: hash('b'), documentBytes: 1 });
  assert.ok(built.ok);
  await rpc('foliage_reserve_subject', { p_actor: actor.id, p_subject: subjectId });
  const revision = randomUUID(), operation = randomUUID(), artifactDigest = documentDigest(Buffer.from(JSON.stringify(toArtifactJson(built.document))));
  await rpc('foliage_commit_publication', { p_actor: actor.id, p_operation_id: operation, p_subject: subjectId, p_request_hash: hash('c'), p_kind: 'publish', p_expected_revision: null, p_expected_generation: 0,
    p_revision: revision, p_object_key: `${actor.id}/${subjectId}/${revision}.json`, p_artifact_digest: artifactDigest, p_artifact_bytes: 1,
    p_admission: JSON.stringify({ actorId: actor.id, subjectId, operationId: operation, expectedRevisionId: null, expectedGeneration: 0, artifactDigest, policyDigest: hash('b'), admissionId: hash('d'), consentId: hash('e') }) });
  const store = {
    readPublic: async id => { const head = await rpc('foliage_publication_head', { p_subject: id }); return head ? { document: built.document, revisionId: head.revisionId, generation: head.generation, artifactDigest: head.artifactDigest } : null; },
    listOwned: (a) => rpc('foliage_owned_publications', { p_actor: a.id, p_after: null, p_limit: 200 }),
  };
  let writes = 0, mode = 'accepted', observedMarker = '', candidateName = 'Candidate identity protocol';
  const providerReference = randomUUID();
  const adapter = { id: 'protocol', label: 'Protocol destination', version: 'v1', bindingKey: 'protocol:v1',
    capabilities: { createNote: true, reconcile: true, replace: false, retract: false },
    connections: async () => { if (mode === 'unavailable') throw new Error('Protocol connection unavailable'); return [{ id: target.connectionId, available: true }]; },
    search: async () => ({ candidates: [{ id: target.candidateId, name: candidateName }], more: false }),
    connect: async () => 'https://connect.example',
    candidate: async () => ({ id: target.candidateId, name: candidateName }),
    deliver: async (_actor, _target, text) => { writes++; observedMarker = text.trimEnd().split('\n').at(-1); if (mode === 'throw') throw new Error('Protocol response interrupted after write'); return mode === 'accepted' ? { status: 'accepted', reference: providerReference } : { status: 'unknown', reason: 'write-not-confirmed' }; },
    reconcile: async (_actor, _target, marker) => { assert.equal(marker, observedMarker); return providerReference; },
  };
  const service = createHostedDistribution({ origin, store, receipts, adapter });
  const input = { ...target, subjectId, operationId: randomUUID() };
  const withdraw = () => rpc('foliage_commit_publication', { p_actor: actor.id, p_operation_id: randomUUID(), p_subject: subjectId, p_request_hash: hash('f'), p_kind: 'withdraw', p_expected_revision: revision, p_expected_generation: 1, p_revision: null, p_object_key: null, p_artifact_digest: null, p_artifact_bytes: null, p_admission: null });
  return { service, store, input, withdraw, writes: () => writes, mode: v => { mode = v; }, rename: () => { candidateName = 'Changed candidate protocol'; } };
}
test('exact preview, duplicate-send prevention and readback recovery execute against actual SQL', async () => {
  const h = await harness(), prepared = await h.service.prepare(actor, h.input);
  assert.equal(prepared.status, 'prepared'); assert.equal(h.writes(), 0);
  assert.match(await h.service.preview(actor, prepared), /No achievement statements/);
  assert.deepEqual(await h.service.prepare(actor, h.input), prepared);
  await assert.rejects(h.service.send(actor, h.input.operationId, hash('f')), /exact delivery/);
  h.mode('unknown');
  assert.equal((await h.service.send(actor, h.input.operationId, prepared.payloadDigest)).status, 'unknown');
  assert.equal((await h.service.send(actor, h.input.operationId, prepared.payloadDigest)).status, 'unknown');
  assert.equal(h.writes(), 1);
  assert.equal((await h.service.reconcile(actor, h.input.operationId)).status, 'accepted');
  assert.equal(h.writes(), 1);
});
test('foreign account, changed candidate, withdrawal and cancellation cannot send', async () => {
  const h = await harness(), r = await h.service.prepare(actor, h.input);
  assert.equal(await receipts.read(foreign, r.operationId), null);
  await assert.rejects(h.service.send(foreign, r.operationId, r.payloadDigest), /unavailable/);
  await assert.rejects(h.service.prepare(actor, { ...h.input, candidateId: randomUUID() }), /another destination/);
  h.rename(); await assert.rejects(h.service.send(actor, r.operationId, r.payloadDigest), /candidate changed/);
  await h.withdraw();
  const gone = await receipts.read(actor, r.operationId); assert.equal(gone.current, false); assert.equal(gone.visible, false);
  await assert.rejects(h.service.preview(actor, gone), /withdrawn/);
  assert.equal((await h.service.cancel(actor, r.operationId)).status, 'cancelled');
  assert.equal((await h.service.send(actor, r.operationId, r.payloadDigest)).status, 'cancelled');
  assert.equal(h.writes(), 0);
});
test('unexpected adapter exception remains uncertain and cannot dispatch twice', async () => {
  const h = await harness(), r = await h.service.prepare(actor, h.input);
  h.mode('throw');
  assert.equal((await h.service.send(actor, r.operationId, r.payloadDigest)).status, 'unknown');
  assert.equal((await h.service.send(actor, r.operationId, r.payloadDigest)).status, 'unknown');
  assert.equal(h.writes(), 1);
  assert.equal((await h.service.reconcile(actor, r.operationId)).status, 'accepted');
});
test('simultaneous approvals dispatch once; stale sending becomes unknown and never re-leases', async () => {
  const h = await harness(), r = await h.service.prepare(actor, h.input);
  const results = await Promise.all([h.service.send(actor, r.operationId, r.payloadDigest), h.service.send(actor, r.operationId, r.payloadDigest)]);
  assert.ok(results.some(v => v.status === 'accepted')); assert.equal(h.writes(), 1);
  const next = await harness(), draft = await next.service.prepare(actor, next.input);
  const started = await receipts.start(actor, draft.operationId, draft.payloadDigest); assert.ok(started.dispatchId);
  await db.query("update public.foliage_distribution_operations set updated_at=clock_timestamp()-interval '2 minutes' where operation_id=$1", [draft.operationId]);
  assert.equal((await receipts.read(actor, draft.operationId)).status, 'unknown');
  assert.equal((await receipts.start(actor, draft.operationId, draft.payloadDigest)).dispatchId, null);
  await assert.rejects(receipts.finish(actor, draft.operationId, randomUUID(), { status: 'accepted', reference: randomUUID() }), /forbidden/);
});
test('public resume/export obey authority; authenticated API prepares and sends exact reviewed receipt', async () => {
  const h = await harness();
  const identity = { getUser: async token => { assert.equal(token, 'protocol-session'); return actor; } };
  const app = createHostedApp({ appOrigin: origin, identity, store: h.store, distribution: h.service });
  const device = (path, fields) => app(new Request(origin+path, { method: fields ? 'POST' : 'GET', headers: { authorization: 'Bearer protocol-session' }, ...(fields ? { body: new URLSearchParams(fields) } : {}) }));
  let response = await app(new Request(`${origin}/leaf/${h.input.subjectId}/resume`));
  assert.equal(response.status, 200); assert.match(await response.text(), /No achievement statements/);
  response = await device(`/api/subjects/${h.input.subjectId}/distribution`, { ...target, operationId: h.input.operationId, reviewActorId: actor.id });
  assert.equal(response.status, 200, await response.clone().text());
  const r = await response.json();
  const denied = await app(new Request(`${origin}/api/distribution/${r.operationId}/send`, { method: 'POST', headers: { authorization: 'Bearer protocol-session', origin }, body: new URLSearchParams({ payloadDigest: r.payloadDigest, reviewActorId: actor.id }) }));
  assert.equal(denied.status, 403); assert.equal(h.writes(), 0);
  response = await device(`/api/distribution/${r.operationId}/send`, { payloadDigest: r.payloadDigest, reviewActorId: actor.id });
  assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).status, 'accepted');
  await h.withdraw();
  for (const suffix of ['resume','resume.md','document.json']) for (const method of ['GET','HEAD']) {
    const removed = await app(new Request(`${origin}/leaf/${h.input.subjectId}/${suffix}`, { method }));
    assert.equal(removed.status, 404); assert.match(removed.headers.get('cache-control'), /no-store/);
  }
  assert.equal((await receipts.read(actor, r.operationId)).visible, false);
});
test('browser roles have no table or RPC access; service role has only granted RPCs', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query('select * from public.foliage_distribution_operations'), /permission denied/);
      if (role !== 'service_role') await assert.rejects(receipts.read(actor, randomUUID()), /permission denied/);
      else assert.equal(await receipts.read(actor, randomUUID()), null);
    } finally { await db.exec('reset role'); }
  }
});
test('provider outage preserves direct sharing and exposes unavailable connections', async () => {
  const h = await harness(); h.mode('unavailable');
  const app = createHostedApp({ appOrigin: origin, identity: { getUser: async () => actor }, store: h.store, distribution: h.service });
  const response = await app(new Request(`${origin}/api/subjects/${h.input.subjectId}/distribution`, { headers: { authorization: 'Bearer protocol-session' } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.destination.connections, null); assert.equal(body.current.visible, true);
  assert.deepEqual(body.history, []); assert.equal(h.writes(), 0);
  const browser = await app(new Request(`${origin}/manage/${h.input.subjectId}/distribution`, { headers: { cookie: '__Host-foliage-access=protocol-session' } }));
  assert.equal(browser.status, 200);
  const html = await browser.text();
  assert.match(html, /Connections unavailable/);
  assert.match(html, /Open cited résumé/);
});
