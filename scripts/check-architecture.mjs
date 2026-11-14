/** Structural documentation coverage; this does not certify implementation or prose accuracy. */
import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const errors = [];
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const context = resolve(root, 'context');
const names = ['project-overview', 'architecture', 'code-standards', 'ai-workflow-rules', 'ui-context', 'progress-tracker'];
const boundaries = JSON.parse(await readFile(resolve(root, 'public-boundary.json'), 'utf8')).planes;
const index = await readFile(resolve(context, 'architecture.md'), 'utf8');
let applications = 0;
for (const entry of await readdir(resolve(root, 'apps'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = resolve(root, 'apps', entry.name, 'package.json');
  if (!await exists(manifest)) continue;
  applications++;
  const { name } = JSON.parse(await readFile(manifest, 'utf8'));
  const path = resolve(context, 'apps', `${entry.name}.md`);
  if (!await exists(path)) { errors.push(`${name}: missing context/apps/${entry.name}.md`); continue; }
  const text = await readFile(path, 'utf8');
  if (!index.includes(`(apps/${entry.name}.md)`)) errors.push(`${name}: not linked in architecture inventory`);
  if (!text.includes(`\`${name}\``)) errors.push(`${entry.name}: architecture does not identify package ${name}`);
  const planes = Object.entries(boundaries).filter(([, packages]) => packages.includes(name)).map(([plane]) => plane);
  if (planes.length !== 1 || !text.includes(`Plane: \`${planes[0]}\``)) errors.push(`${name}: architecture plane differs from boundary manifest`);
  for (const section of ['Status', 'Responsibility', 'Runtime and interfaces', 'Storage and dependencies', 'Access and invariants', 'Data flow and boundaries', 'Source and verification']) {
    if (!text.includes(`## ${section}`)) errors.push(`${name}: missing ${section}`);
  }
}
async function markdownFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) result.push(path);
  }
  return result;
}
const files = await markdownFiles(context);
for (const name of names) {
  const path = resolve(context, `${name}.md`);
  if (!files.includes(path)) errors.push(`Missing required context/${name}.md`);
  else if (!(await readFile(path, 'utf8')).trim()) errors.push(`Empty required context/${name}.md`);
}
for (const path of files) {
  if (!await exists(path)) { errors.push(`Missing ${path}`); continue; }
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!await exists(resolve(dirname(path), target))) errors.push(`${path}: broken link ${target}`);
  }
}

// Planned surfaces are documented without inventing app manifests or licensing declarations.
const appDocs = (await readdir(resolve(context, 'apps'))).filter(name => name.endsWith('.md'));
for (const name of appDocs) {
  if (!index.includes(`(apps/${name})`)) errors.push(`context/apps/${name}: missing architecture inventory link`);
}

const specRoot = resolve(context, 'specs');
const plan = await readFile(resolve(specRoot, '00-build-plan.md'), 'utf8');
const buildPlan = await readFile(resolve(root, 'docs/PORTFOLIO-SCALE-BUILD-PLAN.md'), 'utf8');
const matrix = await readFile(resolve(root, 'docs/PORTFOLIO-SCALE-ACCEPTANCE.md'), 'utf8');
const requiredBuilds = new Set([...buildPlan.matchAll(/^\| (B\d{2}) \|/gm)].map(match => match[1]));
const requiredAcceptance = new Set([...matrix.matchAll(/^\| ([A-Z]{2}\d{2}) —/gm)].map(match => match[1]));
if (!requiredBuilds.size || !requiredAcceptance.size) errors.push('Build/acceptance tables have no recognized requirements');

let units = [];
try {
  const parsed = JSON.parse(await readFile(resolve(specRoot, 'units.json'), 'utf8'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('expected a nonempty array');
  units = parsed;
} catch (error) { errors.push(`units.json: ${error.message}`); }

const byId = new Map();
const filenames = new Set();
const coveredBuilds = new Set();
const coveredAcceptance = new Set();
const sections = ['Goal', 'Design', 'Implementation', 'Dependencies', 'Verify when done'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const [position, unit] of units.entries()) {
  if (!unit || typeof unit !== 'object' ||
      typeof unit.id !== 'string' || !/^(?!00)\d{2}$/.test(unit.id) ||
      typeof unit.file !== 'string' || !/^\d{2}-[a-z0-9-]+\.md$/.test(unit.file) ||
      !unit.file.startsWith(`${unit.id}-`) ||
      typeof unit.title !== 'string' || !unit.title.trim() ||
      typeof unit.application !== 'string' || !/^[a-z][a-z0-9-]*$/.test(unit.application) ||
      typeof unit.build !== 'string' || !/^B\d{2}$/.test(unit.build) ||
      !Array.isArray(unit.dependsOn) || !unit.dependsOn.every(id => typeof id === 'string' && /^\d{2}$/.test(id)) ||
      !Array.isArray(unit.acceptance) || !unit.acceptance.length ||
      !unit.acceptance.every(id => typeof id === 'string' && /^[A-Z]{2}\d{2}$/.test(id))) {
    errors.push(`units.json entry ${position + 1}: invalid unit schema`);
    continue;
  }
  if (byId.has(unit.id)) errors.push(`Duplicate unit ${unit.id}`);
  if (filenames.has(unit.file)) errors.push(`Duplicate spec file ${unit.file}`);
  if (new Set(unit.dependsOn).size !== unit.dependsOn.length) errors.push(`Unit ${unit.id}: duplicate dependency`);
  if (new Set(unit.acceptance).size !== unit.acceptance.length) errors.push(`Unit ${unit.id}: duplicate acceptance row`);
  byId.set(unit.id, { ...unit, position });
  filenames.add(unit.file);
  coveredBuilds.add(unit.build);
  if (!requiredBuilds.has(unit.build)) errors.push(`Unit ${unit.id}: unknown build package ${unit.build}`);
  if (!appDocs.includes(`${unit.application}.md`)) errors.push(`Unit ${unit.id}: unknown application ${unit.application}`);
  for (const id of unit.acceptance) {
    if (!requiredAcceptance.has(id)) errors.push(`Unit ${unit.id}: unknown acceptance row ${id}`);
    // OP07 is the release decision itself; every other row also needs an implementation owner.
    if (unit.build !== 'B13' || id === 'OP07') coveredAcceptance.add(id);
  }
  if (unit.build === 'B13') {
    for (const id of requiredAcceptance) {
      if (!unit.acceptance.includes(id)) errors.push(`Release unit ${unit.id}: missing acceptance row ${id}`);
    }
  }
  const expectedRow = `| [${unit.id}](${unit.file}) | ${unit.title} | ${unit.build} | ${unit.dependsOn.join(', ') || '—'} |`;
  if (!plan.split('\n').includes(expectedRow)) errors.push(`Unit ${unit.id}: plan row differs from unit index`);
  const path = resolve(specRoot, unit.file);
  if (!await exists(path)) { errors.push(`Missing specification ${unit.file}`); continue; }
  const text = await readFile(path, 'utf8');
  if (!text.startsWith(`# Unit ${unit.id}: ${unit.title}\n`)) errors.push(`${unit.file}: title differs from unit index`);
  if (!text.includes(`Build package: \`${unit.build}\` · Owner: [${unit.application}](../apps/${unit.application}.md)`)) {
    errors.push(`${unit.file}: build/application differs from unit index`);
  }
  if (!text.split('\n').includes(`Acceptance: ${unit.acceptance.join(', ')}`)) errors.push(`${unit.file}: acceptance differs from unit index`);
  for (const section of sections) {
    const parts = text.split(`\n## ${section}\n`);
    if (parts.length !== 2 || !parts[1].split('\n## ')[0].trim()) errors.push(`${unit.file}: missing, empty or duplicate ${section}`);
  }
  const dependencyBody = text.split('\n## Dependencies\n')[1]?.split('\n## ')[0] ?? '';
  const linkedDependencies = [...dependencyBody.matchAll(/\[(\d{2})\]\(\.\/(\d{2}-[a-z0-9-]+\.md)\)/g)];
  if (!same(linkedDependencies.map(match => match[1]), unit.dependsOn)) errors.push(`${unit.file}: dependency links differ from unit index`);
  for (const match of linkedDependencies) {
    const target = units.find(candidate => candidate?.id === match[1]);
    if (target?.file !== match[2]) errors.push(`${unit.file}: dependency ${match[1]} links to wrong specification`);
  }
}

for (const unit of byId.values()) {
  for (const dependency of unit.dependsOn) {
    const parent = byId.get(dependency);
    if (!parent) errors.push(`Unit ${unit.id}: unknown dependency ${dependency}`);
    // Strict predecessor order also rules out every cycle, including self-dependencies.
    else if (parent.position >= unit.position || Number(parent.id) >= Number(unit.id)) {
      errors.push(`Unit ${unit.id}: dependency ${dependency} is cyclic or out of order`);
    }
  }
  if (unit.build === 'B13') {
    for (const other of byId.keys()) {
      if (other !== unit.id && !unit.dependsOn.includes(other)) errors.push(`Release unit ${unit.id}: missing prerequisite ${other}`);
    }
  }
}
for (const file of await readdir(specRoot)) {
  if (/^\d{2}-.*\.md$/.test(file) && file !== '00-build-plan.md' && !filenames.has(file)) errors.push(`Unindexed specification ${file}`);
}
for (const build of requiredBuilds) if (!coveredBuilds.has(build)) errors.push(`Build package ${build} has no specification`);
for (const id of requiredAcceptance) if (!coveredAcceptance.has(id)) errors.push(`Acceptance row ${id} has no implementation owner`);

if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Architecture coverage: ${applications} application packages; ${appDocs.length} application/surface architectures; ${files.length} context documents; ${units.length} units; ${requiredAcceptance.size} acceptance rows; dependencies and local file links valid.`);
