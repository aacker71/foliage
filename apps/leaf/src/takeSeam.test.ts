/**
 * TAKE.SH, END TO END — the real bash script, spawned as a real subprocess, with a simulated
 * $HOME. `pnpm check` runs no shell tests (the `test` script globs `*.test.ts`/`*.test.mjs`
 * only), so `.loop/demo/takes/take.sh`'s live-garden refusal had NO automated coverage at all —
 * a regression re-opening the write into `~/.foliage` would pass 1406/1406 silently. This file
 * closes that (three-pass review, round 3).
 *
 * WHAT THIS DRIVES AND WHY: take.sh, not a helper extracted from it — the defect classes found
 * here (a `shift 2` that fails silently and re-matches the same flag forever; a live-garden
 * check that ran on an unresolved string) are properties of the SCRIPT's own control flow, not
 * of any function it calls. A unit test around a hypothetical `resolveDir()` port would have
 * passed against the broken shell this suite was written to catch.
 *
 * bash IS THE THING UNDER TEST, not an implementation detail this file can route around: bash
 * 3.2 (macOS's actual `/bin/bash`) is the SAME question `sipsRuns()` asks in `mediaSeam.test.ts`
 * before trusting `sips` — asked again here for the same reason. On a machine with bash, every
 * assertion below runs for real; on one without it, each test names that honestly via
 * `t.skip(...)` (visible in the report, never silently absent) instead of asserting anything.
 *
 * A NO-VALUE FLAG MUST FAIL FAST, NOT HANG: the busy-loop this file guards against pegs one CPU
 * core forever with zero output, so every spawn below carries an explicit `timeout` — a test
 * that regresses this must be KILLED and FAIL, never block the rest of `pnpm check`.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const TAKE_SH = fileURLToPath(new URL("../../../.loop/demo/takes/take.sh", import.meta.url));
const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  tmpRoots.push(dir);
  return dir;
}

/** The same question asked of `sips` in `mediaSeam.test.ts`'s `sipsRuns()` — ask, never assume. */
async function bashRuns(): Promise<boolean> {
  try {
    await exec("bash", ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

interface CliResult {
  readonly status: number;
  readonly output: string;
}

/** A tiny, throwaway git repo — take.sh's own `--repo` needs one to read history from, and this
 * keeps every test independent of this checkout's own (much larger, much slower) git log.
 * `commits` beyond the first is for the one test that needs harvest.mjs's git-cluster extractor
 * to actually DRAFT a candidate: it drafts nothing until a subject's own prefix cluster reaches
 * 2 commits ("no prefix cluster of this subject's own commits reached 2"), which a single commit
 * — the default, and all every other test here needs — never reaches. */
async function tinyRepo(commits = 1): Promise<string> {
  const repo = await tempDir("take-seam-repo-");
  const run = (args: readonly string[]) => exec("git", args, { cwd: repo, timeout: 10_000 });
  await exec("git", ["init", "--quiet", "--initial-branch=main", repo], { timeout: 10_000 });
  await run(["config", "user.email", "seam@example.test"]);
  await run(["config", "user.name", "Seam Test"]);
  await writeFile(join(repo, "README.md"), "take-seam fixture\n", "utf8");
  await run(["add", "README.md"]);
  await run(["commit", "--quiet", "-m", "seed"]);
  for (let i = 2; i <= commits; i++) {
    await writeFile(join(repo, `file-${String(i)}.md`), `take-seam fixture ${String(i)}\n`, "utf8");
    await run(["add", `file-${String(i)}.md`]);
    await run(["commit", "--quiet", "-m", `take-seam fixture commit ${String(i)}`]);
  }
  return repo;
}

/** Spawn the real take.sh under a simulated HOME. `timeoutMs` defaults to the busy-loop's own
 * `timeout 5` (the exact reproduction the review used) so a regression is killed fast, never
 * hung for the rest of the suite; callers driving a real `grow` pass a longer one. */
async function runTake(
  args: readonly string[],
  opts: { readonly home: string; readonly cwd?: string; readonly timeoutMs?: number },
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await exec(TAKE_SH, args, {
      encoding: "utf8",
      timeout: opts.timeoutMs ?? 5_000,
      cwd: opts.cwd,
      env: { ...process.env, HOME: opts.home, NO_COLOR: "1" },
    });
    return { status: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; killed?: boolean; signal?: string | null; stdout?: string; stderr?: string };
    if (e.killed === true) {
      throw new Error(
        `take.sh ${args.join(" ")} did not exit within ${String(opts.timeoutMs ?? 5_000)}ms and was killed by signal ` +
          `${String(e.signal)} — this is the busy-loop shape this suite exists to catch, not a slow command.`,
      );
    }
    return { status: e.code ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

test("a relative --garden from inside a simulated ~/.foliage is REFUSED, and nothing is created", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  const home = await tempDir("take-seam-home-");
  const liveGarden = join(home, ".foliage");
  await mkdir(liveGarden, { recursive: true });
  const repo = await tinyRepo();

  // THE EXACT REPRODUCTION: cwd is already inside the live garden, --garden is a bare relative
  // string with no directory of that name yet on disk — the shape that used to resolve on its
  // literal text and slip past the live-garden check (PR #15 review, round 1).
  const result = await runTake(["--repo", repo, "--identity", "seam@example.test", "--garden", "newsubdir"], {
    home,
    cwd: liveGarden,
    timeoutMs: 15_000,
  });
  assert.notEqual(result.status, 0, `must refuse, not proceed:\n${result.output}`);
  assert.match(result.output, /REFUSED/, `must say REFUSED:\n${result.output}`);
  assert.equal(
    existsSync(join(liveGarden, "newsubdir")),
    false,
    "the live garden must gain nothing — not even an empty directory",
  );
});

test("every flag that takes a value fails FAST with a usage error when given no value, never hangs", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  const home = await tempDir("take-seam-home-");
  // Each case is the flag as the LAST argument, nothing after it — the exact shape whose
  // `shift 2` used to fail silently and re-match the same "$1" forever (100% CPU, zero output,
  // `timeout 5` → exit 124 on every one of these six, three-pass review round 3).
  const cases: { readonly args: readonly string[]; readonly flag: string }[] = [
    { args: ["--repo"], flag: "--repo" },
    { args: ["--identity"], flag: "--identity" },
    { args: ["--subject"], flag: "--subject" },
    { args: ["--garden"], flag: "--garden" },
    { args: ["promote", "--doc"], flag: "--doc" },
    { args: ["promote", "--into"], flag: "--into" },
  ];
  for (const { args, flag } of cases) {
    const result = await runTake(args, { home, timeoutMs: 5_000 });
    assert.notEqual(result.status, 0, `${flag} with no value must refuse, not hang or succeed:\n${result.output}`);
    assert.match(result.output, new RegExp(`\\${flag} needs a value`), `${flag}'s own name must be in the message:\n${result.output}`);
  }
});

test("promote refuses when both files resolve into a simulated ~/.foliage", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  // Round 10 added a SEPARATE, same-garden-directory rule (below) that runs BEFORE this one and
  // refuses any cross-directory --doc/--into outright — so "only one of the two flags is in the
  // live garden" is no longer independently reachable: that shape is ALWAYS cross-directory
  // (the live garden and any legitimate take-garden are never the same directory), and the
  // same-garden rule catches it first. What remains reachable, and still real, is both flags
  // sharing the live garden itself.
  const home = await tempDir("take-seam-home-");
  const liveGarden = join(home, ".foliage");
  await mkdir(liveGarden, { recursive: true });

  const result = await runTake(
    ["promote", "--doc", join(liveGarden, "harvest.json"), "--into", join(liveGarden, "leaf.json")],
    { home },
  );
  assert.notEqual(result.status, 0, `both files at the live garden must refuse:\n${result.output}`);
  assert.match(result.output, /REFUSED/, result.output);
  assert.match(
    result.output,
    /live garden/,
    `must say why specifically — the live garden, not just the same-garden rule:\n${result.output}`,
  );
});

test("FALSE-POSITIVE CONTROL: a --garden that is NOT the live garden is allowed and actually grows", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  const home = await tempDir("take-seam-home-");
  const work = await tempDir("take-seam-work-");
  const repo = await tinyRepo();
  const garden = join(work, "legit-take");

  const result = await runTake(
    ["--repo", repo, "--identity", "seam@example.test", "--garden", garden],
    { home, cwd: work, timeoutMs: 30_000 },
  );
  assert.equal(result.status, 0, `a real, non-live --garden must be allowed:\n${result.output}`);
  assert.doesNotMatch(result.output, /REFUSED/, result.output);
  assert.ok(existsSync(join(garden, "leaf.json")), "a real grow must write leaf.json into the legit garden");
});

test("a legitimate `take.sh promote` actually grows the leaf by the approved candidate", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  // Every OTHER test here only proves take.sh REFUSES correctly; none of them drives it through
  // the one place it actually execs harvest.mjs promote. This one binds through the real
  // pipeline start to finish: grow a real take-garden, approve the one candidate it drafts,
  // promote through take.sh itself, and check the leaf for the leaflet that promotion — not
  // intake — is responsible for adding.
  const home = await tempDir("take-seam-home-");
  const work = await tempDir("take-seam-work-");
  const repo = await tinyRepo(2); // 2 commits: enough for git-cluster to draft one candidate
  const garden = join(work, "legit-take");

  const grown = await runTake(["--repo", repo, "--identity", "seam@example.test", "--garden", garden], {
    home,
    cwd: work,
    timeoutMs: 30_000,
  });
  assert.equal(grown.status, 0, `grow must succeed:\n${grown.output}`);

  const harvestPath = join(garden, "harvest.json");
  const leafPath = join(garden, "leaf.json");
  const harvest = JSON.parse(await readFile(harvestPath, "utf8")) as { candidates: { id: string }[] };
  assert.equal(harvest.candidates.length, 1, `expected exactly one drafted candidate:\n${JSON.stringify(harvest)}`);
  const candidateId = harvest.candidates[0]?.id;
  assert.ok(candidateId, "the drafted candidate must carry an id");

  const before = JSON.parse(await readFile(leafPath, "utf8")) as { leaflets: { id: string }[] };
  const beforeIds = new Set(before.leaflets.map((l) => l.id));
  assert.ok(!beforeIds.has(candidateId), "the candidate must not already be in the leaf before promotion");

  const approved = await exec(
    process.execPath,
    [HARVEST_CLI, "approve", candidateId, "--by", "A Reviewer", "--doc", harvestPath],
    { timeout: 15_000 },
  );
  assert.match(approved.stdout, /approved by A Reviewer/, approved.stdout);

  const promoted = await runTake(["promote", "--doc", harvestPath, "--into", leafPath], { home, timeoutMs: 15_000 });
  assert.equal(promoted.status, 0, `a legitimate promote must succeed:\n${promoted.output}`);
  assert.match(promoted.output, /promoted 1/, promoted.output);

  const after = JSON.parse(await readFile(leafPath, "utf8")) as {
    leaflets: { id: string; tier: string }[];
  };
  assert.equal(after.leaflets.length, before.leaflets.length + 1, "the leaf must grow by exactly one leaflet");
  const added = after.leaflets.find((l) => l.id === candidateId);
  assert.ok(added, `the approved candidate's id must be in the leaf after promote:\n${JSON.stringify(after)}`);
  assert.equal(added.tier, "pending", "a machine-drafted, human-approved leaflet is pending, never verified");
});

test("a --garden containing a glob metacharacter is never expanded, even when it would match a real entry", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  // `lexically_normalize`/`resolve_dir` split a path via unquoted `set -- $path`, which bash
  // subjects to BOTH IFS word-splitting (wanted) AND pathname expansion (not wanted) — so a
  // --garden value containing a glob metacharacter that matches a real entry in cwd used to
  // resolve to that unrelated entry instead of staying literal text (three-pass review, round
  // 5: reproduced live — `--garden 'x*'` from a directory holding a real `xy` resolved to `xy`,
  // and `foliage grow` wrote leaf.json into it). One case per bash glob class that could match a
  // 2-character name: `*` (any run) and `?` (exactly one character).
  const home = await tempDir("take-seam-home-");
  const repo = await tinyRepo();
  for (const literal of ["x*", "x?"]) {
    const work = await tempDir("take-seam-glob-work-");
    // The unrelated real entry a broken split would have expanded the glob into.
    await mkdir(join(work, "xy"));

    const result = await runTake(["--repo", repo, "--identity", "seam@example.test", "--garden", literal], {
      home,
      cwd: work,
      timeoutMs: 30_000,
    });
    assert.equal(result.status, 0, `--garden ${literal} is not the live garden and must be allowed:\n${result.output}`);
    assert.ok(
      existsSync(join(work, literal)),
      `the LITERAL directory "${literal}" must exist — the glob metacharacter must never expand:\n${result.output}`,
    );
    assert.ok(
      existsSync(join(work, literal, "leaf.json")),
      `grow must write into the literal "${literal}" directory itself, not wherever a glob match led:\n${result.output}`,
    );
    assert.equal(
      existsSync(join(work, "xy", "leaf.json")),
      false,
      `"xy" is the unrelated real entry the glob would have matched — it must never be written into:\n${result.output}`,
    );
  }
});

test("resolve_dir dies loudly with a named error when an existing component cannot be entered, never misresolves", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  const home = await tempDir("take-seam-home-");
  const work = await tempDir("take-seam-work-");
  const blocked = join(work, "blocked");
  await mkdir(blocked);
  await chmod(blocked, 0o000);

  // ASK THE REAL QUESTION — the same technique `bashRuns()` uses for bash and `sipsRuns()` uses
  // for `sips` in `mediaSeam.test.ts` — rather than assuming permission bits are enforced. Root
  // (and some container/overlay filesystems) can `cd` into a mode-000 directory regardless, so
  // the failure this test exists to reproduce cannot occur there; skip honestly instead of
  // asserting something that cannot be true on this machine.
  const bypassesPermissions = await exec("bash", ["-c", `cd '${blocked}' 2>/dev/null && pwd`], { timeout: 5_000 })
    .then((r) => r.stdout.trim().length > 0)
    .catch(() => false);
  if (bypassesPermissions) {
    await chmod(blocked, 0o700);
    t.skip(
      "this process can enter a chmod-000 directory (root, or a filesystem that ignores permission bits) — cannot construct the permission-denied shape here",
    );
    return;
  }

  try {
    // `[ -d ]` on `blocked` succeeds (stat only needs execute on ITS PARENT), so the walk reaches
    // it and tries to `cd` in — which fails. Before the fix, `real="$(cd ... && pwd -P)"` would
    // silently capture "" here and reassemble the remainder rooted at `/`, a wrong path with no
    // error at all (three-pass review, round 5).
    const result = await runTake(["--identity", "seam@example.test", "--garden", join(blocked, "child")], {
      home,
      timeoutMs: 15_000,
    });
    assert.equal(result.status, 2, `a cd failure must die with exit 2, not misresolve:\n${result.output}`);
    assert.match(result.output, /cannot resolve .*blocked.*cd failed/, `must name the blocked path and say why:\n${result.output}`);
  } finally {
    // Restore so the shared `after()` cleanup's recursive rm can list and remove this directory.
    await chmod(blocked, 0o700);
  }
});

test("promote refuses symlinked --doc/--into whose TARGETS both resolve into a simulated ~/.foliage", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  // `--doc`/`--into` name FILES (harvest.json/leaf.json), not directories — `[ -d ]` is false for
  // a file, so the walk that resolves a --garden directory always stopped one component short of
  // it, appending the literal text unresolved. That was fine for a plain file, but WRONG for a
  // SYMLINK: the literal name (harmless-looking, sitting in a legitimate take-garden) is what
  // used to reach `refuse_if_live_garden`, not what the symlink actually points at — so a
  // symlinked flag whose TARGET is inside `~/.foliage` slipped past the check entirely, and
  // the OS write followed the link at the filesystem level regardless (round 8 review,
  // reproduced live). Both flags are symlinks here, each sitting in its OWN ordinary-looking
  // take-garden directory, so neither symlink's own location is anywhere near `~/.foliage` —
  // only their TARGETS share it. That also satisfies round 10's same-garden-directory rule
  // (both targets resolve into ONE directory), so this specifically exercises the live-garden
  // check, not the same-garden one.
  const home = await tempDir("take-seam-home-");
  const liveGarden = join(home, ".foliage");
  await mkdir(liveGarden, { recursive: true });
  await writeFile(join(liveGarden, "harvest.json"), JSON.stringify({ candidates: [] }), "utf8");
  await writeFile(join(liveGarden, "leaf.json"), JSON.stringify({ id: "leaf:live", subject: "Owner", leaflets: [] }), "utf8");
  const legitDoc = await tempDir("take-seam-legit-");
  const legitInto = await tempDir("take-seam-legit-");
  const docLink = join(legitDoc, "doc-link.json");
  const intoLink = join(legitInto, "into-link.json");
  await symlink(join(liveGarden, "harvest.json"), docLink);
  await symlink(join(liveGarden, "leaf.json"), intoLink);

  const result = await runTake(["promote", "--doc", docLink, "--into", intoLink], { home });
  assert.notEqual(result.status, 0, `symlinked flags resolving into the live garden must refuse:\n${result.output}`);
  assert.match(result.output, /REFUSED/, `must say REFUSED, naming the RESOLVED (not the literal symlink) path:\n${result.output}`);
  assert.match(
    result.output,
    /live garden/,
    `must say why specifically — the live garden, not just the same-garden rule:\n${result.output}`,
  );
});

test("resolve_dir refuses a dangling symlink by name instead of silently resolving to a target that never existed", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  const home = await tempDir("take-seam-home-");
  const legit = await tempDir("take-seam-legit-");
  await writeFile(join(legit, "harvest.json"), JSON.stringify({ candidates: [] }), "utf8");
  const danglingInto = join(legit, "dangling-into.json");
  // The symlink's own target is never created — a promote target that is a dangling link is
  // never legitimate, so this must refuse rather than resolve to a path nothing can ever be
  // written to or read from.
  await symlink(join(legit, "this-file-does-not-exist.json"), danglingInto);

  const result = await runTake(["promote", "--doc", join(legit, "harvest.json"), "--into", danglingInto], { home });
  assert.notEqual(result.status, 0, `a dangling --into symlink must refuse, not silently resolve:\n${result.output}`);
  assert.match(
    result.output,
    /REFUSED.*dangling symlink/,
    `must name the dangling symlink specifically, not a generic failure:\n${result.output}`,
  );
});

test("promote refuses a cross-take promote for the SAME subject — identical bindings, different gardens", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  // THE REVIEWER'S EXACT REPRO (round 10). A leaf's id is `slugify(subject)`
  // (`apps/leaf/intake.mjs`) — a deterministic function of the NAME, not of which take grew it.
  // take.sh never passes --subject unless the caller does, so growing twice from the SAME
  // repo/identity — the ordinary reshoot this whole script exists for — produces two
  // take-gardens with IDENTICAL subject/leafId bindings. The product's own binding check
  // (F-014/F-024) has nothing to disagree on, so it never fires: cross-promoting an approved
  // candidate from one take into the other's leaf used to succeed, exit 0, spliced. Only THIS
  // wrapper's same-garden-directory rule can catch it, because the product structurally cannot.
  const home = await tempDir("take-seam-home-");
  const work = await tempDir("take-seam-work-");
  const repo = await tinyRepo(2); // 2 commits: enough for git-cluster to draft one candidate
  const takeA = join(work, "take-A");
  const takeB = join(work, "take-B");

  const grownA = await runTake(["--repo", repo, "--identity", "seam@example.test", "--garden", takeA], {
    home,
    cwd: work,
    timeoutMs: 30_000,
  });
  assert.equal(grownA.status, 0, `growing take-A must succeed:\n${grownA.output}`);
  const grownB = await runTake(["--repo", repo, "--identity", "seam@example.test", "--garden", takeB], {
    home,
    cwd: work,
    timeoutMs: 30_000,
  });
  assert.equal(grownB.status, 0, `growing take-B must succeed:\n${grownB.output}`);

  const harvestA = JSON.parse(await readFile(join(takeA, "harvest.json"), "utf8")) as {
    subject: string;
    leafId: string;
    candidates: { id: string }[];
  };
  const harvestB = JSON.parse(await readFile(join(takeB, "harvest.json"), "utf8")) as { subject: string; leafId: string };
  assert.equal(harvestA.subject, harvestB.subject, "both takes must derive the SAME subject — the reshoot case this test is about");
  assert.equal(
    harvestA.leafId,
    harvestB.leafId,
    "identical subjects must yield identical leaf ids — the product's binding cannot distinguish these two takes",
  );
  const candidateId = harvestA.candidates[0]?.id;
  assert.ok(candidateId, "take-A must have drafted a candidate");

  const approved = await exec(
    process.execPath,
    [HARVEST_CLI, "approve", candidateId, "--by", "A Reviewer", "--doc", join(takeA, "harvest.json")],
    { timeout: 15_000 },
  );
  assert.match(approved.stdout, /approved by A Reviewer/, approved.stdout);

  const result = await runTake(["promote", "--doc", join(takeA, "harvest.json"), "--into", join(takeB, "leaf.json")], {
    home,
    timeoutMs: 15_000,
  });
  assert.notEqual(result.status, 0, `cross-take promote for the same subject must refuse:\n${result.output}`);
  assert.match(result.output, /REFUSED/, result.output);
  assert.ok(result.output.includes(takeA), `must name the --doc directory:\n${result.output}`);
  assert.ok(result.output.includes(takeB), `must name the --into directory:\n${result.output}`);
});

test("a --garden containing '..' that resolves into a simulated ~/.foliage is REFUSED", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  const home = await tempDir("take-seam-home-");
  const liveGarden = join(home, ".foliage");
  await mkdir(liveGarden, { recursive: true });
  const repo = await tinyRepo();

  // THE ".." MUST SIT AFTER A COMPONENT THAT DOES NOT EXIST ON DISK. If every component up to
  // and including the ".." already exists, `resolve_dir`'s own `cd`-based walk absorbs the ".."
  // at the OS level regardless of whether `lexically_normalize`'s STRING-level popping works at
  // all (the kernel understands ".." for any real directory) — so a naive "walk out and back
  // in through two real directories" case would pass even with the popping deliberately broken,
  // proving nothing. Here "nonexistent-parent" is never created, so the walk breaks BEFORE the
  // "..", and only `lexically_normalize`'s own popping — which runs first, on the whole string —
  // stands between this literal text and a wrong, unresolved path landing outside the check
  // `refuse_if_live_garden` performs.
  const result = await runTake(
    ["--repo", repo, "--identity", "seam@example.test", "--garden", "nonexistent-parent/../.foliage/sneaky"],
    { home, cwd: home, timeoutMs: 15_000 },
  );
  assert.notEqual(result.status, 0, `a ".."-containing --garden resolving into the live garden must refuse:\n${result.output}`);
  assert.match(result.output, /REFUSED/, result.output);
  assert.equal(existsSync(join(liveGarden, "sneaky")), false, "the live garden must gain nothing");
});

test("a --garden with a trailing slash that resolves into a simulated ~/.foliage is REFUSED", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  const home = await tempDir("take-seam-home-");
  const liveGarden = join(home, ".foliage");
  await mkdir(liveGarden, { recursive: true });
  const repo = await tinyRepo();

  const result = await runTake(["--repo", repo, "--identity", "seam@example.test", "--garden", "newsubdir/"], {
    home,
    cwd: liveGarden,
    timeoutMs: 15_000,
  });
  assert.notEqual(result.status, 0, `a trailing-slash --garden resolving into the live garden must refuse:\n${result.output}`);
  assert.match(result.output, /REFUSED/, result.output);
  assert.equal(existsSync(join(liveGarden, "newsubdir")), false, "the live garden must gain nothing");
});

/** A repo with TWO committers: the TOP one by commit count (2 commits), and another with just
 * 1 — the exact shape take.sh's own identity-derivation query needs to prove it picks the
 * right one, rather than merely "the only committer" (which a broken query could satisfy by
 * accident). */
async function tinyRepoTwoCommitters(): Promise<string> {
  const repo = await tempDir("take-seam-repo-multi-");
  const run = (args: readonly string[]) => exec("git", args, { cwd: repo, timeout: 10_000 });
  await exec("git", ["init", "--quiet", "--initial-branch=main", repo], { timeout: 10_000 });
  await run(["config", "user.email", "top@example.test"]);
  await run(["config", "user.name", "Top Committer"]);
  await writeFile(join(repo, "a.md"), "a\n", "utf8");
  await run(["add", "a.md"]);
  await run(["commit", "--quiet", "-m", "top commit 1"]);
  await writeFile(join(repo, "b.md"), "b\n", "utf8");
  await run(["add", "b.md"]);
  await run(["commit", "--quiet", "-m", "top commit 2"]);
  await run(["config", "user.email", "other@example.test"]);
  await run(["config", "user.name", "Other Committer"]);
  await writeFile(join(repo, "c.md"), "c\n", "utf8");
  await run(["add", "c.md"]);
  await run(["commit", "--quiet", "-m", "other commit 1"]);
  return repo;
}

test("with no --identity, take.sh derives the TOP committer by commit count and grows for real", async (t) => {
  if (!(await bashRuns())) {
    t.skip("bash is not available on this platform — take.sh (bash 3.2-targeted) cannot be exercised here");
    return;
  }
  // The documented default entry point (neither TAKES.md's usage line nor this script's own
  // USAGE requires --identity) had ZERO coverage: `git -C "$REPO" log --no-merges
  // --format='%ae' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}'`, asserted here
  // against a repo where the answer is NOT simply "the only committer" — a regression that
  // picked any committer, or read the wrong field, would show here and nowhere else.
  const home = await tempDir("take-seam-home-");
  const work = await tempDir("take-seam-work-");
  const repo = await tinyRepoTwoCommitters();
  const garden = join(work, "auto-identity-take");

  const result = await runTake(["--repo", repo, "--garden", garden], { home, cwd: work, timeoutMs: 30_000 });
  assert.equal(result.status, 0, `grow with an auto-derived identity must succeed:\n${result.output}`);
  assert.match(result.output, /growing from .* as top@example\.test/, `must derive the TOP committer's email:\n${result.output}`);
  assert.doesNotMatch(result.output, /other@example\.test/, `must not pick the committer with fewer commits:\n${result.output}`);
  assert.ok(existsSync(join(garden, "leaf.json")), "grow must actually write leaf.json");
});
