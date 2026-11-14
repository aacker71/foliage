/**
 * `sources.mjs`, driven as a person runs it — because the defect this pins lives at the WRITE EDGE
 * and the pure document cannot see it.
 *
 * THE CORPSE. `watch` resolved only the relative branch — `isAbsolute(given) ? given : resolve(…)`
 * — so an absolute path was stored exactly as typed. Reproduced by the three-pass review through
 * the real CLI: `watch /p/repo` then `watch /p/repo/` recorded the SAME repository twice, because
 * `addSource` and `parseSourcesDocument` both dedupe on string equality and the two strings differ.
 * A trailing slash is what shell tab-completion types, so this was the common case. `/p/./repo` and
 * `/p/repo/../repo` each added another.
 *
 * WHY IT MATTERED BEYOND TIDINESS: `unwatch /p/repo/` answered "not watching" about a repository it
 * was watching, and `foliage grow` refuses outright when more than one source is watched — so
 * tab-completing a second `watch` of ONE repository silently disabled the unattended harvest the
 * document exists to enable.
 *
 * ISOLATION: `FOLIAGE_SOURCES` points at a temp file per test; nothing here touches a real garden.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const SOURCES_CLI = fileURLToPath(new URL("../sources.mjs", import.meta.url));

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-sources-cli-"));
  tmpRoots.push(dir);
  return dir;
}

async function repo(): Promise<string> {
  const dir = await tempDir();
  await exec("git", ["init", "--quiet", "--initial-branch=main", dir], { timeout: 30_000 });
  await exec("git", ["-C", dir, "config", "user.email", "cli@example.test"], { timeout: 30_000 });
  await exec("git", ["-C", dir, "config", "user.name", "Cli Person"], { timeout: 30_000 });
  await writeFile(join(dir, "f.txt"), "x", "utf8");
  await exec("git", ["-C", dir, "add", "f.txt"], { timeout: 30_000 });
  await exec("git", ["-C", dir, "commit", "--quiet", "-m", "feat: a thing"], { timeout: 30_000 });
  return dir;
}

interface Run {
  readonly status: number;
  readonly output: string;
}

async function sources(args: readonly string[], document: string): Promise<Run> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [SOURCES_CLI, ...args], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, FOLIAGE_SOURCES: document, NO_COLOR: "1" },
    });
    return { status: 0, output: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const countIn = async (document: string): Promise<number> =>
  JSON.parse(await readFile(document, "utf8")).sources.length;

test("one repository has ONE entry, however the path is spelled", async () => {
  const document = join(await tempDir(), "sources.json");
  const dir = await repo();

  await mkdir(join(dir, "sub"), { recursive: true }); // a subdirectory resolves to the same tree
  const first = await sources(["watch", dir], document);
  assert.equal(first.status, 0, first.output);
  assert.equal(await countIn(document), 1);

  // Every spelling the review reproduced — INCLUDING the realpath one, which the first version of
  // this test asserted in its title and never exercised. `resolve()` is lexical, so `/tmp/x` and
  // `/private/tmp/x` were two repositories to it; git resolves both to one toplevel.
  const canonical = (await exec("git", ["-C", dir, "rev-parse", "--show-toplevel"], { timeout: 30_000 })).stdout.trim();
  for (const spelling of [`${dir}/`, `${dir}/.`, `${dir}/../${dir.split("/").pop()}`, canonical, join(dir, "sub")]) {
    const again = await sources(["watch", spelling], document);
    assert.equal(again.status, 1, `"${spelling}" was accepted: ${again.output}`);
    assert.match(again.output, /already watching/);
    assert.equal(await countIn(document), 1, `"${spelling}" added a second entry`);
  }
});

test("unwatch removes what watch recorded, however the path is spelled", async () => {
  // The asymmetry the review found: `unwatch /p/repo/` answered "not watching" about a repository
  // it WAS watching, because the two strings differed.
  const document = join(await tempDir(), "sources.json");
  const dir = await repo();
  await sources(["watch", dir], document);

  const gone = await sources(["unwatch", `${dir}/`], document);
  assert.equal(gone.status, 0, gone.output);
  assert.match(gone.output, /no longer watching/);
  assert.equal(await countIn(document), 0);
});

test("unwatch parses its arguments the way watch does — a stray flag is a usage error, not a path", async () => {
  // `unwatch` read `process.argv[3]` raw, so `unwatch --path x` went looking for a repository
  // literally called `--path` and answered "not watching" with exit 1. Both commands now share
  // one strict parse: an unknown option is refused with exit 2 before anything is looked up.
  const document = join(await tempDir(), "sources.json");
  const dir = await repo();
  await sources(["watch", dir], document);

  const flagged = await sources(["unwatch", "--path", dir], document);
  assert.equal(flagged.status, 2, flagged.output);
  assert.match(flagged.output, /Unknown option '--path'/);
  assert.equal(await countIn(document), 1, "a refused unwatch changed the document");

  const bare = await sources(["unwatch"], document);
  assert.equal(bare.status, 2, bare.output);
  assert.match(bare.output, /unwatch needs a path/);
});

test("a write leaves the document and nothing beside it — temp-then-rename, like every sibling", async () => {
  // `save` writes an exclusive temp file and renames it over the document, the shape policy.mjs,
  // harvest.mjs and server.mjs share, so a crash mid-write leaves the previous document whole.
  // What can be held cheaply from outside: the rename actually happened (the temp is gone, the
  // document is there) and what arrived loads back through the same parser the next run uses.
  const garden = await tempDir();
  const document = join(garden, "sources.json");
  const dir = await repo();
  assert.equal((await sources(["watch", dir], document)).status, 0);
  assert.deepEqual(await readdir(garden), ["sources.json"]);
  const listed = await sources(["list"], document);
  assert.equal(listed.status, 0, listed.output);
  assert.match(listed.output, /1 watched/);
});

test("a path that is not a git repository is refused, with the reason", async () => {
  const document = join(await tempDir(), "sources.json");
  const plain = await tempDir();
  const refused = await sources(["watch", plain], document);
  assert.equal(refused.status, 1);
  assert.match(refused.output, /is not inside a git repository/);
  // …and would fail on every scheduled run rather than once, here, now.
  assert.match(refused.output, /every scheduled run instead of once/);
});


test("a directory holding an empty .git is REFUSED — git decides, not the presence of a name", async () => {
  // The old check was `existsSync(join(path, ".git"))`, which accepted this while git calls it
  // "not a git repository". Watching it would have failed on every scheduled run instead of once,
  // here, now — which is the exact promise the refusal below makes.
  const document = join(await tempDir(), "sources.json");
  const fake = await tempDir();
  await mkdir(join(fake, ".git"), { recursive: true });
  const refused = await sources(["watch", fake], document);
  assert.equal(refused.status, 1, refused.output);
  assert.match(refused.output, /is not inside a git repository/);
  assert.match(refused.output, /git said:/);
});

test("unwatch still works when the repository has been DELETED", async () => {
  // `watch` may assume the tree exists; `unwatch` may not. Asking git about a path that is gone
  // fails, so the lexical fallback is what lets somebody remove a source whose repository they have
  // since deleted or moved — the case a naive realpath-everywhere fix would have broken.
  const document = join(await tempDir(), "sources.json");
  const dir = await repo();
  await sources(["watch", dir], document);
  const recorded = JSON.parse(await readFile(document, "utf8")).sources[0].path;

  await rm(dir, { recursive: true, force: true });
  const gone = await sources(["unwatch", recorded], document);
  assert.equal(gone.status, 0, gone.output);
  assert.equal(await countIn(document), 0);
});
