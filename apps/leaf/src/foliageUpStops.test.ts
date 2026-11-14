/**
 * `foliage up` STOPS ITS OWN SERVER — the launcher, signalled by pid, not the terminal.
 *
 * A terminal's Ctrl-C reaches the whole process group, so the server child always heard it. A
 * process manager, `kill -TERM <pid>`, or a script holding `$!` signals the LAUNCHER alone — and
 * the launcher used to die on the spot, leaving `apps/leaf/server.mjs` re-parented to pid 1,
 * still listening, still holding the garden's workflow lock. The next `foliage up` then said the
 * port was taken. The launcher was also silent on the way out, so a crash and a kill read the
 * same in a log.
 *
 * Each case drives the real `foliage.mjs up` on a scratch garden and signals exactly what a
 * person or a process manager would. The server's pid is read from the garden's workflow lock,
 * which the server writes before it prints its address — the same file a second `up` checks.
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const BOOT_DEADLINE_MS = 15_000;
/** The launcher waits 5 s before forcing the server; this leaves room for a loaded machine. */
const STOP_DEADLINE_MS = 9_000;

const gardens: string[] = [];
after(async () => {
  await Promise.all(gardens.map((d) => rm(d, { recursive: true, force: true })));
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (addr === null || typeof addr === "string") {
        probe.close(() => reject(new Error("no port from the OS")));
        return;
      }
      const { port } = addr;
      probe.close(() => resolve(port));
    });
  });
}

/** True when nothing holds the port: the same probe `foliage up` runs before it starts. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function within(ms: number, check: () => Promise<boolean> | boolean): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > deadline) return false;
    await pause(50);
  }
}

interface Launched {
  readonly launcher: ChildProcess;
  readonly port: number;
  readonly garden: string;
  readonly stdout: () => string;
  readonly stderr: () => string;
  /** Resolves with the launcher's own exit, however it ends. */
  readonly ended: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

async function launch(env: Readonly<Record<string, string>> = {}): Promise<Launched> {
  const garden = await mkdtemp(join(tmpdir(), "foliage-up-stops-"));
  gardens.push(garden);
  const port = await freePort();
  // Ambient garden and listener settings would point this run somewhere other than its scratch
  // garden and loopback; none of them is this test's to inherit.
  const {
    FOLIAGE_GARDEN: _garden,
    FOLIAGE_LEAF: _leaf,
    FOLIAGE_HARVEST: _harvest,
    FOLIAGE_SOURCE_REPO: _repo,
    HOST: _host,
    PORT: _port,
    ...inherited
  } = process.env;
  // `detached` gives the launcher its own process group, so cleanup can reach an orphaned server
  // with one group kill. The signals under test go to the launcher's pid alone.
  const launcher = spawn(process.execPath, [FOLIAGE_CLI, "up", "--port", String(port), "--garden", garden], {
    env: { ...inherited, NO_COLOR: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let stdout = "";
  let stderr = "";
  launcher.stdout?.on("data", (b: Buffer) => { stdout += b.toString(); });
  launcher.stderr?.on("data", (b: Buffer) => { stderr += b.toString(); });
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    launcher.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { launcher, port, garden, stdout: () => stdout, stderr: () => stderr, ended };
}

/** Waits for the server's address line, then reads its pid off the workflow lock. */
async function serverPid(run: Launched): Promise<number> {
  const listening = `[leaf] http://127.0.0.1:${run.port}/\n`;
  const lock = join(run.garden, "workflow", "owner.lock");
  const up = await within(BOOT_DEADLINE_MS, () => run.stdout().includes(listening) && existsSync(lock));
  assert.ok(up, `foliage up did not start in ${BOOT_DEADLINE_MS} ms\n${run.stdout()}${run.stderr()}`);
  const pid = Number(await readFile(lock, "utf8"));
  assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== run.launcher.pid, `lock names the server, not the launcher: ${pid}`);
  return pid;
}

function cleanUp(run: Launched, pid: number | undefined): void {
  for (const target of [run.launcher.pid === undefined ? undefined : -run.launcher.pid, pid]) {
    if (target === undefined) continue;
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // Already gone, which is what every passing case leaves behind.
    }
  }
}

/**
 * The launcher alone is signalled (a process manager), or its whole group (a terminal's Ctrl-C).
 * Either way the server must be gone, the port free, the workflow lock released by a clean close,
 * and the launcher must say it stopped.
 */
async function stopsCleanly(signal: NodeJS.Signals, target: "launcher" | "group"): Promise<void> {
  const run = await launch();
  let pid: number | undefined;
  try {
    pid = await serverPid(run);
    const server = pid;
    const launcherPid = run.launcher.pid;
    assert.ok(launcherPid !== undefined);
    process.kill(target === "launcher" ? launcherPid : -launcherPid, signal);

    const gone = await within(STOP_DEADLINE_MS, () => !pidIsAlive(server));
    assert.ok(gone, `server pid ${server} still running ${STOP_DEADLINE_MS} ms after ${signal} to the ${target}`);
    assert.ok(await within(STOP_DEADLINE_MS, () => portIsFree(run.port)), `port ${run.port} still taken after ${signal}`);
    const { code, signal: endedBy } = await run.ended;
    assert.equal(
      existsSync(join(run.garden, "workflow", "owner.lock")),
      false,
      "the server closed its workflow and released the lock, rather than being killed holding it",
    );
    assert.match(run.stdout(), new RegExp(`^foliage: stopped \\(${signal}\\)$`, "m"));
    assert.equal(run.stderr().includes("foliage: server"), false, `a requested stop is not reported as a crash:\n${run.stderr()}`);
    assert.deepEqual({ code, signal: endedBy }, { code: 0, signal: null }, "the launcher exits with the server's own code");
  } finally {
    cleanUp(run, pid);
  }
}

test("foliage up: SIGTERM to the launcher pid stops the server, frees the port and the workflow lock, and says stopped", { timeout: 40_000 }, () =>
  stopsCleanly("SIGTERM", "launcher"));

test("foliage up: SIGINT to the launcher pid stops the server, frees the port and the workflow lock, and says stopped", { timeout: 40_000 }, () =>
  stopsCleanly("SIGINT", "launcher"));

// The server has no SIGHUP handler of its own: passed on as-is, it would die holding the lock.
test("foliage up: SIGHUP to the launcher pid stops the server, frees the port and the workflow lock, and says stopped", { timeout: 40_000 }, () =>
  stopsCleanly("SIGHUP", "launcher"));

// A terminal's Ctrl-C reaches the server directly AND through the launcher; it still closes once.
test("foliage up: SIGINT to the process group (a terminal's Ctrl-C) still stops cleanly and says stopped", { timeout: 40_000 }, () =>
  stopsCleanly("SIGINT", "group"));

test("foliage up: a server killed out from under the launcher is named, and the launcher does not exit 0", { timeout: 40_000 }, async () => {
  const run = await launch();
  let pid: number | undefined;
  try {
    pid = await serverPid(run);
    process.kill(pid, "SIGKILL");
    const { code, signal } = await run.ended;
    assert.match(run.stderr(), /^foliage: server stopped by signal SIGKILL$/m);
    assert.doesNotMatch(run.stdout(), /foliage: stopped/);
    assert.deepEqual({ code, signal }, { code: 128 + 9, signal: null });
  } finally {
    cleanUp(run, pid);
  }
});

test("foliage up: a server that fails on its own is named with its exit code", { timeout: 40_000 }, async () => {
  // 203.0.113.1 is TEST-NET-3 (RFC 5737): never a local address, so the server's listen fails and
  // it exits 1 by itself — the launcher sent it nothing.
  const run = await launch({ HOST: "203.0.113.1" });
  try {
    const { code, signal } = await run.ended;
    assert.match(run.stderr(), /^foliage: server exited with code 1$/m);
    assert.doesNotMatch(run.stdout(), /foliage: stopped/);
    assert.deepEqual({ code, signal }, { code: 1, signal: null });
  } finally {
    cleanUp(run, undefined);
  }
});
