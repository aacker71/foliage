import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { isCapturedMp4, putCapturedVideo, readVideo, videoRef, videoRootFor } from "./videoStore.ts";

const execFileAsync = promisify(execFile);
const invalidContainer = Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]);
const posterRef = `sha256:${"a".repeat(64)}`;

test("private video store binds exact H.264 bytes to a poster and duration", async t => {
  const garden = await mkdtemp(join(tmpdir(), "foliage-video-store-"));
  try {
    const clip = join(garden, "protocol.mp4");
    try {
      await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=32x32:d=1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip]);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") { t.skip("ffmpeg is unavailable"); return; }
      throw error;
    }
    const bytes = await readFile(clip);
    assert.equal(isCapturedMp4(bytes), true);
    const root = videoRootFor(join(garden, "leaf.json"));
    const stored = await putCapturedVideo(root, bytes, { posterRef, durationSeconds: 2 });
    assert.equal(stored.ref, videoRef(bytes));
    const held = await readVideo(root, stored.ref);
    assert.ok(held.ok);
    assert.deepEqual(held.bytes, bytes);
    assert.deepEqual(held.metadata, { posterRef, durationSeconds: 2 });
    await assert.rejects(putCapturedVideo(root, bytes, { posterRef: `sha256:${"b".repeat(64)}`, durationSeconds: 2 }), /metadata differs/);
    assert.match(await readFile(join(root, ".gitignore"), "utf8"), /^# Private/);

    const path = join(root, "sha256", stored.ref.slice(7, 9), stored.ref.slice(7), "video.mp4");
    await writeFile(path, Buffer.from("changed"));
    const corrupted = await readVideo(root, stored.ref);
    assert.equal(corrupted.ok, false);
  } finally {
    await rm(garden, { recursive: true, force: true });
  }
});

test("video store refuses an unbounded, unidentifiable or wrongly bound clip", async () => {
  const garden = await mkdtemp(join(tmpdir(), "foliage-video-reject-"));
  try {
    await assert.rejects(putCapturedVideo(garden, Buffer.from("not a clip"), { posterRef, durationSeconds: 2 }), /MP4/);
    assert.equal(isCapturedMp4(invalidContainer), false);
    await assert.rejects(putCapturedVideo(garden, invalidContainer, { posterRef: "not-a-digest", durationSeconds: 2 }), /H.264/);
    const invalid = await readVideo(garden, "../../secrets");
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.cause, "invalid-ref");
  } finally { await rm(garden, { recursive: true, force: true }); }
});
