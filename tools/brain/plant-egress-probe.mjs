#!/usr/bin/env node
/**
 * THE OFFLINE GATE'S NEGATIVE CONTROL (unit 38, build order item 4): break the staged gbrain on
 * purpose, so the gate has to go red. CI's `egress-gate-is-real` job runs it on a throwaway runner;
 * a developer may run it to see the red run, then restore the pinned tree:
 *
 *   node tools/brain/plant-egress-probe.mjs fetch|lookup
 *   node scripts/check-brain-offline.mjs     # must fail with a NETWORK ATTEMPT line
 *   node tools/brain/stage-gbrain.mjs        # puts the pinned tree back
 *
 * It plants one network attempt at the top of `vendor/gbrain/src/cli.ts`, the module every gbrain
 * command loads: `fetch` asks for http://example.test/, `lookup` resolves example.test. Both are
 * awaited before gbrain does anything else, so the attempt happens on the first command. Then it
 * re-records `vendor/brain.json` the way a reviewed pin bump would (every file's digest, and the
 * entry file's), so Foliage's own digest checks pass and only the network observer can turn the
 * gate red: a digest failure would not count.
 *
 * Nothing here touches the network itself; the planted line only runs inside the gate's sandbox.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashVendorTree, readVendorManifest, sha256File, vendorLayout, verifyVendorTree } from "../../apps/leaf/src/brainVendor.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** On every planted line, so a planted tree is recognised and never planted twice. */
export const PLANT_MARK = "FOLIAGE NEGATIVE CONTROL (egress-gate-is-real)";

export const PROBES = Object.freeze({
  fetch: `await fetch("http://example.test/").catch(() => undefined); // ${PLANT_MARK}: a planted fetch`,
  lookup: `await import("node:dns").then(dns => dns.promises.lookup("example.test")).catch(() => undefined); // ${PLANT_MARK}: a planted name lookup`,
});

/**
 * The entry file with the probe as its first statement, after any `#!` line. Pure.
 * @param {string} text @param {keyof typeof PROBES} probe
 */
export function plantedText(text, probe) {
  if (text.includes(PLANT_MARK)) throw new Error("vendor/gbrain/src/cli.ts already holds a planted probe. Restore the pinned tree first: node tools/brain/stage-gbrain.mjs");
  const lines = text.split("\n");
  const at = lines[0]?.startsWith("#!") ? 1 : 0;
  lines.splice(at, 0, PROBES[probe]);
  return lines.join("\n");
}

/**
 * Plants the probe in `<vendor>/gbrain/src/cli.ts` and re-records `<vendor>/brain.json`, then
 * checks the runtime's own reader accepts the result.
 * @param {string} vendor @param {keyof typeof PROBES} probe
 */
export async function plantProbe(vendor, probe) {
  const layout = vendorLayout(vendor);
  await readVendorManifest(vendor); // a staged tree for this platform, or a named refusal
  await writeFile(layout.cli, plantedText(await readFile(layout.cli, "utf8"), probe));
  const record = /** @type {Record<string, unknown>} */ (JSON.parse(await readFile(layout.manifest, "utf8")));
  await writeFile(layout.manifest, `${JSON.stringify({ ...record, cliSha256: await sha256File(layout.cli), files: await hashVendorTree(vendor) }, null, 2)}\n`);
  await verifyVendorTree(vendor, await readVendorManifest(vendor));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const probe = process.argv[2];
  if (process.argv.length !== 3 || (probe !== "fetch" && probe !== "lookup")) {
    process.stderr.write("Usage: node tools/brain/plant-egress-probe.mjs fetch|lookup\n");
    process.exitCode = 2;
  } else {
    try {
      await plantProbe(join(ROOT, "vendor"), probe);
      process.stdout.write(`Planted a ${probe} in vendor/gbrain/src/cli.ts and re-recorded vendor/brain.json. The offline gate must now fail with a NETWORK ATTEMPT line. Restore with: node tools/brain/stage-gbrain.mjs\n`);
    } catch (error) {
      process.stderr.write(`plant-egress-probe: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
