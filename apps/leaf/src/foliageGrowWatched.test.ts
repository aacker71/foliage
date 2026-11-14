/**
 * `foliage grow` WITH NO ARGUMENTS AND NO USEFUL WORKING DIRECTORY — the case a scheduler creates
 * and a person never does.
 *
 * WHAT THIS PINS. `grow` chose its repository with `value("--repo") ?? process.cwd()`. That is the
 * right answer for somebody standing in a repository typing a command, and a meaningless one under
 * launchd, which starts an agent with no useful cwd. MEASURED before the watched-sources document
 * existed: `foliage install` wrote exactly one agent and it ran `up` — the VIEWER — so nothing in
 * the product ever ran intake on its own and "set it and forget it" produced a page that never
 * changed. These tests run the real `foliage.mjs` from a directory that is not a repository at all,
 * which is the only way to prove the cwd is no longer load-bearing.
 *
 * THE REFUSAL IS THE OTHER HALF, and it is not a limitation this file apologises for. Candidate ids
 * are `git-cluster:<prefix>` — the conventional-commit prefix and nothing else (measured on a real
 * garden: `git-cluster:docs`, `git-cluster:chore`, `git-cluster:canopy`). Two repositories that
 * both carry `docs:` commits collide on one id and merge unrelated projects into a single
 * candidate. Qualifying the id by source is the fix and cannot be done quietly, because
 * `reviewSubjectDigest` hashes the id itself: every existing decision's digest changes with it and
 * every decision reopens. Refusing costs a message; guessing costs somebody's review work.
 *
 * ISOLATION: every spawn points `GIT_CONFIG_GLOBAL` at a file this test wrote and `HOME` at a temp
 * directory, so nothing here depends on the developer's own `~/.gitconfig` or real garden.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const FOLIAGE_CLI = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix = "foliage-grow-watched-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

/**
 * A real repository with one real commit, and its own identity — never the developer's.
 *
 * THE FILE'S CONTENT IS THE REPOSITORY'S OWN PATH, never a constant. Two fixtures built with the
 * same subject and identity within one wall-clock second — git's timestamp granularity — used to
 * produce IDENTICAL commit shas from identical trees, so two "different" repositories were one
 * repository twice over, and a test that harvested the second after the first merged by id in
 * place and proved nothing. The round-3 review reintroduced the round-2 defect and ran the refusal
 * test 13 times: it caught the defect 3 times. A path from mkdtemp is unique per call, so the blob,
 * the tree and the sha are too, whatever the clock says.
 */
async function repoWithCommit(subject: string, email: string, name: string): Promise<string> {
  const repo = await tempDir("foliage-grow-watched-repo-");
  await exec("git", ["init", "--quiet", "--initial-branch=main", repo], { timeout: 30_000 });
  await exec("git", ["-C", repo, "config", "user.email", email], { timeout: 30_000 });
  await exec("git", ["-C", repo, "config", "user.name", name], { timeout: 30_000 });
  await writeFile(join(repo, "f.txt"), repo, "utf8");
  await exec("git", ["-C", repo, "add", "f.txt"], { timeout: 30_000 });
  await exec("git", ["-C", repo, "commit", "--quiet", "-m", subject], { timeout: 30_000 });
  return repo;
}

async function emptyGlobalConfig(): Promise<string> {
  const path = join(await tempDir(), "machine-gitconfig");
  await writeFile(path, "", "utf8");
  return path;
}


/** A repository with TWO commits sharing one prefix — the minimum a cluster needs to be drafted. */
async function repoWithCluster(prefix: string, email: string, name: string): Promise<string> {
  const dir = await repoWithCommit(`${prefix}: the first piece`, email, name);
  await writeFile(join(dir, "second.txt"), dir, "utf8");
  await exec("git", ["-C", dir, "add", "second.txt"], { timeout: 30_000 });
  await exec("git", ["-C", dir, "commit", "--quiet", "-m", `${prefix}: the second piece`], { timeout: 30_000 });
  return dir;
}

interface Run {
  readonly status: number;
  readonly output: string;
}

/**
 * Run the real CLI from `cwd`, with a temp HOME and an empty global git config.
 *
 * `cwd` defaults to the OS temp directory — deliberately NOT a git repository, so any test that
 * passes here passes because the watched list answered, not because the working directory did.
 */
async function foliage(args: readonly string[], opts: { readonly cwd?: string } = {}): Promise<Run> {
  const home = await tempDir("foliage-grow-watched-home-");
  try {
    const { stdout, stderr } = await exec(process.execPath, [FOLIAGE_CLI, ...args], {
      encoding: "utf8",
      timeout: 120_000,
      cwd: opts.cwd ?? tmpdir(),
      env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: await emptyGlobalConfig(), NO_COLOR: "1" },
    });
    return { status: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

test("grow with no --repo, from a directory that is not a repository, reads the watched source", async () => {
  const garden = await tempDir("foliage-grow-watched-garden-");
  // THE REPOSITORY'S OWN GIT CONFIG DELIBERATELY DISAGREES WITH THE SOURCE. An earlier draft of
  // this test gave both the same address, so it passed even with the source-identity lookup
  // deleted — the git-config fallback produced the same string and the assertion proved nothing.
  // Mutation caught it. Now only the watched source can supply these two values, so the assertions
  // below fail the moment `grow` stops reading it.
  const repo = await repoWithCommit("feat: the watched work", "gitconfig@example.com", "Gitconfig Person");

  const watched = await foliage([
    "watch",
    repo,
    "--subject",
    "Watched Person",
    "--identity",
    "watched@example.com",
    "--garden",
    garden,
  ]);
  assert.equal(watched.status, 0, watched.output);

  // The whole point: cwd is the OS temp directory, which is not a git repository. Before the
  // watched list existed this run would have read `process.cwd()` and failed there.
  const grown = await foliage(["grow", "--garden", garden]);
  assert.equal(grown.status, 0, grown.output);
  // git reports the CANONICAL toplevel (/private/var/… on macOS), so the assertion compares that
  // rather than the spelling the test happened to create — the same fact foliageGarden.test.ts
  // documents about process.cwd() and realpath.
  const canonical = (await exec("git", ["-C", repo, "rev-parse", "--show-toplevel"], { timeout: 30_000 })).stdout.trim();
  assert.match(grown.output, new RegExp(`REPO\\s+${canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  // From the SOURCE — not from a prompt, and not from the repository's git config, which says
  // something else entirely. This is what makes the run possible with nobody watching.
  assert.match(grown.output, /Watched Person/);
  assert.match(grown.output, /watched@example\.com/);
  assert.doesNotMatch(grown.output, /Gitconfig Person/);
  assert.doesNotMatch(grown.output, /gitconfig@example\.com/);
});

test("an explicit --repo still wins over the watched list", async () => {
  const garden = await tempDir("foliage-grow-watched-garden-");
  const watchedRepo = await repoWithCommit("feat: watched", "watched@example.com", "Watched Person");
  const namedRepo = await repoWithCommit("feat: named", "named@example.com", "Named Person");

  await foliage(["watch", watchedRepo, "--garden", garden]);
  const grown = await foliage(["grow", "--repo", namedRepo, "--identity", "named@example.com", "--garden", garden]);
  assert.equal(grown.status, 0, grown.output);
  assert.match(grown.output, new RegExp(namedRepo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(grown.output, new RegExp(watchedRepo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("two watched sources REFUSE rather than merge unrelated projects into one candidate", async () => {
  const garden = await tempDir("foliage-grow-watched-garden-");
  const first = await repoWithCommit("docs: the first project", "both@example.com", "Both Person");
  const second = await repoWithCommit("docs: the second project", "both@example.com", "Both Person");

  await foliage(["watch", first, "--garden", garden]);
  await foliage(["watch", second, "--garden", garden]);

  const grown = await foliage(["grow", "--garden", garden]);
  assert.equal(grown.status, 2, grown.output);
  assert.match(grown.output, /2 watched sources, and grow can only read one/);
  // The refusal has to NAME the mechanism, or it reads as an arbitrary limit somebody will remove.
  assert.match(grown.output, /candidate ids are the commit prefix alone/);
  assert.match(grown.output, /reopens every decision already made/);
  // …and it must name the way out, both of them.
  assert.match(grown.output, /foliage\.mjs' 'grow' '--garden' '[^']+' --repo <path>/);
  assert.match(grown.output, /foliage\.mjs' 'unwatch' '--garden' '[^']+' <path>/);
});

test("watching nothing keeps the old behaviour — the working directory", async () => {
  // The change must not break the person standing in a repository typing `foliage grow`. With an
  // empty watched list the cwd still answers, exactly as before.
  const garden = await tempDir("foliage-grow-watched-garden-");
  const repo = await repoWithCommit("feat: standing here", "here@example.com", "Here Person");

  const grown = await foliage(["grow", "--garden", garden], { cwd: repo });
  assert.equal(grown.status, 0, grown.output);
  assert.match(grown.output, new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(grown.output, /Here Person/);
});

test("a watched source does NOT hijack a grow typed inside a different repository", async () => {
  /*
   * THE UNTESTED QUADRANT, found by the three-pass review and reproduced by it. The first draft
   * chose `watched[0]?.path ?? process.cwd()`, so once anything was watched, `foliage grow` typed
   * INSIDE another repository silently harvested the watched one instead — and the redirected
   * `propose --force` replaced the queue, taking that repository's already-APPROVED decisions with
   * it. Measured: the approval was present on the base branch after the same three steps and gone
   * after this one, so the loss was introduced by this change.
   *
   * The suite covered watched+non-repo-cwd and empty+repo-cwd, and never watched+other-repo-cwd.
   * That gap is this test.
   */
  const garden = await tempDir("foliage-grow-watched-garden-");
  const watchedRepo = await repoWithCommit("feat: the watched work", "watched@example.com", "Watched Person");
  const standingIn = await repoWithCommit("docs: where the person is standing", "here@example.com", "Here Person");

  await foliage(["watch", watchedRepo, "--garden", garden]);

  const grown = await foliage(["grow", "--garden", garden], { cwd: standingIn });
  assert.equal(grown.status, 0, grown.output);
  assert.match(
    grown.output,
    new RegExp(standingIn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "grow must harvest the repository the person is standing in",
  );
  assert.doesNotMatch(
    grown.output,
    new RegExp(watchedRepo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the watched source hijacked a grow typed inside another repository",
  );
});

test("a garden refuses to discard decisions made about a DIFFERENT repository", async () => {
  /*
   * A garden holds ONE harvest, and `propose --force` writes the set this run drafted. Harvesting a
   * different repository replaces the queue — and because candidate ids are the commit prefix
   * alone, an id from repository A COLLIDES with a decided one from repository B: the id survives,
   * the digest differs, and the decision is silently reopened. MEASURED before the guard: an
   * approval made against B came back as an undecided candidate after a harvest of A.
   *
   * The discriminator is the REPOSITORY, not the reopen — a reopen is legitimate whenever the same
   * repository's material changed, which is what an unattended re-harvest does every time. The
   * harvest now records where it was drafted from, and this is the guard that reads it.
   */
  const garden = await tempDir("foliage-grow-watched-garden-");
  const theirs = await repoWithCluster("docs", "me@example.com", "Me");
  const other = await repoWithCluster("docs", "me@example.com", "Me");

  const first = await foliage(["grow", "--repo", theirs, "--identity", "me@example.com", "--garden", garden], { cwd: theirs });
  assert.equal(first.status, 0, first.output);

  const harvestPath = join(garden, "harvest.json");
  const drafted = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.ok(drafted.candidates.length > 0, "the fixture must draft at least one candidate");
  // The document records where it came from — without that, the guard below cannot exist.
  assert.equal(typeof drafted.repo, "string", "propose must record the repository it drafted from");

  const decided = { ...drafted };
  decided.candidates = drafted.candidates.map((c: { review: unknown }, i: number) =>
    i === 0 ? { ...c, review: { state: "approved", by: "Me", at: "2026-09-04T00:00:00.000Z" } } : c,
  );
  await writeFile(harvestPath, JSON.stringify(decided), "utf8");
  const harvestBefore = await readFile(harvestPath, "utf8");

  const clobber = await foliage(["grow", "--repo", other, "--identity", "me@example.com", "--garden", garden], { cwd: other });
  assert.equal(clobber.status, 3, `harvesting another repository must refuse:\n${clobber.output}`);
  assert.match(clobber.output, /REFUSED — this garden's queue holds 1 decision/);
  assert.match(clobber.output, /was NOT changed/);
  assert.match(clobber.output, /the queue was drafted from/);
  // The way on is another garden. Finishing this queue frees nothing, so it is not offered.
  assert.match(clobber.output, /deciding that queue does not free\n.*the garden for another/);
  assert.match(clobber.output, /grow --repo .* --garden <another dir>/);
  assert.doesNotMatch(clobber.output, /finish the queue/);

  // "was NOT changed" is a claim about the whole file, so the whole file is what is compared.
  assert.equal(await readFile(harvestPath, "utf8"), harvestBefore, "the refused run rewrote harvest.json");
});

test("a garden keeps another repository's UNDECIDED drafts the same way it keeps its decisions: refused, named, nothing changed", async () => {
  /*
   * MEASURED (0.3.0 retest): grow --repo A drafted one candidate, nobody decided it yet, and
   * grow --repo B into the same garden replaced it. The guard counted only decisions, and the git
   * merge withdraws a draft whose commits this repository does not hold, so A's draft went without
   * a word and the output named only B's. A draft waiting for a decision is the person's queue too.
   */
  const garden = await tempDir("foliage-grow-watched-garden-");
  const first = await repoWithCluster("docs", "me@example.com", "Me");
  const second = await repoWithCluster("feat", "me@example.com", "Me");

  const grown = await foliage(["grow", "--repo", first, "--identity", "me@example.com", "--garden", garden], { cwd: first });
  assert.equal(grown.status, 0, grown.output);
  const harvestPath = join(garden, "harvest.json");
  const leafPath = join(garden, "leaf.json");
  const drafted = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.deepEqual(
    drafted.candidates.map((c: { id: string; review: { state: string } }) => [c.id, c.review.state]),
    [["git-cluster:docs", "candidate"]],
    "the fixture drafts exactly one undecided candidate",
  );
  const harvestBefore = await readFile(harvestPath, "utf8");
  const leafBefore = await readFile(leafPath, "utf8");

  const other = await foliage(["grow", "--repo", second, "--identity", "me@example.com", "--garden", garden], { cwd: second });
  assert.equal(other.status, 3, `growing another repository must refuse:\n${other.output}`);
  assert.match(other.output, /REFUSED — this garden's queue holds 1 draft\(s\) waiting for your decision about/);
  assert.match(other.output, /git-cluster:docs — candidate/);
  assert.match(other.output, /was NOT changed/);
  assert.equal(await readFile(harvestPath, "utf8"), harvestBefore, "the refused run rewrote harvest.json");
  assert.equal(await readFile(leafPath, "utf8"), leafBefore, "the refused run rewrote leaf.json");
  assert.doesNotMatch(other.output, /finish the queue/, "the refusal must not send the person to a step that cannot unblock them");

  // MEASURED (review of this branch): the refusal used to say "or finish the queue you have at
  // /review", and following it led straight back here. Deciding the draft does not free the garden
  // for another repository, and the refusal now says so and names the way that works.
  await exec(process.execPath, [HARVEST_CLI, "approve", "git-cluster:docs", "--by", "Me", "--doc", harvestPath], { timeout: 60_000 });
  const decided = await foliage(["grow", "--repo", second, "--identity", "me@example.com", "--garden", garden], { cwd: second });
  assert.equal(decided.status, 3, decided.output);
  assert.match(decided.output, /holds 1 decision\(s\) you made about/);
  assert.match(decided.output, /deciding that queue does not free\n.*the garden for another/);
  assert.ok(decided.output.includes(`grow --repo '${await realpath(second)}' --garden <another dir>`), decided.output);
  assert.doesNotMatch(decided.output, /finish the queue/);
});

test("a repository moved before anything was decided still grows into its garden: the queue's own commits say it is the same one", async () => {
  /*
   * MEASURED (review of this branch): grow A, then `mv A A2`, then grow A2. The queue holds a draft
   * waiting for a decision, the recorded folder A is gone, so the repository check could not read
   * it and refused every later grow with no way out. That is the ordinary state right after a first
   * grow, and the RC grows it. A2 holds every commit the queue names, so it is the same repository:
   * the draft is kept and the garden records the new folder.
   */
  const garden = await tempDir("foliage-grow-watched-garden-");
  const first = await repoWithCluster("docs", "me@example.com", "Me");
  const grown = await foliage(["grow", "--repo", first, "--identity", "me@example.com", "--garden", garden], { cwd: first });
  assert.equal(grown.status, 0, grown.output);
  const harvestPath = join(garden, "harvest.json");
  const queue = (doc: { candidates: { id: string; review: { state: string }; evidence: { ref: string }[] }[] }) =>
    doc.candidates.map((c) => [c.id, c.review.state, c.evidence.map((e) => e.ref)]);
  const drafted = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.deepEqual(queue(drafted).map(([id, state]) => [id, state]), [["git-cluster:docs", "candidate"]], "one draft waits");

  const moved = `${first}-moved`;
  tmpRoots.push(moved);
  await rename(first, moved);
  const again = await foliage(["grow", "--repo", moved, "--identity", "me@example.com", "--garden", garden], { cwd: moved });
  assert.equal(again.status, 0, `a moved repository must still grow:\n${again.output}`);
  assert.match(again.output, /this garden's queue was drafted from .*, which cannot be read now/);
  assert.match(again.output, /holds every commit in that queue/);
  const regrown = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.deepEqual(queue(regrown), queue(drafted), "the waiting draft is kept as it was");
  assert.equal(await realpath(regrown.repo), await realpath(moved), "the garden records the new folder");

  // A queue holding a decision is not carried to a folder that cannot be checked: the RC's refusal
  // stands (oneQueue.seam.test.ts), and now names the way back, which works.
  await exec(process.execPath, [HARVEST_CLI, "approve", "git-cluster:docs", "--by", "Me", "--doc", harvestPath], { timeout: 60_000 });
  const approved = await readFile(harvestPath, "utf8");
  const renamed = `${first}-renamed`;
  tmpRoots.push(renamed);
  await rename(moved, renamed);
  const decided = await foliage(["grow", "--repo", renamed, "--identity", "me@example.com", "--garden", garden], { cwd: renamed });
  assert.equal(decided.status, 3, decided.output);
  assert.match(decided.output, /REFUSED — cannot check that /);
  assert.ok(decided.output.includes(`foliage: if that repository moved, move it back to ${regrown.repo} and grow it there.\n`), decided.output);
  assert.equal(await readFile(harvestPath, "utf8"), approved, "the refused run rewrote harvest.json");
  await rename(renamed, moved);
  const back = await foliage(["grow", "--repo", moved, "--identity", "me@example.com", "--garden", garden], { cwd: moved });
  assert.equal(back.status, 0, back.output);
  const kept = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.deepEqual(queue(kept).map(([id, state]) => [id, state]), [["git-cluster:docs", "approved"]], "the decision is kept");
});

test("a queue whose repository is gone refuses a repository that does not hold its commits, says what to do, and changes nothing", async () => {
  const garden = await tempDir("foliage-grow-watched-garden-");
  const first = await repoWithCluster("docs", "me@example.com", "Me");
  const second = await repoWithCluster("feat", "me@example.com", "Me");
  const grown = await foliage(["grow", "--repo", first, "--identity", "me@example.com", "--garden", garden], { cwd: first });
  assert.equal(grown.status, 0, grown.output);
  const harvestPath = join(garden, "harvest.json");
  const leafPath = join(garden, "leaf.json");
  const from = JSON.parse(await readFile(harvestPath, "utf8")).repo;
  const elsewhere = `${first}-elsewhere`;
  tmpRoots.push(elsewhere);
  await rename(first, elsewhere);
  const harvestBefore = await readFile(harvestPath, "utf8");
  const leafBefore = await readFile(leafPath, "utf8");

  const other = await foliage(["grow", "--repo", second, "--identity", "me@example.com", "--garden", garden], { cwd: second });
  assert.equal(other.status, 3, other.output);
  assert.match(other.output, /REFUSED — cannot check that .* is the repository this garden's queue/);
  assert.match(other.output, /does not hold every commit in the queue/);
  assert.ok(other.output.includes(`foliage: if that repository moved, move it back to ${from} and grow it there.\n`), other.output);
  assert.ok(other.output.includes(`grow --repo '${await realpath(second)}' --garden <another dir>`), other.output);
  assert.equal(await readFile(harvestPath, "utf8"), harvestBefore, "the refused run rewrote harvest.json");
  assert.equal(await readFile(leafPath, "utf8"), leafBefore, "the refused run rewrote leaf.json");
});

test("the SAME repository still re-harvests, decisions and all — the guard must not refuse the ordinary case", async () => {
  // A guard that also refuses the legitimate case is a guard that gets deleted. An unattended
  // re-harvest of the watched repository is the whole product, so it must pass.
  const garden = await tempDir("foliage-grow-watched-garden-");
  const mine = await repoWithCluster("docs", "me@example.com", "Me");

  const first = await foliage(["grow", "--repo", mine, "--identity", "me@example.com", "--garden", garden], { cwd: mine });
  assert.equal(first.status, 0, first.output);

  const again = await foliage(["grow", "--repo", mine, "--identity", "me@example.com", "--garden", garden], { cwd: mine });
  assert.equal(again.status, 0, `the same repository must re-harvest:\n${again.output}`);
  assert.doesNotMatch(again.output, /REFUSED/);
});

test("the REFUSAL leaves leaf.json alone too, not just the harvest", async () => {
  /*
   * Measured by the review: the guard used to run AFTER `intake --force`, so a run that printed
   * "REFUSED — harvest.json was NOT changed" had already merged the other repository's leaflets
   * into leaf.json — the employer-facing document — permanently, and said nothing about it. A
   * refusal true about one file and silent about the one it just changed is worse than none.
   *
   * THE WHOLE FILE IS COMPARED, not a count. An earlier draft compared `leaflets.length`, and the
   * two fixtures shared every sha (see `repoWithCommit`), so `intake --force` merged by id in place:
   * the count held while the document was rewritten from the wrong repository, and the test passed
   * with the defect it names put back.
   */
  const garden = await tempDir("foliage-grow-watched-garden-");
  const mine = await repoWithCluster("docs", "me@example.com", "Me");
  const other = await repoWithCluster("docs", "me@example.com", "Me");

  await foliage(["grow", "--repo", mine, "--identity", "me@example.com", "--garden", garden], { cwd: mine });
  const harvestPath = join(garden, "harvest.json");
  const drafted = JSON.parse(await readFile(harvestPath, "utf8"));
  drafted.candidates[0].review = { state: "approved", by: "Me", at: "2026-09-04T00:00:00.000Z" };
  await writeFile(harvestPath, JSON.stringify(drafted), "utf8");

  const leafPath = join(garden, "leaf.json");
  const before = await readFile(leafPath, "utf8");

  const refused = await foliage(["grow", "--repo", other, "--identity", "me@example.com", "--garden", garden], { cwd: other });
  assert.equal(refused.status, 3, refused.output);

  assert.equal(await readFile(leafPath, "utf8"), before, "the refused run still contaminated leaf.json with the other repository's work");
});

test("a subdirectory of the watched repository is not 'a different repository'", async () => {
  // The cwd branch used to record `process.cwd()` rather than the repository toplevel, so running
  // from any subdirectory was compared against the recorded toplevel and refused as a different
  // tree. `git rev-parse --show-toplevel` answers this, and answers it the same from both places.
  //
  // A DECISION MUST EXIST FIRST, or the comparison never runs: the guard only compares paths when
  // the queue holds one, and an earlier draft of this test approved nothing — so it passed with the
  // naive `existsSync(join(path, ".git"))` lookup put back, proving only that git discovers upward.
  const garden = await tempDir("foliage-grow-watched-garden-");
  const mine = await repoWithCluster("docs", "me@example.com", "Me");
  await foliage(["grow", "--repo", mine, "--identity", "me@example.com", "--garden", garden], { cwd: mine });
  const harvestPath = join(garden, "harvest.json");
  const drafted = JSON.parse(await readFile(harvestPath, "utf8"));
  drafted.candidates[0].review = { state: "approved", by: "Me", at: "2026-09-04T00:00:00.000Z" };
  await writeFile(harvestPath, JSON.stringify(drafted), "utf8");

  const sub = join(mine, "sub");
  await mkdir(sub, { recursive: true });
  const fromSub = await foliage(["grow", "--identity", "me@example.com", "--garden", garden], { cwd: sub });
  assert.equal(fromSub.status, 0, `a subdirectory must resolve to the same repository:\n${fromSub.output}`);
  assert.doesNotMatch(fromSub.output, /REFUSED/);
});

test("grow refuses a sources document `foliage sources` would refuse — from a non-repo cwd, no --repo — and writes nothing", async () => {
  // Before this, `grow`'s watched-list read bypassed `parseSourcesDocument` entirely: a document
  // the parser refuses (here, a relative path — the very defect the format exists to remove) was
  // read raw and harvested anyway. This exercises the FIRST read site: repo undefined, cwd not a
  // repository, so the watched list is consulted before anything else.
  const garden = await tempDir("foliage-grow-watched-garden-");
  await mkdir(garden, { recursive: true });
  await writeFile(
    join(garden, "sources.json"),
    JSON.stringify({ sources: [{ kind: "git", path: "relative/path", subject: "X", identities: ["a@b.com"], addedAt: "2026-01-01T00:00:00.000Z" }] }),
    "utf8",
  );
  const grown = await foliage(["grow", "--garden", garden]);
  assert.equal(grown.status, 2, grown.output);
  assert.match(grown.output, /is not a valid sources document/);
  assert.match(grown.output, /an ABSOLUTE path/);
  assert.equal(existsSync(join(garden, "harvest.json")), false, "a refused sources document must not be harvested");
  assert.equal(existsSync(join(garden, "leaf.json")), false, "a refused sources document must not be harvested");
});

test("grow refuses a sources document `foliage sources` would refuse even with an explicit --repo — the identity lookup reads it too", async () => {
  // The SECOND read site: once `repo` is settled (here, explicitly, so the first site is never
  // reached), `grow` still reads the watched list to match a source's declared identities. A bad
  // document must refuse there too, not just when it is the thing choosing the repository.
  const garden = await tempDir("foliage-grow-watched-garden-");
  const repo = await repoWithCommit("feat: named work", "named@example.com", "Named Person");
  await writeFile(join(garden, "sources.json"), "{ not json", "utf8");
  const grown = await foliage(["grow", "--repo", repo, "--identity", "named@example.com", "--garden", garden]);
  assert.equal(grown.status, 2, grown.output);
  assert.match(grown.output, /is not valid JSON/);
  assert.equal(existsSync(join(garden, "harvest.json")), false, "a refused sources document must not be harvested");
});

test("grow typed inside a repository still works when several sources are watched", async () => {
  // The ">1 watched" refusal used to be evaluated BEFORE the working-directory test, so a person
  // standing in a real repository was refused with exit 2 the moment a second source was watched —
  // behaviour that works on the base branch. The cwd is asked first now.
  const garden = await tempDir("foliage-grow-watched-garden-");
  const standingIn = await repoWithCluster("docs", "me@example.com", "Me");
  const one = await repoWithCluster("feat", "me@example.com", "Me");
  const two = await repoWithCluster("chore", "me@example.com", "Me");
  await foliage(["watch", one, "--garden", garden]);
  await foliage(["watch", two, "--garden", garden]);

  const grown = await foliage(["grow", "--identity", "me@example.com", "--garden", garden], { cwd: standingIn });
  assert.equal(grown.status, 0, `standing in a repository must win over the watched list:\n${grown.output}`);
  assert.match(grown.output, new RegExp(standingIn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("scheduled grow reads the watched source even when its garden sits inside another repository", async () => {
  const enclosing = await repoWithCommit("chore: enclosing work", "enclosing@example.com", "Enclosing Person");
  const watched = await repoWithCluster("feat", "watched@example.com", "Watched Person");
  const garden = join(enclosing, "garden");
  const registered = await foliage(["watch", watched, "--garden", garden]);
  assert.equal(registered.status, 0, registered.output);

  const grown = await foliage(["grow", "--watched", "--garden", garden], { cwd: garden });
  assert.equal(grown.status, 0, grown.output);
  const harvest = JSON.parse(await readFile(join(garden, "harvest.json"), "utf8"));
  const source = JSON.parse(await readFile(join(garden, "sources.json"), "utf8")).sources[0];
  assert.equal(harvest.repo, source.path, "the scheduled harvest must record the watched repository");
  const leaf = JSON.parse(await readFile(join(garden, "leaf.json"), "utf8"));
  assert.equal(leaf.subject, "Watched Person");
  assert.equal(leaf.leaflets.length, 2);
  assert.ok(leaf.leaflets.every((l: { title: string }) => l.title.startsWith("feat:")));
  assert.doesNotMatch(grown.output, /Enclosing Person|enclosing@example\.com/);
});

test("scheduled grow with no watched source refuses without harvesting its working directory", async () => {
  const enclosing = await repoWithCommit("chore: enclosing work", "enclosing@example.com", "Enclosing Person");
  const garden = join(enclosing, "garden");
  await mkdir(garden);
  const grown = await foliage(["grow", "--watched", "--garden", garden], { cwd: garden });
  assert.equal(grown.status, 2, grown.output);
  assert.match(grown.output, /no watched source/);
  assert.equal(existsSync(join(garden, "leaf.json")), false);
  assert.equal(existsSync(join(garden, "harvest.json")), false);
});
