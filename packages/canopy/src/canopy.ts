/**
 * The canopy: the hosted aggregation layer.
 *
 * THE TAXONOMY, which is botanically continuous from trunk to leaflet — every link below is a
 * real containment, not a loose metaphor:
 *
 *   CANOPY   the layer formed by many trees' crowns
 *     TREE     a COMPANY — the whole organism
 *       BOUGH    an ORGANIZATION — a large main limb off the trunk
 *         BRANCH   a TEAM — a division of a bough
 *           LEAF     one person's portfolio  (see @foliage/leaf — OPEN SOURCE)
 *             LEAFLET  one artifact of evidence within it
 *
 * WHAT THIS PACKAGE MODELS, AND WHAT IT DELIBERATELY DOES NOT. Canopy, Tree and Leaf have types
 * here. Bough and Branch do not, and their absence is a decision rather than an omission: nothing
 * in the cloud plane consumes a company's internal structure, and a type that only matters once
 * some future ingest exists is dark plumbing. They appear in the chain above so a reader can see
 * where a company's insides sit — that is the enterprise plane's subject, not this one's.
 *
 * A NAMING RULE, because `branch` is also git's word and this repository shells out to git.
 * Capitalized `Branch`/`BranchId` is ALWAYS the taxonomy level above. git's is always written
 * lowercase and in context ("git branch", `--initial-branch`). They do not occur in the same file
 * anywhere in this repository, and they should not start: the taxonomy word lives in the
 * enterprise plane, git's lives in the open plane's intake.
 *
 * This package sits above the leaf layer on purpose. Everything here is MIT, like the rest of the repository.
 *
 * A leaf belongs to the person it describes, so @foliage/leaf stands alone: they can read it,
 * run it, and host their own portfolio without permission. Gathering many people's leaves
 * into trees and a browsable canopy — tenancy, indexing, discovery, the multi-tenant
 * service — lives here.
 *
 * The dependency runs canopy → leaf and never the reverse. That direction is the layering working
 * as intended, and `pnpm check:boundary` fails the build if it is ever inverted.
 *
 * THESE TYPES ARE THE INTERNAL ONES, AND NOTHING HERE IS SAFE TO SHOW A STRANGER.
 * `Tree.leaves` holds whole `Leaf` documents — every leaflet the subject has, including the
 * `private` ones, the `pending` ones and the `excluded` ones, which are that person's own
 * accounting and were never outward claims. A view handed a `Tree` and rendering what it got
 * would publish all of it. `publicProjection.ts` is the only thing in this package that may
 * reach a public surface: project first, render the projection.
 */

import type { Leaf, LeafId } from "@foliage/leaf";

export type TreeId = string & { readonly __brand: "TreeId" };
export const treeId = (s: string): TreeId => s as TreeId;

/**
 * A company — the whole organism. Trees bear leaves; a newly created tree legitimately has none.
 *
 * `company` is a display name, the one a reader would recognise on the page. It is the only
 * structural level named here: a company's boughs (organizations) and branches (teams) are the
 * enterprise plane's subject, and a leaf hangs from the tree directly as far as the canopy is
 * concerned.
 *
 * `leaves` is the FULL document per person, private leaflets and all. See the header: pass it
 * through `projectTree` before any of it reaches a reader who is not its subject.
 */
export interface Tree {
  readonly id: TreeId;
  readonly company: string;
  readonly leaves: readonly Leaf[];
}

/** The collective layer. */
export interface Canopy {
  readonly trees: readonly Tree[];
}

/**
 * Counts of what the canopy actually contains.
 *
 * Counts only — no density, coverage percentage, or composite. The same rule that governs
 * a leaf's attribution ledger applies one level up: a single figure summarising a company's
 * people is a rating of those people, and this product does not produce one.
 *
 * O(trees) — the per-tree leaf counts are already known.
 */
export function canopySize(canopy: Canopy): { trees: number; leaves: number } {
  return {
    trees: canopy.trees.length,
    leaves: canopy.trees.reduce((n, t) => n + t.leaves.length, 0),
  };
}

/**
 * Find which tree a leaf sits in, if any.
 *
 * Returns `undefined` rather than throwing: a leaf that belongs to no tree is a normal
 * state (an individual hosting their own leaf outside any company), not an error.
 * A leaf may appear in at most one tree; the first match wins and callers should treat a
 * second match as a data defect rather than a choice.
 */
export function treeContaining(canopy: Canopy, leaf: LeafId): Tree | undefined {
  return canopy.trees.find((t) => t.leaves.some((l) => l.id === leaf));
}
