/**
 * THE PUBLIC PROJECTION — what of a person's leaf a CANOPY may show.
 *
 * This is the cardinal-sin file. Everything else in the cloud plane can be wrong and cost a
 * reader a confusing page; this one can publish evidence its subject never offered anyone. So
 * it is written to make that mistake IMPOSSIBLE TO EXPRESS rather than merely absent from the
 * current renderer.
 *
 * THE GAP THIS CLOSES, measured 2026-08-19 before it was written:
 * `grep -rn 'visibility\|isLinkShareable' packages/canopy apps/canopy` returned NOTHING. The
 * open plane had carried per-leaflet visibility for a while — `private | unlisted | public`,
 * DEFAULT PRIVATE EXPRESSED BY THE FIELD'S ABSENCE — and the cloud plane, which is the actual
 * public surface, did not know the field existed. `Tree.leaves` holds whole `Leaf` documents,
 * so a canopy view that rendered what it was handed would have published every private leaflet
 * in the tree. On a fresh intake of this repository that is all 40 of them.
 *
 * ------------------------------------------------------------------------------------------
 * WHAT CHANGED, 2026-08-19, AND THE MEASUREMENT THAT FORCED IT.
 *
 * This file used to apply TWO gates: visibility AND tier, the second by intersecting with
 * `publishableLeaflets` from `@foliage/leaf`, which is `tier === "verified"` and nothing else.
 * That gate is GONE. Only the visibility gate remains, plus a narrower refusal described in
 * rule 2 below. The reasoning that used to sit here argued FOR the tier gate and is now false,
 * so it has been removed rather than left to be quoted by the next reader.
 *
 * WHY, measured on this repository today, with the real producer and no fixtures:
 *
 *   node apps/leaf/intake.mjs --repo . --subject "A. Acker" \
 *     --identity 126364027+aacker71@users.noreply.github.com
 *   → intake: read 57 non-merge commit(s)
 *   → intake: verified 0  pending 57  excluded 0
 *   → intake: 1 commit(s) CARRY A SIGNATURE THIS MACHINE DID NOT CHECK
 *   → intake: PGP — git invokes "gpg", which cannot be executed here.
 *
 * `which gpg` finds nothing on this machine, so git answers `N` — its code for NO SIGNATURE —
 * about a commit that plainly holds one, and that commit sits at `pending` for want of a
 * checker rather than for want of a signature. Under the old rule EVERY person page on real
 * data rendered `nothing-publishable` and the canopy could list NOTHING, EVER. A surface whose
 * only reachable state on real input is empty is not a strict surface, it is a broken one.
 *
 * And it does not end when someone installs gpg. `docs/ENGINEERING-PLAN.md` §3: **for a weld
 * there is no cryptographic authorship and never will be** — the tier is unreachable BY
 * DEFINITION for a welder, a nurse, a chef, an electrician. A canopy gated on `verified` is
 * permanently empty for most of the people this product is for, and stretching `verified` to
 * cover them would be exactly the overclaim the tier set exists to prevent.
 *
 * THE DECISION (owner, 2026-08-19): **the subject decides WHAT TO PUBLISH; the tier tells the
 * reader WHAT IT PROVES.** Conflating the two is what made the surface empty. Publishing is a
 * consent question and it is answered by `visibility`. Proof strength is a different question
 * and it is answered by displaying the tier honestly beside the work — never by hiding the
 * work, which tells the reader nothing at all. A `pending` artifact on a public page is not a
 * quiet overclaim; it is the page saying, in the leaf app's own words, that the artifact is
 * attributable and that authorship is NOT cryptographically established.
 *
 * What this does NOT weaken, and the tests hold each one:
 *   - `private` (including private by absence) is still unrepresentable in the output.
 *   - `unlisted` still appears in no roster, no index, and no COUNT.
 *   - `excluded` is still refused everywhere — see rule 2, which is the one tier fact left.
 *
 * ------------------------------------------------------------------------------------------
 * FOUR RULES. Each one is a defect if broken, not a preference.
 *
 *   1. THE VISIBILITY RULE IS IMPORTED, NEVER RESTATED. `leafletVisibility`, `isListedOnLeaf`
 *      and `isLinkShareable` all come from `@foliage/leaf`. `cloud` may depend on `open` and
 *      that direction is the boundary working as intended — so there is no excuse for a second
 *      copy of a privacy rule here, and a second copy is exactly how the two drift until one of
 *      them starts publishing. In particular the default lives in ONE function: nothing in this
 *      file reads `.visibility` directly, because `undefined` read raw is how "not decided"
 *      silently becomes "not private".
 *
 *   2. `private` AND `excluded` ARE UNREPRESENTABLE IN THE OUTPUT. Not filtered late by a
 *      renderer that could forget — absent from the TYPE. `ListableLeaflet` and
 *      `ReachableLeaflet` intersect the union with a literal `visibility` AND drop the
 *      `excluded` arm, so neither a private leaflet (including private by absence, since
 *      absence is not `"public"`) nor an excluded one can be placed in either without a
 *      deliberate cast. The arrays are frozen as well: the type stops the compiler-honest
 *      mistake, the freeze stops a `.push` into a projection someone already holds.
 *
 *      `excluded` IS NOT A TIER GATE AND THAT DISTINCTION IS THE WHOLE POINT OF THIS RULE.
 *      The gate that was removed asked HOW STRONGLY PROVEN this work is, and the answer to
 *      that question is now printed rather than acted on. `excluded` answers a different
 *      question: **whose work is this?** `@foliage/leaf` defines it as "could not be attributed
 *      to this subject", it requires a `reason`, and `intake.ts` mints it for a commit whose
 *      author is an identity the subject never declared. Publishing it on this person's page
 *      would not be an overclaim about proof — it would be a FALSE ATTRIBUTION, printing
 *      somebody else's work under this person's name. `pending` is the subject's own work
 *      pending a check; `excluded` is not the subject's work at all. That is why one is
 *      published with its tier shown and the other is refused outright.
 *
 *      THE REFUSAL IS SPELLED IN `@foliage/leaf`, IMPORTED HERE, AND IT IS NOT AN ORDERING.
 *      `isSubjectsOwnWork` is an exhaustive `switch` over `Leaflet`'s tier — no comparator, no
 *      ranking, no numeric mapping, `ProofTier` stays unordered. It used to be spelled in this
 *      file, because at the time `@foliage/leaf` exported no function for "is this the
 *      subject's own work" — the one it exported, `publishableLeaflets`, answers the
 *      verified-only question this file does not ask. This became the second surface that
 *      needed the same question, so per the rule this paragraph used to state, the switch
 *      moved to `@foliage/leaf` beside `publishableLeaflets` and this file imports it rather
 *      than restating it.
 *
 *      The switch is exhaustive on purpose and that is load-bearing rather than stylistic:
 *      adding a fourth `ProofTier` makes it a COMPILE ERROR (verified against tsc 5.9.3 —
 *      `TS2366: Function lacks ending return statement`), so the next tier this product grows,
 *      which §3 of the plan says is coming for physical work, cannot reach a public page
 *      because nobody remembered this file. A `!== "excluded"` test would have admitted it
 *      silently.
 *
 *   3. `unlisted` IS NOT `public`, AND THE DIFFERENCE IS THIS FILE'S WHOLE POINT. Being
 *      willing to hand someone a LINK is a different consent from being ENUMERATED. So an
 *      unlisted leaflet appears in NO browse surface: not in a roster, not in an index, and
 *      NOT IN A COUNT. A total that includes unlisted leaflets has leaked their existence just
 *      as surely as printing their titles — the reader learns there are five things they were
 *      not shown, which is precisely the fact the subject withheld. That is why the browse
 *      projection has no field an unlisted leaflet could reach, and why the single-artifact
 *      lookup below takes the RAW `Leaf` rather than the projection: a link route cannot be
 *      served out of the browse view by construction, so the two consents cannot be crossed by
 *      an accidental reuse.
 *
 *   4. COUNTS ONLY, AND NEVER ACROSS PEOPLE. `canopy.ts` already refuses to compute a figure
 *      summarising a company's people, because "a single figure summarising a company's people
 *      is a rating of those people". This file extends that reasoning rather than weakening
 *      it: `publicCanopySize` counts TREES and PEOPLE — sizes of the manifest, not measures of
 *      anyone's work — and there is deliberately NO canopy-wide or tree-wide leaflet total. A
 *      per-person listed count is that person's own tally and is available as
 *      `listed.length`; diff two of those across a roster and you have a leaderboard, which is
 *      why nothing here produces the sum for you. No ratio, no percentage, no composite, and
 *      the roster stays in manifest order — sorting people by any measure of their evidence IS
 *      a ranking, arrived at by a different road.
 *
 *      Dropping the tier gate makes this rule MORE load-bearing, not less. Listed sets are no
 *      longer near-universally empty on real data, so a tempting per-tree total now has real
 *      numbers to add up. It is still not offered, and a listed set still carries no tier
 *      tally: "3 verified, 9 pending" for one person next to "9 verified, 3 pending" for
 *      another is a ranking of two people by how checkable their trade is. Per artifact, the
 *      tier is a fact the reader needs. Per person, summed, it is a score.
 *
 * ------------------------------------------------------------------------------------------
 * THE PROJECTED LEAFLET CARRIES ITS TIER, AND THAT IS WHAT MAKES THIS HONEST.
 *
 * `ListableLeaflet` and `ReachableLeaflet` are intersections with `Leaflet`, not a stripped
 * projection type, so `tier` — and `provenance`, and `reason`'s absence — travel to the
 * renderer intact. That is deliberate and it is the load-bearing half of this change: removing
 * the tier gate WITHOUT carrying the tier would publish unproven work with nothing on the page
 * to say so, which is the overclaim the old gate was defending against. The gate is replaced by
 * a disclosure, so the disclosure has to be reachable.
 *
 * The words belong to the surface, not to the domain: `apps/canopy/src/renderPublic.ts` holds
 * `TIER_STANDING`, total over all three tiers, saying of `pending` that the artifact "is
 * attributed to one of this person's declared identities and authorship is NOT
 * cryptographically established". That map was already written total, against the day this
 * rule widened, which is today. This file does not spell those words a second time — two
 * copies of a disclosure is how one of them goes stale while the other keeps being quoted.
 *
 * ------------------------------------------------------------------------------------------
 * AN EMPTY PORTFOLIO IS NOT A MISSING ONE, AND NEITHER IS A ZERO.
 *
 * Three states a browse surface must be able to tell apart, and the union below makes all
 * three say something different:
 *
 *   NO SUCH PERSON            `findPublicLeaf` returns `{ found: false }` with a named cause.
 *   PUBLISHED NOTHING         the person is present, `state: "nothing-offered"`.
 *   OFFERED, NONE PUBLISHABLE the person is present, `state: "nothing-publishable"` — they
 *                             marked work `public` and none of it may be printed under their
 *                             name. TWO different facts reach this and the state deliberately
 *                             does not carry which. See `projectLeaf`.
 *
 * THE THIRD STATE SURVIVED THIS CHANGE WITH A NARROWER MEANING, and it had to. Under the old
 * rule it was reached by a public `pending` leaflet, which is now listed instead — the whole
 * point. Two things still reach it, and THIS PARAGRAPH USED TO NAME ONLY ONE, which is how
 * F-028 shipped: a later author read "every piece of it is `excluded`" here, believed it, and
 * wrote a public page that told a person their work could not be attributed to them when the
 * RAIL had withheld it. The two are:
 *
 *   ATTRIBUTION  the public set is entirely `excluded`. Rarer, and still a real document:
 *                `intake.ts` mints excluded leaflets for third-party commits in any repository
 *                the subject did not write alone, and `share.mjs` will mark one public if asked.
 *   THE RAIL     every offered leaflet is absolutely DENIED by the publish policy
 *                (`deny-rating-shaped-title`, `deny-third-party-evidence`, `deny-no-evidence`).
 *                Reached on work that IS the subject's, at any tier including `verified`.
 *
 * Collapsing it into `nothing-offered` would make the page LIE — "this person has published
 * nothing" about someone who published — and it is the "four causes collapsed into 0" failure
 * wearing a privacy costume. It is a named state and never a number: no count of the withheld
 * set is emitted anywhere, because such a count is a measure of how much of a person's work was
 * held back. And because the state does not carry WHICH of the two applies, no surface may name
 * a cause: `apps/canopy/src/renderPublic.ts` learned that the expensive way.
 *
 * Note what CANNOT reach `nothing-publishable`: unlisted leaflets. The state is computed from
 * the `public` set alone, so a person holding nothing but unlisted work reports
 * `nothing-offered` — identical to a person holding nothing at all. Rule 3, in the one place
 * it would have been easiest to leak.
 *
 * The empty states carry NO `listed` field at all, rather than an empty array. A renderer
 * cannot print "0 artifacts" from a field that does not exist, and a failure is never a zero.
 *
 * ------------------------------------------------------------------------------------------
 * PURE AND TOTAL. No fs, no network, no clock, no throw — this is domain, and the subprocess
 * and disk work lives in `apps/*`. O(n) in one person's leaflets per leaf, O(people × leaflets)
 * for a whole canopy, single pass, no index: a person's portfolio is human-sized and an index
 * would be a second structure to keep in agreement with the document it came from.
 */

import {
  evaluatePolicy,
  isAbsoluteDenial,
  isLinkShareable,
  isListedOnLeaf,
  isSubjectsOwnWork,
  leafletVisibility,
  type Leaf,
  type LeafId,
  type Leaflet,
  type PublishPolicy,
  type SubjectsOwnLeaflet,
} from "@foliage/leaf";

import type { Canopy, Tree, TreeId } from "./canopy.ts";
import { orderAdmittedLeaflets } from "./curationOrder.ts";

/**
 * Has the subject offered this outward at all? The imported rule, with the default applied in
 * `@foliage/leaf` and nowhere else.
 *
 * Separate from `isListable` because the two empty states need this answer WITHOUT rule 2
 * applied: a person whose only public leaflet is `excluded` has offered something, and
 * reporting `nothing-offered` about them would be the false sentence.
 */
function isOfferedOutward(leaflet: Leaflet): boolean {
  return isListedOnLeaf(leafletVisibility(leaflet));
}

/**
 * A leaflet a canopy may LIST — name it in a roster, index it, link to it, count it.
 *
 * Exactly one visibility qualifies and the type says so literally. `unlisted` is excluded on
 * purpose (rule 3) and `private` is excluded twice over: the word is not in the literal union,
 * and neither is `undefined`, which is how the default is spelled. `excluded` cannot be here
 * either, because `SubjectsOwnLeaflet` has no arm for it (rule 2).
 *
 * `tier` rides along, because it is `Leaflet`'s own field on an intersection rather than a
 * field this type chose to copy. A renderer holding one of these can always say what it proves.
 */
export type ListableLeaflet = SubjectsOwnLeaflet & { readonly visibility: "public" };

/**
 * A leaflet a canopy may serve AT ITS OWN ADDRESS to whoever holds the link.
 *
 * Strictly wider than `ListableLeaflet` and never used to build a browse surface. The only
 * consumer is `findPublicLeaflet`, which is handed one id at a time.
 */
export type ReachableLeaflet = SubjectsOwnLeaflet & {
  readonly visibility: "unlisted" | "public";
};

/**
 * May a canopy LIST this leaflet? The imported visibility rule, plus rule 2, narrowed to a type.
 *
 * This function's only original contribution is telling the compiler what a `true` answer means.
 */
export function isListable(leaflet: Leaflet): leaflet is ListableLeaflet {
  return isOfferedOutward(leaflet) && isSubjectsOwnWork(leaflet);
}

/** May a canopy serve this leaflet to a link-holder? Same shape, the other imported rule. */
export function isReachableByLink(leaflet: Leaflet): leaflet is ReachableLeaflet {
  return isLinkShareable(leafletVisibility(leaflet)) && isSubjectsOwnWork(leaflet);
}

/**
 * One person, as a canopy may show them.
 *
 * A union rather than a struct with an empty array, so the three outcomes cannot be confused
 * by a renderer that only checks `.length`. `id` and `subject` are present in every arm: a
 * person who published nothing is still a person, and their company's manifest is what named
 * them, not this file.
 */
export type PublicLeaf =
  | {
      readonly id: LeafId;
      readonly subject: string;
      readonly state: "listed";
      /** Non-empty by construction: the empty case is one of the other two arms. */
      readonly listed: readonly ListableLeaflet[];
    }
  | {
      /** The subject has offered nothing outward. Not an error, and not an absent person. */
      readonly id: LeafId;
      readonly subject: string;
      readonly state: "nothing-offered";
    }
  | {
      /**
       * The subject offered work outward and none of it may be printed under their name —
       * because every piece is `excluded` (somebody else's), OR because the publish rail denies
       * every piece (which happens to work that IS theirs, at any tier). WHICH ONE IS NOT
       * CARRIED, deliberately: the deny reason is the subject's own accounting and a public
       * roster stating it would leak what the rule protects. A surface that names a cause is
       * therefore guessing — see F-028. Distinct from `nothing-offered` because those two are
       * different facts and merging them would print a false one about a person who published.
       */
      readonly id: LeafId;
      readonly subject: string;
      readonly state: "nothing-publishable";
    };

/** One company, as a canopy may show it. People stay in the order the tree gave them. */
export interface PublicTree {
  readonly id: TreeId;
  readonly company: string;
  readonly people: readonly PublicLeaf[];
}

/** The browsable layer. */
export interface PublicCanopy {
  readonly trees: readonly PublicTree[];
}

/**
 * Project one leaf into what a canopy may show of it.
 *
 * THREE PASSES, IN THIS ORDER, AND THE ORDER IS THE POINT:
 *
 *   OFFERED — has the subject offered this outward at all? `isOfferedOutward`, i.e.
 *   `isListedOnLeaf(leafletVisibility(l))` from `@foliage/leaf`. This is the subject's consent
 *   and it is checked first, because whether they offered anything is what distinguishes the
 *   two empty states, and computing that from an already-filtered set would report
 *   `nothing-offered` about someone who offered plenty.
 *
 *   THE RAIL — does the subject's publish policy absolutely DENY it? `isAbsoluteDenial` over
 *   `evaluatePolicy`, imported from `@foliage/leaf` — the SAME functions the leaf app asks
 *   before serving a shared leaflet, never a restatement. It runs AFTER consent on purpose:
 *   a deny's defining property is that it beats the subject's own share (`publishPolicy.ts`,
 *   "DENY is ABSOLUTE"). Until 2026-08-24 this pass did not exist here, which was the audited
 *   defect (corpse dated 2026-08-20): the leaf answered 404 for a denied leaflet while the
 *   canopy — the plane with the audience — answered 200 for the same id. One more decision,
 *   deliberately NOT made here: a denied leaflet is silently absent, its deny REASON never
 *   travels into the projection. Reasons are the subject's own accounting; they read them on
 *   their own leaf, and a public roster that printed "withheld because …" would leak the very
 *   thing the rule protects.
 *
 *   THEIRS — is what they offered their own work? `isSubjectsOwnWork`, which refuses `excluded`
 *   and nothing else. What it does NOT do is ask how strongly proven the work is: the tier
 *   travels with the leaflet and the surface prints it. That is the change of 2026-08-19,
 *   recorded at the top of this file with the measurement that forced it.
 *
 * A leaf whose every offered leaflet is denied projects as `nothing-publishable` — true (they
 * offered; nothing may be published) and deliberately indistinguishable from the tier-shaped
 * empty state, for the same reason the reason-string stays off the page.
 */
export function projectLeaf(leaf: Leaf, policy: PublishPolicy): PublicLeaf {
  const offered = leaf.leaflets.filter(isOfferedOutward);
  if (offered.length === 0) {
    return Object.freeze({ id: leaf.id, subject: leaf.subject, state: "nothing-offered" as const });
  }

  const railed = offered.filter((l) => !isAbsoluteDenial(evaluatePolicy(policy, l)));
  const listed = railed.filter(isListable);
  if (listed.length === 0) {
    return Object.freeze({
      id: leaf.id,
      subject: leaf.subject,
      state: "nothing-publishable" as const,
    });
  }

  return Object.freeze({
    id: leaf.id,
    subject: leaf.subject,
    state: "listed" as const,
    listed: orderAdmittedLeaflets(leaf, listed),
  });
}

/**
 * Project one tree.
 *
 * EVERY person in the tree appears, including those whose projection is empty. Dropping them
 * would make the canopy's roster disagree with the company's manifest with nothing on the page
 * to explain the gap — the same defect `treeDocument.ts` refuses when a leaf fails to load,
 * and here it would additionally mean a person's participation was decided by how much of
 * their work happened to be verified.
 *
 * Order is the tree's order, which is the manifest's. Not sorted, ever.
 */
export function projectTree(tree: Tree, policyFor: LeafPolicyLookup): PublicTree {
  return Object.freeze({
    id: tree.id,
    company: tree.company,
    people: Object.freeze(tree.leaves.map((leaf, i) => projectLeaf(leaf, policyFor(leaf, i)))),
  });
}

/** Project a whole canopy. Trees keep their order too. */
export function projectCanopy(canopy: Canopy, policyFor: LeafPolicyLookup): PublicCanopy {
  return Object.freeze({
    trees: Object.freeze(canopy.trees.map((tree) => projectTree(tree, policyFor))),
  });
}

/**
 * How a projection finds each subject's publish policy.
 *
 * A FUNCTION, not an array, so this package never guesses where policies live — the caller
 * (the canopy app, whose loader reads them off disk beside each leaf) owns that. And it is
 * REQUIRED, not optional: an optional policy parameter defaulting to "no rail" is precisely
 * how the 2026-08-20 bypass happened the first time. A caller with genuinely no policy states
 * it by passing `() => theDefaultPolicy` — the default document ships the deny rules — and
 * that line is visible in review, where an omitted argument is not.
 */
export type LeafPolicyLookup = (leaf: Leaf, index: number) => PublishPolicy;

/**
 * Re-exported so canopy SURFACES can name the policy type without importing `@foliage/leaf` —
 * the render modules carry a source gate refusing any import from the open plane's raw-document
 * API, and the type riding through this package keeps that gate meaningful.
 */
export type { PublishPolicy } from "@foliage/leaf";

/**
 * Counts of what the public canopy contains.
 *
 * TREES AND PEOPLE, and deliberately NOT LEAFLETS. `canopySize` counts the same two things one
 * layer down and for the same reason: how many companies and how many people are listed are
 * sizes of a manifest, and neither is a measure of anyone's work. A public leaflet total would
 * be — summed across a roster it is a company scoreboard, and differenced across two rosters it
 * ranks companies by how much their people have proven.
 *
 * `people`, not `leaves`, because that is what the number means on a browse surface; the count
 * is identical to `canopySize`'s `leaves` and the two must never disagree, so nothing here
 * recomputes anything the projection did not already settle.
 *
 * O(trees).
 */
export function publicCanopySize(canopy: PublicCanopy): { trees: number; people: number } {
  return {
    trees: canopy.trees.length,
    people: canopy.trees.reduce((n, t) => n + t.people.length, 0),
  };
}

/**
 * Looking one person up on a browse surface.
 *
 * ONE CAUSE, and that is the honest number here rather than an under-report. A person is never
 * hidden by this projection: someone who published nothing comes back `found: true` carrying
 * an empty state, so the only way to miss is that no leaf with this id is in the canopy. That
 * is the exact opposite of the leaflet lookup below, where collapsing causes is the point, and
 * the two are different because a canopy's roster is public by the company's own act while a
 * leaflet's existence is the subject's to disclose.
 *
 * Returns the containing tree, mirroring `treeContaining`: a person page names their company,
 * and re-finding it would be a second traversal that could disagree with this one.
 *
 * O(people). First match wins; a second is a data defect, as `treeContaining` already says.
 */
export type PublicLeafLookup =
  | { readonly found: true; readonly leaf: PublicLeaf; readonly tree: PublicTree }
  | { readonly found: false; readonly cause: "no-such-leaf"; readonly requestedId: string };

export function findPublicLeaf(canopy: PublicCanopy, id: string): PublicLeafLookup {
  for (const tree of canopy.trees) {
    const leaf = tree.people.find((p) => p.id === id);
    if (leaf !== undefined) return { found: true, leaf, tree };
  }
  return { found: false, cause: "no-such-leaf", requestedId: id };
}

/**
 * Looking one leaflet up at its own address.
 *
 * IT TAKES THE RAW `Leaf`, NOT THE PROJECTION, AND THAT IS THE DESIGN. An `unlisted` leaflet is
 * absent from `PublicLeaf` by construction — that is rule 3 — so a link route served out of
 * the browse view would answer "nothing there" for every leaflet whose whole purpose is to be
 * reachable by link. Handing this function the document instead keeps the two consents in
 * separate code paths, where neither can be satisfied by accident.
 *
 * IT MUST AGREE WITH `projectLeaf`, AND SINCE 2026-08-19 IT DOES. Both gates moved together on
 * purpose: while this one still applied the tier gate, a `pending` leaflet listed on a person
 * page would have linked to an address that answered 404. A roster whose own links refuse is a
 * worse surface than either rule alone, and `apps/leaf` already learned the smaller version of
 * this — "a link that would 404 is worse than no link", `render.ts`'s `openLink`.
 *
 * STILL NARROWER THAN `apps/leaf`'s `findLeaflet`, BY EXACTLY ONE FACT. That function is
 * `isLinkShareable` alone, so it will serve an EXCLUDED leaflet to a link-holder — correct
 * there, because that surface is the subject's own machine showing them their own accounting,
 * including the accounting of what was not theirs. This one is a hosted service restating work
 * to a stranger, where the same page would attribute somebody else's commit to this subject.
 * The cause here is `not-reachable` rather than `not-shareable` precisely so the two names do
 * not imply the same test.
 *
 * ONE CAUSE, ON PURPOSE, AND THIS IS THE ONE PLACE IN THIS REPOSITORY WHERE NOT NAMING BOTH
 * CAUSES IS CORRECT. "No such id", "private", "unlisted-and-you-guessed-it" and "somebody
 * else's work" all answer identically, because a lookup that distinguished them would let
 * anyone learn which leaflet ids exist by trying ids. The subject is not left in the dark:
 * their own leaf page tells them, per row, why a leaflet has no link. The stranger at the URL
 * learns only the rule.
 *
 * O(n) over one person's leaflets.
 */
export type PublicLeafletLookup =
  | {
      readonly found: true;
      readonly leaflet: ReachableLeaflet;
      readonly leaf: LeafId;
      readonly subject: string;
    }
  | { readonly found: false; readonly cause: "not-reachable"; readonly requestedId: string };

export function findPublicLeaflet(leaf: Leaf, id: string): PublicLeafletLookup {
  const found = leaf.leaflets.find((l) => l.id === id);
  if (found === undefined || !isReachableByLink(found)) {
    return { found: false, cause: "not-reachable", requestedId: id };
  }
  return { found: true, leaflet: found, leaf: leaf.id, subject: leaf.subject };
}
