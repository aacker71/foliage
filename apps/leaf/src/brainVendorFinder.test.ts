/**
 * Finder's files in the brain's `vendor/`: a `.DS_Store`, or any `._` file at any depth, is never
 * hashed and never counted as unstaged, so a `vendor/` someone opened in Finder keeps the brain
 * current. A link or a folder by those names gets no pass. Nothing here starts gbrain or bun: the
 * vendor directories below are SYNTHETIC stand-ins whose "bun" is a text file, and the installed
 * copy is a stand-in record and installer beside it.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { BUN_PIN, finderFile, GBRAIN_PIN, hashVendorTree, parseVendorManifest, verifyVendorTree } from "./brainVendor.ts";
import { brainConfigText, brainGlance, brainPaths, installedRuntime, runtimeStatus } from "./localBrain.ts";

const temp = async (t: { after: (fn: () => Promise<unknown>) => void }, prefix: string) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** What Finder and Archive Utility write into a folder a person opens: its settings, and AppleDouble files, one beside nothing. */
const FINDER_FILES = [".DS_Store", "._.DS_Store", "._START-HERE.md", "._x"];

/** A SYNTHETIC vendor directory: Foliage's pins and digests, stand-in files that are never executed. */
async function syntheticVendor(dir: string) {
  await mkdir(join(dir, "bun"), { recursive: true });
  await mkdir(join(dir, "gbrain", "src"), { recursive: true });
  const bun = "SYNTHETIC stand-in for bun; never executed\n", cli = "// SYNTHETIC stand-in for gbrain's src/cli.ts\n";
  await writeFile(join(dir, "bun", "bun"), bun);
  await writeFile(join(dir, "gbrain", "src", "cli.ts"), cli);
  await writeFile(join(dir, "gbrain", "LICENSE"), "SYNTHETIC licence stand-in\n");
  const manifest = {
    schemaVersion: 1, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, gbrainIntegrity: GBRAIN_PIN.integrity,
    bunVersion: BUN_PIN.version, bunSha256: sha(bun), cliSha256: sha(cli), platform: process.platform, arch: process.arch, files: await hashVendorTree(dir),
  };
  await writeFile(join(dir, "brain.json"), JSON.stringify(manifest));
  return parseVendorManifest(manifest);
}

/** Finder's files written into `vendor` and the folders in it. */
async function openedInFinder(vendor: string) {
  for (const folder of ["", "bun", "gbrain", join("gbrain", "src")]) {
    for (const name of FINDER_FILES) await writeFile(join(vendor, folder, name), "SYNTHETIC Finder metadata\n");
  }
}

test("the rule: a .DS_Store, a .localized, a custom-icon file (Icon and a carriage return) or any name starting ._, and nothing else", () => {
  for (const name of [".DS_Store", "._.DS_Store", "._START-HERE.md", "._x", "._", ".localized", "Icon\r"]) assert.equal(finderFile(name), true, JSON.stringify(name));
  for (const name of ["DS_Store", ".DS_Store.mjs", "x._", "_x", ".x", "LICENSE", "Icon", "Icon\r.js", "icon\r", ".localized.js", "localized"]) assert.equal(finderFile(name), false, JSON.stringify(name));
});

test("a .localized or a custom-icon file in vendor/ is never hashed or counted as unstaged; a folder by that name still is", async t => {
  const vendor = await temp(t, "foliage-vendor-finder-icon-");
  const manifest = await syntheticVendor(vendor);
  for (const folder of ["", "gbrain"]) for (const name of [".localized", "Icon\r"]) await writeFile(join(vendor, folder, name), "");
  assert.deepEqual((await hashVendorTree(vendor)).map(file => file.path), ["bun/bun", "gbrain/LICENSE", "gbrain/src/cli.ts"], "staging would record none of them");
  await verifyVendorTree(vendor, manifest);
  await rm(join(vendor, "gbrain", ".localized"));
  await mkdir(join(vendor, "gbrain", ".localized"));
  await writeFile(join(vendor, "gbrain", ".localized", "planted.js"), "SYNTHETIC planted module\n");
  await assert.rejects(verifyVendorTree(vendor, manifest), /vendor\/gbrain\/\.localized\/planted\.js was not staged/);
});

test("Finder's files are never hashed or counted as unstaged, at any depth; a link or a folder by those names still is", async t => {
  const vendor = await temp(t, "foliage-vendor-finder-");
  const manifest = await syntheticVendor(vendor);
  await openedInFinder(vendor);
  assert.deepEqual((await hashVendorTree(vendor)).map(file => file.path), ["bun/bun", "gbrain/LICENSE", "gbrain/src/cli.ts"], "staging would record none of them");
  await verifyVendorTree(vendor, manifest);
  await rm(join(vendor, "gbrain", "._x"));
  await verifyVendorTree(vendor, manifest);
  await symlink("LICENSE", join(vendor, "gbrain", "._x"));
  await assert.rejects(verifyVendorTree(vendor, manifest), /vendor\/gbrain\/\._x was not staged/);
  await rm(join(vendor, "gbrain", "._x"));
  await rm(join(vendor, "gbrain", ".DS_Store"));
  await symlink("LICENSE", join(vendor, "gbrain", ".DS_Store"));
  await assert.rejects(verifyVendorTree(vendor, manifest), /vendor\/gbrain\/\.DS_Store was not staged/);
  await rm(join(vendor, "gbrain", ".DS_Store"));
  await mkdir(join(vendor, "gbrain", "._folder"));
  await writeFile(join(vendor, "gbrain", "._folder", "planted.js"), "SYNTHETIC planted module\n");
  await assert.rejects(verifyVendorTree(vendor, manifest), /vendor\/gbrain\/\._folder\/planted\.js was not staged/);
  await rm(join(vendor, "gbrain", "._folder"), { recursive: true });
  await writeFile(join(vendor, "gbrain", ".DS_Store.js"), "SYNTHETIC planted module\n");
  await assert.rejects(verifyVendorTree(vendor, manifest), /vendor\/gbrain\/\.DS_Store\.js was not staged/);
});

test("an installed copy whose vendor/ was opened in Finder keeps its brain current", async t => {
  const dir = await temp(t, "foliage-vendor-finder-installed-");
  // A SYNTHETIC installed copy: the main release's record and installer at its root, a brain added.
  const root = join(dir, "foliage"), vendor = join(root, "vendor");
  await mkdir(root);
  await writeFile(join(root, "release.json"), "{\"synthetic\":true}\n");
  await writeFile(join(root, "install.mjs"), "// SYNTHETIC stand-in for the installer\n");
  await syntheticVendor(vendor);
  for (const name of ["release.json", "THIRD-PARTY-NOTICES", "START-HERE.md"]) await writeFile(join(vendor, name), "SYNTHETIC release file\n");
  assert.equal(await installedRuntime(vendor), true);
  // A SYNTHETIC garden whose brain was built from these exact record bytes.
  const garden = join(dir, "garden");
  await mkdir(garden);
  const provenance = { source: "git", ref: "0000000000000000000000000000000000000001", observedAt: "2026-10-10T00:00:00Z" };
  const leafText = JSON.stringify({ id: "synthetic-finder", subject: "Synthetic subject", leaflets: [
    { id: "one", title: "Synthetic quillwort leaflet", tier: "verified", provenance, body: [{ provenance, text: "Synthetic quillwort notes." }] },
  ] });
  await writeFile(join(garden, "leaf.json"), leafText);
  const paths = brainPaths(garden);
  for (const folder of [paths.tmp, dirname(paths.config), paths.work, paths.bin, join(paths.pages, "foliage")]) await mkdir(folder, { recursive: true });
  await writeFile(paths.config, brainConfigText(paths));
  await writeFile(paths.manifest, JSON.stringify({ schemaVersion: 2, leafId: "synthetic-finder", subject: "Synthetic subject", leafSha256: sha(leafText),
    harvestSha256: null, mode: "keyword", gbrain: { ...GBRAIN_PIN }, pages: {} }));
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "current" }, "control: current before Finder opened it");
  await openedInFinder(vendor);
  assert.deepEqual(await brainGlance({ garden, vendor }), { state: "current" });
  assert.deepEqual(await runtimeStatus(vendor), { state: "off" }, "the runtime's own state is unchanged");
  // Anything else added is still named.
  await writeFile(join(vendor, "gbrain", "planted.js"), "SYNTHETIC planted module\n");
  assert.equal((await brainGlance({ garden, vendor })).cause, "vendor/gbrain/planted.js was not staged");
});
