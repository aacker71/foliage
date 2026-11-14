/**
 * WHAT A RELEASE OF ONE LEAF WOULD CARRY OUTWARD — the records a policy owner decides about.
 *
 * The release machine (`release.ts`) decides WHETHER a leaf may leave the company; it says
 * nothing about WHICH of its leaflets would go. Without this, a review offered a name and three
 * tier tallies, and the observed "22 excluded" on a real leaf were other people's commits. Three
 * conditions, all required, in `projectLeaf`'s order, and every one imported from `@foliage/leaf`
 * rather than restated — the public Canopy projection (`packages/canopy/src/publicProjection.ts`)
 * and the canopy publish path (`packages/canopy/src/publish.ts`) ask the same functions:
 *
 *   LISTED        `isListedOnLeaf(leafletVisibility(...))`. A review enumerates records to a
 *                 reader who is not their subject, so only `public` qualifies. `unlisted` is a
 *                 consent to be handed a link, not to be enumerated: it appears in no roster,
 *                 no index and NO COUNT (`publicProjection.ts` rule 3, and what `share.mjs`
 *                 tells the subject). Private, including private by absence, stays in.
 *   THE RAIL      `isAbsoluteDenial(evaluatePolicy(policy, ...))`. A deny beats the subject's own
 *                 share, so a record the rail refuses is never released and is never listed here.
 *                 The default rails refuse a rating-shaped title, third-party evidence and a
 *                 record with no evidence; listing those would put a score about a person on an
 *                 employer screen and promise a release that cannot happen. A denied record is
 *                 silently absent: no reason, no count. Deny reasons are the subject's own
 *                 accounting, read on their own leaf.
 *   ATTRIBUTION   `isSubjectsOwnWork`. An `excluded` leaflet could not be attributed to this
 *                 person. Listing it under their name on an employer screen is a false
 *                 attribution, whatever its reason says, so it is never included.
 *
 * THE POLICY IS REQUIRED. An optional policy defaulting to "no rail" is how the canopy's
 * 2026-08-20 bypass happened; a caller with no member policy passes the shipped default, visibly.
 *
 * DOCUMENT ORDER, NEVER SORTED. Tiers are unordered, and a list grouped or sorted by tier is a
 * ranking with a different silhouette.
 */

import { createHash } from "node:crypto";

import {
  evaluatePolicy,
  isAbsoluteDenial,
  isListedOnLeaf,
  isSubjectsOwnWork,
  leafletVisibility,
  type Leaf,
  type PublishPolicy,
  type SubjectsOwnLeaflet,
} from "@foliage/leaf";

import type { ReleaseEvent } from "./release.ts";

export function releaseContents(leaf: Leaf, policy: PublishPolicy): readonly SubjectsOwnLeaflet[] {
  return Object.freeze(
    leaf.leaflets.filter(
      (leaflet): leaflet is SubjectsOwnLeaflet =>
        isListedOnLeaf(leafletVisibility(leaflet)) &&
        !isAbsoluteDenial(evaluatePolicy(policy, leaflet)) &&
        isSubjectsOwnWork(leaflet),
    ),
  );
}

/**
 * THE DECISIONS THAT ARE ABOUT THESE CONTENTS. Approving and publishing say yes to what the
 * review listed, so each must be bound to the list the deciding person actually saw; the other
 * events (propose, open review, reject, retract, withdraw) release nothing.
 */
export const CONTENTS_BOUND_EVENTS: readonly ReleaseEvent[] = Object.freeze(["approve", "publish"]);

export function isContentsBound(event: ReleaseEvent): boolean {
  return CONTENTS_BOUND_EVENTS.includes(event);
}

const CONTENTS_DIGEST = /^sha256:[0-9a-f]{64}$/;

/** `sha256:` followed by exactly 64 lower-case hex digits — what `releaseContentsDigest` returns. */
export function isReleaseContentsDigest(value: unknown): value is string {
  return typeof value === "string" && CONTENTS_DIGEST.test(value);
}

/**
 * WHAT THE REVIEWER SAW, AS ONE VALUE. The review renders it into its Approve and Publish forms;
 * the server recomputes it from the leaf as it is now and refuses the decision when the two
 * differ, so an approval can never cover a record the approver was not shown.
 *
 * Over exactly what a review row shows and identifies — id, title, tier — one row per record,
 * the rows sorted (id first), so a reordered document is the same release and any added,
 * removed, retitled or re-tiered record is a different one. That sort is only for a stable
 * value; it never orders tiers or people, and the review itself keeps document order.
 */
export function releaseContentsDigest(records: readonly SubjectsOwnLeaflet[]): string {
  const rows = records
    .map((record) => JSON.stringify([record.id, record.title, record.tier]))
    .sort();
  return `sha256:${createHash("sha256").update(JSON.stringify(rows)).digest("hex")}`;
}
