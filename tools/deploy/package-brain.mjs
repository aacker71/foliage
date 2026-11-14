#!/usr/bin/env node
/**
 * THE BRAIN UNIT (unit 38, build order item 7; spec PR #201): the staged, pinned gbrain and bun as
 * their own release unit, a `vendor/` folder with its own release.json. Since the owner decision of
 * 2026-10-15 it ships inside the one download, beside `runtime/` (`packageDownload` in
 * `package-local.mjs`, which builds it with `brainStage` and `buildBrainUnit` below), and the
 * runtime's installer installs it by default.
 *
 *   node tools/deploy/package-brain.mjs <new-directory> [--include-working-tree]
 *
 * This command still builds the brain-only archive, `foliage-brain-<version>-<platform>-<arch>.tgz`,
 * for adding the brain to an existing install (`--add-brain`); it is not published. A build-machine
 * step. It reads this checkout's `vendor/` (staged by `tools/brain/stage-gbrain.mjs`) and writes
 * `<new-directory>/vendor/` (the unit) and `<new-directory>/foliage-brain-….tgz`, whose sole top-level
 * directory is `vendor/`. It downloads nothing, uploads nothing, and creates no GitHub release or tag.
 *
 * WHAT IT REFUSES, before anything is written: a platform whose bun bytes Foliage does not pin (only
 * macOS arm64 has passed the offline test; `BUN_PIN.shipped`); a staged tree whose pins or files differ
 * from what Foliage pins and staged; a staged tree that still holds upstream development files staging
 * now drops (`DROPPED` in `tools/brain/stage-gbrain.mjs`: `.env.testing.example`, `.github/` and the
 * like); a staged tree whose files that can reach out differ from the
 * committed `tools/brain/egress-surface.json` (a negative-control probe left in `vendor/` is one); and
 * bun's licence text when its bytes are not the copy committed here. Then, on the private copy that
 * ships: bun's pinned bytes, thin arm64 Mach-O, system libraries only and its version (`checkBun`, as
 * staging checks it and draft PR #160 checks its bundled Node).
 *
 * HOW IT IS PACKED: the private copy's modes as a release ships them (`releaseModes`: directories
 * 0755, files 0644 or 0755), then `releaseTarball` from `package-local.mjs`, which every release archive uses:
 * no extended attributes or macOS metadata, every entry 0:0 with no names, and every header read
 * back before the archive is kept.
 *
 * WHAT IT ADDS to the staged files, at the root of the unit (`RELEASE_FILES` in
 * `apps/leaf/src/brainVendor.ts`): `THIRD-PARTY-NOTICES`, generated from the staged tree;
 * `START-HERE.md`, what the brain is and how to add it to an existing install; and
 * `release.json`, written the way the main release's is (`writeRuntimeManifest`), with the Foliage
 * version the brain belongs to and its pins. The installer's own readers must accept the result.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { brainArchiveShips, BUN_PIN, GBRAIN_PIN, readVendorManifest, RELEASE_FILES, sha256File, shippedBunProblem, vendorLayout, verifyShippedBrain, verifyVendorTree } from '../../apps/leaf/src/brainVendor.ts';
import { checkBun, droppedFiles, egressSurface, surfaceDifferences } from '../brain/stage-gbrain.mjs';
import { verifyBrainUnit } from '../install/runtime-install.mjs';
import { licensedPackage, licenseSections, licenseTally, NOTICE_RULE, releaseTarball, unlicensedLine, writeRuntimeManifest } from './package-local.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const STAGE_FIX = 'node tools/brain/stage-gbrain.mjs';

/**
 * bun's licence text, committed so every build carries the same bytes. bun's binary ships without
 * one, and none came with the staged copy; this is bun's own licence page, the one place its MIT grant
 * and what it links are written down.
 */
export const BUN_LICENSE = Object.freeze({
  file: 'tools/brain/bun-LICENSE.md',
  sha256: '1fac2ad9eac5ba9e1e0ef0d2893108e7d7a17fae5afac60f4bb0bd403087f3ec',
  source: "bun's own licence page (LICENSE.md in github.com/oven-sh/bun, published as docs/project/license.mdx), copied byte for byte from the bun-types 1.4.2 npm package, where it is identical to bun-types 1.4.0. bun 1.3.14's own copy was not available offline when this archive was built; compare it with the bun-v1.3.14 tag before release.",
});

/** @param {string} version @param {string} platform @param {string} arch */
export const brainArchiveName = (version, platform, arch) => `foliage-brain-${version}-${platform}-${arch}.tgz`;

/**
 * The modes a release ships, set on the private copy before it is packed: every directory 0755, a
 * file 0755 when any execute bit is set and 0644 otherwise, links as they are. Staging keeps
 * `vendor/` and `vendor/bun/` at 0700, and `bun install` writes package files 0666 (the 0.3.0 archive
 * stored 11,706 files at 0666 and 50 at 0777), which an extraction that keeps stored modes (as root,
 * or `tar -p`) would leave writable by every user once the directories are 0755. Digests are of
 * contents only, so `brain.json` and `release.json` are unchanged by this.
 * @param {string} dir
 */
export async function releaseModes(dir) {
  await chmod(dir, 0o755);
  for (const name of await readdir(dir)) {
    const path = join(dir, name), info = await lstat(path);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) await releaseModes(path);
    else if (info.isFile()) await chmod(path, (info.mode & 0o111) !== 0 ? 0o755 : 0o644);
    else throw new Error(`${path} is neither a file, a directory nor a link.`);
  }
}

const GRAMMAR = /(?:^|\/)tree-sitter-[\w-]+\.wasm$/;

/** @typedef {import('./package-local.mjs').LicensedPackage} StagedPackage */

/**
 * Every package under `gbrain/node_modules`, nested ones included, with its declared licence, what it
 * depends on and the text of its licence and notice files. Sorted by path; `.bin` links are skipped.
 * @param {string} gbrain
 * @returns {Promise<StagedPackage[]>}
 */
export async function stagedPackages(gbrain) {
  /** @type {StagedPackage[]} */
  const found = [];
  /** @param {string} dir */
  const walk = async (dir) => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name);
      if (name === '.bin' || !(await lstat(path)).isDirectory()) continue;
      if (name.startsWith('@')) { await walk(path); continue; }
      const entry = await licensedPackage(path, relative(gbrain, path).split(sep).join('/'));
      if (!entry) continue;
      found.push(entry);
      await walk(join(path, 'node_modules')).catch(() => undefined);
    }
  };
  await walk(join(gbrain, 'node_modules'));
  return found.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Every tree-sitter grammar `.wasm` under `gbrain`, by path. @param {string} gbrain */
export async function grammarFiles(gbrain) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && GRAMMAR.test(entry.name)) found.push(relative(gbrain, path).split(sep).join('/'));
    }
  };
  await walk(gbrain);
  return found.sort();
}

/**
 * THIRD-PARTY-NOTICES for the brain archive. Pure. Every package keeps its own licence and nothing is
 * relicensed: gbrain's MIT notice verbatim, bun's licence text verbatim with where it came from, and
 * each staged package's licence and notice files verbatim, or a line saying it ships none. What the
 * spec leaves for counsel before release is listed first, from the data: copyleft licences and who
 * requires them, grammar `.wasm` files with no licence of their own, packages with no licence file.
 * @param {{ unit: string, gbrain: { version: string, commit: string, license: string },
 *   bun: { version: string, sha256: string, license: string, source: string },
 *   packages: readonly StagedPackage[], grammars: readonly string[] }} input
 */
export function thirdPartyNotices({ unit, gbrain, bun, packages, grammars }) {
  const copyleft = packages.filter(entry => /GPL/i.test(entry.license)).map(entry => {
    const users = packages.filter(other => other.dependencies.includes(entry.name)).map(other => other.name);
    return `  - ${entry.name}@${entry.version} is ${entry.license}${users.length > 0 ? `, required by ${[...new Set(users)].join(', ')}` : ''}.`;
  });
  const folders = new Map();
  for (const path of grammars) {
    const folder = path.slice(0, path.lastIndexOf('/'));
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  return `${[
    `THIRD-PARTY NOTICES for the ${unit}`,
    '',
    'This folder bundles software made by others. Each part keeps its own licence, and nothing here',
    'relicenses anything. Generated by tools/deploy/package-brain.mjs from the staged tree.',
    '',
    `  gbrain ${gbrain.version}, github:garrytan/gbrain at ${gbrain.commit}: MIT. Its licence ships verbatim at vendor/gbrain/LICENSE and below.`,
    `  bun ${bun.version}, vendor/bun/bun (sha256 ${bun.sha256}): MIT, with the libraries it links under their own licences, below.`,
    `  ${packages.length} packages gbrain uses, under vendor/gbrain/node_modules, by declared licence: ${licenseTally(packages)}.`,
    '',
    'FOR COUNSEL BEFORE RELEASE (unit 38, "Licence"):',
    ...copyleft,
    ...[...folders].map(([folder, count]) => `  - ${count} tree-sitter grammar .wasm files in vendor/gbrain/${folder} carry no licence of their own.`),
    ...unlicensedLine(packages),
    '  - bun statically links JavaScriptCore and WebKit, which are LGPL-2: whoever redistributes bun must let its users relink it',
    "    (bun's licence page below says how). bun's other linked libraries are listed there, not re-checked here.",
    '',
    NOTICE_RULE, `gbrain ${gbrain.version} · MIT · vendor/gbrain/LICENSE`, NOTICE_RULE, gbrain.license.trimEnd(), '',
    NOTICE_RULE, `bun ${bun.version} · MIT, with linked libraries under their own licences · vendor/bun/bun`, `Text: ${bun.source}`, NOTICE_RULE, bun.license.trimEnd(), '',
    ...licenseSections(packages, 'vendor/gbrain/'),
  ].join('\n')}\n`;
}

/**
 * What this folder is and how to add it to an install, at the root of the unit. It comes with Foliage:
 * the runtime folder's installer installs it by default, so the commands here are for an install made
 * without it. Plain words; the commands are the installer's own. Pure.
 * @param {string} version @param {string} platform @param {string} arch
 */
export function brainStartHere(version, platform, arch) {
  return `# Foliage local brain ${version}

This vendor folder is the local brain for Foliage ${version} on ${platform}/${arch}: a pinned gbrain and the bun that runs it. It searches your record on this computer and never uses the network. It is not Foliage itself.

It comes with Foliage. Installing Foliage from the runtime folder of the same download ('node install.mjs /absolute/path/to/a/new/foliage-folder', run in that folder) checks every file of this folder and installs it too. Add --no-brain to install Foliage without it.

To add it later to an existing Foliage ${version} install that has no brain:
   node /absolute/foliage-folder/install.mjs --add-brain /absolute/path/to/this/vendor /absolute/foliage-folder
--replace-brain puts it in place of a brain that install already has.

Then build a garden's brain: node /absolute/foliage-folder/foliage.mjs brain build --garden /absolute/path/to/your/garden

An install of another Foliage version refuses this brain. Installing never reads or changes your record. The release.json in this folder checks every file; it is not a publisher signature. The licences of everything in this folder are in THIRD-PARTY-NOTICES.
`;
}

/**
 * @typedef {{ root: string, vendor: string, staged: Awaited<ReturnType<typeof readVendorManifest>>, bunLicense: Buffer,
 *   version: string, revision: string, workingTree: boolean, platform: string, arch: string }} BrainStage
 */

/**
 * This checkout's staged `vendor/`, checked for everything the header says a brain unit is refused
 * for that can be known before a file is written. Writes nothing.
 * @param {{ root?: string, includeWorkingTree?: boolean, platform?: string, arch?: string }} [options]
 * @returns {Promise<BrainStage>}
 */
export async function brainStage({ root = ROOT, includeWorkingTree = false, platform = process.platform, arch = process.arch } = {}) {
  if (!brainArchiveShips(platform, arch)) throw new Error(`No brain archive ships for ${platform}/${arch}: only macOS arm64 has passed the offline test (unit 38). Nothing was written.`);
  if (platform !== process.platform || arch !== process.arch) throw new Error(`Build the ${platform}/${arch} brain archive on ${platform}/${arch}. Nothing was written.`);
  const dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim();
  if (dirty && !includeWorkingTree) throw new Error('Commit the release source first, or use --include-working-tree for a local candidate.');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

  // What was staged, exactly as Foliage pins and staged it, before anything is written.
  const vendor = join(root, 'vendor');
  let staged;
  try {
    staged = await readVendorManifest(vendor);
    await verifyVendorTree(vendor, staged);
  } catch (error) { throw new Error(`The staged brain in vendor/ cannot ship: ${error instanceof Error ? error.message : String(error)}. Restage it: ${STAGE_FIX}`); }
  // Staged before staging dropped upstream's own development files: restaging records the tree without them.
  const leftover = droppedFiles(staged.files);
  if (leftover.length > 0) throw new Error(`The staged brain in vendor/ cannot ship: it still holds upstream development files that staging drops (${leftover.slice(0, 5).map(path => `vendor/${path}`).join(', ')}${leftover.length > 5 ? ', …' : ''}). Restage it: ${STAGE_FIX}`);
  const bunProblem = shippedBunProblem(staged);
  if (bunProblem !== null) throw new Error(`The staged brain in vendor/ cannot ship: ${bunProblem}.`);
  const committed = JSON.parse(await readFile(join(root, 'tools', 'brain', 'egress-surface.json'), 'utf8'));
  const differences = committed.gbrainCommit === GBRAIN_PIN.commit ? surfaceDifferences(committed.files, await egressSurface(vendorLayout(vendor).gbrain)) : ['the committed surface names another gbrain commit'];
  if (differences.length > 0) throw new Error(`The staged files that can reach out differ from tools/brain/egress-surface.json, so vendor/ cannot ship (a planted negative-control probe is one such difference):\n  ${differences.slice(0, 20).join('\n  ')}\nRestage it: ${STAGE_FIX}`);
  const bunLicense = await readFile(join(root, BUN_LICENSE.file));
  if (createHash('sha256').update(bunLicense).digest('hex') !== BUN_LICENSE.sha256) throw new Error(`${BUN_LICENSE.file} is not the licence text Foliage pins.`);
  return { root, vendor, staged, bunLicense, version, revision, workingTree: dirty, platform, arch };
}

/**
 * The brain unit, from a checked `stage` (`brainStage`), into the new folder `unit`: the staged files
 * and their record, nothing else, checked again as copied; then THIRD-PARTY-NOTICES, START-HERE.md and
 * release.json added, the installer's own readers and Foliage's pin checks run on it, and the modes a
 * release ships set. The one download and the brain-only archive carry the same unit. On any
 * refusal the new folder is removed.
 * @param {string} unit @param {BrainStage} stage
 */
export async function buildBrainUnit(unit, { vendor, staged, bunLicense, version, revision, workingTree, platform, arch }) {
  await mkdir(unit); // A new folder: never mixed with an earlier unit.
  try {
    const layout = vendorLayout(unit);
    // The staged files and their record, nothing else; then the private copy is what is checked.
    for (const name of await readdir(vendor)) {
      await cp(join(vendor, name), join(unit, name), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false,
        filter: source => !RELEASE_FILES.includes(relative(vendor, source).split(sep).join('/')) });
    }
    await verifyVendorTree(unit, staged);
    if (await sha256File(layout.bun) !== BUN_PIN.shipped[`${platform}/${arch}`]) throw new Error('The copied bun is not the bun Foliage ships.');
    await checkBun(layout.bun);

    const packages = await stagedPackages(layout.gbrain);
    const notices = thirdPartyNotices({
      unit: `Foliage local brain ${version} for ${platform}/${arch}`,
      gbrain: { version: staged.gbrainVersion, commit: staged.gbrainCommit, license: await readFile(join(layout.gbrain, 'LICENSE'), 'utf8') },
      bun: { version: staged.bunVersion, sha256: staged.bunSha256, license: bunLicense.toString('utf8'), source: BUN_LICENSE.source },
      packages, grammars: await grammarFiles(layout.gbrain),
    });
    await writeFile(join(unit, 'THIRD-PARTY-NOTICES'), notices, { flag: 'wx' });
    await writeFile(join(unit, 'START-HERE.md'), brainStartHere(version, platform, arch), { flag: 'wx' });
    const manifest = await writeRuntimeManifest(unit, {
      kind: 'foliage-brain', foliageVersion: version, revision, workingTree, platform, arch,
      bunVersion: staged.bunVersion, bunSha256: staged.bunSha256,
      gbrainVersion: staged.gbrainVersion, gbrainCommit: staged.gbrainCommit, gbrainIntegrity: staged.gbrainIntegrity,
    });
    // The installer's readers accept it, or nothing ships.
    await verifyBrainUnit(unit, version);
    await verifyShippedBrain(unit);
    // The modes a release ships; the archive's headers are read back when it is packed (`releaseTarball`).
    await releaseModes(unit);
    return { unit, files: manifest.files.length, packages: packages.length, version, revision, workingTree };
  } catch (error) {
    await rm(unit, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The brain-only archive of this checkout's staged `vendor/`, into the new directory `output`: for
 * adding the brain to an existing install. Not published; the brain ships in the one download.
 * @param {string} output
 * @param {{ root?: string, includeWorkingTree?: boolean, platform?: string, arch?: string }} [options]
 */
export async function packageBrain(output, options = {}) {
  const stage = await brainStage(options);
  const target = resolve(output);
  await mkdir(target); // A new directory: never mixed with an earlier archive.
  try {
    const unit = await buildBrainUnit(join(target, 'vendor'), stage);
    // No AppleDouble files, extended attributes, builder's names or files others could change in
    // the archive: every header is read back (`releaseTarball`).
    const path = join(target, brainArchiveName(stage.version, stage.platform, stage.arch));
    const entries = await releaseTarball(path, target, 'vendor');
    const stray = entries.filter(entry => !(entry.name === 'vendor/' || entry.name.startsWith('vendor/')));
    if (stray.length > 0) throw new Error(`The archive holds entries outside vendor/: ${stray.slice(0, 5).map(entry => entry.name).join(', ')}`);
    const bytes = await readFile(path);
    return {
      directory: target, unit: unit.unit, archive: path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
      files: unit.files, packages: unit.packages, version: unit.version, revision: unit.revision, workingTree: unit.workingTree,
    };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { 'include-working-tree': { type: 'boolean' } } });
    if (positionals.length !== 1) throw new Error('Usage: node tools/deploy/package-brain.mjs <new-directory> [--include-working-tree]');
    const result = await packageBrain(resolve(positionals[0] ?? ''), { includeWorkingTree: values['include-working-tree'] ?? false });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`package-brain: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
