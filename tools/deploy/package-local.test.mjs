import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { brainArchiveShips } from '../../apps/leaf/src/brainVendor.ts';
import { offlineSession } from '../brain/offline-gate.mjs';
import { OWN } from '../brain/offline-proofs.mjs';
import { brainStartHere, packageBrain } from './package-brain.mjs';
import { DOWNLOAD_LIMITS, downloadName, downloadSize, EXTRACT, packageDownload, packageLocal, releaseMetadataProblems, runtimeStartHere, tarEntries } from './package-local.mjs';
import { verifyBrainUnit, verifyRuntime } from '../install/runtime-install.mjs';

test('the archives carry this release\'s version: package.json, VERSION and the newest CHANGELOG entry agree', async () => {
  // The 0.3.0 candidate was built as foliage-local-0.2.0-… and foliage-brain-0.2.0-…, colliding with
  // the live 0.2.0 download, because package.json (which names both archives) had not moved.
  const root = new URL('../../', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8')).version;
  const version = (await readFile(new URL('VERSION', root), 'utf8')).trim();
  // An [Unreleased] section, for fixes not shipped yet, may sit above the newest release, and only
  // there: it names no version, so the entry under it must be this VERSION.
  const headings = [...(await readFile(new URL('CHANGELOG.md', root), 'utf8')).matchAll(/^## \[([^\]]+)\]/gm)].map(heading => heading[1]);
  assert.ok(headings.lastIndexOf('Unreleased') <= 0, `[Unreleased] is only ever the first entry: ${headings.join(', ')}`);
  const newest = headings[0] === 'Unreleased' ? headings[1] : headings[0];
  assert.match(version, /^\d+\.\d+\.\d+\.\d+$/);
  assert.equal(newest, version, 'the newest released CHANGELOG entry is this VERSION');
  assert.equal(version.split('.').slice(0, 3).join('.'), pkg, 'package.json names the archives with the same release');
});

test('START-HERE, followed literally: one download, install from the runtime folder it unpacks into, the brain included, grow needs git, and every command is node with a path', () => {
  for (const [platform, arch] of [['darwin', 'arm64'], ['linux', 'x64']]) {
    const text = runtimeStartHere(platform, arch);
    const ships = brainArchiveShips(platform, arch);
    // The download unpacks into runtime/, with vendor/ beside it where a brain ships (the clean-machine
    // test below builds it that way), and install.mjs is inside runtime/: "from that folder" read as
    // the download folder failed with "Cannot find module '<dir>/install.mjs'". Two top-level folders
    // go into a folder named after the archive when Finder extracts it, and tar into a shared folder
    // mixes them with earlier ones, so step 2 extracts into a new folder by one command.
    assert.ok(text.includes(`2. Extract it into a new, empty folder and go into the runtime folder there. In a terminal: '${EXTRACT}'.${ships ? ' (Double-clicking the file in Finder instead puts its runtime and vendor folders in a folder named after the download: go into the runtime folder inside it.)' : ''} The runtime folder holds this file${ships ? '; the vendor folder beside it holds the local brain' : ''}. From the runtime folder, run: 'node install.mjs /absolute/path/to/a/new/foliage-folder'.${ships ? ' This installs Foliage with its local brain.' : ''} The new folder's parent must exist.`), text);
    assert.equal(EXTRACT, 'mkdir ~/foliage-download && tar -xzf <file> -C ~/foliage-download && cd ~/foliage-download/runtime');
    assert.doesNotMatch(text, /\('cd runtime'\)/);
    assert.doesNotMatch(text, /From that folder/);
    for (const relative of text.match(/[^.]*'node install\.mjs [^']*'/g) ?? []) assert.match(relative, /runtime/, `a relative install.mjs names the runtime folder: ${relative}`);
    // Grow is a step, and it says it needs git and how a Mac gets it.
    assert.match(text, /'node \/absolute\/path\/to\/a\/new\/foliage-folder\/foliage\.mjs grow --repo \/absolute\/path\/to\/the\/repository'/);
    assert.match(text, /git must be installed\. On a Mac without it, 'git --version' offers to install the Xcode Command Line Tools, which include git; 'xcode-select --install' does the same\./);
    // Grow names you from git's user.email and user.name; a newcomer with neither set met two refusals in a row.
    assert.match(text, /If git has no user\.email or user\.name for that repository, add both: 'node \/absolute\/path\/to\/a\/new\/foliage-folder\/foliage\.mjs grow --repo \/absolute\/path\/to\/the\/repository --identity <email> --subject "<name>"'\./);
    // No `foliage` command is on PATH after an install, so none is printed as one.
    assert.match(text, /The installer puts no 'foliage' command on your PATH\./);
    for (const command of text.match(/'[^']*'/g) ?? []) assert.doesNotMatch(command, /^'foliage /, `a bare foliage command: ${command}`);
    // One download, its SHA-256 published beside it on /start: the step points there and says how to compute one.
    assert.match(text, /1\. Check the \.tgz you downloaded: its SHA-256 is published next to the download on getfoliage\.com\/start, and 'shasum -a 256 <file>' must print the same value\./);
    assert.doesNotMatch(text, /published (release )?digest|separate download|foliage-brain-|--with-brain|Do not trust/);
    // The brain is included, runs on this Mac only, and --no-brain leaves it out; where none ships, it says so.
    assert.equal(text.includes('The download includes the local brain'), ships);
    assert.equal(text.includes('It runs on this Mac only and never uses the network'), ships);
    assert.equal(text.includes("run the installer from the runtime folder with --no-brain: 'node install.mjs /absolute/path/to/a/new/foliage-folder --no-brain'"), ships);
    assert.equal(text.includes(`The local brain is not included for ${platform}/${arch} yet.`), !ships);
  }
  const brain = brainStartHere('0.0.0-test', 'darwin', 'arm64');
  // The brain's own START-HERE sends a new install to the runtime folder of the same download, too.
  assert.match(brain, /Installing Foliage from the runtime folder of the same download \('node install\.mjs \/absolute\/path\/to\/a\/new\/foliage-folder', run in that folder\)/);
});

test('local archive relocates Aside and evaluator MCP tools and keeps the open runtime standalone', {timeout:240000}, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'foliage-local-release-'));
  t.after(() => rm(temporary, {recursive:true,force:true}));
  const output = join(temporary,'archive'), installed = join(temporary,'installed');
  const result = await packageLocal(output, {includeWorkingTree:true});
  assert.ok(result.packages.includes('@foliage/leaf-app'));
  assert.ok(!result.packages.includes('@foliage/canopy-app'));
  const manifest = await verifyRuntime(output);
  assert.ok(manifest.files.some(file => file.path === 'tools/install/aside.mjs' && file.sha256));
  assert.ok(manifest.files.some(file => file.path === 'tools/vault/lib/rank.mjs' && file.sha256));
  assert.ok(manifest.files.some(file => file.path === 'apps/leaf/private-brain.mjs' && file.sha256));
  assert.ok(manifest.files.some(file => file.path === 'apps/leaf/src/privateBrainSession.ts' && file.sha256));
  // Every bundled package's licence ships with it, and the notices state Foliage's own licence.
  assert.ok(manifest.files.some(file => file.path === 'THIRD-PARTY-NOTICES' && file.sha256), 'the notices are part of the verified release');
  const notices = await readFile(join(output, 'THIRD-PARTY-NOTICES'), 'utf8');
  const bundled = await readdir(join(output, 'node_modules', '.runtime'));
  assert.ok(bundled.length > 0);
  for (const dir of bundled) {
    const pkg = JSON.parse(await readFile(join(output, 'node_modules', '.runtime', dir, 'package.json'), 'utf8'));
    assert.ok(notices.includes(`${pkg.name}@${pkg.version} · `), `${pkg.name}@${pkg.version} is named in THIRD-PARTY-NOTICES`);
  }
  assert.match(notices, /Foliage's own code in this archive is licensed MIT/);
  assert.match(notices, /^--- LICENSE$/m, 'licence texts ship verbatim');
  const garden = join(temporary,'garden'), bin = join(temporary,'bin');
  await mkdir(garden); await mkdir(bin);
  // A protocol-only executable: no browser, account, page, or work evidence is simulated.
  await writeFile(join(bin,'aside'), '#!/bin/sh\n[ "$1" = "--version" ] || exit 42\nprintf "installer-protocol-probe\\n"\n', {mode:0o700});
  for (const flags of [['--with-aside'],['--garden',garden],['--with-aside','--with-aside','--garden',garden]]) {
    const invalid = spawnSync(process.execPath,[join(output,'install.mjs'),installed,...flags],{env:{PATH:bin},encoding:'utf8',timeout:10000});
    assert.notEqual(invalid.status,0);
    await assert.rejects(readFile(join(installed,'release.json')), {code:'ENOENT'});
  }
  const setup = spawnSync(process.execPath, [join(output,'install.mjs'),installed,'--with-aside','--garden',garden], {env:{PATH:bin},encoding:'utf8',timeout:120000});
  assert.equal(setup.status,0,setup.error?.message ?? setup.stderr);
  const profile = JSON.parse(await readFile(join(garden,'integrations/aside.mcp.json'),'utf8'));
  assert.equal(profile.mcpServers.foliage.args[0],await realpath(join(installed,'foliage.mjs')));
  assert.deepEqual(profile.mcpServers.foliage.args.slice(1),['mcp','--garden',await realpath(garden)]);
  assert.deepEqual(profile.mcpServers.aside.args,['mcp','--host','local']);
  const help = spawnSync(process.execPath,[profile.mcpServers.foliage.args[0],'mcp','--help'],{cwd:installed,env:{},encoding:'utf8',timeout:10000});
  assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/mcp --garden/);
  // The installed copy carries no docs/, so its help names none: it says how a host starts the connection.
  assert.doesNotMatch(help.stdout,/docs\/ASSISTANT-MCP\.md/);
  assert.ok(help.stdout.includes(`your assistant host starts it with '${process.execPath}' '${profile.mcpServers.foliage.args[0]}' mcp --garden /absolute/garden`), help.stdout);
  // The installer says how to run Foliage, since it puts no foliage command on PATH.
  // The Grow command ends its line, so it pastes as printed; with no git on this PATH, that grow
  // needs git is said on the next.
  assert.ok(setup.stdout.includes(`Grow:  node ${JSON.stringify(profile.mcpServers.foliage.args[0])} grow --repo /absolute/path/to/a/git/repository\nGrow needs git, and git is not installed here`), setup.stdout);
  assert.match(setup.stdout, /No foliage command was added to your PATH/);
  // The runtime folder alone, with no vendor/ beside it: where a brain ships, the real rule says so in one line.
  assert.equal(setup.stdout.includes('No local brain was found beside this runtime folder, so Foliage was installed without it.'), brainArchiveShips(process.platform, process.arch), setup.stdout);
  const searchHelp = spawnSync(process.execPath,[profile.mcpServers.foliage.args[0],'search','--help'],{cwd:installed,env:{},encoding:'utf8',timeout:10000});
  assert.equal(searchHelp.status,0,searchHelp.stderr);
  assert.match(searchHelp.stdout,/search <words>/);
  const privateBrainHelp = spawnSync(process.execPath,[profile.mcpServers.foliage.args[0],'private-brain','--help'],{cwd:installed,env:{},encoding:'utf8',timeout:10000});
  assert.equal(privateBrainHelp.status,0,privateBrainHelp.stderr);
  assert.match(privateBrainHelp.stdout,/private-brain list\|receipts\|serve/);
  // Exercise the installed module graph after relocation, not just the file list.
  const rankProbe = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    "import { searchRecords } from './packages/photosynthesis/src/searchGarden.ts'; const hits = searchRecords([{ id: 'protocol:one', kind: 'source', title: 'Archive', text: 'ranker protocol probe', citation: 'protocol:one' }], 'archive'); if (hits[0]?.id !== 'protocol:one') process.exit(1);"],
    { cwd: installed, env: {}, encoding: 'utf8', timeout: 10000 });
  assert.equal(rankProbe.status, 0, rankProbe.stderr);
  // The verified archive remains intact after setup; private connection state lives outside it.
  await verifyRuntime(installed);
  await writeFile(join(bin,'aside'), '#!/bin/sh\nexit 3\n', {mode:0o700});
  const failedDestination = join(temporary,'installed-without-aside');
  const failed = spawnSync(process.execPath,[join(output,'install.mjs'),failedDestination,'--with-aside','--garden',garden],{env:{PATH:bin},encoding:'utf8',timeout:120000});
  assert.equal(failed.error, undefined, 'Aside refusal must complete before the installation timeout');
  assert.notEqual(failed.status,0);
  assert.match(failed.stderr,/Aside setup is incomplete/);
  await verifyRuntime(failedDestination);
  await rm(output,{recursive:true});
  // The source archive is gone; the installed connection still has its own helper.
  assert.equal(spawnSync(process.execPath,[join(installed,'tools/install/aside.mjs'),'--help'],{env:{},encoding:'utf8',timeout:10000}).status,0);

  // Exercise the installed MCP evaluator and CLI against a genuinely unavailable image.
  const repo = join(temporary, 'project'), scenario = join(temporary, 'scenario.json');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo]);
  await writeFile(join(repo, 'README.txt'), 'Installer protocol probe, not career evidence.\n');
  execFileSync('git', ['add', 'README.txt'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=Installer protocol probe', '-c', 'user.email=installer@foliage.invalid',
    '-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '-qm', 'Create installer protocol probe'], { cwd: repo });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  await writeFile(scenario, JSON.stringify({ version: 1, id: 'installed-runtime-probe',
    steps: [{ stage: 'execute', argv: ['node', '--version'], timeoutMs: 1000 }],
    browser: { argv: ['node', '--version'], port: 4321, path: '/', readyTimeoutMs: 100, durationSeconds: 2 } }));
  const leafPath = join(garden, 'leaf.json'), harvestPath = join(garden, 'harvest.json');
  const leaf = JSON.stringify({ id: 'installer-protocol', subject: 'Installer protocol probe', leaflets: [] });
  await writeFile(leafPath, leaf);
  const transport = new StdioClientTransport({ command: process.execPath, cwd: installed, stderr: 'pipe',
    args: [join(installed, 'foliage.mjs'), 'mcp', '--garden', garden, '--allow-project-test',
      '--test-repo', repo, '--test-commit', commit, '--test-scenario', scenario, '--test-image', `sha256:${'0'.repeat(64)}`] });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += String(chunk); });
  const client = new Client({ name: 'installed-evaluator-probe', version: '1.0.0' });
  try {
    await client.connect(transport).catch(error => { throw new Error(`${String(error)} ${stderr}`); });
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'foliage_test_selected_project'));
    const outcome = await client.callTool({ name: 'foliage_test_selected_project', arguments: {} });
    assert.equal(outcome.isError, undefined, JSON.stringify(outcome.structuredContent));
    const result = outcome.structuredContent;
    assert.equal(result.evaluationStatus, 'error');
    assert.equal(result.approved, false);
    assert.equal(result.published, false);
    const receiptPath = join(garden, 'evaluations', result.receiptId, 'receipt.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.match(receipt.evidence.evaluator.implementationDigest, /^sha256:[a-f0-9]{64}$/,
      'every evaluator and capture module must be available after relocation');
    assert.ok(['docker-unavailable', 'docker-context-unavailable', 'local-docker-required', 'image-unavailable'].includes(receipt.evidence.reason),
      `the unavailable image/runtime must be reported, not a broken import: ${receipt.evidence.reason}`);
    assert.equal(receipt.evidence.browser.status, 'not-run');
    const harvest = JSON.parse(await readFile(harvestPath, 'utf8'));
    assert.equal(harvest.candidates.length, 1);
    assert.equal(harvest.candidates[0].review.state, 'candidate');
    assert.match(harvest.candidates[0].evidence[0].excerpt, /Declared outcome: error/);
    assert.equal(await readFile(leafPath, 'utf8'), leaf);
    const recovered = spawnSync(process.execPath, [join(installed, 'tools/eval/cli.mjs'), 'import',
      '--input', receiptPath, '--into', leafPath], { cwd: installed, env: {}, encoding: 'utf8', timeout: 10_000 });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(JSON.stringify(JSON.parse(recovered.stdout).batch), /Declared outcome: error/);
  } finally { await client.close(); }
});

/** A SYNTHETIC record for the installed brain: invented, about nobody, labelled so. */
const SYNTHETIC_LEAF = Object.freeze({
  id: 'synthetic-installed-brain', subject: 'Synthetic installed-brain fixture', headline: 'Synthetic headline for the installed brain',
  profile: { bio: 'Synthetic biography for the installed brain test.' },
  leaflets: [
    { id: 'quillwort-notes', title: 'Synthetic Quillwort notes', tier: 'verified', provenance: OWN, body: [{ provenance: OWN, text: 'Synthetic text about offline search.' }] },
    { id: 'excluded-one', title: 'Synthetic excluded leaflet', tier: 'excluded', reason: 'Synthetic: not the subject\'s work.', body: [{ provenance: OWN, text: 'EXCLUDED-BODY-MARKER' }] },
  ],
  achievements: [{ id: 'a1', title: 'Synthetic achievement with no claims', claims: [] }],
});

/** @param {string} archive @param {string} into */
function extract(archive, into) {
  const ran = spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', into], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  assert.equal(ran.status, 0, ran.stderr);
}

/** One byte of the file changed in place; returns the bytes it had. @param {string} path */
async function changeOneByte(path) {
  const pristine = await readFile(path);
  const changed = Buffer.from(pristine);
  changed[changed.length - 2] = (changed[changed.length - 2] ?? 0) ^ 1;
  await writeFile(path, changed);
  return pristine;
}

/** No unfinished swap left in an install. @param {string} install */
async function noLeftovers(install) {
  for (const name of ['vendor.next', 'vendor.old']) await assert.rejects(lstat(join(install, name)), { code: 'ENOENT' }, `${name} was left in the install`);
}

/**
 * The gate's sandbox around some steps (`offlineSession`): all outbound network, writes under the
 * owner's ~/.gbrain and ~/brain, and any program but node, the shell and the named bun denied with
 * SIGKILL. `steps` gets the session; its controls must be seen and its report clean.
 * @param {import('node:test').TestContext} t @param {string} bun
 * @param {(session: Awaited<ReturnType<typeof offlineSession>>) => Promise<void>} steps
 */
async function sandboxed(t, bun, steps) {
  const session = await offlineSession({bun});
  try {
    await steps(session);
  } catch (error) {
    // What the observer saw is the useful part of a step the sandbox killed.
    const seen = await session.close().catch(() => null);
    if (seen === null || !(error instanceof Error)) throw error;
    throw new Error(`${error.message}\n${seen.lines.join('\n')}`, {cause:error});
  }
  const report = await session.close();
  t.diagnostic(report.lines.join('\n'));
  assert.equal(report.cause, null, report.lines.join('\n'));
  assert.ok(report.lines.some(line => line.includes('control: a name lookup inside the sandbox was seen and killed')), report.lines.join('\n'));
}

/**
 * A SYNTHETIC garden in `session.dir`, and `foliage brain …` of the install at `install` on it, with a
 * HOME of its own there and nothing else in the environment.
 * @param {Awaited<ReturnType<typeof offlineSession>>} session @param {string} install
 */
async function brainSteps(session, install) {
  const garden = join(session.dir, 'garden'), home = join(session.dir, 'home');
  await mkdir(garden);
  await mkdir(home);
  await writeFile(join(garden, 'leaf.json'), `${JSON.stringify(SYNTHETIC_LEAF, null, 2)}\n`);
  const env = {HOME:home, PATH:'/usr/bin:/bin', TMPDIR:session.dir};
  /** @param {string} step @param {string[]} args */
  const foliage = (step, args) => session.run(step, process.execPath, [join(install, 'foliage.mjs'), 'brain', ...args, '--garden', garden], {env});
  return { home, foliage };
}

/** One search through the installed brain: answered by the brain, the excluded body nowhere. @param {(step: string, args: string[]) => Promise<{stdout: string}>} foliage @param {string} step */
async function searchesThroughTheBrain(foliage, step) {
  const found = JSON.parse((await foliage(step, ['search', 'Quillwort', '--limit', '5'])).stdout);
  assert.equal(found.retrieval, 'brain keyword', found.because);
  assert.deepEqual(found.hits.map((/** @type {{id:string}} */ hit) => hit.id), ['leaflet:quillwort-notes']);
  assert.doesNotMatch(JSON.stringify(found), /EXCLUDED-BODY-MARKER/);
}

test('the one download is named for its version, platform and commit, and is refused at GitHub\'s 100 MiB limit and warned about from 50 MiB', () => {
  assert.equal(downloadName('0.3.0', 'darwin', 'arm64', '285efb23e031a11d8d5d03a33c5237726c68e29b'), 'foliage-0.3.0-darwin-arm64-285efb2.tgz');
  // Uncommitted changes went in: the commit alone would not say what it holds.
  assert.equal(downloadName('0.3.0', 'darwin', 'arm64', '285efb23e031a11d8d5d03a33c5237726c68e29b', true), 'foliage-0.3.0-darwin-arm64-285efb2-dirty.tgz');
  const MiB = 1024 * 1024;
  assert.deepEqual(DOWNLOAD_LIMITS, { refuse: 100 * MiB, warn: 50 * MiB });
  assert.deepEqual(downloadSize('a.tgz', 50 * MiB - 1), {});
  assert.deepEqual(downloadSize('a.tgz', 50 * MiB), { warn: 'a.tgz is 50.0 MiB (52428800 bytes), at or over 50 MiB. GitHub warns about a file over 50 MiB and blocks one over 100 MiB.' });
  assert.deepEqual(downloadSize('a.tgz', 100 * MiB - 1), { warn: 'a.tgz is 100.0 MiB (104857599 bytes), at or over 50 MiB. GitHub warns about a file over 50 MiB and blocks one over 100 MiB.' });
  assert.deepEqual(downloadSize('a.tgz', 100 * MiB), { refuse: "a.tgz is 100.0 MiB (104857600 bytes), at or over GitHub's 100 MiB limit, so it could not be published there. Nothing was kept." });
});

test('the one download (owner decision 2026-10-15): on a clean machine with only Node it installs Foliage with its local brain by default, and that installed brain builds and searches offline; --no-brain leaves it out and --add-brain adds it later; a brain that fails its checks stops the install; one changed byte is refused', {timeout:1200000}, async t => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'foliage-brain-release-')));
  t.after(() => rm(temporary, {recursive:true,force:true}));
  if (!brainArchiveShips(process.platform, process.arch)) {
    // No brain ships for this platform: only macOS arm64 has passed the offline test. The packager
    // says so by name and writes nothing. This is the rule here, not a skip.
    await assert.rejects(packageBrain(join(temporary, 'brain'), {includeWorkingTree:true}), /No brain archive ships for/);
    await assert.rejects(lstat(join(temporary, 'brain')), {code:'ENOENT'});
    return;
  }

  // The build machine: the one download from this checkout and its staged vendor/ (a missing vendor/
  // fails here, naming node tools/brain/stage-gbrain.mjs), and the brain-only archive, which is not
  // published and is kept for adding the brain to an existing install.
  const build = join(temporary, 'build');
  await mkdir(build);
  const download = await packageDownload(join(build, 'download'), {includeWorkingTree:true});
  const name = basename(download.archive);
  assert.equal(name, `foliage-${download.version}-darwin-arm64-${download.revision.slice(0, 7)}${download.workingTree ? '-dirty' : ''}.tgz`);
  assert.equal(download.brain, true);
  // Its size against GitHub's limits: under 100 MiB, or it would have been refused; a warning from 50 MiB.
  assert.ok(download.bytes < DOWNLOAD_LIMITS.refuse, `${name} is ${download.bytes} bytes`);
  assert.equal(download.warning !== undefined, download.bytes >= DOWNLOAD_LIMITS.warn, download.warning ?? 'no warning');
  t.diagnostic(`the one download: ${name}, ${(download.bytes / 1048576).toFixed(1)} MiB (${download.bytes} bytes), ${download.entries} entries${download.warning === undefined ? '' : `; warning: ${download.warning}`}`);
  const brain = await packageBrain(join(build, 'brain'), {includeWorkingTree:true});
  assert.match(basename(brain.archive), /^foliage-brain-\d+\.\d+\.\d+-darwin-arm64\.tgz$/);

  // One archive, two top-level folders: runtime/ and vendor/, each with its own release.json, packed
  // as every release is, with no builder's name and nothing writable by others.
  const entries = await tarEntries(download.archive);
  assert.deepEqual([...new Set(entries.map(entry => entry.name.split('/')[0]))], ['runtime', 'vendor']);
  for (const archive of [download.archive, brain.archive]) assert.deepEqual(releaseMetadataProblems(await tarEntries(archive)), [], basename(archive));
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  assert.deepEqual(['runtime/', 'vendor/', 'vendor/bun/'].map(path => (byName.get(path)?.mode ?? 0).toString(8)), ['755', '755', '755']);
  for (const path of ['runtime/install.mjs', 'runtime/release.json', 'runtime/START-HERE.md', 'runtime/THIRD-PARTY-NOTICES',
    'vendor/release.json', 'vendor/brain.json', 'vendor/bun/bun', 'vendor/gbrain/LICENSE', 'vendor/START-HERE.md', 'vendor/THIRD-PARTY-NOTICES']) assert.ok(byName.has(path), `${path} is in the download`);
  assert.ok(![...byName.keys()].some(path => /^vendor\/gbrain\/(?:\.env\.testing\.example|\.github\/|\.gitignore|\.gitattributes|\.gitleaks\.toml)/.test(path)), "upstream's development files are not shipped");
  // The brain-only archive holds the same unit, file for file.
  const vendorNames = (/** @type {{name: string}[]} */ list) => list.map(entry => entry.name).filter(path => path.startsWith('vendor/')).sort();
  assert.deepEqual(vendorNames(await tarEntries(brain.archive)), vendorNames(entries));

  // A clean machine: a fresh HOME, a PATH with no bun and no gbrain on it, Node run by its absolute
  // path, and the downloads. The build machine's copies are gone before anything installs. These
  // copies carry no quarantine flag, which a browser download would: unmeasured, see context/apps/leaf.md.
  const machine = join(temporary, 'machine'), home = join(machine, 'home'), downloads = join(machine, 'downloads');
  await mkdir(home, {recursive:true});
  await mkdir(downloads);
  const env = {HOME:home, PATH:'/usr/bin:/bin'};
  for (const tool of ['bun', 'gbrain']) assert.notEqual(spawnSync('/usr/bin/which', [tool], {env}).status, 0, `${tool} is on the clean machine's PATH`);
  const downloadFile = join(downloads, name), brainFile = join(downloads, basename(brain.archive));
  await copyFile(download.archive, downloadFile);
  await copyFile(brain.archive, brainFile);
  await rm(build, {recursive:true, force:true});
  /** The download extracted as a person extracts it, into runtime/ and vendor/; the brain-only archive into brain-only/vendor/. */
  const fresh = async () => {
    for (const folder of ['runtime', 'vendor', 'brain-only']) await rm(join(downloads, folder), {recursive:true, force:true});
    extract(downloadFile, downloads);
    await mkdir(join(downloads, 'brain-only'));
    extract(brainFile, join(downloads, 'brain-only'));
  };
  await fresh();
  assert.equal(await readFile(join(downloads, 'vendor', 'release.json'), 'utf8'), await readFile(join(downloads, 'brain-only', 'vendor', 'release.json'), 'utf8'),
    'the brain in the download and the brain-only archive record the same files and pins');
  // Each folder's START-HERE, as extracted: the runtime's says the brain is included; the brain's, how to add it to an install made without it.
  assert.match(await readFile(join(downloads, 'runtime', 'START-HERE.md'), 'utf8'), /## Local brain \(included\)\n\nThe download includes the local brain/);
  assert.match(await readFile(join(downloads, 'vendor', 'START-HERE.md'), 'utf8'), /It comes with Foliage\.[\s\S]*--add-brain \/absolute\/path\/to\/this\/vendor/);
  const installed = join(machine, 'foliage'), later = join(machine, 'foliage-later'), emptyGarden = join(machine, 'garden-later');
  await mkdir(emptyGarden);

  // Every installer run, inside the sandbox with no bun allowed at all: nothing here may reach out or
  // start anything but node.
  await sandboxed(t, join(downloads, 'vendor', 'bun', 'bun'), async session => {
    /** @param {string} step @param {string[]} args @param {number} [code] */
    const node = (step, args, code = 0) => session.run(step, process.execPath, args, {cwd:machine, env, expect:{code}, allow:{gbrain:false}});
    /** Starts no gbrain: a garden with no brain/ is answered before any process. @param {string} step @param {number} [code] */
    const status = (step, code = 0) => node(step, [join(later, 'foliage.mjs'), 'brain', 'status', '--garden', emptyGarden], code);
    const installer = join(downloads, 'runtime', 'install.mjs');

    // 1. The default: install.mjs from the download's runtime folder, with no brain flag, installs the
    // brain beside it through the --with-brain checks, and says so in one line.
    const install = await node('install, the brain beside runtime/ included by default', [installer, installed]);
    assert.match(install.stdout, /^The local brain that came with this download was included\. It runs on this computer only; install with --no-brain to leave it out\.\nInstalled Foliage \S+ with its local brain at /);

    // 2. --no-brain: an install without it, which verifies without it and says how to add it. Then
    // --add-brain from the same download, and --replace-brain from the brain-only archive.
    const plain = await node('install with --no-brain', [installer, later, '--no-brain']);
    assert.doesNotMatch(plain.stdout, /local brain/);
    await assert.rejects(lstat(join(later, 'vendor')), {code:'ENOENT'});
    await verifyRuntime(later);
    const missing = await status('status with no brain installed');
    assert.equal(missing.stdout, 'Brain: not installed\n');
    assert.ok(missing.stderr.includes(`--add-brain /absolute/path/to/the/extracted/vendor ${JSON.stringify(later)}`), missing.stderr);
    assert.doesNotMatch(missing.stderr, /stage-gbrain/);
    const added = await node('--add-brain from the download', [join(later, 'install.mjs'), '--add-brain', join(downloads, 'vendor'), later]);
    assert.match(added.stdout, /^Added the brain to Foliage /);
    await verifyRuntime(later);
    await noLeftovers(later);
    assert.equal((await status('status once the brain is added')).stdout, 'Brain: off\n');
    assert.match((await node('--add-brain again, refused', [join(later, 'install.mjs'), '--add-brain', join(downloads, 'vendor'), later], 1)).stderr, /already has a brain/);
    const replaced = await node('--replace-brain from the brain-only archive', [join(later, 'install.mjs'), '--replace-brain', join(downloads, 'brain-only', 'vendor'), later]);
    assert.match(replaced.stdout, /^Replaced the brain of Foliage /);
    await verifyRuntime(later);
    await noLeftovers(later);

    // 3. One changed byte in the download's brain: the default install stops, saying where that brain
    // came from, and nothing is made; a swap from it is refused too.
    const cli = join(downloads, 'vendor', 'gbrain', 'src', 'cli.ts');
    const pristine = await changeOneByte(cli);
    const refusedAt = join(machine, 'foliage-refused');
    const refusedNew = await node('a changed byte beside runtime/, the default install refused', [installer, refusedAt], 1);
    assert.match(refusedNew.stderr, /^The local brain that came with this download, at \S+\/vendor, was refused: Release integrity check failed: gbrain\/src\/cli\.ts\. Download Foliage again from getfoliage\.com\/start and extract it into an empty folder, or add --no-brain to install Foliage without it\.\n$/);
    await assert.rejects(lstat(refusedAt), {code:'ENOENT'});
    const refusedSwap = await node('a changed byte, swap refused', [join(later, 'install.mjs'), '--replace-brain', join(downloads, 'vendor'), later], 1);
    assert.match(refusedSwap.stderr, /integrity check failed: gbrain\/src\/cli\.ts/);
    await verifyRuntime(later);
    await noLeftovers(later);
    await writeFile(cli, pristine);
    // A brain released with another Foliage, beside runtime/, is refused by name and stops the install.
    const releasePath = join(downloads, 'vendor', 'release.json');
    const release = await readFile(releasePath, 'utf8');
    await writeFile(releasePath, JSON.stringify({...JSON.parse(release), foliageVersion:'9.9.9'}));
    const otherVersion = await node('another version beside runtime/, the default install refused', [installer, refusedAt], 1);
    assert.match(otherVersion.stderr, /belongs to Foliage 9\.9\.9, and this Foliage is /);
    // No brain archive is published on its own, so the refusal never sends anyone for one.
    assert.doesNotMatch(otherVersion.stderr, /brain archive released|Obtain the brain archive/);
    await assert.rejects(lstat(refusedAt), {code:'ENOENT'});
    await writeFile(releasePath, release);
  });

  // Both installs stand alone once the downloads are gone.
  for (const folder of ['runtime', 'vendor', 'brain-only']) await rm(join(downloads, folder), {recursive:true});
  const manifest = await verifyRuntime(installed);
  assert.ok(!manifest.files.some(file => file.path.startsWith('vendor/')), 'the main release lists no vendor/ file');
  const notices = await readFile(join(installed, 'vendor', 'THIRD-PARTY-NOTICES'), 'utf8');
  const gbrainLicense = await readFile(join(installed, 'vendor', 'gbrain', 'LICENSE'), 'utf8');
  assert.match(gbrainLicense, /^MIT License\n\nCopyright \(c\) 2026 Garry Tan\n/);
  assert.ok(notices.includes(gbrainLicense.trimEnd()), "gbrain's MIT notice is in THIRD-PARTY-NOTICES verbatim");
  assert.ok(notices.includes((await readFile(new URL('../brain/bun-LICENSE.md', import.meta.url), 'utf8')).trimEnd()), "bun's licence text is in THIRD-PARTY-NOTICES verbatim");
  assert.match(notices, /libheif-js@[\d.]+ is LGPL-3\.0, required by heic-decode\./);
  assert.match(notices, /bun statically links JavaScriptCore and WebKit, which are LGPL-2/);
  // The room the installer asks for covers what the copy took on disk.
  const unit = await verifyBrainUnit(join(installed, 'vendor'), manifest.version);
  const du = spawnSync('/usr/bin/du', ['-sk', join(installed, 'vendor')], {encoding:'utf8', env:{PATH:'/usr/bin:/bin'}});
  const used = Number(du.stdout.split(/\s/)[0]) * 1024;
  assert.ok(used > 0 && unit.bytes >= used, `the room asked for (${unit.bytes} bytes) is less than the copy took (${used} bytes)`);
  t.diagnostic(`installed vendor/: ${Math.round(used / 1048576)} MB on disk (du), room asked for it: ${Math.round(unit.bytes / 1048576)} MB, brain-only archive ${Math.round(brain.bytes / 1048576)} MB`);

  // 4. The default install builds, checks and searches a brain, offline, starting only its own bun.
  await sandboxed(t, join(installed, 'vendor', 'bun', 'bun'), async session => {
    const { home: stepHome, foliage } = await brainSteps(session, installed);
    assert.equal((await foliage('default install: status before a build', ['status'])).stdout, 'Brain: off\n');
    assert.equal((await foliage('default install: build', ['build'])).stdout, 'Brain: current\n');
    assert.equal((await foliage('default install: status, the whole installed tree and every setting checked', ['status'])).stdout, 'Brain: current\n');
    await searchesThroughTheBrain(foliage, 'default install: search');
    assert.deepEqual(await readdir(stepHome), [], 'nothing was written under HOME, so no ~/.gbrain was made');
  });

  // 5. The brain added to the --no-brain install builds and searches the same way; then one changed
  // byte in it is named, and the installer's fix puts it right.
  await sandboxed(t, join(later, 'vendor', 'bun', 'bun'), async session => {
    const { home: stepHome, foliage } = await brainSteps(session, later);
    assert.equal((await foliage('added brain: build', ['build'])).stdout, 'Brain: current\n');
    await searchesThroughTheBrain(foliage, 'added brain: search');
    assert.deepEqual(await readdir(stepHome), [], 'nothing was written under HOME, so no ~/.gbrain was made');

    /** @param {string} step @param {string[]} args @param {number} [code] */
    const node = (step, args, code = 0) => session.run(step, process.execPath, args, {cwd:machine, env, expect:{code}, allow:{gbrain:false}});
    /** @param {string} step @param {number} [code] */
    const status = (step, code = 0) => node(step, [join(later, 'foliage.mjs'), 'brain', 'status', '--garden', emptyGarden], code);
    await changeOneByte(join(later, 'vendor', 'gbrain', 'src', 'cli.ts'));
    await assert.rejects(verifyRuntime(later), /integrity check failed: gbrain\/src\/cli\.ts/);
    const broken = await status('status with a changed byte in the installed brain', 1);
    // The installer's fix as the whole command, runnable as printed: node and this copy's install.mjs by absolute path.
    const word = (/** @type {string} */ text) => `'${text.replaceAll("'", "'\\''")}'`;
    assert.equal(broken.stdout, `Brain: broken: vendor/gbrain/src/cli.ts differs from what was staged. Run ${word(process.execPath)} ${word(join(later, 'install.mjs'))} '--replace-brain' <the vendor folder from the Foliage download> ${word(later)}\n`);
    await fresh();
    await node('--replace-brain puts it right', [join(later, 'install.mjs'), '--replace-brain', join(downloads, 'vendor'), later]);
    await verifyRuntime(later);
    await noLeftovers(later);
    assert.equal((await status('status once it is put right')).stdout, 'Brain: off\n');
  });
  assert.deepEqual(await readdir(home), [], "nothing was written under the clean machine's HOME");
});
