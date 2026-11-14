import { testRepository } from "../development/testRepository.mjs";
/** Real commit evidence over paired loopback transport. No inference, save or release is invoked. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssessmentCompanion } from "../../apps/canopy/src/assessmentConnection.ts";
import { loadLeafDocument } from "../../apps/leaf/src/leafDocument.ts";
import { exportLeafletReview } from "../../apps/leaf/src/leafletRevision.ts";

test("selected Leaflet review preserves body references and refuses stale, shared and cross-origin transfers", { timeout: 30_000 }, async () => {
  const cwd = new URL("../..", import.meta.url), dir = await mkdtemp(join(tmpdir(), "foliage-leaflet-handoff-"));
  const history = testRepository();
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: history, encoding: "utf8" }).trim();
  const title = execFileSync("git", ["show", "-s", "--format=%s", sha], { cwd: history, encoding: "utf8" }).trim();
  const prior = execFileSync("git", ["rev-parse", "HEAD^"], { cwd: history, encoding: "utf8" }).trim();
  const priorTitle = execFileSync("git", ["show", "-s", "--format=%s", prior], { cwd: history, encoding: "utf8" }).trim();
  const at = new Date().toISOString(), provenance = ref => ({ source: "git", ref, observedAt: at });
  const leafPath = join(dir, "leaf.json");
  const record = { id: `git:${sha}`, title, tier: "pending", visibility: "private", provenance: provenance(sha), body: [{ text: title, provenance: provenance(sha) }, { text: priorTitle, provenance: provenance(prior) }] };
  const leaf = { id: "selected-artifact-review-regression", subject: "Selected artifact review regression", leaflets: [record] };
  const originalBytes = JSON.stringify(leaf); await writeFile(leafPath, originalBytes);
  const secret = randomBytes(32).toString("hex"), companion = createAssessmentCompanion({ FOLIAGE_COMPANION_KEY: secret });
  let preparations = 0, child;
  const service = createServer(async (req, res) => {
    if (!companion.authorize(req.headers.authorization, req.headers.origin)) { res.writeHead(403).end(); return; }
    const chunks = []; for await (const c of req) chunks.push(c);
    try {
      const action = req.url.split("/").at(-1);
      const result = companion.command(action, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (action === "prepare") preparations++;
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(result));
    } catch { res.writeHead(409).end(); }
  });
  service.listen(0, "127.0.0.1"); await once(service, "listening");
  const address = service.address(); assert.ok(address && typeof address === "object");
  const env = { ...process.env, HOST: "127.0.0.1", PORT: "0", FOLIAGE_LEAF: leafPath, FOLIAGE_WORKFLOW_DIR: join(dir, "workflow"), FOLIAGE_HARVEST: join(dir, "absent-harvest.json"), FOLIAGE_LOCAL_MODEL: "", FOLIAGE_COMPANION_KEY: secret, FOLIAGE_COMPANION_ORIGIN: `http://127.0.0.1:${address.port}` };
  try {
    child = spawn(process.execPath, ["apps/leaf/server.mjs"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const origin = await new Promise((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error("Leaf startup timed out")), 10_000);
      child.stdout.on("data", b => { output += String(b); const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(output); if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Leaf exited before readiness")); });
    });
    const post = (body, from = origin) => fetch(`${origin}/sources/assessment`, { method: "POST", headers: { origin: from }, body, redirect: "manual" });
    const load = await loadLeafDocument(env); assert.ok(load.ok);
    const transfer = exportLeafletReview(load.leaf, record.id);
    const form = new URLSearchParams({ leaflet: record.id, revision: transfer.target.revision, documentRevision: load.source.documentDigest });
    const before = await fetch(`${origin}/leaf/review-export?leaflet=${encodeURIComponent(record.id)}`);
    assert.match(await before.text(), /Connect Scarlet/); assert.equal(preparations, 0);
    const connected = await fetch(`${origin}/sources/api`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ action: "ladybug-connect" }) });
    const status = await connected.json(); assert.equal(status.ladybug.connected, true); assert.equal(status.ladybug.ready, false);
    const preview = await fetch(`${origin}/leaf/review-export?leaflet=${encodeURIComponent(record.id)}`);
    const html = await preview.text(); assert.match(html, /Continue with Scarlet/); assert.ok(html.includes(transfer.target.revision));
    assert.match(preview.headers.get("content-security-policy"), new RegExp(`form-action 'self' http://127\\.0\\.0\\.1:${address.port}`));
    assert.equal(preparations, 0, "opening the exact preview did not prepare or send anything");
    assert.equal((await post(form, "https://foreign.invalid")).status, 403);
    const stale = new URLSearchParams(form); stale.set("revision", `sha256:${"0".repeat(64)}`);
    assert.equal((await post(stale)).status, 409); assert.equal(preparations, 0);
    const response = await post(form); assert.equal(response.status, 303);
    const packet = companion.review(new URL(response.headers.get("location")).pathname.split("/").at(-1));
    assert.ok(packet); assert.deepEqual(packet.target, transfer.target);
    assert.deepEqual(JSON.parse(packet.evidence), JSON.parse(transfer.evidence));
    assert.equal(preparations, 1); assert.equal(await readFile(leafPath, "utf8"), originalBytes);
    await writeFile(leafPath, JSON.stringify({ ...leaf, subject: `${leaf.subject} changed` }));
    assert.equal((await post(form)).status, 409); assert.equal(preparations, 1);
    await writeFile(leafPath, JSON.stringify({ ...leaf, leaflets: [{ ...record, visibility: "public" }] }));
    assert.equal((await post(form)).status, 409); assert.equal(preparations, 1);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
    service.closeAllConnections(); await new Promise((resolve, reject) => service.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
