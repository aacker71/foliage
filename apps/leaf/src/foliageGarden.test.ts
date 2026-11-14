/**
 * FOLIAGE_GARDEN / --garden, END TO END — the real `foliage.mjs` entry point, spawning the real
 * children (`intake.mjs`, `harvest.mjs`, `export.mjs`), exactly as a terminal runs them.
 *
 * WHY THE OVERRIDE EXISTS: the concierge study grows a SECOND person's portfolio on this
 * machine, and until this seam the garden was hard-wired to `~/.foliage` — one garden per home
 * directory, so a second subject would silently interleave with the owner's own leaf. One knob
 * (`FOLIAGE_GARDEN=subjects/rowan`, or `--garden`) re-roots all four documents together; every
 * subcommand already derives its paths and its injected `FOLIAGE_LEAF`/`FOLIAGE_HARVEST`/
 * `FOLIAGE_POLICY` from those constants, so nothing else is threaded.
 *
 * THE SEMANTICS PINNED HERE, so they cannot drift silently:
 *   1. the override routes real writes (grow) and real env injection (export) to the override
 *      garden, and the default `~/.foliage` is NOT touched;
 *   2. unset means the literal `~/.foliage` paths — byte-identical to the pre-override CLI;
 *   3. a RELATIVE override resolves against cwd, deterministically, at process start. Resolved,
 *      not refused, because the motivating use is exactly a relative path typed from a study
 *      directory; resolved ONCE in the parent, because each spawned child would otherwise
 *      re-resolve it against its own idea of cwd and two processes in one run could name two
 *      different gardens;
 *   4. an EMPTY env var is unset (`FOLIAGE_GARDEN= foliage …` exports "", the same ""-vs-nullish
 *      trap `grow`'s user.name fallback documents), while an explicitly typed empty `--garden`
 *      is refused — resolve("") is the cwd, and adopting the shell's current directory as a
 *      garden by accident is a wrong answer given quietly;
 *   5. the flag beats the env (explicit-flag-wins, the CLI's standing order) and is spliced out
 *      of argv, so passthrough children (`foliage policy` forwards argv verbatim to policy.mjs's
 *      STRICT parsers) never see an option they did not declare.
 *
 * ISOLATION: every spawn gets its own HOME and an explicit FOLIAGE_GARDEN (set or deleted), so
 * no assertion depends on the developer's real `~/.foliage` or ambient shell exports. Leaf
 * documents written here are test scaffolding on temp paths, never product data, and everything
 * is deleted. Temp dirs are realpath'd before use: macOS hands out `/var/folders/…` symlinks,
 * and a child's `process.cwd()` reports the resolved `/private/var/…` — comparing unresolved
 * expectations against resolved output fails for reasons that have nothing to do with the seam.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
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

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "foliage-garden-")));
  tmpRoots.push(dir);
  return dir;
}

interface CliResult {
  readonly status: number;
  readonly output: string;
}

interface RunOptions {
  readonly home: string;
  /** Set FOLIAGE_GARDEN to exactly this value — including "" — or leave it DELETED when absent. */
  readonly garden?: string;
  readonly cwd?: string;
  readonly gitConfigGlobal?: string;
}

async function runFoliage(args: readonly string[], opts: RunOptions): Promise<CliResult> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: opts.home, NO_COLOR: "1" };
  delete env["FOLIAGE_GARDEN"]; // the ambient shell must never decide these assertions
  if (opts.garden !== undefined) env["FOLIAGE_GARDEN"] = opts.garden;
  if (opts.gitConfigGlobal !== undefined) env["GIT_CONFIG_GLOBAL"] = opts.gitConfigGlobal;
  try {
    const { stdout, stderr } = await exec(process.execPath, [FOLIAGE_CLI, ...args], {
      encoding: "utf8",
      timeout: 60_000,
      cwd: opts.cwd,
      env,
    });
    return { status: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/** Same shape as `runFoliage`, driving `harvest.mjs` directly — bypassing `foliage` entirely,
 * exactly as an operator hand-invoking the wrapper would (the F-014 reproduction path). */
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

/** A minimal valid leaf document with one plain-titled leaflet — the same scaffolding shape
 * `exportSeam.test.ts` uses, kept clear of anything export's PII gate would refuse. */
const leafDoc = (subject: string, title: string) =>
  JSON.stringify({
    id: "leaf:garden-test",
    subject,
    leaflets: [
      {
        id: `git:${"a".repeat(40)}`,
        title,
        tier: "pending",
        provenance: { source: "git", ref: "a".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" },
      },
    ],
  });

test("FOLIAGE_GARDEN routes grow's real writes into the override garden — and ~/.foliage stays untouched", async () => {
  const home = await tempDir();
  const garden = join(await tempDir(), "subjects", "rowan");
  const repo = await tempDir();
  await exec("git", ["init", "--quiet", "--initial-branch=main", repo], { timeout: 30_000 });
  const emptyGlobal = join(await tempDir(), "machine-gitconfig");
  await writeFile(emptyGlobal, "", "utf8");

  const result = await runFoliage(
    ["grow", "--repo", repo, "--subject", "Rowan", "--identity", "rowan@example.test"],
    { home, garden, gitConfigGlobal: emptyGlobal },
  );
  assert.equal(result.status, 0, `grow must succeed under an override:\n${result.output}`);
  // The two documents grow writes land in the OVERRIDE garden…
  assert.ok(existsSync(join(garden, "leaf.json")), "leaf.json must be written into the override garden");
  assert.ok(existsSync(join(garden, "harvest.json")), "harvest.json must be written into the override garden");
  // …and the default garden was never created, let alone written — the whole point of the knob
  // is that a second subject's study cannot interleave with the owner's own leaf.
  assert.equal(existsSync(join(home, ".foliage")), false, "~/.foliage must stay untouched under an override");
});

/** Capture names and bytes, including git config, so a successful exit cannot hide a write. */
async function fileSnapshot(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      result[path] = "directory";
      Object.assign(result, await fileSnapshot(path));
    } else result[path] = (await readFile(path)).toString("base64");
  }
  return result;
}

test("every command's help leaves an absent or existing garden and login configuration untouched", async () => {
  const home = await tempDir();
  const garden = join(home, "garden");
  for (const existing of [false, true]) {
    if (existing) {
      await mkdir(garden);
      // Unreadable-as-JSON input must not be read, repaired or overwritten just to show help.
      await writeFile(join(garden, "leaf.json"), "incomplete prior bytes\n");
      await writeFile(join(garden, "harvest.json"), "preserve this failed-write evidence\n");
    }
    const before = await fileSnapshot(home);
    for (const command of ["grow", "review", "up", "canopy", "verify", "status", "export", "install", "policy"]) {
      for (const flag of ["--help", "-h"]) {
        const result = await runFoliage([command, flag, "--garden", garden], { home });
        assert.equal(result.status, 0, `${command} ${flag}: ${result.output}`);
        assert.match(result.output, /Usage:/);
        assert.deepEqual(await fileSnapshot(home), before, `${command} ${flag} changed files`);
      }
    }
    const nested = await runFoliage(["policy", "deny", "--help", "--garden", garden], { home });
    assert.equal(nested.status, 0, nested.output);
    assert.deepEqual(await fileSnapshot(home), before);
  }
});

test("invalid launcher arguments refuse before writing or starting a service", async () => {
  const home = await tempDir();
  const cases = [
    ["grow", "--reop", "."], ["grow", "--repo"], ["grow", "--repo", "--subject", "name"],
    ["grow", "--subject", ""], ["grow", "--identity", ""], ["grow", "--repo", ".", "--repo", "elsewhere"],
    ["review", "--doc", ""], ["review", "--doc"], ["review", "surprise"], ["review", "--by", "someone"], ["review", "--supersede", "id"],
    ["up", "--port", "0"], ["up", "--port", "no"], ["install", "--port", "65536"],
    ["canopy", "--public-port", "1.5"], ["export", "--out"], ["export", "--cofirm"],
    ["verify", "--setpu"], ["policy", "show", "--unknown"], ["status", "--garden", "--help"],
    ["policy", "show", "--policy=first", "--policy=second"],
    ["policy", "deny", "id", "--by", "tier", "--by", "evidence-ref"],
    ["policy", "deny", "id", "--leaf=first", "--leaf=second"],
    ["policy", "deny", "id", "--because=first", "--because=second"],
    ["policy", "show", "extra"], ["policy", "check", "extra"], ["policy", "drop", "first", "second"],
    ["status", "--garden=first", "--garden", "second"], ["status", "--garden="],
    ["gro"], ["--help", "extra"],
  ];
  for (const args of cases) {
    const result = await runFoliage(args, { home, garden: join(home, "untouched") });
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.output}`);
    assert.deepEqual(await readdir(home), [], `${args.join(" ")} wrote to the home`);
  }
});

test("equals-form garden and command options retain explicit targets", async () => {
  const home = await tempDir();
  const garden = join(home, "equals garden");
  const result = await runFoliage(["status", `--garden=${garden}`], { home, garden: join(home, "wrong") });
  assert.equal(result.status, 0, result.output);
  assert.ok(result.output.includes(join(garden, "leaf.json")), result.output);
  assert.deepEqual(await readdir(home), []);
});

test("grow's suggested review command retains the garden from a different cwd", async () => {
  const home = await tempDir();
  const repo = join(home, "source with spaces and ' quote");
  const garden = join(home, "garden with spaces and ' quote");
  await exec("git", ["init", "--quiet", "--initial-branch=main", repo]);
  const result = await runFoliage(["grow", "--repo", repo, "--subject", "CLI test", "--identity", "cli@example.test", "--garden", garden], { home });
  assert.equal(result.status, 0, result.output);
  const suggestion = result.output.match(/^\s+NEXT\s+(.+)$/m)?.[1];
  assert.ok(suggestion, result.output);
  assert.ok(suggestion.includes(`'--garden' '${garden.replaceAll("'", "'\\''")}'`), "suggestion retains the exact garden");
  // Execute the actual displayed shell line. Quoting and cwd mistakes must fail this test.
  const review = await exec("sh", ["-c", suggestion], { cwd: await tempDir(), env: { ...process.env, HOME: home, FOLIAGE_GARDEN: join(home, "wrong-garden"), NO_COLOR: "1" } });
  assert.match(review.stdout, /nothing awaits you/);
  assert.equal(existsSync(join(home, "wrong-garden")), false);
  assert.ok(review.stdout.includes(garden.replaceAll("'", "'\\''")), "export suggestion retains this garden too");
});

test("a valid policy edit still creates an absent garden after validation", async () => {
  const home = await tempDir();
  const garden = join(home, "new-garden");
  const leaf = join(home, "source-leaf.json");
  // Real repository evidence, not a fabricated person's portfolio or a claimed customer run.
  const project = fileURLToPath(new URL("../../../", import.meta.url));
  const commit = await exec("git", ["-C", project, "log", "-1", "--format=%H%n%s%n%cI"]);
  const [ref, title, observedAt] = commit.stdout.trim().split("\n");
  await writeFile(leaf, JSON.stringify({ id: "cli-regression", subject: "CLI regression harness", leaflets: [{ id: `git:${ref}`, title, tier: "pending", provenance: { source: "git", ref, observedAt } }] }));
  const result = await runFoliage(["policy", "deny", `git:${ref}`, "--by", "evidence-ref", "--because", "CLI regression harness", "--leaf", leaf, "--garden", garden], { home });
  assert.equal(result.status, 0, result.output);
  const policy = JSON.parse(await readFile(join(garden, "policy.json"), "utf8"));
  assert.ok(policy.rules.some((rule: { match: { ref?: string } }) => rule.match.ref === ref), "validated rule is written in the chosen garden");
});

test("FOLIAGE_GARDEN routes export's FOLIAGE_LEAF injection to the override garden's leaf, not the default's", async () => {
  const home = await tempDir();
  const garden = join(await tempDir(), "subjects", "rowan");
  await mkdir(garden, { recursive: true });
  // Two distinct documents, one per garden. NEITHER leaflet carries `visibility: "public"`, so —
  // since PR-C's consent projection at the export edge — neither title crosses into the page.
  // That is the PRODUCT FIX this test now pins, and it is the one flip in this suite that changes
  // what a test claims: before, this test asserted the override garden's never-shared title WAS on
  // the exported page, which is exactly the defect (a leaflet nobody offered, shipped to a
  // stranger). Routing is still the thing this test is named for, so it is still verified — through
  // the LEAF's own `subject`, which survives the consent projection unchanged (subject is a fact
  // about the document, not a leaflet, so it is never withheld) and can only be "Rowan" if the
  // override's document was the one read.
  await writeFile(join(garden, "leaf.json"), leafDoc("Rowan", "intake: routed through the override garden"), "utf8");
  await mkdir(join(home, ".foliage"), { recursive: true });
  await writeFile(join(home, ".foliage", "leaf.json"), leafDoc("Owner", "intake: the decoy in the default garden"), "utf8");

  const out = join(await tempDir(), "site");
  const result = await runFoliage(["export", "--out", out], { home, garden });
  assert.equal(result.status, 0, `export must succeed under an override:\n${result.output}`);
  const html = await readFile(join(out, "index.html"), "utf8");
  assert.ok(html.includes(">Rowan<"), "the override garden's subject must be the one exported");
  assert.ok(!html.includes(">Owner<"), "the default garden's subject must not leak into an overridden export");
  // Never-shared, so consent withholds both titles from the page — this is the fix, not a leak.
  assert.ok(
    !html.includes("intake: routed through the override garden"),
    "a never-shared leaflet's title must not reach the exported page, even the override's own",
  );
  assert.ok(!html.includes("intake: the decoy in the default garden"), "the default garden's leaf must not leak into an overridden export");
});

test("with no override, the garden is the literal ~/.foliage — byte-identical to the pre-override default", async () => {
  const home = await tempDir();
  const result = await runFoliage(["status"], { home });
  assert.equal(result.status, 0, result.output);
  // `status` on a fresh garden names the exact leaf path it looked for — the assertion is that
  // path, verbatim, under this HOME.
  assert.ok(
    result.output.includes(`none yet at ${join(home, ".foliage", "leaf.json")}`),
    `unset override must resolve to ~/.foliage/leaf.json:\n${result.output}`,
  );
});

test("an EMPTY FOLIAGE_GARDEN is unset, never 'the cwd is the garden'", async () => {
  const home = await tempDir();
  const work = await tempDir();
  const result = await runFoliage(["status"], { home, garden: "", cwd: work });
  assert.equal(result.status, 0, result.output);
  assert.ok(
    result.output.includes(`none yet at ${join(home, ".foliage", "leaf.json")}`),
    `FOLIAGE_GARDEN="" must fall back to ~/.foliage:\n${result.output}`,
  );
  assert.ok(!result.output.includes(work), "an empty override must not adopt the cwd as the garden");
});

test("a RELATIVE FOLIAGE_GARDEN resolves against cwd, deterministically", async () => {
  const home = await tempDir();
  const work = await tempDir();
  const result = await runFoliage(["status"], { home, garden: join("subjects", "rowan"), cwd: work });
  assert.equal(result.status, 0, result.output);
  assert.ok(
    result.output.includes(`none yet at ${join(work, "subjects", "rowan", "leaf.json")}`),
    `a relative override must resolve against the invoking cwd:\n${result.output}`,
  );
});

test("--garden beats FOLIAGE_GARDEN — explicit flag wins, like every other flag-over-env seam here", async () => {
  const home = await tempDir();
  const flagGarden = join(await tempDir(), "from-flag");
  const envGarden = join(await tempDir(), "from-env");
  const result = await runFoliage(["status", "--garden", flagGarden], { home, garden: envGarden });
  assert.equal(result.status, 0, result.output);
  assert.ok(result.output.includes(`none yet at ${join(flagGarden, "leaf.json")}`), `the flag's garden must win:\n${result.output}`);
  assert.ok(!result.output.includes(envGarden), "the env garden must not appear once the flag overrides it");
});

test("--garden is spliced OUT of argv before `foliage policy` forwards args — strict child parsers never see it", async () => {
  const home = await tempDir();
  const garden = join(await tempDir(), "subjects", "rowan");
  // policy.mjs's `show` parses with strict:true and no `garden` option declared: a leaked
  // `--garden` would dump its USAGE block instead of answering. Success here proves the splice;
  // the named path proves the override still reached the injected FOLIAGE_POLICY.
  const result = await runFoliage(["policy", "show", "--garden", garden], { home });
  assert.equal(result.status, 0, `policy show must succeed with --garden:\n${result.output}`);
  assert.match(result.output, /no policy document exists yet/);
  assert.ok(
    result.output.includes(join(garden, "policy.json")),
    `the shipped-default notice must name the OVERRIDE garden's policy.json:\n${result.output}`,
  );
});

test("--garden with no path (or an empty one) refuses with ONE clean line, exit 2", async () => {
  const home = await tempDir();
  const bare = await runFoliage(["status", "--garden"], { home });
  assert.equal(bare.status, 2, `a valueless --garden must refuse with EXIT_USAGE (2):\n${bare.output}`);
  assert.match(bare.output, /foliage: --garden needs a path\./);
  const empty = await runFoliage(["status", "--garden", ""], { home });
  assert.equal(empty.status, 2, `an empty --garden must refuse, not adopt the cwd:\n${empty.output}`);
  assert.match(empty.output, /foliage: --garden needs a path\./);
});

test("a DUPLICATE --garden refuses by name with both values — never first-wins, never a child's usage dump (F-017)", async () => {
  const home = await tempDir();
  const dup = await runFoliage(["status", "--garden", "/tmp/g1", "--garden", "/tmp/g2"], { home });
  assert.equal(dup.status, 2, `two explicit gardens must refuse, not silently pick one:\n${dup.output}`);
  assert.match(dup.output, /--garden given 2 times/);
  assert.match(dup.output, /\/tmp\/g1, \/tmp\/g2/, "both values are named so the operator sees what collided");
  // The refusal happens HERE, in the wrapper — a duplicate leaking into `foliage policy`'s
  // verbatim passthrough used to surface as policy.mjs's unrelated usage dump.
  const viaPolicy = await runFoliage(["policy", "show", "--garden", "/tmp/g1", "--garden", "/tmp/g2"], { home });
  assert.equal(viaPolicy.status, 2);
  assert.match(viaPolicy.output, /--garden given 2 times/);
  assert.doesNotMatch(viaPolicy.output, /Unknown option/, "the child's parser must never be the one refusing");
});

test("install XML-escapes a hostile garden path in the plist — the injection stays dead (F-018)", async () => {
  const home = await tempDir();
  // Legal on APFS, lethal in un-escaped XML: every plist metacharacter the escape must neutralise.
  const evil = join(home, 'evil & <x> "q" garden');
  await mkdir(evil, { recursive: true });
  const ran = await runFoliage(["install", "--port", "4321", "--garden", evil], { home });
  assert.equal(ran.status, 0, `install must succeed under an override:\n${ran.output}`);

  // BOTH AGENTS, not just the first. `install` writes a second plist — the scheduled harvest —
  // that interpolates the same user-controlled garden path through the same escape. Checking only
  // the viewer would leave the identical injection live in the file added later, which is exactly
  // how a fixed vulnerability comes back wearing a new filename.
  for (const label of ["com.foliage.leaf", "com.foliage.grow"]) {
    const plist = await readFile(join(home, "Library", "LaunchAgents", `${label}.plist`), "utf8");
    // The raw metacharacter sequence must appear NOWHERE — not in EnvironmentVariables, not in the
    // log paths, which ride through the same escape for the same reason.
    assert.doesNotMatch(plist, /evil & <x>/, `${label}: a raw & or < inside <string> is the injection, alive`);
    assert.match(plist, /evil &amp; &lt;x&gt; &quot;q&quot; garden/, `${label}: the escaped form is what lands`);
    // The reproduced attack injected a SECOND ProgramArguments key (last-key-wins runs it at login).
    assert.equal((plist.match(/ProgramArguments/g) ?? []).length, 1, `${label}: exactly one ProgramArguments key`);
    assert.equal(
      (plist.match(/EnvironmentVariables/g) ?? []).length,
      1,
      `${label}: the override rides in exactly one env block`,
    );
  }
});



/* --------------------------------------------------------------- the share front door, PR-G ---- */

const LEAFLET_ID = `git:${"a".repeat(40)}`;

/** The app's own script-relative default document — gitignored, and on a machine where the app
 * has been used, the owner's real leaf. Only ever READ here. */
const APP_DEFAULT_LEAF = fileURLToPath(new URL("../leaf.json", import.meta.url));

/**
 * What sits at a path, without changing it: absent, or a digest of its exact bytes plus its
 * mtime. Comparing two of these proves nothing wrote the file in between, whether or not one is
 * there — absent must stay absent (a fresh clone, CI), present must keep its bytes AND its
 * mtime (so even a rewrite of identical bytes shows). The digest keeps the content out of any
 * failure message.
 */
async function fileState(path: string): Promise<Readonly<Record<string, unknown>>> {
  try {
    const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
    return { present: true, sha256: createHash("sha256").update(bytes).digest("hex"), mtimeMs: info.mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { present: false };
    throw err;
  }
}

test("foliage share writes the GARDEN's leaf.json, never apps/leaf/leaf.json, and status counts it", async () => {
  const home = await tempDir();
  const garden = join(await tempDir(), "subjects", "rowan");
  await mkdir(garden, { recursive: true });
  await writeFile(join(garden, "leaf.json"), leafDoc("Rowan", "a leaflet worth sharing"), "utf8");
  const appDefaultBefore = await fileState(APP_DEFAULT_LEAF);

  const before = await runFoliage(["status"], { home, garden });
  assert.equal(before.status, 0, before.output);
  assert.match(before.output, /0 public {3}0 unlisted {3}1 private/, `nothing shared yet:\n${before.output}`);

  const shared = await runFoliage(["share", LEAFLET_ID, "--as", "public"], { home, garden });
  assert.equal(shared.status, 0, `share must succeed:\n${shared.output}`);
  assert.match(shared.output, /private → public/, shared.output);

  // The write landed on the GARDEN's document — the app's own script-relative default
  // (apps/leaf/leaf.json) is exactly as it was: still absent on a fresh clone, the same bytes
  // and mtime where someone keeps their own leaf there.
  const gardenLeaf = JSON.parse(await readFile(join(garden, "leaf.json"), "utf8"));
  assert.equal(gardenLeaf.leaflets[0].visibility, "public", "the garden's own leaf.json must carry the new visibility");
  assert.deepEqual(
    await fileState(APP_DEFAULT_LEAF),
    appDefaultBefore,
    "share must never write apps/leaf/leaf.json — that is a different document than the garden's",
  );

  const after = await runFoliage(["status"], { home, garden });
  assert.equal(after.status, 0, after.output);
  assert.match(after.output, /1 public {3}0 unlisted {3}0 private/, `status must count the newly-public leaflet:\n${after.output}`);

  const unshared = await runFoliage(["unshare", LEAFLET_ID], { home, garden });
  assert.equal(unshared.status, 0, `unshare must succeed:\n${unshared.output}`);
  assert.match(unshared.output, /public → private/, unshared.output);

  const restoredLeaf = JSON.parse(await readFile(join(garden, "leaf.json"), "utf8"));
  assert.equal("visibility" in restoredLeaf.leaflets[0], false, "unshare deletes the key rather than writing the word");
  assert.deepEqual(await fileState(APP_DEFAULT_LEAF), appDefaultBefore, "unshare must never write apps/leaf/leaf.json either");

  const restored = await runFoliage(["status"], { home, garden });
  assert.equal(restored.status, 0, restored.output);
  assert.match(restored.output, /0 public {3}0 unlisted {3}1 private/, `status must count it back as private:\n${restored.output}`);
});

test("foliage share refuses more than one id — no bulk, share.mjs's own refusal stands", async () => {
  const home = await tempDir();
  const garden = join(await tempDir(), "subjects", "rowan");
  await mkdir(garden, { recursive: true });
  await writeFile(join(garden, "leaf.json"), leafDoc("Rowan", "a leaflet"), "utf8");

  const result = await runFoliage(["share", LEAFLET_ID, "other-id", "--as", "public"], { home, garden });
  assert.equal(result.status, 2, `two ids must refuse, not silently share the first:\n${result.output}`);
  assert.match(result.output, /takes ONE id and got 2/);
});

test("foliage share never defaults --as to public", async () => {
  const home = await tempDir();
  const garden = join(await tempDir(), "subjects", "rowan");
  await mkdir(garden, { recursive: true });
  await writeFile(join(garden, "leaf.json"), leafDoc("Rowan", "a leaflet"), "utf8");

  const result = await runFoliage(["share", LEAFLET_ID], { home, garden });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /private → unlisted/, `bare --as-less share must land on unlisted, never public:\n${result.output}`);
});

test("foliage's own help lists share and unshare beside every other verb", async () => {
  const home = await tempDir();
  const result = await runFoliage([], { home });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /\bshare\b/);
  assert.match(result.output, /\bunshare\b/);
});

/* ------------------------------------------------------------ the target binding, F-014 ---- */

test("F-014: promoting subject B's harvest into subject A's leaf refuses by name — never splices one subject's approvals into another's leaf", async () => {
  const home = await tempDir();
  const gardenA = join(await tempDir(), "subjects", "alice");
  const gardenB = join(await tempDir(), "subjects", "bob");
  const repoA = await tempDir();
  const repoB = await tempDir();
  await exec("git", ["init", "--quiet", "--initial-branch=main", repoA], { timeout: 30_000 });
  await exec("git", ["init", "--quiet", "--initial-branch=main", repoB], { timeout: 30_000 });
  const emptyGlobal = join(await tempDir(), "machine-gitconfig");
  await writeFile(emptyGlobal, "", "utf8");

  // `foliage grow` now threads --into automatically (see foliage.mjs), so each subject's
  // harvest is bound to ITS OWN leaf without any extra operator action.
  const grownA = await runFoliage(
    ["grow", "--repo", repoA, "--subject", "Alice", "--identity", "alice@example.test"],
    { home, garden: gardenA, gitConfigGlobal: emptyGlobal },
  );
  assert.equal(grownA.status, 0, `grow (A) must succeed:\n${grownA.output}`);
  const grownB = await runFoliage(
    ["grow", "--repo", repoB, "--subject", "Bob", "--identity", "bob@example.test"],
    { home, garden: gardenB, gitConfigGlobal: emptyGlobal },
  );
  assert.equal(grownB.status, 0, `grow (B) must succeed:\n${grownB.output}`);

  const bHarvest = JSON.parse(await readFile(join(gardenB, "harvest.json"), "utf8"));
  assert.equal(bHarvest.subject, "Bob", "grow must record which subject this harvest is for");
  // CAPTURED BEFORE THE CROSS-PROMOTE, so "untouched" below means what it says — a byte
  // comparison, not merely a fact re-derived from the same document the mistake would have
  // rewritten. The ledger row for F-014 has claimed "leaf B untouched" since this test was
  // written; until now nothing here actually read leaf B to check it.
  const leafBBefore = await readFile(join(gardenB, "leaf.json"), "utf8");

  // THE REPRODUCTION: B's harvest promoted into A's leaf — the forgotten-flag mistake the
  // finding describes — driven straight through harvest.mjs, bypassing `foliage` entirely, as
  // an operator running the wrapper by hand would.
  const crossPromote = await runHarvest([
    "promote",
    "--doc",
    join(gardenB, "harvest.json"),
    "--into",
    join(gardenA, "leaf.json"),
    "--force",
  ]);
  assert.equal(crossPromote.status, 1, `cross-subject promote must refuse:\n${crossPromote.output}`);
  assert.match(crossPromote.output, /refused/i);
  assert.match(crossPromote.output, /subject mismatch/);
  assert.match(crossPromote.output, /"Bob"/, "the harvest's own subject must be named");
  assert.match(crossPromote.output, /"Alice"/, "the target leaf's actual subject must be named");
  assert.match(crossPromote.output, /leafId mismatch/, "a leaf can be renamed without its id changing — both checks run");

  // A's leaf must be untouched — nothing was spliced in.
  const leafAafter = JSON.parse(await readFile(join(gardenA, "leaf.json"), "utf8"));
  assert.equal(leafAafter.leaflets.length, 0, "A's leaf must not gain any of B's candidates");

  // AND B's leaf — the document the mistake did NOT target but the ledger claims stayed
  // untouched — is actually read and compared, byte for byte. The refused promote's --into
  // and --out both name gardenA/leaf.json; nothing in this call ever opens gardenB/leaf.json,
  // so this is the real assertion the ledger row's prose has claimed all along.
  const leafBAfterCross = await readFile(join(gardenB, "leaf.json"), "utf8");
  assert.equal(leafBAfterCross, leafBBefore, "B's own leaf must be byte-for-byte untouched by a refused cross-subject promote");

  // THE OTHER HALF, so this test cannot pass by refusing everything: promoting A's OWN harvest
  // into A's OWN leaf — the matching binding grow just wrote — must succeed plainly.
  const samePromote = await runHarvest([
    "promote",
    "--doc",
    join(gardenA, "harvest.json"),
    "--into",
    join(gardenA, "leaf.json"),
    "--force",
  ]);
  assert.equal(samePromote.status, 0, `same-garden promote must succeed:\n${samePromote.output}`);
  assert.doesNotMatch(samePromote.output, /unbound document/, "a bound, matching document carries no caveat");
});

test("F-014: a harvest carrying no recorded binding at all — the pre-fix shape — still promotes, with the caveat printed plainly", async () => {
  const garden = await tempDir();
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  await writeFile(leafPath, leafDoc("Legacy Subject", "intake: a pre-existing leaflet"), "utf8");
  // Exactly the shape `apps/leaf/harvest.mjs propose` wrote before this fix, or still writes
  // today with no --into given: no subject, no leafId, one unreviewed candidate.
  await writeFile(
    harvestPath,
    JSON.stringify({
      candidates: [
        {
          id: "git-cluster:unbound",
          title: "cleanup: 2 commits",
          evidence: [{ source: "git", ref: "b".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
          extractor: "git-cluster",
          draftedAt: "2026-08-29T00:00:00.000Z",
          review: { state: "candidate" },
        },
      ],
    }),
    "utf8",
  );

  const approved = await runHarvest(["approve", "git-cluster:unbound", "--by", "Tester", "--doc", harvestPath]);
  assert.equal(approved.status, 0, `approve must succeed:\n${approved.output}`);

  const promoted = await runHarvest(["promote", "--doc", harvestPath, "--into", leafPath, "--force"]);
  assert.equal(promoted.status, 0, `an unbound document must still promote:\n${promoted.output}`);
  assert.match(
    promoted.output,
    /unbound document — binding not checked/,
    "absence must be stated, never silently treated as a verified match",
  );

  const leafAfter = JSON.parse(await readFile(leafPath, "utf8"));
  assert.equal(leafAfter.leaflets.length, 2, "the new pending leaflet joins the pre-existing one");
});

/* ------------------------------------------- the binding carried forward, PR #17 review ---- */

test("F-014 continued: re-propose that OMITS --into preserves an existing binding, and says so", async () => {
  const home = await tempDir();
  const garden = join(await tempDir(), "subjects", "alice");
  const repo = await tempDir();
  await exec("git", ["init", "--quiet", "--initial-branch=main", repo], { timeout: 30_000 });
  const emptyGlobal = join(await tempDir(), "machine-gitconfig");
  await writeFile(emptyGlobal, "", "utf8");

  const grown = await runFoliage(
    ["grow", "--repo", repo, "--subject", "Alice", "--identity", "alice@example.test"],
    { home, garden, gitConfigGlobal: emptyGlobal },
  );
  assert.equal(grown.status, 0, `grow must succeed:\n${grown.output}`);
  const harvestPath = join(garden, "harvest.json");
  const bound = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(bound.subject, "Alice", "grow's own propose --into must have recorded the binding");
  assert.ok(typeof bound.leafId === "string" && bound.leafId.length > 0, "and the leaf id");

  // THE DOCUMENTED, UNREMARKABLE REFRESH: harvest.mjs propose run directly with no --into at
  // all — exactly what an operator re-drafting from the repo's current history, rather than
  // through `foliage grow`, would type. This is the bug's own reproduction: --into omitted on a
  // supported, ordinary refresh must not silently drop what an earlier propose already recorded.
  const reproposed = await runHarvest([
    "propose",
    "--repo",
    repo,
    "--identity",
    "alice@example.test",
    "--out",
    harvestPath,
    "--force",
  ]);
  assert.equal(reproposed.status, 0, `a --into-less re-propose must succeed:\n${reproposed.output}`);
  assert.match(
    reproposed.output,
    /binding preserved/,
    `the CLI must say the existing binding survived the refresh:\n${reproposed.output}`,
  );

  const after = JSON.parse(await readFile(harvestPath, "utf8"));
  assert.equal(after.subject, "Alice", "the binding must survive a re-propose that omits --into");
  assert.equal(after.leafId, bound.leafId, "the leaf id must survive too");

  // AND THE OTHER HALF: promote must not print the unbound caveat now — this is F-014's whole
  // point, that a binding can actually be CHECKED, not merely recorded once and lost on refresh.
  const promoted = await runHarvest([
    "promote",
    "--doc",
    harvestPath,
    "--into",
    join(garden, "leaf.json"),
    "--force",
  ]);
  assert.equal(promoted.status, 0, promoted.output);
  assert.doesNotMatch(
    promoted.output,
    /unbound document/,
    "a preserved binding must be checked, not waved through",
  );
});

test("F-014 continued: re-propose with a DIFFERENT --into refuses by name, and writes nothing", async () => {
  const home = await tempDir();
  const gardenA = join(await tempDir(), "subjects", "alice");
  const gardenB = join(await tempDir(), "subjects", "bob");
  const repoA = await tempDir();
  const repoB = await tempDir();
  await exec("git", ["init", "--quiet", "--initial-branch=main", repoA], { timeout: 30_000 });
  await exec("git", ["init", "--quiet", "--initial-branch=main", repoB], { timeout: 30_000 });
  const emptyGlobal = join(await tempDir(), "machine-gitconfig");
  await writeFile(emptyGlobal, "", "utf8");

  const grownA = await runFoliage(
    ["grow", "--repo", repoA, "--subject", "Alice", "--identity", "alice@example.test"],
    { home, garden: gardenA, gitConfigGlobal: emptyGlobal },
  );
  assert.equal(grownA.status, 0, `grow (A) must succeed:\n${grownA.output}`);
  const grownB = await runFoliage(
    ["grow", "--repo", repoB, "--subject", "Bob", "--identity", "bob@example.test"],
    { home, garden: gardenB, gitConfigGlobal: emptyGlobal },
  );
  assert.equal(grownB.status, 0, `grow (B) must succeed:\n${grownB.output}`);

  const harvestPathA = join(gardenA, "harvest.json");
  const before = await readFile(harvestPathA, "utf8");

  // THE MISTAKE: re-proposing A's own harvest, but naming B's leaf via --into — a typo, not a
  // deliberate rebind. It must refuse BEFORE writing anything, the same posture promote's own
  // mismatch check takes one step later in the pipeline.
  const reproposed = await runHarvest([
    "propose",
    "--repo",
    repoA,
    "--identity",
    "alice@example.test",
    "--into",
    join(gardenB, "leaf.json"),
    "--out",
    harvestPathA,
    "--force",
  ]);
  assert.equal(
    reproposed.status,
    1,
    `a --into disagreeing with the recorded binding must refuse:\n${reproposed.output}`,
  );
  assert.match(reproposed.output, /"Alice"/, "the EXISTING binding's subject must be named");
  assert.match(reproposed.output, /"Bob"/, "the NEW --into's subject must be named");
  assert.match(
    reproposed.output,
    /deliberate/i,
    "a binding change must be named as deliberate, never silent",
  );

  const after = await readFile(harvestPathA, "utf8");
  assert.equal(
    after,
    before,
    "nothing was written — the refusal happens before the document is touched",
  );
});


test("install writes a SCHEDULED HARVEST beside the viewer — the agent that makes 'forget it' mean anything", async () => {
  const home = await tempDir();
  const garden = await tempDir();
  const ran = await runFoliage(["install", "--garden", garden], { home });
  assert.equal(ran.status, 0, ran.output);

  const grow = await readFile(join(home, "Library", "LaunchAgents", "com.foliage.grow.plist"), "utf8");
  assert.match(grow, /<string>com\.foliage\.grow<\/string>/);
  // It runs `grow`, not `up`. Before this existed install wrote ONE agent and it was the viewer.
  assert.match(grow, /<string>grow<\/string>/);
  assert.match(grow, /<string>--watched<\/string>/, "the scheduler must explicitly select watched sources");
  assert.doesNotMatch(grow, /<string>up<\/string>/);
  // A harvest is not a server: KeepAlive would restart it the instant it finished, and RunAtLoad
  // would harvest on every login — a lot of git reads bought for nothing, because logging in is not
  // evidence that new work exists.
  assert.match(grow, /<key>StartInterval<\/key><integer>21600<\/integer>/);
  assert.doesNotMatch(grow, /KeepAlive/);
  assert.doesNotMatch(grow, /RunAtLoad/);
  assert.match(grow, /grow\.log/);
  // Keep the execution directory explicit; --watched selects the source independently of it.
  assert.match(grow, new RegExp(`<key>WorkingDirectory</key><string>${garden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</string>`));

  // The viewer keeps its own shape — this must not pass by having broken the other agent.
  const app = await readFile(join(home, "Library", "LaunchAgents", "com.foliage.leaf.plist"), "utf8");
  assert.match(app, /<key>KeepAlive<\/key><true\/>/);
  assert.match(app, /<key>RunAtLoad<\/key><true\/>/);
  assert.doesNotMatch(app, /StartInterval/);
});

test("install says plainly that a scheduled harvest with nothing watched reads nothing", async () => {
  // launchd starts the agent in a directory that is not a repository. Said at the one moment
  // somebody is looking, rather than discovered later as a garden that never grew.
  const home = await tempDir();
  const garden = await tempDir();
  const ran = await runFoliage(["install", "--garden", garden], { home });
  assert.equal(ran.status, 0, ran.output);
  assert.match(ran.output, /nothing — a scheduled harvest would read no history/);
});

test("install refuses an --every below the floor rather than scheduling a harvest every second", async () => {
  const home = await tempDir();
  const garden = await tempDir();
  const ran = await runFoliage(["install", "--garden", garden, "--every", "1"], { home });
  assert.equal(ran.status, 2, ran.output);
  assert.match(ran.output, /--every takes whole seconds, at least 300/);
});

test("install refuses a non-integer --every, not just one below the floor", async () => {
  // `Number.isFinite(300.5)` is true, so the floor check alone waved this through: a typo like
  // `--every 300.5` wrote a plist with a fractional `StartInterval` launchd would not run as typed.
  const home = await tempDir();
  const garden = await tempDir();
  const ran = await runFoliage(["install", "--garden", garden, "--every", "300.5"], { home });
  assert.equal(ran.status, 2, ran.output);
  assert.match(ran.output, /--every takes whole seconds, at least 300 \(got 300\.5\)/);
  assert.equal(existsSync(join(home, "Library", "LaunchAgents")), false, "a refused --every must write neither launch agent");
});

test("an invalid install interval leaves both existing launch agents unchanged", async () => {
  const home = await tempDir();
  const garden = await tempDir();
  const installed = await runFoliage(["install", "--garden", garden], { home });
  assert.equal(installed.status, 0, installed.output);
  const appPath = join(home, "Library", "LaunchAgents", "com.foliage.leaf.plist");
  const growPath = join(home, "Library", "LaunchAgents", "com.foliage.grow.plist");
  const appBefore = await readFile(appPath, "utf8");
  const growBefore = await readFile(growPath, "utf8");
  const refused = await runFoliage(["install", "--garden", garden, "--port", "4199", "--every", "1"], { home });
  assert.equal(refused.status, 2, refused.output);
  assert.equal(await readFile(appPath, "utf8"), appBefore, "the rejected install must not change the viewer's port");
  assert.equal(await readFile(growPath, "utf8"), growBefore);
});

test("review's export hint asks for public listing explicitly without sharing anything", async () => {
  const home = await tempDir();
  const garden = await tempDir();
  await writeFile(join(garden, "leaf.json"), leafDoc("Review Subject", "Unshared work"), "utf8");
  await writeFile(join(garden, "harvest.json"), JSON.stringify({ candidates: [] }), "utf8");
  const before = await readFile(join(garden, "leaf.json"), "utf8");
  const reviewed = await runFoliage(["review", "--garden", garden], { home });
  assert.equal(reviewed.status, 0, reviewed.output);
  // Runnable as printed: node and the launcher's full path, never a bare `foliage` (none is on PATH after an install).
  assert.match(reviewed.output, /foliage\.mjs' 'share' '--garden' '[^']+' <id> --as public/);
  assert.match(reviewed.output, /foliage\.mjs' 'export' '--garden' '[^']+'/);
  assert.doesNotMatch(reviewed.output, /(^|\s)foliage (share|export)/m);
  assert.equal(await readFile(join(garden, "leaf.json"), "utf8"), before);
});

test("install refuses a sources document `foliage sources` would refuse, and writes NOTHING — never a raw crash or a silently harvested bad document", async () => {
  const home = await tempDir();
  const garden = await tempDir();
  await mkdir(garden, { recursive: true });
  // A relative path is exactly what `parseSourcesDocument` refuses — see sourcesDocument.ts's own
  // header on why: it would resolve against whatever directory the scheduler happened to have.
  await writeFile(
    join(garden, "sources.json"),
    JSON.stringify({ sources: [{ kind: "git", path: "relative/path", subject: "X", identities: ["a@b.com"], addedAt: "2026-01-01T00:00:00.000Z" }] }),
    "utf8",
  );
  const ran = await runFoliage(["install", "--garden", garden], { home });
  assert.equal(ran.status, 2, ran.output);
  assert.match(ran.output, /is not a valid sources document/);
  assert.match(ran.output, /an ABSOLUTE path/);
  assert.equal(existsSync(join(home, "Library", "LaunchAgents")), false, "a refused sources document must leave no plist written");
});

test("install refuses invalid JSON in sources.json with the parser's own message, never a raw stack", async () => {
  const home = await tempDir();
  const garden = await tempDir();
  await mkdir(garden, { recursive: true });
  await writeFile(join(garden, "sources.json"), "{ not json", "utf8");
  const ran = await runFoliage(["install", "--garden", garden], { home });
  assert.equal(ran.status, 2, ran.output);
  assert.match(ran.output, /is not valid JSON/);
  assert.doesNotMatch(ran.output, /node:internal/, "a refused document must print the parser's message, never a raw stack");
  assert.equal(existsSync(join(home, "Library", "LaunchAgents")), false, "a refused sources document must leave no plist written");
});

/* -------------------------------------------------- the review shows what promote refused --- */

test("PR-F: `foliage review --resume` names a refused-duplicate promote, not just the counts row", async () => {
  // THE REPRODUCTION, measured on the owner's real garden (31 cluster leaflets, 15 stale): a
  // candidate re-approved under an id the leaf already holds. promote.ts refuses it by design
  // (":83-85" — overwriting would silently rewrite the portfolio) and harvest.mjs prints both
  // the tally (`refused-duplicate N`) and one line per refusal, id and reason. Before this fix
  // foliage.mjs kept only `g.out.trim().split("\n")[0]` — the counts row — so the person reading
  // `foliage review` never saw the refusal at all and could believe the re-approval landed.
  const home = await tempDir();
  const garden = join(await tempDir(), "subjects", "dup");
  await mkdir(garden, { recursive: true });
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  const dupId = "git-cluster:already-on-the-leaf";

  await writeFile(
    leafPath,
    JSON.stringify({
      id: "leaf:dup-test",
      subject: "Dup Subject",
      leaflets: [
        {
          id: dupId,
          title: "an entry the leaf already holds",
          tier: "pending",
          provenance: { source: "git", ref: "a".repeat(40), observedAt: "2026-08-22T00:00:00.000Z" },
        },
      ],
    }),
    "utf8",
  );
  await writeFile(
    harvestPath,
    JSON.stringify({
      candidates: [
        {
          id: dupId,
          title: "cleanup: re-approved candidate",
          evidence: [{ source: "git", ref: "b".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
          extractor: "git-cluster",
          draftedAt: "2026-08-29T00:00:00.000Z",
          review: { state: "candidate" },
        },
      ],
    }),
    "utf8",
  );

  // Approved where approvals are made, then promoted by `review --resume`, which decides nothing.
  const approved = await runHarvest(["approve", dupId, "--by", "Tester", "--doc", harvestPath]);
  assert.equal(approved.status, 0, approved.output);
  const result = await runFoliage(["review", "--resume"], { home, garden });
  assert.equal(result.status, 0, `review must succeed even when promote refuses a duplicate:\n${result.output}`);
  assert.match(
    result.output,
    /refused-duplicate 1/,
    `the counts row must still print:\n${result.output}`,
  );
  assert.match(
    result.output,
    new RegExp(`refused ${dupId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} —`),
    `the refused candidate's own id must be named, not just the tally:\n${result.output}`,
  );
  assert.match(
    result.output,
    /already exists in the target leaf/,
    `promote's own reason must reach the person, not just its first line:\n${result.output}`,
  );
  assert.match(result.output, /foliage\.mjs' 'share' '--garden' '[^']+' <id> --as public/, "the post-approval hint must list work before suggesting an index export");

  // The leaf itself is untouched by the refusal — same document, same one leaflet.
  const leafAfter = JSON.parse(await readFile(leafPath, "utf8"));
  assert.equal(leafAfter.leaflets.length, 1, "a refused duplicate must not append a second entry");
});

test("`foliage review --resume` after a promotion gives one account of the approved candidate — it said refused-duplicate 1, then that no candidate was approved", async () => {
  const home = await tempDir();
  const garden = join(await tempDir(), "resumed");
  await mkdir(garden, { recursive: true });
  const harvestPath = join(garden, "harvest.json");
  const id = "git-cluster:resumed-twice";
  await writeFile(join(garden, "leaf.json"), leafDoc("Resume Subject", "an entry already on the leaf"), "utf8");
  await writeFile(harvestPath, JSON.stringify({ candidates: [{
    id, title: "feat: a candidate promoted once", extractor: "git-cluster", draftedAt: "2026-08-29T00:00:00.000Z", review: { state: "candidate" },
    evidence: [{ source: "git", ref: "c".repeat(40), observedAt: "2026-08-29T00:00:00.000Z" }],
  }] }), "utf8");
  const approved = await runHarvest(["approve", id, "--by", "Tester", "--doc", harvestPath]);
  assert.equal(approved.status, 0, approved.output);
  const first = await runFoliage(["review", "--resume", "--garden", garden], { home });
  assert.equal(first.status, 0, first.output);
  assert.match(first.output, /harvest: promoted 1 /);
  assert.doesNotMatch(first.output, /promoted 0/);

  // Again: the approved candidate is already in the leaf. The tally, its refusal and the summary agree.
  const again = await runFoliage(["review", "--resume", "--garden", garden], { home });
  assert.equal(again.status, 0, again.output);
  assert.match(again.output, /harvest: promoted 0 {2}skipped-not-approved 0 {2}refused-duplicate 1 /);
  assert.match(again.output, new RegExp(`refused ${id} — a leaflet with id "${id}" already exists in the target leaf`));
  assert.match(again.output, /harvest: promoted 0 — the 1 approved candidate is named above with why it was not added\. The leaf was still re-validated and written unchanged in content\./);
  assert.doesNotMatch(again.output, /is approved\./, "no line may say nothing is approved while one is");
  assert.equal(JSON.parse(await readFile(join(garden, "leaf.json"), "utf8")).leaflets.length, 2, "promoted once, never twice");

  // With nothing approved at all, the summary still says so.
  await writeFile(harvestPath, JSON.stringify({ candidates: [] }), "utf8");
  const none = await runFoliage(["review", "--resume", "--garden", garden], { home });
  assert.equal(none.status, 0, none.output);
  assert.match(none.output, /harvest: promoted 0 — no candidate in .* is approved\. The leaf was still re-validated/);
});
