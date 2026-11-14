/** Disposable SQL harness only; generated identities are not hosted acceptance evidence. */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
const runtime = process.env.FOLIAGE_PGLITE_MODULE;
if (!runtime) throw new Error("Set FOLIAGE_PGLITE_MODULE for disposable SQL validation.");
const db = new (createRequire(import.meta.url)(runtime).PGlite)();
after(() => db.close());
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(bucket_id text); alter table storage.objects enable row level security;`);
for (const name of ["202609080001_hosted_publications.sql", "202609080002_owner_notifications.sql"]) await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
const legacy = randomUUID();
await db.query("insert into auth.users values($1)", [legacy]);
await db.query("select public.foliage_reserve_subject($1,'legacy-sql-harness')", [legacy]);
await db.exec(await readFile(new URL("../migrations/202609150001_clerk_actors.sql", import.meta.url), "utf8"));
const resolve = async (issuer, subject) => (await db.query("select public.foliage_resolve_actor($1,$2) as id", [issuer, subject])).rows[0].id;

test("Clerk actors are stable and isolated across both issuer and subject", async () => {
  const a = await resolve("https://first.clerk.accounts.dev", "user_SQLharness");
  assert.equal(await resolve("https://first.clerk.accounts.dev", "user_SQLharness"), a);
  assert.notEqual(await resolve("https://second.clerk.accounts.dev", "user_SQLharness"), a);
  const b = await resolve("https://first.clerk.accounts.dev", "user_Otherharness");
  assert.notEqual(b, a);
  await db.query("select public.foliage_reserve_subject($1,'clerk-sql-harness')", [a]);
  await assert.rejects(db.query("select public.foliage_reserve_subject($1,'clerk-sql-harness')", [b]), /foliage_forbidden/);
  await db.query("select public.foliage_notification_preferences($1)", [a]);
});

test("migration preserves legacy ownership without email linking", async () => {
  const row = (await db.query("select owner_id from public.foliage_subjects where subject_id='legacy-sql-harness'")).rows[0];
  assert.equal(row.owner_id, legacy);
  assert.equal((await db.query("select issuer from public.foliage_actors where id=$1", [legacy])).rows[0].issuer, "legacy:supabase-auth");
});

test("browser roles cannot read or mint actor mappings; service RPC can", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(resolve("https://first.clerk.accounts.dev", "user_Attacker"), /permission denied/);
      await assert.rejects(db.query("select * from public.foliage_actors"), /permission denied/);
    } finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try { assert.match(await resolve("https://first.clerk.accounts.dev", "user_Serviceharness"), /^[0-9a-f-]{36}$/); }
  finally { await db.exec("reset role"); }
  for (const pair of [["http://wrong", "user_Harness"], ["https://first.clerk.accounts.dev", "arbitrary"], [null, "user_Harness"]]) await assert.rejects(resolve(...pair), /foliage_invalid/);
});

test("weekly summaries default on, daily digests require a choice, and legacy saves preserve both", async () => {
  const a = await resolve("https://first.clerk.accounts.dev", "user_SummaryOwner");
  const b = await resolve("https://first.clerk.accounts.dev", "user_SummaryOther");
  const get = async id => (await db.query("select public.foliage_notification_preferences($1) as value", [id])).rows[0].value;
  // Simulate a pre-migration opt-out: new cadence columns must not enable email.
  await db.query("select public.foliage_set_notification_preferences($1,false,false,false)", [a]);
  await db.exec(await readFile(new URL("../migrations/202609230002_summary_preferences.sql", import.meta.url), "utf8"));
  assert.deepEqual(await get(a), { inbox: false, email: false, sms: false, weeklySummary: true, dailyDigest: false });
  assert.deepEqual(await get(b), { inbox: true, email: false, sms: false, weeklySummary: true, dailyDigest: false });
  await db.query("select public.foliage_set_notification_preferences($1,false,false,false,true,true)", [a]);
  assert.equal((await get(a)).dailyDigest, true);
  assert.equal((await get(b)).dailyDigest, false);
  await db.query("select public.foliage_set_notification_preferences($1,true,false,false)", [a]);
  assert.equal((await get(a)).dailyDigest, true);
  await db.query("select public.foliage_set_notification_preferences($1,true,false,false,false,false)", [a]);
  assert.equal((await get(a)).weeklySummary, false);
  assert.equal((await get(a)).dailyDigest, false);
  assert.equal((await get(a)).email, false);
  await assert.rejects(db.query("select public.foliage_set_notification_preferences($1,true,false,false,true,null)", [a]), /foliage_invalid/);
  await assert.rejects(db.query("select public.foliage_set_notification_preferences($1,true,false,false,true,true)", [randomUUID()]), /foliage_forbidden/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query("select * from public.foliage_notification_preferences"), /permission denied/);
      if (role === "service_role") await db.query("select public.foliage_set_notification_preferences($1,true,false,false,true,false)", [a]);
      else await assert.rejects(db.query("select public.foliage_set_notification_preferences($1,true,false,false,true,true)", [a]), /permission denied/);
    } finally { await db.exec("reset role"); }
  }
  assert.equal((await db.query("select count(*)::int n from public.foliage_notification_attempts")).rows[0].n, 0);
});
