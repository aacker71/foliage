/** Test-only receipt bytes exercise private reads; they are not work evidence or demo media. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureDemoCandidateId, captureRootFor, listCaptures, readCaptureArtifact, readCaptureReceipt } from "./captureLibrary.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", "base64");
const mp4Header = Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,2,0,105,115,111,109,109,112,52,50]);
const sha = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("private capture library serves only named, digest-matching local artifacts", async t => {
  const garden = await mkdtemp(join(tmpdir(), "foliage-capture-library-"));
  t.after(() => rm(garden, { recursive: true, force: true }));
  const root = captureRootFor(join(garden, "leaf.json"));
  const id = "capture-Ab12Cd";
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "screenshot.png"), png);
  await writeFile(join(dir, "demo.mp4"), mp4Header);
  const receipt = {
    schemaVersion: 1, id,
    source: { requestedUrl: "http://127.0.0.1:4444/", finalUrl: "http://127.0.0.1:4444/", origin: "http://127.0.0.1:4444", pageTitle: "Test-only page" },
    capture: { startedAt: "2026-10-07T00:00:00Z", completedAt: "2026-10-07T00:00:02Z", requestedDurationSeconds: 2, width: 320, height: 240 },
    artifacts: { screenshot: { file: "screenshot.png", mimeType: "image/png", bytes: png.length, sha256: sha(png) }, video: { file: "demo.mp4", mimeType: "video/mp4", bytes: mp4Header.length, sha256: sha(mp4Header) } },
    privacy: { localOnly: true },
  };
  await writeFile(join(dir, "receipt.json"), JSON.stringify(receipt));
  assert.equal((await listCaptures(root)).length, 1);
  const read = await readCaptureReceipt(root, id);
  assert.ok(read);
  assert.match(captureDemoCandidateId(read), /^demo:sha256:[0-9a-f]{64}$/);
  assert.equal((await readCaptureArtifact(root, id, "screenshot"))?.bytes.equals(png), true);
  assert.equal((await readCaptureArtifact(root, id, "video"))?.mimeType, "video/mp4");
  assert.equal(await readCaptureArtifact(root, "../../leaf.json", "video"), null);
  await writeFile(join(dir, "demo.mp4"), Buffer.from("changed"));
  assert.equal(await readCaptureArtifact(root, id, "video"), null, "a changed demo is not served under the old receipt");
  const forged = { ...receipt, source: { ...receipt.source, finalUrl: "http://127.0.0.1:5555/" } };
  await writeFile(join(dir, "receipt.json"), JSON.stringify(forged));
  assert.equal(await readCaptureReceipt(root, id), null, "a cross-origin final page is refused");
  await writeFile(join(dir, "receipt.json"), JSON.stringify({ ...receipt, capture: { ...receipt.capture, width: "320px" } }));
  assert.equal(await readCaptureReceipt(root, id), null, "unmeasured or malformed viewport data is refused");
  assert.equal((await readFile(join(dir, "screenshot.png"))).equals(png), true, "failed reads do not change captured bytes");
});
