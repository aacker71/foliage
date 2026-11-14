import { test } from "node:test";
import assert from "node:assert/strict";

import {
  attributionLedger,
  isLinkShareable,
  isListedOnLeaf,
  isMediaBodyElement,
  isSubjectsOwnWork,
  LEAFLET_VISIBILITIES,
  leafletVisibility,
  MEDIA_TYPES,
  PROOF_TIERS,
  publishableLeaflets,
  leafId,
  leafletId,
  type BodyElement,
  type Leaf,
  type Leaflet,
  type LeafletMedia,
  type MediaType,
} from "./leaf.ts";

const prov = { source: "git", ref: "fc70c844b", observedAt: "2026-08-13T00:00:00Z" };

const leaf: Leaf = {
  id: leafId("leaf-1"),
  subject: "A. Acker",
  leaflets: [
    { id: leafletId("a"), title: "Shipped the boundary gate", tier: "verified", provenance: prov },
    { id: leafletId("b"), title: "Refactored the extractor", tier: "verified", provenance: prov },
    { id: leafletId("c"), title: "Awaiting commit proof", tier: "pending" },
    {
      id: leafletId("d"),
      title: "Vendored dependency changes",
      tier: "excluded",
      reason: "authored by another contributor under a different address",
    },
  ],
};

test("only verified leaflets are publishable", () => {
  const pub = publishableLeaflets(leaf);
  assert.equal(pub.length, 2);
  assert.ok(pub.every((l) => l.tier === "verified"));
});

test("the ledger counts every tier and explains each exclusion", () => {
  const ledger = attributionLedger(leaf);
  assert.deepEqual(
    { v: ledger.verified, p: ledger.pending, e: ledger.excluded },
    { v: 2, p: 1, e: 1 },
  );
  assert.equal(ledger.exclusionReasons.length, ledger.excluded);
  assert.match(ledger.exclusionReasons[0]!, /another contributor/);
});

test("excluded leaflets are never silently dropped from the tally", () => {
  // The failure this guards: reporting 2 of 4 as though the other 2 did not exist.
  const ledger = attributionLedger(leaf);
  assert.equal(
    ledger.verified + ledger.pending + ledger.excluded,
    leaf.leaflets.length,
    "every leaflet must land in exactly one tier",
  );
});

test("the ledger exposes no score, ratio, or composite", () => {
  // Guards the FCRA posture at the API surface: if a rating-shaped number is ever added
  // here it becomes trivial to show one to an employer. Counts only, by construction.
  const ledger = attributionLedger(leaf) as unknown as Record<string, unknown>;
  const numeric = Object.entries(ledger).filter(([, v]) => typeof v === "number");
  assert.deepEqual(
    numeric.map(([k]) => k).sort(),
    ["excluded", "pending", "verified"],
    "only per-tier counts may be numeric",
  );
  for (const [, v] of numeric) {
    assert.ok(Number.isInteger(v), "counts are integers; a fraction would be a rate");
  }
});

test("proof tiers are frozen and unordered", () => {
  assert.ok(Object.isFrozen(PROOF_TIERS));
  assert.deepEqual([...PROOF_TIERS], ["verified", "pending", "excluded"]);
  // No comparator is exported on purpose — see the note in taxonomy.ts.
});


test("an excluded leaflet cannot be constructed without a reason", () => {
  // Compile-time guarantee; asserted here so the intent is visible in the suite too.
  const bad = { id: leafletId("x"), title: "no reason", tier: "excluded" };
  // @ts-expect-error — `reason` is required on the excluded variant.
  const _typed: Leaflet = bad;
  assert.ok(!("reason" in bad));
});

test("a body element cannot be constructed without provenance", () => {
  // The type-level half of the element-wise must-ground rule; the parser enforces the other
  // half for values that arrive as untrusted JSON.
  const ungrounded = { text: "sounds true, points at nothing" };
  // @ts-expect-error — `provenance` is required on every body element.
  const _typed: BodyElement = ungrounded;
  assert.ok(!("provenance" in ungrounded));
});

test("A MEDIA ELEMENT CANNOT BE CONSTRUCTED WITHOUT PROVENANCE EITHER", () => {
  // The grounding rule does not weaken because the element became visual. A photograph with no
  // ref is exactly as unsourced as a sentence with no ref.
  const ungrounded = {
    media: { mediaType: "image/jpeg", dimensions: { known: true, width: 8, height: 8 } },
  };
  // @ts-expect-error — `provenance` is required on every body element, media included.
  const _typed: BodyElement = ungrounded;
  assert.ok(!("provenance" in ungrounded));
});

test("MEDIA CANNOT BE CONSTRUCTED WITHOUT DIMENSIONS — an absent size has no cause", () => {
  // Required rather than optional on purpose: an omitted size makes "nobody looked" and "the
  // decoder is missing" look identical, which is the `commitCount: 0` failure one field wide.
  const sizeless = { mediaType: "image/jpeg" as const };
  // @ts-expect-error — `dimensions` is required; unknown ones say { known: false, why }.
  const _typed: LeafletMedia = sizeless;
  assert.ok(!("dimensions" in sizeless));
});

test("isMediaBodyElement is the ONE place the text/media question is answered", () => {
  // A renderer that invents its own test either omits a photograph or prints a broken image
  // where a sentence was, and both failures are silent.
  const media: BodyElement = {
    provenance: prov,
    media: { mediaType: "image/png", dimensions: { known: false, why: "no decoder installed" } },
  };
  const text: BodyElement = { provenance: prov, text: "a sentence about a commit" };
  assert.equal(isMediaBodyElement(media), true);
  assert.equal(isMediaBodyElement(text), false);
  // And it NARROWS, so the media fields are reachable without a cast.
  assert.equal(isMediaBodyElement(media) ? media.media.mediaType : null, "image/png");
});

test("MEDIA_TYPES is closed, frozen, and shaped so video is one entry rather than a migration", () => {
  assert.ok(Object.isFrozen(MEDIA_TYPES));
  // IANA media types verbatim, because that is what an HTTP response and a <source type> need.
  assert.ok(MEDIA_TYPES.every((t) => /^[a-z]+\/[a-z0-9+.-]+$/.test(t)));
  // SVG is absent for a security reason, not an aesthetic one: it is a document that executes.
  assert.ok(!MEDIA_TYPES.includes("image/svg+xml" as MediaType));
  // The one admitted video type is the local capture adapter's H.264 MP4.
  assert.deepEqual(MEDIA_TYPES.filter((t) => !t.startsWith("image/")), ["video/mp4"]);
});

test("A LEAFLET WITH NO VISIBILITY IS PRIVATE — the safe default, applied in one place", () => {
  // The failure this guards: a renderer reading `l.visibility` raw, getting `undefined`, and
  // treating "nobody decided" as "not private".
  const undecided = leaf.leaflets[0]!;
  assert.ok(!("visibility" in undecided));
  assert.equal(leafletVisibility(undecided), "private");
  assert.equal(isLinkShareable(leafletVisibility(undecided)), false);
  assert.equal(isListedOnLeaf(leafletVisibility(undecided)), false);
});

test("unlisted is shareable by link but NOT listed — the two consents are separate", () => {
  // Collapsing them is the boolean mistake: willing to hand someone a link is not willing to
  // be enumerated in a portfolio.
  assert.deepEqual(
    LEAFLET_VISIBILITIES.map((v) => [v, isLinkShareable(v), isListedOnLeaf(v)]),
    [
      ["private", false, false],
      ["unlisted", true, false],
      ["public", true, true],
    ],
  );
});

test("visibility states are frozen and unordered, and no state is a number", () => {
  // Same posture as PROOF_TIERS: no comparator is exported, so nothing can rank leaflets by
  // how visible they are and call the result a level.
  assert.ok(Object.isFrozen(LEAFLET_VISIBILITIES));
  assert.equal(LEAFLET_VISIBILITIES.length, 3);
  assert.ok(LEAFLET_VISIBILITIES.every((v) => typeof v === "string"));
});

test("PUBLISHABILITY IS TIER-ONLY — visibility is a separate question a surface must also ask", () => {
  // Stated as a test because the gap is silent: a `verified` leaflet the subject never
  // offered is publishable by tier and private by visibility, and a surface that reads only
  // the first would hand it out.
  const verifiedButPrivate = publishableLeaflets(leaf)[0]!;
  assert.equal(verifiedButPrivate.tier, "verified");
  assert.equal(leafletVisibility(verifiedButPrivate), "private");
  assert.equal(isLinkShareable(leafletVisibility(verifiedButPrivate)), false);
});

test("isSubjectsOwnWork answers ATTRIBUTION, all three tiers by name, and excluded is refused", () => {
  // The question is WHOSE, never HOW STRONGLY PROVEN — `verified` and `pending` are both this
  // subject's own work, at different proof strengths that are a different function's concern.
  // Only `excluded` (somebody else's commit, per its required `reason`) answers false. A
  // canopy importing this is the one place the refusal is spelled; a second copy is the drift
  // this test guards against.
  const [verified, , pending, excluded] = leaf.leaflets;
  assert.equal(isSubjectsOwnWork(verified!), true);
  assert.equal(isSubjectsOwnWork(pending!), true);
  assert.equal(isSubjectsOwnWork(excluded!), false);
});
