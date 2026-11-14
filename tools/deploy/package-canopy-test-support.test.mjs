/** Test support never ships: the hosted Canopy artifact carries runtime code only. */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { packageCanopy } from "./package-canopy.mjs";

test("the renderer protocol commit walk stays out of the hosted Canopy artifact", { timeout: 120_000 }, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "foliage-runtime-test-support-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const runtime = join(temporary, "packaged");
  await packageCanopy(runtime);
  const files = (await readdir(join(runtime, "apps"), { recursive: true, withFileTypes: true }))
    .map(entry => relative(runtime, join(entry.parentPath, entry.name)))
    .filter(path => !path.includes("/node_modules/"));
  assert.ok(files.includes("apps/canopy/server.mjs"), "the artifact under inspection is the Canopy runtime");
  assert.deepEqual(files.filter(path => /(?:^|\/)protocolCommits\.|(?:^|\/)test-support(?:\/|$)/.test(path)), [],
    "test-only helpers that read local Git history are not runtime code");
});
