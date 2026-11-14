/** Curation protocol tests use real temporary unsigned Git commits. Owner choices here
 * exercise presentation and preservation only; they assert no career achievement or score. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { parseLeafDocument } from "./document.ts";
import { readCommits } from "./gitSource.ts";
import { commitsToLeaflets, type ObservedCommit } from "./intake.ts";
import { featuredLeaflets, MAX_FEATURED_LEAFLETS, type Leaf, type Leaflet } from "./leaf.ts";
import { mergeIntakeIntoLeaf } from "./merge.ts";

const exec = promisify(execFile);
const owner = "curation-owner@protocol.invalid";
const other = "curation-other@protocol.invalid";
let directory: string;
let observed: readonly ObservedCommit[];
let leaf: Leaf;
let owned: readonly Leaflet[];
let excluded: Leaflet;

function derive(identity: string, at = new Date().toISOString()): readonly Leaflet[] {
  const result = commitsToLeaflets({ commits: observed, identities: [identity], observedAt: at });
  assert.ok(result.ok);
  return result.leaflets;
}
function parsed(value: unknown): Leaf {
  const result = parseLeafDocument(value);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result.issues));
  return result.leaf;
}
function curated(featured: readonly string[]): Leaf {
  return parsed({ ...leaf, curation: { featured } });
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "foliage-curation-domain-"));
  await exec("git", ["init", "--initial-branch=main", directory]);
  for (const [index, email] of [owner, owner, other].entries()) {
    const file = `curation-protocol-${index}.txt`;
    await writeFile(join(directory, file), "Temporary artifact for the curation persistence protocol.\n");
    await exec("git", ["-C", directory, "add", file]);
    await exec("git", ["-C", directory, "-c", "user.name=Curation protocol", "-c", `user.email=${email}`, "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-m", `test: curation protocol artifact ${index}`]);
  }
  const read = await readCommits(directory);
  assert.ok(read.ok);
  observed = read.commits;
  leaf = parsed({ id: "curation-protocol", subject: "Curation protocol", leaflets: derive(owner) });
  owned = leaf.leaflets.filter(item => item.tier === "pending");
  const otherRecord = leaf.leaflets.find(item => item.tier === "excluded");
  assert.equal(owned.length, 2);
  assert.ok(otherRecord);
  excluded = otherRecord;
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("old documents remain unchanged and empty selection is an explicit, portable choice", () => {
  assert.equal("curation" in leaf, false);
  assert.deepEqual(featuredLeaflets(leaf), []);
  assert.equal("curation" in parsed(JSON.parse(JSON.stringify(leaf))), false);
  const empty = curated([]);
  assert.deepEqual(empty.curation, { featured: [] });
  assert.deepEqual(parsed(JSON.parse(JSON.stringify(empty))).curation, empty.curation);
  assert.deepEqual(featuredLeaflets(empty), []);
});

test("owner order survives parsing without changing document order or attribution", () => {
  const choices = [owned[1]!.id, owned[0]!.id];
  const result = curated(choices);
  assert.deepEqual(result.curation?.featured, choices);
  assert.deepEqual(featuredLeaflets(result).map(item => item.id), choices);
  assert.deepEqual(result.leaflets, leaf.leaflets);
  assert.deepEqual(parsed(JSON.parse(JSON.stringify(result))), result);
  assert.ok(Object.isFrozen(result.curation));
  assert.ok(Object.isFrozen(result.curation!.featured));
  choices.reverse();
  assert.equal(result.curation!.featured[0], owned[1]!.id, "parser must detach saved choices from caller arrays");
});

test("unavailable choices remain saved while only existing non-excluded work resolves", () => {
  const choices = ["unavailable-protocol-record", excluded.id, owned[1]!.id, owned[0]!.id];
  const result = curated(choices);
  assert.deepEqual(result.curation?.featured, choices);
  assert.equal(result.curation!.featured[0], "unavailable-protocol-record", "a missing leading tip is not silently replaced");
  assert.deepEqual(featuredLeaflets(result).map(item => item.id), [owned[1]!.id, owned[0]!.id]);
  assert.deepEqual(parsed(JSON.parse(JSON.stringify(result))).curation, result.curation);
  assert.equal(result.leaflets.find(item => item.id === excluded.id)?.tier, "excluded");
});

test("curation accepts at most twelve distinct bounded IDs and rejects unknown fields", () => {
  const twelve = Array.from({ length: MAX_FEATURED_LEAFLETS }, (_, index) => `unavailable-protocol-${index}`);
  assert.equal(curated(twelve).curation!.featured.length, 12);
  const invalid = [null, undefined, [], "ordered", 1, {}, { featured: null }, { featured: "one" },
    { featured: [owned[0]!.id, owned[0]!.id] }, { featured: [""] }, { featured: ["  "] },
    { featured: [1] }, { featured: [{}] }, { featured: ["x".repeat(301)] },
    { featured: [...twelve, "thirteenth-protocol-choice"] }, { featured: [], surprise: true }, { featured: [], score: 90 }];
  for (const value of invalid) {
    const result = parseLeafDocument({ ...leaf, curation: value });
    assert.equal(result.ok, false, `invalid curation protocol input was accepted: ${JSON.stringify(value)}`);
  }
  const scored = parseLeafDocument({ ...leaf, curation: { featured: [], score: 90 } });
  assert.ok(!scored.ok);
  assert.ok(scored.issues.some(issue => issue.at === "curation.score" && /refused by name/.test(issue.message)));
});

test("a source refresh preserves exact owner choices and headline while updating evidence", () => {
  const existing = parsed({ ...curated([owned[1]!.id, owned[0]!.id]), headline: "Curation preservation protocol" });
  const refreshed = mergeIntakeIntoLeaf({ existing: { state: "present", leaf: existing }, derived: derive(owner, "2026-09-10T12:00:00Z"), incomingId: leaf.id, incomingSubject: leaf.subject });
  assert.ok(refreshed.ok);
  assert.deepEqual(refreshed.leaf.curation, existing.curation);
  assert.equal(refreshed.leaf.headline, existing.headline);
  assert.deepEqual(featuredLeaflets(refreshed.leaf).map(item => item.id), existing.curation!.featured);
  assert.deepEqual(parsed(JSON.parse(JSON.stringify(refreshed.leaf))).curation, existing.curation);
  // Every record was re-derived; a re-read alone keeps rows as they were (QA 2026-10-02 #11).
  assert.equal(refreshed.kept.length + refreshed.updated.length, existing.leaflets.length);
});

test("reattribution keeps unavailable owner choices without blocking the evidence refresh", () => {
  const existing = curated([owned[1]!.id, owned[0]!.id]);
  const refreshed = mergeIntakeIntoLeaf({ existing: { state: "present", leaf: existing }, derived: derive(other), incomingId: leaf.id, incomingSubject: leaf.subject });
  assert.ok(refreshed.ok);
  assert.deepEqual(refreshed.leaf.curation, existing.curation);
  assert.deepEqual(featuredLeaflets(refreshed.leaf), []);
  for (const id of existing.curation!.featured) {
    const item = refreshed.leaf.leaflets.find(value => value.id === id);
    assert.ok(item?.tier === "excluded" && item.reason.length > 0);
  }
  assert.ok(parseLeafDocument(JSON.parse(JSON.stringify(refreshed.leaf))).ok);
});

test("explicit discard keeps now-missing choices for owner review instead of inventing replacements", () => {
  const existing = curated([owned[1]!.id, owned[0]!.id]);
  const refreshed = mergeIntakeIntoLeaf({ existing: { state: "present", leaf: existing }, derived: [], incomingId: leaf.id, incomingSubject: leaf.subject, unDerived: "discard" });
  assert.ok(refreshed.ok);
  assert.equal(refreshed.leaf.leaflets.length, 0);
  assert.equal(refreshed.wouldDrop.length, leaf.leaflets.length);
  assert.deepEqual(refreshed.leaf.curation, existing.curation);
  assert.deepEqual(featuredLeaflets(refreshed.leaf), []);
  assert.ok(parseLeafDocument(JSON.parse(JSON.stringify(refreshed.leaf))).ok);
});
