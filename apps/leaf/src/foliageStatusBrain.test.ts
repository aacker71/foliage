/**
 * The BRAIN row of `foliage status` in an installed copy, and `foliage brain` through the launcher:
 * a fix is printed as the whole command, node and this copy's foliage.mjs by absolute path and
 * `--garden` the garden, quoted as every other next step `foliage.mjs` prints, so it runs as printed
 * from any directory. The row used to print "Run foliage brain rebuild", which an installed copy
 * (no `foliage` on PATH) cannot run and which names no garden. A checkout's row keeps the short
 * form, as the brain offline gate reads it.
 *
 * SYNTHETIC copies of this checkout's `foliage.mjs` and `apps/leaf/brain.mjs`, with the sources and
 * packages they import linked: one installed (the main release's record and installer at its root),
 * one not. Their vendor/ is a SYNTHETIC stand-in whose "bun" is a text file; no gbrain or bun starts.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BUN_PIN, GBRAIN_PIN, hashVendorTree } from "./brainVendor.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
/** A shell word as `foliage.mjs` quotes one. */
const word = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

const temp = async (t: { after: (fn: () => Promise<unknown>) => void }, prefix: string) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

/** A SYNTHETIC copy of this checkout's launcher at `root`, installed or not, with a brain staged. */
async function copyAt(root: string, installed: boolean): Promise<void> {
  await mkdir(join(root, "apps", "leaf"), { recursive: true });
  await copyFile(join(REPO, "foliage.mjs"), join(root, "foliage.mjs"));
  await copyFile(join(REPO, "apps", "leaf", "brain.mjs"), join(root, "apps", "leaf", "brain.mjs"));
  await symlink(join(REPO, "apps", "leaf", "src"), join(root, "apps", "leaf", "src"));
  await symlink(join(REPO, "apps", "leaf", "node_modules"), join(root, "apps", "leaf", "node_modules"));
  await symlink(join(REPO, "packages"), join(root, "packages"));
  if (installed) {
    await writeFile(join(root, "release.json"), "{\"synthetic\":true}\n");
    await writeFile(join(root, "install.mjs"), "// SYNTHETIC stand-in for the installer\n");
  }
  const vendor = join(root, "vendor");
  await mkdir(join(vendor, "bun"), { recursive: true });
  await mkdir(join(vendor, "gbrain", "src"), { recursive: true });
  const bun = "SYNTHETIC stand-in for bun; never executed\n", cli = "// SYNTHETIC stand-in for gbrain's src/cli.ts\n";
  await writeFile(join(vendor, "bun", "bun"), bun);
  await writeFile(join(vendor, "gbrain", "src", "cli.ts"), cli);
  await writeFile(join(vendor, "gbrain", "LICENSE"), "SYNTHETIC licence stand-in\n");
  await writeFile(join(vendor, "brain.json"), JSON.stringify({
    schemaVersion: 1, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, gbrainIntegrity: GBRAIN_PIN.integrity,
    bunVersion: BUN_PIN.version, bunSha256: sha(bun), cliSha256: sha(cli), platform: process.platform, arch: process.arch, files: await hashVendorTree(vendor),
  }));
}

/** A SYNTHETIC record, about nobody, and a brain whose last build did not finish (its home, no manifest). */
async function unfinishedBrain(garden: string): Promise<void> {
  const provenance = { source: "git", ref: "0000000000000000000000000000000000000001", observedAt: "2026-10-10T00:00:00Z" };
  await mkdir(join(garden, "brain", "home"), { recursive: true });
  await writeFile(join(garden, "leaf.json"), JSON.stringify({ id: "synthetic-status", subject: "Synthetic subject", leaflets: [
    { id: "one", title: "Synthetic quillwort leaflet", tier: "verified", provenance, body: [{ provenance, text: "Synthetic quillwort notes." }] },
  ] }));
}

function foliage(root: string, home: string, args: readonly string[]) {
  return spawnSync(process.execPath, [join(root, "foliage.mjs"), ...args], { encoding: "utf8", timeout: 60_000, cwd: home, env: { HOME: home, PATH: "/usr/bin:/bin", NO_COLOR: "1" } });
}

/** The BRAIN row's text, as `foliage status` prints it. */
const brainRow = (stdout: string) => stdout.split("\n").find(line => /^ {2}BRAIN +/.test(line))?.replace(/^ {2}BRAIN +/, "");

test("foliage status prints the BRAIN row's fix as the whole runnable command in an installed copy, and the short form in a checkout", async t => {
  const dir = await temp(t, "foliage-status-brain-");
  const home = join(dir, "home"), garden = join(dir, "garden");
  await mkdir(home);
  await unfinishedBrain(garden);
  for (const installed of [true, false]) {
    const root = join(dir, installed ? "installed" : "checkout");
    await copyAt(root, installed);
    const ran = foliage(root, home, ["status", "--garden", garden]);
    assert.equal(ran.status, 0, ran.stderr);
    const rebuild = installed ? [process.execPath, join(root, "foliage.mjs"), "brain", "rebuild", "--garden", garden].map(word).join(" ") : "foliage brain rebuild";
    assert.equal(brainRow(ran.stdout), `broken: the last build did not finish. Run ${rebuild}`, ran.stdout);
  }
});

test("foliage brain through the launcher prints whole commands in a copy that is not installed too: FOLIAGE_LAUNCHER reaches brain.mjs", async t => {
  const dir = await temp(t, "foliage-brain-launcher-");
  const home = join(dir, "home"), garden = join(dir, "garden"), root = join(dir, "checkout");
  await mkdir(home);
  await unfinishedBrain(garden);
  await copyAt(root, false);
  const rebuild = [process.execPath, join(root, "foliage.mjs"), "brain", "rebuild", "--garden", garden].map(word).join(" ");
  const ran = foliage(root, home, ["brain", "status", "--garden", garden]);
  assert.deepEqual([ran.status, ran.stdout, ran.stderr], [1, `Brain: broken: the last build did not finish. Run ${rebuild}\n`, ""]);
  // Run directly, without the launcher, a checkout keeps the short form.
  const direct = spawnSync(process.execPath, [join(root, "apps", "leaf", "brain.mjs"), "status", "--garden", garden], { encoding: "utf8", timeout: 60_000, env: { HOME: home, PATH: "/usr/bin:/bin" } });
  assert.equal(direct.stdout, "Brain: broken: the last build did not finish. Run foliage brain rebuild\n", direct.stderr);
});

test("foliage status, for a garden with a record and no brain, says what builds one as brain refresh does: the whole command in an installed copy, the short form in a checkout", async t => {
  const dir = await temp(t, "foliage-status-no-brain-");
  const home = join(dir, "home"), garden = join(dir, "garden");
  await mkdir(home);
  await unfinishedBrain(garden);
  await rm(join(garden, "brain"), { recursive: true });
  for (const installed of [true, false]) {
    const root = join(dir, installed ? "installed" : "checkout");
    await copyAt(root, installed);
    const ran = foliage(root, home, ["status", "--garden", garden]);
    assert.equal(ran.status, 0, ran.stderr);
    const build = installed ? [process.execPath, join(root, "foliage.mjs"), "brain", "build", "--garden", garden].map(word).join(" ") : "foliage brain build";
    assert.equal(brainRow(ran.stdout), `off. This garden has no brain yet. Run ${build}`, ran.stdout);
  }
});
