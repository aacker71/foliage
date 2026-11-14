#!/usr/bin/env node
/**
 * Installs only this verified archive into a new directory, with the local brain that comes beside
 * it in the download, or later. No service or source capture starts, nothing is downloaded, and no
 * garden is read.
 *
 * ONE DOWNLOAD (owner decision 2026-10-15): `foliage-<version>-<platform>-<arch>-<rev7>.tgz` holds
 * `runtime/` (this release, with this installer as `install.mjs`) and, beside it, `vendor/` (the brain
 * unit). Run with no brain flag, the installer installs `../vendor` when it is there, through exactly
 * the `--with-brain` path: the same checks and the same refusals, so a `../vendor` that fails them
 * stops the install and is never skipped. `--no-brain` installs without it. With no brain flag and
 * nothing at `../vendor` where a brain ships, it installs without one and says so in one line.
 *
 * THE BRAIN IS ITS OWN UNIT (unit 38, build order item 7): a `vendor/` folder with its
 * own `vendor/release.json` (kind `foliage-brain`): the pinned gbrain, the pinned bun, their staging
 * record `brain.json` and `THIRD-PARTY-NOTICES`. The main `release.json` never lists `vendor/`; the
 * root check skips `vendor/` only when `vendor/release.json` is present, then checks `vendor/` as a
 * unit against it by the same rules, for this Foliage's version. A `vendor/` without one is refused
 * like any unlisted file. Once a brain's files match, the Foliage that will run it checks its pins
 * (`verifyShippedBrain` in `apps/leaf/src/brainVendor.ts`, loaded after Node's own check because it
 * is TypeScript), before it is copied and again where it was copied to.
 *
 *   node install.mjs /abs/new-folder                                       new install, with ../vendor when it is there
 *   node install.mjs /abs/new-folder --no-brain                            new install without the brain
 *   node install.mjs /abs/new-folder --with-brain /abs/extracted/vendor    new install with that brain
 *   node install.mjs --add-brain /abs/extracted/vendor /abs/existing-install  a brain added later
 *   node install.mjs --replace-brain /abs/extracted/vendor /abs/existing-install
 *
 * Adding copies the brain to `vendor.next/`, checks it there, and renames it to `vendor/`; replacing
 * moves the old one to `vendor.old/` for the swap and removes it only once the new one checks out.
 */
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkNode } from './requirements.mjs';

/** Where the brain unit lives in an install, and what its own manifest calls itself. */
const BRAIN = 'vendor';
const BRAIN_KIND = 'foliage-brain';
/** What every brain unit must carry: its staging record, its notices and gbrain's own licence. */
const BRAIN_REQUIRED = ['brain.json', 'THIRD-PARTY-NOTICES', 'gbrain/LICENSE'];
const BRAIN_PINS = ['bunVersion', 'bunSha256', 'gbrainVersion', 'gbrainCommit', 'gbrainIntegrity'];

/** @typedef {{path:string,link?:string,sha256?:string}} ReleaseFile */
/** @typedef {{schemaVersion:number,platform:string,arch:string,version?:string,files:ReleaseFile[]}} RuntimeManifest */
/** @typedef {{schemaVersion:number,kind:string,platform:string,arch:string,foliageVersion?:string,files:ReleaseFile[]} & Record<string, unknown>} BrainManifest */
/** @typedef {{ verifyShippedBrain(vendor: string): Promise<unknown>, freeBytes(path: string): Promise<number>, roomProblem(free: number, needed: number, where: string): string | null, EMPTY_BRAIN_BYTES: number }} BrainChecks */

/** @param {string} path */
const exists = path => lstat(path).then(() => true, () => false);
/** Whether a file-system error means "nothing is there". @param {unknown} error */
const absent = error => !!error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
/**
 * `path` with its links resolved, or the sentence `missing` when nothing is there: a raw ENOENT
 * names a system call, not what the person typed wrong.
 * @param {string} path @param {string} missing
 */
async function realOr(path, missing) {
  try { return await realpath(path); }
  catch (error) { if (absent(error)) throw new Error(missing); throw error; }
}
/** Where the brain unit is found: the vendor folder beside runtime/ in the extracted download. */
const BRAIN_FOLDER = 'the vendor folder from the Foliage download, beside its runtime folder';
/** Said when the brain archive's folder is not there. @param {string} path */
const noBrainFolder = path => `There is no folder at ${path}. Pass ${BRAIN_FOLDER}.`;
/** Said when a new install's destination is taken. @param {string} destination */
const taken = destination => `${destination} already exists. Foliage installs only into a new folder and never changes an existing one: name a folder that does not exist yet. To add the brain to an existing install, use --add-brain.`;
/** Whether `to` is `from` or inside it. @param {string} from @param {string} to */
const inside = (from, to) => { const rel = relative(from, to); return rel === '' || (rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel)); };

/**
 * What the room check counts a copied file as: what this installer's copy (`cp`) allocates for it
 * on APFS, measured file by file for the brain unit on 2026-10-12 (Node 22.23, macOS arm64): whole
 * 4 KiB blocks up to 64 KiB, whole 64 KiB chunks up to 1 MiB, and above that whole MiB plus 64 KiB.
 * It met or exceeded every file's real allocation (389 MiB for a copy that took 372 MiB by du), where
 * plain bytes (about 304 MiB) or whole 4 KiB blocks (about 347 MiB) fell short. A file system that
 * allocates less is asked a little more.
 */
const BLOCK = 4096, CHUNK = 64 * 1024, MIB = 1024 * 1024;
/** @param {number} size @param {number} unit */
const roundUp = (size, unit) => Math.ceil(size / unit) * unit;
/** @param {number} size */
const onDisk = size => size > MIB ? roundUp(size, MIB) + CHUNK : size > CHUNK ? roundUp(size, CHUNK) : roundUp(size, BLOCK);

/**
 * What macOS leaves in a folder a person opens, and nobody shipped: Finder's folder settings
 * (`.DS_Store`), a folder's custom icon (`Icon` and a carriage return), the marker of a localized
 * folder name (`.localized`), and the AppleDouble companions (`._<name>`) that Archive Utility, or
 * a copy to a disk that is not APFS, writes beside files. One rule, the same one the brain's own
 * tree check keeps (`finderFile` in `apps/leaf/src/brainVendor.ts`): a REGULAR FILE with one of
 * these names, at any depth, is never copied, never hashed and never counted as unlisted, unless
 * the release lists it.
 * A link or a folder with such a name gets no pass: a link is refused like any unlisted file, and
 * a folder's contents are checked like any other folder's. A release never ships an AppleDouble
 * file: its archive refuses them.
 * @param {string} name a file's own name, not its path
 */
const finderFile = name => name === '.DS_Store' || name === 'Icon\r' || name === '.localized' || name.startsWith('._');

/**
 * What a copy of the checked release at `root` takes: everything but Finder's files, which a
 * listed path never counts as. @param {string} root @param {ReleaseFile[]} files
 */
function withoutFinderFiles(root, files) {
  const listed = new Set(files.map(entry => entry.path));
  /** @param {string} from */
  return async from => {
    const local = relative(root, from).split('\\').join('/');
    if (local === '' || listed.has(local) || !finderFile(basename(from))) return true;
    return !(await lstat(from)).isFile();
  };
}

/**
 * Every file under `root` against `files`: safe relative paths, no duplicates, links that stay inside,
 * digests, and no file the list does not name but Finder's (`finderFile`). `skip` is a top-level
 * folder checked as its own unit.
 * Returns what a copy of it takes on disk, by `onDisk`: every listed file and `release.json`, and a
 * 4 KiB block for each folder.
 * A listed file that is not there is named, with the same remedy as a changed one: `again`, which an
 * unlisted file is given too.
 * @param {string} root @param {ReleaseFile[]} files @param {string | null} skip @param {string} [again]
 */
async function verifyTree(root, files, skip, again = 'Obtain the archive again.') {
  const listed = new Set();
  let bytes = BLOCK;
  for (const entry of files) {
    if (!entry.path || isAbsolute(entry.path) || entry.path.split('/').some(p => !p || p === '.' || p === '..') || listed.has(entry.path) || entry.path === 'release.json') throw new Error('The release manifest contains an invalid or duplicate path.');
    listed.add(entry.path);
    const path = join(root, entry.path), missing = `Release file missing: ${entry.path}. ${again}`;
    if (relative(root, await realOr(dirname(path), missing)).split(/[\\/]/).includes('..')) throw new Error('A release path leaves the package.');
    const info = await lstat(path).catch(error => { throw absent(error) ? new Error(missing) : error; });
    if (entry.link !== undefined) {
      if (!info.isSymbolicLink() || await readlink(path) !== entry.link || isAbsolute(entry.link) || relative(root, await realOr(path, `Unsafe or changed release link: ${entry.path}`)).split(/[\\/]/).includes('..')) throw new Error(`Unsafe or changed release link: ${entry.path}`);
      continue;
    }
    const content = info.isFile() ? await readFile(path) : null;
    if (content === null || createHash('sha256').update(content).digest('hex') !== entry.sha256) throw new Error(`Release integrity check failed: ${entry.path}. ${again}`);
    bytes += onDisk(content.length);
  }
  // Refuse extra files too: an unlisted module must not change the executed import graph.
  // And extra folders: a folder the list names nothing in (empty, or holding only Finder's files)
  // was not shipped, whatever its name. Checked after its contents, so a stray file in it is named first.
  const folders = new Set();
  for (const path of listed) for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) folders.add(path.slice(0, at));
  /** @param {string} dir */
  async function inspect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), local = relative(root, path).split('\\').join('/');
      if (entry.isDirectory()) {
        if (local !== skip) {
          bytes += BLOCK;
          await inspect(path);
          if (!folders.has(local)) throw new Error(`Unlisted release folder: ${local}. ${again}`);
        }
      }
      else if (local === 'release.json') bytes += onDisk((await lstat(path)).size);
      else if (!listed.has(local) && !(entry.isFile() && finderFile(entry.name))) throw new Error(`Unlisted release file: ${local}. ${again}`);
    }
  }
  await inspect(root);
  return bytes;
}

/**
 * The main release, and its brain when `vendor/release.json` is there. `brain: 'ignore'` leaves
 * `vendor/` out entirely: replacing a brain checks the main release while the old brain may be the
 * part that is broken.
 * @param {string} source @param {{ brain?: 'verify' | 'ignore' }} [options]
 */
export async function verifyRuntime(source, { brain = 'verify' } = {}) {
  const missing = `No Foliage release is at ${source}: it holds no release.json. Pass the folder Foliage was extracted or installed to.`;
  source = await realOr(source, missing);
  /** @type {RuntimeManifest} */
  const manifest = JSON.parse(await readFile(join(source, 'release.json'), 'utf8').catch(error => { throw absent(error) ? new Error(missing) : error; }));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('The release manifest is invalid. Obtain the archive again.');
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error(`This package requires ${manifest.platform}/${manifest.arch}; this computer is ${process.platform}/${process.arch}.`);
  if (manifest.files.some(entry => typeof entry.path === 'string' && entry.path.split('/')[0] === BRAIN)) throw new Error(`The release manifest lists ${BRAIN}/, which only the brain's own release.json may list. Obtain the archive again.`);
  const unit = brain === 'ignore' || await exists(join(source, BRAIN, 'release.json'));
  await verifyTree(source, manifest.files, unit ? BRAIN : null);
  if (unit && brain === 'verify') await verifyBrainUnit(join(source, BRAIN), manifest.version);
  return manifest;
}

/**
 * A brain unit against its own `release.json`, for Foliage `version`: kind, platform, the version it
 * belongs to, its pins named, its bun and required files listed, then every file as `verifyTree`
 * checks the main release. Whether the pins are Foliage's is `verifyShippedBrain`'s to judge.
 * @param {string} directory @param {string | undefined} version
 */
export async function verifyBrainUnit(directory, version) {
  directory = await realOr(directory, noBrainFolder(directory));
  /** @type {BrainManifest} */
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8')); }
  catch { throw new Error(`This is not a Foliage brain: it has no readable release.json. Pass ${BRAIN_FOLDER}.`); }
  // A release or install folder passed for the brain has a release.json too: say what it is not.
  if (manifest?.kind !== BRAIN_KIND) throw new Error(`${directory} is not a Foliage brain: its release.json is not a brain's. Pass ${BRAIN_FOLDER}.`);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('The brain archive manifest is invalid. Obtain the brain archive again.');
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error(`This brain archive requires ${manifest.platform}/${manifest.arch}; this computer is ${process.platform}/${process.arch}.`);
  if (manifest.foliageVersion !== version) throw new Error(`This brain archive belongs to Foliage ${manifest.foliageVersion}, and this Foliage is ${version}. Use the brain archive released with this Foliage.`);
  const unnamed = BRAIN_PINS.filter(key => typeof manifest[key] !== 'string' || !manifest[key]);
  if (unnamed.length > 0) throw new Error(`The brain archive manifest names no ${unnamed.join(', ')}. Obtain the brain archive again.`);
  const listed = new Map(manifest.files.map(entry => [entry.path, entry]));
  if (listed.get('bun/bun')?.sha256 !== manifest['bunSha256']) throw new Error('The brain archive manifest does not list its own bun. Obtain the brain archive again.');
  const missing = BRAIN_REQUIRED.filter(path => !listed.get(path)?.sha256);
  if (missing.length > 0) throw new Error(`The brain archive lacks ${missing.join(', ')}. Obtain the brain archive again.`);
  return { manifest, directory, bytes: await verifyTree(directory, manifest.files, null, 'Obtain the brain archive again.') };
}

/**
 * Foliage's own brain checks, from the release at `root`. TypeScript, so loaded only once Node's own
 * check has passed. A release from before the local brain has none, and says so.
 * @param {string} root @returns {Promise<BrainChecks>}
 */
async function brainChecks(root) {
  const path = join(root, 'apps', 'leaf', 'src', 'brainVendor.ts');
  if (!(await exists(path))) throw new Error('This Foliage has no local brain support: it was released before the brain. Install the Foliage release that the brain archive was built with.');
  return import(pathToFileURL(path).href);
}

/** How a refusal by Foliage's preflight begins. */
const PREFLIGHT_REFUSED = 'The brain archive was refused: ';
/** Foliage's preflight, its refusal named as the brain archive's. @param {BrainChecks} checks @param {string} vendor */
async function preflight(checks, vendor) {
  try { await checks.verifyShippedBrain(vendor); }
  catch (error) { throw new Error(`${PREFLIGHT_REFUSED}${error instanceof Error ? error.message : String(error)}. Obtain the brain archive again.`); }
}

/**
 * The ways out the brain's checks end a refusal with. Each points at a brain archive, or a folder
 * the person passed, and neither fits the brain that came with the download: no brain archive is
 * published on its own, and the person passed nothing.
 */
const NAMED_BRAIN_REMEDIES = ['Obtain the brain archive again.', `Pass ${BRAIN_FOLDER}.`, 'Use the brain archive released with this Foliage.'];
/** The way out for the brain that came with the download: the download itself, again, or no brain. */
const DOWNLOAD_AGAIN = 'Download Foliage again from getfoliage.com/start and extract it into an empty folder, or add --no-brain to install Foliage without it.';
/**
 * A refusal of the brain beside runtime/ in the download: where it came from, what failed without
 * the way out meant for a brain the person named, then the download's own way out.
 * @param {string} brain @param {unknown} error
 */
function bundledRefusal(brain, error) {
  let cause = error instanceof Error ? error.message : String(error);
  if (cause.startsWith(PREFLIGHT_REFUSED)) cause = cause.slice(PREFLIGHT_REFUSED.length);
  for (const remedy of NAMED_BRAIN_REMEDIES) if (cause.endsWith(` ${remedy}`)) cause = cause.slice(0, -remedy.length - 1);
  return new Error(`The local brain that came with this download, at ${brain}, was refused: ${cause} ${DOWNLOAD_AGAIN}`, { cause: error });
}

/** Room for the brain's files and one empty garden brain on the disk `dir` is on. @param {BrainChecks} checks @param {string} dir @param {number} bytes */
async function roomFor(checks, dir, bytes) {
  const problem = checks.roomProblem(await checks.freeBytes(dir), bytes + checks.EMPTY_BRAIN_BYTES, 'The disk you are installing to');
  if (problem !== null) throw new Error(`${problem} for the brain and one empty garden brain. Nothing was installed.`);
}

/** The extracted brain archive: its `vendor/` folder, or the folder that holds it. @param {string} path */
async function brainSource(path) {
  return !(await exists(join(path, 'release.json'))) && await exists(join(path, BRAIN, 'release.json')) ? join(path, BRAIN) : path;
}

/**
 * The brain that came with the release at `source` in the one download: `vendor/` beside it, when
 * anything is there by that name, whatever it holds; otherwise null. Whether it is a brain at all is
 * for the `--with-brain` checks to say, so a broken one stops the install instead of being skipped.
 * @param {string} source the extracted runtime folder
 */
export async function downloadBrain(source) {
  const beside = join(dirname(source), BRAIN);
  return await exists(beside) ? beside : null;
}

/**
 * Whether a brain ships for this computer, by the rule of the release at `root` (`brainArchiveShips`
 * in its `apps/leaf/src/brainVendor.ts`, TypeScript, so asked only once Node's own check has passed).
 * A release from before the local brain ships none.
 * @param {string} root
 */
async function brainShipsHere(root) {
  const path = join(root, 'apps', 'leaf', 'src', 'brainVendor.ts');
  if (!(await exists(path))) return false;
  const { brainArchiveShips } = /** @type {{ brainArchiveShips(platform: string, arch: string): boolean }} */ (await import(pathToFileURL(path).href));
  return brainArchiveShips(process.platform, process.arch);
}

/**
 * A new install of the release at `source`, with the brain archive at `brain` when given. Both are
 * checked before anything is made; both are copied and checked again in one transaction, and any
 * failure removes the whole new destination. `bundled` says the brain is the one that came with the
 * download (`downloadBrain`), not one the person named: the checks are the same, and a refusal of it
 * says where it came from and to download Foliage again or add --no-brain (`bundledRefusal`); a lack
 * of room says only --no-brain. `checks` stands in for Foliage's own brain checks in tests whose
 * releases are synthetic.
 * @param {string} source @param {string} destination
 * @param {{ brain?: string, bundled?: boolean, checks?: (root: string) => Promise<BrainChecks> }} [options]
 */
export async function installRuntime(source, destination, { brain, bundled = false, checks = brainChecks } = {}) {
  const runtime = checkNode({ version: process.version, typescript: process.features.typescript });
  if (!runtime.ok) throw new Error(runtime.message);
  source = await realpath(source);
  destination = resolve(destination);
  const parent = dirname(destination);
  destination = join(await realOr(parent, `The folder ${parent} does not exist. Create it first, or name a new folder inside one that exists.`), basename(destination));
  if (inside(source, destination)) throw new Error('Choose an installation directory outside the extracted package.');
  if (await exists(destination)) throw new Error(taken(destination));
  // A release never holds the brain inside it: the brain comes beside it in the download, or through
  // --with-brain, and goes through the same checks either way, so its pins are always checked.
  // The folder may be a release folder a brain was moved or extracted into, or an install with its
  // brain (its own usage line points here), and nothing tells the two apart. Each case gets its own
  // sentence, the moved one first: its fix is done from this folder, and neither sends a person
  // back here to be refused again.
  if (await exists(join(source, BRAIN))) {
    throw new Error(`${source} holds a ${BRAIN}/ folder inside it, where no brain belongs: the download keeps the brain in ${BRAIN}/ beside the runtime folder, and a new install takes a brain only from there or through --with-brain, and checks it either way. `
      + `If you moved or extracted ${BRAIN}/ into this folder, move it out and pass its new path with --with-brain. `
      + `If this is an installed Foliage, run install.mjs from the runtime folder of the extracted download instead, with --with-brain ${join(source, BRAIN)}.`);
  }
  const manifest = await verifyRuntime(source);
  /** @type {Awaited<ReturnType<typeof verifyBrainUnit>> | null} */
  let unit = null;
  if (brain !== undefined) {
    // For the brain that came with the download, a refusal of it says so, and that the download is what to get again.
    /** @param {unknown} error */
    const refused = error => bundled ? bundledRefusal(brain, error) : error;
    let code;
    try { unit = await verifyBrainUnit(await brainSource(resolve(brain)), manifest.version); }
    catch (error) { throw refused(error); }
    // Where the person chose to install is not the brain's fault: said as it is, whichever brain it is.
    if (inside(unit.directory, destination)) throw new Error('Choose an installation directory outside the extracted brain archive.');
    try { code = await checks(source); await preflight(code, unit.directory); }
    catch (error) { throw refused(error); }
    // Nor is room: the brain that came with the download can only be left out.
    try { await roomFor(code, dirname(destination), unit.bytes); }
    catch (error) {
      if (!bundled) throw error;
      throw new Error(`${error instanceof Error ? error.message : String(error)} To install Foliage without the local brain, add --no-brain.`, { cause: error });
    }
  }
  // Existing installs and private records are never overwritten; exclusive, so a folder made since the check above stops here.
  await mkdir(destination).catch(error => { throw error?.code === 'EEXIST' ? new Error(taken(destination)) : error; });
  try {
    const copy = { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true };
    // Finder's files in the extracted folders stay behind: the copy holds only what was shipped.
    const shipped = { ...copy, filter: withoutFinderFiles(source, manifest.files) };
    for (const name of await readdir(source)) await cp(join(source, name), join(destination, name), shipped);
    if (unit !== null) await cp(unit.directory, join(destination, BRAIN), { ...copy, filter: withoutFinderFiles(unit.directory, unit.manifest.files) });
    await verifyRuntime(destination);
    if (unit !== null) await preflight(await checks(destination), join(destination, BRAIN));
  } catch (error) {
    try { await rm(destination, { recursive: true }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Installation failed and the incomplete destination could not be removed.'); }
    throw error;
  }
  return { directory: destination, version: manifest.version, brain: unit !== null };
}

/**
 * The brain archive at `brain` added to the existing install at `install`, or put in place of the one
 * it has (`replace`). The main install must check out first; the new brain is checked, copied to
 * `vendor.next/`, checked again there by the install's own Foliage, and renamed to `vendor/`. A
 * replaced brain steps aside to `vendor.old/` for the swap, is put back if the swap fails, and is
 * removed only after it; then the whole install is checked. Gardens are never read or touched.
 * @param {string} brain @param {string} install
 * @param {{ replace?: boolean, checks?: (root: string) => Promise<BrainChecks> }} [options]
 */
export async function addBrain(brain, install, { replace = false, checks = brainChecks } = {}) {
  const runtime = checkNode({ version: process.version, typescript: process.features.typescript });
  if (!runtime.ok) throw new Error(runtime.message);
  install = await realOr(install, `There is no Foliage install at ${install}. Pass the folder Foliage was installed to.`);
  const target = join(install, BRAIN), next = join(install, `${BRAIN}.next`), old = join(install, `${BRAIN}.old`);
  for (const left of [next, old]) {
    if (await exists(left)) throw new Error(`An earlier brain install did not finish: ${left} is left over. Remove that folder, then run this again.`);
  }
  const present = await exists(target);
  if (present && !replace) throw new Error(`This Foliage already has a brain at ${target}. To put another in its place, use --replace-brain.`);
  if (!present && replace) throw new Error('This Foliage has no brain to replace. To add one, use --add-brain.');
  const manifest = await verifyRuntime(install, { brain: 'ignore' });
  const from = await brainSource(resolve(brain));
  if (inside(install, await realOr(from, noBrainFolder(from)))) throw new Error('Pass the vendor folder extracted from the brain archive, not one inside this install.');
  const unit = await verifyBrainUnit(from, manifest.version);
  const code = await checks(install);
  await preflight(code, unit.directory);
  await roomFor(code, install, unit.bytes);
  await mkdir(next); // Exclusive: a second installer at the same time stops here.
  try {
    const copy = { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true };
    const shipped = { ...copy, filter: withoutFinderFiles(unit.directory, unit.manifest.files) };
    for (const name of await readdir(unit.directory)) await cp(join(unit.directory, name), join(next, name), shipped);
    await verifyBrainUnit(next, manifest.version);
    await preflight(code, next);
  } catch (error) {
    await rm(next, { recursive: true, force: true });
    throw error;
  }
  // The swap: the old brain steps aside, the checked one takes its name, and only then is the old one removed.
  if (present) await rename(target, old);
  try { await rename(next, target); }
  catch (error) {
    await rm(next, { recursive: true, force: true }).catch(() => undefined);
    if (present) await rename(old, target).catch(() => undefined);
    throw error;
  }
  if (present) await rm(old, { recursive: true, force: true });
  await verifyRuntime(install);
  return { directory: install, version: manifest.version, replaced: present };
}

/**
 * Whether `path` is a file marked to run, read from its metadata alone. Not `access(X_OK)`: macOS's
 * sandbox counts that as starting the program, and the offline gate kills the installer for it.
 * @param {string} path
 */
const runnable = path => stat(path).then(info => info.isFile() && (info.mode & 0o111) !== 0, () => false);

/**
 * Why git answers nothing here, or null when it does: grow's two answers (`GitAbsence` in
 * apps/leaf/src/gitNeeded.ts), found WITHOUT STARTING A PROGRAM. Grow asks `git --version`; the
 * installer starts nothing but node (the offline gate in tools/deploy/package-local.test.mjs kills
 * it if it does), so it looks at files instead:
 *  - no runnable `git` on PATH (or on /usr/bin:/bin, which is where a program is looked for when
 *    PATH is unset): git is not installed here;
 *  - on a Mac, /usr/bin/git found first is Apple's stub, which runs git only from a developer
 *    folder (Xcode's, or the Command Line Tools') that holds one. With none of the folders it may
 *    use holding git, the stub only exits non-zero: the git here does not run.
 * The folders the stub may use are DEVELOPER_DIR, xcode-select's choice (a link in /var/db or
 * /var/select, when one was written), every Xcode*.app in /Applications and the Command Line Tools.
 * Every Xcode there, not only Xcode.app: xcode-select answers for one that has no link written, so
 * an Xcode-beta.app missed here would be wrongly called a git that does not run.
 * Any other git found is taken to run. When it is unsure it says nothing, and grow, which does run
 * git, says what is wrong when it is first used. `root` stands in for `/` when those folders are
 * looked for, for tests.
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, root?: string }} [options]
 * @returns {Promise<'git is not installed here' | 'the git here does not run' | null>}
 */
export async function gitAbsenceHere({ env = process.env, platform = process.platform, root = '/' } = {}) {
  let found = null;
  for (const dir of (env['PATH'] ?? '/usr/bin:/bin').split(':')) {
    if (isAbsolute(dir) && await runnable(join(dir, 'git'))) { found = join(dir, 'git'); break; }
  }
  if (found === null) return 'git is not installed here';
  if (platform !== 'darwin' || found !== '/usr/bin/git') return null;
  const applications = join(root, 'Applications');
  const xcodes = await readdir(applications).then(names => names.filter(name => /^Xcode.*\.app$/.test(name)), () => []);
  /** @type {readonly string[]} */
  const dirs = [
    env['DEVELOPER_DIR'],
    await readlink(join(root, 'var', 'db', 'xcode_select_link')).catch(() => undefined),
    await readlink(join(root, 'var', 'select', 'developer_dir')).catch(() => undefined),
    ...xcodes.map(name => join(applications, name, 'Contents', 'Developer')),
    join(root, 'Library', 'Developer', 'CommandLineTools'),
  ].filter(/** @returns {dir is string} */ dir => typeof dir === 'string' && dir !== '');
  for (const dir of dirs) if (await runnable(join(dir, 'usr', 'bin', 'git'))) return null;
  return 'the git here does not run';
}

/** This installer by its full path, so each usage line runs as printed from any folder. */
const SELF = `node ${JSON.stringify(fileURLToPath(import.meta.url))}`;
const USAGE = `Usage: ${SELF} /absolute/new-install-directory [--no-brain | --with-brain /absolute/extracted/vendor] [--with-aside --garden /absolute/existing/garden]\n`
  + `       ${SELF} --add-brain|--replace-brain /absolute/extracted/vendor /absolute/existing-install`;

const HELP = `${USAGE}

Checks every file of this extracted release, then copies it into a new folder. The new folder's
parent must exist, and the folder itself must not: an existing folder is never changed.
The local brain in the download's vendor folder, beside this runtime folder, is checked and
installed too; if it fails its checks, nothing is installed.
  --no-brain       installs without the local brain
  --with-brain     installs the local brain from the vendor folder you name instead
  --add-brain      adds that brain to an existing install; --replace-brain puts it in place of the one it has
  --with-aside     also prepares the Aside browser connection for an existing garden
No garden is read and no background service is enabled.
`;

async function main() {
  let parsed;
  try {
    parsed = parseArgs({strict:true,allowPositionals:true,tokens:true,options:{
      'with-aside':{type:'boolean'},garden:{type:'string'},'with-brain':{type:'string'},'no-brain':{type:'boolean'},'add-brain':{type:'string'},'replace-brain':{type:'string'},
      help:{type:'boolean',short:'h'},
    }});
  } catch (error) { throw new Error(`${error instanceof Error ? error.message.split('. ')[0] : 'Unreadable arguments'}.\n${USAGE}`); }
  const {values,positionals,tokens} = parsed;
  if (values.help) { process.stdout.write(HELP); return; }
  const seen = new Set();
  for (const token of tokens) if (token.kind === 'option') {
    if (seen.has(token.name)) throw new Error(`Repeated --${token.name}.`);
    seen.add(token.name);
  }
  const folder = positionals[0];
  if (positionals.length !== 1 || !folder) throw new Error(USAGE);
  if (!isAbsolute(folder)) throw new Error(`The install folder must be an absolute path, one that starts with /: ${folder} is relative.\n${USAGE}`);
  for (const flag of /** @type {const} */ (['with-brain', 'add-brain', 'replace-brain'])) {
    const value = values[flag];
    if (value !== undefined && !isAbsolute(value)) throw new Error(`--${flag} needs the absolute path of ${BRAIN_FOLDER}.`);
  }
  if (values['no-brain'] && values['with-brain'] !== undefined) throw new Error('Use --no-brain or --with-brain, not both.');
  const later = values['add-brain'] ?? values['replace-brain'];
  if (later !== undefined) {
    if (values['add-brain'] !== undefined && values['replace-brain'] !== undefined) throw new Error('Use --add-brain or --replace-brain, not both.');
    if (values['with-brain'] !== undefined || values['no-brain'] || values['with-aside'] || values.garden) throw new Error(`${USAGE}\n--add-brain and --replace-brain work on an existing install on their own.`);
    const result = await addBrain(later, positionals[0] ?? '', { replace: values['replace-brain'] !== undefined });
    console.log(`${result.replaced ? 'Replaced the brain of' : 'Added the brain to'} Foliage ${result.version} at ${result.directory}.\nBuild a garden's brain: node ${JSON.stringify(join(result.directory, 'foliage.mjs'))} brain build --garden /absolute/path/to/your/garden\nNo garden was read or changed, and nothing was downloaded.`);
    return;
  }
  if (values['with-aside']) {
    if (!values.garden || !isAbsolute(values.garden) || !(await lstat(values.garden).then(info => info.isDirectory(), () => false))) throw new Error('--with-aside requires an existing absolute --garden.');
  } else if (values.garden) throw new Error('--garden requires --with-aside.');
  const source = dirname(fileURLToPath(import.meta.url));
  // No brain flag: the brain that came beside this runtime folder in the download, through the same path as --with-brain.
  const flagged = values['with-brain'] !== undefined || !!values['no-brain'];
  const bundled = flagged ? null : await downloadBrain(source);
  const brain = values['with-brain'] ?? bundled ?? undefined;
  const result = await installRuntime(source, positionals[0] ?? '', brain === undefined ? {} : { brain, bundled: bundled !== null });
  // No flag and no brain beside it, where one ships (a runtime folder copied out of the download, say):
  // installed without it, and said so, since the download promised it.
  const missed = !flagged && bundled === null && await brainShipsHere(source);
  if (values['with-aside']) {
    const setup = spawnSync(process.execPath, [join(result.directory,'tools/install/aside.mjs'),'setup','--garden',values.garden ?? '', '--install-cli'], {stdio:'inherit',timeout:200000});
    if (setup.error || setup.status !== 0) throw new Error(`Foliage installed at ${result.directory}; Aside setup is incomplete. Retry tools/install/aside.mjs setup from the installed directory.`);
  }
  const foliage = `node ${JSON.stringify(join(result.directory, 'foliage.mjs'))}`;
  // Grow reads a repository with git, so its absence is said, and only then (`gitAbsenceHere`).
  const noGit = await gitAbsenceHere();
  const gitNote = noGit === null ? '' : `\nGrow needs git, and ${noGit} (on a Mac: xcode-select --install).`;
  if (bundled !== null) console.log('The local brain that came with this download was included. It runs on this computer only; install with --no-brain to leave it out.');
  if (missed) console.log(`No local brain was found beside this runtime folder, so Foliage was installed without it. Add it later from the Foliage download: node ${JSON.stringify(join(result.directory, 'install.mjs'))} --add-brain /absolute/path/to/the/extracted/vendor ${JSON.stringify(result.directory)}`);
  console.log(`Installed Foliage ${result.version}${result.brain ? ' with its local brain' : ''} at ${result.directory}.\nStart: ${foliage} up\nGrow:  ${foliage} grow --repo /absolute/path/to/a/git/repository${gitNote}\nNo foliage command was added to your PATH; run Foliage as shown. No sources were read and no background service was enabled.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Installation failed.'); process.exitCode = 1; }
}
