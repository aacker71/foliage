/**
 * The brain archive's notices and the packager's refusals. Every package and gbrain file below is
 * SYNTHETIC and labelled so; the refusals that come after bun's own check run on a synthetic checkout
 * carrying a copy of the real pinned bun, which is never executed here. Packaging the real staged
 * tree, installing it on a clean machine and running it offline is `package-local.test.mjs`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brainArchiveShips, BUN_PIN, GBRAIN_PIN, hashVendorTree, sha256File } from '../../apps/leaf/src/brainVendor.ts';
import { plantProbe } from '../brain/plant-egress-probe.mjs';
import { egressSurface } from '../brain/stage-gbrain.mjs';
import { BUN_LICENSE, brainArchiveName, brainStartHere, grammarFiles, packageBrain, releaseModes, stagedPackages, thirdPartyNotices } from './package-brain.mjs';

/** @param {import('node:test').TestContext} t */
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'foliage-package-brain-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the archive is named for its Foliage version and platform', () => {
  assert.equal(brainArchiveName('0.2.0', 'darwin', 'arm64'), 'foliage-brain-0.2.0-darwin-arm64.tgz');
});

test("THIRD-PARTY-NOTICES carries gbrain's MIT notice, bun's licence and every package's own files verbatim, and lists what counsel must see", () => {
  const gbrain = 'MIT License\n\nCopyright (c) 2026 Synthetic Author\n';
  const bun = 'Synthetic stand-in for bun\'s licence page.\n';
  const notices = thirdPartyNotices({
    unit: 'Foliage local brain 0.0.0-synthetic for darwin/arm64',
    gbrain: { version: '0.0.0', commit: 'synthetic', license: gbrain },
    bun: { version: '0.0.0', sha256: '0'.repeat(64), license: bun, source: 'a synthetic source line' },
    packages: [
      { path: 'node_modules/synthetic-mit', name: 'synthetic-mit', version: '1.0.0', license: 'MIT', dependencies: ['synthetic-lgpl'], files: [{ name: 'LICENSE', text: 'Synthetic MIT text\r\nwith a CRLF line\r\n' }] },
      { path: 'node_modules/synthetic-lgpl', name: 'synthetic-lgpl', version: '2.0.0', license: 'LGPL-3.0', dependencies: [], files: [{ name: 'COPYING', text: 'Synthetic LGPL text\n' }, { name: 'NOTICE', text: 'Synthetic notice\n' }] },
      { path: 'node_modules/@synthetic/bare', name: '@synthetic/bare', version: '3.0.0', license: 'Apache-2.0', dependencies: [], files: [] },
    ],
    grammars: ['src/assets/wasm/grammars/tree-sitter-a.wasm', 'src/assets/wasm/grammars/tree-sitter-b.wasm', 'node_modules/tree-sitter-wasms/out/tree-sitter-a.wasm'],
  });
  // The same unit ships in the one download and the brain-only archive, so it names neither archive.
  assert.match(notices, /^THIRD-PARTY NOTICES for the Foliage local brain 0\.0\.0-synthetic for darwin\/arm64\n\nThis folder bundles software made by others\./m);
  assert.doesNotMatch(notices, /\.tgz/);
  assert.ok(notices.includes(gbrain.trimEnd()), "gbrain's notice, verbatim");
  assert.ok(notices.includes(bun.trimEnd()) && notices.includes('Text: a synthetic source line'), "bun's licence, verbatim, with where it came from");
  assert.ok(notices.includes('Synthetic MIT text\r\nwith a CRLF line'), 'a licence file keeps its own line endings');
  assert.ok(notices.includes('--- COPYING\nSynthetic LGPL text') && notices.includes('--- NOTICE\nSynthetic notice'), 'licence and notice files, each named');
  assert.ok(notices.includes('No licence file ships in this package. Its package.json declares: Apache-2.0.'));
  assert.ok(notices.includes('by declared licence: Apache-2.0 1, LGPL-3.0 1, MIT 1.'));
  assert.ok(notices.includes('  - synthetic-lgpl@2.0.0 is LGPL-3.0, required by synthetic-mit.'));
  assert.ok(notices.includes('  - 2 tree-sitter grammar .wasm files in vendor/gbrain/src/assets/wasm/grammars carry no licence of their own.'));
  assert.ok(notices.includes('  - 1 tree-sitter grammar .wasm files in vendor/gbrain/node_modules/tree-sitter-wasms/out carry no licence of their own.'));
  assert.ok(notices.includes('  - 1 packages ship no licence file; their package.json declares one: @synthetic/bare@3.0.0 (Apache-2.0).'));
  assert.ok(notices.includes('  - bun statically links JavaScriptCore and WebKit, which are LGPL-2: whoever redistributes bun must let its users relink it'),
    "bun's LGPL-2 linking is its own item for counsel");
  assert.ok(notices.indexOf('FOR COUNSEL BEFORE RELEASE') < notices.indexOf('====='), 'what counsel must see comes first');
  assert.ok(notices.endsWith('\n') && !notices.endsWith('\n\n\n'));
});

test('the staged packages are read with their own licence files, nested ones included; grammar files are found by name', async t => {
  const gbrain = await temporary(t);
  const write = async (/** @type {string} */ path, /** @type {string} */ text) => { await mkdir(join(gbrain, path, '..'), { recursive: true }); await writeFile(join(gbrain, path), text); };
  // SYNTHETIC packages.
  await write('node_modules/plain/package.json', JSON.stringify({ name: 'plain', version: '1.0.0', license: 'MIT', dependencies: { nested: '1' } }));
  await write('node_modules/plain/LICENSE.md', 'synthetic plain licence\n');
  await write('node_modules/plain/licensed.js', '// not a licence file\n');
  await write('node_modules/plain/node_modules/nested/package.json', JSON.stringify({ name: 'nested', version: '2.0.0', licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }));
  await write('node_modules/@scope/pkg/package.json', JSON.stringify({ name: '@scope/pkg', version: '3.0.0', license: { type: 'ISC' } }));
  await write('node_modules/@scope/pkg/NOTICE', 'synthetic notice\n');
  await write('node_modules/.bin/tool', '#!/bin/sh\n');
  await write('node_modules/tree-sitter-wasms/out/tree-sitter-x.wasm', 'synthetic');
  await write('src/assets/wasm/tree-sitter.wasm', 'synthetic runtime, not a grammar');
  const packages = await stagedPackages(gbrain);
  assert.deepEqual(packages.map(entry => [entry.path, entry.license, entry.files.map(file => file.name)]), [
    ['node_modules/@scope/pkg', 'ISC', ['NOTICE']],
    ['node_modules/plain', 'MIT', ['LICENSE.md']],
    ['node_modules/plain/node_modules/nested', 'MIT OR Apache-2.0', []],
  ]);
  assert.deepEqual(packages.find(entry => entry.name === 'plain')?.dependencies, ['nested']);
  assert.deepEqual(await grammarFiles(gbrain), ['node_modules/tree-sitter-wasms/out/tree-sitter-x.wasm']);
});

test("the brain's START-HERE says it comes with Foliage and is installed with it, and --add-brain is for an install made without it", () => {
  const text = brainStartHere('0.0.0-synthetic', 'darwin', 'arm64');
  assert.match(text, /^# Foliage local brain 0\.0\.0-synthetic\n/);
  // The same file ships in the brain-only archive and in every installed vendor/, where no runtime folder is beside it.
  assert.ok(text.includes("It comes with Foliage. Installing Foliage from the runtime folder of the same download ('node install.mjs /absolute/path/to/a/new/foliage-folder', run in that folder) checks every file of this folder and installs it too. Add --no-brain to install Foliage without it."), text);
  assert.doesNotMatch(text, /beside this one/);
  assert.ok(text.includes('To add it later to an existing Foliage 0.0.0-synthetic install that has no brain:\n   node /absolute/foliage-folder/install.mjs --add-brain /absolute/path/to/this/vendor /absolute/foliage-folder\n'), text);
  assert.ok(text.includes('--replace-brain') && text.includes('THIRD-PARTY-NOTICES'));
  assert.doesNotMatch(text, /\/Users\/|\/home\//, "no builder's path");
  // It comes in the one download, whose SHA-256 is checked: no separate brain download, digest or --with-brain step.
  assert.doesNotMatch(text, /SHA-256|shasum|foliage-brain-|separate|--with-brain/);
});

test("bun's committed licence text is the one Foliage pins", async () => {
  const { createHash } = await import('node:crypto');
  const text = await readFile(new URL(`../../${BUN_LICENSE.file}`, import.meta.url));
  assert.equal(createHash('sha256').update(text).digest('hex'), BUN_LICENSE.sha256);
  assert.match(text.toString('utf8'), /^Bun itself is MIT-licensed\.$/m);
});

test('no brain archive is made for a platform Foliage pins no bun for, or with nothing staged; nothing is written', async t => {
  const dir = await temporary(t);
  const output = join(dir, 'out');
  for (const [platform, arch] of /** @type {[string, string][]} */ ([['linux', 'x64'], ['linux', 'arm64'], ['win32', 'x64']])) {
    await assert.rejects(packageBrain(output, { platform, arch, includeWorkingTree: true }), new RegExp(`No brain archive ships for ${platform}/${arch}: only macOS arm64 has passed the offline test`));
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    // A SYNTHETIC checkout with nothing staged in vendor/.
    const root = join(dir, 'checkout');
    await mkdir(root);
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.0.0-synthetic' }));
    const git = { env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1' } };
    assert.equal(spawnSync('git', ['init', '--quiet', root], git).status, 0);
    assert.equal(spawnSync('git', ['-C', root, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.test', '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '--allow-empty', '-m', 'synthetic'], git).status, 0);
    await assert.rejects(packageBrain(output, { root, includeWorkingTree: true }), /cannot ship: no brain is staged\. Restage it: node tools\/brain\/stage-gbrain\.mjs/);
    await assert.rejects(packageBrain(output, { root }), /Commit the release source first/);
    // A SYNTHETIC staged tree with Foliage's pins whose stand-in bun is not the bytes Foliage ships.
    const vendor = join(root, 'vendor');
    await mkdir(join(vendor, 'bun'), { recursive: true });
    await mkdir(join(vendor, 'gbrain', 'src'), { recursive: true });
    await writeFile(join(vendor, 'bun', 'bun'), 'synthetic stand-in for bun; never executed\n');
    await writeFile(join(vendor, 'gbrain', 'src', 'cli.ts'), '// synthetic stand-in for gbrain\n');
    const { BUN_PIN, GBRAIN_PIN, hashVendorTree, sha256File } = await import('../../apps/leaf/src/brainVendor.ts');
    await writeFile(join(vendor, 'brain.json'), JSON.stringify({
      schemaVersion: 1, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, gbrainIntegrity: GBRAIN_PIN.integrity, bunVersion: BUN_PIN.version,
      bunSha256: await sha256File(join(vendor, 'bun', 'bun')), cliSha256: await sha256File(join(vendor, 'gbrain', 'src', 'cli.ts')),
      platform: process.platform, arch: process.arch, files: await hashVendorTree(vendor),
    }));
    await assert.rejects(packageBrain(output, { root, includeWorkingTree: true }), /cannot ship: vendor\/bun\/bun is not the bun Foliage ships/);
  } else {
    await assert.rejects(packageBrain(output, { platform: 'darwin', arch: 'arm64', includeWorkingTree: true }), /Build the darwin\/arm64 brain archive on darwin\/arm64/);
  }
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

/** The real pinned bun, in this checkout's staged vendor/; copied, never executed, by the test below. */
const PINNED_BUN = fileURLToPath(new URL('../../vendor/bun/bun', import.meta.url));

/**
 * A SYNTHETIC checkout whose staged tree passes the pin, file and bun checks: a copy of the real pinned
 * bun, a stand-in gbrain that reaches nothing, the egress surface that tree has (none) and bun's real
 * licence text, committed. What comes after those checks is what the test below changes.
 * @param {string} dir
 */
async function shippableCheckout(dir) {
  const root = join(dir, 'checkout'), vendor = join(root, 'vendor');
  await mkdir(join(vendor, 'bun'), { recursive: true });
  await mkdir(join(vendor, 'gbrain', 'src'), { recursive: true });
  await mkdir(join(root, 'tools', 'brain'), { recursive: true });
  await copyFile(PINNED_BUN, join(vendor, 'bun', 'bun'), constants.COPYFILE_FICLONE);
  await chmod(join(vendor, 'bun', 'bun'), 0o755);
  await writeFile(join(vendor, 'gbrain', 'src', 'cli.ts'), '// SYNTHETIC stand-in for gbrain; never executed\n');
  await writeFile(join(vendor, 'gbrain', 'LICENSE'), 'SYNTHETIC licence stand-in\n');
  await writeFile(join(vendor, 'brain.json'), JSON.stringify({
    schemaVersion: 1, gbrainVersion: GBRAIN_PIN.version, gbrainCommit: GBRAIN_PIN.commit, gbrainIntegrity: GBRAIN_PIN.integrity, bunVersion: BUN_PIN.version,
    bunSha256: await sha256File(join(vendor, 'bun', 'bun')), cliSha256: await sha256File(join(vendor, 'gbrain', 'src', 'cli.ts')),
    platform: process.platform, arch: process.arch, files: await hashVendorTree(vendor),
  }));
  await writeFile(join(root, 'tools', 'brain', 'egress-surface.json'), JSON.stringify({ gbrainCommit: GBRAIN_PIN.commit, files: await egressSurface(join(vendor, 'gbrain')) }));
  await copyFile(fileURLToPath(new URL(`../../${BUN_LICENSE.file}`, import.meta.url)), join(root, BUN_LICENSE.file));
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.0.0-synthetic' }));
  const git = { env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1' } };
  assert.equal(spawnSync('git', ['init', '--quiet', root], git).status, 0);
  assert.equal(spawnSync('git', ['-C', root, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.test', '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '--allow-empty', '-m', 'synthetic'], git).status, 0);
  return { root, vendor };
}

test('a planted fetch never ships, by name, and nor does a changed bun licence; nothing is written', async t => {
  if (!brainArchiveShips(process.platform, process.arch)) {
    t.diagnostic(`no brain archive is built for ${process.platform}/${process.arch}; its refusal is tested above`);
    return;
  }
  const pinned = BUN_PIN.shipped[`${process.platform}/${process.arch}`];
  assert.equal(await sha256File(PINNED_BUN).catch(() => 'missing'), pinned,
    'this test copies the pinned bun from the staged vendor/; stage it with node tools/brain/stage-gbrain.mjs');
  const dir = await temporary(t);

  // A planted fetch, re-recorded in brain.json as a reviewed pin bump would be, so only the egress
  // surface can catch it (tools/brain/plant-egress-probe.mjs, the gate's negative control).
  const planted = await shippableCheckout(join(dir, 'planted'));
  await plantProbe(planted.vendor, 'fetch');
  const output = join(dir, 'out');
  await assert.rejects(packageBrain(output, { root: planted.root, includeWorkingTree: true }),
    /The staged files that can reach out differ from tools\/brain\/egress-surface\.json, so vendor\/ cannot ship[\s\S]*\n  new: src\/cli\.ts \(fetch\)\n/);
  await assert.rejects(lstat(output), { code: 'ENOENT' });

  // bun's licence text with one byte changed.
  const licensed = await shippableCheckout(join(dir, 'licence'));
  const license = join(licensed.root, BUN_LICENSE.file);
  const bytes = await readFile(license);
  bytes[bytes.length - 2] = (bytes[bytes.length - 2] ?? 0) ^ 1;
  await writeFile(license, bytes);
  await assert.rejects(packageBrain(output, { root: licensed.root, includeWorkingTree: true }), /tools\/brain\/bun-LICENSE\.md is not the licence text Foliage pins/);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test("a staged tree that still holds upstream's development files never ships, by name; nothing is written", async t => {
  if (!brainArchiveShips(process.platform, process.arch)) {
    t.diagnostic(`no brain archive is built for ${process.platform}/${process.arch}; its refusal is tested above`);
    return;
  }
  assert.equal(await sha256File(PINNED_BUN).catch(() => 'missing'), BUN_PIN.shipped[`${process.platform}/${process.arch}`],
    'this test copies the pinned bun from the staged vendor/; stage it with node tools/brain/stage-gbrain.mjs');
  const dir = await temporary(t);
  const { root, vendor } = await shippableCheckout(dir);
  // SYNTHETIC stand-ins for what the 0.3.0 candidate shipped, recorded in brain.json as staging recorded them then.
  await mkdir(join(vendor, 'gbrain', '.github', 'workflows'), { recursive: true });
  await writeFile(join(vendor, 'gbrain', '.github', 'workflows', 'ci.yml'), '# SYNTHETIC upstream workflow\n');
  await writeFile(join(vendor, 'gbrain', '.env.testing.example'), 'SYNTHETIC_API_KEY=placeholder\n');
  const manifest = JSON.parse(await readFile(join(vendor, 'brain.json'), 'utf8'));
  await writeFile(join(vendor, 'brain.json'), JSON.stringify({ ...manifest, files: await hashVendorTree(vendor) }));
  const output = join(dir, 'out');
  await assert.rejects(packageBrain(output, { root, includeWorkingTree: true }),
    /cannot ship: it still holds upstream development files that staging drops \(vendor\/gbrain\/\.env\.testing\.example, vendor\/gbrain\/\.github\/workflows\/ci\.yml\)\. Restage it: node tools\/brain\/stage-gbrain\.mjs/);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test('the brain unit is packed with the modes a release ships: directories 0755, files 0644 or 0755 by their execute bits, links untouched', async t => {
  const dir = await temporary(t);
  // A SYNTHETIC unit with the modes staging and bun install left in the 0.3.0 tree.
  const unit = join(dir, 'vendor');
  await mkdir(join(unit, 'bun'), { recursive: true, mode: 0o700 });
  await mkdir(join(unit, 'gbrain', 'node_modules', 'pkg'), { recursive: true });
  const files = /** @type {const} */ ([['bun/bun', 0o700], ['gbrain/node_modules/pkg/index.js', 0o666], ['gbrain/node_modules/pkg/cli.js', 0o777], ['gbrain/LICENSE', 0o600]]);
  for (const [path, mode] of files) {
    await writeFile(join(unit, path), 'SYNTHETIC\n');
    await chmod(join(unit, path), mode);
  }
  await chmod(unit, 0o700);
  await chmod(join(unit, 'bun'), 0o700);
  await symlink('pkg/cli.js', join(unit, 'gbrain', 'node_modules', 'pkg-cli'));
  await releaseModes(unit);
  const mode = async (/** @type {string} */ path) => ((await lstat(join(unit, path))).mode & 0o7777).toString(8);
  assert.deepEqual(await Promise.all(['', 'bun', 'gbrain', 'gbrain/node_modules', 'gbrain/node_modules/pkg'].map(mode)), ['755', '755', '755', '755', '755']);
  assert.deepEqual(await Promise.all(files.map(([path]) => mode(path))), ['755', '644', '755', '644']);
  assert.ok((await lstat(join(unit, 'gbrain', 'node_modules', 'pkg-cli'))).isSymbolicLink(), 'a link stays a link');
});
