/**
 * THE DOCUMENTED MCP SURFACE IS THE REGISTERED ONE.
 *
 * The docs said "the default two-tool connection" and "with both flags there are seven tools"
 * while the server registered three by default and eight with both authoring flags, and never
 * named `foliage_import_portfolio` at all. This compares docs/ASSISTANT-MCP.md's launch-flag
 * table, and the counts plugin/foliage/README.md states, with `tools/list` from the real stdio
 * server, launched once per flag over a fixture garden. The flags themselves come from the
 * launcher's own usage line, so a new flag without a documented row fails here too. A flag
 * that only works with other inputs is launched with them, and its row is what it adds to
 * what those inputs already register.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const execute = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LAUNCHER = join(ROOT, "foliage.mjs");
const CONTRACT = join(ROOT, "docs/ASSISTANT-MCP.md");
const PLUGIN_README = join(ROOT, "plugin/foliage/README.md");
const DEFAULT = "default";
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** The `| Launch flag | Tools it adds |` table: one row per flag, plus the default row. */
function documentedTable(markdown: string): Map<string, string[]> {
  const lines = markdown.split("\n");
  const start = lines.findIndex(line => /^\|\s*Launch flag\s*\|\s*Tools it adds\s*\|\s*$/.test(line));
  assert.notEqual(start, -1, "docs/ASSISTANT-MCP.md has no `| Launch flag | Tools it adds |` table");
  const rows = new Map<string, string[]>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const [flagCell = "", toolsCell = ""] = line.split("|").slice(1, 3);
    const flag = /`(--[a-z-]+)`/.exec(flagCell)?.[1] ?? DEFAULT;
    assert.ok(!rows.has(flag), `the table lists ${flag} twice`);
    rows.set(flag, [...toolsCell.matchAll(/`(foliage_[a-z_]+)`/g)].map(match => match[1]!).sort());
  }
  return rows;
}

async function registered(garden: string, flags: readonly string[]): Promise<string[]> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [LAUNCHER, "mcp", "--garden", garden, ...flags], cwd: tmpdir(), stderr: "pipe" });
  const client = new Client({ name: "foliage-docs-drift", version: "1.0.0" });
  client.onerror = () => {};
  await client.connect(transport);
  try { return (await client.listTools()).tools.map(tool => tool.name).sort(); }
  finally { await client.close(); }
}

test("docs name exactly the MCP tools each launch flag registers, and the plugin README counts them", { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-mcp-docs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repository"); const garden = join(dir, "garden");
  const git = (args: string[]) => execute("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { timeout: 10_000 });
  await execute("git", ["init", "--quiet", "--initial-branch=main", repo]);
  await git(["config", "user.name", "MCP docs fixture"]);
  await git(["config", "user.email", "mcp-docs@foliage.invalid"]);
  await writeFile(join(repo, "fixture.txt"), "fixture\n");
  await git(["add", "fixture.txt"]);
  await git(["commit", "--no-gpg-sign", "-qm", "feat: add the docs fixture file"]);
  const env = { ...process.env };
  for (const name of ["FOLIAGE_GARDEN", "FOLIAGE_LEAF", "FOLIAGE_HARVEST", "FOLIAGE_POLICY", "FOLIAGE_WORKFLOW_DIR"]) delete env[name];
  await execute(process.execPath, [LAUNCHER, "grow", "--repo", repo, "--subject", "MCP docs fixture", "--identity", "mcp-docs@foliage.invalid", "--garden", garden], { env, timeout: 30_000 });

  const { stdout: commit } = await git(["rev-parse", "HEAD"]);
  const scenario = join(dir, "scenario.json");
  await writeFile(scenario, JSON.stringify({ version: 1, id: "mcp-docs-probe", steps: [{ stage: "execute", argv: ["node", "--version"], timeoutMs: 10_000 }] }));
  // Launch inputs only: listing tools runs no capture and no project test, so no app or image is needed.
  const origin = ["--capture-origin", "http://127.0.0.1:4210"];
  const projectTest = ["--test-repo", repo, "--test-commit", commit.trim(), "--test-scenario", scenario, "--test-image", `sha256:${"0".repeat(64)}`];
  const launch: Record<string, readonly string[]> = {
    "--capture-origin": origin,
    "--allow-demo-browser": [...origin, "--allow-demo-browser"],
    "--allow-project-test": ["--allow-project-test", ...projectTest],
  };
  // A row lists what its flag adds beyond the flag it has to be launched beside.
  const beside: Record<string, readonly string[]> = { "--allow-demo-browser": origin };

  const usage = (await execute(process.execPath, [LAUNCHER, "mcp", "--help"], { env })).stdout;
  const flags = [...new Set(usage.match(/--allow-[a-z-]+|--capture-origin/g) ?? [])].sort();
  assert.ok(flags.length > 0, usage);

  const table = documentedTable(await readFile(CONTRACT, "utf8"));
  assert.deepEqual([...table.keys()].sort(), [DEFAULT, ...flags].sort(), "one documented row per launcher flag, plus the default");
  const always = await registered(garden, []);
  assert.deepEqual(table.get(DEFAULT), always, "default row");
  for (const flag of flags) {
    const base = beside[flag] === undefined ? always : await registered(garden, beside[flag]);
    const added = (await registered(garden, launch[flag] ?? [flag])).filter(name => !base.includes(name));
    assert.deepEqual(table.get(flag), added, `${flag} row`);
  }

  const plugin = await readFile(PLUGIN_README, "utf8");
  const authoring = await registered(garden, ["--allow-achievements", "--allow-presentation"]);
  // Prose wraps anywhere, so any run of whitespace stands for one space.
  const says = (phrase: string) => new RegExp(phrase.split(" ").join("\\s+")).test(plugin);
  assert.ok(says(`the ${NUMBER_WORDS[always.length]} default tools`), `plugin README: say "the ${NUMBER_WORDS[always.length]} default tools"`);
  assert.ok(says(`With both flags there are ${NUMBER_WORDS[authoring.length]} tools`), `plugin README: say "With both flags there are ${NUMBER_WORDS[authoring.length]} tools"`);
});
