/** A real isolated browser build; no portfolio records or publication data are fabricated. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkPortfolioLeafBundle } from "./portfolio-leaf-bundle.ts";

test("shared portfolio build detects a missing renderer, a changed DOM contract and damaged bytes", async t => {
  const source = fileURLToPath(new URL("../", import.meta.url));
  const isolated = await mkdtemp(join(tmpdir(), "foliage-portfolio-renderer-"));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  await mkdir(join(isolated, "src"));
  const files = ["package.json", "build-portfolio-leaf.mjs", "src/portfolio-leaf.mjs", "src/portfolio-leaf.css", "src/portfolio-leaf-bundle.ts"];
  await Promise.all(files.map(file => copyFile(join(source, file), join(isolated, file))));
  await symlink(join(source, "node_modules"), join(isolated, "node_modules"), "dir");
  async function cause(expected: string) {
    const result = await checkPortfolioLeafBundle(isolated);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.cause, expected, result.reason);
  }
  await cause("bundle-missing");
  const built = spawnSync(process.execPath, ["build-portfolio-leaf.mjs"], { cwd: isolated, encoding: "utf8" });
  assert.equal(built.status, 0, `${built.error?.message ?? ""}${built.stdout}${built.stderr}`);
  const ready = await checkPortfolioLeafBundle(isolated);
  assert.deepEqual(ready, { ok: true, path: join(isolated, "build/portfolio-leaf.bundle.js") });

  const renderer = join(isolated, "src/portfolio-leaf.mjs");
  const original = await readFile(renderer, "utf8");
  const changed = original.replace("[data-portfolio-order-note]", "[data-changed-order-note]");
  assert.notEqual(original, changed, "the test changes a real renderer/page DOM binding");
  await writeFile(renderer, changed);
  await cause("bundle-stale");
  await writeFile(renderer, original);
  assert.equal((await checkPortfolioLeafBundle(isolated)).ok, true);

  const artifact = join(isolated, "build/portfolio-leaf.bundle.js");
  const bytes = await readFile(artifact);
  await writeFile(artifact, Buffer.concat([bytes, Buffer.from("\n/* changed bytes */")]));
  await cause("bundle-damaged");
  await rm(artifact);
  await cause("bundle-missing");
});
