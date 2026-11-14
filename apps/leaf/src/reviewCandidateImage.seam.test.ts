/** Candidate-scoped private Review media over the real Leaf HTTP boundary. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { putImage, readMedia } from "./mediaStore.ts";

const at = "2026-10-14T00:00:00.000Z";
const pngFiles = [
  new URL("../../www/public/product/presentation-source.png", import.meta.url),
  new URL("../../www/public/product/presentation-mobile.png", import.meta.url),
];

async function fixture(t: import("node:test").TestContext, separateMediaRoot = false) {
  const root = await mkdtemp(join(tmpdir(), "foliage-review-image-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recordRoot = separateMediaRoot ? join(root, "record") : root;
  if (separateMediaRoot) await mkdir(recordRoot);
  const leafPath = join(recordRoot, "leaf.json");
  const harvestPath = join(recordRoot, "harvest.json");
  const mediaRoot = join(root, "media");
  const subject = "Selected designer";
  const leafId = "selected-designer";
  const ids = ["frame/first", "frame/second"];
  const images: { ref: string; bytes: Buffer; dimensions: { known: true; width: number; height: number } }[] = [];
  for (const url of pngFiles) {
    const bytes = await readFile(url);
    const result = await putImage({ root: mediaRoot, sourcePath: fileURLToPath(url),
      sourceDigest: createHash("sha256").update(bytes).digest("hex"), sourceFormat: "png", sipsRuns: false });
    if (!result.ok) throw new Error(result.detail);
    const stored = await readMedia(mediaRoot, result.ref);
    if (!stored.ok) throw new Error(stored.detail);
    images.push({ ref: result.ref, bytes: stored.bytes,
      dimensions: { known: true, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } });
  }
  await writeFile(leafPath, JSON.stringify({ id: leafId, subject, leaflets: [] }));
  const candidates = ids.map((id, index) => ({
    id, title: `Selected ${pngFiles[index]!.pathname.split("/").at(-1)}`, extractor: "owner-selected-design-image",
    draftedAt: at, review: index === 0 ? { state: "candidate" } : { state: "approved", by: subject, at },
    evidence: [{ source: "owner-selected:design-image", ref: images[index]!.ref, observedAt: at }],
    media: [{ ref: images[index]!.ref, media: { mediaType: "image/png", dimensions: images[index]!.dimensions } }],
  }));
  const harvest = { subject, leafId, candidates };
  await writeFile(harvestPath, JSON.stringify(harvest));
  return { root, leafPath, harvestPath, mediaRoot, subject, leafId, ids, images, harvest };
}

async function withServer(f: Awaited<ReturnType<typeof fixture>>, run: (origin: string) => Promise<void>) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", FOLIAGE_LEAF: f.leafPath,
      FOLIAGE_HARVEST: f.harvestPath, FOLIAGE_MEDIA: f.mediaRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Leaf server did not start: ${stderr}`)), 20_000);
      child.stdout.on("data", chunk => {
        stdout += String(chunk);
        const found = stdout.match(/\[leaf\] (http:\/\/127\.0\.0\.1:\d+)\/review/);
        if (found) { clearTimeout(timeout); resolve(found[1]!); }
      });
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Leaf server exited ${String(code)}: ${stderr}`)); });
    });
    await run(origin);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise<void>(resolve => child.once("exit", resolve));
  }
}

const imagePath = (candidate: string, ref: string) =>
  `/review/candidate-image?candidate=${encodeURIComponent(candidate)}&ref=${encodeURIComponent(ref)}`;

test("Review serves one candidate's stored image under current Leaf and Harvest binding", async t => {
  const f = await fixture(t);
  await withServer(f, async origin => {
    const firstPath = imagePath(f.ids[0]!, f.images[0]!.ref);
    const first = await fetch(origin + firstPath);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("content-type"), "image/png");
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.equal(first.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), f.images[0]!.bytes);
    const head = await fetch(origin + firstPath, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(f.images[0]!.bytes.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const review = await (await fetch(origin + "/review?focus=" + encodeURIComponent(f.ids[0]!))).text();
    const imageHref = firstPath.replace("&", "&amp;");
    const candidate = review.slice(review.indexOf(`id="candidate-${f.ids[0]}"`));
    assert.ok(candidate.includes(`<img src="${imageHref}"`), "Review shows this candidate's image");
    assert.ok(candidate.indexOf(`<img src="${imageHref}"`) < candidate.indexOf('<form class="review-form"'),
      "the selected image appears before the approval decision");
    const approved = await fetch(origin + imagePath(f.ids[1]!, f.images[1]!.ref));
    assert.equal(approved.status, 200, "a previously approved candidate remains inspectable");

    for (const path of [
      imagePath(f.ids[0]!, f.images[1]!.ref),
      imagePath("absent", f.images[0]!.ref),
      imagePath(f.ids[0]!, `sha256:${"0".repeat(64)}`),
      `/review/candidate-image?candidate=${encodeURIComponent(f.ids[0]!)}&candidate=${encodeURIComponent(f.ids[1]!)}&ref=${encodeURIComponent(f.images[0]!.ref)}`,
      `/review/media/${encodeURIComponent(f.images[0]!.ref)}`,
    ]) assert.equal((await fetch(origin + path)).status, 404, `refused ${path}`);

    await writeFile(f.harvestPath, JSON.stringify({ ...f.harvest, leafId: "another-owner" }));
    assert.equal((await fetch(origin + firstPath)).status, 404, "another Leaf's queue cannot serve this image");
    await writeFile(f.harvestPath, JSON.stringify({ ...f.harvest, subject: "Another owner" }));
    assert.equal((await fetch(origin + firstPath)).status, 404, "subject mismatch also refuses");
    await writeFile(f.harvestPath, JSON.stringify({ ...f.harvest, candidates: [f.harvest.candidates[1]] }));
    assert.equal((await fetch(origin + firstPath)).status, 404, "removed candidate cannot serve its former image");
  });
});

test("Review reads the configured media store outside the Leaf directory only for its candidate", async t => {
  const f = await fixture(t, true);
  const ref = f.images[0]!.ref;
  assert.equal((await readMedia(join(f.root, "record", "media"), ref)).ok, false,
    "the default Leaf-adjacent media store has no copy of the image");
  await withServer(f, async origin => {
    const selected = await fetch(origin + imagePath(f.ids[0]!, ref));
    assert.equal(selected.status, 200, "FOLIAGE_MEDIA selects the separate store");
    assert.deepEqual(Buffer.from(await selected.arrayBuffer()), f.images[0]!.bytes);
    assert.equal((await fetch(origin + imagePath(f.ids[1]!, ref))).status, 404,
      "a valid but different candidate cannot open this image");
    assert.equal((await fetch(origin + imagePath("missing-candidate", ref))).status, 404);
  });
});
