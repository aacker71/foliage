import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const FOLIAGE = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const SOURCE = dirname(FOLIAGE);
const roots: string[] = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function shadowLauncher(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foliage-canopy-shadow-"));
  roots.push(root);
  await mkdir(join(root, "apps"));
  await mkdir(join(root, "packages"));
  await copyFile(FOLIAGE, join(root, "foliage.mjs"));
  for (const path of ["apps/leaf", "packages/leaf", "packages/photosynthesis"]) {
    await symlink(join(SOURCE, path), join(root, path));
  }
  return root;
}

test("the open local package explains that Canopy is a separate service", async () => {
  const root = await shadowLauncher();
  const result = spawnSync(process.execPath, [join(root, "foliage.mjs"), "canopy"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Canopy is not included in this open local package/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|ENOENT/);
});

test("the canopy launcher builds missing workspace assets before serving", { timeout: 30_000 }, async (t) => {
  if (spawnSync("bun", ["--version"], { stdio: "ignore" }).status !== 0) return t.skip("Bun is unavailable");
  const root = await shadowLauncher();
  const sourceApp = join(SOURCE, "apps/canopy");
  const app = join(root, "apps/canopy");
  await mkdir(join(app, "public"), { recursive: true });
  await mkdir(join(app, "workspace-ui"));
  for (const name of ["server.mjs", "manage-server.mjs"]) await copyFile(join(sourceApp, name), join(app, name));
  for (const name of ["build.ts", "app.tsx", "styles.css"]) await copyFile(join(sourceApp, "workspace-ui", name), join(app, "workspace-ui", name));
  await symlink(join(sourceApp, "src"), join(app, "src"));
  await symlink(join(sourceApp, "node_modules"), join(app, "node_modules"));
  const garden = join(root, "garden");
  await mkdir(garden);
  const managePort = await freePort();
  let publicPort = await freePort();
  while (publicPort === managePort) publicPort = await freePort();
  const child = spawn(process.execPath, [join(root, "foliage.mjs"), "canopy", "--manage-port", String(managePort), "--public-port", String(publicPort)], {
    env: { ...process.env, FOLIAGE_GARDEN: garden }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  let exited = false;
  const exit = new Promise<void>((resolve) => child.once("exit", () => { exited = true; resolve(); }));
  try {
    const deadline = Date.now() + 15_000;
    let response: Response | undefined;
    while (Date.now() < deadline) {
      if (exited) break;
      try { response = await fetch(`http://127.0.0.1:${managePort}/workspace`, { signal: AbortSignal.timeout(2_000) }); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    assert.notEqual(response, undefined, `launcher did not reach workspace:\n${output}`);
    assert.equal(response?.status, 200);
    assert.match(await response?.text() ?? "", /src="\/workspace\.js"/);
    assert.equal((await fetch(`http://127.0.0.1:${managePort}/workspace.js`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${managePort}/workspace.css`)).status, 200);
  } finally {
    if (child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
    if (!exited) await exit;
  }
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") return reject(new Error("no port"));
      probe.close(() => resolve(address.port));
    });
  });
}

test("the canopy launcher reaches its recovery UI even when the local leaf is malformed", { timeout: 30_000 }, async () => {
  const garden = await mkdtemp(join(tmpdir(), "foliage-canopy-launcher-"));
  roots.push(garden);
  await writeFile(join(garden, "leaf.json"), "{broken", "utf8");
  const managePort = await freePort();
  let publicPort = await freePort();
  while (publicPort === managePort) publicPort = await freePort();
  const child = spawn(process.execPath, [FOLIAGE, "canopy", "--manage-port", String(managePort), "--public-port", String(publicPort)], {
    env: { ...process.env, FOLIAGE_GARDEN: garden },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  let exited = false;
  const exit = new Promise<void>((resolve) => child.once("exit", () => { exited = true; resolve(); }));

  try {
    const deadline = Date.now() + 15_000;
    let response: Response | undefined;
    while (Date.now() < deadline) {
      if (exited) break;
      try {
        response = await fetch(`http://127.0.0.1:${managePort}/`, { signal: AbortSignal.timeout(2_000) });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.notEqual(response, undefined, `launcher did not reach the manager:\n${output}`);
    assert.equal(response?.status, 200);
    assert.match(await response?.text() ?? "", /No local leaf is ready/);
    assert.match(output, new RegExp(`MANAGE\\s+http://127\\.0\\.0\\.1:${managePort}/`));
  } finally {
    if (child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
    if (!exited) await exit;
  }
});
