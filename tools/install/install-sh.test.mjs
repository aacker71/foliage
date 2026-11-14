/**
 * The source-checkout installer, run the way a person runs it: `sh install.sh` from this
 * checkout. It must finish, and its last advice must be the command the quickstart teaches,
 * which reads the garden — not `pnpm dev`, which serves the checkout's own apps/leaf/leaf.json.
 *
 * The workspace is already installed when tests run, so the installer's `pnpm install` is a
 * measured no-op here (it writes nothing). The installer runs in its own process group so a
 * hang is ended whole: a server left behind would hold its port and these pipes open.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const LIMIT_MS = 90_000;

/** The caller's environment without a garden selection, so the run cannot name the owner's. */
function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FOLIAGE_')));
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{status: number | null, timedOut: boolean, stdout: string, stderr: string}>}
 */
function runInstaller(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', [join(root, 'install.sh'), ...args], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    }, LIMIT_MS);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, timedOut, stdout, stderr }); });
  });
}

test('install.sh is recorded executable, so ./install.sh runs as the docs say', () => {
  const entry = execFileSync('git', ['-C', root, 'ls-files', '-s', '--', 'install.sh'], { encoding: 'utf8' });
  assert.match(entry, /^100755 /, entry);
});

test('sh install.sh finishes and ends with the quickstart command', async () => {
  const run = await runInstaller([], cleanEnv());
  assert.equal(run.timedOut, false, `installer did not finish in ${LIMIT_MS} ms:\n${run.stdout}${run.stderr}`);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^Checking the install$/m);
  assert.match(run.stdout, /^Installed\. /m);
  assert.match(run.stdout, /^ +node foliage\.mjs up$/m);
  assert.doesNotMatch(run.stdout, /pnpm dev/);
});

test('with a chosen garden, the closing command starts the app on that garden', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'foliage-install-sh-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  // A space and an apostrophe, because the printed command must survive being pasted.
  const garden = join(scratch, "the owner's garden");
  await mkdir(garden);
  // An installed Aside CLI stand-in that only reports a version: setup then needs no download,
  // and this test reads no browser and contacts nothing.
  const bin = join(scratch, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'aside'), '#!/bin/sh\necho "installer test stand-in"\n');
  await chmod(join(bin, 'aside'), 0o700);
  const env = cleanEnv();
  env['PATH'] = [bin, env['PATH'] ?? ''].join(delimiter);

  const run = await runInstaller(['--with-aside', '--garden', garden], env);
  assert.equal(run.timedOut, false, `installer did not finish in ${LIMIT_MS} ms:\n${run.stdout}${run.stderr}`);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const quoted = `'${garden.replaceAll("'", "'\\''")}'`;
  assert.ok(run.stdout.split('\n').some((line) => line.trim() === `node foliage.mjs up --garden ${quoted}`), run.stdout);
  // The garden named in the advice is the one the Aside profile serves.
  const profile = JSON.parse(await readFile(join(garden, 'integrations', 'aside.mcp.json'), 'utf8'));
  assert.equal(profile.mcpServers.foliage.args.at(-1), await realpath(garden));
});
