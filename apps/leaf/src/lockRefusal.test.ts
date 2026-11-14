/** `lockRefusal`: the one line a CLI prints for a document lock it could not take, or null. */
import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { withDocumentLocks } from "@foliage/leaf/local-files";

import { lockRefusal } from "./lockRefusal.ts";

const roots: string[] = [];
after(async () => { for (const path of roots) await rm(path, { recursive: true, force: true }); });
async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-lock-refusal-")); roots.push(dir);
  return dir;
}

/** What the lock module actually threw, so the wording is checked against the real refusal. */
async function refusalFrom(paths: readonly string[], inside: () => Promise<unknown> = async () => undefined): Promise<unknown> {
  try { await withDocumentLocks(paths, inside); }
  catch (error) { return error; }
  assert.fail("expected the lock to be refused");
}

test(
  "a folder this process may not write: the file by name, read-only, fix its permissions",
  { skip: process.getuid?.() === 0 ? "root writes through folder permissions" : false },
  async () => {
    const dir = await folder();
    await chmod(dir, 0o555);
    try {
      const error = await refusalFrom([join(dir, "leaf.json")]);
      assert.equal(lockRefusal(error), "cannot write leaf.json · the garden folder is read-only · fix its permissions");
    } finally { await chmod(dir, 0o700); }
    assert.deepEqual(await readdir(dir), [], "no lock file was left behind");
  },
);

test("a lock already held: the lock module's busy sentence, one line, file names only", async () => {
  const dir = await folder();
  const document = join(dir, "harvest.json");
  const error = await refusalFrom([document], async () => {
    const busy = await refusalFrom([document]);
    const line = lockRefusal(busy);
    assert.ok(line !== null);
    assert.match(line, /busy/);
    assert.match(line, /harvest\.json/);
    assert.match(line, /retry|try again/i);
    assert.ok(!line.includes(dir), line);
    assert.doesNotMatch(line, /(^|\s|')\/[^\s']+\//, line);
    assert.doesNotMatch(line, /\n/);
    throw new Error("held lock checked");
  });
  assert.equal((error as Error).message, "held lock checked");
});

test("a lock already held in folders whose names have spaces: no folder name reaches the line", async () => {
  // Where gardens really live on a Mac: iCloud Drive, a synced drive, Application Support.
  const dir = await folder();
  const garden = join(dir, "Mobile Documents", "com~apple~CloudDocs", "My Garden");
  const document = join(garden, "leaf.json");
  const error = await refusalFrom([document], async () => {
    const line = lockRefusal(await refusalFrom([document]));
    assert.ok(line !== null);
    assert.match(line, /busy/);
    assert.match(line, /leaf\.json/);
    assert.match(line, /retry|try again/i);
    for (const part of [dir, "Mobile Documents", "com~apple~CloudDocs", "My Garden", "Garden/"]) {
      assert.ok(!line.includes(part), `"${part}" leaked into: ${line}`);
    }
    assert.ok(!line.includes("/"), `no path at all in: ${line}`);
    assert.doesNotMatch(line, /\n/);
    throw new Error("held lock checked");
  });
  assert.equal((error as Error).message, "held lock checked");
});

test("busy: the lock's own sentence keeps its words and loses only the folder", () => {
  const busy = (message: string) => Object.assign(new Error(message), { code: "ELOCALBUSY" });
  const rest = "Retry after the current operation; if it exited, inspect this lock before deliberately removing it. No lock was stolen.";
  assert.equal(
    lockRefusal(busy(`local document busy: /Users/a b/Application Support/My. Garden/leaf.json.local-lock. ${rest}`)),
    `local document busy: leaf.json.local-lock. ${rest}`,
  );
  // A busy sentence that names no folder (the lock module's newer wording) is passed through as is.
  const named = "local document busy: leaf.json.local-lock was left by a Foliage process that is not running on this computer (pid 42). If nothing else is writing leaf.json, delete leaf.json.local-lock and try again.";
  assert.equal(lockRefusal(busy(named)), named);
});

test("permission and read-only-disk causes in a folder with spaces and colons", () => {
  const refused = (errno: string, text: string) =>
    new Error(`cannot lock /Users/a b/c: d/leaf.json: ${errno}: ${text}, open '/Users/a b/c: d/leaf.json.local-lock'`);
  assert.equal(
    lockRefusal(refused("EPERM", "operation not permitted")),
    "cannot write leaf.json · the garden folder is read-only · fix its permissions",
  );
  assert.equal(
    lockRefusal(refused("EROFS", "read-only file system")),
    "cannot write leaf.json · the garden folder is on a read-only disk · move the garden to a writable disk",
  );
});

test("anything else is not a lock refusal, so the caller rethrows it untouched", () => {
  assert.equal(lockRefusal(new Error("cannot lock /g/leaf.json: ENOSPC: no space left on device, open '/g/leaf.json.local-lock'")), null);
  assert.equal(lockRefusal(Object.assign(new Error("EACCES: permission denied, open '/g/leaf.json'"), { code: "EACCES" })), null);
  assert.equal(lockRefusal(new Error("local document busy")), null, "busy without the lock's code is not the lock's");
  assert.equal(lockRefusal("cannot lock /g/leaf.json: EACCES: permission denied"), null);
  assert.equal(lockRefusal(undefined), null);
});
