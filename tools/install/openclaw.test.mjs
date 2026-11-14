/** Runs the installed skill adapter over real repository history; no invented achievements. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const home = fileURLToPath(new URL('../../', import.meta.url));
const adapter = join(home, 'plugin/foliage/skills/foliage/scripts/photosynthesis.mjs');
/** @param {string[]} args */
const run = (args) => spawnSync(process.execPath, [adapter, ...args], { encoding: 'utf8', timeout: 120000 });
test('OpenClaw refresh requires explicit destinations and never falls back to cwd', async () => {
  const garden = await mkdtemp(join(tmpdir(), 'foliage-host-'));
  try {
    assert.notEqual(run(['refresh', '--home', home]).status, 0);
    assert.notEqual(run(['refresh', '--home', home, '--garden', garden, '--garden', garden]).status, 0);
    const noSource = run(['refresh', '--home', home, '--garden', garden]);
    assert.notEqual(noSource.status, 0);
    assert.match(noSource.stderr, /no watched source/);
    await assert.rejects(readFile(join(garden, 'leaf.json')), { code: 'ENOENT' });
    assert.notEqual(run(['publish', '--home', home, '--garden', garden]).status, 0);
  } finally { await rm(garden, { recursive: true, force: true }); }
});
test('OpenClaw adapter refreshes real Git work through existing intake and retains private state', async () => {
  const garden = await mkdtemp(join(tmpdir(), 'foliage-host-real-'));
  try {
    const git = spawnSync('git', ['-C', home, 'log', '-1', '--format=%ae%n%an'], { encoding: 'utf8' });
    assert.equal(git.status, 0);
    const [identity, subject] = git.stdout.trim().split('\n');
    assert.ok(identity && subject);
    const args = ['refresh', '--home', home, '--garden', garden, '--repo', home, '--identity', identity, '--subject', subject];
    const first = run(args);
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const before = JSON.parse(await readFile(join(garden, 'leaf.json'), 'utf8'));
    assert.ok(before.leaflets.length);
    const second = run(args);
    assert.equal(second.status, 0, second.stderr + second.stdout);
    const after = JSON.parse(await readFile(join(garden, 'leaf.json'), 'utf8'));
    assert.deepEqual(after.leaflets.map((/** @type {{id: string}} */ item) => item.id), before.leaflets.map((/** @type {{id: string}} */ item) => item.id));
    assert.ok(after.leaflets.every((/** @type {{visibility?: string}} */ item) => !item.visibility || item.visibility === 'private'));
    await assert.rejects(readFile(join(garden, 'published.json')), { code: 'ENOENT' });
  } finally { await rm(garden, { recursive: true, force: true }); }
});
