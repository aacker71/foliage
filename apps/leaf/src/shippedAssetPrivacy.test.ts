/**
 * NO SHIPPED OR EXPORTED ASSET NAMES A DEVELOPER'S MACHINE. The runtime archive ships every
 * stylesheet, script and page under `apps/leaf/public/` and the design system's files as they are
 * in the repository, comments and all, and `foliage export` copies four of those stylesheets into
 * a folder the owner publishes. 0.3.0's leaf.css carried a measurement note naming the dev server
 * it was taken on and the name typed into that page. This pins the machine half of that: no
 * loopback address on a developer's port (4173 and 4174 are Canopy's and Foliage's own defaults,
 * which the code documents), no home directory and no local file URL, in any such file. A person's
 * name cannot be told from other words by a pattern; the release check greps the archive for those.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
/** Where the shipped stylesheets, scripts and pages live: served by the app, copied by the export, or bundled into the archive. */
const SHIPPED_DIRS = ["apps/leaf/public", "packages/foliage-tokens/src", "packages/ui/src", "packages/ui/build"];
const ASSET = /\.(?:css|html?|[cm]?js|svg)$/;
const TEST = /\.test\.|\.spec\./;

/** Every shipped asset under the shipped folders that exists in this checkout (generated bundles once built). */
async function shippedAssets(): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; } // a generated folder not built here
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") await walk(path); }
      else if (entry.isFile() && ASSET.test(entry.name) && !TEST.test(entry.name)) found.push(path);
    }
  };
  for (const dir of SHIPPED_DIRS) await walk(join(ROOT, dir));
  return found.sort();
}

/** What in `text` names a developer's machine: a loopback address on a port other than the products' own, a home directory, a local file URL. */
function machineReferences(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:\b127\.0\.0\.1|\blocalhost|\[::1\]):(\d{2,5})\b/g)) {
    if (!["4173", "4174"].includes(match[1] ?? "")) found.push(match[0]);
  }
  for (const match of text.matchAll(/(?:\/Users|\/home)\/[A-Za-z0-9._-]+/g)) found.push(match[0]);
  for (const match of text.matchAll(/file:\/\/\/[A-Za-z]/g)) found.push(match[0]);
  return found;
}

test("the pattern finds a developer's server, home directory and file URL, and leaves the products' own ports and placeholders alone", () => {
  // SYNTHETIC text in the shape of the 0.3.0 note and of what must stay.
  assert.deepEqual(machineReferences("Measured on the running page (127.0.0.1:4190/, \"Synthetic Name\")"), ["127.0.0.1:4190"]);
  assert.deepEqual(machineReferences("open localhost:4211 and [::1]:4199"), ["localhost:4211", "[::1]:4199"]);
  assert.deepEqual(machineReferences("read /Users/synthetic/garden and /home/synthetic/x and file:///tmp/x"), ["/Users/synthetic", "/home/synthetic", "file:///t"]);
  assert.deepEqual(machineReferences("a form posted to 127.0.0.1:4174, canopy on 127.0.0.1:4173; /Users/…/<page>.md"), []);
});

test("no stylesheet, script or page the archive ships or the export copies names a developer's machine", async () => {
  const assets = await shippedAssets();
  assert.ok(assets.some(path => path.endsWith(join("apps", "leaf", "public", "leaf.css"))), "leaf.css is among the files checked");
  assert.ok(assets.some(path => path.endsWith(join("packages", "foliage-tokens", "src", "tokens.css"))), "tokens.css is among the files checked");
  const hits: string[] = [];
  for (const path of assets) {
    for (const reference of machineReferences(await readFile(path, "utf8"))) hits.push(`${relative(ROOT, path)}: ${reference}`);
  }
  assert.deepEqual(hits, []);
});
