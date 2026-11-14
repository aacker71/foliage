/**
 * HELP SAYS WHAT EXISTS, through the real entry points.
 *
 * Measured on the 0.3.0 candidate: the top-level table listed a `help` row, yet `foliage.mjs help`
 * exited 2 as an unknown command. `help` now prints the table, and `help <command>` prints what
 * `<command> --help` prints. And `assistant-mcp.mjs --help` in an installed copy named
 * docs/ASSISTANT-MCP.md, which an installed copy does not carry: it now names the document by its
 * full path only where the document is, as `foliage.mjs mcp --help` does.
 *
 * ISOLATION: HOME and the garden are temporary folders; nothing reads or writes the developer's own.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const LAUNCHER = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const ASSISTANT = fileURLToPath(new URL("../assistant-mcp.mjs", import.meta.url));
const NODE_FLOOR = fileURLToPath(new URL("./nodeFloor.mjs", import.meta.url));
const DOC = fileURLToPath(new URL("../../../docs/ASSISTANT-MCP.md", import.meta.url));

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foliage-help-command-"));
  roots.push(root);
  return root;
}

function foliage(home: string, args: readonly string[]) {
  return spawnSync(process.execPath, [LAUNCHER, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: { PATH: process.env["PATH"] ?? "", HOME: home, NO_COLOR: "1" },
  });
}

test("foliage.mjs help prints the help the table promises, and help <command> what <command> --help prints", async () => {
  const root = await temporary();
  const garden = join(root, "garden");
  const table = foliage(root, ["--help", "--garden", garden]);
  assert.equal(table.status, 0, table.stderr);
  assert.match(table.stdout, /^ {2}help +read usage without changing files +\[command\] · <command> --help$/m);
  for (const asked of [["help"], ["help", "--help"]]) {
    const ran = foliage(root, [...asked, "--garden", garden]);
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stderr, "");
    assert.equal(ran.stdout, table.stdout, `${asked.join(" ")} prints the table --help prints`);
  }
  for (const command of ["grow", "mcp", "brain", "search"]) {
    const ran = foliage(root, ["help", command, "--garden", garden]);
    const direct = foliage(root, [command, "--help", "--garden", garden]);
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout, direct.stdout, `help ${command} prints what ${command} --help prints`);
    assert.match(ran.stdout, new RegExp(`^Usage: node foliage\\.mjs ${command} `));
  }
  const unknown = foliage(root, ["help", "nope", "--garden", garden]);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stderr, 'foliage: unknown command "nope". Use --help.\n');
  const two = foliage(root, ["help", "grow", "up", "--garden", garden]);
  assert.equal(two.status, 2);
  assert.equal(two.stderr, "foliage: help takes one command at most, as in help grow.\n");
  await assert.rejects(lstat(garden), { code: "ENOENT" }, "help reads and writes nothing");
});

test("assistant-mcp.mjs --help names docs/ASSISTANT-MCP.md by its full path where it is, and nothing where it is not", async () => {
  const here = spawnSync(process.execPath, [ASSISTANT, "--help"], { encoding: "utf8", timeout: 30_000, env: {} });
  assert.equal(here.status, 0, here.stderr);
  assert.ok(here.stdout.endsWith(`Setup and permission limits: ${DOC}\n`), here.stdout);
  // An installed copy: apps/leaf/ with no docs/ beside it.
  const installed = await temporary();
  await mkdir(join(installed, "apps", "leaf", "src"), { recursive: true });
  await copyFile(ASSISTANT, join(installed, "apps", "leaf", "assistant-mcp.mjs"));
  await copyFile(NODE_FLOOR, join(installed, "apps", "leaf", "src", "nodeFloor.mjs"));
  const there = spawnSync(process.execPath, [join(installed, "apps", "leaf", "assistant-mcp.mjs"), "--help"], { cwd: installed, encoding: "utf8", timeout: 30_000, env: {} });
  assert.equal(there.status, 0, there.stderr);
  assert.match(there.stdout, /^Foliage assistant connection/);
  assert.doesNotMatch(there.stdout, /ASSISTANT-MCP|docs\//);
  assert.ok(there.stdout.endsWith("No provider login, approval, publication, or remote HTTP server.\n"), there.stdout);
});
