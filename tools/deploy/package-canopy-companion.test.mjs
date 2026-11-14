import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { packageCanopyCompanion } from "./package-canopy-companion.mjs";
import { verifyRuntime } from "../install/runtime-install.mjs";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Port lookup failed");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

test("closed companion installs relocatably, selects one existing garden, and keeps hosting disconnected at startup", { timeout: 480_000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), "foliage-canopy-companion-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, "archive"), installed = join(temporary, "installed"), garden = join(temporary, "garden");
  const existing = join(temporary, "existing");
  await mkdir(existing);
  await writeFile(join(existing, "keep.txt"), "existing owner data");
  await assert.rejects(packageCanopyCompanion(existing, { includeWorkingTree: true }), /output already exists/);
  assert.equal(await readFile(join(existing, "keep.txt"), "utf8"), "existing owner data");
  const packaged = await packageCanopyCompanion(output, { includeWorkingTree: true });
  assert.ok(packaged.packages.includes("@foliage/canopy-app"));
  const manifest = await verifyRuntime(output);
  assert.equal(manifest.kind, "foliage-canopy-companion");
  assert.ok(manifest.files.some(file => file.path === "apps/canopy/manage-server.mjs"));
  assert.ok(manifest.files.some(file => file.path === "apps/canopy/public/workspace.js"));
  assert.ok(manifest.files.some(file => file.path === "canopy.mjs"));
  assert.ok(manifest.files.every(file => !/(?:^|\/)\.env|connection\.json|leaf\.json$/.test(file.path)));

  const install = spawnSync(process.execPath, [join(output, "install.mjs"), installed], { encoding: "utf8", timeout: 300_000 });
  assert.equal(install.error, undefined, install.error?.message ?? install.stderr);
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stdout, /No source, account or hosted service was contacted/);
  await verifyRuntime(installed);
  await mkdir(garden);
  const command = join(installed, "canopy.mjs");
  const run = (...args) => spawnSync(process.execPath, [command, ...args], { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 10_000 });
  assert.equal(run("--help").status, 0);
  for (const args of [
    ["--garden", garden, "--hosted-origin", "http://canopy.invalid"],
    ["--garden", garden, "--hosted-origin", "https://canopy.invalid/path"],
    ["--garden", join(temporary, "missing"), "--hosted-origin", "https://canopy.invalid"],
    ["--garden", garden, "--hosted-origin", "https://canopy.invalid", "--garden", garden],
  ]) {
    const invalid = run(...args);
    assert.equal(invalid.status, 2, invalid.stderr);
  }
  const managePort = await freePort(), publicPort = await freePort();
  assert.notEqual(managePort, publicPort);
  const child = spawn(process.execPath, [command, "--garden", garden, "--hosted-origin", "https://canopy.invalid",
    "--manage-port", String(managePort), "--public-port", String(publicPort)],
  { detached: true, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ }
    if (child.exitCode === null && child.signalCode === null) await once(child, "close");
  });
  let response;
  for (let attempt = 0; attempt < 45; attempt++) {
    try { response = await fetch(`http://127.0.0.1:${managePort}/hosted`, { signal: AbortSignal.timeout(1000) }); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  assert.ok(response, "relocated manager did not start");
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Connect Photosynthesis/);
  assert.match(page, /https:\/\/canopy\.invalid/);
  await assert.rejects(readFile(join(garden, "hosted/connection.json")), { code: "ENOENT" });
  await assert.rejects(readFile(join(garden, "hosted/status.json")), { code: "ENOENT" });
  await verifyRuntime(installed);
});
