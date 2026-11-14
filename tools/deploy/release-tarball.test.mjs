/**
 * How both release archives are packed (`releaseTarball` in `package-local.mjs`): what a header may
 * say, read back without extracting anything. Every tree below is SYNTHETIC: a few small files in a
 * temporary folder. The packing itself is bsdtar's (macOS), so those steps run on macOS only.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { releaseMetadataProblems, releaseTarball, tarEntries } from './package-local.mjs';

/** @param {import('node:test').TestContext} t */
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'foliage-release-tarball-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('a release header may name no builder, carry no extended attribute, and leave nothing writable by others; a long path is fine', () => {
  const clean = { name: 'runtime/', type: '5', mode: 0o755, uid: 0, gid: 0, uname: '', gname: '', pax: [] };
  assert.deepEqual(releaseMetadataProblems([
    clean,
    { ...clean, name: 'runtime/a.js', type: '0', mode: 0o644 },
    { ...clean, name: 'runtime/bin', type: '0', mode: 0o755 },
    { ...clean, name: 'runtime/link', type: '2', mode: 0o777 },
    { ...clean, name: `runtime/${'long/'.repeat(60)}file.js`, type: '0', mode: 0o644, pax: ['path'] },
  ]), []);
  // SYNTHETIC entries in the shape the 0.3.0 archives had.
  assert.deepEqual(releaseMetadataProblems([
    { ...clean, name: 'runtime/x.js', type: '0', mode: 0o644, uid: 501, gid: 20, uname: 'builder', gname: 'staff', pax: ['mtime', 'LIBARCHIVE.xattr.com.apple.provenance', 'SCHILY.xattr.com.apple.provenance'] },
    { ...clean, name: 'vendor/', mode: 0o700 },
    { ...clean, name: 'vendor/gbrain/node_modules/p/index.js', type: '0', mode: 0o666 },
    { ...clean, name: 'runtime/._x.js', type: '0', mode: 0o644 },
  ]), [
    'runtime/x.js carries mtime, LIBARCHIVE.xattr.com.apple.provenance, SCHILY.xattr.com.apple.provenance',
    'runtime/x.js is owned by builder:staff, not 0:0 with no names',
    'vendor/ is a directory stored mode 0700, not 0755',
    'vendor/gbrain/node_modules/p/index.js is stored mode 0666, writable by group or others',
    'runtime/._x.js is an AppleDouble file',
  ]);
  // SYNTHETIC entries: what Finder leaves and git's own files, at any depth, never ship either.
  assert.deepEqual(releaseMetadataProblems([
    { ...clean, name: 'runtime/.DS_Store', type: '0', mode: 0o644 },
    { ...clean, name: 'vendor/gbrain/node_modules/p/.github/', type: '5' },
    { ...clean, name: 'vendor/gbrain/node_modules/p/.github/ci.yml', type: '0', mode: 0o644 },
    { ...clean, name: 'runtime/apps/.gitignore', type: '0', mode: 0o644 },
    { ...clean, name: 'vendor/Icon\r', type: '0', mode: 0o644 },
    { ...clean, name: 'runtime/.localized', type: '0', mode: 0o644 },
    // Names that only look like them do ship.
    { ...clean, name: 'runtime/apps/github.mjs', type: '0', mode: 0o644 },
    { ...clean, name: 'runtime/apps/x.DS_Store.mjs', type: '0', mode: 0o644 },
  ]), [
    "runtime/.DS_Store is a file Finder leaves, which no release ships",
    "vendor/gbrain/node_modules/p/.github/ is one of git's own files, which no release ships",
    "vendor/gbrain/node_modules/p/.github/ci.yml is one of git's own files, which no release ships",
    "runtime/apps/.gitignore is one of git's own files, which no release ships",
    "vendor/Icon\r is a file Finder leaves, which no release ships",
    "runtime/.localized is a file Finder leaves, which no release ships",
  ]);
});

test("releaseTarball packs with no extended attribute, owner name or macOS metadata, which a plain tar keeps; it refuses a private directory and keeps no archive", async t => {
  if (process.platform !== 'darwin') {
    t.diagnostic(`release archives are packed with macOS bsdtar; nothing is packed on ${process.platform}`);
    return;
  }
  const dir = await temporary(t);
  const top = join(dir, 'runtime');
  await mkdir(join(top, 'sub'), { recursive: true });
  await writeFile(join(top, 'sub', 'file.txt'), 'SYNTHETIC\n');
  await chmod(join(top, 'sub', 'file.txt'), 0o644);
  for (const path of [top, join(top, 'sub')]) await chmod(path, 0o755);
  // An extended attribute of our own, beside the com.apple.provenance macOS may add to every file a process writes.
  const marked = spawnSync('/usr/bin/xattr', ['-w', 'com.foliage.synthetic', 'SYNTHETIC', join(top, 'sub', 'file.txt')], { encoding: 'utf8' });
  assert.equal(marked.status, 0, marked.stderr);

  // Control: a plain tar, as the 0.3.0 runtime archive was packed by hand, keeps the attribute and the builder's name.
  const plain = join(dir, 'plain.tgz');
  const packed = spawnSync('/usr/bin/tar', ['-czf', plain, '-C', dir, 'runtime'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1' } });
  assert.equal(packed.status, 0, packed.stderr);
  const seen = await tarEntries(plain);
  assert.ok(seen.some(entry => entry.pax.includes('LIBARCHIVE.xattr.com.foliage.synthetic')), 'the reader sees an extended attribute a plain tar keeps');
  assert.ok(releaseMetadataProblems(seen).some(problem => / is owned by /.test(problem)), "the reader sees the builder's owner");

  const archive = join(dir, 'release.tgz');
  const entries = await releaseTarball(archive, dir, 'runtime');
  assert.deepEqual(entries.map(entry => [entry.name, entry.type, (entry.mode & 0o7777).toString(8), entry.uid, entry.gid, entry.uname, entry.gname, entry.pax]), [
    ['runtime/', '5', '755', 0, 0, '', '', []],
    ['runtime/sub/', '5', '755', 0, 0, '', '', []],
    ['runtime/sub/file.txt', '0', '644', 0, 0, '', '', []],
  ]);
  assert.deepEqual(await tarEntries(archive), entries, 'read back the same way');
  await assert.rejects(releaseTarball(archive, dir, 'runtime'), /already exists; a release archive is always new/);

  // Two top-level folders, as the one download holds runtime/ and vendor/, in the order given.
  const second = join(dir, 'vendor');
  await mkdir(second);
  await chmod(second, 0o755);
  await writeFile(join(second, 'release.json'), '{"synthetic":true}\n');
  await chmod(join(second, 'release.json'), 0o644);
  const both = join(dir, 'both.tgz');
  assert.deepEqual((await releaseTarball(both, dir, ['runtime', 'vendor'])).map(entry => entry.name),
    ['runtime/', 'runtime/sub/', 'runtime/sub/file.txt', 'vendor/', 'vendor/release.json']);
  // A Finder file in either is refused by name, and no archive is kept.
  await writeFile(join(second, '.DS_Store'), 'SYNTHETIC Finder settings\n');
  await chmod(join(second, '.DS_Store'), 0o644);
  await assert.rejects(releaseTarball(join(dir, 'finder.tgz'), dir, ['runtime', 'vendor']), /finder\.tgz would carry what the release must not \(1 entries\), so it was removed:\n  vendor\/\.DS_Store is a file Finder leaves, which no release ships/);
  await assert.rejects(lstat(join(dir, 'finder.tgz')), { code: 'ENOENT' });

  // A private directory, as staging leaves vendor/: refused by name, and no archive is kept.
  await chmod(join(top, 'sub'), 0o700);
  const refused = join(dir, 'refused.tgz');
  await assert.rejects(releaseTarball(refused, dir, 'runtime'), /refused\.tgz would carry what the release must not \(1 entries\), so it was removed:\n  runtime\/sub\/ is a directory stored mode 0700, not 0755/);
  await assert.rejects(lstat(refused), { code: 'ENOENT' });
});

test('package-local.mjs --archive names no file of its own (the one download is named for its version, platform and commit), and a usage it cannot read is refused before anything is packaged', async t => {
  const dir = await temporary(t);
  const cli = fileURLToPath(new URL('./package-local.mjs', import.meta.url));
  for (const args of [['--archive', join(dir, 'a.tgz')], ['--archive', '--archive'], ['--include-working-tree', '--include-working-tree'], ['--archives'], ['--archive=yes']]) {
    const ran = spawnSync(process.execPath, [cli, join(dir, 'download'), ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 30_000 });
    assert.equal(ran.status, 1, args.join(' '));
    assert.ok(ran.stderr.startsWith('package-local: Usage: node tools/deploy/package-local.mjs <new-directory> [--include-working-tree] [--archive]\n  --archive  builds the one download in <new-directory>: runtime/, vendor/'), `${args.join(' ')}: ${ran.stderr}`);
  }
  // No folder, or two.
  for (const args of [[], [join(dir, 'one'), join(dir, 'two'), '--archive']]) {
    const ran = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 30_000 });
    assert.equal(ran.status, 1, args.join(' '));
    assert.match(ran.stderr, /^package-local: Usage: /);
  }
  assert.deepEqual(await readdir(dir), [], 'nothing was packaged');
});
