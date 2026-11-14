#!/usr/bin/env node
/** Explicit launcher for the separately distributed, closed Canopy companion. */
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkNode } from "./tools/install/requirements.mjs";

const usage = "Usage: node canopy.mjs --garden /absolute/existing/garden --hosted-origin https://your-canopy.example [--manage-port 4180 --public-port 4173]";

export async function companionArguments(args) {
  const { values, positionals, tokens } = parseArgs({ args, strict: true, allowPositionals: false, tokens: true,
    options: { garden: { type: "string" }, "hosted-origin": { type: "string" }, "manage-port": { type: "string" }, "public-port": { type: "string" }, help: { type: "boolean" } } });
  const seen = new Set();
  for (const token of tokens) if (token.kind === "option") {
    if (seen.has(token.name)) throw new Error(`Repeated --${token.name}.`);
    seen.add(token.name);
  }
  if (positionals.length) throw new Error(usage);
  if (values.help) {
    if (seen.size !== 1) throw new Error(usage);
    return { help: true };
  }
  const garden = values.garden;
  if (!garden || !isAbsolute(garden)) throw new Error(`Choose an existing absolute --garden.\n${usage}`);
  let selected;
  try { selected = await realpath(garden); }
  catch { throw new Error("The selected garden does not exist. Start the local Foliage app with this garden first."); }
  if (!(await lstat(selected)).isDirectory()) throw new Error("The selected garden is not a directory.");
  const origin = values["hosted-origin"];
  let url;
  try { url = new URL(origin ?? ""); }
  catch { throw new Error(`Choose an exact HTTPS --hosted-origin.\n${usage}`); }
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || url.search || url.hash) {
    throw new Error("The hosted origin must be an exact HTTPS origin without credentials, path, query or fragment.");
  }
  const ports = [];
  for (const flag of ["manage-port", "public-port"]) {
    const value = values[flag];
    if (value === undefined) continue;
    const port = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--${flag} must be an integer from 1 to 65535.`);
    ports.push(`--${flag}`, String(port));
  }
  return { garden: selected, origin, ports };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === await realpath(process.argv[1])) {
  try {
    const selected = await companionArguments(process.argv.slice(2));
    if (selected.help) console.log(usage + "\nThe selected garden stays local; connecting and publishing require separate actions.");
    else {
      const node = checkNode({ version: process.version, typescript: process.features.typescript });
      if (!node.ok) throw new Error(node.message);
      const entry = join(dirname(fileURLToPath(import.meta.url)), "foliage.mjs");
      process.env.FOLIAGE_HOSTED_ORIGIN = selected.origin;
      process.argv = [process.execPath, entry, "canopy", "--garden", selected.garden, ...selected.ports];
      await import(new URL("./foliage.mjs", import.meta.url).href);
    }
  } catch (error) {
    console.error(`Canopy companion: ${error instanceof Error ? error.message : "start failed"}`);
    process.exitCode = 2;
  }
}
