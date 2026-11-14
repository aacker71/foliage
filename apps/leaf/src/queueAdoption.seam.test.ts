/**
 * `foliage migrate-queue` → `harvest.mjs adopt`, driven through the real CLIs against a REAL
 * throwaway repository and garden. The stuck shape is the one measured on the owner's garden: an
 * approved cluster that grew after its leaflet was promoted, a newer primary ref, and a harvest
 * that records no binding. Every commit, title and document here is synthetic input written by
 * this file; no real history or garden is read.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { withDocumentLocks } from "@foliage/leaf/local-files";
import { reviewSubjectDigest } from "@foliage/photosynthesis";

const exec = promisify(execFile);
const FOLIAGE = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const HARVEST_CLI = fileURLToPath(new URL("../harvest.mjs", import.meta.url));
const EMAIL = "adopt-seam@example.test";
const observedAt = "2026-08-22T09:00:00Z";

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

const git = (repo: string, ...args: string[]) => exec("git", ["-C", repo, ...args], { timeout: 30_000 });

async function commit(repo: string, subject: string, date: string): Promise<string> {
  const file = `f-${Math.random().toString(16).slice(2)}.txt`;
  await writeFile(join(repo, file), subject, "utf8");
  await git(repo, "add", file);
  await exec("git", ["-C", repo, "-c", "user.name=Adopt Seam", "-c", `user.email=${EMAIL}`, "commit", "-q", "--no-gpg-sign", "-m", subject],
    { timeout: 30_000, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  return (await git(repo, "rev-parse", "HEAD")).stdout.trim();
}

interface Run { readonly code: number; readonly text: string }

async function run(script: string, args: readonly string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [script, ...args], { encoding: "utf8", timeout: 60_000 });
    return { code: 0, text: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : 1, text: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const APPROVED_TITLE = "feat: third; second; first";
const OLD_TITLE = "feat: second; first";
const ID = "git-cluster:feat";

/**
 * A repository of three `feat:` commits, a leaf whose leaflet holds the older two, and an unbound
 * harvest whose approval holds all three — newest first, so the primary ref moved.
 */
async function stuckGarden(
  options: {
    readonly extraRef?: string;
    /** The repository the harvest records, as `grow` would have written it. */
    readonly recordedRepo?: (repo: string) => Promise<string>;
    /** An EXCLUDED leaflet holding the newest commit — the one the approval adds. */
    readonly excludeNewest?: boolean;
  } = {},
) {
  const repo = await tempDir("foliage-adopt-repo-");
  await git(repo, "init", "--quiet", "--initial-branch=main");
  const first = await commit(repo, "feat: first", "2026-08-01T10:00:00+02:00");
  const second = await commit(repo, "feat: second", "2026-08-02T10:00:00Z");
  const third = await commit(repo, "feat: third", "2026-08-03T10:00:00Z");
  const root = (await git(repo, "rev-parse", "--show-toplevel")).stdout.trim();

  const garden = await tempDir("foliage-adopt-garden-");
  const leafPath = join(garden, "leaf.json");
  const harvestPath = join(garden, "harvest.json");
  const workflowPath = join(garden, "workflow", "workflow.json");
  const excerpt = new Map([[first, "feat: first"], [second, "feat: second"], [third, "feat: third"]]);

  await writeFile(leafPath, `${JSON.stringify({
    id: "leaf:adopt-seam",
    subject: "Adopt Seam",
    leaflets: [{
      id: ID,
      title: OLD_TITLE,
      tier: "pending",
      provenance: { source: "photosynthesis:git-cluster", ref: second, observedAt },
      body: [second, first].map((ref) => ({ provenance: { source: "git", ref, observedAt }, text: excerpt.get(ref) })),
    }, ...(options.excludeNewest === true
      ? [{ id: "git:excluded", title: "feat: third", tier: "excluded", reason: "not this person's work", provenance: { source: "git", ref: third, observedAt } }]
      : [])],
  }, null, 2)}\n`);

  const refs = [third, second, first, ...(options.extraRef === undefined ? [] : [options.extraRef])];
  const material = {
    id: ID,
    title: APPROVED_TITLE,
    evidence: refs.map((ref) => ({ source: "git", ref, observedAt, excerpt: excerpt.get(ref) ?? "feat: not in this repository" })),
    extractor: "git-cluster",
  };
  const recorded = options.recordedRepo === undefined ? undefined : await options.recordedRepo(repo);
  await writeFile(harvestPath, `${JSON.stringify({
    ...(recorded === undefined ? {} : { repo: recorded }),
    candidates: [{
      ...material,
      draftedAt: observedAt,
      review: { state: "approved", by: "Adopt Seam", at: "2026-08-29T09:00:00Z", subjectDigest: reviewSubjectDigest(material) },
    }],
  }, null, 2)}\n`);

  // The owner's garden has no watched source and ONE enabled workflow source; migrate-queue reads it.
  await mkdir(join(garden, "workflow"), { recursive: true });
  await writeFile(workflowPath, `${JSON.stringify({
    version: 1, schedule: null, proposals: [], history: [], nextAt: null, attempt: 0, running: false,
    sources: [{ id: "seam", path: repo, email: EMAIL, enabled: true }],
  }, null, 2)}\n`);

  return { repo, root, garden, leafPath, harvestPath, workflowPath, recorded, first, second, third };
}

const snapshot = async (paths: readonly string[]) => Promise.all(paths.map((p) => readFile(p, "utf8")));
const backups = async (garden: string) => (await readdir(garden)).filter((f) => f.includes(".before-adopt-")).sort();

test("migrate-queue dry run prints the change and leaves every file byte-identical", async () => {
  const g = await stuckGarden();
  const files = [g.harvestPath, g.leafPath, g.workflowPath];
  const before = await snapshot(files);
  const dry = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden]);
  assert.equal(dry.code, 0, dry.text);
  assert.match(dry.text, new RegExp(`${ID}  \\+1`));
  assert.match(dry.text, new RegExp(`was\\s+${OLD_TITLE}`));
  assert.match(dry.text, new RegExp(`approved\\s+${APPROVED_TITLE}`));
  assert.match(dry.text, /dry run — nothing written/);
  assert.match(dry.text, new RegExp(`repo\\s+${g.root}`), "the repository came from the one enabled workflow source");
  assert.deepEqual(await snapshot(files), before);
  assert.deepEqual(await backups(g.garden), []);
});

test("--apply backs up, lands the approved body in place as private, and moves no digest; a second --apply writes nothing", async () => {
  const g = await stuckGarden();
  const [harvestBefore = "", leafBefore = ""] = await snapshot([g.harvestPath, g.leafPath]);
  const applied = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden, "--apply"]);
  assert.equal(applied.code, 0, applied.text);

  const saved = await backups(g.garden);
  assert.equal(saved.length, 2, saved.join(", "));
  const byName = new Map(await Promise.all(saved.map(async (f) => [f.split(".")[0] ?? f, await readFile(join(g.garden, f), "utf8")] as const)));
  assert.equal(byName.get("harvest"), harvestBefore, "the harvest backup is the old bytes");
  assert.equal(byName.get("leaf"), leafBefore, "the leaf backup is the old bytes");

  const leaf = JSON.parse(await readFile(g.leafPath, "utf8"));
  assert.equal(leaf.leaflets.length, 1, "replaced in place, nothing appended");
  const leaflet = leaf.leaflets[0];
  assert.equal(leaflet.title, APPROVED_TITLE);
  assert.equal(leaflet.provenance.ref, g.third);
  assert.deepEqual(leaflet.body.map((e: { provenance: { ref: string } }) => e.provenance.ref), [g.third, g.second, g.first]);
  assert.equal("visibility" in leaflet, false, "private, spelled by absence as before");

  const before = JSON.parse(harvestBefore);
  const harvest = JSON.parse(await readFile(g.harvestPath, "utf8"));
  assert.equal(harvest.subject, "Adopt Seam");
  assert.equal(harvest.leafId, "leaf:adopt-seam");
  assert.equal(harvest.repo, g.root);
  assert.deepEqual(harvest.candidates[0].review, before.candidates[0].review, "the decision is untouched");
  assert.equal(reviewSubjectDigest(harvest.candidates[0]), reviewSubjectDigest(before.candidates[0]));
  assert.equal(reviewSubjectDigest(harvest.candidates[0]), before.candidates[0].review.subjectDigest);
  assert.deepEqual(
    harvest.candidates[0].evidence.map((e: { authoredAt?: string }) => e.authoredAt),
    ["2026-08-03T10:00:00Z", "2026-08-02T10:00:00Z", "2026-08-01T10:00:00+02:00"],
    "git's own author dates, offset kept",
  );

  const [leafMtime, harvestMtime] = await Promise.all([stat(g.leafPath), stat(g.harvestPath)]).then((s) => s.map((x) => x.mtimeMs));
  const [leafAfter, harvestAfter] = await snapshot([g.leafPath, g.harvestPath]);
  const again = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden, "--apply"]);
  assert.equal(again.code, 0, again.text);
  assert.match(again.text, /already adopted — nothing written/);
  assert.deepEqual(await snapshot([g.leafPath, g.harvestPath]), [leafAfter, harvestAfter]);
  assert.equal((await stat(g.leafPath)).mtimeMs, leafMtime, "the leaf was not rewritten");
  assert.equal((await stat(g.harvestPath)).mtimeMs, harvestMtime, "the harvest was not rewritten");
  assert.equal((await backups(g.garden)).length, 2, "no second backup");
});

test("a held lock on either document refuses by name and writes nothing", async () => {
  const g = await stuckGarden();
  const files = [g.harvestPath, g.leafPath];
  const before = await snapshot(files);
  for (const held of files) {
    await withDocumentLocks([held], async () => {
      const refused = await run(HARVEST_CLI, ["adopt", "--doc", g.harvestPath, "--into", g.leafPath, "--repo", g.repo, "--apply"]);
      assert.notEqual(refused.code, 0, `${held}: ${refused.text}`);
      assert.match(refused.text, /local document busy/, held);
      assert.match(refused.text, /Nothing was written/, held);
    });
    assert.deepEqual(await snapshot(files), before, held);
    assert.deepEqual(await backups(g.garden), [], held);
  }
});

test("a ref the repository does not hold refuses the whole run, the sha named, nothing written", async () => {
  const absent = "0123456789abcdef0123456789abcdef01234567";
  const g = await stuckGarden({ extraRef: absent });
  const files = [g.harvestPath, g.leafPath];
  const before = await snapshot(files);
  const refused = await run(HARVEST_CLI, ["adopt", "--doc", g.harvestPath, "--into", g.leafPath, "--repo", g.repo, "--apply"]);
  assert.notEqual(refused.code, 0, refused.text);
  assert.match(refused.text, /Commits missing from the repository \(missing-commit\)/);
  assert.match(refused.text, new RegExp(absent));
  assert.deepEqual(await snapshot(files), before);
  assert.deepEqual(await backups(g.garden), []);
});

test("an abbreviated sha git holds is dated under its own spelling; a branch name is not a commit", async () => {
  const g = await stuckGarden();
  const writeRef = async (ref: string) => {
    const material = { id: "git-cluster:short", title: "feat: third", evidence: [{ source: "git", ref, observedAt, excerpt: "feat: third" }], extractor: "git-cluster" };
    await writeFile(g.harvestPath, `${JSON.stringify({
      candidates: [{ ...material, draftedAt: observedAt, review: { state: "approved", by: "Adopt Seam", at: "2026-08-29T09:00:00Z", subjectDigest: reviewSubjectDigest(material) } }],
    }, null, 2)}\n`);
  };
  const short = g.third.slice(0, 12);
  await writeRef(short);
  const held = await run(HARVEST_CLI, ["adopt", "--doc", g.harvestPath, "--into", g.leafPath, "--repo", g.repo, "--apply"]);
  assert.equal(held.code, 0, held.text);
  const evidence = JSON.parse(await readFile(g.harvestPath, "utf8")).candidates[0].evidence[0];
  assert.deepEqual([evidence.ref, evidence.authoredAt], [short, "2026-08-03T10:00:00Z"]);

  await writeRef("main");
  const refused = await run(HARVEST_CLI, ["adopt", "--doc", g.harvestPath, "--into", g.leafPath, "--repo", g.repo]);
  assert.notEqual(refused.code, 0, refused.text);
  assert.match(refused.text, /\(missing-commit\)\nharvest:\s+main\n/);
});

test("migrate-queue with no way to name the repository refuses and says what it found", async () => {
  const g = await stuckGarden();
  await rm(g.workflowPath);
  const refused = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden]);
  assert.equal(refused.code, 2, refused.text);
  assert.match(refused.text, /migrate-queue needs --repo/);
  assert.match(refused.text, /watched\s+0/);
  assert.match(refused.text, /workflow\s+0/);
});

test("an excluded leaflet holding a commit the approval adds refuses the dry run and --apply alike, nothing written", async () => {
  const g = await stuckGarden({ excludeNewest: true });
  const files = [g.harvestPath, g.leafPath];
  const before = await snapshot(files);
  for (const mode of [[], ["--apply"]]) {
    const refused = await run(HARVEST_CLI, ["adopt", "--doc", g.harvestPath, "--into", g.leafPath, "--repo", g.repo, ...mode]);
    assert.notEqual(refused.code, 0, refused.text);
    assert.match(refused.text, new RegExp(`promotion did not land ${ID}`));
    assert.doesNotMatch(refused.text, /dry run — nothing written/);
    assert.deepEqual(await snapshot(files), before);
    assert.deepEqual(await backups(g.garden), []);
  }
});

test("a waiting approval resting on an excluded commit refuses the dry run and --apply alike, nothing written", async () => {
  // No extension is involved: the approved candidate has no leaflet yet, so only the leaf's
  // exclusions stop it — promotion would otherwise leave it out and report success.
  const g = await stuckGarden({ excludeNewest: true });
  const FRESH = "git-cluster:fresh";
  const material = {
    id: FRESH,
    title: "feat: third",
    evidence: [{ source: "git", ref: g.third, observedAt, excerpt: "feat: third" }],
    extractor: "git-cluster",
  };
  await writeFile(g.harvestPath, `${JSON.stringify({
    candidates: [{
      ...material,
      draftedAt: observedAt,
      review: { state: "approved", by: "Adopt Seam", at: "2026-08-29T09:00:00Z", subjectDigest: reviewSubjectDigest(material) },
    }],
  }, null, 2)}\n`);
  const files = [g.harvestPath, g.leafPath];
  const before = await snapshot(files);
  for (const mode of [[], ["--apply"]]) {
    const refused = await run(HARVEST_CLI, ["adopt", "--doc", g.harvestPath, "--into", g.leafPath, "--repo", g.repo, ...mode]);
    assert.notEqual(refused.code, 0, refused.text);
    assert.match(refused.text, /extend\s+0/, "no extension is in play");
    assert.match(refused.text, new RegExp(`promotion did not land ${FRESH}`));
    assert.doesNotMatch(refused.text, /dry run — nothing written/);
    assert.deepEqual(await snapshot(files), before);
    assert.deepEqual(await backups(g.garden), []);
  }
});

test("a held commit with no author date is adopted undated: the dry run and --apply agree", async () => {
  const g = await stuckGarden();
  // A commit object whose author line carries no date — git prints `%aI` verbatim for it.
  const tree = (await git(g.repo, "rev-parse", "HEAD^{tree}")).stdout.trim();
  const object = `tree ${tree}\nparent ${g.third}\nauthor Adopt Seam <${EMAIL}>\ncommitter Adopt Seam <${EMAIL}> 1756800000 +0000\n\nfeat: undated\n`;
  const undatedPath = join(g.garden, "undated-commit.txt");
  await writeFile(undatedPath, object, "utf8");
  const undated = (await git(g.repo, "hash-object", "-t", "commit", "-w", "--literally", undatedPath)).stdout.trim();
  await rm(undatedPath);
  assert.equal((await git(g.repo, "log", "--no-walk", "--format=%aI", undated)).stdout.trim(), "%aI", "git has no date to print");

  const UNDATED = "git-cluster:undated";
  const material = { id: UNDATED, title: "feat: undated", evidence: [{ source: "git", ref: undated, observedAt, excerpt: "feat: undated" }], extractor: "git-cluster" };
  const doc = JSON.parse(await readFile(g.harvestPath, "utf8"));
  await writeFile(g.harvestPath, `${JSON.stringify({
    ...doc,
    candidates: [...doc.candidates, {
      ...material,
      draftedAt: observedAt,
      review: { state: "approved", by: "Adopt Seam", at: "2026-08-29T09:00:00Z", subjectDigest: reviewSubjectDigest(material) },
    }],
  }, null, 2)}\n`);

  const files = [g.harvestPath, g.leafPath];
  const before = await snapshot(files);
  const args = ["adopt", "--doc", g.harvestPath, "--into", g.leafPath, "--repo", g.repo];
  const dry = await run(HARVEST_CLI, args);
  assert.equal(dry.code, 0, dry.text);
  assert.match(dry.text, /dated\s+3\n/);
  assert.match(dry.text, new RegExp(`waiting\\s+1\\n.*${UNDATED}`));
  assert.match(dry.text, /dry run — nothing written/);
  assert.deepEqual(await snapshot(files), before);

  const applied = await run(HARVEST_CLI, [...args, "--apply"]);
  assert.equal(applied.code, 0, applied.text);
  const harvest = JSON.parse(await readFile(g.harvestPath, "utf8"));
  const evidence = harvest.candidates.flatMap((c: { evidence: { ref: string; authoredAt?: string }[] }) => c.evidence);
  assert.equal("authoredAt" in evidence.find((e: { ref: string }) => e.ref === undated), false, "held, undated");
  assert.equal(evidence.find((e: { ref: string }) => e.ref === g.third).authoredAt, "2026-08-03T10:00:00Z");
  const leaflets = JSON.parse(await readFile(g.leafPath, "utf8")).leaflets;
  assert.deepEqual(leaflets.map((l: { id: string }) => l.id), [ID, UNDATED], "the extension in place, the undated approval appended");
  assert.equal(leaflets[0].title, APPROVED_TITLE);
});

test("a recorded repository that is a subdirectory under a symlinked spelling is the same repository", async () => {
  const links = await tempDir("foliage-adopt-link-");
  const g = await stuckGarden({
    recordedRepo: async (repo) => {
      await mkdir(join(repo, "sub"));
      await symlink(repo, join(links, "repo"));
      return join(links, "repo", "sub");
    },
  });
  const dry = await run(HARVEST_CLI, ["adopt", "--doc", g.harvestPath, "--into", g.leafPath, "--repo", g.repo]);
  assert.equal(dry.code, 0, dry.text);
  assert.doesNotMatch(dry.text, /binding-mismatch/);
  const applied = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden, "--apply"]);
  assert.equal(applied.code, 0, applied.text);
  const harvest = JSON.parse(await readFile(g.harvestPath, "utf8"));
  assert.equal(harvest.repo, g.recorded, "grow's recorded spelling is kept");
  assert.equal(JSON.parse(await readFile(g.leafPath, "utf8")).leaflets[0].title, APPROVED_TITLE);
});

/* ---- which repository migrate-queue names when --repo is absent ---- */

async function otherRepo(): Promise<string> {
  const repo = await tempDir("foliage-adopt-other-");
  await git(repo, "init", "--quiet", "--initial-branch=main");
  return repo;
}

const writeWatched = (garden: string, paths: readonly string[]) =>
  writeFile(join(garden, "sources.json"), `${JSON.stringify({
    sources: paths.map((path) => ({ kind: "git", path, subject: "Adopt Seam", identities: [EMAIL], addedAt: observedAt })),
  }, null, 2)}\n`);

const writeWorkflow = (path: string, sources: readonly { readonly path: string; readonly enabled: boolean }[]) =>
  writeFile(path, `${JSON.stringify({
    version: 1, schedule: null, proposals: [], history: [], nextAt: null, attempt: 0, running: false,
    sources: sources.map((s, i) => ({ id: `seam${i}`, path: s.path, email: EMAIL, enabled: s.enabled })),
  }, null, 2)}\n`);

test("migrate-queue: the harvest's recorded repository wins over a different watched or workflow source", async () => {
  const g = await stuckGarden({ recordedRepo: async (repo) => repo });
  const other = await otherRepo();
  await writeWorkflow(g.workflowPath, [{ path: other, enabled: true }]);
  const overWorkflow = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden]);
  assert.equal(overWorkflow.code, 0, overWorkflow.text);
  assert.match(overWorkflow.text, new RegExp(`repo\\s+${g.recorded}\\n`));
  await writeWatched(g.garden, [other]);
  const overWatched = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden]);
  assert.equal(overWatched.code, 0, overWatched.text);
  assert.match(overWatched.text, new RegExp(`repo\\s+${g.recorded}\\n`));
});

test("migrate-queue: one watched source is chosen over an enabled workflow source", async () => {
  const g = await stuckGarden();
  await writeWatched(g.garden, [g.repo]);
  await writeWorkflow(g.workflowPath, [{ path: await otherRepo(), enabled: true }]);
  const dry = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden]);
  assert.equal(dry.code, 0, dry.text);
  assert.match(dry.text, new RegExp(`repo\\s+${g.root}\\n`));
});

test("migrate-queue: two watched sources refuse and name both, even beside one workflow source", async () => {
  const g = await stuckGarden();
  const other = await otherRepo();
  await writeWatched(g.garden, [g.repo, other]);
  const refused = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden]);
  assert.equal(refused.code, 2, refused.text);
  assert.match(refused.text, /migrate-queue needs --repo/);
  assert.match(refused.text, /watched\s+2/);
  assert.ok(refused.text.includes(g.repo) && refused.text.includes(other), refused.text);
  assert.match(refused.text, /workflow\s+1/);
});

test("migrate-queue: a disabled workflow source is not counted", async () => {
  const g = await stuckGarden();
  await writeWorkflow(g.workflowPath, [{ path: g.repo, enabled: false }]);
  const refused = await run(FOLIAGE, ["migrate-queue", "--garden", g.garden]);
  assert.equal(refused.code, 2, refused.text);
  assert.match(refused.text, /workflow\s+0/);
});
