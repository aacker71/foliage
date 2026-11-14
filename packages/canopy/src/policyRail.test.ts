/**
 * THE RAIL, ON THE PLANE WITH THE AUDIENCE — the cross-plane contract these tests pin.
 *
 * THE CORPSE, dated 2026-08-20 and re-found by four independent reviewers on 2026-08-24: the
 * leaf app asked the publish policy before serving a shared leaflet and answered 404 for a
 * denied one, while the canopy — the only surface a stranger actually reaches — asked only
 * visibility and answered 200 for the SAME id. A deny's defining property ("DENY is ABSOLUTE…
 * including something the subject explicitly shared", publishPolicy.ts) held everywhere except
 * the one place it protected anyone.
 *
 * The fix these tests guard: `projectLeaf` takes the subject's policy and runs the rail between
 * OFFERED and THEIRS, using the SAME `evaluatePolicy`/`isAbsoluteDenial` the leaf app uses —
 * one decision, two planes, no restatement. So the contract test asks both planes the same
 * question about the same leaflet and requires the same answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  defaultPublishPolicy,
  evaluatePolicy,
  isAbsoluteDenial,
  leafId,
  leafletId,
  parsePublishPolicy,
  type Leaf,
  type Leaflet,
  type PublishPolicy,
} from "@foliage/leaf";

import { treeId } from "./canopy.ts";
import { projectLeaf, projectTree } from "./publicProjection.ts";

const mustParse = (doc: unknown): PublishPolicy => {
  const parsed = parsePublishPolicy(doc);
  if (!parsed.ok) throw new Error("test policy must parse");
  return parsed.policy;
};

const DEFAULT = ((): PublishPolicy => {
  const parsed = defaultPublishPolicy();
  if (!parsed.ok) throw new Error("the built-in default publish policy failed to parse");
  return parsed.policy;
})();

/** A subject's own, PUBLICLY shared leaflet — the strongest consent the format can express. */
const publicLeaflet = (id: string, title: string): Leaflet =>
  Object.freeze({
    id: leafletId(id),
    title,
    tier: "pending",
    provenance: Object.freeze({ source: "git", ref: "a".repeat(40), observedAt: "2026-08-20T00:00:00Z" }),
    visibility: "public",
  }) as Leaflet;

const leafOf = (leaflets: readonly Leaflet[]): Leaf =>
  Object.freeze({ id: leafId("leaf:rail"), subject: "Rail Subject", leaflets: Object.freeze(leaflets) }) as Leaf;

test("A DENY BEATS THE SUBJECT'S OWN PUBLIC SHARE, on the canopy, same as on the leaf", () => {
  // A custom deny matching by evidence ref — the subject shared the leaflet public AND wrote a
  // rule withholding anything resting on this commit. The rail must win on both planes.
  const denied = publicLeaflet("l-denied", "feat: the thing the rule withholds");
  const allowedThrough = publicLeaflet("l-fine", "feat: the thing nobody withheld");
  const policy = mustParse({
    rules: [
      {
        id: "deny-this-ref",
        effect: "deny",
        match: { kind: "evidence-ref", ref: "a".repeat(40) },
        reason: "this commit's material is not for publication, wherever it appears",
      },
    ],
  });

  // Both leaflets rest on the same ref in this fixture, so BOTH must be withheld — the point
  // is the rail, not the pair. Leaf plane first: the same functions the leaf app serves by.
  assert.equal(isAbsoluteDenial(evaluatePolicy(policy, denied)), true);
  assert.equal(isAbsoluteDenial(evaluatePolicy(policy, allowedThrough)), true);

  // Canopy plane: the projection must agree — nothing listed, and the state says
  // "offered, nothing publishable", never "nothing-offered" (which would be false about them).
  const projected = projectLeaf(leafOf([denied, allowedThrough]), policy);
  assert.equal(projected.state, "nothing-publishable");
});

test("the rail is per-leaflet: one denied, one clean — only the clean one is listed", () => {
  const denied = publicLeaflet("l-denied", "chore: rated 10/10 by everyone");
  const clean = publicLeaflet("l-clean", "feat: an ordinary subject line");
  // The DEFAULT policy's own rules: a rating-shaped title is denied out of the box.
  const projected = projectLeaf(leafOf([denied, clean]), DEFAULT);
  assert.equal(projected.state, "listed");
  if (projected.state !== "listed") return;
  assert.deepEqual(
    projected.listed.map((l) => String(l.id)),
    ["l-clean"],
    "the default deny-rating-shaped-title rule must hold on the public plane",
  );
});

test("THE DENY REASON NEVER TRAVELS INTO THE PROJECTION — absence, not explanation", () => {
  // The reason string is the subject's own accounting; a roster that printed "withheld
  // because…" would leak exactly what the rule protects. The whole projection, serialized,
  // must not contain it.
  const reason = "SECRET-REASON-a-stranger-must-never-read";
  const policy = mustParse({
    rules: [
      { id: "deny-ref", effect: "deny", match: { kind: "evidence-ref", ref: "a".repeat(40) }, reason },
    ],
  });
  const tree = projectTree(
    Object.freeze({ id: treeId("t-rail"), company: "Rail Co", leaves: Object.freeze([leafOf([publicLeaflet("l1", "feat: x")])]) }),
    () => policy,
  );
  assert.equal(JSON.stringify(tree).includes(reason), false);
  assert.equal(JSON.stringify(tree).includes("deny-ref"), false, "rule ids stay off the public plane too");
});

test("the default policy alone already rails: excluded evidence-source and rating titles", () => {
  // No custom policy anywhere — the shipped default must still withhold a rating-shaped title
  // even at visibility public. This is what a canopy applies for a subject who wrote nothing.
  const rated = publicLeaflet("l-rated", "top 1% contributor, 5 stars");
  const projected = projectLeaf(leafOf([rated]), DEFAULT);
  assert.equal(projected.state, "nothing-publishable");
});
