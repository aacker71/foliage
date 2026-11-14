/**
 * The interior of the tree: BOUGHS and BRANCHES.
 *
 * The taxonomy was missing its middle. `@foliage/canopy` models a tree as an organization
 * holding leaves directly — company straight to person, nothing between. That is right for
 * the public canopy, where an outside reader should see people and not an org chart, and
 * wrong for the enterprise plane, where the org chart is the entire subject.
 *
 * Botanically exact, like the rest of this taxonomy — a bough is a large limb joined
 * directly to the trunk; branches come off boughs:
 *
 *   CANOPY      many companies
 *     TREE        a company — the trunk everything is joined to
 *       BOUGH       an organization
 *         BRANCH      a team, and sub-teams are branches off branches
 *           LEAF        one person's portfolio
 *             LEAFLET     one artifact of evidence
 *
 * WHY BOUGH AND BRANCH ARE DIFFERENT TYPES, and not one type with a `level` field. They
 * are structurally identical — both carry sub-branches and leaves — so a single recursive
 * type would be less code. It would also let a team be grafted straight onto the trunk and
 * an organization be nested three deep inside another team, because nothing in the type
 * would object. The distinction is real in the product (an organization is a unit of
 * RELEASE POLICY; a team is a unit of work) and the ids are branded separately so the
 * compiler refuses the mix-up rather than a reviewer catching it later.
 *
 * BRANCHES NEST, BOUGHS DO NOT. A team can have sub-teams — that is ordinary and the type
 * allows it. A bough hangs off the trunk and nothing else, which is what makes it a bough.
 *
 * BOTH may hold leaves directly, and that is not sloppiness: a person can report into an
 * organization without sitting in any team, and pretending otherwise would force a fake
 * "General" team into every org chart that has one.
 *
 * NO AGGREGATE, AT ANY LEVEL, and the refusal has to hold hardest here — the enterprise
 * plane is exactly where someone would want to rank teams. `boughSize` and `branchSize`
 * return counts of people and sub-units and nothing else, for the same reason `canopySize`
 * does one level up: a single figure summarising the people under a manager is a rating of
 * that team, and this product does not produce one.
 */

import type { Leaf, LeafId } from "@foliage/leaf";

export type BoughId = string & { readonly __brand: "BoughId" };
export type BranchId = string & { readonly __brand: "BranchId" };
export const boughId = (s: string): BoughId => s as BoughId;
export const branchId = (s: string): BranchId => s as BranchId;

/**
 * A TEAM. Branches off a bough, and may carry sub-teams of its own.
 *
 * Empty `branches` and empty `leaves` are both ordinary states — a newly formed team has
 * no people yet, and most teams have no sub-teams — so neither is an error.
 */
export interface Branch {
  readonly id: BranchId;
  readonly name: string;
  readonly branches: readonly Branch[];
  readonly leaves: readonly Leaf[];
}

/**
 * An ORGANIZATION. The large limb joined directly to the trunk.
 *
 * Holds teams, and may hold people directly. Does NOT hold other boughs: a bough is
 * defined by being joined to the trunk, so nesting one would make it a branch.
 */
export interface Bough {
  readonly id: BoughId;
  readonly name: string;
  readonly branches: readonly Branch[];
  readonly leaves: readonly Leaf[];
}

/** The COMPANY: the trunk, and every bough joined to it. */
export interface CompanyTree {
  readonly id: string;
  readonly company: string;
  readonly boughs: readonly Bough[];
}

/** Anything that carries teams and people. Lets one traversal serve both levels. */
export type Limb = Bough | Branch;

export interface LimbSize {
  /** People attached to this limb itself, not to anything below it. */
  readonly directLeaves: number;
  readonly directBranches: number;
  /** People anywhere beneath it, including its own. */
  readonly totalLeaves: number;
  readonly totalBranches: number;
  /** Levels of team below this limb. 0 when it carries only people. */
  readonly depth: number;
}

/**
 * Counts under one limb.
 *
 * `direct` and `total` are separate fields because conflating them is how a lead's team of
 * four gets reported as forty. O(n) over the subtree, one walk, no memoisation — an org
 * chart is small and a cache here would be a second source of truth that goes stale the
 * moment a team is regrafted.
 */
export function limbSize(limb: Limb): LimbSize {
  let totalLeaves = limb.leaves.length;
  let totalBranches = limb.branches.length;
  let deepest = 0;
  for (const child of limb.branches) {
    const size = limbSize(child);
    totalLeaves += size.totalLeaves;
    totalBranches += size.totalBranches;
    deepest = Math.max(deepest, size.depth + 1);
  }
  return {
    directLeaves: limb.leaves.length,
    directBranches: limb.branches.length,
    totalLeaves,
    totalBranches,
    depth: deepest,
  };
}

/** Whole-company counts. Units and people — never a figure standing for the people. */
export function companySize(tree: CompanyTree): {
  readonly boughs: number;
  readonly branches: number;
  readonly leaves: number;
  readonly depth: number;
} {
  let branches = 0;
  let leaves = 0;
  let depth = 0;
  for (const bough of tree.boughs) {
    const size = limbSize(bough);
    branches += size.totalBranches;
    leaves += size.totalLeaves;
    depth = Math.max(depth, size.depth + 1);
  }
  return { boughs: tree.boughs.length, branches, leaves, depth };
}

/** Every limb in the tree, boughs first, then their branches depth-first. */
export function everyLimb(tree: CompanyTree): readonly Limb[] {
  const out: Limb[] = [];
  const walk = (branches: readonly Branch[]): void => {
    for (const b of branches) {
      out.push(b);
      walk(b.branches);
    }
  };
  for (const bough of tree.boughs) {
    out.push(bough);
    walk(bough.branches);
  }
  return out;
}

/**
 * The org path to a person: the bough, then each branch, down to the limb holding them.
 * `null` when the tree does not hold that leaf at all — a real answer, not an empty array,
 * because "not in this company" and "attached to the trunk" are different facts.
 */
export function pathToLeaf(tree: CompanyTree, leaf: LeafId): readonly Limb[] | null {
  const walk = (limb: Limb, trail: Limb[]): Limb[] | null => {
    const here = [...trail, limb];
    if (limb.leaves.some((l) => l.id === leaf)) return here;
    for (const child of limb.branches) {
      const found = walk(child, here);
      if (found !== null) return found;
    }
    return null;
  };
  for (const bough of tree.boughs) {
    const found = walk(bough, []);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Leaf ids appearing under more than one limb.
 *
 * A person sits in one place on the org chart. Reported rather than resolved — the same
 * stance `treeContaining` takes one level up, for the same reason: silently keeping the
 * first occurrence makes every count disagree with the chart by an amount nobody can see.
 */
export function duplicateLeaves(tree: CompanyTree): readonly LeafId[] {
  const seen = new Set<LeafId>();
  const twice = new Set<LeafId>();
  for (const limb of everyLimb(tree)) {
    for (const leaf of limb.leaves) {
      if (seen.has(leaf.id)) twice.add(leaf.id);
      else seen.add(leaf.id);
    }
  }
  return [...twice];
}
