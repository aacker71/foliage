/** Disposable SQL harness only; generated identities are not hosted acceptance evidence. */
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { after, test } from "node:test";
const runtime = process.env.FOLIAGE_PGLITE_MODULE;
if (!runtime) throw new Error("Set FOLIAGE_PGLITE_MODULE for disposable SQL validation.");
const db = new (createRequire(import.meta.url)(runtime).PGlite)();
after(() => db.close());
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;`);
const CAP = "202610090001_address_cap.sql";
const migrations = (await readdir(new URL("../migrations/", import.meta.url))).filter(name => name.endsWith(".sql")).sort();
assert.ok(migrations.includes(CAP));
// Every earlier migration runs in order, so the cap also lands on an account already past it.
for (const name of migrations.slice(0, migrations.indexOf(CAP))) await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
const resolve = async subject => (await db.query("select public.foliage_resolve_actor('https://cap.clerk.accounts.dev',$1) as id", [subject])).rows[0].id;
const reserve = async (actor, subject) => (await db.query("select public.foliage_reserve_subject($1,$2) as value", [actor, subject])).rows[0].value;
const owned = async actor => (await db.query("select count(*)::int n from public.foliage_subjects where owner_id=$1", [actor])).rows[0].n;
const earlier = await resolve("user_EarlierHarness");
for (const n of [1, 2, 3, 4]) await reserve(earlier, `cap-earlier-${n}`);
await db.exec(await readFile(new URL(`../migrations/${CAP}`, import.meta.url), "utf8"));

test("an account reserves at most three addresses and keeps every owned one reachable", async () => {
  const actor = await resolve("user_CapHarness"), other = await resolve("user_CapOther");
  for (const n of [1, 2, 3]) assert.equal((await reserve(actor, `cap-${n}`)).actorId, actor);
  await assert.rejects(reserve(actor, "cap-4"), /foliage_address_limit/);
  assert.equal(await owned(actor), 3);
  assert.deepEqual(await reserve(actor, "cap-2"), { subjectId: "cap-2", actorId: actor, revisionId: null, generation: 0, visible: false });
  assert.equal((await reserve(other, "cap-4")).actorId, other);
  await assert.rejects(reserve(actor, "cap-4"), /foliage_forbidden/);
  await assert.rejects(reserve(actor, "Not-An-Address"), /foliage_invalid/);
  assert.equal(await owned(actor), 3);
});

test("an account already past the cap keeps its addresses but reserves no new one", async () => {
  assert.equal(await owned(earlier), 4);
  for (const n of [1, 2, 3, 4]) assert.equal((await reserve(earlier, `cap-earlier-${n}`)).actorId, earlier);
  await assert.rejects(reserve(earlier, "cap-earlier-5"), /foliage_address_limit/);
  assert.equal(await owned(earlier), 4);
});

test("an operator-inserted address is usable through the RPC without lifting the cap for new ones", async () => {
  const actor = await resolve("user_CapRaised");
  for (const n of [1, 2, 3]) await reserve(actor, `cap-raised-${n}`);
  await db.query("insert into public.foliage_subjects(subject_id, owner_id) values('cap-raised-support',$1)", [actor]);
  assert.equal((await reserve(actor, "cap-raised-support")).actorId, actor);
  await assert.rejects(reserve(actor, "cap-raised-5"), /foliage_address_limit/);
});

test("browser roles still cannot reserve; the service role can", async () => {
  const actor = await resolve("user_CapRoles");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(reserve(actor, "cap-roles"), /permission denied/); }
    finally { await db.exec("reset role"); }
  }
  await db.exec("set role service_role");
  try { assert.equal((await reserve(actor, "cap-roles")).actorId, actor); }
  finally { await db.exec("reset role"); }
});
