/**
 * `assistant-mcp.mjs --help` names itself by its full path, so its usage line runs as printed from
 * any folder: it used to print `node apps/leaf/assistant-mcp.mjs`, which runs only from the folder
 * that holds apps/. A SYNTHETIC installed copy: the script and the one module its help needs.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ASSISTANT = fileURLToPath(new URL("../assistant-mcp.mjs", import.meta.url));
const NODE_FLOOR = fileURLToPath(new URL("./nodeFloor.mjs", import.meta.url));

test("assistant-mcp.mjs --help prints its usage with this copy's full path, quoted, run from another folder", async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-mcp-usage-it's-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const copy = join(dir, "foliage", "apps", "leaf", "assistant-mcp.mjs"), elsewhere = join(dir, "elsewhere");
  await mkdir(join(dir, "foliage", "apps", "leaf", "src"), { recursive: true });
  await mkdir(elsewhere);
  await copyFile(ASSISTANT, copy);
  await copyFile(NODE_FLOOR, join(dir, "foliage", "apps", "leaf", "src", "nodeFloor.mjs"));
  const ran = spawnSync(process.execPath, [copy, "--help"], { cwd: elsewhere, encoding: "utf8", timeout: 30_000, env: {} });
  assert.equal(ran.status, 0, ran.stderr);
  const quoted = `'${copy.replaceAll("'", "'\\''")}'`;
  assert.ok(ran.stdout.includes(`\n  node ${quoted} --into <existing leaf.json> --out <harvest.json>\n`), ran.stdout);
  assert.doesNotMatch(ran.stdout, /node apps\/leaf\/assistant-mcp\.mjs/);
});
