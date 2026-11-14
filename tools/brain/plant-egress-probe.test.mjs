/**
 * The negative control's plant, on a SYNTHETIC vendor tree whose files are stand-ins that nothing
 * executes: the probe lands first in the entry file, the record is re-recorded so the runtime's own
 * digest check passes, and a planted tree is never planted twice.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BUN_PIN, GBRAIN_PIN, hashVendorTree, readVendorManifest, verifyVendorTree } from "../../apps/leaf/src/brainVendor.ts";
import { PLANT_MARK, plantedText, plantProbe, PROBES } from "./plant-egress-probe.mjs";

/** @param {string} text */
const sha = (text) => createHash("sha256").update(text).digest("hex");

test("the probe is the entry file's first statement, after its #! line", () => {
  assert.equal(plantedText("#!/usr/bin/env bun\nimport x from './x.ts';\n", "fetch"), `#!/usr/bin/env bun\n${PROBES.fetch}\nimport x from './x.ts';\n`);
  assert.equal(plantedText("import x from './x.ts';\n", "lookup"), `${PROBES.lookup}\nimport x from './x.ts';\n`);
  assert.match(PROBES.fetch, /^await fetch\("http:\/\/example\.test\/"\)/);
  assert.match(PROBES.lookup, /lookup\("example\.test"\)/);
  assert.throws(() => plantedText(`#!/usr/bin/env bun\n${PROBES.fetch}\n`, "lookup"), /already holds a planted probe/);
});

test("a planted tree is re-recorded so the runtime's own digest checks pass, and is never planted twice", async t => {
  const vendor = await mkdtemp(join(tmpdir(), "foliage-plant-probe-"));
  t.after(() => rm(vendor, { recursive: true, force: true }));
  await mkdir(join(vendor, "bun"), { recursive: true });
  await mkdir(join(vendor, "gbrain", "src"), { recursive: true });
  const bun = "synthetic stand-in for bun; nothing executes it\n";
  const cli = "#!/usr/bin/env bun\n// synthetic stand-in for gbrain's src/cli.ts\n";
  await writeFile(join(vendor, "bun", "bun"), bun);
  await writeFile(join(vendor, "gbrain", "src", "cli.ts"), cli);
  await writeFile(join(vendor, "brain.json"), JSON.stringify({
    schemaVersion: 1, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, gbrainIntegrity: GBRAIN_PIN.integrity,
    bunVersion: BUN_PIN.version, bunSha256: sha(bun), cliSha256: sha(cli), platform: process.platform, arch: process.arch,
    files: await hashVendorTree(vendor),
  }));

  await plantProbe(vendor, "fetch");
  const planted = await readFile(join(vendor, "gbrain", "src", "cli.ts"), "utf8");
  assert.equal(planted.split("\n")[1], PROBES.fetch);
  const manifest = await readVendorManifest(vendor);
  assert.equal(manifest.cliSha256, sha(planted));
  assert.equal(manifest.bunSha256, sha(bun), "everything else in the record is kept");
  await verifyVendorTree(vendor, manifest);
  await assert.rejects(plantProbe(vendor, "lookup"), new RegExp(`already holds a planted probe`));
  assert.equal((await readFile(join(vendor, "gbrain", "src", "cli.ts"), "utf8")).split(PLANT_MARK).length, 2, "one probe, not two");
});
