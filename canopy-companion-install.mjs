#!/usr/bin/env node
/** Install only a verified Canopy companion into a new directory. */
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { realpath } from "node:fs/promises";
import { installRuntime, verifyRuntime } from "./tools/install/runtime-install.mjs";

const usage = "Usage: node install.mjs /absolute/path/to/new/canopy-companion-directory";

export async function installCompanion(source, destination) {
  const manifest = await verifyRuntime(source);
  if (manifest.kind !== "foliage-canopy-companion") throw new Error("This archive is not a Canopy companion. Obtain the separate companion package.");
  const result = await installRuntime(source, destination);
  return { ...result, revision: manifest.revision };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === await realpath(process.argv[1])) {
  try {
    const { positionals } = parseArgs({ strict: true, allowPositionals: true, options: {} });
    if (positionals.length !== 1 || !isAbsolute(positionals[0] ?? "")) throw new Error(usage);
    const result = await installCompanion(dirname(fileURLToPath(import.meta.url)), positionals[0]);
    console.log(`Installed Canopy companion ${result.version} (${result.revision}) at ${result.directory}.\nStart it only when ready: node ${JSON.stringify(join(result.directory, "canopy.mjs"))} --garden /absolute/existing/foliage-garden --hosted-origin https://your-canopy.example\nNo source, account or hosted service was contacted. Nothing starts automatically.`);
  } catch (error) {
    console.error(`Canopy companion install: ${error instanceof Error ? error.message : "failed"}`);
    process.exitCode = 1;
  }
}
