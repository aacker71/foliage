/** Selected real repository image bytes through the private Sources and Review seam. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewSubjectDigest } from "@foliage/photosynthesis";
import { createSourceConnections } from "./sourceConnections.ts";
import { readMedia } from "./mediaStore.ts";
import type { SourceImagePreview } from "./sourceCatalog.ts";

const png = () => readFile(new URL("../../www/public/product/presentation-source.png", import.meta.url));
const jpeg = () => readFile(new URL("../../canopy/public/specimen-sheet-day.jpg", import.meta.url));
// These are local URL-validation fixtures, never network destinations.
const shot = (path: string) => `https://dribbble.com${path}`;
async function setup(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "foliage-design-image-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const leafPath = join(root, "leaf.json"), harvestPath = join(root, "harvest.json"), mediaRoot = join(root, "media");
  await writeFile(leafPath, JSON.stringify({ id: "selected-designer", subject: "Selected designer", leaflets: [] }));
  const source = createSourceConnections({ FOLIAGE_LEAF: leafPath, FOLIAGE_HARVEST: harvestPath, FOLIAGE_MEDIA: mediaRoot });
  return { root, leafPath, harvestPath, mediaRoot, source };
}
async function preview(source: Awaited<ReturnType<typeof setup>>["source"], bytes: Buffer, changes: Record<string, unknown> = {}) {
  return (await source.previewDesignImage({
    name: "selected.png", base64: bytes.toString("base64"), project: "Portfolio redesign",
    title: "Interface composition", origin: "figma-export", referenceUrl: null, ...changes,
  })).imagePreview;
}

test("selected PNG previews stripped pixels, then enters only private Review on Add; replay preserves decision", async t => {
  const f = await setup(t), image = await png(), originalLeaf = await readFile(f.leafPath);
  const selected = await preview(f.source, image, { referenceUrl: shot("/shots/12345-interface") });
  const clean = await f.source.imagePreview(selected.id);
  assert.equal(clean?.type, "image/png");
  assert.ok(clean?.bytes.length);
  await assert.rejects(readFile(f.harvestPath), /ENOENT/);
  await assert.rejects(readFile(join(f.mediaRoot, ".gitignore")), /ENOENT/, "preview stores no image");
  await assert.rejects(f.source.command({ action: "import", preview: selected.id }), /Preview the image first/);
  const added = await f.source.command({ action: "import", preview: selected.id, confirm: true }) as { imported: number; inspectUrl: null };
  assert.deepEqual(added, { imported: 1, unchanged: 0, reviewUrl: "/review", inspectUrl: null, detail: "Added to review" });
  assert.equal(await f.source.imagePreview(selected.id), null, "confirmed preview bytes are released");
  const harvest = JSON.parse(await readFile(f.harvestPath, "utf8"));
  assert.equal(harvest.candidates.length, 1);
  const candidate = harvest.candidates[0];
  assert.equal(candidate.title, "Portfolio redesign · Interface composition");
  assert.equal(candidate.review.state, "candidate");
  assert.equal(candidate.extractor, "owner-selected-design-image");
  assert.equal(candidate.evidence[0].source, "owner-selected:figma-export");
  assert.equal(candidate.evidence[0].ref, `sha256:${createHash("sha256").update(image).digest("hex")}`);
  assert.equal(candidate.evidence[0].excerpt, undefined, "owner context is not verbatim image text");
  assert.deepEqual(candidate.evidence[1], { source: "owner-reference:dribbble", ref: shot("/shots/12345-interface"), observedAt: candidate.draftedAt });
  const held = await readMedia(f.mediaRoot, candidate.media[0].ref);
  assert.equal(held.ok, true);
  if (held.ok) assert.deepEqual(held.bytes, clean?.bytes);
  assert.deepEqual(await readFile(f.leafPath), originalLeaf, "no Leaf or public view is changed");
  candidate.review = { state: "approved", by: "Selected designer", at: new Date().toISOString(), subjectDigest: reviewSubjectDigest(candidate) };
  await writeFile(f.harvestPath, JSON.stringify(harvest, null, 2) + "\n");
  const reviewed = await readFile(f.harvestPath, "utf8");
  const again = await preview(f.source, image, { referenceUrl: shot("/shots/12345-interface") });
  const replay = await f.source.command({ action: "import", preview: again.id, confirm: true }) as { imported: number; unchanged: number };
  assert.deepEqual([replay.imported, replay.unchanged], [0, 1]);
  assert.equal(await readFile(f.harvestPath, "utf8"), reviewed);
});

test("selected JPEG uses the same metadata-stripped media store and no provider authentication claim", async t => {
  const f = await setup(t), image = await jpeg();
  const selected = await preview(f.source, image, { name: "selected.jpg", origin: "local-image" });
  assert.equal((await f.source.imagePreview(selected.id))?.type, "image/jpeg");
  await f.source.command({ action: "import", preview: selected.id, confirm: true });
  const candidate = JSON.parse(await readFile(f.harvestPath, "utf8")).candidates[0];
  assert.equal(candidate.evidence[0].source, "owner-selected:design-image");
  assert.equal(candidate.media[0].media.mediaType, "image/jpeg");
  assert.equal((await readMedia(f.mediaRoot, candidate.media[0].ref)).ok, true);
});

test("invalid bytes, forged origin, wrong account and cancellation refuse without a queue or store", async t => {
  const f = await setup(t), image = await png();
  for (const changes of [
    { name: "selected.svg" }, { name: "selected.jpg" }, { base64: "%%%%" },
    { origin: "authenticated-figma" }, { title: "99/100" },
    { referenceUrl: shot("/shots/123?secret=1") },
    { referenceUrl: shot(":444/shots/123") },
    { referenceUrl: "https://example.com/shots/123" },
    { project: "P".repeat(120), title: "T".repeat(100) },
  ]) await assert.rejects(preview(f.source, image, changes));
  await assert.rejects(readFile(f.harvestPath), /ENOENT/);
  const selected = await preview(f.source, image);
  await f.source.command({ action: "cancel", preview: selected.id });
  assert.equal(await f.source.imagePreview(selected.id), null);
  await assert.rejects(f.source.command({ action: "import", preview: selected.id, confirm: true }), /Preview the file first/);
  const next = await preview(f.source, image);
  await writeFile(f.leafPath, JSON.stringify({ id: "another-designer", subject: "Another designer", leaflets: [] }));
  assert.equal(await f.source.imagePreview(next.id), null);
  await assert.rejects(f.source.command({ action: "import", preview: next.id, confirm: true }), /private record changed/);
  await assert.rejects(readFile(f.harvestPath), /ENOENT/);
  await assert.rejects(readFile(join(f.mediaRoot, ".gitignore")), /ENOENT/);
});

/** Valid ancillary PNG metadata: different source ref, identical pixels after strip. */
function withTextMetadata(source: Buffer): Buffer {
  const iend = source.length - 12;
  assert.equal(source.toString("ascii", iend + 4, iend + 8), "IEND");
  const body = Buffer.concat([Buffer.from("tEXt", "ascii"), Buffer.from("Comment\0owner-added metadata", "latin1")]);
  const length = Buffer.alloc(4); length.writeUInt32BE(body.length - 4);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  const check = Buffer.alloc(4); check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([source.subarray(0, iend), length, body, check, source.subarray(iend)]);
}

test("metadata-only source change gets a distinct evidence ref even when the stored pixels match", async t => {
  const f = await setup(t), original = await png(), changed = withTextMetadata(original);
  const first = await preview(f.source, original);
  const firstClean = (await f.source.imagePreview(first.id))!.bytes;
  await f.source.command({ action: "import", preview: first.id, confirm: true });
  const second = await preview(f.source, changed);
  assert.deepEqual((await f.source.imagePreview(second.id))!.bytes, firstClean);
  await f.source.command({ action: "import", preview: second.id, confirm: true });
  const candidates = JSON.parse(await readFile(f.harvestPath, "utf8")).candidates;
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].id, candidates[1].id);
  assert.notEqual(candidates[0].media[0].ref, candidates[1].media[0].ref);
});

test("a different title for the same image refuses replay without changing an approved decision", async t => {
  const f = await setup(t), bytes = await png();
  const first = await preview(f.source, bytes);
  await f.source.command({ action: "import", preview: first.id, confirm: true });
  const harvest = JSON.parse(await readFile(f.harvestPath, "utf8"));
  harvest.candidates[0].review = { state: "approved", by: "Selected designer", at: new Date().toISOString(),
    subjectDigest: reviewSubjectDigest(harvest.candidates[0]) };
  await writeFile(f.harvestPath, JSON.stringify(harvest, null, 2) + "\n");
  const decided = await readFile(f.harvestPath, "utf8");
  const changed = await preview(f.source, bytes, { title: "A different account" });
  await assert.rejects(f.source.command({ action: "import", preview: changed.id, confirm: true }), /design image already has different Review details/);
  assert.equal(await readFile(f.harvestPath, "utf8"), decided);
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") { probe.close(); reject(new Error("No TCP port")); return; }
      probe.close(() => resolve(address.port));
    });
  });
}

test("the dedicated image route is same-origin, bounded and serves only an opaque no-store preview", async t => {
  const f = await setup(t), bytes = await png(), port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), FOLIAGE_LEAF: f.leafPath,
      FOLIAGE_HARVEST: f.harvestPath, FOLIAGE_MEDIA: f.mediaRoot }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk); });
  t.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise<void>(resolve => child.once("exit", () => resolve()));
  });
  let ready = false;
  for (let tries = 0; tries < 200; tries++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${stderr}`);
    try { await fetch(origin + "/", { signal: AbortSignal.timeout(1000) }); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.ok(ready, `Server did not start: ${stderr}`);
  const body = JSON.stringify({ name: "selected.png", base64: bytes.toString("base64"),
    project: "Portfolio redesign", title: "Interface composition", origin: "figma-export", referenceUrl: null });
  const rejected = await fetch(origin + "/sources/image-preview", { method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example", "sec-fetch-site": "cross-site" }, body });
  assert.equal(rejected.status, 403);
  const tooLarge = await fetch(origin + "/sources/image-preview", { method: "POST",
    headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" },
    body: "x".repeat(6 * 1024 * 1024 + 1) });
  assert.equal(tooLarge.status, 413);
  const accepted = await fetch(origin + "/sources/image-preview", { method: "POST",
    headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" }, body });
  assert.equal(accepted.status, 200);
  const view = (await accepted.json() as { imagePreview: SourceImagePreview }).imagePreview;
  const found = await fetch(origin + view.imageUrl);
  assert.equal(found.status, 200);
  assert.equal(found.headers.get("content-type"), "image/png");
  assert.equal(found.headers.get("cache-control"), "no-store");
  assert.equal(found.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.ok((await found.arrayBuffer()).byteLength > 0);
  const guessed = await fetch(origin + "/sources/image-preview/00000000-0000-0000-0000-000000000000");
  assert.equal(guessed.status, 404);
  await assert.rejects(readFile(f.harvestPath), /ENOENT/);
});
