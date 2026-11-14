#!/usr/bin/env node
/** Closed local Canopy companion. Built separately from the public open archive. */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, copyFile, lstat, mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageCanopy } from "./package-canopy.mjs";
import { writeRuntimeManifest } from "./package-local.mjs";
import { checkPortfolioLeafBundle } from "../../packages/ui/src/portfolio-leaf-bundle.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ASSETS = ["apps/canopy/public/workspace.js", "apps/canopy/public/workspace.css",
  "packages/ui/build/portfolio-leaf.bundle.js", "packages/ui/build/portfolio-leaf.receipt.json"];
const COPIES = [
  ["foliage.mjs", "foliage.mjs"],
  ["canopy-companion.mjs", "canopy.mjs"],
  ["canopy-companion-install.mjs", "install.mjs"],
  ["tools/install/runtime-install.mjs", "tools/install/runtime-install.mjs"],
  ["tools/install/requirements.mjs", "tools/install/requirements.mjs"],
];

/** @param {string} output @param {{root?:string,includeWorkingTree?:boolean}} [options] */
export async function packageCanopyCompanion(output, { root = ROOT, includeWorkingTree = false } = {}) {
  const target = resolve(output);
  try {
    await lstat(target);
    throw new Error(`Canopy companion output already exists: ${target}`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  const dirty = !!execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim();
  if (dirty && !includeWorkingTree) throw new Error("Commit the companion source first, or use --include-working-tree for an internal candidate.");
  // The ignored renderer is accepted only with its source-bound receipt. Rebuild when absent
  // or stale; avoid rewriting a valid pair while another packager is reading it.
  const renderer = await checkPortfolioLeafBundle(join(root, "packages/ui"));
  if (!renderer.ok) {
    try {
      execFileSync(process.execPath, [join(root, "packages/ui/build-portfolio-leaf.mjs")], { cwd: root, stdio: "inherit", timeout: 120_000 });
    } catch (error) {
      throw new Error(`Portfolio renderer was ${renderer.cause}: ${renderer.reason}; rebuild also failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  execFileSync("bun", [join(root, "apps/canopy/workspace-ui/build.ts")], { cwd: root, stdio: "inherit", timeout: 120_000 });
  for (const asset of ASSETS) {
    try { await access(join(root, asset)); }
    catch { throw new Error(`Canopy companion asset missing: ${asset}. Run pnpm run build:bundles and pnpm --filter @foliage/canopy-app workspace:build before packaging.`); }
  }
  // Build in a new sibling directory. A copy failure cannot strand a partial release at
  // the requested path, and an existing output is never removed.
  const staging = join(dirname(target), `.${basename(target)}-staging-${randomUUID()}`);
  try {
    const result = await packageCanopy(staging, root, { generatedAssets: ASSETS, entryPackages: ["@foliage/canopy-app"], includeWorkingTree });
    for (const [source, destination] of COPIES) {
      await mkdir(dirname(join(staging, destination)), { recursive: true });
      await copyFile(join(root, source), join(staging, destination));
    }
    const sourcePackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    await writeFile(join(staging, "package.json"), JSON.stringify({ name: "foliage-canopy-companion", private: true, type: "module",
      version: sourcePackage.version, engines: sourcePackage.engines }, null, 2));
    await writeFile(join(staging, "START-HERE.md"), `# Canopy companion · controlled pilot\n\nThis closed package complements the separate open Foliage archive. It requires Node 22.18–24 on ${process.platform}/${process.arch}, an existing Foliage garden, and a separately deployed Canopy account service. It contains no account, garden, publication, or provider credentials.\n\n1. Verify this archive's SHA-256 against the operator's separate release digest. The internal manifest detects changed files but is not a publisher signature.\n2. Extract it, then run \`node install.mjs /absolute/path/to/a/new/canopy-folder\`. The destination parent must exist; no installation is overwritten.\n3. In the open Foliage app, create and review your private record. Use the same garden path in the next command.\n4. Run \`node /absolute/path/to/a/new/canopy-folder/canopy.mjs --garden /absolute/path/to/your/existing/garden --hosted-origin https://your-configured-canopy.example\`. The launcher binds the manager and read-only local reader to loopback. It does not connect an account or send work at startup.\n5. Open the local manager URL it prints, choose Live portfolio, connect your hosted account in the browser, prepare the public projection, inspect its exact preview, and decide whether to publish. Withdrawal is a separate action in the same workspace.\n\nThe exact HTTPS origin is supplied at launch and is not bundled. Private connection state stays in the garden at hosted/connection.json. Back up the garden separately. To update, stop the companion and install a new verified release into another folder; retain the garden. To remove the app, stop it and remove only its installation folder.\n\nThe hosted service needs its own Clerk/Supabase/Vercel configuration and live account acceptance. This is a Node archive, not a signed native installer or proof of production publication. Do not publish this closed package on the public open-source download page without an authorized distribution decision.\n`);
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const manifest = await writeRuntimeManifest(staging, { kind: "foliage-canopy-companion", version: sourcePackage.version,
      revision, workingTree: dirty, platform: process.platform, arch: process.arch });
    await mkdir(target);
    try { await rename(staging, target); }
    catch (error) {
      // Only remove the empty reservation we created. Other content stays untouched.
      await rmdir(target).catch(() => {});
      throw error;
    }
    return { ...result, files: manifest.files.length, revision, workingTree: dirty };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2] || process.argv.slice(3).some(arg => arg !== "--include-working-tree")) {
    throw new Error("Usage: node tools/deploy/package-canopy-companion.mjs <new-output-directory> [--include-working-tree]");
  }
  console.log(JSON.stringify(await packageCanopyCompanion(process.argv[2], { includeWorkingTree: process.argv.includes("--include-working-tree") })));
}
