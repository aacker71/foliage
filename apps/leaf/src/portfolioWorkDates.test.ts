/** Real temporary Git repositories with explicitly dated protocol commits exercise source
 * metadata, scope, fallback and caching. These are not portfolio achievements or proof claims. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { commitsToLeaflets, parseLeafDocument, type Leaf } from "@foliage/leaf";
import { readCommits } from "@foliage/leaf/git-source";
import { portfolioTimeline } from "./portfolioTimeline.ts";
import { loadPortfolioWorkDates } from "./portfolioWorkDates.ts";

const exec = promisify(execFile);
const owner = "work-date-owner@protocol.invalid";
let directory: string;
let repo: string;
let leaf: Leaf;
let foreign: Leaf;

async function repository(path: string, authors: readonly { email: string; at: string }[]): Promise<Leaf> {
  await exec("git", ["init", "--initial-branch=main", path]);
  for (const [index, author] of authors.entries()) {
    const file = `work-date-protocol-${index}.txt`;
    await writeFile(join(path, file), "Temporary source metadata protocol artifact.\n");
    await exec("git", ["-C", path, "add", file]);
    await exec("git", ["-C", path, "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-m", `test: work-date source protocol ${index}`],
      { env: { ...process.env, GIT_AUTHOR_NAME: "Work date protocol", GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: "Work date protocol", GIT_COMMITTER_EMAIL: author.email,
        GIT_AUTHOR_DATE: author.at, GIT_COMMITTER_DATE: author.at } });
  }
  const read = await readCommits(path);
  assert.ok(read.ok);
  const intake = commitsToLeaflets({ commits: read.commits, identities: [owner], observedAt: new Date().toISOString() });
  assert.ok(intake.ok);
  const parsed = parseLeafDocument({ id: "work-date-protocol", subject: "Work date protocol", leaflets: intake.leaflets });
  assert.ok(parsed.ok);
  return parsed.leaf;
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "foliage-work-dates-"));
  repo = join(directory, "authorized-source");
  leaf = await repository(repo, [
    { email: owner, at: "2024-05-11T08:00:00-06:00" },
    { email: owner, at: "2026-06-19T13:00:00-06:00" },
    { email: "other-author@protocol.invalid", at: "2026-08-04T09:00:00-06:00" },
  ]);
  foreign = await repository(join(directory, "different-source"), [{ email: owner, at: "2025-03-02T10:00:00Z" }]);
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("actual Git authored dates bind exact retained references without copying excluded history", async () => {
  const before = JSON.stringify(leaf);
  const result = await loadPortfolioWorkDates(leaf, { FOLIAGE_SOURCE_REPO: repo });
  assert.equal(result.status, "ready");
  assert.equal(result.reason, null);
  assert.equal(result.requested, 2);
  assert.equal(result.resolved, 2);
  const owned = leaf.leaflets.filter(record => record.tier !== "excluded");
  for (const record of owned) {
    const ref = record.provenance!.ref;
    const { stdout } = await exec("git", ["-C", repo, "show", "-s", "--format=%aI", ref]);
    assert.deepEqual(result.dates.get(ref), { source: "git", ref, authoredAt: stdout.trim() });
    assert.notEqual(result.dates.get(ref)!.authoredAt, record.provenance!.observedAt);
  }
  for (const record of leaf.leaflets.filter(record => record.tier === "excluded")) assert.equal(result.dates.has(record.provenance!.ref), false);
  assert.deepEqual(portfolioTimeline(leaf, "oldest", result.dates).entries.map(entry => entry.record.id), [...owned].reverse().map(record => record.id));
  assert.equal(portfolioTimeline(leaf, "newest", result.dates).undatedCount, 0);
  assert.equal(JSON.stringify(leaf), before, "source enrichment must leave the saved document untouched");
});

test("repository scope is explicit and absent configuration never reuses another lookup's dates", async () => {
  const absent = await loadPortfolioWorkDates(leaf, {});
  assert.equal(absent.status, "unconfigured");
  assert.equal(absent.dates.size, 0);
  assert.match(absent.reason!, /No repository configured/);
  const onlyExcluded = { ...leaf, leaflets: leaf.leaflets.filter(record => record.tier === "excluded") };
  const empty = await loadPortfolioWorkDates(onlyExcluded, { FOLIAGE_SOURCE_REPO: repo });
  assert.equal(empty.status, "no-git-evidence");
  assert.equal(empty.requested, 0);
  assert.equal(empty.dates.size, 0);
});

test("a missing retained object uses one visible fallback and leaves unmatched work undated", async () => {
  const fallbackRepo = join(directory, "fallback-source");
  await exec("git", ["clone", "--no-hardlinks", repo, fallbackRepo]);
  const mixed = { ...leaf, leaflets: [...leaf.leaflets, ...foreign.leaflets] };
  const result = await loadPortfolioWorkDates(mixed, { FOLIAGE_SOURCE_REPO: fallbackRepo });
  assert.equal(result.status, "partial");
  assert.equal(result.requested, 3);
  assert.equal(result.resolved, 2);
  assert.match(result.reason!, /Git read failed/);
  assert.match(result.reason!, /Read HEAD history instead/);
  assert.equal(result.dates.has(foreign.leaflets[0]!.provenance!.ref), false);
  const view = portfolioTimeline(mixed, "newest", result.dates);
  assert.equal(view.entries.at(-1)!.record.id, foreign.leaflets[0]!.id);
  assert.equal(view.entries.at(-1)!.workAt, null);
  assert.equal(view.entries.at(-1)!.dateBasis, "observed");
  assert.equal(view.undatedCount, 1);
});

test("successful immutable source facts survive repeated reads without another Git process", async () => {
  const env = { FOLIAGE_SOURCE_REPO: repo };
  const initial = await loadPortfolioWorkDates(leaf, env);
  const moved = `${repo}-temporarily-unavailable`;
  await rename(repo, moved);
  try {
    // If the loader spawned Git again this would fail: the explicit path is now absent.
    const cached = await loadPortfolioWorkDates(leaf, env);
    assert.equal(cached.status, "ready");
    assert.equal(cached.revision, initial.revision);
    assert.deepEqual(cached.dates, initial.dates);
    const reordered = await loadPortfolioWorkDates({ ...leaf, leaflets: [...leaf.leaflets].reverse() }, env);
    assert.equal(reordered.revision, initial.revision, "source-fact revision is independent from portfolio presentation order");
  } finally { await rename(moved, repo); }
});

test("both failed causes remain visible, failed lookup is throttled, and recovery changes its revision", async t => {
  const unavailable = join(directory, "not-yet-present");
  const env = { FOLIAGE_SOURCE_REPO: unavailable };
  const failed = await loadPortfolioWorkDates(leaf, env);
  assert.equal(failed.status, "unavailable");
  assert.match(failed.reason!, /Git read failed/);
  assert.match(failed.reason!, /HEAD history read failed/);
  await exec("git", ["clone", "--no-hardlinks", repo, unavailable]);
  const throttled = await loadPortfolioWorkDates(leaf, env);
  assert.equal(throttled.status, "unavailable");
  assert.equal(throttled.revision, failed.revision, "the five-second reader cadence must not trigger immediate retry");
  const later = Date.now() + 60_000;
  t.mock.method(Date, "now", () => later);
  const recovered = await loadPortfolioWorkDates(leaf, env);
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.reason, null);
  assert.notEqual(recovered.revision, failed.revision);
  assert.equal(recovered.resolved, 2);
});
