/**
 * PHOTOSYNTHESIS, ENTERPRISE PLANE — the subject hierarchy, and the charter of this package.
 *
 *   TREE             a COMPANY — the whole organism
 *     BOUGH            an ORGANIZATION — a main limb off the trunk, i.e. a business unit
 *       BRANCH           a TEAM — a division of a bough
 *         LEAF             one person's portfolio: in exactly one tree, on zero or more branches
 *
 * The words are the repository's taxonomy, and the containment they describe is a real
 * botanical containment at every link: a branch is a division of a bough, a bough is a limb of
 * a tree. "A branch belongs to a bough, which belongs to a tree" is a statement about the same
 * organism throughout — where "a team belongs to an organization, which belongs to a company"
 * was an org chart borrowed into a botanical metaphor and true only by convention.
 *
 * TWO THINGS ABOUT THE ENDS OF THAT HIERARCHY ARE LOAD-BEARING, not decorative.
 *
 *   THE LEAF LEVEL IS THE OPEN PLANE'S ACTUAL LEAF. `LeafId` is IMPORTED from @foliage/leaf,
 *   not redefined here. This hierarchy does not terminate in a parallel "individual" concept
 *   invented for the enterprise plane; it terminates in the same Leaf the open plane models,
 *   the same Leaf a person can self-host, and the same id that names it there. An enterprise
 *   customer's org chart therefore ends at an object the person it describes already owns —
 *   which is what makes the taxonomy load-bearing rather than a naming scheme.
 *
 *   THE TREE LEVEL IS DEFINED HERE, AND IS A DELIBERATE DUPLICATE. @foliage/canopy also
 *   declares a `TreeId`, and it denotes the same real-world thing: one company. It is not
 *   imported because @foliage/canopy is in the `cloud` plane and this package must not depend
 *   on cloud — the two brands are independent so the plane boundary stays a boundary, and
 *   `pnpm check:boundary` keeps it that way. The duplication is named here rather than left to
 *   be discovered: an unexplained duplicate brand is worse than an explained one, because the
 *   next reader's instinct is to "fix" it by importing across the boundary.
 *
 * `Branch` HERE IS NOT git's BRANCH. The rule, written down because the collision is
 * permanent: capitalized `Branch`/`BranchId`/`BranchPath` is this taxonomy — a team. git's is
 * always written lowercase and in context ("git branch", `--initial-branch=main`, "Merge
 * branch"). They do not occur in the same file anywhere in this repository: the taxonomy
 * `Branch` lives only in the enterprise plane, git's only in the open plane's intake code, and
 * it should stay that way.
 *
 * WHY THIS EXISTS SEPARATELY FROM @foliage/photosynthesis. The open plane drafts candidates
 * for ONE person from their OWN machine and promotes the approved ones into their own leaf:
 * one subject, one reviewer, one approval, one file they own. Three things change at
 * organizational scale, and none of them is cosmetic.
 *
 *   1. THE SUBJECT IS NOT ALWAYS A PERSON. "We migrated the billing platform" is a real
 *      artifact that belongs to a branch and to no single person. Handing it to whoever touched
 *      the most files would be a fabrication, so the subject is modelled at four levels and
 *      an artifact is allowed to belong to a branch, a bough, or the whole tree.
 *   2. RELEASE IS GOVERNED, NOT PERSONAL. An artifact starts internal and reaches the public
 *      canopy only through @foliage/enterprise-policy's state machine, where `approve` and
 *      `publish` are separate events fired by different actors. This package DRIVES that
 *      machine (see release.ts); it does not fork it or restate its policy.
 *   3. ATTRIBUTION CROSSES PEOPLE, which is where this product is most dangerous — the moment
 *      you summarise people you are rating them. See ledger.ts: counts, never ratios, and no
 *      ordering of contributors anywhere.
 *
 * WHAT THIS PACKAGE MAY READ, AND WHAT IT MAY NEVER READ. "Organizational intelligence layer"
 * is one euphemism away from surveillance, so the line is drawn here, in the code, and not
 * only in a policy document:
 *
 *   MAY READ    artifacts a person or branch ALREADY PRODUCED and that the company already
 *               holds as work product — commits, releases, design files, incident write-ups —
 *               each carried as a `Provenance` ref naming a source and a re-checkable handle.
 *   MAY NEVER   anything derived from watching people rather than reading their work:
 *               communications monitoring, message or document content read for signal rather
 *               than as an artifact, keystroke or screen capture, activity and presence
 *               tracking, location, sentiment, or any feed whose purpose is to observe a
 *               person rather than to source a thing they made.
 *
 * The type system holds that line at one point, and it is the point that matters: every claim
 * in this package is carried by `Provenance` — a source, a ref, an observation instant, the
 * SAME type the open plane uses and the same one the subject can re-check. There is no field
 * anywhere here for an inferred trait, an activity signal, a behavioural summary, or a number
 * about a person, so a monitoring feed has nowhere to land without a format change that has to
 * be reviewed on its own merits. Subjects are identified by the ids a company already
 * uses, and carry no display names or personal details, for the same reason `ObservedCommit`
 * in @foliage/leaf refuses to carry a third party's name.
 *
 * DOMAIN ONLY, exactly like @foliage/leaf and @foliage/enterprise-policy: pure, total, no fs,
 * no network, no clock, no throw. Ingesting a company's systems is I/O and belongs in an
 * app; keeping it out is what makes these rules testable without a company.
 *
 * This package is in the `enterprise` plane. It may depend on the open plane; nothing open may
 * depend on it, and `pnpm check:boundary` enforces that rather than trusting it.
 */

import { leafId, type LeafId } from "@foliage/leaf";

/**
 * The leaf level of this hierarchy IS @foliage/leaf's leaf, re-exported so that a caller of
 * this package can name it without reaching past it — and so the identity is visible in the
 * export list rather than only in the header above.
 */
export { leafId, type LeafId };

/**
 * Opaque ids, the same device as `LeafId`/`LeafletId` in @foliage/leaf: a `BranchId` cannot be
 * passed where a `BoughId` is expected, which matters more here than in the open plane because
 * four kinds of id flow through the same functions and they are all strings. At the leaf level
 * it is not merely the same device but the same type — `LeafId` above is the open plane's.
 *
 * `TreeId` is declared here and NOT imported from @foliage/canopy, which declares a brand of
 * the same name for the same real-world thing. See the header: @foliage/canopy is in the
 * `cloud` plane, this package may not depend on cloud, and the independence of the two brands
 * is what keeps that boundary mechanical instead of aspirational.
 */
export type TreeId = string & { readonly __brand: "TreeId" };
export type BoughId = string & { readonly __brand: "BoughId" };
export type BranchId = string & { readonly __brand: "BranchId" };

export const treeId = (s: string): TreeId => s as TreeId;
export const boughId = (s: string): BoughId => s as BoughId;
export const branchId = (s: string): BranchId => s as BranchId;

/**
 * The four kinds of subject an artifact can belong to.
 *
 * They NEST, and nesting is containment — not seniority and not rank. There is no comparator
 * here and no numeric mapping, for the same reason `ProofTier` has none: an ordering over
 * subjects invites an aggregate over subjects, and an aggregate over people is a rating of
 * people. `containment` answers "is this inside that", which is a structural question, and it
 * is the only relation between subjects this package computes.
 */
export type SubjectKind = "tree" | "bough" | "branch" | "leaf";

export const SUBJECT_KINDS: readonly SubjectKind[] = Object.freeze([
  "tree",
  "bough",
  "branch",
  "leaf",
]);

/**
 * A branch, fully placed: a branch belongs to a bough, which belongs to a tree.
 *
 * The full path travels with the membership rather than just the `BranchId`, so "does the
 * payments bough contain this person" is answerable from the two subjects alone.
 */
export interface BranchPath {
  readonly tree: TreeId;
  readonly bough: BoughId;
  readonly branch: BranchId;
}

/**
 * A subject, carrying its COMPLETE ancestry rather than only its immediate parent.
 *
 * That is deliberate and it is the reason `containment` can be pure and total. The alternative
 * — an id plus a directory to look the parent up in — makes every containment question a
 * lookup that can miss, and a missed lookup has exactly two available answers: throw, or
 * return `false`. Returning `false` for "I could not find out" is the bug this repository
 * exists to refuse, one level up from `commitCount: 0`. Carrying the ancestry removes the
 * lookup, so the question cannot fail.
 *
 * A leaf sits on exactly one tree and on zero or more branches. Zero branches is a real and
 * common state (a founder, a new joiner, an individual contributor reporting to a business
 * unit directly) and is not an error.
 */
export type Subject =
  | { readonly kind: "tree"; readonly tree: TreeId }
  | {
      readonly kind: "bough";
      readonly tree: TreeId;
      readonly bough: BoughId;
    }
  | {
      readonly kind: "branch";
      readonly tree: TreeId;
      readonly bough: BoughId;
      readonly branch: BranchId;
    }
  | {
      readonly kind: "leaf";
      readonly tree: TreeId;
      readonly leaf: LeafId;
      readonly branches: readonly BranchPath[];
    };

/** The one kind of subject a person can be. Named because contributors are always people. */
export type LeafSubject = Extract<Subject, { kind: "leaf" }>;

/**
 * A stable key for a subject, for use as a Map key when tallying.
 *
 * OPAQUE — for grouping, never for display. It is kind-qualified because the branded id types
 * stop a `BranchId` reaching a function that wants a `BoughId`, but they erase at runtime: a
 * branch called "billing" and a person whose leaf is called "billing" would collide in a plain
 * `Map<string, …>` and silently merge two subjects' tallies. Segments are percent-encoded so a
 * `/` inside an id (or an `@` in an email-shaped one) cannot forge a different path.
 */
export function subjectKey(subject: Subject): string {
  const e = encodeURIComponent;
  switch (subject.kind) {
    case "tree":
      return `tree:${e(subject.tree)}`;
    case "bough":
      return `bough:${e(subject.tree)}/${e(subject.bough)}`;
    case "branch":
      return `branch:${e(subject.tree)}/${e(subject.bough)}/${e(subject.branch)}`;
    case "leaf":
      return `leaf:${e(subject.tree)}/${e(subject.leaf)}`;
  }
}

/** A subject in prose, for an error message that names what it is talking about. */
export function describeSubject(subject: Subject): string {
  switch (subject.kind) {
    case "tree":
      return `tree "${subject.tree}"`;
    case "bough":
      return `bough "${subject.bough}"`;
    case "branch":
      return `branch "${subject.branch}"`;
    case "leaf":
      return `leaf "${subject.leaf}"`;
  }
}

/**
 * The answer to "is `inner` inside `outer`".
 *
 * A discriminated union rather than a boolean, and BOTH arms carry prose. The negative answer
 * is the one that gets rendered to somebody — "this person is not on that branch, so their work
 * cannot be attributed to it" — and a bare `false` is exactly the unexplained absence the
 * `excluded` tier exists to prevent in the open plane.
 */
export type Containment =
  | { readonly relation: "contains"; readonly via: string }
  | { readonly relation: "separate"; readonly why: string };

const contains = (via: string): Containment => Object.freeze({ relation: "contains" as const, via });
const separate = (why: string): Containment =>
  Object.freeze({ relation: "separate" as const, why });

/**
 * Does `outer` contain `inner`? A subject contains itself.
 *
 * Total and pure: every pair of subjects has an answer, and the answer is derived only from
 * the ancestry the two subjects carry. Containment never crosses a tree — a tree is one
 * company and IS the tenancy boundary in this plane, and an artifact that reached across one
 * would be a leak, not a hierarchy question. That takes TWO checks, not one: the two subjects'
 * own trees, below, and the tree written inside each `BranchPath` a leaf carries. Checking only
 * the former honoured a membership naming a rival company's tree as containment, because ids
 * are scoped per tree and a shared string is not a shared branch.
 *
 * O(1), except for a leaf against a bough or branch, which is O(branches).
 */
export function containment(outer: Subject, inner: Subject): Containment {
  if (outer.tree !== inner.tree) {
    return separate(
      `${describeSubject(inner)} is in tree "${inner.tree}" while ${describeSubject(outer)} ` +
        `is in tree "${outer.tree}". Containment never crosses a tree boundary.`,
    );
  }

  switch (outer.kind) {
    case "tree":
      // Every subject here already grows on this tree; a tree contains all of its own.
      return contains(`tree "${outer.tree}" contains everything on that tree`);

    case "bough": {
      switch (inner.kind) {
        case "tree":
          return separate(
            `a bough does not contain the tree it grows from — the containment runs the other ` +
              `way.`,
          );
        case "bough":
          return inner.bough === outer.bough
            ? contains(`the same bough "${outer.bough}"`)
            : separate(
                `bough "${inner.bough}" is a sibling limb of "${outer.bough}", not a part of it.`,
              );
        case "branch":
          return inner.bough === outer.bough
            ? contains(`branch "${inner.branch}" belongs to bough "${outer.bough}"`)
            : separate(
                `branch "${inner.branch}" belongs to bough "${inner.bough}", not to ` +
                  `"${outer.bough}".`,
              );
        case "leaf": {
          // The membership's OWN tree is matched too, not just the two subjects'. Ids are
          // scoped per tree, so `payments` at a rival company is a different bough that
          // happens to share a string — and honouring it here would read a foreign tree's
          // branch as containment, which is the leak the tree check above exists to stop.
          // parseBranchPath refuses such a membership at the door; this function is exported
          // and total, so it has to hold on its own rather than on the parser having run.
          const via = inner.branches.find(
            (b) => b.tree === outer.tree && b.bough === outer.bough,
          );
          return via === undefined
            ? separate(
                `leaf "${inner.leaf}" has no recorded branch membership in bough ` +
                  `"${outer.bough}".`,
              )
            : contains(
                `leaf "${inner.leaf}" is on branch "${via.branch}", which belongs to bough ` +
                  `"${outer.bough}"`,
              );
        }
      }
    }

    case "branch": {
      switch (inner.kind) {
        case "tree":
        case "bough":
          return separate(
            `a branch does not contain ${describeSubject(inner)} — the containment runs the ` +
              `other way.`,
          );
        case "branch":
          return inner.branch === outer.branch && inner.bough === outer.bough
            ? contains(`the same branch "${outer.branch}"`)
            : separate(`branch "${inner.branch}" is a different branch from "${outer.branch}".`);
        case "leaf": {
          // Same rule as the bough arm above: the membership's own tree must match.
          const via = inner.branches.find(
            (b) =>
              b.tree === outer.tree &&
              b.branch === outer.branch &&
              b.bough === outer.bough,
          );
          return via === undefined
            ? separate(
                `leaf "${inner.leaf}" is not a recorded member of branch "${outer.branch}".`,
              )
            : contains(`leaf "${inner.leaf}" is a member of branch "${outer.branch}"`);
        }
      }
    }

    case "leaf":
      // A person contains no one. Anything else would be an org chart, and an org chart is a
      // statement about authority over people, which this package does not model.
      return inner.kind === "leaf" && inner.leaf === outer.leaf
        ? contains(`the same leaf "${outer.leaf}"`)
        : separate(
            `leaf "${outer.leaf}" contains no other subject — a person is a leaf of this ` +
              `hierarchy.`,
          );
  }
}
