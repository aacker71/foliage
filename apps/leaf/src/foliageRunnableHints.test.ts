/**
 * EVERY NEXT STEP THE LAUNCHER PRINTS RUNS AS PRINTED, AND NONE IS A BARE `foliage`.
 *
 * An installed copy puts no `foliage` command on PATH (tools/install/runtime-install.mjs), yet the
 * up banner, status, review, photos, grow's refusals and watch printed `foliage grow --repo …`,
 * `foliage up`, `foliage share …`: commands that do not exist after an install. Each is now node
 * and the launcher's full path with this garden, quoted to paste, as `nextCommand` already spelled
 * grow's own NEXT rows. The top-level help names no bare `foliage` either, and its three columns
 * line up however long a command's name is.
 *
 * Real CLIs over a real temporary Git repository with a labelled fixture identity.
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const shellWord = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
/** The launcher's quoting (foliage.mjs nextCommand). */
const command = (name: string, garden: string) => [process.execPath, LAUNCHER, name, "--garden", garden].map(shellWord).join(" ");
/** A bare `foliage <command>` where a person is told what to run. */
const BARE = /(^|[\s`(])foliage (grow|up|review|share|unshare|export|watch|unwatch|sources|verify|photos|status|search|policy|capture)\b/m;

function cleanEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", HOME: home };
  for (const name of ["FOLIAGE_GARDEN", "FOLIAGE_LEAF", "FOLIAGE_HARVEST", "FOLIAGE_POLICY", "FOLIAGE_WORKFLOW_DIR", "FOLIAGE_SOURCES", "FOLIAGE_LAUNCHER"]) delete env[name];
  return env;
}

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  // Canonical, so the repository path watch records (git's answer) is the one this test spells.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-runnable-hints-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repository"), garden = join(dir, "garden with 'quote'"), home = join(dir, "home");
  const git = (args: string[]) => execute("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { timeout: 10_000 });
  await execute("git", ["init", "--quiet", "--initial-branch=main", repo]);
  await git(["config", "user.name", "Runnable hint fixture"]);
  await git(["config", "user.email", "runnable-hint@foliage.invalid"]);
  await writeFile(join(repo, "fixture.txt"), "fixture\n");
  await git(["add", "fixture.txt"]);
  await git(["commit", "--no-gpg-sign", "-qm", "feat: add the runnable-hint fixture file"]);
  await mkdir(home);
  const env = cleanEnv(home);
  const foliage = async (args: string[], cwd = dir) => {
    try {
      const { stdout, stderr } = await execute(process.execPath, [LAUNCHER, ...args], { env, cwd, timeout: 30_000 });
      return { status: 0, output: stdout + stderr };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string };
      return { status: failed.code ?? 1, output: (failed.stdout ?? "") + (failed.stderr ?? "") };
    }
  };
  return { dir, repo, garden, home, env, foliage };
}

test("the next steps status, review, photos, grow and watch print are node and the launcher's path, and run as printed", { timeout: 90_000 }, async t => {
  const { dir, repo, garden, home, env, foliage } = await fixture(t);

  // An empty garden: status names grow, review names grow, photos names its own form.
  const status = await foliage(["status", "--garden", garden]);
  assert.equal(status.status, 0, status.output);
  assert.ok(status.output.includes(`NEXT     ${command("grow", garden)} --repo <your repo>`), status.output);
  const review = await foliage(["review", "--garden", garden]);
  assert.equal(review.status, 1, review.output);
  assert.ok(review.output.includes(`Draft candidates first: ${command("grow", garden)} --repo <path>`), review.output);
  const photos = await foliage(["photos", "--garden", garden]);
  assert.equal(photos.status, 2, photos.output);
  assert.ok(photos.output.includes(`photos needs one directory: ${command("photos", garden)} <dir>`), photos.output);
  const scheduled = await foliage(["grow", "--watched", "--garden", garden]);
  assert.equal(scheduled.status, 2, scheduled.output);
  assert.ok(scheduled.output.includes(`run ${command("watch", garden)} <path> before a scheduled harvest`), scheduled.output);
  // Bare `integrations` prints the launcher's help, not the importer's script usage and its bare `foliage up`.
  const integrations = await foliage(["integrations"]);
  assert.equal(integrations.status, 0, integrations.output);
  assert.match(integrations.output, /^Usage: node foliage\.mjs integrations import --garden <path>/);
  assert.doesNotMatch(integrations.output, /apps\/leaf\/import-observations\.mjs|(^|\s)docs\//);
  for (const { output } of [status, review, photos, scheduled, integrations]) assert.doesNotMatch(output, BARE);

  // watch: its next step reads this repository into this garden, and is pasted to a shell as printed.
  const watched = await foliage(["watch", repo, "--garden", garden]);
  assert.equal(watched.status, 0, watched.output);
  const grow = /nothing was harvested — run {2}(.+) {2}to read it now\./.exec(watched.output)?.[1];
  assert.equal(grow, [process.execPath, LAUNCHER, "grow", "--repo", repo, "--garden", garden].map(shellWord).join(" "), watched.output);
  assert.doesNotMatch(watched.output, BARE);
  const grown = await execute("/bin/sh", ["-c", grow!], { env, cwd: home, timeout: 30_000 });
  assert.match(grown.stdout, /YOUR TURN — no draft joins the leaf without you/);
  assert.doesNotMatch(grown.stdout, BARE);
  assert.deepEqual((await readdir(garden)).filter(name => name.endsWith(".json")).sort(), ["harvest.json", "leaf.json", "sources.json"]);

  // status with a record, run from another directory: its review step is the launcher's, too.
  const after = await foliage(["status", "--garden", garden], home);
  assert.equal(after.status, 0, after.output);
  assert.ok(after.output.includes(`→ /review · ${command("up", garden)}`), after.output);
  assert.doesNotMatch(after.output, BARE);
  assert.ok(!(await readdir(dir)).includes(".foliage") && (await readdir(home)).length === 0, "nothing was written outside the named garden");
});

test("the top-level help names no bare foliage command and its columns line up", async t => {
  const { garden, foliage } = await fixture(t);
  const help = await foliage(["--help", "--garden", garden]);
  assert.equal(help.status, 0, help.output);
  assert.doesNotMatch(help.output, BARE);
  const lines = help.output.split("\n");
  assert.ok(lines.includes(`  run            ${[process.execPath, LAUNCHER].map(shellWord).join(" ")} <command>`), help.output);
  const rows = lines.filter(line => /^ {2}[a-z-]+ {2,}\S/.test(line) && !line.startsWith("  run "));
  assert.ok(rows.length >= 20, help.output);
  // The description starts in one column for every row, and the usage in one column for every row that has one.
  const at = (line: string, pattern: RegExp) => pattern.exec(line)?.index ?? -1;
  const descriptions = new Set(rows.map(line => at(line, /(?<=^ {2}[a-z-]+ +)\S/)));
  assert.equal(descriptions.size, 1, `descriptions start in different columns:\n${rows.join("\n")}`);
  const usages = new Set(rows.flatMap(line => /^ {2}[a-z-]+ +\S.*? {2,}(\S.*)$/.test(line) ? [at(line, /(?<=^ {2}[a-z-]+ +\S.*? {2,})\S/)] : []));
  assert.equal(usages.size, 1, `usages start in different columns:\n${rows.join("\n")}`);
  for (const name of ["migrate-queue", "integrations", "private-brain", "capture", "mcp", "search", "brain"]) {
    assert.ok(rows.some(line => line.startsWith(`  ${name} `)), `${name} is listed`);
  }
});

/** A port the OS hands out (ephemeral, above the 4173–4199 range long-running servers hold). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") return probe.close(() => reject(new Error("no port from the OS")));
      probe.close(() => resolve(address.port));
    });
  });
}

test("the up banner's grow step for an empty garden is node and the launcher's path", { timeout: 60_000 }, async t => {
  const { garden, env } = await fixture(t);
  const port = await freePort();
  const child = spawn(process.execPath, [LAUNCHER, "up", "--port", String(port), "--garden", garden], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  child.stdout.on("data", (data) => { output += String(data); });
  child.stderr.on("data", (data) => { output += String(data); });
  try {
    for (const deadline = Date.now() + 15_000; !output.includes("APP");) {
      assert.ok(child.exitCode === null, `foliage up exited:\n${output}`);
      assert.ok(Date.now() < deadline, `foliage up printed no banner:\n${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(output.includes(`LEAF     none yet — ${command("grow", garden)} --repo <path>`), output);
    assert.doesNotMatch(output, BARE);
  } finally {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => child.once("exit", () => resolve()));
  }
});

test("sources' own hints, an empty list's and watch's or unwatch's with no path, are node and the launcher's path, and run as printed from another folder", { timeout: 60_000 }, async t => {
  const { repo, garden, home, env, foliage } = await fixture(t);
  const empty = await foliage(["sources", "--garden", garden], home);
  assert.equal(empty.status, 0, empty.output);
  assert.ok(empty.output.includes(`sources: add one with  ${command("watch", garden)} <path>\n`), empty.output);
  const outputs = [empty.output];
  for (const verb of ["watch", "unwatch"]) {
    const bare = await foliage([verb, "--garden", garden], home);
    assert.equal(bare.status, 2, bare.output);
    assert.ok(bare.output.includes(`sources: ${verb} needs a path — ${command(verb, garden)} <path>\n`), bare.output);
    outputs.push(bare.output);
  }
  for (const output of outputs) assert.doesNotMatch(output, /apps\/leaf\/sources\.mjs/);
  // The empty list's hint, with the path filled in, watches the repository from the home folder.
  const hint = /add one with {2}(.+) <path>$/m.exec(empty.output)?.[1];
  const watched = await execute("/bin/sh", ["-c", `${hint!} ${shellWord(repo)}`], { env, cwd: home, timeout: 30_000 });
  assert.match(watched.stdout, /sources: watching /);
  assert.deepEqual(await readdir(garden), ["sources.json"]);
});

test("verify's FIX re-runs what was typed: the repository it checked by its full path, the current folder when no --repo was given, --setup when given, and the garden; it runs as printed from another folder", { timeout: 60_000 }, async t => {
  const { dir, repo, garden, home, env, foliage } = await fixture(t);
  // HOME holds no ~/.ssh, so verify stops at its FIX line.
  for (const [args, cwd, rest] of [
    [["verify", "--repo", repo, "--garden", garden], home, ["--repo", repo]],
    [["verify", "--repo", "repository", "--setup", "--garden", garden], dir, ["--repo", repo, "--setup"]],
    [["verify", "--garden", garden], repo, ["--repo", repo]],
  ] as const) {
    const ran = await foliage([...args], cwd);
    assert.equal(ran.status, 1, ran.output);
    const fix = /^ {2}FIX +ssh-keygen -t ed25519 {4}then re-run (.+)$/m.exec(ran.output)?.[1];
    assert.equal(fix, [process.execPath, LAUNCHER, "verify", "--garden", garden, ...rest].map(shellWord).join(" "), ran.output);
    const again = await execute("/bin/sh", ["-c", fix!], { env, cwd: home, timeout: 30_000 }).then(() => assert.fail("verify passed without a key"), (error: { code?: number; stdout?: string }) => error);
    assert.equal(again.code, 1);
    assert.match(again.stdout ?? "", new RegExp(`^ {2}REPO +${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), "the re-run checks the same repository");
  }
});
