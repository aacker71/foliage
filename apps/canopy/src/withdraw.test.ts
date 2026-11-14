import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { documentDigest } from "@foliage/canopy";

const WITHDRAW = fileURLToPath(new URL("../withdraw.mjs", import.meta.url));
const roots: string[] = [];

after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "foliage-withdraw-"));
  roots.push(value);
  return value;
}

function run(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [WITHDRAW, ...args], (error, stdout, stderr) => {
      if (error !== null && typeof error.code !== "number") return reject(error);
      resolve({ code: error === null ? 0 : Number(error.code), stdout, stderr });
    });
  });
}

test("withdraw removes exactly the named artifact only after typed confirmation", async () => {
  const dir = await root();
  const target = join(dir, "test-leaf.published.json");
  await writeFile(target, "publication bytes", "utf8");

  const refused = await run(["--from", dir, "--id", "test-leaf", "--confirm", "other-leaf"]);
  assert.notEqual(refused.code, 0);
  assert.equal(await readFile(target, "utf8"), "publication bytes");

  const withdrawn = await run(["--from", dir, "--id", "test-leaf", "--confirm", "test-leaf"]);
  assert.equal(withdrawn.code, 0);
  await assert.rejects(readFile(target), { code: "ENOENT" });
});

test("withdraw refuses when the public bytes changed after review", async () => {
  const dir = await root();
  const target = join(dir, "test-leaf.published.json");
  await writeFile(target, "reviewed bytes", "utf8");
  const reviewedDigest = documentDigest(await readFile(target));
  await writeFile(target, "different public bytes", "utf8");

  const refused = await run([
    "--from", dir,
    "--id", "test-leaf",
    "--expect-digest", reviewedDigest,
    "--confirm", "test-leaf",
  ]);

  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /public artifact changed after review/);
  assert.equal(await readFile(target, "utf8"), "different public bytes");
});
