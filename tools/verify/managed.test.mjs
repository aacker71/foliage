/** Actual sockets and child processes; HTTP payloads are protocol fixtures, not career data. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { controlDirectory, controlPath, request, start, portFree } from "./managed.ts";

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function surface(port, body = "protocol", code) {
  return { port, path: "/", env: () => ({}), cmd: ["-e", code ?? `
    const http = require('node:http');
    const server = http.createServer((req,res) => res.end(${JSON.stringify(body)}));
    server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('[probe] http://127.0.0.1:' + process.env.PORT + '/'));
  `] };
}
async function stopped(root) {
  const socket = controlPath(root, "probe");
  const state = await request(socket, "stop");
  for (let i = 0; i < 80; i++) {
    if (await request(socket, "status") === null) return state;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Supervisor did not stop");
}
async function cleanup(root) {
  await stopped(root);
  rmSync(controlDirectory(root), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

test("different worktrees have distinct controls; canonical aliases share one", () => {
  const root = mkdtempSync(join(tmpdir(), "fol-serve-scope-"));
  try {
    mkdirSync(join(root, "one")); mkdirSync(join(root, "two"));
    symlinkSync(join(root, "one"), join(root, "alias"));
    assert.notEqual(controlPath(join(root, "one"), "probe"), controlPath(join(root, "two"), "probe"));
    assert.equal(controlPath(join(root, "one"), "probe"), controlPath(join(root, "alias"), "probe"));
    assert.throws(() => controlPath(root, "../elsewhere"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("two detached owners coexist, reuse only their own server, and stop independently", async () => {
  const a = mkdtempSync(join(tmpdir(), "fol-serve-a-"));
  const b = mkdtempSync(join(tmpdir(), "fol-serve-b-"));
  try {
    const pa = await freePort();
    const sa = await start(a, "probe", surface(pa, "one"));
    const pb = await freePort();
    const sb = await start(b, "probe", surface(pb, "two"));
    assert.equal(sa.state, "ready"); assert.equal(sb.state, "ready");
    assert.notEqual(sa.pid, sb.pid);
    assert.equal((await start(a, "probe", surface(pa))).pid, sa.pid);
    await assert.rejects(start(a, "probe", surface(pb)), /already uses port/);
    assert.equal(statSync(controlDirectory(a)).mode & 0o777, 0o700);
    assert.equal(statSync(controlPath(a, "probe")).mode & 0o777, 0o600);
    assert.equal(await (await fetch(`http://127.0.0.1:${pa}`)).text(), "one");
    await stopped(a);
    assert.equal(await portFree(pa), true);
    assert.equal(await (await fetch(`http://127.0.0.1:${pb}`)).text(), "two");
  } finally { await cleanup(a); await cleanup(b); }
});

test("an occupied port is refused and the unrelated listener remains alive", async () => {
  const root = mkdtempSync(join(tmpdir(), "fol-serve-foreign-"));
  const foreign = createServer();
  await new Promise(resolve => foreign.listen(0, "127.0.0.1", resolve));
  try {
    const port = foreign.address().port;
    await assert.rejects(start(root, "probe", surface(port)), /occupied/);
    assert.equal(await request(controlPath(root, "probe"), "stop"), null);
    assert.equal(await portFree(port), false);
  } finally { await new Promise(resolve => foreign.close(resolve)); await cleanup(root); }
});

test("failed app boot is not reported as ready and remains inspectable until stopped", async () => {
  const root = mkdtempSync(join(tmpdir(), "fol-serve-failure-"));
  try {
    const state = await start(root, "probe", surface(await freePort(), "", "process.exit(7)"));
    assert.equal(state.state, "failed");
    assert.match(state.detail, /exited 7/);
  } finally { await cleanup(root); }
});

test("concurrent starts cannot produce two children for one worktree surface", async () => {
  const root = mkdtempSync(join(tmpdir(), "fol-serve-race-"));
  try {
    const spec = surface(await freePort());
    const results = await Promise.allSettled([start(root, "probe", spec), start(root, "probe", spec)]);
    const ready = results.filter(r => r.status === "fulfilled" && r.value.state === "ready");
    assert.ok(ready.length > 0, JSON.stringify(results));
    const state = await request(controlPath(root, "probe"), "status");
    assert.equal(state.state, "ready");
    for (const r of ready) assert.equal(r.value.pid, state.pid);
  } finally { await cleanup(root); }
});

test("stale or malformed socket paths are refused, not deleted to make startup succeed", async () => {
  const root = mkdtempSync(join(tmpdir(), "fol-serve-stale-"));
  const dir = controlDirectory(root);
  try {
    mkdirSync(dir, { mode: 0o700 });
    const path = controlPath(root, "probe");
    writeFileSync(path, "not a socket");
    await assert.rejects(start(root, "probe", surface(await freePort())));
    assert.equal(readFileSync(path, "utf8"), "not a socket");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test("serve validates every name and option before taking action", () => {
  for (const args of [["up", "leaf", "unknown"], ["down", "constructor"], ["oops"], ["up", "leaf", "--port-offset", "-1"]]) {
    const result = spawnSync(process.execPath, [new URL("./serve.mjs", import.meta.url).pathname, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
});

test("stop confirms exit even when the child ignores SIGTERM", async () => {
  const root = mkdtempSync(join(tmpdir(), "fol-serve-term-"));
  try {
    const port = await freePort();
    const spec = surface(port);
    spec.cmd[1] = "process.on('SIGTERM', () => {});" + spec.cmd[1];
    assert.equal((await start(root, "probe", spec)).state, "ready");
    await stopped(root);
    assert.equal(await portFree(port), true);
  } finally { await cleanup(root); }
});

test("supervisor refuses a symlink log before starting a child", async () => {
  const root = mkdtempSync(join(tmpdir(), "fol-serve-log-"));
  const dir = controlDirectory(root);
  try {
    mkdirSync(dir, { mode: 0o700 });
    const target = join(root, "untouched.txt");
    writeFileSync(target, "preserve");
    symlinkSync(target, controlPath(root, "probe") + ".log");
    const port = await freePort();
    await assert.rejects(start(root, "probe", surface(port)), /Supervisor exited/);
    assert.equal(await portFree(port), true);
    assert.equal(readFileSync(target, "utf8"), "preserve");
  } finally { await cleanup(root); }
});

test("a child that never acknowledges listening times out without being called ready", async () => {
  const root = mkdtempSync(join(tmpdir(), "fol-serve-noack-"));
  try {
    const state = await start(root, "probe", surface(await freePort(), "", "setInterval(() => {}, 1000)"));
    assert.equal(state.state, "failed");
    assert.match(state.detail, /No listen acknowledgement|App exited/);
    await stopped(root);
  } finally { await cleanup(root); }
});
