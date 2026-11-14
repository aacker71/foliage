/** `foliage grow` over a real temporary repository with a document lock in its way. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withDocumentLocks } from "@foliage/leaf/local-files";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const localFiles = new URL("../../../packages/leaf/src/localFiles.ts", import.meta.url).href;
const roots: string[] = [];
after(async () => { for (const path of roots) await rm(path, { recursive: true, force: true }); });

async function foliage(args: readonly string[]) {
  try {
    const out = await exec(process.execPath, [cli, ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, stdout: out.stdout, stderr: out.stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** A real crash: a child takes the lock through the product code, then is killed holding it. */
async function crashedHolder(path: string): Promise<number> {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {withDocumentLocks} from ${JSON.stringify(localFiles)}; await withDocumentLocks([process.argv[1]], async () => { console.log('locked'); await new Promise(() => setInterval(() => {}, 1000)); });`, path], { stdio: ["ignore", "pipe", "inherit"] });
  await once(child.stdout, "data");
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  return child.pid!;
}

/**
 * The refusal is exactly this one plain line from the named step (so it carries no folder), and
 * stderr holds no stack and no error code. grow's own "intake completed at …" line after a
 * harvest refusal still prints the garden path; that line predates this check and is not covered.
 */
function oneLine(stderr: string, line: string) {
  assert.ok(stderr.split("\n").includes(line), `expected the line:\n${line}\nin:\n${stderr}`);
  assert.doesNotMatch(stderr, /^\s+at /m, "no stack trace");
  assert.doesNotMatch(stderr, /ELOCALBUSY/);
}

test("grow names a crashed lock's stopped owner and the file to clear, and a live holder, in one line each", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-grow-lock-")); roots.push(dir);
  const repo = join(dir, "repo"); const garden = join(dir, "garden");
  await exec("git", ["init", "-q", "--initial-branch=main", repo]);
  for (const [key, value] of [["user.name", "Lock harness"], ["user.email", "lock@foliage.invalid"]] as const) await exec("git", ["-C", repo, "config", key, value]);
  for (const i of [1, 2]) {
    await writeFile(join(repo, "work.txt"), `lock regression input ${i}\n`);
    await exec("git", ["-C", repo, "add", "work.txt"]);
    await exec("git", ["-C", repo, "commit", "-qm", `feat: lock regression input ${i}`, "--no-gpg-sign"]);
  }
  const grow = ["grow", "--repo", repo, "--subject", "Lock harness", "--identity", "lock@foliage.invalid", "--garden", garden];
  const first = await foliage(grow);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const harvest = join(garden, "harvest.json"); const leaf = join(garden, "leaf.json");

  const dead = await crashedHolder(harvest);
  const before = await readFile(harvest, "utf8");
  const stuck = await foliage(grow);
  assert.notEqual(stuck.code, 0);
  oneLine(stuck.stderr, `harvest: local document busy: harvest.json.local-lock was left by a Foliage process that is not running on this computer (pid ${dead}). If nothing else is writing harvest.json, delete harvest.json.local-lock and try again.`);
  assert.equal(await readFile(harvest, "utf8"), before, "the harvest is untouched");
  await unlink(`${harvest}.local-lock`); // the recovery the line names
  const recovered = await foliage(grow);
  assert.equal(recovered.code, 0, recovered.stdout + recovered.stderr);

  for (const [path, step, name] of [[leaf, "intake", "leaf.json"], [harvest, "harvest", "harvest.json"]] as const) {
    await withDocumentLocks([path], async () => {
      const busy = await foliage(grow);
      assert.notEqual(busy.code, 0);
      oneLine(busy.stderr, `${step}: local document busy: another Foliage process (pid ${process.pid}) is writing ${name}. Try again when it finishes.`);
    });
  }
});
