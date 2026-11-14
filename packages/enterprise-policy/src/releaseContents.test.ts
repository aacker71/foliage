/**
 * What a policy owner is shown before deciding. The cases that matter are the ones where a
 * record could reach the review under the wrong name, one the subject never offered, or one the
 * publish rail would never let out.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultPublishPolicy,
  leafId,
  leafletId,
  parsePublishPolicy,
  type Leaf,
  type Leaflet,
  type PublishPolicy,
} from "@foliage/leaf";

import {
  isContentsBound,
  isReleaseContentsDigest,
  releaseContents,
  releaseContentsDigest,
} from "./releaseContents.ts";

const PROV = (ref: string, source = "git") => ({ source, ref, observedAt: "2026-01-05T00:00:00Z" });

const leaf = (leaflets: Leaflet[]): Leaf => ({ id: leafId("ada"), subject: "Ada Lovelace", leaflets });

const parsedDefault = defaultPublishPolicy();
assert.ok(parsedDefault.ok);
const DEFAULT: PublishPolicy = parsedDefault.policy;

test("only the subject's own public records, in document order, never sorted by tier", () => {
  const contents = releaseContents(leaf([
    { id: leafletId("ada-1"), title: "Backpressure fix", tier: "pending", provenance: PROV("ada1"), visibility: "public" },
    { id: leafletId("ada-2"), title: "Runtime scheduler rewrite", tier: "verified", provenance: PROV("ada2"), visibility: "public" },
    { id: leafletId("ada-3"), title: "Allocator notes", tier: "pending", provenance: PROV("ada3"), visibility: "public" },
  ]), DEFAULT);
  assert.deepEqual(contents.map((l) => l.id), ["ada-1", "ada-2", "ada-3"]);
  assert.ok(Object.isFrozen(contents));
});

test("an unlisted record is never listed and never counted: a link share is not consent to be enumerated", () => {
  const unlisted = { id: leafletId("ada-u"), title: "Runtime scheduler rewrite", tier: "verified" as const,
    provenance: PROV("adau"), visibility: "unlisted" as const };
  const publicOne = { id: leafletId("ada-1"), title: "Backpressure fix", tier: "pending" as const,
    provenance: PROV("ada1"), visibility: "public" as const };
  const withUnlisted = releaseContents(leaf([unlisted, publicOne]), DEFAULT);
  assert.deepEqual(withUnlisted.map((l) => l.id), ["ada-1"]);
  assert.equal(withUnlisted.length, 1);
  assert.equal(JSON.stringify(withUnlisted).includes("Runtime scheduler rewrite"), false);
  // Its presence changes nothing a reviewer can see or approve, not even the digest.
  const without = releaseContents(leaf([publicOne]), DEFAULT);
  assert.equal(releaseContentsDigest(withUnlisted), releaseContentsDigest(without));
  // Only unlisted: nothing to release, the same as holding nothing at all.
  assert.deepEqual(releaseContents(leaf([unlisted]), DEFAULT), []);
});

test("an excluded record is never released under the subject's name, even when marked public", () => {
  const records = leaf([
    { id: leafletId("other-1"), title: "Someone else's commit", tier: "excluded", visibility: "public",
      provenance: PROV("other1"),
      reason: "could not be attributed to this subject: the author identity is not among the declared identities" },
    { id: leafletId("ada-1"), title: "Backpressure fix", tier: "pending", provenance: PROV("ada1"), visibility: "public" },
  ]);
  assert.deepEqual(releaseContents(records, DEFAULT).map((l) => l.id), ["ada-1"]);
  // Not only because the default happens to deny `excluded`: a policy with no rules at all
  // still never lists somebody else's work under this person.
  const empty = parsePublishPolicy({ rules: [] });
  assert.ok(empty.ok);
  assert.deepEqual(releaseContents(records, empty.policy).map((l) => l.id), ["ada-1"]);
});

test("private records stay in, including private by absence", () => {
  const contents = releaseContents(leaf([
    { id: leafletId("ada-1"), title: "Backpressure fix", tier: "verified", provenance: PROV("ada1") },
    { id: leafletId("ada-2"), title: "Allocator notes", tier: "pending", provenance: PROV("ada2"), visibility: "private" },
  ]), DEFAULT);
  assert.deepEqual(contents, []);
});

test("the default rail beats the subject's share: a rating, third-party evidence or no evidence is never listed", () => {
  const contents = releaseContents(leaf([
    { id: leafletId("ada-rating"), title: "Customer survey rated me 4.5/5", tier: "verified", provenance: PROV("r"), visibility: "public" },
    { id: leafletId("ada-bare"), title: "Bare claim with no evidence", tier: "pending", visibility: "public" },
    { id: leafletId("ada-about"), title: "Mentoring notes", tier: "pending", provenance: PROV("n", "notes:third-party"), visibility: "unlisted" },
    { id: leafletId("ada-1"), title: "Real work", tier: "pending", provenance: PROV("ada1"), visibility: "public" },
  ]), DEFAULT);
  assert.deepEqual(contents.map((l) => l.id), ["ada-1"]);
});

test("the rail is the policy passed in, not one restated here", () => {
  const records = leaf([
    { id: leafletId("ada-bare"), title: "Bare claim with no evidence", tier: "pending", visibility: "public" },
    { id: leafletId("secret-1"), title: "Launch plan", tier: "verified", provenance: PROV("s1"), visibility: "public" },
  ]);
  const own = parsePublishPolicy({ rules: [
    { id: "deny-secret", effect: "deny", match: { kind: "id-prefix", prefix: "secret-" }, reason: "Not for release." },
  ] });
  assert.ok(own.ok);
  assert.deepEqual(releaseContents(records, own.policy).map((l) => l.id), ["ada-bare"]);
  assert.deepEqual(releaseContents(records, DEFAULT).map((l) => l.id), ["secret-1"]);
});

test("the contents digest names exactly the records, titles and tiers a review shows, in any order", () => {
  const a = { id: leafletId("ada-1"), title: "Backpressure fix", tier: "pending" as const, provenance: PROV("ada1"), visibility: "public" as const };
  const b = { id: leafletId("ada-2"), title: "Allocator notes", tier: "verified" as const, provenance: PROV("ada2"), visibility: "public" as const };
  const digest = releaseContentsDigest(releaseContents(leaf([a, b]), DEFAULT));
  assert.ok(isReleaseContentsDigest(digest));
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);

  // Reordering the document is the same release; evidence the row does not show is not part of it.
  assert.equal(releaseContentsDigest(releaseContents(leaf([b, a]), DEFAULT)), digest);
  assert.equal(releaseContentsDigest(releaseContents(leaf([a, { ...b, provenance: PROV("other") }]), DEFAULT)), digest);

  // Anything a reviewer would see differently is a different release.
  for (const changed of [
    [a],
    [a, b, { ...a, id: leafletId("ada-3"), title: "Third record" }],
    [a, { ...b, title: "Allocator notes, revised" }],
    [a, { ...b, tier: "pending" as const }],
    [a, { ...b, id: leafletId("ada-9") }],
  ]) {
    assert.notEqual(releaseContentsDigest(releaseContents(leaf(changed), DEFAULT)), digest);
  }
  assert.notEqual(releaseContentsDigest([]), digest);
  assert.ok(isReleaseContentsDigest(releaseContentsDigest([])));
});

test("only approve and publish are bound to the contents; the digest format is checked", () => {
  assert.deepEqual(
    (["propose", "open_review", "approve", "reject", "publish", "withdraw", "retract"] as const).filter(isContentsBound),
    ["approve", "publish"],
  );
  for (const bad of [undefined, null, "", "sha256:", `sha256:${"A".repeat(64)}`, `md5:${"0".repeat(64)}`, `sha256:${"0".repeat(63)}`]) {
    assert.equal(isReleaseContentsDigest(bad), false, String(bad));
  }
});
