/**
 * Disposable PGlite/Postgres execution, not a Supabase deployment test.
 * Only the provider-owned auth/storage table surfaces are harness substitutes. The migration,
 * SQL functions, constraints, transactions, privileges and RLS execute in actual Postgres.
 * PGlite uses one backend: queued competing calls do not establish multi-instance lock behavior.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";

const runtime = process.env["FOLIAGE_PGLITE_MODULE"];
if (!runtime) throw new Error("Set FOLIAGE_PGLITE_MODULE to an installed @electric-sql/pglite module path; no cloud credentials are used.");
const { PGlite } = createRequire(import.meta.url)(runtime);
const db = new PGlite();
after(async () => { await db.close(); });
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key);
  create schema storage;
  create table storage.buckets(id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
`);
await db.exec(await readFile(new URL("../migrations/202609080001_hosted_publications.sql", import.meta.url), "utf8"));
await db.exec(await readFile(new URL("../migrations/202609300001_selected_photos.sql", import.meta.url), "utf8"));
await db.exec(await readFile(new URL("../migrations/202610070001_selected_videos.sql", import.meta.url), "utf8"));
const owner = randomUUID(), foreign = randomUUID();
await db.query("insert into auth.users(id) values($1),($2)", [owner, foreign]);
const hash = char => "sha256:" + char.repeat(64);
async function rpc(name, values, casts) {
  const args = values.map((_, i) => `$${i + 1}${casts?.[i] ? `::${casts[i]}` : ""}`).join(",");
  return (await db.query(`select public.${name}(${args}) as result`, values)).rows[0].result;
}
async function reserve(subject, actor = owner) { return rpc("foliage_reserve_subject", [actor, subject], ["uuid", "text"]); }
function publication(subject, changes = {}) {
  const revision = randomUUID();
  const operation = randomUUID();
  return { actor: owner, operation, subject, requestHash: hash("a"), kind: "publish",
    expectedRevision: null, expectedGeneration: 0, revision,
    objectKey: `${owner}/${subject}/${revision}.json`, artifactDigest: hash("b"), artifactBytes: 123,
    admission: { actorId: owner, subjectId: subject, operationId: operation,
      expectedRevisionId: null, expectedGeneration: 0, artifactDigest: hash("b"),
      policyDigest: hash("c"), admissionId: hash("d"), consentId: hash("e") }, ...changes };
}
async function commit(p) {
  return rpc("foliage_commit_publication", [p.actor, p.operation, p.subject, p.requestHash, p.kind,
    p.expectedRevision, p.expectedGeneration, p.revision, p.objectKey, p.artifactDigest,
    p.artifactBytes, p.admission], ["uuid", "text", "text", "text", "text", "uuid", "bigint", "uuid", "text", "text", "integer", "jsonb"]);
}
function withdrawal(p, published) {
  return { ...p, operation: randomUUID(), requestHash: hash("f"), kind: "withdraw",
    expectedRevision: published.receipt.revisionId, expectedGeneration: published.receipt.generation,
    revision: null, objectKey: null, artifactDigest: null, artifactBytes: null, admission: null };
}
async function counts(subject) {
  return (await db.query(`select
    (select count(*)::int from public.foliage_publication_revisions where subject_id=$1) as revisions,
    (select count(*)::int from public.foliage_publication_operations where subject_id=$1) as operations,
    (select count(*)::int from public.foliage_publication_history where subject_id=$1) as history,
    (select count(*)::int from public.foliage_publication_outbox where subject_id=$1) as outbox`, [subject])).rows[0];
}

test("ownership reservation is durable, idempotent, and cannot be transferred", async () => {
  const first = await reserve("sql-reservation");
  assert.deepEqual(first, { subjectId: "sql-reservation", actorId: owner, revisionId: null, generation: 0, visible: false });
  assert.deepEqual(await reserve("sql-reservation"), first);
  await assert.rejects(reserve("sql-reservation", foreign), /foliage_forbidden/);
  await assert.rejects(reserve("sql-no-auth-user", randomUUID()), /foliage_forbidden/);
});

test("one transaction commits revision, head, receipt, history and pending outbox", async () => {
  const p = publication("sql-atomic"); await reserve(p.subject);
  const result = await commit(p);
  assert.equal(result.replayed, false); assert.equal(result.current.revisionId, p.revision);
  assert.equal(result.current.generation, 1); assert.equal(result.receipt.generation, 1);
  assert.deepEqual(await counts(p.subject), { revisions: 1, operations: 1, history: 1, outbox: 1 });
  const event = (await db.query("select kind, status, generation from public.foliage_publication_outbox where subject_id=$1", [p.subject])).rows[0];
  assert.equal(event.kind, "publication.committed"); assert.equal(event.status, "pending"); assert.equal(Number(event.generation), 1);
});

test("old publish retry resolves before stale checks and cannot resurrect a withdrawal", async () => {
  const p = publication("sql-replay"); await reserve(p.subject);
  const published = await commit(p); const removed = await commit(withdrawal(p, published));
  assert.equal(removed.current.generation, 2); assert.equal(removed.current.visible, false);
  const replay = await commit(p);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.receipt, published.receipt);
  assert.equal(replay.current.visible, false); assert.equal(replay.current.generation, 2);
  assert.equal(await rpc("foliage_publication_head", [p.subject]), null);
  await assert.rejects(commit({ ...p, requestHash: hash("c") }), /foliage_conflict/);
  await assert.rejects(commit({ ...p, operation: randomUUID() }), /foliage_conflict/);
  assert.deepEqual(await counts(p.subject), { revisions: 1, operations: 2, history: 2, outbox: 2 });
});

test("foreign actors cannot commit or inspect another actor's operation receipt", async () => {
  const p = publication("sql-foreign"); await reserve(p.subject); await commit(p);
  assert.equal(await rpc("foliage_get_operation", [foreign, p.operation], ["uuid", "text"]), null);
  await assert.rejects(commit({ ...p, actor: foreign, operation: randomUUID() }), /foliage_forbidden/);
  assert.deepEqual(await counts(p.subject), { revisions: 1, operations: 1, history: 1, outbox: 1 });
});

test("an outbox insertion fault rolls back every earlier write in the function", async () => {
  const p = publication("sql-rollback"); await reserve(p.subject);
  await db.exec(`create function public.harness_refuse_outbox() returns trigger language plpgsql as $$
    begin if new.subject_id='sql-rollback' then raise exception 'harness outbox fault'; end if; return new; end $$;
    create trigger harness_outbox_fault before insert on public.foliage_publication_outbox
      for each row execute function public.harness_refuse_outbox();`);
  try {
    await assert.rejects(commit(p), /harness outbox fault/);
    assert.deepEqual(await counts(p.subject), { revisions: 0, operations: 0, history: 0, outbox: 0 });
    assert.equal((await reserve(p.subject)).generation, 0);
    assert.equal(await rpc("foliage_publication_head", [p.subject]), null);
  } finally { await db.exec("drop trigger harness_outbox_fault on public.foliage_publication_outbox; drop function public.harness_refuse_outbox();"); }
});

test("competing queued RPCs enforce expected revision/generation and leave one complete result", async () => {
  const first = publication("sql-competing"), second = publication(first.subject);
  await reserve(first.subject);
  const attempts = await Promise.allSettled([commit(first), commit(second)]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter(result => result.status === "rejected" && /foliage_conflict/.test(String(result.reason))).length, 1);
  assert.deepEqual(await counts(first.subject), { revisions: 1, operations: 1, history: 1, outbox: 1 });
});

test("authenticated clients cannot execute authority RPCs or read tables; server has RPC-only access", async () => {
  await db.exec("set role authenticated");
  try {
    await assert.rejects(rpc("foliage_reserve_subject", [owner, "sql-client"], ["uuid", "text"]), /permission denied/);
    await assert.rejects(db.query("select * from public.foliage_subjects"), /permission denied/);
  } finally { await db.exec("reset role"); }
  await db.exec("set role service_role");
  try {
    const result = await reserve("sql-service"); assert.equal(result.actorId, owner);
    await assert.rejects(db.query("update public.foliage_subjects set generation=0"), /permission denied/);
    await assert.rejects(db.query("delete from public.foliage_publication_operations"), /permission denied/);
  } finally { await db.exec("reset role"); }
});

test("restrictive Storage policy blocks this private bucket despite an existing permissive client policy", async () => {
  await db.exec(`insert into storage.objects(bucket_id,name) values('foliage-publications','private harness object'),('other-harness','other object');
    grant usage on schema storage to authenticated;
    grant select on storage.objects to authenticated;
    create policy harness_permissive_read on storage.objects for select to authenticated using(true);
    set role authenticated;`);
  try {
    const rows = (await db.query("select bucket_id from storage.objects order by bucket_id")).rows;
    assert.deepEqual(rows, [{ bucket_id: "other-harness" }]);
  } finally { await db.exec("reset role"); }
});


test("selected media MIME admission preserves the private bucket and object size ceiling", async () => {
  const bucket = (await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'foliage-publications'")).rows[0];
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 2097152);
  assert.deepEqual(bucket.allowed_mime_types, ["application/json", "image/jpeg", "image/png", "image/gif", "video/mp4"]);
});
