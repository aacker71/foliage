/**
 * QA #7 (d)/(e): what a later run does with a supervisor an earlier run left behind.
 *
 * (d) A supervisor whose app died answered `failed` forever, and every later `pnpm verify`
 *     adopted it and printed BOOT-FAILED with the old run's log — measured: a second run
 *     returned instantly with the first run's "App exited SIGTERM" and the supervisor still alive.
 * (e) verify printed "already running" for surfaces it had just booted, because `ensure` hard-coded
 *     `started: false` on every path.
 *
 * Real sockets and child processes; HTTP bodies are protocol fixtures, not career data.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { controlDirectory, controlPath, request, start } from "./managed.ts";
import { servingVerdict } from "./serving.mjs";
import { ensure } from "./verify.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A child that announces itself as `[label]` once listening, or runs `code` instead. */
function surface(port, label, body, code) {
  return { port, path: "/", env: () => ({}), cmd: ["-e", code ?? `
    const http = require('node:http');
    http.createServer((req, res) => res.end(${JSON.stringify(body)}))
      .listen(Number(process.env.PORT), '127.0.0.1', () => console.log('[${label}] http://127.0.0.1:' + process.env.PORT + '/'));
  `] };
}

async function stop(root, name) {
  const socket = controlPath(root, name);
  await request(socket, "stop").catch(() => null);
  for (let i = 0; i < 80 && (await request(socket, "status").catch(() => null)) !== null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("a supervisor whose app died is replaced by the next start, not reported again", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "fol-life-dead-"));
  t.after(async () => { await stop(root, "probe"); rmSync(controlDirectory(root), { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });
  const port = await freePort();
  const dead = await start(root, "probe", surface(port, "probe", "", "process.exit(7)"));
  assert.equal(dead.state, "failed");
  assert.match(dead.detail, /exited 7/);

  const again = await start(root, "probe", surface(port, "probe", "fresh"));
  assert.equal(again.state, "ready", `the earlier run's failure was reported again: ${again.detail}`);
  assert.equal(again.started, true);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "fresh");
});

test("a dead supervisor does not pin its old port: the next start may choose another", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "fol-life-port-"));
  t.after(async () => { await stop(root, "probe"); rmSync(controlDirectory(root), { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });
  const old = await start(root, "probe", surface(await freePort(), "probe", "", "process.exit(3)"));
  assert.equal(old.state, "failed");
  const port = await freePort();
  const moved = await start(root, "probe", surface(port, "probe", "moved"));
  assert.equal(moved.state, "ready", moved.detail);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "moved");
});

test("a live supervisor is still adopted, never replaced, and says it was not started here", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "fol-life-live-"));
  t.after(async () => { await stop(root, "probe"); rmSync(controlDirectory(root), { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });
  const spec = surface(await freePort(), "probe", "live");
  const first = await start(root, "probe", spec);
  assert.equal(first.state, "ready", first.detail);
  assert.equal(first.started, true);
  const second = await start(root, "probe", spec);
  assert.equal(second.state, "ready");
  assert.equal(second.started, false);
  assert.equal(second.pid, first.pid);
});

test("verify reports a surface it just booted as started, and a second run as already running", async (t) => {
  // `ensure` owns this checkout's own control directory, so the name is one no real row uses,
  // and only that one supervisor (and its log) is removed afterwards.
  const name = `verify-started-${process.pid}`;
  t.after(async () => {
    await stop(REPO, name);
    rmSync(`${controlPath(REPO, name)}.log`, { force: true });
  });
  const spec = surface(await freePort(), name, "booted");
  const first = await ensure(name, spec, {}, process.env);
  assert.equal(first.res?.status, 200, first.problem);
  assert.equal(first.started, true);
  assert.match(servingVerdict(first.res.status, first.started).message, /started by verify/);

  const second = await ensure(name, spec, {}, process.env);
  assert.equal(second.res?.status, 200, second.problem);
  assert.equal(second.started, false);
  assert.match(servingVerdict(second.res.status, second.started).message, /already running/);
});
