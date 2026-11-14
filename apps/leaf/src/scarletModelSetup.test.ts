/** Protocol fixture: real Leaf server and a local Ollama-tags stub; no real model or work data. */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverInstalledModels, modelFileFor, readSavedModel, saveSelectedModel } from "./scarletModelSetup.ts";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const servers: Server[] = [];
after(async () => { for (const server of servers) await new Promise<void>((done) => server.close(() => done())); });

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  assert.ok(address !== null && typeof address === "object");
  return new Promise<number>((done) => probe.close(() => done(address.port)));
}

async function tagsStub(): Promise<{ baseUrl: string; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "observed:model" }] }));
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return { baseUrl: `http://127.0.0.1:${address.port}`, seen };
}

async function startLeaf(dir: string, env: Readonly<Record<string, string>> = {}): Promise<{ base: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const leaf = join(dir, "leaf.json");
  const child: ChildProcess = spawn(process.execPath, [SERVER], { env: {
    ...process.env, FOLIAGE_LEAF: leaf, FOLIAGE_HARVEST: join(dir, "harvest.json"),
    FOLIAGE_LOCAL_MODEL: "", FOLIAGE_LOCAL_MODEL_BASE_URL: "", PORT: String(port), HOST: "127.0.0.1", ...env,
  }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (Date.now() >= deadline || child.exitCode !== null) throw new Error(`Leaf failed to start: ${stderr}`);
    try {
      const response = await fetch(`${base}/scarlet/setup`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { await new Promise((done) => setTimeout(done, 50)); }
  }
  return { base, stop: async () => {
    child.kill("SIGKILL");
    if (child.exitCode === null) await new Promise<void>((done) => child.once("exit", () => done()));
  } };
}

async function post(base: string, values: Record<string, string>, origin = base): Promise<Response> {
  return fetch(`${base}/scarlet/setup`, { method: "POST", redirect: "manual", headers: {
    origin, "content-type": "application/x-www-form-urlencoded",
  }, body: new URLSearchParams(values).toString(), signal: AbortSignal.timeout(7_000) });
}

test("saved model belongs to the selected garden, is private, and malformed/symlink settings fail closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scarlet-model-store-"));
  try {
    assert.equal(modelFileFor({}), null);
    const file = modelFileFor({ FOLIAGE_LEAF: join(dir, "leaf.json") });
    assert.equal(file, join(dir, "scarlet-model.json"));
    assert.deepEqual(await readSavedModel(file), { kind: "none" });
    assert.deepEqual(await saveSelectedModel(file, "observed:model"), { ok: true });
    assert.deepEqual(await readSavedModel(file), { kind: "selected", name: "observed:model" });
    assert.equal((await stat(file!)).mode & 0o777, 0o600);
    await writeFile(file!, '{"model":42}');
    assert.equal((await readSavedModel(file)).kind, "unavailable");
    await rm(file!);
    await symlink(join(dir, "missing"), file!);
    assert.equal((await readSavedModel(file)).kind, "unavailable");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("explicit discovery stays on loopback and rejects non-loopback configuration", async () => {
  const stub = await tagsStub();
  const found = await discoverInstalledModels({ FOLIAGE_LOCAL_MODEL_BASE_URL: stub.baseUrl });
  assert.deepEqual(found, { ok: true, names: ["observed:model"] });
  assert.deepEqual(stub.seen, ["GET /api/tags"]);
  const refused = await discoverInstalledModels({ FOLIAGE_LOCAL_MODEL_BASE_URL: "https://example.com" });
  assert.equal(refused.ok, false);
  assert.deepEqual(stub.seen, ["GET /api/tags"], "no new network request to the allowed runtime");
});

test("first-run GET has no provider call; owner discovers, selects, and keeps the choice across restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scarlet-model-seam-"));
  const stub = await tagsStub();
  await writeFile(join(dir, "leaf.json"), JSON.stringify({ id: "setup-fixture", subject: "Protocol fixture", leaflets: [] }));
  try {
    const first = await startLeaf(dir, { FOLIAGE_LOCAL_MODEL_BASE_URL: stub.baseUrl });
    try {
      const initial = await (await fetch(`${first.base}/scarlet`)).text();
      assert.match(initial, /No local model/);
      assert.match(initial, /href="\/scarlet\/setup"/);
      assert.doesNotMatch(initial, /<form class="scarlet-form"/);
      const setup = await (await fetch(`${first.base}/scarlet/setup`)).text();
      assert.match(setup, /No model selected/);
      assert.match(setup, /<a class="scarlet-setup-back" href="\/scarlet">Back to Photosynthesis<\/a>/);
      assert.match(setup, /Find installed models/);
      assert.doesNotMatch(setup, /Refresh models/);
      assert.deepEqual(stub.seen, [], "page reads make no provider request");
      const denied = await post(first.base, { action: "discover" }, "https://other.example");
      assert.equal(denied.status, 403);
      assert.deepEqual(stub.seen, [], "cross-site action cannot probe the runtime");
      const discovered = await post(first.base, { action: "discover" });
      assert.equal(discovered.status, 200);
      const discoveredPage = await discovered.text();
      assert.match(discoveredPage, /observed:model/);
      assert.ok(discoveredPage.indexOf("Installed models") < discoveredPage.indexOf("Refresh models"), "model selection leads, refresh follows");
      assert.match(discoveredPage, /class="[^"]*fol-button-ghost[^"]*"[^>]*>Refresh models<\/button>/);
      assert.doesNotMatch(discoveredPage, /Find installed models/);
      assert.deepEqual(stub.seen, ["GET /api/tags"]);
      const bad = await post(first.base, { action: "select", model: "invented:model" });
      assert.equal(bad.status, 409);
      assert.equal((await readSavedModel(join(dir, "scarlet-model.json"))).kind, "none");
      const selected = await post(first.base, { action: "select", model: "observed:model" });
      assert.equal(selected.status, 303);
      assert.equal(selected.headers.get("location"), "/scarlet");
      assert.deepEqual(JSON.parse(await readFile(join(dir, "scarlet-model.json"), "utf8")), { model: "observed:model" });
      const ready = await (await fetch(`${first.base}/scarlet`)).text();
      assert.match(ready, /<form class="scarlet-form"/);
      assert.doesNotMatch(ready, /data-refusal="no-model-declared"/);
    } finally { await first.stop(); }
    const second = await startLeaf(dir, { FOLIAGE_LOCAL_MODEL_BASE_URL: stub.baseUrl });
    try {
      const ready = await (await fetch(`${second.base}/scarlet`)).text();
      assert.match(ready, /<form class="scarlet-form"/);
      assert.match(ready, /observed:model/);
      assert.deepEqual(stub.seen, ["GET /api/tags", "GET /api/tags", "GET /api/tags"], "restart does not probe Ollama");
    } finally { await second.stop(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an externally selected session model cannot be silently replaced in the setup UI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scarlet-model-external-"));
  await writeFile(join(dir, "leaf.json"), JSON.stringify({ id: "setup-fixture", subject: "Protocol fixture", leaflets: [] }));
  const running = await startLeaf(dir, { FOLIAGE_LOCAL_MODEL: "external:model" });
  try {
    const setup = await (await fetch(`${running.base}/scarlet/setup`)).text();
    assert.match(setup, /Managed by this session/);
    assert.doesNotMatch(setup, /Find installed models/);
    assert.equal((await post(running.base, { action: "discover" })).status, 409);
    assert.equal((await readSavedModel(join(dir, "scarlet-model.json"))).kind, "none");
  } finally { await running.stop(); await rm(dir, { recursive: true, force: true }); }
});
