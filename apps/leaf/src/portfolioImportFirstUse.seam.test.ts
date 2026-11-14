/** First-use HTTP path over a literal repository document, never an invented work result. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const source = { title: "Foliage project overview", source: "context/project-overview.md" };

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") { probe.close(); reject(new Error("No local port")); return; }
      probe.close(() => resolve(address.port));
    });
  });
}

test("an absent Leaf can preview and add an imported portfolio only to private review", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-import-first-use-"));
  const leafPath = join(dir, "leaf.json"), harvestPath = join(dir, "harvest.json");
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [SERVER], {
    cwd: REPO,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", FOLIAGE_LEAF: leafPath, FOLIAGE_HARVEST: harvestPath, FOLIAGE_WORKFLOW_DIR: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += String(chunk); });
  const get = (path: string) => fetch(origin + path, { signal: AbortSignal.timeout(4000) });
  const post = (fields: Record<string, string>, requestOrigin = origin) => fetch(origin + "/leaf/import", {
    method: "POST", headers: { origin: requestOrigin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields), signal: AbortSignal.timeout(4000),
  });
  const absent = async (path: string) => assert.rejects(readFile(path), { code: "ENOENT" });
  try {
    const deadline = Date.now() + 10_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`Leaf server exited: ${stderr}`);
      try { if ((await get("/leaf/import")).status === 200) break; } catch { /* booting */ }
      if (Date.now() > deadline) throw new Error(`Leaf server did not start: ${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await absent(leafPath); await absent(harvestPath);

    const text = await readFile(join(REPO, source.source), "utf8");
    const author = execFileSync("git", ["-C", REPO, "log", "-1", "--format=%an"], { encoding: "utf8" }).trim();
    assert.ok(author);
    const input = { ...source, text };
    const previewResponse = await post({ ...input, action: "preview" });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.text();
    assert.match(preview, /Create record and add to review/);
    assert.match(preview, /<label[^>]*for="import-subject"[^>]*>Your name<\/label>/);
    const digest = preview.match(/name="digest" value="([a-f0-9]{64})"/)?.[1];
    assert.ok(digest);
    await absent(leafPath); await absent(harvestPath);

    const submission = { ...input, action: "import", digest, leafId: "", subject: author };
    assert.equal((await post(submission, "https://foreign.invalid")).status, 403);
    assert.equal((await post({ ...submission, text: text + "\n" })).status, 409);
    assert.equal((await post({ ...submission, subject: "" })).status, 409);
    await absent(leafPath); await absent(harvestPath);

    await writeFile(harvestPath, "not json");
    const unavailable = await post(submission);
    assert.equal(unavailable.status, 409);
    assert.match(await unavailable.text(), /Private review is unavailable/);
    await absent(leafPath);
    assert.equal(await readFile(harvestPath, "utf8"), "not json");
    await unlink(harvestPath);

    const added = await post(submission);
    assert.equal(added.status, 200, await added.clone().text());
    assert.match(await added.text(), /Added to review/);
    const leaf = JSON.parse(await readFile(leafPath, "utf8"));
    assert.equal(leaf.subject, author);
    assert.deepEqual(leaf.leaflets, []);
    const harvest = JSON.parse(await readFile(harvestPath, "utf8"));
    assert.ok(harvest.candidates.length > 0);
    assert.ok(harvest.candidates.every((candidate: { review: { state: string } }) => candidate.review.state === "candidate"));
    assert.equal((await get("/review")).status, 200);

    assert.equal((await post(submission)).status, 409, "a stale first-use preview cannot silently bind an existing Leaf");
    const current = await post({ ...input, action: "preview" });
    assert.equal(current.status, 200);
    const currentHtml = await current.text();
    assert.doesNotMatch(currentHtml, /Create record and add to review/);
    assert.match(currentHtml, /Add to private review/);
    const currentId = currentHtml.match(/name="leafId" value="([^"]+)"/)?.[1];
    assert.equal(currentId, leaf.id);
    assert.ok(currentId);
    const harvestBeforeReplay = await readFile(harvestPath, "utf8");
    const replay = await post({ ...submission, leafId: currentId });
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.equal(await readFile(harvestPath, "utf8"), harvestBeforeReplay);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>(resolve => child.once("exit", () => resolve()));
    }
    await rm(dir, { recursive: true, force: true });
  }
});
