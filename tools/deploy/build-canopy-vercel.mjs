#!/usr/bin/env node
/** Vercel Build Output API v3. All requests enter the hosted authority boundary.
 * https://vercel.com/docs/build-output-api/primitives
 * https://vercel.com/docs/build-output-api/configuration
 */
import { access, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageCanopy } from "./package-canopy.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GENERATED_ASSETS = ["apps/canopy/public/workspace.js", "apps/canopy/public/workspace.css",
  "packages/ui/build/portfolio-leaf.bundle.js", "packages/ui/build/portfolio-leaf.receipt.json"];
const HANDLER = "apps/canopy/hosted-server.mjs";

export async function buildCanopyVercel({ root = ROOT, generatedAssets = GENERATED_ASSETS } = {}) {
  root = await realpath(root);
  const vercel = join(root, "apps/canopy/.vercel");
  await mkdir(vercel, { recursive: true });
  if (await realpath(vercel) !== vercel) throw new Error("The Vercel output directory must not be reached through a symlink");
  const stage = await mkdtemp(join(vercel, ".canopy-output-"));
  try {
    await mkdir(join(stage, "functions"));
    const fn = join(stage, "functions/index.func");
    const packaged = await packageCanopy(fn, root, { generatedAssets });
    await access(join(fn, HANDLER)); // An untracked or missing hosted entry cannot become a release.
    await writeFile(join(fn, ".vc-config.json"), JSON.stringify({
      runtime: "nodejs22.x", handler: HANDLER, launcherType: "Nodejs", shouldAddHelpers: false,
    }, null, 2));
    await writeFile(join(stage, "config.json"), JSON.stringify({
      version: 3, routes: [{ src: "/.*", dest: "/index" }],
    }, null, 2));
    // Replace only our derived build output, after successful packaging. No static directory,
    // cached publication, or prior deployment file can survive alongside the new function.
    const output = join(vercel, "output");
    await rm(output, { recursive: true, force: true });
    await rename(stage, output);
    return { output, ...packaged };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await buildCanopyVercel()));
}
