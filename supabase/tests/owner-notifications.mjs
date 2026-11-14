/** Actual disposable Postgres SQL; provider tables are harness substitutes, not hosted evidence. */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const runtime = process.env.FOLIAGE_PGLITE_MODULE;
if (!runtime) throw new Error("FOLIAGE_PGLITE_MODULE must identify an installed disposable PGlite runtime; no cloud credentials are used.");
const db = new (createRequire(import.meta.url)(runtime).PGlite)();
after(() => db.close());
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(bucket_id text); alter table storage.objects enable row level security;`);
for (const name of ["202609080001_hosted_publications.sql", "202609080002_owner_notifications.sql"]) {
  await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
}
const owner = randomUUID();
await db.query("insert into auth.users(id) values($1)", [owner]);
beforeEach(() => db.exec("truncate public.foliage_subjects,public.foliage_notification_preferences cascade"));
const hash = "sha256:" + "a".repeat(64);
async function rpc(name, args = [], casts = []) {
  const parameters = args.map((_, index) => `$${index + 1}${casts[index] ? `::${casts[index]}` : ""}`).join(",");
  return (await db.query(`select public.${name}(${parameters}) as value`, args)).rows[0].value;
}
async function publication() {
  const subject = "notification-sql-harness", operation = randomUUID(), revision = randomUUID();
  await rpc("foliage_reserve_subject", [owner, subject], ["uuid", "text"]);
  const admission = { actorId: owner, subjectId: subject, operationId: operation, expectedRevisionId: null,
    expectedGeneration: 0, artifactDigest: hash, policyDigest: hash, admissionId: hash, consentId: hash };
  await rpc("foliage_commit_publication", [owner, operation, subject, hash, "publish", null, 0, revision,
    `${owner}/${subject}/${revision}.json`, hash, 1, admission],
  ["uuid", "text", "text", "text", "text", "uuid", "bigint", "uuid", "text", "text", "integer", "jsonb"]);
  return { subject, revision };
}
const claim = () => rpc("foliage_claim_notifications", [20]);
const begin = a => rpc("foliage_begin_notification", [a.attemptId, a.leaseId, hash, "notice-inbox"], ["uuid", "uuid", "text", "text"]);
const finish = (a, state) => rpc("foliage_finish_notification", [a.attemptId, a.leaseId, state, "sql_harness_evidence"], ["uuid", "uuid", "text", "text"]);
const prefs = (inbox, email, sms) => rpc("foliage_set_notification_preferences", [owner, inbox, email, sms], ["uuid", "boolean", "boolean", "boolean"]);
const rows = async () => (await db.query("select * from public.foliage_notification_attempts order by channel")).rows;

test("expansion records all owner channels, with explicit external opt-in and unique leases", async () => {
  await publication();
  assert.deepEqual(await rpc("foliage_notification_preferences", [owner], ["uuid"]), { inbox: true, email: false, sms: false });
  const first = await claim(); assert.equal(first.length, 1); assert.equal(first[0].channel, "inbox");
  assert.equal(first[0].recipientId, owner); assert.deepEqual(await claim(), []);
  assert.deepEqual((await rows()).map(r => [r.channel, r.state]), [["email", "cancelled"], ["inbox", "leased"], ["sms", "cancelled"]]);
  assert.equal((await db.query("select count(*)::int as n from public.foliage_publication_outbox where notifications_expanded_at is not null")).rows[0].n, 1);
});

test("expired pre-dispatch lease is reclaimable with same transaction identity and a fresh token", async () => {
  await publication(); const [first] = await claim();
  await db.exec("update public.foliage_notification_attempts set lease_until=clock_timestamp()-interval '1 second' where state='leased'");
  const [second] = await claim(); assert.equal(second.attemptId, first.attemptId); assert.notEqual(second.leaseId, first.leaseId);
  assert.equal(await begin(first), false); assert.equal(await begin(second), true);
  assert.equal(await finish(second, "accepted"), "accepted");
  assert.equal(await finish(second, "accepted"), "accepted");
  await assert.rejects(finish(first, "accepted"), /foliage_conflict/);
});

test("crash after dispatch marker turns expired lease unknown and never makes it sendable again", async () => {
  await publication(); const [a] = await claim(); assert.equal(await begin(a), true);
  await db.exec("update public.foliage_notification_attempts set lease_until=clock_timestamp()-interval '1 second' where state='dispatching'");
  assert.deepEqual(await claim(), []); assert.deepEqual(await claim(), []);
  const record = (await rows()).find(r => r.channel === "inbox");
  assert.equal(record.state, "unknown"); assert.equal(record.dispatch_hash, hash);
  // A late acknowledgement from this exact lease may resolve uncertainty; it does not re-trigger.
  assert.equal(await finish(a, "accepted"), "accepted");
  await assert.rejects(finish(a, "unknown"), /foliage_conflict/);
});

test("withdrawal between lease and marker cancels obsolete publication notice", async () => {
  const p = await publication(), [a] = await claim();
  await rpc("foliage_commit_publication", [owner, randomUUID(), p.subject, hash, "withdraw", p.revision, 1, null, null, null, null, null],
    ["uuid", "text", "text", "text", "text", "uuid", "bigint", "uuid", "text", "text", "integer", "jsonb"]);
  assert.equal(await begin(a), false);
  assert.equal((await rows()).find(r => r.attempt_id === a.attemptId).state, "cancelled");
});

test("preference changes after lease are checked at dispatch, with no historical opt-in backfill", async () => {
  await publication(); await prefs(true, true, false);
  const leased = await claim(); assert.equal(leased.length, 2);
  await prefs(false, false, true);
  for (const a of leased) assert.equal(await begin(a), false);
  assert.deepEqual(await claim(), []);
  assert.ok((await rows()).every(r => r.state === "cancelled"));
});

test("expired events preserve cancelled records and cannot dispatch", async () => {
  await publication();
  await db.exec("update public.foliage_publication_outbox set recorded_at=clock_timestamp()-interval '2 days'");
  assert.deepEqual(await claim(), []);
  assert.ok((await rows()).every(r => r.state === "cancelled"));
});

test("competing queued claims allocate each eligible attempt once", async () => {
  await publication(); await prefs(true, true, true);
  const result = await Promise.all([claim(), claim()]);
  const allocated = result.flat(); assert.equal(allocated.length, 3);
  assert.equal(new Set(allocated.map(a => a.attemptId)).size, 3);
  // PGlite serializes queries through one backend; independent-session lock proof remains hosted acceptance.
});

test("browser roles cannot dispatch or alter preferences; service role cannot bypass attempt transitions", async () => {
  await publication();
  await db.exec("set role authenticated");
  try { await assert.rejects(claim(), /permission denied/); await assert.rejects(prefs(true, true, true), /permission denied/); }
  finally { await db.exec("reset role"); }
  await db.exec("set role service_role");
  try {
    assert.equal((await claim()).length, 1);
    await assert.rejects(db.exec("update public.foliage_notification_attempts set state='pending'"), /permission denied/);
    await assert.rejects(rpc("foliage_notification_allowed", [randomUUID()], ["uuid"]), /permission denied/);
  } finally { await db.exec("reset role"); }
});

test("expansion transaction abort preserves both unexpanded event and absent delivery rows", async () => {
  await publication();
  await db.exec(`create function public.harness_notification_failure() returns trigger language plpgsql as $$
    begin raise exception 'harness notification expansion failure'; end $$;
    create trigger harness_fail before insert on public.foliage_notification_attempts
    for each row execute function public.harness_notification_failure();`);
  try {
    await assert.rejects(claim(), /harness notification expansion failure/);
    assert.deepEqual(await rows(), []);
    assert.equal((await db.query("select notifications_expanded_at from public.foliage_publication_outbox")).rows[0].notifications_expanded_at, null);
  } finally { await db.exec("drop trigger harness_fail on public.foliage_notification_attempts; drop function public.harness_notification_failure()"); }
});
