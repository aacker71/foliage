import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { withDocumentLocks, writeDocument } from "./localFiles.ts";

const exec = promisify(execFile);
const moduleUrl = new URL("./localFiles.ts", import.meta.url).href;
const roots: string[] = [];
after(async () => { for (const path of roots) await rm(path, { recursive: true, force: true }); });
async function temp() { const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-lock-"))); roots.push(dir); return dir; }

test("overlapping transactions refuse before reading, then retry from current bytes", async () => {
  const path = join(await temp(), "document.json");
  await writeFile(path, "[]");
  await withDocumentLocks([path], async () => {
    await assert.rejects(withDocumentLocks([path], async () => { assert.fail("busy callback ran"); }), /busy/);
    writeDocument(path, '["first"]');
  });
  await withDocumentLocks([path], async () => {
    const current = JSON.parse(await readFile(path, "utf8"));
    writeDocument(path, JSON.stringify([...current, "second"]));
  });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), ["first", "second"]);
  assert.equal(existsSync(`${path}.local-lock`), false);
});

test("partial acquisition releases earlier locks, and callback failures release all locks", async () => {
  const dir = await temp(); const a = join(dir, "a"); const b = join(dir, "b");
  await withDocumentLocks([b], async () => {
    await assert.rejects(withDocumentLocks([b, a], async () => {}), /busy/);
    assert.equal(existsSync(`${a}.local-lock`), false);
  });
  await assert.rejects(withDocumentLocks([a, b, a], async () => { throw new Error("primary failure"); }), /primary failure/);
  assert.deepEqual(await readdir(dir), []);
  await assert.rejects(withDocumentLocks([join(dir, "missing", "nested", "doc")], async () => { throw new Error("refused"); }), /refused/);
  assert.deepEqual(await readdir(dir), [], "refusal removes empty directories created for locking");
});

test("another process cannot bypass a held lock; a killed owner is never auto-reclaimed", { timeout: 10_000 }, async () => {
  const path = join(await temp(), "document");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {withDocumentLocks} from ${JSON.stringify(moduleUrl)}; await withDocumentLocks([process.argv[1]], async () => { console.log('locked'); await new Promise(() => setInterval(() => {}, 1000)); });`, path], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(child.stdout, "data");
    await assert.rejects(withDocumentLocks([path], async () => {}), /busy/);
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    await assert.rejects(withDocumentLocks([path], async () => {}), /not running on this computer.*delete document\.local-lock/);
    assert.equal(existsSync(`${path}.local-lock`), true);
  } finally { child.kill("SIGKILL"); }
});

test("legacy process.exit refusals release owned locks", async () => {
  const dir = await temp(); const path = join(dir, "document");
  await assert.rejects(exec(process.execPath, ["--input-type=module", "-e", `import {withDocumentLocks} from ${JSON.stringify(moduleUrl)}; await withDocumentLocks([process.argv[1]], async () => process.exit(7));`, path]), (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === 7);
  assert.deepEqual(await readdir(dir), []);
});

test("directory aliases coordinate; file symlinks and hardlinks are refused", async () => {
  const dir = await temp(); const parent = join(dir, "real"); await mkdir(parent);
  const alias = join(dir, "alias"); await symlink(parent, alias);
  const path = join(parent, "document"); await writeFile(path, "original");
  await withDocumentLocks([path], async () => {
    await assert.rejects(withDocumentLocks([join(alias, "document")], async () => {}), /busy/);
  });
  await symlink(path, join(dir, "file-alias"));
  await assert.rejects(withDocumentLocks([join(dir, "file-alias")], async () => {}), /file alias/);
  await link(path, join(dir, "hardlink"));
  await assert.rejects(withDocumentLocks([path], async () => {}), /file alias/);
  assert.equal(await readFile(path, "utf8"), "original");
});

test("atomic replacement failure preserves prior bytes and removes the incomplete write", async () => {
  const dir = await temp(); const path = join(dir, "document"); await writeFile(path, "prior bytes");
  const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; fs.renameSync = () => { throw new Error('injected rename failure'); }; syncBuiltinESMExports(); const {writeDocument}=await import(${JSON.stringify(moduleUrl)}); writeDocument(process.argv[1], 'new bytes');`;
  await assert.rejects(exec(process.execPath, ["--input-type=module", "-e", script, path]), /injected rename failure/);
  assert.equal(await readFile(path, "utf8"), "prior bytes");
  assert.deepEqual(await readdir(dir), ["document"]);
  assert.throws(() => writeDocument(path, "exclusive", false), /EEXIST/);
  assert.equal(await readFile(path, "utf8"), "prior bytes");
});

test("a cleanup failure reports both the operation and cleanup causes", async () => {
  const dir = await temp(); const path = join(dir, "document");
  await assert.rejects(withDocumentLocks([path], async () => {
    await writeFile(`${path}.local-lock`, "damaged lock");
    throw new Error("primary failure");
  }), /primary failure.*cleanup also failed/);
});

test("durable writes flush file then directory; sync failures do not claim rollback", async () => {
  const dir = await temp(); const path = join(dir, "document");
  writeDocument(path, "original", false, true);
  for (const failAt of [1, 2]) {
    const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; const sync = fs.fsyncSync; let calls = 0; fs.fsyncSync = fd => { if (++calls === ${failAt}) throw new Error('injected sync failure'); return sync(fd); }; syncBuiltinESMExports(); const {writeDocument} = await import(${JSON.stringify(moduleUrl)}); writeDocument(process.argv[1], 'replacement', true, true);`;
    await assert.rejects(exec(process.execPath, ["--input-type=module", "-e", script, path]), failAt === 1 ? /injected sync failure/ : /visible.*durability is uncertain/);
    assert.equal(await readFile(path, "utf8"), failAt === 1 ? "original" : "replacement");
    assert.deepEqual(await readdir(dir), ["document"]);
  }
});
