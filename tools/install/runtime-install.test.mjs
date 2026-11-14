import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRuntimeManifest } from '../deploy/package-local.mjs';
import { addBrain, downloadBrain, gitAbsenceHere, installRuntime, verifyBrainUnit, verifyRuntime } from './runtime-install.mjs';
/** The usage line's start: node and this installer by its full path, as install.mjs prints it. @param {string} installer */
const usage = installer => `Usage: node ${JSON.stringify(installer)}`;
/** @param {import('node:test').TestContext} t */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'foliage-install-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'); await mkdir(source);
  await writeFile(join(source, 'probe.mjs'), '// An installer protocol probe; no work record.\n');
  await symlink('probe.mjs', join(source, 'probe-link'));
  await writeRuntimeManifest(source, { version: 'protocol-test', platform: process.platform, arch: process.arch });
  return { root, source, destination: join(root, 'installed') };
}
test('installer relocates verified internal links without overwriting an existing installation', async t => {
  const { source, destination } = await fixture(t);
  await installRuntime(source, destination);
  await rm(source, { recursive: true });
  assert.match(await readFile(join(destination, 'probe-link'), 'utf8'), /protocol probe/);
  assert.equal((await verifyRuntime(destination)).version, 'protocol-test');
  await assert.rejects(installRuntime(destination, destination), /outside/);
  await assert.rejects(installRuntime(destination, join(destination,'..hidden')), /outside/);
});
test('installer refuses changed or extra executable files before creating a destination', async t => {
  const { source, destination } = await fixture(t);
  await writeFile(join(source, 'probe.mjs'), '// changed');
  await assert.rejects(installRuntime(source, destination), /integrity check failed/);
  await assert.rejects(readFile(join(destination, 'release.json')), { code: 'ENOENT' });
  await writeRuntimeManifest(source, { platform: process.platform, arch: process.arch });
  await writeFile(join(source, 'extra.mjs'), '// extra module');
  await assert.rejects(verifyRuntime(source), /Unlisted release file/);
});
test('installer rejects escaping links, unsupported platforms and duplicate paths', async t => {
  const { root, source, destination } = await fixture(t);
  await mkdir(destination);
  await assert.rejects(installRuntime(source, destination), /already exists\. Foliage installs only into a new folder and never changes an existing one/);
  await symlink('../outside', join(source, 'escape'));
  await writeFile(join(root, 'outside'), 'protocol bytes');
  await writeRuntimeManifest(source, { platform: process.platform, arch: process.arch });
  await assert.rejects(verifyRuntime(source), /Unsafe or changed/);
  await rm(join(source, 'escape'));
  await writeRuntimeManifest(source, { platform: 'unsupported-protocol-platform', arch: process.arch });
  await assert.rejects(verifyRuntime(source), /requires/);
  const m = await writeRuntimeManifest(source, { platform: process.platform, arch: process.arch });
  m.files.push(m.files[0] ?? {path:"probe.mjs"}); await writeFile(join(source, 'release.json'), JSON.stringify(m));
  await assert.rejects(verifyRuntime(source), /duplicate/);
});

/* ---- the brain archive as its own unit (unit 38, build order item 7) ------------------------- */

/**
 * A SYNTHETIC brain unit: a brain archive's layout and release record, with stand-in files that are
 * never executed. Foliage's own pin checks would refuse it, so the tests below hand the installer a
 * stand-in for them (`checks`); the real checks run on the real archive in package-local.test.mjs.
 * @param {string} dir @param {Record<string, unknown>} [overrides]
 */
async function syntheticBrain(dir, overrides = {}) {
  await mkdir(join(dir, 'bun'), { recursive: true });
  await mkdir(join(dir, 'gbrain', 'src'), { recursive: true });
  const bun = 'synthetic stand-in for bun; never executed\n';
  await writeFile(join(dir, 'bun', 'bun'), bun);
  await writeFile(join(dir, 'gbrain', 'src', 'cli.ts'), '// synthetic stand-in for gbrain\n');
  await writeFile(join(dir, 'gbrain', 'LICENSE'), 'synthetic licence stand-in\n');
  await writeFile(join(dir, 'brain.json'), '{"synthetic":true}\n');
  await writeFile(join(dir, 'THIRD-PARTY-NOTICES'), 'synthetic notices stand-in\n');
  return writeRuntimeManifest(dir, { kind: 'foliage-brain', foliageVersion: 'protocol-test', platform: process.platform, arch: process.arch,
    bunVersion: 'synthetic', bunSha256: createHash('sha256').update(bun).digest('hex'), gbrainVersion: 'synthetic', gbrainCommit: 'synthetic', gbrainIntegrity: 'synthetic', ...overrides });
}

/**
 * Stand-in for Foliage's own brain checks: records what it was asked to check and how much room was
 * asked for, has room unless told otherwise, and refuses when `refuse` is set.
 * @param {{ calls?: string[], refuse?: string, free?: number, needs?: number[] }} [options]
 */
const standIn = ({ calls = [], refuse, free = Number.MAX_SAFE_INTEGER, needs = [] } = {}) => async () => ({
  verifyShippedBrain: async (/** @type {string} */ vendor) => { calls.push(vendor); if (refuse) throw new Error(refuse); },
  freeBytes: async () => free,
  roomProblem: (/** @type {number} */ have, /** @type {number} */ needed, /** @type {string} */ where) => { needs.push(needed); return have >= needed ? null : `${where} has too little room`; },
  EMPTY_BRAIN_BYTES: 1,
});

/** @param {import('node:test').TestContext} t */
async function brainFixture(t) {
  const made = await fixture(t);
  const brain = join(made.root, 'download', 'vendor');
  await mkdir(brain, { recursive: true });
  await syntheticBrain(brain);
  return { ...made, brain };
}

test('a release installs with and without its brain, and verifies with vendor/ absent', async t => {
  const { root, source, destination, brain } = await brainFixture(t);
  await installRuntime(source, destination);
  await assert.rejects(lstat(join(destination, 'vendor')), { code: 'ENOENT' });
  await verifyRuntime(destination);
  /** @type {string[]} */
  const calls = [];
  /** @type {number[]} */
  const needs = [];
  const withBrain = join(root, 'with-brain');
  assert.equal((await installRuntime(source, withBrain, { brain, checks: standIn({ calls, needs }) })).brain, true);
  // Room is asked for in whole 4 KiB blocks: six small files (release.json among them) and four
  // folders, plus the stand-in's one-byte empty brain; never the 30-odd bytes the files hold.
  assert.deepEqual(needs, [10 * 4096 + 1]);
  assert.equal((await verifyRuntime(withBrain)).version, 'protocol-test');
  assert.equal((await verifyBrainUnit(join(withBrain, 'vendor'), 'protocol-test')).manifest.kind, 'foliage-brain');
  assert.equal(calls.length, 2, "Foliage's checks ran twice");
  assert.ok(calls[0]?.endsWith(join('download', 'vendor')), 'first on the download');
  assert.ok(calls[1]?.endsWith(join('with-brain', 'vendor')), 'then where it was copied');
  // The folder that holds the extracted vendor/ is accepted too.
  assert.equal((await installRuntime(source, join(root, 'from-parent'), { brain: join(root, 'download'), checks: standIn() })).brain, true);
});

test('the brain is added to an existing install, replaced through a swap, and an unfinished swap is named', async t => {
  const { source, destination, brain } = await brainFixture(t);
  await installRuntime(source, destination);
  assert.equal((await addBrain(brain, destination, { checks: standIn() })).replaced, false);
  await verifyRuntime(destination);
  await assert.rejects(addBrain(brain, destination, { checks: standIn() }), /already has a brain .*--replace-brain/);
  await writeFile(join(destination, 'vendor', 'gbrain', 'LICENSE'), 'one changed byte in the installed brain\n');
  await assert.rejects(verifyRuntime(destination), /integrity check failed: gbrain\/LICENSE/);
  // Replacing is the fix for a changed installed brain: only the main release must verify first.
  assert.equal((await addBrain(brain, destination, { replace: true, checks: standIn() })).replaced, true);
  await verifyRuntime(destination);
  assert.deepEqual((await readdir(destination)).filter(name => name.startsWith('vendor')), ['vendor']);
  await mkdir(join(destination, 'vendor.next'));
  await assert.rejects(addBrain(brain, destination, { replace: true, checks: standIn() }), /did not finish: .*vendor\.next is left over/);
  await rm(join(destination, 'vendor.next'), { recursive: true });
  await rm(join(destination, 'vendor'), { recursive: true });
  await assert.rejects(addBrain(brain, destination, { replace: true, checks: standIn() }), /no brain to replace/);
  await assert.rejects(addBrain(join(destination, 'probe.mjs'), destination, { checks: standIn() }), /not one inside this install/);
});

test('a refused brain leaves nothing behind: changed or extra bytes, another version or platform, missing parts, a refused pin, no room', async t => {
  const { root, source, destination, brain } = await brainFixture(t);
  const refusedAt = join(root, 'refused');
  /** @param {RegExp} message @param {Parameters<typeof installRuntime>[2]} [options] */
  const refusedNew = async (message, options = { brain, checks: standIn() }) => {
    await assert.rejects(installRuntime(source, refusedAt, options), message);
    await assert.rejects(lstat(refusedAt), { code: 'ENOENT' });
  };
  await writeFile(join(brain, 'gbrain', 'src', 'cli.ts'), '// one changed byte\n');
  await refusedNew(/integrity check failed: gbrain\/src\/cli\.ts/);
  await syntheticBrain(brain);
  await writeFile(join(brain, 'gbrain', 'extra.js'), "fetch('http://example.test')\n");
  await refusedNew(/Unlisted release file: gbrain\/extra\.js/);
  await rm(join(brain, 'gbrain', 'extra.js'));
  await syntheticBrain(brain, { foliageVersion: 'another-version' });
  await refusedNew(/belongs to Foliage another-version, and this Foliage is protocol-test/);
  await syntheticBrain(brain, { platform: 'unsupported-protocol-platform' });
  await refusedNew(/requires unsupported-protocol-platform/);
  await syntheticBrain(brain, { bunSha256: '0'.repeat(64) });
  await refusedNew(/does not list its own bun/);
  await syntheticBrain(brain);
  await rm(join(brain, 'THIRD-PARTY-NOTICES'));
  await writeRuntimeManifest(brain, JSON.parse(await readFile(join(brain, 'release.json'), 'utf8')));
  await refusedNew(/lacks THIRD-PARTY-NOTICES/);
  await syntheticBrain(brain);
  await refusedNew(/The brain archive was refused: synthetic pin refusal/, { brain, checks: standIn({ refuse: 'synthetic pin refusal' }) });
  await refusedNew(/has too little room for the brain and one empty garden brain\. Nothing was installed/, { brain, checks: standIn({ free: 0 }) });
  // A release from before the brain has no checks for it, and says so.
  await refusedNew(/no local brain support/, { brain });
  // The same refusals leave an existing install as it was, with no swap folder.
  await installRuntime(source, destination);
  await writeFile(join(brain, 'gbrain', 'LICENSE'), 'one changed byte\n');
  await assert.rejects(addBrain(brain, destination, { checks: standIn() }), /integrity check failed: gbrain\/LICENSE/);
  await syntheticBrain(brain);
  await assert.rejects(addBrain(join(root, 'download'), destination, { checks: standIn({ refuse: 'synthetic pin refusal' }) }), /The brain archive was refused: synthetic pin refusal/);
  await assert.rejects(addBrain(brain, destination, { checks: standIn({ free: 0 }) }), /too little room/);
  assert.deepEqual((await readdir(destination)).filter(name => name.startsWith('vendor')), []);
  await verifyRuntime(destination);
});

test('the root check treats vendor/ as a unit only with its own release record', async t => {
  const { root, source, destination, brain } = await brainFixture(t);
  await installRuntime(source, destination, { brain, checks: standIn() });
  await rename(join(destination, 'vendor', 'release.json'), join(destination, 'vendor-release.json'));
  await assert.rejects(verifyRuntime(destination), /Unlisted release file: vendor\//);
  await rename(join(destination, 'vendor-release.json'), join(destination, 'vendor', 'release.json'));
  await verifyRuntime(destination);
  // A release folder holding a brain unit inside it is refused: the brain comes beside it in the
  // download or through --with-brain, and either way Foliage's pin checks run on it.
  const elsewhere = join(destination, '..', 'from-a-release-with-vendor');
  await syntheticBrain(join(source, 'vendor'));
  let said = '';
  await assert.rejects(installRuntime(source, elsewhere), (/** @type {Error} */ error) => { said = error.message; return true; });
  const real = await realpath(source);
  assert.equal(said, `${real} holds a vendor/ folder inside it, where no brain belongs: the download keeps the brain in vendor/ beside the runtime folder, and a new install takes a brain only from there or through --with-brain, and checks it either way. If you moved or extracted vendor/ into this folder, move it out and pass its new path with --with-brain. If this is an installed Foliage, run install.mjs from the runtime folder of the extracted download instead, with --with-brain ${join(real, 'vendor')}.`);
  await assert.rejects(lstat(elsewhere), { code: 'ENOENT' });
  // What it says to do for this case, done from this same folder, installs, the brain included.
  const outside = join(root, 'moved-out');
  await mkdir(outside);
  await rename(join(source, 'vendor'), join(outside, 'vendor'));
  assert.equal((await installRuntime(source, elsewhere, { brain: join(outside, 'vendor'), checks: standIn() })).brain, true);
  await verifyRuntime(elsewhere);
  await assert.rejects(installRuntime(source, join(brain, 'inside'), { brain, checks: standIn() }), /outside the extracted brain archive/);
  await assert.rejects(lstat(join(brain, 'inside')), { code: 'ENOENT' });
  // The main release never lists vendor/.
  const manifest = JSON.parse(await readFile(join(source, 'release.json'), 'utf8'));
  await writeFile(join(source, 'release.json'), JSON.stringify({ ...manifest, files: [...manifest.files, { path: 'vendor/bun/bun', sha256: '0'.repeat(64) }] }));
  await assert.rejects(verifyRuntime(source), /lists vendor\/, which only the brain's own release\.json may list/);
});

test('install.mjs refuses brain flags it cannot honour before reading anything', async () => {
  const installer = fileURLToPath(new URL('./runtime-install.mjs', import.meta.url));
  for (const [flags, message] of /** @type {const} */ ([
    [['/abs/install', '--add-brain', 'relative/vendor'], /--add-brain needs the absolute path/],
    [['/abs/install', '--add-brain', '/abs/vendor', '--replace-brain', '/abs/vendor'], /--add-brain or --replace-brain, not both/],
    [['/abs/install', '--add-brain', '/abs/vendor', '--with-aside'], /work on an existing install on their own/],
    [['/abs/install', '--add-brain', '/abs/vendor', '--with-brain', '/abs/vendor'], /work on an existing install on their own/],
    [['/abs/install', '--with-brain', '/abs/vendor', '--with-brain', '/abs/vendor'], /Repeated --with-brain/],
    [['/abs/install', '--no-brain', '--with-brain', '/abs/vendor'], /Use --no-brain or --with-brain, not both\./],
    [['--add-brain', '/abs/vendor', '/abs/install', '--no-brain'], /work on an existing install on their own/],
  ])) {
    const ran = spawnSync(process.execPath, [installer, ...flags], { encoding: 'utf8', env: {}, timeout: 10000 });
    assert.equal(ran.status, 1, ran.stdout);
    assert.match(ran.stderr, message);
  }
});

test('the installer says what is wrong in a sentence, never a raw file-system error', async t => {
  const { root, source, destination, brain } = await brainFixture(t);
  /** @param {Promise<unknown>} attempt @param {RegExp} message */
  const said = async (attempt, message) => {
    await assert.rejects(attempt, error => error instanceof Error && message.test(error.message) && !/\bE[A-Z]{3,}\b|lstat|realpath|mkdir/.test(error.message));
  };
  // A destination whose parent is not there, and one that is already there.
  await said(installRuntime(source, join(root, 'no-such-parent', 'foliage')), /^The folder .*no-such-parent does not exist\. Create it first/);
  await installRuntime(source, destination);
  await said(installRuntime(source, destination), /^.*installed already exists\. Foliage installs only into a new folder and never changes an existing one: name a folder that does not exist yet/);
  // A listed release file that is missing names itself and the remedy, as a changed one does.
  const broken = join(root, 'broken');
  await mkdir(broken);
  await writeFile(join(broken, 'probe.mjs'), '// An installer protocol probe; no work record.\n');
  await writeRuntimeManifest(broken, { version: 'protocol-test', platform: process.platform, arch: process.arch });
  await rm(join(broken, 'probe.mjs'));
  await said(verifyRuntime(broken), /^Release file missing: probe\.mjs\. Obtain the archive again\.$/);
  await said(installRuntime(broken, join(root, 'from-broken')), /^Release file missing: probe\.mjs\. Obtain the archive again\.$/);
  await assert.rejects(lstat(join(root, 'from-broken')), { code: 'ENOENT' });
  await said(verifyRuntime(join(root, 'nothing-here')), /^No Foliage release is at .*nothing-here: it holds no release\.json/);
  await said(verifyRuntime(join(root, 'download')), /^No Foliage release is at .*download: it holds no release\.json/);
  // The brain archive: a missing folder, a missing install, a missing file.
  await said(installRuntime(source, join(root, 'with-missing-brain'), { brain: join(root, 'no-brain-here'), checks: standIn() }), /^There is no folder at .*no-brain-here\. Pass the vendor folder from the Foliage download, beside its runtime folder\.$/);
  await said(addBrain(join(root, 'no-brain-here'), destination, { checks: standIn() }), /^There is no folder at .*no-brain-here\. Pass the vendor folder/);
  await said(addBrain(brain, join(root, 'no-install-here'), { checks: standIn() }), /^There is no Foliage install at .*no-install-here\. Pass the folder Foliage was installed to\.$/);
  await rm(join(brain, 'gbrain', 'src', 'cli.ts'));
  await said(addBrain(brain, destination, { checks: standIn() }), /^Release file missing: gbrain\/src\/cli\.ts\. Obtain the brain archive again\.$/);
  await rm(join(brain, 'gbrain', 'src'), { recursive: true });
  await said(verifyBrainUnit(brain, 'protocol-test'), /^Release file missing: gbrain\/src\/cli\.ts\. Obtain the brain archive again\.$/);
  assert.deepEqual((await readdir(destination)).filter(name => name.startsWith('vendor')), []);
});

test('install.mjs --help prints its usage and exits 0; an unknown flag prints the usage and exits 1', () => {
  const installer = fileURLToPath(new URL('./runtime-install.mjs', import.meta.url));
  for (const flag of ['--help', '-h']) {
    const ran = spawnSync(process.execPath, [installer, flag], { encoding: 'utf8', env: {}, timeout: 10000 });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stderr, '');
    assert.ok(ran.stdout.startsWith(`${usage(installer)} /absolute/new-install-directory`), ran.stdout);
    assert.match(ran.stdout, /--add-brain\s+adds that brain to an existing install/);
  }
  const unknown = spawnSync(process.execPath, [installer, '--helpp'], { encoding: 'utf8', env: {}, timeout: 10000 });
  assert.equal(unknown.status, 1);
  assert.ok(unknown.stderr.startsWith(`Unknown option '--helpp'.\n${usage(installer)}`), unknown.stderr);
  assert.doesNotMatch(unknown.stderr, /positional argument/);
});

/** What Finder and Archive Utility write into a folder a person opens: its settings, and AppleDouble files, one beside nothing. */
const FINDER_FILES = ['.DS_Store', '._.DS_Store', '._START-HERE.md', '._x'];

test("Finder's files, a .DS_Store or any ._ file at any depth, are never copied, hashed or refused; links and folders by those names, and any other unlisted file, still are", async t => {
  const { root, source, destination, brain } = await brainFixture(t);
  await mkdir(join(source, 'apps'));
  await writeFile(join(source, 'apps', 'mod.mjs'), '// An installer protocol probe; no work record.\n');
  await writeRuntimeManifest(source, { version: 'protocol-test', platform: process.platform, arch: process.arch });
  // In the extracted release, its apps/ folder, and the brain archive's vendor/ and the folders in it.
  const leftovers = ['', 'apps/'].flatMap(folder => FINDER_FILES.map(name => `${folder}${name}`));
  for (const path of leftovers) await writeFile(join(source, path), 'synthetic Finder metadata\n');
  const brainLeftovers = ['', 'gbrain/', 'gbrain/src/', 'bun/'].flatMap(folder => FINDER_FILES.map(name => `${folder}${name}`));
  for (const path of brainLeftovers) await writeFile(join(brain, path), 'synthetic Finder metadata\n');
  await verifyRuntime(source);
  await verifyBrainUnit(brain, 'protocol-test');
  /** @type {number[]} */
  const needs = [];
  assert.equal((await installRuntime(source, destination, { brain, checks: standIn({ needs }) })).brain, true);
  // Never hashed or counted: the room asked for is what it is without them (as in the test above).
  assert.deepEqual(needs, [10 * 4096 + 1]);
  /** Every path under `dir`, `/` between its parts. @param {string} dir @returns {Promise<string[]>} */
  const everything = async dir => (await readdir(dir, { recursive: true })).map(path => path.split('\\').join('/'));
  const finder = /(^|\/)(\.DS_Store|\._[^/]*)$/;
  const copied = await everything(destination);
  assert.deepEqual(copied.filter(path => finder.test(path)), [], 'none of them was copied');
  assert.ok(copied.includes('apps/mod.mjs') && copied.includes('vendor/gbrain/LICENSE'), 'the shipped files were');
  await verifyRuntime(destination);
  // An install Finder has since opened, its brain's folders included, still checks out.
  for (const path of [...leftovers, ...brainLeftovers.map(path => `vendor/${path}`)]) await writeFile(join(destination, path), 'synthetic Finder metadata\n');
  await verifyRuntime(destination);
  // A brain added later leaves them behind too.
  const later = join(root, 'later');
  await installRuntime(source, later);
  for (const path of leftovers) await writeFile(join(later, path), 'synthetic Finder metadata\n');
  await addBrain(brain, later, { checks: standIn() });
  assert.deepEqual((await everything(join(later, 'vendor'))).filter(path => finder.test(path)), []);
  await verifyRuntime(later);
  // Only regular files: a link or a folder by those names, or any other stray file, is refused.
  /** @param {string} at @param {() => Promise<unknown>} make @param {RegExp} message */
  const refused = async (at, make, message) => {
    await make();
    await assert.rejects(verifyRuntime(source), message);
    await assert.rejects(installRuntime(source, join(root, 'refused')), message);
    await assert.rejects(lstat(join(root, 'refused')), { code: 'ENOENT' });
    await rm(join(source, at), { recursive: true });
  };
  await refused('apps/.DS_Store.mjs', () => writeFile(join(source, 'apps', '.DS_Store.mjs'), 'x'), /^Error: Unlisted release file: apps\/\.DS_Store\.mjs\. Obtain the archive again\.$/);
  await refused('apps/x._', () => writeFile(join(source, 'apps', 'x._'), 'x'), /^Error: Unlisted release file: apps\/x\._\. Obtain the archive again\.$/);
  await rm(join(source, 'apps', '.DS_Store'));
  await refused('apps/.DS_Store', async () => { await mkdir(join(source, 'apps', '.DS_Store')); await writeFile(join(source, 'apps', '.DS_Store', 'inside.mjs'), 'x'); }, /Unlisted release file: apps\/\.DS_Store\/inside\.mjs\. Obtain the archive again\./);
  await refused('apps/.DS_Store', () => symlink('mod.mjs', join(source, 'apps', '.DS_Store')), /Unlisted release file: apps\/\.DS_Store\. Obtain the archive again\./);
  await rm(join(source, 'apps', '._x'));
  await refused('apps/._x', () => symlink('mod.mjs', join(source, 'apps', '._x')), /Unlisted release file: apps\/\._x\. Obtain the archive again\./);
  await refused('apps/._dir', async () => { await mkdir(join(source, 'apps', '._dir')); await writeFile(join(source, 'apps', '._dir', 'inside.mjs'), 'x'); }, /Unlisted release file: apps\/\._dir\/inside\.mjs\. Obtain the archive again\./);
  await writeFile(join(brain, 'gbrain', 'extra.js'), 'x');
  await assert.rejects(verifyBrainUnit(brain, 'protocol-test'), /^Error: Unlisted release file: gbrain\/extra\.js\. Obtain the brain archive again\.$/);
});

test('install.mjs says a relative install folder must be absolute, not only the usage', () => {
  const installer = fileURLToPath(new URL('./runtime-install.mjs', import.meta.url));
  for (const flags of [['foliage-app'], ['./foliage-app', '--with-brain', '/abs/vendor'], ['--add-brain', '/abs/vendor', 'foliage-app']]) {
    const ran = spawnSync(process.execPath, [installer, ...flags], { encoding: 'utf8', env: {}, timeout: 10000 });
    assert.equal(ran.status, 1, ran.stdout);
    assert.match(ran.stderr, /^The install folder must be an absolute path, one that starts with \/: \.?\/?foliage-app is relative\.\nUsage: node "\/.+\/runtime-install\.mjs" \//);
  }
  // No folder at all, or two, is still answered with the usage alone.
  for (const flags of [[], ['/abs/one', '/abs/two']]) {
    const ran = spawnSync(process.execPath, [installer, ...flags], { encoding: 'utf8', env: {}, timeout: 10000 });
    assert.equal(ran.status, 1, ran.stdout);
    assert.ok(ran.stderr.startsWith(`${usage(installer)} /`), ran.stderr);
  }
});

test("install.mjs, run from an extracted release, prints commands that paste: Grow's ends at its path, no git note where git runs, and the usage names install.mjs by its full path", async t => {
  const made = await fixture(t);
  // The paths the installer prints are real ones (the temporary folder may sit behind a link).
  const root = await realpath(made.root), source = await realpath(made.source);
  // A SYNTHETIC extracted release holding this installer as install.mjs, as the release ships it.
  const here = fileURLToPath(new URL('.', import.meta.url));
  await writeFile(join(source, 'install.mjs'), await readFile(join(here, 'runtime-install.mjs')));
  await writeFile(join(source, 'requirements.mjs'), await readFile(join(here, 'requirements.mjs')));
  await writeRuntimeManifest(source, { version: 'protocol-test', platform: process.platform, arch: process.arch });
  const elsewhere = join(root, 'elsewhere'), destination = join(root, 'pasted install');
  await mkdir(elsewhere);
  const help = spawnSync(process.execPath, [join(source, 'install.mjs'), '--help'], { cwd: elsewhere, encoding: 'utf8', env: {}, timeout: 10000 });
  assert.equal(help.status, 0, help.stderr);
  const self = `node ${JSON.stringify(join(source, 'install.mjs'))}`;
  assert.ok(help.stdout.startsWith(`Usage: ${self} /absolute/new-install-directory`), help.stdout);
  assert.ok(help.stdout.includes(`\n       ${self} --add-brain|--replace-brain /absolute/extracted/vendor /absolute/existing-install\n`), help.stdout);
  const ran = spawnSync(process.execPath, [join(source, 'install.mjs'), destination], { cwd: elsewhere, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 60000 });
  assert.equal(ran.status, 0, ran.stderr);
  const lines = ran.stdout.split('\n');
  const foliage = `node ${JSON.stringify(join(destination, 'foliage.mjs'))}`;
  const grow = lines.findIndex(line => line.startsWith('Grow:'));
  assert.equal(lines[grow], `Grow:  ${foliage} grow --repo /absolute/path/to/a/git/repository`, 'the command ends the line, so it pastes as it is');
  assert.ok(lines.includes(`Start: ${foliage} up`), ran.stdout);
  assert.doesNotMatch(ran.stdout, /repository +\(needs git\)/);
  // git runs here (/usr/bin/git, which every test in this suite uses), so nothing says it is needed.
  assert.equal(spawnSync('git', ['--version'], { env: { PATH: '/usr/bin:/bin' } }).status, 0, 'this check needs a git that runs');
  assert.doesNotMatch(ran.stdout, /needs git/);
});

test('install.mjs says grow needs git when no git is on PATH, on its own line after Grow', async t => {
  const made = await fixture(t);
  const root = await realpath(made.root), source = await realpath(made.source);
  const here = fileURLToPath(new URL('.', import.meta.url));
  await writeFile(join(source, 'install.mjs'), await readFile(join(here, 'runtime-install.mjs')));
  await writeFile(join(source, 'requirements.mjs'), await readFile(join(here, 'requirements.mjs')));
  await writeRuntimeManifest(source, { version: 'protocol-test', platform: process.platform, arch: process.arch });
  // A PATH with no git on it.
  const none = join(root, 'no-git');
  await mkdir(none);
  const ran = spawnSync(process.execPath, [join(source, 'install.mjs'), join(root, 'without-git')], { cwd: root, encoding: 'utf8', env: { PATH: none }, timeout: 60000 });
  assert.equal(ran.status, 0, ran.stderr);
  const lines = ran.stdout.split('\n');
  const grow = lines.findIndex(line => line.startsWith('Grow:'));
  assert.equal(lines[grow + 1], 'Grow needs git, and git is not installed here (on a Mac: xcode-select --install).', ran.stdout);
  assert.equal(lines.filter(line => /needs git/.test(line)).length, 1, ran.stdout);
});

test('gitAbsenceHere finds git by its files, never by running it: none on PATH, a git found, and the Mac stub with no developer folder holding git', async t => {
  const { root } = await fixture(t);
  const none = join(root, 'empty-path'), found = join(root, 'path-with-git'), developer = join(root, 'developer');
  await mkdir(none);
  await mkdir(found);
  await mkdir(join(developer, 'usr', 'bin'), { recursive: true });
  // SYNTHETIC: a file that fails if it is ever run, so a test that passes proves it never was.
  await writeFile(join(found, 'git'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  assert.equal(await gitAbsenceHere({ env: { PATH: none }, platform: 'darwin' }), 'git is not installed here');
  assert.equal(await gitAbsenceHere({ env: { PATH: `relative:${none}` }, platform: 'linux' }), 'git is not installed here', 'a relative PATH entry is not searched');
  assert.equal(await gitAbsenceHere({ env: { PATH: `${none}:${found}` }, platform: 'darwin' }), null);
  assert.equal(await gitAbsenceHere({ env: { PATH: found }, platform: 'linux' }), null);
  // A folder named git is no git.
  await mkdir(join(none, 'git'));
  assert.equal(await gitAbsenceHere({ env: { PATH: none }, platform: 'linux' }), 'git is not installed here');
  // Apple's stub at /usr/bin/git runs git only from a developer folder that holds one. `mac` stands
  // in for this Mac's /, so its folders are the only ones looked at.
  if (process.platform === 'darwin') {
    const mac = join(root, 'mac'), stub = { PATH: '/usr/bin:/bin' };
    const xcodeBeta = join(mac, 'Applications', 'Xcode-beta.app', 'Contents', 'Developer');
    await mkdir(join(xcodeBeta, 'usr', 'bin'), { recursive: true });
    await mkdir(join(mac, 'Applications', 'NotXcode.app', 'Contents', 'Developer', 'usr', 'bin'), { recursive: true });
    await writeFile(join(mac, 'Applications', 'NotXcode.app', 'Contents', 'Developer', 'usr', 'bin', 'git'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    assert.equal(await gitAbsenceHere({ env: stub, platform: 'darwin', root: mac }), 'the git here does not run', 'only an Xcode*.app is a folder the stub may use');
    assert.equal(await gitAbsenceHere({ env: { ...stub, DEVELOPER_DIR: developer }, platform: 'darwin', root: mac }), 'the git here does not run');
    await writeFile(join(developer, 'usr', 'bin', 'git'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    assert.equal(await gitAbsenceHere({ env: { ...stub, DEVELOPER_DIR: developer }, platform: 'darwin', root: mac }), null, 'DEVELOPER_DIR holds git');
    // An Xcode at another name in /Applications is one xcode-select may use with no link written.
    await writeFile(join(xcodeBeta, 'usr', 'bin', 'git'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    assert.equal(await gitAbsenceHere({ env: stub, platform: 'darwin', root: mac }), null, 'Xcode-beta.app holds git');
    await rm(join(mac, 'Applications'), { recursive: true });
    assert.equal(await gitAbsenceHere({ env: stub, platform: 'darwin', root: mac }), 'the git here does not run');
    const tools = join(mac, 'Library', 'Developer', 'CommandLineTools', 'usr', 'bin');
    await mkdir(tools, { recursive: true });
    await writeFile(join(tools, 'git'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    assert.equal(await gitAbsenceHere({ env: stub, platform: 'darwin', root: mac }), null, 'the Command Line Tools hold git');
  }
});

test('an unlisted folder is refused like an unlisted file: an empty one, one holding only Finder files, and one in the brain archive by a Finder name', async t => {
  const { root, source, destination, brain } = await brainFixture(t);
  await mkdir(join(source, 'apps'));
  await writeFile(join(source, 'apps', 'mod.mjs'), '// An installer protocol probe; no work record.\n');
  await writeRuntimeManifest(source, { version: 'protocol-test', platform: process.platform, arch: process.arch });
  // Listed folders holding Finder's files still check out.
  await writeFile(join(source, 'apps', '.DS_Store'), 'synthetic Finder metadata\n');
  await verifyRuntime(source);
  /** @param {string} folder @param {RegExp} message */
  const refusedRelease = async (folder, message) => {
    await assert.rejects(verifyRuntime(source), message);
    await assert.rejects(installRuntime(source, join(root, 'refused')), message);
    await assert.rejects(lstat(join(root, 'refused')), { code: 'ENOENT' });
    await rm(join(source, folder), { recursive: true });
  };
  await mkdir(join(source, 'apps', 'emptyfolder'));
  await refusedRelease('apps/emptyfolder', /^Error: Unlisted release folder: apps\/emptyfolder\. Obtain the archive again\.$/);
  await mkdir(join(source, 'nested', 'deeper'), { recursive: true });
  await refusedRelease('nested', /^Error: Unlisted release folder: nested\/deeper\. Obtain the archive again\.$/);
  await mkdir(join(source, 'apps', 'finder-only'));
  await writeFile(join(source, 'apps', 'finder-only', '.DS_Store'), 'synthetic Finder metadata\n');
  await refusedRelease('apps/finder-only', /^Error: Unlisted release folder: apps\/finder-only\. Obtain the archive again\.$/);
  await verifyRuntime(source);
  // The brain archive's vendor folder: a folder by a Finder name is no Finder file.
  await mkdir(join(brain, 'gbrain', '._dir'));
  await assert.rejects(verifyBrainUnit(brain, 'protocol-test'), /^Error: Unlisted release folder: gbrain\/\._dir\. Obtain the brain archive again\.$/);
  await assert.rejects(installRuntime(source, join(root, 'refused'), { brain, checks: standIn() }), /Unlisted release folder: gbrain\/\._dir/);
  await assert.rejects(lstat(join(root, 'refused')), { code: 'ENOENT' });
  await installRuntime(source, destination);
  await assert.rejects(addBrain(brain, destination, { checks: standIn() }), /Unlisted release folder: gbrain\/\._dir/);
  assert.deepEqual((await readdir(destination)).filter(name => name.startsWith('vendor')), []);
  await rm(join(brain, 'gbrain', '._dir'), { recursive: true });
  // An empty folder left in an install is refused when the install is checked again.
  await mkdir(join(destination, 'apps', 'emptyfolder'));
  await assert.rejects(verifyRuntime(destination), /^Error: Unlisted release folder: apps\/emptyfolder\. Obtain the archive again\.$/);
});

test("Finder's custom-icon file (Icon and a carriage return) and .localized are Finder's files too: regular files are never copied, hashed or refused; a link or folder by those names still is", async t => {
  const { root, source, destination, brain } = await brainFixture(t);
  await mkdir(join(source, 'apps'));
  await writeFile(join(source, 'apps', 'mod.mjs'), '// An installer protocol probe; no work record.\n');
  await writeRuntimeManifest(source, { version: 'protocol-test', platform: process.platform, arch: process.arch });
  const names = ['Icon\r', '.localized'];
  for (const folder of ['', 'apps/']) for (const name of names) await writeFile(join(source, `${folder}${name}`), '');
  for (const folder of ['', 'gbrain/']) for (const name of names) await writeFile(join(brain, `${folder}${name}`), '');
  await verifyRuntime(source);
  await verifyBrainUnit(brain, 'protocol-test');
  assert.equal((await installRuntime(source, destination, { brain, checks: standIn() })).brain, true);
  const copied = (await readdir(destination, { recursive: true })).map(path => path.split('\\').join('/'));
  assert.deepEqual(copied.filter(path => names.some(name => path.endsWith(name))), [], 'none of them was copied');
  for (const name of names) await writeFile(join(destination, 'apps', name), '');
  await verifyRuntime(destination);
  // Only regular files.
  await rm(join(source, 'apps', '.localized'));
  await mkdir(join(source, 'apps', '.localized'));
  await writeFile(join(source, 'apps', '.localized', 'inside.mjs'), 'x');
  await assert.rejects(verifyRuntime(source), /^Error: Unlisted release file: apps\/\.localized\/inside\.mjs\. Obtain the archive again\.$/);
  await rm(join(source, 'apps', '.localized'), { recursive: true });
  await rm(join(source, 'apps', 'Icon\r'));
  await symlink('mod.mjs', join(source, 'apps', 'Icon\r'));
  await assert.rejects(installRuntime(source, join(root, 'refused')), /^Error: Unlisted release file: apps\/Icon\r\. Obtain the archive again\.$/);
  await assert.rejects(lstat(join(root, 'refused')), { code: 'ENOENT' });
  await rm(join(source, 'apps', 'Icon\r'));
  await writeFile(join(source, 'apps', 'Icon'), 'x');
  await assert.rejects(verifyRuntime(source), /^Error: Unlisted release file: apps\/Icon\. Obtain the archive again\.$/);
});

test('an install with its brain, used as the source of a new install, is not called an extracted release folder, and the way it names works; a release folder passed as the brain is named as not a brain', async t => {
  const { root, source, destination, brain } = await brainFixture(t);
  await installRuntime(source, destination, { brain, checks: standIn() });
  // The installed copy's own usage line, followed: refused, in words true of an install.
  const next = join(root, 'next-install');
  let said = '';
  await assert.rejects(installRuntime(destination, next), (/** @type {Error} */ error) => { said = error.message; return true; });
  assert.doesNotMatch(said, /extracted release folder/);
  assert.equal(said, `${await realpath(destination)} holds a vendor/ folder inside it, where no brain belongs: the download keeps the brain in vendor/ beside the runtime folder, and a new install takes a brain only from there or through --with-brain, and checks it either way. If you moved or extracted vendor/ into this folder, move it out and pass its new path with --with-brain. If this is an installed Foliage, run install.mjs from the runtime folder of the extracted download instead, with --with-brain ${join(await realpath(destination), 'vendor')}.`);
  await assert.rejects(lstat(next), { code: 'ENOENT' });
  // What it says to do for an install, from the runtime folder, installs, this brain included.
  assert.equal((await installRuntime(source, next, { brain: join(destination, 'vendor'), checks: standIn() })).brain, true);
  // The release folder (or an install) passed where the brain archive's vendor folder belongs.
  for (const wrong of [source, destination]) {
    const message = new RegExp(`^Error: ${(await realpath(wrong)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not a Foliage brain: its release\\.json is not a brain's\\. Pass the vendor folder from the Foliage download, beside its runtime folder\\.$`);
    await assert.rejects(installRuntime(source, join(root, 'refused'), { brain: wrong, checks: standIn() }), message);
    await assert.rejects(verifyBrainUnit(wrong, 'protocol-test'), message);
  }
  await assert.rejects(lstat(join(root, 'refused')), { code: 'ENOENT' });
  const plain = join(root, 'plain-install');
  await installRuntime(source, plain);
  await assert.rejects(addBrain(source, plain, { checks: standIn() }), /is not a Foliage brain: its release\.json is not a brain's/);
  // A brain archive's own record that is broken is still named as one.
  await writeFile(join(brain, 'release.json'), JSON.stringify({ ...JSON.parse(await readFile(join(brain, 'release.json'), 'utf8')), files: 'none' }));
  await assert.rejects(verifyBrainUnit(brain, 'protocol-test'), /^Error: The brain archive manifest is invalid\. Obtain the brain archive again\.$/);
});

/* ---- one download: the brain beside runtime/ installs by default (owner decision 2026-10-15) ---- */

/**
 * A SYNTHETIC stand-in for Foliage's own brain checks (`apps/leaf/src/brainVendor.ts`), shipped in a
 * synthetic release so install.mjs can run end to end: it accepts any brain unit the installer's own
 * checks passed, never runs one, and always has room. The real checks run on the real download in
 * package-local.test.mjs.
 */
const STAND_IN_CHECKS = `// SYNTHETIC stand-in for Foliage's brain checks; never runs a brain.
export async function verifyShippedBrain(vendor: string): Promise<void> { void vendor; }
export async function freeBytes(path: string): Promise<number> { void path; return Number.MAX_SAFE_INTEGER; }
export function roomProblem(free: number, needed: number, where: string): string | null { return free >= needed ? null : \`\${where} has too little room\`; }
export const EMPTY_BRAIN_BYTES = 1;
// SYNTHETIC: says a brain ships for this computer, whatever it is.
export function brainArchiveShips(platform: string, arch: string): boolean { void platform; void arch; return true; }
`;

/**
 * A SYNTHETIC extracted download, as the one archive unpacks: runtime/ holding this installer as
 * install.mjs, its Node check, a protocol probe and the stand-in checks above, and vendor/ beside it
 * holding a synthetic brain unit for the same version.
 * @param {import('node:test').TestContext} t
 */
async function syntheticDownload(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'foliage-install-download-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const download = join(root, 'download'), runtime = join(download, 'runtime'), vendor = join(download, 'vendor');
  const here = fileURLToPath(new URL('.', import.meta.url));
  await mkdir(join(runtime, 'apps', 'leaf', 'src'), { recursive: true });
  await writeFile(join(runtime, 'install.mjs'), await readFile(join(here, 'runtime-install.mjs')));
  await writeFile(join(runtime, 'requirements.mjs'), await readFile(join(here, 'requirements.mjs')));
  await writeFile(join(runtime, 'probe.mjs'), '// An installer protocol probe; no work record.\n');
  await writeFile(join(runtime, 'apps', 'leaf', 'src', 'brainVendor.ts'), STAND_IN_CHECKS);
  await writeRuntimeManifest(runtime, { version: 'protocol-test', platform: process.platform, arch: process.arch });
  await mkdir(vendor);
  await syntheticBrain(vendor);
  const elsewhere = join(root, 'elsewhere');
  await mkdir(elsewhere);
  /** install.mjs of the extracted download, from another folder, with nothing in its environment but PATH. @param {string[]} args */
  const install = args => spawnSync(process.execPath, [join(runtime, 'install.mjs'), ...args], { cwd: elsewhere, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 60000 });
  return { root, download, runtime, vendor, install };
}

const INCLUDED = 'The local brain that came with this download was included. It runs on this computer only; install with --no-brain to leave it out.';
/** What install.mjs says when no brain is beside it where one ships, for an install at `at`. @param {string} at */
const MISSED = at => `No local brain was found beside this runtime folder, so Foliage was installed without it. Add it later from the Foliage download: node ${JSON.stringify(join(at, 'install.mjs'))} --add-brain /absolute/path/to/the/extracted/vendor ${JSON.stringify(at)}`;
/** The way out a refusal of the download's own brain gives, as a pattern: the download again, or --no-brain. */
const AGAIN = 'Download Foliage again from getfoliage\\.com\\/start and extract it into an empty folder, or add --no-brain to install Foliage without it\\.';
/** The ways out meant for a brain the person named, which a refusal of the download's own brain never gives. */
const NAMED_REMEDIES = /Obtain the brain archive again|Pass the vendor folder|Use the brain archive released/;

test('the brain beside runtime/ in the download is found by downloadBrain, and only there', async t => {
  const { root, runtime, vendor } = await syntheticDownload(t);
  assert.equal(await downloadBrain(runtime), vendor);
  await rename(vendor, join(root, 'moved-vendor'));
  assert.equal(await downloadBrain(runtime), null);
  // Anything by that name is found, brain or not: the checks, not the finding, decide what it is.
  await writeFile(vendor, 'not a folder\n');
  assert.equal(await downloadBrain(runtime), vendor);
});

test('install.mjs from the extracted download installs the brain beside it by default and says so; --no-brain leaves it out', async t => {
  const { root, runtime, install } = await syntheticDownload(t);
  const withBrain = join(root, 'with-brain'), without = join(root, 'without-brain');
  const ran = install([withBrain]);
  assert.equal(ran.status, 0, ran.stderr);
  const lines = ran.stdout.split('\n');
  assert.equal(lines.filter(line => line === INCLUDED).length, 1, ran.stdout);
  assert.ok(lines.includes(`Installed Foliage protocol-test with its local brain at ${withBrain}.`), ran.stdout);
  assert.equal((await verifyBrainUnit(join(withBrain, 'vendor'), 'protocol-test')).manifest.kind, 'foliage-brain');
  await verifyRuntime(withBrain);

  const plain = install([without, '--no-brain']);
  assert.equal(plain.status, 0, plain.stderr);
  assert.doesNotMatch(plain.stdout, /local brain/);
  await assert.rejects(lstat(join(without, 'vendor')), { code: 'ENOENT' });
  await verifyRuntime(without);

  // A brain named with --with-brain is the one installed, and the download's own is not mentioned.
  const other = join(root, 'other-download', 'vendor');
  await mkdir(other, { recursive: true });
  await syntheticBrain(other);
  const named = install([join(root, 'named-brain'), '--with-brain', other]);
  assert.equal(named.status, 0, named.stderr);
  assert.doesNotMatch(named.stdout, /came with this download/);
  assert.match(named.stdout, /with its local brain at /);
  // The download's runtime folder is never changed by any of it.
  await verifyRuntime(runtime);
});

test('install.mjs with no brain beside runtime/, where one ships, installs Foliage without it and says so in one line; --no-brain, or a platform where none ships, says nothing', async t => {
  const { root, runtime, vendor, install } = await syntheticDownload(t);
  // The runtime folder alone, as when it is copied out of the download.
  await rename(vendor, join(root, 'moved-vendor'));
  const without = join(root, 'without');
  const ran = install([without]);
  assert.equal(ran.status, 0, ran.stderr);
  const lines = ran.stdout.split('\n');
  assert.equal(lines.filter(line => line === MISSED(without)).length, 1, ran.stdout);
  assert.ok(lines.includes(`Installed Foliage protocol-test at ${without}.`), ran.stdout);
  assert.doesNotMatch(ran.stdout, /with its local brain|came with this download/);
  await assert.rejects(lstat(join(without, 'vendor')), { code: 'ENOENT' });
  await verifyRuntime(without);
  // --no-brain: the person chose it, so nothing is said.
  const chosen = install([join(root, 'chosen'), '--no-brain']);
  assert.equal(chosen.status, 0, chosen.stderr);
  assert.doesNotMatch(chosen.stdout, /local brain/);
  // Where no brain ships (the release's own rule says so), none was missed.
  await writeFile(join(runtime, 'apps', 'leaf', 'src', 'brainVendor.ts'), STAND_IN_CHECKS.replace('return true; }', 'return false; }'));
  await writeRuntimeManifest(runtime, { version: 'protocol-test', platform: process.platform, arch: process.arch });
  const elsewhere = install([join(root, 'elsewhere-platform')]);
  assert.equal(elsewhere.status, 0, elsewhere.stderr);
  assert.doesNotMatch(elsewhere.stdout, /local brain/);
});

test('a brain beside runtime/ that fails its checks stops the install, with nothing made, and is never skipped; --no-brain is the way past it', async t => {
  const { root, vendor, install } = await syntheticDownload(t);
  const refusedAt = join(root, 'refused');
  /** @param {RegExp} message */
  const refused = async message => {
    const ran = install([refusedAt]);
    assert.equal(ran.status, 1, ran.stdout);
    assert.match(ran.stderr, message);
    assert.doesNotMatch(ran.stderr, NAMED_REMEDIES);
    assert.equal(ran.stdout, '', 'nothing said it was installed');
    await assert.rejects(lstat(refusedAt), { code: 'ENOENT' });
  };
  // What failed, then the download's own way out: no brain archive is published on its own, and the
  // person passed no folder, so neither is named.
  const said = (/** @type {string} */ cause) => new RegExp(`^The local brain that came with this download, at ${vendor.replaceAll('/', '\\/')}, was refused: ${cause} ${AGAIN}\\n$`);
  // One changed byte.
  await writeFile(join(vendor, 'gbrain', 'src', 'cli.ts'), '// one changed byte\n');
  await refused(said('Release integrity check failed: gbrain\\/src\\/cli\\.ts\\.'));
  // An extra file.
  await syntheticBrain(vendor);
  await writeFile(join(vendor, 'gbrain', 'extra.js'), "fetch('http://example.test')\n");
  await refused(said('Unlisted release file: gbrain\\/extra\\.js\\.'));
  await rm(join(vendor, 'gbrain', 'extra.js'));
  // A brain released with another Foliage.
  await syntheticBrain(vendor, { foliageVersion: 'another-version' });
  await refused(said('This brain archive belongs to Foliage another-version, and this Foliage is protocol-test\\.'));
  // A vendor/ that is no brain at all.
  await rm(vendor, { recursive: true });
  await mkdir(vendor);
  await refused(said('This is not a Foliage brain: it has no readable release\\.json\\.'));
  // The person's own way past it: --no-brain installs Foliage alone.
  const plain = install([refusedAt, '--no-brain']);
  assert.equal(plain.status, 0, plain.stderr);
  await assert.rejects(lstat(join(refusedAt, 'vendor')), { code: 'ENOENT' });
  await verifyRuntime(refusedAt);
});

test('a brain refused for an install the person named with --with-brain keeps its own words; one that came with the download says where it came from and to download Foliage again; room and the install folder are said as they are', async t => {
  const { root, runtime, vendor } = await syntheticDownload(t);
  await writeFile(join(vendor, 'gbrain', 'LICENSE'), 'one changed byte\n');
  await assert.rejects(installRuntime(runtime, join(root, 'named'), { brain: vendor, checks: standIn() }), /^Error: Release integrity check failed: gbrain\/LICENSE\. Obtain the brain archive again\.$/);
  await assert.rejects(installRuntime(runtime, join(root, 'bundled'), { brain: vendor, bundled: true, checks: standIn() }),
    new RegExp(`^Error: The local brain that came with this download, at .*\\/vendor, was refused: Release integrity check failed: gbrain\\/LICENSE\\. ${AGAIN}$`));
  await syntheticBrain(vendor);
  // Foliage's own preflight: named once, as the download's brain, never as a brain archive.
  await assert.rejects(installRuntime(runtime, join(root, 'preflight'), { brain: vendor, checks: standIn({ refuse: 'vendor/bun/bun is not executable' }) }),
    /^Error: The brain archive was refused: vendor\/bun\/bun is not executable\. Obtain the brain archive again\.$/);
  await assert.rejects(installRuntime(runtime, join(root, 'preflight'), { brain: vendor, bundled: true, checks: standIn({ refuse: 'vendor/bun/bun is not executable' }) }),
    new RegExp(`^Error: The local brain that came with this download, at .*\\/vendor, was refused: vendor\\/bun\\/bun is not executable\\. ${AGAIN}$`));
  // Room is not the brain's fault: the download's brain can only be left out.
  await assert.rejects(installRuntime(runtime, join(root, 'no-room'), { brain: vendor, bundled: true, checks: standIn({ free: 0 }) }),
    /^Error: The disk you are installing to has too little room for the brain and one empty garden brain\. Nothing was installed\. To install Foliage without the local brain, add --no-brain\.$/);
  // Nor is where the person chose to install: a folder inside the download's vendor/ is refused as it
  // is, with no --no-brain, which would install Foliage into that vendor folder.
  await assert.rejects(installRuntime(runtime, join(vendor, 'inside'), { brain: vendor, bundled: true, checks: standIn() }),
    /^Error: Choose an installation directory outside the extracted brain archive\.$/);
  for (const name of ['named', 'bundled', 'preflight', 'no-room']) await assert.rejects(lstat(join(root, name)), { code: 'ENOENT' });
  await assert.rejects(lstat(join(vendor, 'inside')), { code: 'ENOENT' });
});

test('install.mjs refuses a release folder with a brain inside it, with or without --no-brain; the brain belongs beside it', async t => {
  const { root, runtime, vendor, install } = await syntheticDownload(t);
  await rename(vendor, join(runtime, 'vendor'));
  for (const flags of [[], ['--no-brain']]) {
    const ran = install([join(root, 'refused'), ...flags]);
    assert.equal(ran.status, 1, ran.stdout);
    assert.ok(ran.stderr.startsWith(`${runtime} holds a vendor/ folder inside it, where no brain belongs: the download keeps the brain in vendor/ beside the runtime folder`), ran.stderr);
    await assert.rejects(lstat(join(root, 'refused')), { code: 'ENOENT' });
  }
});
