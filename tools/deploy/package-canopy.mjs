#!/usr/bin/env node
/** Preserve source paths and workspace exports in an isolated Node runtime artifact.
 * No transpilation, node_modules cache, local evidence or install scripts cross this seam.
 */
import { execFileSync } from "node:child_process";
import { copyFile, cp, lstat, mkdir, readFile, readlink, realpath, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkPortfolioLeafBundle } from "../../packages/ui/src/portfolio-leaf-bundle.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RUNTIME_FILE = /\.(?:mjs|jsx?|tsx?|css|svg|woff2|html)$/;
const PORTFOLIO_BUILD_ASSETS = ["packages/ui/build/portfolio-leaf.bundle.js", "packages/ui/build/portfolio-leaf.receipt.json"];

/** @param {string} name @param {string} owner */
async function installedPackage(name, owner) {
  const require = createRequire(join(owner, "package.json"));
  // A declared npm package can share a built-in name (e.g. string_decoder).
  // Ask for package lookup paths, not the built-in's null resolution paths.
  for (const modules of require.resolve.paths(`${name}/package.json`) ?? []) {
    const candidate = join(modules, name);
    try {
      return { dir: await realpath(candidate), manifest: JSON.parse(await readFile(join(candidate, "package.json"), "utf8")) };
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */(error).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Missing installed production dependency: ${name} required by ${owner}`);
}

/** @param {string} owner @param {string} name @param {string} target */
async function linkPackage(owner, name, target) {
  const link = join(owner, "node_modules", name);
  await mkdir(dirname(link), { recursive: true });
  await symlink(relative(dirname(link), target), link);
}

/** @param {string} out @param {string} [root]
 * @param {{generatedAssets?:string[],entryPackages?:string[],includeWorkingTree?:boolean}} [options] */
export async function packageCanopy(out, root = ROOT, { generatedAssets = [], entryPackages = ["@foliage/canopy-app"], includeWorkingTree = false } = {}) {
  const tracked = execFileSync("git", ["ls-files", "-z", ...(includeWorkingTree ? ["--cached", "--others", "--exclude-standard"] : []), "--", "apps", "packages"], {
    cwd: root, encoding: "utf8",
  }).split("\0").filter(Boolean);
  const workspaces = new Map();
  for (const path of tracked.filter((path) => /^(apps|packages)\/[^/]+\/package.json$/.test(path))) {
    const manifest = JSON.parse(await readFile(join(root, path), "utf8"));
    workspaces.set(manifest.name, { dir: dirname(path), manifest });
  }
  const selected = new Map();
  const pending = [...entryPackages];
  while (pending.length) {
    const name = pending.pop();
    if (!name) continue;
    if (selected.has(name)) continue;
    const workspace = workspaces.get(name);
    if (!workspace || !/^@foliage\/[a-z0-9-]+$/.test(name)) {
      throw new Error(`Runtime workspace is missing or invalid: ${name}`);
    }
    selected.set(name, workspace);
    for (const [dependency, version] of Object.entries({
      ...workspace.manifest.dependencies, ...workspace.manifest.optionalDependencies,
    })) {
      if (version.startsWith("workspace:")) pending.push(dependency);
    }
  }

  const sourceRoot = await realpath(root);
  if (generatedAssets.some(path => PORTFOLIO_BUILD_ASSETS.includes(path))) {
    if (!selected.has("@foliage/ui") || !PORTFOLIO_BUILD_ASSETS.every(path => generatedAssets.includes(path))) throw new Error("The portfolio renderer and its build receipt must be packaged together.");
    const bundle = await checkPortfolioLeafBundle(join(root, "packages/ui"));
    if (!bundle.ok) throw new Error(`The generated portfolio renderer is not ready: ${bundle.cause}. ${bundle.remedy}`);
  }
  for (const path of generatedAssets) {
    const publicAsset = [...selected.values()].some(({ dir }) => path.startsWith(`${dir}/public/`)) && /\.(css|js)$/.test(path);
    const allowed = publicAsset || PORTFOLIO_BUILD_ASSETS.includes(path);
    if (!allowed || path.split("/").some((part) => part === ".." || part.startsWith(".")) ||
        await realpath(join(root, path)) !== join(sourceRoot, path) || !(await lstat(join(root, path))).isFile()) {
      throw new Error(`Not an approved generated public asset: ${path}`);
    }
  }
  const runtimePaths = [...new Set([...tracked, ...generatedAssets])];

  // A new directory is required: never mix a prior release or local data into this one.
  const target = resolve(out);
  await mkdir(target);
  let files = 0;
  for (const { dir } of selected.values()) {
    for (const path of runtimePaths.filter((path) => path.startsWith(`${dir}/`))) {
      const local = path.slice(dir.length + 1);
      const runtime = generatedAssets.includes(path) || local === "package.json" || (
        (local.startsWith("src/") || local.startsWith("public/") || !local.includes("/")) &&
        (RUNTIME_FILE.test(local) || (local.startsWith("public/") && /\.(png|jpe?g|webp|avif|ico)$/.test(local))) && !/\.(test|spec)\.[^.]+$/.test(local)
      );
      if (!runtime) continue;
      if (path.split("/").some(part => part.startsWith(".")) || await realpath(join(root, path)) !== join(sourceRoot, path) || !(await lstat(join(root, path))).isFile()) throw new Error(`Not a regular runtime file: ${path}`);
      await mkdir(dirname(join(target, path)), { recursive: true });
      await copyFile(join(root, path), join(target, path));
      files++;
    }
  }
  // Photosynthesis search reuses the vault's single BM25 implementation. It lives outside
  // workspace packages so a copied vault remains independently runnable; include that exact
  // module whenever the Photosynthesis package is part of a relocated runtime.
  if (selected.has("@foliage/photosynthesis")) {
    const rankPath = "tools/vault/lib/rank.mjs";
    if (!(await lstat(join(root, rankPath))).isFile() || await realpath(join(root, rankPath)) !== join(sourceRoot, rankPath)) {
      throw new Error(`Not a regular shared ranker file: ${rankPath}`);
    }
    await mkdir(dirname(join(target, rankPath)), { recursive: true });
    await copyFile(join(root, rankPath), join(target, rankPath));
    files++;
  }
  // Relative links stay inside the artifact after relocation. Node resolves their real paths
  // outside node_modules, retaining native .ts execution and direct sibling-app imports.
  const modules = join(target, "node_modules", "@foliage");
  await mkdir(modules, { recursive: true });
  for (const [name, { dir }] of selected) {
    await symlink(relative(modules, join(target, dir)), join(modules, name.slice("@foliage/".length)));
  }

  // Follow installed production edges, including peers, from each actual owner. Keeping
  // distinct real paths preserves pnpm's version/peer contexts instead of flattening them.
  const external = new Map();
  const owners = [...selected.values()].map(({ dir, manifest }) => ({ source: join(root, dir), dest: join(target, dir), manifest }));
  for (const owner of owners) {
    const dependencies = { ...owner.manifest.peerDependencies, ...owner.manifest.dependencies, ...owner.manifest.optionalDependencies };
    for (const [name, version] of Object.entries(dependencies)) {
      if (version.startsWith("workspace:")) continue; // root workspace links already resolve
      let dependency;
      try {
        dependency = await installedPackage(name, owner.source);
      } catch (error) {
        const optional = name in (owner.manifest.optionalDependencies ?? {}) || owner.manifest.peerDependenciesMeta?.[name]?.optional;
        if (optional && error instanceof Error && error.message.startsWith("Missing installed production dependency:")) continue;
        throw error;
      }
      let dest = external.get(dependency.dir);
      if (!dest) {
        dest = join(target, "node_modules", ".runtime", String(external.size));
        external.set(dependency.dir, dest);
        await cp(dependency.dir, dest, {
          recursive: true, verbatimSymlinks: true,
          filter: async (path) => {
            const name = basename(path);
            if (name === "node_modules" || name === ".git" || name === ".npmrc" || name.startsWith(".env")) return false;
            if ((await lstat(path)).isSymbolicLink() &&
                (isAbsolute(await readlink(path)) || relative(dependency.dir, await realpath(path)).startsWith(".."))) {
              throw new Error(`Installed package contains an escaping symlink: ${path}`);
            }
            return true;
          },
        });
        owners.push({ source: dependency.dir, dest, manifest: dependency.manifest });
      }
      await linkPackage(owner.dest, name, dest);
    }
  }
  return { workspaceFiles: files, packages: [...selected.keys()], externalPackages: external.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || !process.argv[2]) throw new Error("Usage: node tools/deploy/package-canopy.mjs <new-output-directory>");
  console.log(JSON.stringify(await packageCanopy(process.argv[2])));
}
