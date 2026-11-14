import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { acquirePublicationLock } from "./publicationLock.mjs";

const roots: string[] = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function target(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foliage-publication-lock-"));
  roots.push(root);
  return join(root, "test-leaf.published.json");
}

test("a live owner serializes publication changes and release restores access", async () => {
  const path = await target();
  const release = await acquirePublicationLock(path);
  const owner = JSON.parse(await readFile(`${path}.lock`, "utf8")) as { pid: number; token: string };
  assert.equal(owner.pid, process.pid);
  assert.match(owner.token, /^[0-9a-f-]{36}$/);
  assert.equal((await readdir(join(path, ".."))).some((name) => name.includes(".lock.owner.")), false);
  await assert.rejects(acquirePublicationLock(path), /already being changed by process/);
  await release();
  await assert.rejects(stat(`${path}.lock`), { code: "ENOENT" });

  const releaseAgain = await acquirePublicationLock(path);
  await releaseAgain();
});

test("a lock left by a process that exited fails closed until an operator removes it", async () => {
  const path = await target();
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const deadPid = child.pid;
  assert.notEqual(deadPid, undefined);
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await writeFile(`${path}.lock`, `${JSON.stringify({ pid: deadPid, token: "old" })}\n`, "utf8");

  await assert.rejects(acquirePublicationLock(path), /inspect and remove that stale lock/);
  const owner = JSON.parse(await readFile(`${path}.lock`, "utf8")) as { pid: number; token: string };
  assert.equal(owner.pid, deadPid);
  assert.equal(owner.token, "old");

  await rm(`${path}.lock`);
  const release = await acquirePublicationLock(path);
  await release();
});
