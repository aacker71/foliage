/**
 * QA #25: a command that hands the garden to another program, or prints its private record, names
 * that garden on the command line. `integrations import` and `search` used to fall back to
 * FOLIAGE_GARDEN or ~/.foliage, while `mcp` and `private-brain` refused. Every child here runs
 * with HOME pointed at a temporary directory, so ~/.foliage is a throwaway garden holding a real
 * grown Leaf whose subject the batch matches: without the refusal, the import WOULD land there.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const REFUSAL = (label: string) => `foliage: ${label} requires one explicit --garden <path>; ambient garden settings are not used.\n`;

let scratch = "", home = "", homeGarden = "", ambient = "", named = "", batch = "", subject = "";
/** Nothing inherited: no FOLIAGE_* export and no developer git config reach these runs. */
const baseEnv = (): NodeJS.ProcessEnv => ({
  PATH: process.env["PATH"] ?? "", HOME: home, NO_COLOR: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
});
const cli = (args: readonly string[], extra: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [launcher, ...args], { cwd: scratch, env: { ...baseEnv(), ...extra }, encoding: "utf8", timeout: 30_000 });

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    out[relative(dir, path)] = entry.isFile() ? await readFile(path, "utf8") : "<dir>";
  }
  return out;
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "foliage-explicit-garden-"));
  home = join(scratch, "home"); homeGarden = join(home, ".foliage"); ambient = join(scratch, "ambient"); named = join(scratch, "named");
  const repo = join(scratch, "repo");
  await mkdir(repo, { recursive: true }); await mkdir(home);
  const git = (args: readonly string[]) =>
    execFileSync("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { env: baseEnv(), encoding: "utf8" });
  execFileSync("git", ["init", "-q", "--initial-branch=main", repo], { env: baseEnv() });
  git(["config", "user.name", "Explicit garden regression"]);
  git(["config", "user.email", "explicit-garden@foliage.invalid"]);
  await writeFile(join(repo, "probe.txt"), "explicit garden probe\n");
  git(["add", "probe.txt"]);
  git(["commit", "-qm", "feat: explicit garden probe", "--no-gpg-sign"]);
  const sha = git(["rev-parse", "HEAD"]).trim();
  const grown = cli(["grow", "--repo", repo, "--subject", "Explicit garden regression", "--identity", "explicit-garden@foliage.invalid", "--garden", homeGarden]);
  assert.equal(grown.status, 0, grown.stderr);
  await cp(homeGarden, ambient, { recursive: true });
  await cp(homeGarden, named, { recursive: true });
  const leaf = JSON.parse(await readFile(join(homeGarden, "leaf.json"), "utf8")) as { id: string; subject: string };
  subject = leaf.subject;
  batch = join(scratch, "observations.json");
  await writeFile(batch, JSON.stringify({ format: "foliage-observations", version: 1, subject: { leafId: leaf.id, name: leaf.subject },
    source: { provider: "git-export", tenantId: null, accountId: "explicit-garden-regression" },
    completion: "complete", deletedRecordIds: [],
    observations: [{ recordId: sha, revision: sha, title: "feat: explicit garden probe", excerpt: "explicit garden probe\n", observedAt: new Date().toISOString() }] }));
});
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });

test("without --garden, import, search, mcp and private-brain refuse in one line and touch neither ~/.foliage nor FOLIAGE_GARDEN", { timeout: 120_000 }, async () => {
  const commands: readonly (readonly [readonly string[], string])[] = [
    [["integrations", "import", "--input", batch], "integrations import"],
    [["integrations", "import", "--input", batch, "--out", join(scratch, "elsewhere-harvest.json")], "integrations import"],
    [["search", "probe"], "search"],
    [["mcp"], "mcp"],
    [["private-brain", "list"], "private-brain"],
  ];
  for (const ambientEnv of [{}, { FOLIAGE_GARDEN: ambient }] as const) {
    for (const [args, label] of commands) {
      const homeBefore = await tree(home); const ambientBefore = await tree(ambient);
      const run = cli(args, ambientEnv);
      const which = `${args.join(" ")} ${JSON.stringify(ambientEnv)}`;
      assert.equal(run.stderr, REFUSAL(label), which);
      assert.equal(run.status, 2, which);
      assert.equal(run.stdout, "", `${which}: nothing from a garden nobody named is printed`);
      assert.ok(!run.stderr.includes(subject) && !run.stderr.includes(home), which);
      assert.deepEqual(await tree(home), homeBefore, `${which}: ~/.foliage unchanged`);
      assert.deepEqual(await tree(ambient), ambientBefore, `${which}: FOLIAGE_GARDEN unchanged`);
    }
  }
  assert.deepEqual((await readdir(scratch)).sort(), ["ambient", "home", "named", "observations.json", "repo"]);
});

test("help for import and search names the flag, not a default garden", () => {
  for (const args of [["integrations", "import", "--help"], ["integrations", "--help"], ["search", "--help"]]) {
    const run = cli(args);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /--garden <path>/, args.join(" "));
    assert.match(run.stdout, /Select --garden explicitly; ambient garden settings are not used\./, args.join(" "));
    assert.ok(!run.stdout.includes(home), `${args.join(" ")} must not present ~/.foliage as the garden`);
    assert.ok(!run.stdout.includes("[--garden <path>]"), `${args.join(" ")}: --garden is not optional`);
  }
});

test("a named garden still imports and searches — the refusal is about who chose it", { timeout: 60_000 }, async () => {
  const homeBefore = await tree(home);
  const imported = cli(["integrations", "import", "--input", batch, "--garden", named]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal((JSON.parse(imported.stdout) as { persisted: string[] }).persisted.length, 1);
  const found = cli(["search", "probe", "--garden", named]);
  assert.equal(found.status, 0, found.stderr);
  assert.ok((JSON.parse(found.stdout) as { hits: unknown[] }).hits.length > 0);
  assert.deepEqual(await tree(home), homeBefore, "naming another garden leaves ~/.foliage alone");
});
