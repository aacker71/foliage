/**
 * `foliage grow` when it cannot take the garden's document lock: QA #23, the command-line half.
 *
 * Real temporary repository, the real `foliage.mjs`, real `intake.mjs` and `harvest.mjs`
 * subprocesses. Two ways the lock is refused, and each must reach a person as ONE plain line
 * naming the file (never the folder) and what to do, with a non-zero exit and nothing written:
 *
 *   - the garden folder is read-only (`chmod -R a-w`): this printed
 *     `Error: cannot lock …/leaf.json: EACCES …` and a stack from intake.mjs.
 *   - two grows at once, the second while the first is mid-write: the loser printed
 *     `Error: local document busy: …/leaf.json.local-lock …` and a stack.
 *
 * The busy sentence itself belongs to the lock module (`packages/leaf/src/localFiles.ts`), so
 * this checks its shape — one line, the file, "retry"/"try again", no folder — not its words.
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, constants, lstat, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const roots: string[] = [];
after(async () => { for (const path of roots) await rm(path, { recursive: true, force: true }); });

/** The developer's own garden settings never reach these runs. */
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("FOLIAGE_"))),
  NO_COLOR: "1",
};

async function foliage(args: readonly string[]) {
  try {
    const out = await exec(process.execPath, [cli, ...args], { env, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, stdout: out.stdout, stderr: out.stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** A real repository and a garden one ordinary grow has already filled. Its folder name has a
 * space, as gardens in iCloud Drive or "My Drive" do: a path cut at the first space leaks it. */
async function grownGarden() {
  const dir = await mkdtemp(join(tmpdir(), "foliage-grow-refusal-")); roots.push(dir);
  const repo = join(dir, "repo"); const garden = join(dir, "My Garden");
  await exec("git", ["init", "-q", "--initial-branch=main", repo]);
  for (const [key, value] of [["user.name", "Refusal harness"], ["user.email", "refusal@foliage.invalid"]] as const) {
    await exec("git", ["-C", repo, "config", key, value]);
  }
  for (const i of [1, 2]) {
    await writeFile(join(repo, "work.txt"), `refusal regression input ${i}\n`);
    await exec("git", ["-C", repo, "add", "work.txt"]);
    await exec("git", ["-C", repo, "commit", "-qm", `feat: refusal regression input ${i}`, "--no-gpg-sign"]);
  }
  const grow = ["grow", "--repo", repo, "--subject", "Refusal harness", "--identity", "refusal@foliage.invalid", "--garden", garden];
  const first = await foliage(grow);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  return { garden, grow, leaf: join(garden, "leaf.json"), harvest: join(garden, "harvest.json") };
}

/** Exactly one line on stderr, no stack, no error code, and no folder: the file by its name. */
function oneLine(stderr: string, garden: string): string {
  const lines = stderr.split("\n").filter((line) => line.trim() !== "");
  assert.equal(lines.length, 1, `expected one line on stderr, got:\n${stderr}`);
  assert.doesNotMatch(stderr, /^\s+at /m, "no stack trace");
  assert.doesNotMatch(stderr, /ELOCALBUSY|Node\.js v/);
  assert.ok(!stderr.includes(garden), `no folder path in:\n${stderr}`);
  for (const folder of [basename(garden), basename(dirname(garden))]) {
    assert.ok(!stderr.includes(folder), `no folder name "${folder}" in:\n${stderr}`);
  }
  assert.doesNotMatch(stderr, /(^|\s|')\/[^\s']+\//, `no absolute path in:\n${stderr}`);
  return lines[0]!;
}

async function locksIn(garden: string): Promise<string[]> {
  return (await readdir(garden)).filter((name) => name.endsWith(".local-lock"));
}

test(
  "grow on a read-only garden prints one line naming leaf.json and the fix, and writes nothing",
  { timeout: 120_000, skip: process.getuid?.() === 0 ? "root writes through folder permissions" : false },
  async () => {
    const { garden, grow, leaf, harvest } = await grownGarden();
    const before = { leaf: await readFile(leaf, "utf8"), harvest: await readFile(harvest, "utf8") };
    const names = await readdir(garden);
    const folders = new Set<string>();
    for (const name of names) if ((await lstat(join(garden, name))).isDirectory()) folders.add(name);
    // `chmod -R a-w <garden>`, the QA repro (one level is all a grown garden holds).
    for (const name of names) await chmod(join(garden, name), folders.has(name) ? 0o555 : 0o444);
    await chmod(garden, 0o555);
    let refused;
    try {
      refused = await foliage(grow);
    } finally {
      await chmod(garden, 0o700);
      for (const name of names) await chmod(join(garden, name), folders.has(name) ? 0o700 : 0o600);
    }
    assert.notEqual(refused.code, 0, refused.stdout + refused.stderr);
    assert.equal(
      oneLine(refused.stderr, garden),
      "intake: cannot write leaf.json · the garden folder is read-only · fix its permissions",
    );
    assert.equal(await readFile(leaf, "utf8"), before.leaf, "leaf.json is untouched");
    assert.equal(await readFile(harvest, "utf8"), before.harvest, "harvest.json is untouched");
    assert.deepEqual(await readdir(garden), names, "nothing was added to the garden");

    // Permissions fixed, the same command works: the line's remedy is the real one.
    const fixed = await foliage(grow);
    assert.equal(fixed.code, 0, fixed.stdout + fixed.stderr);
  },
);

test(
  "two grows at once: exactly one succeeds, the other prints one busy line and exits non-zero",
  { timeout: 120_000 },
  async () => {
    const { garden, grow, leaf, harvest } = await grownGarden();
    const leafBytes = await readFile(leaf);

    // Grow A is held mid-write, deterministically: leaf.json becomes a FIFO carrying the same
    // bytes, so A blocks reading it INSIDE its lock until this test feeds it. That is exactly a
    // slow grow holding leaf.json's lock while a second one starts — with no timing window.
    await rm(leaf);
    await exec("mkfifo", ["-m", "600", leaf]);
    const a = spawn(process.execPath, [cli, ...grow], { env, stdio: ["ignore", "pipe", "pipe"] });
    let aOut = "";
    a.stdout.on("data", (chunk) => { aOut += String(chunk); });
    a.stderr.on("data", (chunk) => { aOut += String(chunk); });
    const aExit = once(a, "exit");
    let aRunning = true;
    void aExit.then(() => { aRunning = false; });

    let b;
    try {
      const lock = `${leaf}.local-lock`;
      for (const deadline = Date.now() + 60_000; !existsSync(lock); await sleep(20)) {
        assert.ok(aRunning, `grow A exited before taking the lock:\n${aOut}`);
        assert.ok(Date.now() < deadline, `grow A never took the lock:\n${aOut}`);
      }
      // Grow B runs start to finish while A holds the lock.
      b = await foliage(grow);
    } finally {
      // Release A: a non-blocking open succeeds only once A is reading, so this never hangs on
      // a grow that already exited.
      for (const deadline = Date.now() + 60_000; aRunning && Date.now() < deadline; await sleep(20)) {
        const fifo = await open(leaf, constants.O_WRONLY | constants.O_NONBLOCK).catch(() => null);
        if (fifo === null) continue;
        try { await fifo.write(leafBytes); } finally { await fifo.close(); }
        break;
      }
      const timer = setTimeout(() => a.kill("SIGKILL"), 60_000);
      await aExit;
      clearTimeout(timer);
    }

    assert.equal(a.exitCode, 0, `grow A should finish once released:\n${aOut}`);
    assert.notEqual(b.code, 0, b.stdout + b.stderr);
    const line = oneLine(b.stderr, garden);
    assert.match(line, /^intake: /);
    assert.match(line, /busy/);
    assert.match(line, /leaf\.json/);
    assert.match(line, /retry|try again/i);

    // The winner's documents are whole and nothing is left locked.
    assert.ok((await lstat(leaf)).isFile(), "leaf.json is a regular file again");
    assert.ok(Array.isArray(JSON.parse(await readFile(leaf, "utf8")).leaflets));
    assert.ok(Array.isArray(JSON.parse(await readFile(harvest, "utf8")).candidates));
    assert.deepEqual(await locksIn(garden), []);
  },
);
