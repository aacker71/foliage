/** Bundle only the optional browser renderer; the server runs TypeScript directly. */
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compoundInputDigest, stampCompoundBundle } from './src/compoundBundle.ts';
const appRoot = fileURLToPath(new URL('.', import.meta.url));
const declared = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const installed = JSON.parse(await readFile(new URL('../package.json', import.meta.resolve('three')), 'utf8'));
if (declared.dependencies.three !== installed.version) {
  throw new Error(`Three.js ${installed.version} is installed, but ${declared.dependencies.three} is pinned. Run pnpm install before explore:build.`);
}
const sourceDigest = await compoundInputDigest(appRoot);
const notice = await readFile(new URL('../LICENSE', import.meta.resolve('three')), 'utf8');
const result = spawnSync('bun', [
  'build', 'public/compound-leaf.mjs', '--outfile', 'public/compound-leaf.bundle.js',
  '--target=browser', '--minify', '--banner', `/*! Bundled Three.js dependency notice\n${notice}\n*/`,
], { cwd: appRoot, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (process.exitCode === 0) await stampCompoundBundle(sourceDigest, appRoot);
