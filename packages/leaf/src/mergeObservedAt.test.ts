/**
 * A RE-READ IS NOT A CHANGE. The rule these tests pin: when intake re-derives a leaflet that is
 * the same in every field except `provenance.observedAt` — the instant of THIS read — the row
 * already in the leaf stays exactly as it was, first observation included. A leaflet that is new,
 * or that really changed, carries the run's instant.
 *
 * Why it matters (QA 2026-10-02 #11): a no-op `foliage grow` used to re-stamp every intake
 * leaflet, so an export dated all work to the latest scheduled run and any private-brain session
 * granting one of them answered 409 scope-changed after every grow, with no human edit.
 *
 * Built the way merge.test.ts builds its documents: real `commitsToLeaflets` output, parsed
 * through `parseLeafDocument`, never a hand-made literal pretending to be a result.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseLeafDocument } from "./document.ts";
import { commitsToLeaflets, type ObservedCommit } from "./intake.ts";
import { leafId, leafletId, type Leaf, type Leaflet } from "./leaf.ts";
import { mergeIntakeIntoLeaf, type LeafMerge } from "./merge.ts";

const ME = "me@example.com";
const SUBJECT = "Merge observedAt protocol";
const ID = leafId("merge-observed-at-protocol");
const FIRST_RUN = "2026-03-05T09:00:00Z";
const SECOND_RUN = "2026-10-02T03:00:00Z";

const sha = (seed: string): string => seed.repeat(40).slice(0, 40);

function commit(seed: string, subject: string, over: Partial<ObservedCommit> = {}): ObservedCommit {
  return { sha: sha(seed), authorEmail: ME, subject, signature: "N", signer: "", signatureArmor: "none", ...over };
}

function derive(commits: readonly ObservedCommit[], observedAt: string, identities = [ME]): readonly Leaflet[] {
  const result = commitsToLeaflets({ commits, identities, observedAt });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result.leaflets;
}

function existingLeaf(rows: readonly unknown[]): Leaf {
  const parsed = parseLeafDocument({ id: ID, subject: SUBJECT, leaflets: JSON.parse(JSON.stringify(rows)) });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

function merge(leaf: Leaf, derived: readonly Leaflet[]) {
  const result: LeafMerge = mergeIntakeIntoLeaf({
    existing: { state: "present", leaf },
    derived,
    incomingId: ID,
    incomingSubject: SUBJECT,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  return result;
}

const observedAtOf = (leaf: Leaf, seed: string) =>
  leaf.leaflets.find((l) => l.id === leafletId(`git:${sha(seed)}`))?.provenance?.observedAt;

test("a re-read with no new work keeps every row byte-identical, first observation included", () => {
  const commits = [
    commit("a", "feat: the scheduler"),
    commit("b", "docs: the architecture"),
    // Somebody else's commit re-derives as excluded with the same reason: also unchanged.
    commit("c", "chore: a colleague's fix", { authorEmail: "colleague@example.com" }),
  ];
  const leaf = existingLeaf(derive(commits, FIRST_RUN));

  const result = merge(leaf, derive(commits, SECOND_RUN));

  assert.deepEqual(result.updated, [], "a re-read alone is not an update");
  assert.deepEqual(result.kept.map((k) => k.id), leaf.leaflets.map((l) => l.id));
  assert.ok(result.kept.every((k) => k.reason === "re-derived-identical"));
  assert.equal(JSON.stringify(result.leaf.leaflets), JSON.stringify(leaf.leaflets));
  for (const seed of ["a", "b", "c"]) assert.equal(observedAtOf(result.leaf, seed), FIRST_RUN);
});

test("a shared row with a body survives a re-read untouched", () => {
  const derived = derive([commit("a", "feat: the scheduler")], FIRST_RUN);
  const shared = derived.map((l) => ({
    ...l,
    visibility: "unlisted" as const,
    body: [{ provenance: l.provenance, text: "Wrote the scheduler loop." }],
  }));
  const leaf = existingLeaf(shared);

  const result = merge(leaf, derive([commit("a", "feat: the scheduler")], SECOND_RUN));

  assert.equal(result.kept.length, 1);
  assert.deepEqual(result.leaf.leaflets[0], leaf.leaflets[0]);
});

test("one new commit: only the new leaflet carries the run's instant", () => {
  const leaf = existingLeaf(derive([commit("a", "feat: the scheduler")], FIRST_RUN));

  const result = merge(
    leaf,
    derive([commit("a", "feat: the scheduler"), commit("d", "fix: the new work")], SECOND_RUN),
  );

  assert.deepEqual(result.added.map((a) => a.id), [leafletId(`git:${sha("d")}`)]);
  assert.equal(observedAtOf(result.leaf, "a"), FIRST_RUN);
  assert.equal(observedAtOf(result.leaf, "d"), SECOND_RUN);
});

test("a leaflet that really changed takes the run's instant, and its change list is as before", () => {
  const leaf = existingLeaf(derive([commit("a", "feat: the scheduler")], FIRST_RUN));
  // The operator configured an allowed-signers file between runs; git now reports G.
  const signed = derive(
    [commit("a", "feat: the scheduler", { signature: "G", signer: ME, signatureArmor: "ssh" })],
    SECOND_RUN,
  );

  const result = merge(leaf, signed);

  assert.equal(result.kept.length, 0);
  assert.deepEqual(result.updated[0]?.changed, ["provenance.observedAt", "tier"]);
  assert.equal(result.leaf.leaflets[0]?.tier, "verified");
  assert.equal(observedAtOf(result.leaf, "a"), SECOND_RUN);
});

test("CONTROL: a share on an excluded row is still dropped and reported on a re-read", () => {
  // A row that is somebody else's work must not keep a share decision just because nothing
  // else about it moved. The re-read goes through the update path exactly as before.
  const other = commit("e", "chore: a colleague's fix", { authorEmail: "colleague@example.com" });
  const derived = derive([other], FIRST_RUN);
  assert.equal(derived[0]?.tier, "excluded");
  const leaf = existingLeaf(derived.map((l) => ({ ...l, visibility: "public" as const })));

  const result = merge(leaf, derive([other], SECOND_RUN));

  assert.equal(result.kept.length, 0);
  assert.deepEqual(result.updated[0]?.changed, ["provenance.observedAt", "visibility"]);
  assert.equal(result.leaf.leaflets[0]?.visibility, undefined);
});
