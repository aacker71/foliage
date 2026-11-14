#!/usr/bin/env node
/**
 * The front door of `pnpm test` and `pnpm test:focus`: runs `node <arguments>` exactly as given,
 * minus the variables that point Foliage at a person's data. The `--test` flags stay in
 * package.json, where people read them and where knip finds the test files from them.
 *
 * WHY HERE: many tests start real CLIs and servers with `{ ...process.env, HOME: <temp> }`.
 * HOME alone does not isolate them — `foliage.mjs` reads FOLIAGE_GARDEN before `~/.foliage`, and
 * the apps read FOLIAGE_LEAF, FOLIAGE_HARVEST and the rest before their own defaults. With
 * FOLIAGE_GARDEN exported, the suite went red AND wrote leaf.json, harvest.json and workflow/
 * into that garden (measured at fa29203). Clearing them once, at the door every test run comes
 * through, covers every test that exists and every one written later. A test that needs one of
 * these sets it explicitly for its own child, which still works.
 *
 * Not a second test framework: this only changes the environment Node's runner starts with.
 */
import { spawn } from "node:child_process";
import { constants } from "node:os";

/** Every variable that names where a person's Foliage data (or the checkout it runs) lives. */
const DATA_PATH_VARIABLES = new Set([
  "FOLIAGE_GARDEN",
  "FOLIAGE_LEAF",
  "FOLIAGE_HARVEST",
  "FOLIAGE_POLICY",
  "FOLIAGE_SOURCES",
  "FOLIAGE_WORKFLOW_DIR",
  "FOLIAGE_PUBLISHED",
  "FOLIAGE_MEDIA",
  "FOLIAGE_HOSTED_STATUS",
  "FOLIAGE_HOSTED_STATE",
  "FOLIAGE_LADYBUG",
  "FOLIAGE_TREE",
  "FOLIAGE_COMPANY",
  "FOLIAGE_RELEASE",
  "FOLIAGE_COS_STORE",
  "FOLIAGE_SOURCE_REPO",
  "FOLIAGE_OPEN_DESIGN_ROOT",
  "FOLIAGE_SITE",
  "FOLIAGE_HOME",
]);

const env = { ...process.env };
const cleared = Object.keys(env).filter((name) => DATA_PATH_VARIABLES.has(name)).sort();
for (const name of cleared) delete env[name];
if (cleared.length > 0) {
  process.stderr.write(`tests: ignoring ${cleared.join(", ")} from your shell; tests use their own temporary data.\n`);
}

const child = spawn(process.execPath, process.argv.slice(2), { stdio: "inherit", env });
// The runner owns the run: a stop aimed at this front door reaches it, and this process waits for
// it to finish instead of leaving it running unattended.
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  process.stderr.write(`tests: could not start the test runner (${error.message}).\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? 128 + (signal === null ? 0 : constants.signals[signal]));
});
