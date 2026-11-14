/** Only the optional browser enhancement is bundled. Product servers still execute TypeScript directly. */
import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { portfolioLeafInputDigest, recordPortfolioLeafBuild } from './src/portfolio-leaf-bundle.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const declaration = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const installed = JSON.parse(await readFile(new URL('../package.json', import.meta.resolve('three')), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(declaration.dependencies.three) || declaration.dependencies.three !== installed.version) {
  throw new Error('Install the exact Three.js version declared by @foliage/ui before building the portfolio renderer.');
}
await mkdir(new URL('./build/', import.meta.url), { recursive: true });
const fingerprint = await portfolioLeafInputDigest(root);
const license = await readFile(new URL('../LICENSE', import.meta.resolve('three')), 'utf8');
const result = spawnSync('bun', ['build', 'src/portfolio-leaf.mjs', '--outfile', 'build/portfolio-leaf.bundle.js',
  '--target=browser', '--minify', '--banner', `/*! Three.js dependency license\n${license}\n*/`], { cwd: root, stdio: 'inherit' });
if (result.error || result.status !== 0) throw result.error ?? new Error(`Portfolio browser build exited with ${result.status}.`);
await recordPortfolioLeafBuild(fingerprint, root);
