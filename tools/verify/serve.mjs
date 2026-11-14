#!/usr/bin/env node
/** Per-worktree detached servers. Does not adopt old PID registries or manage browser tabs. */
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { SURFACES } from "./surfaces.mjs";
import { controlPath, request, start } from "./managed.ts";

import { isEntryPoint, unmetPrecondition } from "./serving.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
/** @param {string} name
 * @param {import("./managed.ts").ManagedSurface & {requires?: (env: NodeJS.ProcessEnv) => string | null}} surface
 * @param {Record<string, string>} opts @param {NodeJS.ProcessEnv} env */
export async function up(name, surface, opts = {}, env = process.env) {
  const unmet = unmetPrecondition(surface, env);
  if (unmet !== null) return { action: "skipped", reason: unmet };
  try {
    const state = await start(root, name, surface, opts, env);
    return { action: state.state, ...state };
  } catch (error) {
    return { action: "conflict", reason: error instanceof Error ? error.message : String(error) };
  }
}
async function main() {

try {
  const { values, positionals } = parseArgs({
    options: { "port-offset": { type: "string", default: "0" }, help: { type: "boolean" } },
    allowPositionals: true, strict: true,
  });
  const [command = "status", ...only] = positionals;
  if (values.help) {
    console.log("pnpm serve up|status|down [leaf|canopy|photosynthesis|enterprise] [--port-offset N]\nSeparate worktrees use separate control sockets. Choose distinct port offsets.\nNo existing ports/PIDs are adopted. down never closes browser tabs.");
  } else {
    if (!["up", "status", "down"].includes(command)) throw new Error(`Unknown command: ${command}`);
    const offset = Number(values["port-offset"]);
    if (!Number.isInteger(offset) || offset < 0 || offset > 60000) throw new Error("--port-offset must be an integer from 0 to 60000");
    const names = only.length ? only : Object.keys(SURFACES);
    for (const name of names) if (!Object.hasOwn(SURFACES, name)) throw new Error(`Unknown surface: ${name}`);
    for (const name of names) {
      const surface = SURFACES[/** @type {keyof typeof SURFACES} */ (name)];
      const unmet = command === "up" ? unmetPrecondition(surface, process.env) : null;
      if (unmet !== null) { console.log(`${name}: SKIP ${unmet}`); continue; }
      const status = command === "up"
        ? await start(root, name, { ...surface, port: surface.port + offset })
        : await request(controlPath(root, name), command === "down" ? "stop" : "status");
      console.log(`${name}: ${status === null ? "not managed by this worktree" : command === "down" ? "stopped" : `${status.state} http://127.0.0.1:${status.port}${surface.path}${status.detail ? ` — ${status.detail}` : ""}`}`);
      if (status?.state === "failed" && command !== "down") process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`serve: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

}

if (isEntryPoint(import.meta.url)) await main();
