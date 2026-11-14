#!/usr/bin/env node
/**
 * The local release, preserving the open dependency boundary and native TypeScript, and the one
 * download that carries it with the local brain (`packageDownload`).
 *
 *   node tools/deploy/package-local.mjs <new-directory> [--include-working-tree]             the runtime tree alone
 *   node tools/deploy/package-local.mjs <new-directory> --archive [--include-working-tree]   the one download
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { packageCanopy } from './package-canopy.mjs';
import { brainStage, buildBrainUnit } from './package-brain.mjs';
import { brainArchiveShips } from '../../apps/leaf/src/brainVendor.ts';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { rm } from 'node:fs/promises';
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/**
 * HOW EVERY RELEASE ARCHIVE IS PACKED: bsdtar, the build machine's /usr/bin/tar on macOS, with no
 * extended attributes (macOS stamps com.apple.provenance on every file a process writes), ACLs, file
 * flags or AppleDouble metadata, and every entry owned by 0:0 with no user or group name. The 0.3.0
 * runtime archive was packed by hand without these and carried the builder's name and a provenance
 * record on all 5,889 entries.
 */
const RELEASE_TAR_FLAGS = Object.freeze(['--no-xattrs', '--no-acls', '--no-fflags', '--no-mac-metadata', '--numeric-owner', '--uid', '0', '--gid', '0']);
/** pax records that say nothing about the machine or person that packed the archive: a long path or link target. */
const NEUTRAL_PAX = new Set(['path', 'linkpath']);
/**
 * Names nobody ships: what Finder leaves in a folder a person opened (its settings, a custom folder
 * icon, a localized-name marker) and git's own files and folders (`.git`, `.github`, `.gitignore`,
 * `.gitattributes` and the like), at any depth. AppleDouble `._` files are named on their own below.
 */
const UNSHIPPED_NAME = /^(?:\.DS_Store|Icon\r|\.localized|\.git.*)$/;
/**
 * @typedef {{ name: string, type: string, mode: number, uid: number, gid: number, uname: string, gname: string, pax: string[] }} TarEntry
 */
/**
 * Every entry of a .tgz as its header stores it, with the keys of any pax records before it, read
 * without extracting anything. Streams, so a 340 MB tree is never held in memory. Handles what bsdtar
 * writes: ustar headers with a prefix, and pax `x` and `g` records.
 * @param {string} archive @returns {Promise<TarEntry[]>}
 */
export async function tarEntries(archive) {
  /** @type {TarEntry[]} */
  const entries = [];
  let carry = Buffer.alloc(0), skip = 0, ended = false;
  /** @type {{ type: string, size: number, padded: number, parts: Buffer[], got: number } | null} */
  let record = null;
  /** @type {string[]} */
  let pax = [];
  /** @type {string | null} */
  let paxPath = null;
  for await (const chunk of createReadStream(archive).pipe(createGunzip())) {
    if (ended) continue;
    const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    let at = 0;
    for (;;) {
      if (skip > 0) {
        const step = Math.min(skip, data.length - at);
        skip -= step; at += step;
        if (skip > 0) break;
      }
      if (record !== null) {
        const step = Math.min(record.padded - record.got, data.length - at);
        record.parts.push(data.subarray(at, at + step));
        record.got += step; at += step;
        if (record.got < record.padded) break;
        // "<length> <key>=<value>\n" one after another, the length in bytes and counting itself;
        // a value (an extended attribute's bytes) may hold a line break.
        const body = Buffer.concat(record.parts).subarray(0, record.size);
        if (record.type === 'L' || record.type === 'K') pax.push(`a GNU ${record.type} record`);
        else {
          for (let pos = 0; pos < body.length;) {
            const space = body.indexOf(0x20, pos);
            const length = space < 0 ? NaN : Number.parseInt(body.subarray(pos, space).toString('latin1'), 10);
            if (!Number.isInteger(length) || length <= space - pos) { pax.push('an unreadable pax record'); break; }
            const field = body.subarray(space + 1, pos + length - 1);
            const equals = field.indexOf(0x3d);
            const key = field.subarray(0, equals < 0 ? field.length : equals).toString('utf8');
            pax.push(record.type === 'g' ? `global ${key}` : key);
            if (record.type === 'x' && key === 'path' && equals >= 0) paxPath = field.subarray(equals + 1).toString('utf8');
            pos += length;
          }
        }
        record = null;
        continue;
      }
      if (data.length - at < 512) break;
      const header = data.subarray(at, at + 512);
      at += 512;
      if (header.every((/** @type {number} */ byte) => byte === 0)) { ended = true; break; }
      const text = (/** @type {number} */ start, /** @type {number} */ length) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '');
      const octal = (/** @type {number} */ start, /** @type {number} */ length) => Number.parseInt(text(start, length).trim() || '0', 8);
      const type = header[156] === 0 ? '0' : String.fromCharCode(header[156] ?? 48);
      const size = octal(124, 12), padded = Math.ceil(size / 512) * 512;
      if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
        record = { type, size, padded, parts: [], got: 0 };
        continue;
      }
      const prefix = text(345, 155), name = text(0, 100);
      entries.push({ name: paxPath ?? (prefix ? `${prefix}/${name}` : name), type, mode: octal(100, 8), uid: octal(108, 8), gid: octal(116, 8),
        uname: text(265, 32), gname: text(297, 32), pax });
      pax = []; paxPath = null;
      skip = padded;
    }
    carry = Buffer.from(data.subarray(at));
  }
  if (!ended) throw new Error(`${archive} ends before its end-of-archive marker`);
  return entries;
}
/**
 * What in a release archive's headers names the machine or person that packed it, or lets anyone
 * but its owner change what it installs, or was never meant to ship: pax records other than a long
 * path, an owner other than 0:0 or any owner name, AppleDouble files, Finder's and git's own files
 * (`UNSHIPPED_NAME`), a directory stored other than 0755, and a file or link target writable by
 * group or others. Pure. Empty means the archive is clean.
 * @param {readonly TarEntry[]} entries
 */
export function releaseMetadataProblems(entries) {
  /** @type {string[]} */
  const problems = [];
  for (const entry of entries) {
    const mode = (entry.mode & 0o7777).toString(8).padStart(4, '0');
    const named = entry.pax.filter(key => !NEUTRAL_PAX.has(key));
    if (named.length > 0) problems.push(`${entry.name} carries ${named.join(', ')}`);
    if (entry.uid !== 0 || entry.gid !== 0 || entry.uname !== '' || entry.gname !== '') problems.push(`${entry.name} is owned by ${entry.uname || entry.uid}:${entry.gname || entry.gid}, not 0:0 with no names`);
    if (entry.name.split('/').some(part => part.startsWith('._'))) problems.push(`${entry.name} is an AppleDouble file`);
    const unshipped = entry.name.split('/').find(part => UNSHIPPED_NAME.test(part));
    if (unshipped !== undefined) problems.push(`${entry.name} is ${unshipped.startsWith('.git') ? "one of git's own files" : "a file Finder leaves"}, which no release ships`);
    if (entry.type === '5' && (entry.mode & 0o7777) !== 0o755) problems.push(`${entry.name} is a directory stored mode ${mode}, not 0755`);
    if (entry.type !== '5' && entry.type !== '2' && (entry.mode & 0o022) !== 0) problems.push(`${entry.name} is stored mode ${mode}, writable by group or others`);
  }
  return problems;
}
/**
 * Packs `<parent>/<top>` (each of them, in order, when `top` is a list) into the new archive
 * `archive` with `RELEASE_TAR_FLAGS`, then reads every header back and refuses, removing the
 * archive, if anything in them names the builder, is writable by others or was never meant to ship
 * (`releaseMetadataProblems`). Returns the entries.
 * @param {string} archive @param {string} parent @param {string | readonly string[]} top
 */
export async function releaseTarball(archive, parent, top) {
  const env = { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1', LC_ALL: 'C' };
  if (await lstat(archive).then(() => true, () => false)) throw new Error(`${archive} already exists; a release archive is always new.`);
  const tops = typeof top === 'string' ? [top] : [...top];
  const packed = spawnSync('/usr/bin/tar', [...RELEASE_TAR_FLAGS, '-czf', archive, '-C', parent, ...tops], { encoding: 'utf8', env, timeout: 600_000 });
  if (packed.error || packed.status !== 0) throw new Error(`/usr/bin/tar failed: ${packed.error?.message ?? String(packed.stderr).trim().split('\n').slice(-3).join(' | ')}`);
  const entries = await tarEntries(archive);
  const problems = releaseMetadataProblems(entries);
  if (problems.length > 0) {
    await rm(archive, { force: true });
    throw new Error(`${basename(archive)} would carry what the release must not (${problems.length} entries), so it was removed:\n  ${problems.slice(0, 10).join('\n  ')}`);
  }
  return entries;
}
/** @typedef {{path:string,sha256?:string,link?:string}} RuntimeFile */
/**
 * Every file under `directory` but its own `release.json`, with what the release says of itself. The
 * brain archive writes its own this way (`package-brain.mjs`), with its kind and pins beside these.
 * @param {string} directory @param {{version?:string,platform:string,arch:string,revision?:string,workingTree?:boolean} & Record<string, unknown>} metadata
 */
export async function writeRuntimeManifest(directory, metadata) {
  const files = /** @type {RuntimeFile[]} */ ([]);
  /** @param {string} dir */
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), local = relative(directory, path).split('\\').join('/');
      const info = await lstat(path);
      if (info.isDirectory()) await walk(path);
      else if (info.isSymbolicLink()) files.push({ path: local, link: await readlink(path) });
      else if (local !== 'release.json') files.push({ path: local, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
    }
  }
  await walk(directory);
  const manifest = { schemaVersion: 1, ...metadata, files };
  await writeFile(join(directory, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
/** A package's licence and notice files, by name, at its own top level. */
const LICENSE_FILE = /^(?:licen[cs]e|notice|copying|unlicense)(?:[.-][\w.-]*)?$/i;
/**
 * @typedef {{ name: string, text: string }} LicenseText
 * @typedef {{ path: string, name: string, version: string, license: string, dependencies: string[], files: LicenseText[] }} LicensedPackage
 */
/**
 * One installed package's declared licence, what it depends on and its own licence and notice files
 * verbatim, or null when the directory holds no readable package.json. Shared by both release archives.
 * @param {string} path @param {string} shown where the notices say it lives @returns {Promise<LicensedPackage | null>}
 */
export async function licensedPackage(path, shown) {
  let manifest;
  try { manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')); } catch { return null; }
  const declared = manifest.license ?? manifest.licenses ?? null;
  const license = typeof declared === 'string' ? declared
    : Array.isArray(declared) ? declared.map(entry => entry?.type ?? String(entry)).join(' OR ')
    : declared && typeof declared === 'object' ? String(declared.type ?? 'unstated') : 'unstated';
  /** @type {LicenseText[]} */
  const files = [];
  for (const file of (await readdir(path)).sort()) {
    if (LICENSE_FILE.test(file) && (await lstat(join(path, file))).isFile()) files.push({ name: file, text: await readFile(join(path, file), 'utf8') });
  }
  return { path: shown, name: String(manifest.name ?? basename(path)), version: String(manifest.version ?? ''), license,
    dependencies: Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }), files };
}
export const NOTICE_RULE = '='.repeat(80);
/** "MIT 3, 0BSD 1": packages by declared licence. Pure. @param {readonly LicensedPackage[]} packages */
export function licenseTally(packages) {
  const counts = new Map();
  for (const entry of packages) counts.set(entry.license, (counts.get(entry.license) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a < b ? -1 : 1).map(([license, count]) => `${license} ${count}`).join(', ');
}
/** Packages that ship no licence file, as one line for counsel, or none. Pure. @param {readonly LicensedPackage[]} packages */
export function unlicensedLine(packages) {
  const unlicensed = packages.filter(entry => entry.files.length === 0);
  return unlicensed.length > 0 ? [`  - ${unlicensed.length} packages ship no licence file; their package.json declares one: ${unlicensed.map(entry => `${entry.name}@${entry.version} (${entry.license})`).join(', ')}.`] : [];
}
/** Every package's own licence texts, verbatim, under a header naming where it lives. Pure.
 * @param {readonly LicensedPackage[]} packages @param {string} prefix */
export function licenseSections(packages, prefix) {
  return packages.flatMap(entry => [NOTICE_RULE, `${entry.name}@${entry.version} · ${entry.license} · ${prefix}${entry.path}`, NOTICE_RULE,
    ...entry.files.length === 0 ? [`No licence file ships in this package. Its package.json declares: ${entry.license}.`, ''] : [],
    ...entry.files.flatMap(file => [`--- ${file.name}`, file.text.trimEnd(), ''])]);
}
/**
 * THIRD-PARTY-NOTICES for the runtime archive: every package `package-canopy.mjs` copied under
 * `node_modules/.runtime`, its declared licence, and its own licence and notice files verbatim. Nothing
 * is relicensed. Foliage's own code is MIT. The brain archive writes its own (`package-brain.mjs`).
 * @param {string} output @param {string} version
 */
async function runtimeNotices(output, version) {
  const base = join(output, 'node_modules', '.runtime');
  /** @type {Map<string, LicensedPackage>} */
  const found = new Map();
  for (const dir of (await readdir(base).catch(() => [])).sort((a, b) => Number(a) - Number(b))) {
    const entry = await licensedPackage(join(base, dir), `node_modules/.runtime/${dir}`);
    if (entry && !found.has(`${entry.name}@${entry.version}`)) found.set(`${entry.name}@${entry.version}`, entry);
  }
  const packages = [...found.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const copyleft = packages.filter(entry => /GPL/i.test(entry.license)).map(entry => `  - ${entry.name}@${entry.version} is ${entry.license}.`);
  const counsel = [...copyleft, ...unlicensedLine(packages)];
  return `${[
    `THIRD-PARTY NOTICES for the Foliage local runtime ${version}`,
    '',
    'This archive bundles software made by others, under node_modules/.runtime and inside the browser',
    'bundles built from it. Each package keeps its own licence, and nothing here relicenses anything.',
    'Generated by tools/deploy/package-local.mjs from the packaged tree.',
    '',
    `  ${packages.length} packages, by declared licence: ${licenseTally(packages) || 'none'}.`,
    "  Foliage's own code in this archive is licensed MIT (see LICENSE in the source repository).",
    '',
    'FOR COUNSEL BEFORE RELEASE:',
    ...counsel.length > 0 ? counsel : ['  - Nothing found here: every package declares a licence and ships its text.'],
    '',
    ...licenseSections(packages, ''),
  ].join('\n')}\n`;
}
/**
 * Step 2's one command: the download extracted into a new folder of its own, then into its runtime
 * folder. The download holds two top-level folders where a brain ships, and Archive Utility (a
 * Finder double-click) puts an archive with more than one into a folder named after it, so a bare
 * 'cd runtime' from the download's folder would not find it; and tar into a shared folder would mix
 * runtime/ and vendor/ with any earlier ones there. mkdir refuses a folder that exists.
 */
export const EXTRACT = 'mkdir ~/foliage-download && tar -xzf <file> -C ~/foliage-download && cd ~/foliage-download/runtime';
/**
 * The runtime folder's START-HERE.md. The one download unpacks into a folder named `runtime`, with
 * the local brain in `vendor` beside it where one ships, so every install step says to run it from
 * there (`EXTRACT`); and the installer puts no `foliage` command on PATH, so every command is node
 * and the full path to the installed foliage.mjs. Pure.
 * @param {string} platform @param {string} arch
 */
export function runtimeStartHere(platform, arch) {
  // The brain ships only where Foliage pins the bun it carries (unit 38, build order item 7).
  const ships = brainArchiveShips(platform, arch);
  const brainNote = ships
    ? `
## Local brain (included)

The download includes the local brain, which searches your record: the vendor folder beside runtime, a pinned gbrain and the bun that runs it. It runs on this Mac only and never uses the network, and nothing else is installed or downloaded for it. The installer checks every file of it and installs it with Foliage. To install without it, run the installer from the runtime folder with --no-brain: 'node install.mjs /absolute/path/to/a/new/foliage-folder --no-brain'. To add it to that install later, from the same download: 'node /absolute/foliage-folder/install.mjs --add-brain /absolute/path/to/the/extracted/vendor /absolute/foliage-folder'. Build a garden's brain with 'node /absolute/foliage-folder/foliage.mjs brain build --garden /absolute/garden'. Its licences are in vendor/THIRD-PARTY-NOTICES.
`
    : `
## Local brain

The local brain is not included for ${platform}/${arch} yet. Search uses Foliage's own search, and 'node /absolute/foliage-folder/foliage.mjs brain status' says the brain is not installed.
`;
  return `# Foliage local release candidate

Requires Node 22.18–24 on ${platform}/${arch}. No pnpm, repository checkout or dependency download is needed at runtime.

1. Check the .tgz you downloaded: its SHA-256 is published next to the download on getfoliage.com/start, and 'shasum -a 256 <file>' must print the same value. The manifests inside check file integrity; they are not a publisher signature.
2. Extract it into a new, empty folder and go into the runtime folder there. In a terminal: '${EXTRACT}'.${ships ? ' (Double-clicking the file in Finder instead puts its runtime and vendor folders in a folder named after the download: go into the runtime folder inside it.)' : ''} The runtime folder holds this file${ships ? '; the vendor folder beside it holds the local brain' : ''}. From the runtime folder, run: 'node install.mjs /absolute/path/to/a/new/foliage-folder'.${ships ? ' This installs Foliage with its local brain.' : ''} The new folder's parent must exist. Existing installs are never overwritten.
3. Run 'node /absolute/path/to/a/new/foliage-folder/foliage.mjs up' and open the loopback URL printed by the app.
4. Grow your record from a Git repository you work in: 'node /absolute/path/to/a/new/foliage-folder/foliage.mjs grow --repo /absolute/path/to/the/repository'. Grow names you by that repository's git user.email and user.name. If git has no user.email or user.name for that repository, add both: 'node /absolute/path/to/a/new/foliage-folder/foliage.mjs grow --repo /absolute/path/to/the/repository --identity <email> --subject "<name>"'. Then decide each draft at /review in the app: no draft joins your record without you.
5. Or choose sources, or import existing portfolio writing, in the workspace. Import stays private until reviewed and deliberately shared.

Grow and sources read your repository's history with git, so git must be installed. On a Mac without it, 'git --version' offers to install the Xcode Command Line Tools, which include git; 'xcode-select --install' does the same.

The installer puts no 'foliage' command on your PATH. Run Foliage as these steps do: node and the full path to the installed foliage.mjs.

Your record defaults to ~/.foliage and stays separate from the installed application. Use --garden with another path to select another private record. Back up this folder separately.

Updates: stop the old process, install the new release in another directory, then start it with the same --garden. Retain the previous app directory and a record backup for recovery. To uninstall, stop the process and remove only the app directory; your record remains.

This open local package does not include the closed Canopy hosting service, a bundled Node interpreter, or a signed native application. Publication requires the separately configured Canopy companion/service. No login item is enabled by installation.

## Aside browser connection (optional)

Aside setup is included in this archive. From the runtime folder, install with 'node install.mjs /absolute/new/foliage-folder --with-aside --garden /absolute/existing/garden' to also prepare the connection. On macOS this explicitly installs the official Aside CLI when missing; the browser app and sign-in remain separate. Other platforms use the vendor instructions at https://docs.aside.com/help/developers.

You can connect later with 'node /absolute/new/foliage-folder/tools/install/aside.mjs setup --garden /absolute/existing/garden --install-cli'. This writes garden/integrations/aside.mcp.json for a host supporting mcpServers; add its two server entries to that host without replacing existing settings. It does not change host settings or enable capture, private search, authoring or publication.

After opening and signing into Aside, run 'node /absolute/new/foliage-folder/tools/install/aside.mjs doctor --probe'. Then ask the connected agent to inspect a selected page and submit the permitted evidence through foliage_submit_observations. Review candidates at /review. The probe alone does not prove capture.
${brainNote}`;
}
/** @param {string} output @param {{root?:string,includeWorkingTree?:boolean}} [options] */
export async function packageLocal(output, { root = ROOT, includeWorkingTree = false } = {}) {
  const dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim();
  if (dirty && !includeWorkingTree) throw new Error('Commit the release source first, or use --include-working-tree for a local candidate.');
  const assets = ['packages/ui/build/portfolio-leaf.bundle.js', 'packages/ui/build/portfolio-leaf.receipt.json', 'apps/leaf/public/workflow.js', 'apps/leaf/public/workflow.css', 'apps/leaf/public/compound-leaf.bundle.js'];
  const result = await packageCanopy(output, root, { generatedAssets: assets, entryPackages: ['@foliage/leaf-app'], includeWorkingTree });
  const sourceManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const copies = /** @type {[string,string][]} */ ([
    ['foliage.mjs', 'foliage.mjs'], ['tools/install/runtime-install.mjs', 'install.mjs'],
    ['tools/install/requirements.mjs', 'requirements.mjs'],
    ['tools/install/aside.mjs', 'tools/install/aside.mjs'],
    // Photosynthesis re-exports the existing vault ranker for both private and public search.
    ['tools/vault/lib/rank.mjs', 'tools/vault/lib/rank.mjs'],
    // Local MCP and the capture launcher import these outside the workspace package graph.
    // Include the exact runtime modules, not smoke tests, scenarios or Docker build inputs.
    ...['eval/cli.mjs', 'eval/local.mjs', 'eval/process.mjs', 'eval/contract.mjs',
      'eval/browser.mjs', 'eval/observation.mjs', 'eval/import.mjs',
      'capture/capture.mjs', 'capture/cdp.mjs'].map(path => [`tools/${path}`, `tools/${path}`]),
  ]);
  for (const [from, to] of copies) {
    await mkdir(dirname(join(output, to)), { recursive: true });
    await copyFile(join(root, from), join(output, to));
  }
  await writeFile(join(output, 'package.json'), JSON.stringify({ name: 'foliage-local-runtime', private: true, type: 'module', version: sourceManifest.version, engines: sourceManifest.engines }, null, 2));
  await writeFile(join(output, 'START-HERE.md'), runtimeStartHere(process.platform, process.arch));
  await writeFile(join(output, 'THIRD-PARTY-NOTICES'), await runtimeNotices(output, sourceManifest.version), { flag: 'wx' });
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const manifest = await writeRuntimeManifest(output, { version: sourceManifest.version, revision, workingTree: dirty, platform: process.platform, arch: process.arch });
  return { ...result, files: manifest.files.length, revision, workingTree: dirty };
}

const MIB = 1024 * 1024;
/**
 * GitHub blocks a file over 100 MiB and warns about one over 50 MiB. The one download is refused at
 * 100 MiB or more and warned about at 50 MiB or more.
 */
export const DOWNLOAD_LIMITS = Object.freeze({ refuse: 100 * MIB, warn: 50 * MIB });

/**
 * The one download's name: `foliage-<version>-<platform>-<arch>-<rev7>.tgz`, the commit it was built
 * from in its last part, and `-dirty` after it when uncommitted changes went in. Pure.
 * @param {string} version @param {string} platform @param {string} arch @param {string} revision @param {boolean} [workingTree]
 */
export const downloadName = (version, platform, arch, revision, workingTree = false) => `foliage-${version}-${platform}-${arch}-${revision.slice(0, 7)}${workingTree ? '-dirty' : ''}.tgz`;

/**
 * What an archive's size means for publishing it, in plain words: `refuse` at 100 MiB or more,
 * `warn` from 50 MiB, neither below. Pure.
 * @param {string} name @param {number} bytes @returns {{ refuse?: string, warn?: string }}
 */
export function downloadSize(name, bytes) {
  const size = `${name} is ${(bytes / MIB).toFixed(1)} MiB (${bytes} bytes)`;
  if (bytes >= DOWNLOAD_LIMITS.refuse) return { refuse: `${size}, at or over GitHub's 100 MiB limit, so it could not be published there. Nothing was kept.` };
  if (bytes >= DOWNLOAD_LIMITS.warn) return { warn: `${size}, at or over 50 MiB. GitHub warns about a file over 50 MiB and blocks one over 100 MiB.` };
  return {};
}

/**
 * THE ONE DOWNLOAD (owner decision 2026-10-15): everything a person downloads, in one archive named
 * by `downloadName`, built from this checkout's commit into the new folder `output`. Its two
 * top-level folders are `runtime/`, the local release exactly as `packageLocal` makes it, and
 * `vendor/`, the brain unit exactly as `buildBrainUnit` makes it, with its own release.json,
 * brain.json, pinned bun, gbrain and THIRD-PARTY-NOTICES. Each keeps its own self-check, and
 * runtime/install.mjs installs the vendor/ beside it by default. Where no brain ships
 * (`brainArchiveShips`), it holds runtime/ alone. Packed by `releaseTarball` like every release
 * archive, refused if it holds anything else, and refused at 100 MiB with a warning from 50 MiB
 * (`downloadSize`). Every brain refusal comes before anything is written; any later failure removes
 * `output`. It downloads, uploads and publishes nothing.
 * @param {string} output @param {{root?:string,includeWorkingTree?:boolean}} [options]
 */
export async function packageDownload(output, { root = ROOT, includeWorkingTree = false } = {}) {
  const dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim();
  if (dirty && !includeWorkingTree) throw new Error('Commit the release source first, or use --include-working-tree for a local candidate.');
  const stage = brainArchiveShips(process.platform, process.arch) ? await brainStage({ root, includeWorkingTree }) : null;
  const target = resolve(output);
  // A new directory: never mixed with an earlier download.
  await mkdir(target).catch(error => {
    if (error?.code === 'EEXIST') throw new Error(`${target} already exists. The download is always built into a new folder.`);
    if (error?.code === 'ENOENT') throw new Error(`The folder ${dirname(target)} does not exist. Create it first.`);
    throw error;
  });
  try {
    const runtime = await packageLocal(join(target, 'runtime'), { root, includeWorkingTree });
    const brain = stage === null ? null : await buildBrainUnit(join(target, 'vendor'), stage);
    if (brain !== null && brain.revision !== runtime.revision) throw new Error(`The runtime was built from ${runtime.revision} and the brain from ${brain.revision}. Build the download again from one commit.`);
    const { version } = JSON.parse(await readFile(join(target, 'runtime', 'package.json'), 'utf8'));
    const workingTree = runtime.workingTree || (brain?.workingTree ?? false);
    const tops = brain === null ? ['runtime'] : ['runtime', 'vendor'];
    const name = downloadName(version, process.platform, process.arch, runtime.revision, workingTree);
    const archive = join(target, name);
    const entries = await releaseTarball(archive, target, tops);
    const stray = entries.filter(entry => !tops.some(top => entry.name === `${top}/` || entry.name.startsWith(`${top}/`)));
    if (stray.length > 0) throw new Error(`${name} holds entries outside ${tops.map(top => `${top}/`).join(' and ')}: ${stray.slice(0, 5).map(entry => entry.name).join(', ')}`);
    const bytes = await readFile(archive);
    const size = downloadSize(name, bytes.length);
    if (size.refuse !== undefined) throw new Error(size.refuse);
    return {
      directory: target, archive, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, entries: entries.length,
      version, revision: runtime.revision, workingTree, brain: brain !== null, runtimeFiles: runtime.files, brainFiles: brain?.files ?? 0,
      ...size.warn === undefined ? {} : { warning: size.warn },
    };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const usage = 'Usage: node tools/deploy/package-local.mjs <new-directory> [--include-working-tree] [--archive]\n'
    + '  --archive  builds the one download in <new-directory>: runtime/, vendor/ (the local brain, where one ships) and foliage-<version>-<platform>-<arch>-<rev7>.tgz holding both';
  try {
    let parsed;
    try { parsed = parseArgs({ allowPositionals: true, strict: true, options: { 'include-working-tree': { type: 'boolean' }, archive: { type: 'boolean' } }, tokens: true }); }
    catch { throw new Error(usage); }
    const { values, positionals, tokens } = parsed;
    const repeated = tokens.filter(token => token.kind === 'option').map(token => token.name).filter((name, at, all) => all.indexOf(name) !== at);
    if (positionals.length !== 1 || repeated.length > 0) throw new Error(usage);
    const output = resolve(positionals[0] ?? '');
    const includeWorkingTree = values['include-working-tree'] ?? false;
    if (!values.archive) console.log(JSON.stringify(await packageLocal(output, { includeWorkingTree })));
    else {
      const result = await packageDownload(output, { includeWorkingTree });
      if (result.warning !== undefined) process.stderr.write(`package-local: warning: ${result.warning}\n`);
      console.log(JSON.stringify(result));
    }
  } catch (error) {
    process.stderr.write(`package-local: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
