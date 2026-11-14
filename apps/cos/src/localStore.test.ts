/**
 * TIER 1 STORE — tests against a REAL SQLite file on a REAL disk.
 *
 * Nothing here is mocked and there is no in-memory shortcut. The claim under test is about
 * BYTES ON DISK — "this material cannot be read off a stolen laptop" — and an in-memory
 * database cannot falsify or confirm it. Every test makes its own store in a fresh temp
 * directory, writes, closes, and deletes the directory afterwards.
 *
 * The load-bearing test is `the plaintext never reaches the disk`: it opens the finished
 * file with `readFileSync` and searches the raw bytes for the body, the id and the declared
 * kind, INCLUDING SQLite's sidecar files (`-wal`, `-shm`, `-journal`) — because a rollback
 * journal holding a pre-image of the page is still the person's material sitting on their
 * disk in the clear, and checking only the .db would have missed it.
 *
 * A note on cost. Each `openTier1Store` runs scrypt at N = 2^17, measured at ~270 ms on this
 * machine, and this file opens a store a couple of dozen times — so the suite takes a few
 * seconds and that is the KDF doing its job, not a hang. Weakening the parameters to make
 * the tests fast would be testing a different program than the one that ships.
 *
 * `node:sqlite` prints `ExperimentalWarning: SQLite is an experimental feature` to stderr on
 * import. Nothing here asserts a clean stderr and nothing suppresses the warning globally: a
 * swallowed warning is how the next Node upgrade becomes a mystery.
 */

import { deepStrictEqual, match, notStrictEqual, ok, strictEqual } from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { openTier1Store, type Tier1Store } from "./localStore.ts";

const SECRET = "a passphrase a person actually chose";
const WRONG_SECRET = "a passphrase a person actually chase";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "foliage-tier1-"));
  dirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Open (creating) or fail the test with the store's own stated reason. */
async function openOrFail(path: string, secret: string, create = true): Promise<Tier1Store> {
  const result = await openTier1Store({ path, secret, create });
  if (result.state !== "opened") throw new Error(`open failed: ${result.cause} — ${result.detail}`);
  return result.store;
}

/** Every file SQLite may have left beside the store, journals included. */
function storeBytes(path: string): Buffer {
  const parts: Buffer[] = [readFileSync(path)];
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${path}${suffix}`;
    if (existsSync(sidecar)) parts.push(readFileSync(sidecar));
  }
  return Buffer.concat(parts);
}

// -------------------------------------------------------------------------------------
// The honest empty state
// -------------------------------------------------------------------------------------

test("a fresh store is empty, and empty is a STATE — not an array that happens to have no entries", async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);

  const listed = await store.list();
  strictEqual(listed.state, "empty");

  // The item table really is empty. No seeded row, no demo record, no example: the key check
  // lives in `meta` precisely so that a fresh store has zero rows of a person's material.
  const read = await store.read("anything at all");
  strictEqual(read.state, "absent");

  strictEqual(store.close().state, "closed");

  const db = new DatabaseSync(path);
  const rows = db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number };
  strictEqual(Number(rows.n), 0);
  db.close();
});

// -------------------------------------------------------------------------------------
// The whole lifecycle, on a real file
// -------------------------------------------------------------------------------------

test("create → write → read back → close → reopen → read back → remove → delete", async () => {
  const dir = tempDir();
  const path = join(dir, "tier1.db");

  const store = await openOrFail(path, SECRET);
  const written = await store.put({
    id: "2026-mid-year-review",
    kind: "performance-review",
    body: "I was told I am not strategic enough for the next level and I have not stopped thinking about it.",
    recordedAt: "2026-08-19T09:00:00-07:00",
  });
  strictEqual(written.state, "written");
  if (written.state === "written") strictEqual(written.replaced, false);

  const readBack = await store.read("2026-mid-year-review");
  strictEqual(readBack.state, "present");
  if (readBack.state === "present") {
    strictEqual(readBack.item.kind, "performance-review");
    match(readBack.item.body, /not strategic enough/);
    strictEqual(readBack.item.recordedAt, "2026-08-19T09:00:00-07:00");
  }
  strictEqual(store.close().state, "closed");

  // Reopening is the real test of the header: the salt and KDF parameters came off the file.
  const again = await openOrFail(path, SECRET, false);
  strictEqual(again.kdf.kdf, "scrypt");
  strictEqual(again.kdf.cost, 1 << 17);
  strictEqual(again.kdf.keyLengthBytes, 64);

  const listed = await again.list();
  strictEqual(listed.state, "present");
  if (listed.state === "present") {
    strictEqual(listed.items.length, 1);
    deepStrictEqual(listed.failed, []);
    strictEqual(listed.items[0]?.id, "2026-mid-year-review");
  }

  const removed = await again.remove("2026-mid-year-review");
  strictEqual(removed.state, "removed");
  strictEqual((await again.read("2026-mid-year-review")).state, "absent");
  strictEqual((await again.remove("2026-mid-year-review")).state, "absent");
  strictEqual((await again.list()).state, "empty");
  strictEqual(again.close().state, "closed");

  rmSync(dir, { recursive: true, force: true });
  strictEqual(existsSync(path), false);
});

test("a second put under the same id replaces rather than duplicating, and says so", async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);
  await store.put({ id: "note", kind: "reflection", body: "first", recordedAt: "2026-08-19T09:00:00-07:00" });
  const second = await store.put({ id: "note", kind: "reflection", body: "second", recordedAt: "2026-08-19T10:00:00-07:00" });
  strictEqual(second.state, "written");
  if (second.state === "written") strictEqual(second.replaced, true);

  const listed = await store.list();
  strictEqual(listed.state, "present");
  if (listed.state === "present") strictEqual(listed.items.length, 1);

  const read = await store.read("note");
  if (read.state === "present") strictEqual(read.item.body, "second");
  else throw new Error(`expected present, got ${read.state}`);
  store.close();
});

// -------------------------------------------------------------------------------------
// THE CLAIM: nothing readable reaches the disk
// -------------------------------------------------------------------------------------

test("the plaintext never reaches the disk — not the body, not the id, not the declared kind", async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);

  const body = "PLAINTEXT-CANARY-BODY the thing I would not want anyone to read";
  const id = "PLAINTEXT-CANARY-ID";
  const kind = "PLAINTEXT-CANARY-KIND";
  strictEqual(
    (await store.put({ id, kind, body, recordedAt: "2026-08-19T09:00:00-07:00" })).state,
    "written",
  );
  strictEqual(store.close().state, "closed");

  const bytes = storeBytes(path);
  ok(bytes.length > 0, "the store file has bytes in it");

  for (const canary of [body, id, kind, SECRET]) {
    strictEqual(
      bytes.includes(Buffer.from(canary, "utf8")),
      false,
      `"${canary.slice(0, 24)}…" was found in the raw bytes on disk`,
    );
    // UTF-16 too: a value that survived a different encoding path would still be readable
    // by anyone holding the file, and "we checked one encoding" is not the claim being made.
    strictEqual(bytes.includes(Buffer.from(canary, "utf16le")), false, "found as UTF-16");
  }

  // What IS on disk, deliberately and by design: the format header and the KDF parameters.
  // They are not secret and the store cannot be reopened without them. Asserting their
  // presence keeps the previous assertions honest — it proves the file was actually written
  // and searched, rather than the search passing because the file was empty.
  ok(bytes.includes(Buffer.from("foliage-tier1", "utf8")), "the format tag is on disk");
});

// -------------------------------------------------------------------------------------
// A wrong secret
// -------------------------------------------------------------------------------------

test("a wrong secret is refused AT OPEN with key-mismatch — never mistaken for an empty store", async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);
  await store.put({ id: "note", kind: "reflection", body: "mine", recordedAt: "2026-08-19T09:00:00-07:00" });
  store.close();

  const wrong = await openTier1Store({ path, secret: WRONG_SECRET, create: false });
  strictEqual(wrong.state, "failed");
  if (wrong.state === "failed") {
    strictEqual(wrong.cause, "key-mismatch");
    match(wrong.detail, /does not open/);
  }

  // And the store is untouched: the right secret still opens it and the material is intact.
  const right = await openOrFail(path, SECRET, false);
  strictEqual((await right.read("note")).state, "present");
  right.close();
});

test("an empty secret is refused rather than accepted as a degenerate key", async () => {
  const path = join(tempDir(), "tier1.db");
  const result = await openTier1Store({ path, secret: "", create: true });
  strictEqual(result.state, "failed");
  if (result.state === "failed") {
    strictEqual(result.cause, "secret-unusable");
    match(result.detail, /empty/);
  }
});

// -------------------------------------------------------------------------------------
// The causes that must not collapse into one another
// -------------------------------------------------------------------------------------

test("a missing file is `no-store-file`, not a helpfully-created empty store", async () => {
  const path = join(tempDir(), "not-created.db");
  const result = await openTier1Store({ path, secret: SECRET });
  strictEqual(result.state, "failed");
  if (result.state === "failed") strictEqual(result.cause, "no-store-file");
  strictEqual(existsSync(path), false, "a failed open must not leave a file behind");
});

test("a file that is not a database is `not-a-store`, and is distinct from `no-store-file`", async () => {
  const path = join(tempDir(), "notes.txt");
  writeFileSync(path, "these are just my notes, in a text file\n", "utf8");
  const result = await openTier1Store({ path, secret: SECRET, create: true });
  strictEqual(result.state, "failed");
  if (result.state === "failed") strictEqual(result.cause, "not-a-store");
});

test("a SQLite database that is not ours is `not-a-store`, not an empty Tier 1 store", async () => {
  const path = join(tempDir(), "someone-elses.db");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE bookmarks (url TEXT)");
  db.close();

  const result = await openTier1Store({ path, secret: SECRET, create: false });
  strictEqual(result.state, "failed");
  if (result.state === "failed") strictEqual(result.cause, "not-a-store");
});

test("an unknown schema version is refused, not read optimistically", async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);
  store.close();

  const db = new DatabaseSync(path);
  db.prepare("UPDATE meta SET value = ? WHERE key = 'schema'").run("99");
  db.close();

  const result = await openTier1Store({ path, secret: SECRET, create: false });
  strictEqual(result.state, "failed");
  if (result.state === "failed") {
    strictEqual(result.cause, "schema-unsupported");
    match(result.detail, /schema 99/);
  }
});

test("a tampered record reads `undecryptable` — the one state that means the material is still there", async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);
  await store.put({ id: "note", kind: "reflection", body: "mine", recordedAt: "2026-08-19T09:00:00-07:00" });
  store.close();

  // Flip one bit in the ciphertext, the way bit rot or an editor would.
  const db = new DatabaseSync(path);
  const row = db.prepare("SELECT blind_id, ciphertext FROM item").get() as {
    blind_id: Uint8Array;
    ciphertext: Uint8Array;
  };
  const corrupted = Uint8Array.from(row.ciphertext);
  corrupted[0] = (corrupted[0] ?? 0) ^ 0x01;
  db.prepare("UPDATE item SET ciphertext = ? WHERE blind_id = ?").run(corrupted, row.blind_id);
  db.close();

  const reopened = await openOrFail(path, SECRET, false);
  const read = await reopened.read("note");
  strictEqual(read.state, "undecryptable");
  if (read.state === "undecryptable") strictEqual(read.cause, "record-undecryptable");

  // And a listing reports it rather than returning a shorter list and saying nothing.
  const listed = await reopened.list();
  strictEqual(listed.state, "present");
  if (listed.state === "present") {
    strictEqual(listed.items.length, 0);
    strictEqual(listed.failed.length, 1);
    strictEqual(listed.failed[0]?.cause, "record-undecryptable");
    ok((listed.failed[0]?.blindIdHex.length ?? 0) === 64, "a failed record is named by its blind id");
  }
  reopened.close();
});

test("AAD binds a record to its row: swapping two ciphertexts breaks BOTH instead of swapping the answers", async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);
  await store.put({ id: "a", kind: "reflection", body: "body-of-a", recordedAt: "2026-08-19T09:00:00-07:00" });
  await store.put({ id: "b", kind: "reflection", body: "body-of-b", recordedAt: "2026-08-19T09:00:00-07:00" });
  store.close();

  const db = new DatabaseSync(path);
  const rows = db.prepare("SELECT blind_id, nonce, ciphertext FROM item ORDER BY blind_id").all() as unknown as {
    blind_id: Uint8Array;
    nonce: Uint8Array;
    ciphertext: Uint8Array;
  }[];
  strictEqual(rows.length, 2);
  const [first, second] = rows;
  ok(first !== undefined && second !== undefined);
  const update = db.prepare("UPDATE item SET nonce = ?, ciphertext = ? WHERE blind_id = ?");
  update.run(second.nonce, second.ciphertext, first.blind_id);
  update.run(first.nonce, first.ciphertext, second.blind_id);
  db.close();

  const reopened = await openOrFail(path, SECRET, false);
  for (const id of ["a", "b"]) {
    const read = await reopened.read(id);
    strictEqual(read.state, "undecryptable", `${id} must not decrypt into the other row's body`);
  }
  reopened.close();
});

test("every store gets its own salt, so the same secret and the same item produce different bytes", async () => {
  const one = join(tempDir(), "one.db");
  const two = join(tempDir(), "two.db");
  for (const path of [one, two]) {
    const store = await openOrFail(path, SECRET);
    await store.put({ id: "note", kind: "reflection", body: "identical body", recordedAt: "2026-08-19T09:00:00-07:00" });
    store.close();
  }
  const dbOne = new DatabaseSync(one);
  const dbTwo = new DatabaseSync(two);
  const saltOne = dbOne.prepare("SELECT value FROM meta WHERE key = 'kdf_salt'").get() as { value: string };
  const saltTwo = dbTwo.prepare("SELECT value FROM meta WHERE key = 'kdf_salt'").get() as { value: string };
  notStrictEqual(saltOne.value, saltTwo.value);

  const blindOne = dbOne.prepare("SELECT blind_id FROM item").get() as { blind_id: Uint8Array };
  const blindTwo = dbTwo.prepare("SELECT blind_id FROM item").get() as { blind_id: Uint8Array };
  notStrictEqual(
    Buffer.from(blindOne.blind_id).toString("hex"),
    Buffer.from(blindTwo.blind_id).toString("hex"),
    "a per-store salt must make even the blinded id differ between stores",
  );
  dbOne.close();
  dbTwo.close();
});

// -------------------------------------------------------------------------------------
// Who else on the machine can read the file
// -------------------------------------------------------------------------------------

/** Permission bits only. POSIX modes are what is under test, so Windows skips these. */
const modeOf = (path: string): number => statSync(path).mode & 0o777;
const posixOnly = { skip: process.platform === "win32" ? "POSIX file modes" : false };

test("a new store is owner-only: the file 0600, and every directory it had to create 0700", posixOnly, async () => {
  const root = tempDir();
  const path = join(root, "cos", "private", "tier1.db");
  const store = await openOrFail(path, SECRET);
  await store.put({ id: "note", kind: "reflection", body: "mine", recordedAt: "2026-08-19T09:00:00-07:00" });
  store.close();

  strictEqual(modeOf(path).toString(8), "600");
  strictEqual(modeOf(join(root, "cos", "private")).toString(8), "700");
  strictEqual(modeOf(join(root, "cos")).toString(8), "700");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (existsSync(`${path}${suffix}`)) strictEqual(modeOf(`${path}${suffix}`).toString(8), "600", suffix);
  }
});

test("a directory that already exists keeps its own mode — it is the person's, not the store's", posixOnly, async () => {
  const dir = join(tempDir(), "documents");
  mkdirSync(dir);
  chmodSync(dir, 0o755);
  const store = await openOrFail(join(dir, "tier1.db"), SECRET);
  store.close();
  strictEqual(modeOf(dir).toString(8), "755");
  strictEqual(modeOf(join(dir, "tier1.db")).toString(8), "600");
});

test("a world-readable store from an earlier build is tightened to 0600 — once its own secret opens it", posixOnly, async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);
  store.close();
  chmodSync(path, 0o644);

  // A wrong secret changes nothing, modes included: that refusal says so in its own words.
  strictEqual((await openTier1Store({ path, secret: WRONG_SECRET })).state, "failed");
  strictEqual(modeOf(path).toString(8), "644");

  const again = await openOrFail(path, SECRET, false);
  again.close();
  strictEqual(modeOf(path).toString(8), "600");

  // A file that is not a store is refused, never re-moded: a mistyped path is not ours to change.
  const notes = join(tempDir(), "notes.txt");
  writeFileSync(notes, "these are just my notes, in a text file\n", "utf8");
  chmodSync(notes, 0o644);
  strictEqual((await openTier1Store({ path: notes, secret: SECRET, create: true })).state, "failed");
  strictEqual(modeOf(notes).toString(8), "644");
});

test("an existing header-less file that `create` makes a store is owner-only too, not left at its old mode", posixOnly, async () => {
  // An empty file is one SQLite opens as a new database, so `create` writes a header into it.
  const path = join(tempDir(), "tier1.db");
  writeFileSync(path, "");
  chmodSync(path, 0o644);
  const store = await openOrFail(path, SECRET);
  await store.put({ id: "note", kind: "reflection", body: "mine", recordedAt: "2026-08-19T09:00:00-07:00" });
  store.close();
  strictEqual(modeOf(path).toString(8), "600");
  // And it is a store now: its own secret opens it without `create`.
  (await openOrFail(path, SECRET, false)).close();
});

// -------------------------------------------------------------------------------------
// Refusals a caller can act on
// -------------------------------------------------------------------------------------

test("a closed store refuses every operation with `store-closed` and does not reopen itself", async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);
  strictEqual(store.close().state, "closed");
  strictEqual(store.close().state, "already-closed");

  const put = await store.put({ id: "x", kind: "k", body: "b", recordedAt: "2026-08-19T09:00:00-07:00" });
  strictEqual(put.state, "refused");
  if (put.state === "refused") strictEqual(put.cause, "store-closed");

  const read = await store.read("x");
  strictEqual(read.state, "unreadable");
  if (read.state === "unreadable") strictEqual(read.cause, "store-closed");

  const listed = await store.list();
  strictEqual(listed.state, "unreadable");
  if (listed.state === "unreadable") strictEqual(listed.cause, "store-closed");

  const removed = await store.remove("x");
  strictEqual(removed.state, "refused");
  if (removed.state === "refused") strictEqual(removed.cause, "store-closed");
});

test("an item missing a declared kind is refused before any crypto runs, and the refusal names the field", async () => {
  const path = join(tempDir(), "tier1.db");
  const store = await openOrFail(path, SECRET);

  const cases: { item: Record<string, unknown>; field: RegExp }[] = [
    { item: { id: "", kind: "k", body: "b", recordedAt: "t" }, field: /`id`/ },
    { item: { id: "x", kind: "", body: "b", recordedAt: "t" }, field: /`kind`/ },
    { item: { id: "x", kind: "k", body: 7, recordedAt: "t" }, field: /`body`/ },
    { item: { id: "x", kind: "k", body: "b", recordedAt: "" }, field: /`recordedAt`/ },
  ];
  for (const c of cases) {
    const result = await store.put(c.item as never);
    strictEqual(result.state, "refused");
    if (result.state === "refused") {
      strictEqual(result.cause, "item-invalid");
      match(result.detail, c.field);
    }
  }

  // An empty body is legitimate — someone may record that a thing happened and write nothing.
  strictEqual((await store.put({ id: "x", kind: "k", body: "", recordedAt: "t" })).state, "written");
  store.close();
});

// -------------------------------------------------------------------------------------
// STRUCTURAL: this file cannot reach the network
// -------------------------------------------------------------------------------------

test("localStore.ts imports only node:fs, node:path, node:crypto and node:sqlite, and names no network primitive", () => {
  const source = readFileSync(new URL("./localStore.ts", import.meta.url), "utf8");

  // Strip comments first. The header DISCUSSES node:http and fetch by name in order to say
  // they are absent, so a grep over the raw text would fail on the very prose that explains
  // the property. (This stripper is deliberately simple — it would mishandle a "//" inside a
  // string literal, and localStore.ts contains none. If one is ever added, this test is where
  // it will show up, which is the right place for it to.)
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  const specifiers = new Set<string>();
  for (const m of code.matchAll(/\bfrom\s*["']([^"']+)["']/g)) specifiers.add(m[1] as string);
  for (const m of code.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) specifiers.add(m[1] as string);
  // node:path is string arithmetic on the store's own path (its parent directory); it opens nothing.
  deepStrictEqual([...specifiers].sort(), ["node:crypto", "node:fs", "node:path", "node:sqlite"]);

  // Every way this file could open a socket, start a process, or defer either to load time.
  const forbidden = [
    "fetch(",
    "node:http",
    "node:https",
    "node:net",
    "node:tls",
    "node:dgram",
    "node:dns",
    "node:child_process",
    "child_process",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "sendBeacon",
    "import(",
    "createRequire",
    "process.binding",
  ];
  for (const token of forbidden) {
    strictEqual(code.includes(token), false, `localStore.ts must not contain "${token}"`);
  }

  // This guards THIS file. It is not a claim about the whole app, and it is not a runtime
  // sandbox: it is the mechanical half of the Tier 1 promise, checked where the promise is
  // made. A router or a Tier 3 client that reads from this store and then sends what it read
  // is a separate seam and needs its own gate.
});
