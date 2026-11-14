/** A lock left by a crash is never taken, but the refusal says who held it and exactly what to clear. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { withDocumentLocks, writeDocument } from "./localFiles.ts";

const moduleUrl = new URL("./localFiles.ts", import.meta.url).href;
const roots: string[] = [];
after(async () => { for (const path of roots) await rm(path, { recursive: true, force: true }); });
async function document() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-stale-lock-"))); roots.push(dir);
  const path = join(dir, "harvest.json");
  return { dir, path, lock: `${path}.local-lock` };
}
const exactly = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
/** The refusal is ELOCALBUSY, says exactly this, and never shows the folder. */
async function refused(path: string, dir: string, expected: string) {
  await assert.rejects(withDocumentLocks([path], async () => assert.fail("work ran without the lock")), (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, "ELOCALBUSY");
    assert.match((error as Error).message, exactly(`local document busy: ${expected}`));
    assert.ok(!(error as Error).message.includes(dir), "no folder path in front of a person");
    return true;
  });
}

/** A real crash: a child takes the lock through the product code, then is killed holding it. */
async function crashedHolder(path: string): Promise<number> {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {withDocumentLocks} from ${JSON.stringify(moduleUrl)}; await withDocumentLocks([process.argv[1]], async () => { console.log('locked'); await new Promise(() => setInterval(() => {}, 1000)); });`, path], { stdio: ["ignore", "pipe", "inherit"] });
  await once(child.stdout, "data");
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  return child.pid!;
}
/** A pid that belonged to a process which has exited. */
async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "exit");
  assert.throws(() => process.kill(child.pid!, 0), /ESRCH/);
  return child.pid!;
}

test("each lock records its owner's pid, computer and start time", async () => {
  const { path, lock } = await document();
  await withDocumentLocks([path], async () => {
    const owner = JSON.parse(await readFile(lock, "utf8"));
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.host, hostname());
    assert.ok(Number.isFinite(Date.parse(owner.createdAt)));
    assert.equal(typeof owner.token, "string");
  });
});

test("a killed owner's lock is kept, and the refusal names the stopped pid and the one file to clear", { timeout: 10_000 }, async () => {
  const { dir, path, lock } = await document();
  await writeFile(path, '["before"]');
  const dead = await crashedHolder(path);
  const bytes = await readFile(lock, "utf8");
  await refused(path, dir, `harvest.json.local-lock was left by a Foliage process that is not running on this computer (pid ${dead}). If nothing else is writing harvest.json, delete harvest.json.local-lock and try again.`);
  assert.equal(await readFile(lock, "utf8"), bytes, "never stolen");
  await unlink(lock); // the recovery the message names
  await withDocumentLocks([path], async () => { writeDocument(path, '["after"]'); });
  assert.equal(await readFile(path, "utf8"), '["after"]');
});

test("a live holder is named by pid and never told to delete anything", async () => {
  const { dir, path } = await document();
  await withDocumentLocks([path], async () => {
    await refused(path, dir, `another Foliage process (pid ${process.pid}) is writing harvest.json. Try again when it finishes.`);
  });
});

test("a live process run by another user still holds its lock: nobody is told to delete it", async () => {
  const { dir, path, lock } = await document();
  // pid 1 always runs. To anyone but root, signal 0 to it is refused (EPERM), not "no such process".
  if (typeof process.getuid === "function" && process.getuid() !== 0) assert.throws(() => process.kill(1, 0), /EPERM/);
  const bytes = `${JSON.stringify({ pid: 1, token: "other-user", host: hostname(), createdAt: new Date().toISOString() })}\n`;
  await writeFile(lock, bytes);
  await refused(path, dir, "another Foliage process (pid 1) is writing harvest.json. Try again when it finishes.");
  assert.equal(await readFile(lock, "utf8"), bytes, "never stolen");
});

test("an older Foliage's lock (no computer recorded) is judged by its pid on this computer", async () => {
  const { dir, path, lock } = await document();
  const dead = await exitedPid();
  await writeFile(lock, `${JSON.stringify({ pid: dead, token: "dead" })}\n`); // the exact shape QA planted
  await refused(path, dir, `harvest.json.local-lock was left by a Foliage process that is not running on this computer (pid ${dead}). If nothing else is writing harvest.json, delete harvest.json.local-lock and try again.`);
  await writeFile(lock, `${JSON.stringify({ pid: process.pid, token: "older" })}\n`);
  await refused(path, dir, `another Foliage process (pid ${process.pid}) is writing harvest.json. Try again when it finishes.`);
  assert.equal(JSON.parse(await readFile(lock, "utf8")).token, "older");
});

test("another computer's lock is never judged by a pid that happens to be free here", async () => {
  const { dir, path, lock } = await document();
  const bytes = `${JSON.stringify({ pid: await exitedPid(), token: "elsewhere", host: "another-machine.invalid", createdAt: new Date().toISOString() })}\n`;
  await writeFile(lock, bytes);
  await refused(path, dir, "harvest.json.local-lock belongs to Foliage on another-machine.invalid. Try again when it finishes there; if it is not running, delete harvest.json.local-lock and try again.");
  assert.equal(await readFile(lock, "utf8"), bytes);
});

test("a lock with no owner on record says to try again first, then which file to clear", async () => {
  const { dir, path, lock } = await document();
  for (const bytes of ["", "damaged lock", "[]", '{"pid":0}']) {
    await writeFile(lock, bytes);
    await refused(path, dir, "another Foliage process may be writing harvest.json. Try again; if this keeps happening and no Foliage process is running, delete harvest.json.local-lock.");
    assert.equal(await readFile(lock, "utf8"), bytes);
  }
});
