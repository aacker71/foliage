/** Build the real renderer in an isolated directory; never alter a running demo's bundle. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCompoundBundle, compoundInputDigest, stampCompoundBundle } from "./compoundBundle.ts";

const SOURCE = fileURLToPath(new URL("../", import.meta.url));

test("real renderer build detects the stale DOM contract that previously left the canvas blank", async () => {
  const root = await mkdtemp(join(tmpdir(), "foliage-compound-build-"));
  try {
    await mkdir(join(root, "public"));
    await mkdir(join(root, "src"));
    for (const name of ["public/compound-leaf.mjs", "public/compound-leaf.css", "src/compoundPage.ts", "src/compoundLayout.ts", "src/compoundBundle.ts", "build-compound.mjs", "package.json"]) {
      await copyFile(join(SOURCE, name), join(root, name));
    }
    await symlink(join(SOURCE, "node_modules"), join(root, "node_modules"), "dir");
    const missing = await checkCompoundBundle(root);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.cause, "bundle-missing");

    const build = spawnSync(process.execPath, [join(root, "build-compound.mjs")], { cwd: root, encoding: "utf8" });
    assert.equal(build.status, 0, `${build.error?.message ?? ""}\n${build.stdout}\n${build.stderr}`);
    const current = await checkCompoundBundle(root);
    assert.equal(current.ok, true, JSON.stringify(current));
    const bundlePath = join(root, "public/compound-leaf.bundle.js");
    const built = await readFile(bundlePath);

    const pagePath = join(root, "src/compoundPage.ts");
    const page = await readFile(pagePath, "utf8");
    await writeFile(pagePath, page.replace('id="cx-search"', 'id="cx-search-replaced"'));
    // ui.input uses an object property, so retain a real changed DOM contract in either form.
    if ((await readFile(pagePath, "utf8")) === page) await writeFile(pagePath, page.replace('id: "cx-search"', 'id: "cx-search-replaced"'));
    assert.notEqual(await readFile(pagePath, "utf8"), page, "the regression must actually change the page's search control ID");
    const stale = await checkCompoundBundle(root);
    assert.equal(stale.ok, false);
    if (!stale.ok) {
      assert.equal(stale.cause, "bundle-stale");
      assert.match(stale.remedy, /explore:build/);
    }
    await assert.rejects(stampCompoundBundle(current.ok ? current.sourceDigest : "", root), /inputs changed/);
    await writeFile(pagePath, page);
    assert.equal((await checkCompoundBundle(root)).ok, true);

    const rendererPath = join(root, "public/compound-leaf.mjs");
    const renderer = await readFile(rendererPath);
    await writeFile(rendererPath, Buffer.concat([renderer, Buffer.from("\n// changed renderer revision\n")]));
    const changedRenderer = await checkCompoundBundle(root);
    assert.equal(changedRenderer.ok, false);
    if (!changedRenderer.ok) assert.equal(changedRenderer.cause, "bundle-stale");
    await writeFile(rendererPath, renderer);

    const layoutPath = join(root, "src/compoundLayout.ts");
    const layout = await readFile(layoutPath);
    await writeFile(layoutPath, Buffer.concat([layout, Buffer.from("\n// changed highlight placement\n")]));
    const changedLayout = await checkCompoundBundle(root);
    assert.equal(changedLayout.ok, false);
    if (!changedLayout.ok) assert.equal(changedLayout.cause, "bundle-stale");
    await writeFile(layoutPath, layout);

    await writeFile(bundlePath, Buffer.concat([built, Buffer.from("\n// damaged bytes\n")]));
    const damaged = await checkCompoundBundle(root);
    assert.equal(damaged.ok, false);
    if (!damaged.ok) assert.equal(damaged.cause, "bundle-damaged");
    await writeFile(bundlePath, built.subarray(built.indexOf(10) + 1));
    const old = await checkCompoundBundle(root);
    assert.equal(old.ok, false);
    if (!old.ok) assert.equal(old.cause, "bundle-unrecorded");
    await writeFile(bundlePath, built);

    const before = await compoundInputDigest(root);
    const packagePath = join(root, "package.json");
    const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { dependencies: { three: string } };
    pkg.dependencies.three = "0.185.0";
    await writeFile(packagePath, JSON.stringify(pkg));
    assert.notEqual(await compoundInputDigest(root), before, "the exact pinned Three version is part of the source contract");
    const wrongThree = await checkCompoundBundle(root);
    assert.equal(wrongThree.ok, false);
    if (!wrongThree.ok) assert.equal(wrongThree.cause, "bundle-stale");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
