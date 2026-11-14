/**
 * `propose-photos` AND `propose-brain` RE-RUN AGAINST A PRE-BOUND DOCUMENT — PR #17 review,
 * blocker 1: the LIVE REPRODUCTION the review named.
 *
 * Before `src/proposeDocument.ts` extracted ONE shared step, `propose` alone preserved an
 * existing `subject`/`leafId` binding across a `--force` refresh with no `--into`; the other two
 * producers each built `{ candidates }` with no binding fields at all. So:
 *
 *   propose --into leaf.json (bound)  →  propose-photos --out <same path> --force
 *
 * — an equally documented, equally unremarkable refresh through a DIFFERENT producer — silently
 * dropped the binding a third way. These two tests drive the real CLI, through the real shared
 * step, and would fail if either producer forked the rule again.
 *
 * `foliageGarden.test.ts` already covers `propose` itself (the --into-less carry-forward, and
 * the disagreeing-`--into` refusal — the latter has no equivalent here, because neither
 * `propose-photos` nor `propose-brain` has a `--into` flag to disagree with anything).
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
/** The shipping retrieval tool, copied from — never written to. Another lane owns it. */
const REAL_VAULT_DIR = fileURLToPath(new URL("../../../tools/vault/", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix = "foliage-propose-carry-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

interface CliResult {
  readonly status: number;
  readonly output: string;
}

async function runHarvest(args: readonly string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [HARVEST_CLI, ...args], {
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/** A minimal leaf `--into` can bind to. */
function leafDoc(subject: string, id: string): string {
  return JSON.stringify({ id, subject, leaflets: [] }, null, 2);
}

/**
 * Bind a fresh harvest document to `leafPath` through the REAL `propose` command over a real
 * (empty is fine) repository — exactly the state `foliage grow` leaves behind, and the starting
 * point every re-run test below begins from.
 */
async function bindHarvest(harvestPath: string, leafPath: string): Promise<void> {
  const repo = await tempDir("foliage-propose-carry-repo-");
  await exec("git", ["init", "--quiet", "--initial-branch=main", repo], { timeout: 30_000 });
  const bound = await runHarvest([
    "propose",
    "--repo",
    repo,
    "--identity",
    "carry@example.test",
    "--into",
    leafPath,
    "--out",
    harvestPath,
    "--force",
  ]);
  assert.equal(bound.status, 0, `binding propose must succeed:\n${bound.output}`);
  const doc = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(doc.subject, "Carry Subject", "the fixture's own binding must have landed");
}

test("F-014 / PR #17 review, blocker 1: propose-photos re-run over a PRE-BOUND document preserves the binding", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  await writeFile(leafPath, leafDoc("Carry Subject", "leaf:carry-photos"), "utf8");
  await bindHarvest(harvestPath, leafPath);

  const emptyDir = await tempDir("foliage-propose-carry-photos-");
  // propose-photos has NO --into flag at all — it can only carry an existing binding forward,
  // never set one. An empty directory is deliberate: zero images is an honest empty harvest
  // (see harvest.mjs's own header), and the point here is the BINDING, not the drafting.
  const rerun = await runHarvest(["propose-photos", "--dir", emptyDir, "--out", harvestPath, "--force"]);
  assert.equal(rerun.status, 0, `propose-photos re-run must succeed:\n${rerun.output}`);
  assert.match(
    rerun.output,
    /binding preserved/,
    `propose-photos must say the binding survived, exactly like propose does:\n${rerun.output}`,
  );

  const after = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(after.subject, "Carry Subject", "the binding must survive a propose-photos refresh");
  assert.equal(after.leafId, "leaf:carry-photos");
});

test("F-014 / PR #17 review, blocker 1: propose-brain re-run over a PRE-BOUND document preserves the binding", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  await writeFile(leafPath, leafDoc("Carry Subject", "leaf:carry-brain"), "utf8");
  await bindHarvest(harvestPath, leafPath);

  // A minimal REAL vault: copy the shipping retrieval tool, write one throwaway note under the
  // DEFAULT source name ("brain"), and run the real build — the same discipline
  // `brainSource.test.ts` documents ("do not mock what you can run"). Whether the question
  // matches anything is irrelevant to what this test checks: propose-brain reaches its own
  // write step and carries the binding forward whether 0 or 10 candidates are drafted.
  const vaultDir = await tempDir("foliage-propose-carry-vault-");
  for (const entry of ["ask.mjs", "build.mjs", "lib"]) {
    await cp(join(REAL_VAULT_DIR, entry), join(vaultDir, entry), { recursive: true });
  }
  const notesRoot = join(vaultDir, "notes-root", "brain");
  await mkdir(notesRoot, { recursive: true });
  await writeFile(join(notesRoot, "throwaway.md"), "# Nothing in particular\n\nJust a note.\n", "utf8");
  await writeFile(
    join(vaultDir, "sources.json"),
    JSON.stringify({ sources: [{ name: "brain", root: notesRoot }] }),
    "utf8",
  );
  await exec(process.execPath, [join(vaultDir, "build.mjs")], { timeout: 120_000 });

  const rerun = await runHarvest([
    "propose-brain",
    "--about",
    "a question this fixture does not need to answer meaningfully",
    "--vault",
    vaultDir,
    "--out",
    harvestPath,
    "--force",
  ]);
  assert.equal(rerun.status, 0, `propose-brain re-run must succeed:\n${rerun.output}`);
  assert.match(
    rerun.output,
    /binding preserved/,
    `propose-brain must say the binding survived, exactly like propose does:\n${rerun.output}`,
  );

  const after = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(after.subject, "Carry Subject", "the binding must survive a propose-brain refresh");
  assert.equal(after.leafId, "leaf:carry-brain");
});

test("a propose-photos refresh over a harvest holding git drafts keeps every one of them", async () => {
  const garden = await tempDir();
  const harvestPath = join(garden, "harvest.json");
  const repo = await tempDir("foliage-propose-carry-repo-");
  const git = (...args: string[]) => exec("git", ["-C", repo, ...args], { timeout: 30_000 });
  await git("init", "--quiet", "--initial-branch=main");
  await writeFile(join(repo, "a.txt"), "a\n", "utf8");
  await git("add", "a.txt");
  await git("-c", "user.name=Carry Seam", "-c", "user.email=carry@example.test", "commit", "-q", "--no-gpg-sign", "-m", "feat: synthetic input");

  const drafted = await runHarvest(["propose", "--repo", repo, "--identity", "carry@example.test", "--out", harvestPath, "--force"]);
  assert.equal(drafted.status, 0, drafted.output);
  const before = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.deepEqual(before.candidates.map((c: { id: string }) => c.id), ["git-cluster:feat"]);

  const emptyDir = await tempDir("foliage-propose-carry-photos-");
  const rerun = await runHarvest(["propose-photos", "--dir", emptyDir, "--out", harvestPath, "--force"]);
  assert.equal(rerun.status, 0, rerun.output);
  const after = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.deepEqual(after.candidates, before.candidates, "a photo refresh must not erase the git queue");
  assert.equal(after.repo, before.repo);
});
