/**
 * Rendering one TREE — a company and its real people — to HTML.
 *
 * DIVISION OF OWNERSHIP, the same split `apps/leaf/src/render.ts` uses. This module owns the
 * CONTRACT: which state the page is in, which numbers appear and where they come from, what is
 * escaped, and what may never appear. The visual layer — `public/tree.css` — owns everything
 * else, and the markup carries stable hooks (`data-tree-state`, `data-roster-row`,
 * `data-entry-failure`, `data-fabricated`) so styling and verification can address it without
 * depending on copy.
 *
 * SEVEN RULES, each one a defect if broken.
 *
 *   1. EVERY NUMBER COMES FROM THE DOMAIN. The roster size comes from `canopySize()`. This view
 *      never counts anything itself — a view that recomputes a count is a second implementation
 *      of the tally, and the two will disagree eventually, at which point the page asserts
 *      something the domain never said. `canopySize` is called on a one-tree canopy, which is
 *      not a contrivance: it is the only function in `@foliage/canopy` that will state how many
 *      leaves a tree holds, and going around it with `.leaves.length` is exactly the second
 *      implementation this rule forbids.
 *
 *   2. A PUBLIC SURFACE MAY ONLY COUNT WHAT IT MAY SHOW. Every per-person figure on this page
 *      comes from the PUBLIC PROJECTION — `projectTree` in `@foliage/canopy` — and never from a
 *      raw `Leaf`.
 *
 *      THIS PAGE SHIPPED BROKEN, AND THE BUG IS WHY THE RULE IS WORDED THAT WAY. Until C3 each
 *      roster row printed `attributionLedger(leaf)` — Verified / Pending / Excluded — computed
 *      over the RAW leaf document, on the first hop of the public chain, under a band that reads
 *      "Public canopy · Anyone may read this". A leaf document is a person's WHOLE portfolio:
 *      the `private` leaflets, the `unlisted` ones, the `pending` ones and the `excluded` ones.
 *      Those three integers therefore told a stranger how much work each person holds that they
 *      never offered anyone. `publicProjection.ts` was written to prevent precisely that — "a
 *      total that includes unlisted leaflets has leaked their existence just as surely as
 *      printing their titles" (rule 3 there) — and this view was committing it one level up,
 *      over a wider set, for every person on the roster at once.
 *
 *      A COUNT DISCLOSES EXISTENCE, and that reasoning stops neither at unlisted leaflets nor at
 *      leaflet counts. Any figure derived from a set the reader may not see publishes the size
 *      of that set. So the only per-person number this page may print is one the projection
 *      hands it, and the projection states exactly one: the size of `PublicLeaf.listed` — the
 *      same figure `/leaf/<id>` already prints under "Artifacts on this page", about the same
 *      set, to the same reader. Where the projection states no number, this page prints none.
 *      The `nothing-offered` and `nothing-publishable` arms carry no `listed` field at all, and
 *      a zero in their place would be a claim about the size of a set the reader is not entitled
 *      to know the size of.
 *
 *      NOT A TIER TRIPLE OVER THE LISTED SET, which is the plausible wrong repair. `listed` has
 *      already been through `publishableLeaflets`, so `pending` and `excluded` counted over it
 *      are structurally zero on every row of every tree — and a printed 0 reads as "this person
 *      has nothing pending", which is a false statement about a set this page cannot see. Two
 *      constant zeros beside one real figure is worse than the leak they replaced.
 *
 *   3. NO CROSS-PERSON AGGREGATE. A person's published count is that person's own accounting of
 *      their own published work and is shown. A tree-wide "358 verified · 41 pending" is NOT
 *      shown, and the omission is the product decision, not an unfinished feature:
 *      `@foliage/canopy` refuses to compute one ("a single figure summarising a company's people
 *      is a rating of those people", canopy.ts), so producing one here would route around the
 *      domain to manufacture precisely the artifact it declines to make.
 *
 *   4. THE ROSTER IS IN MANIFEST ORDER, always. Not sorted by leaflet count, not by published
 *      count, not by anything. Ordering people by any measure of their evidence IS a ranking,
 *      and it arrives at a score by a different road. The roster says "Not ranked", so a reader
 *      cannot mistake position for standing.
 *
 *   5. FAILURES ARE CONTENT. A manifest entry that did not load is rendered, with its cause,
 *      next to the roster it is missing from. A tree that renders four of five people and says
 *      nothing is reporting a company of four.
 *
 *   6. NO OUTWARD CLAIM IS MADE HERE. This page names people and links to their leaves; it does
 *      not restate their leaflets as assertions. `publishableLeaflets` is the leaf renderer's
 *      job and stays there.
 *
 *   7. NO EXPLANATIONS ON THE PAGE (owner, 2026-09-27). The reasoning — why the tier set is
 *      unordered, why counts are never combined, why the roster is in manifest order — lives in
 *      these comments. What stays visible is anything whose ABSENCE would mislead: the
 *      fabrication band, the example-document marker, the incomplete-roster caveat, and the
 *      honest empty states.
 *
 * Every interpolated value is escaped. A manifest and the documents it names are operator- and
 * subject-controlled files, very likely generated from repositories and commit messages, and
 * none of that is trustworthy HTML.
 *
 * ------------------------------------------------------------------------------------------
 * EVERY FIGURE THIS PAGE PRINTS, AND WHAT ENTITLES IT TO. Written down because rule 2 is a rule
 * about a CLASS of defect, and the way that class survives a fix is that the next figure gets
 * added without anyone re-running the audit. Six, and each one counts a set the same reader can
 * see in full on this page or on the page this page links to:
 *
 *   `data-fact="leaves"`   `canopySize({trees:[tree]}).leaves` — how many leaf DOCUMENTS loaded.
 *                          Every one of them is a named row in the roster below.
 *   `data-fact="named"`    `manifest.leaves.length` — how many entries the manifest holds. The
 *                          manifest is the company's own act, and every entry is either a named
 *                          row or a named failure. Nothing about a portfolio is in it.
 *   the shortfall          `named - size.leaves`, in the incomplete note, and `failures.length`
 *                          in the failure section. Each failure is rendered by entry and cause.
 *   `data-count=            `PublicLeaf.listed.length`, per person, from the projection. The
 *   "published"`           artifacts it counts are the ones `/leaf/<id>` enumerates, one click
 *                          away. This is the figure C3 fixed; see rule 2.
 *   manifest bytes         `source.bytes` — the size of the MANIFEST FILE, whose NAME is printed
 *                          beside it. An operator's file, not anyone's evidence. The name, not
 *                          the path: see `documentName` and F-031.
 *   signal count           `fabricationSignals(...).length`, only ever as one-vs-many for the
 *                          plural, and every signal is then printed in full.
 *
 * SWEPT AND CLEAN, same audit: nothing else here derives a number from anything. `renderTree`
 * touches `tree.leaves` only by handing it to `canopySize` and `projectTree`, and
 * `renderPublic.ts` touches it only to find ONE named document for the qualified link route —
 * an index, never a length.
 *
 * ------------------------------------------------------------------------------------------
 * THE DESIGN SYSTEM, AND THE SIX THINGS THE DESIGN SOURCE PROPOSES THAT THIS PAGE REFUSES.
 *
 * The markup below is built from `@foliage/tokens`' component layer — `.fol-nav`, `.cell`,
 * `.cells-2`, `.metric`, `.plate`/`.plate-t`/`.plate-b`, `.aside`, `.note`, `.m`, `.ico` — loaded
 * in the fixed order tokens → roles → foliage → tree.css. What stays in `tree.css` is this
 * surface's own chrome and nothing that restates a component; the masthead itself moved INTO
 * `foliage.css` as `.fol-nav` for exactly that reason — `tree-plane`/`tree-head` were this file's
 * own hand-rolled copy of the shell every real-data page needs, and `packages/foliage-tokens`
 * now ships that shell once, for every app.
 *
 * Open Design's `prototypes/organization-tree.html` is the source for the LAYOUT: the masthead,
 * the company headline and its scope sentence, the counts strip of `.cell`s each holding a
 * label and one large mono numeral, the bordered roster, the closing footer. Its CONTENT and
 * six of its ideas do not carry over:
 *
 *   R2  The `Whole tree · counts only` row (`Verified 358 / Pending 41 / Excluded 13 /
 *       Total 412`). A sum over fourteen people. Its own caption claims there is "nowhere in
 *       this layout that one could be added" — the four integers ARE the composite.
 *   R3  The per-team tier triple (`130 verified, 14 pending, 4 excluded` on a team row). Diff
 *       two teams and you have a leaderboard.
 *   R4  A `.proof` badge in a person row. A tier belongs to a LEAFLET. `Someone · leaf` badged
 *       pending reads as "this person is provisional", which is how `ProofTier` becomes a
 *       judgement of a human being. No `.proof` element appears anywhere on this page.
 *   R5  The `Unattributed` branch — the fourth tier wearing a bucket-of-people costume.
 *   R6  The ~190-ellipse radial projection. It is the most legible ranking on that page
 *       precisely because it is not a number: distance-from-trunk compares people.
 *   --  The tree-wide `Leaflets` total and `Last growth` cells of the structural counts strip.
 *       Both would have to be computed HERE by walking `tree.leaves`, which breaks rules 1 and
 *       2, and the first is a cross-person sum, which breaks rule 3. `canopySize` is the only
 *       tree-wide tally the domain will produce and it counts leaves, not artifacts. The strip
 *       is therefore two cells, not four, and the missing two are a refusal rather than a gap.
 *
 * BOUGHS AND BRANCHES ARE NOT RENDERED, and that is a fact about the domain rather than a
 * layout choice. The taxonomy is Canopy › Tree (a company) › Bough (an organization) › Branch
 * (a team) › Leaf › Leaflet, but `@foliage/canopy` deliberately models only Canopy, Tree and
 * Leaf ("their absence is a decision rather than an omission", canopy.ts). A tree manifest
 * carries no bough and no branch, so drawing them would mean inventing a structure for a real
 * company out of nothing. The honest rendering of a level the data does not have is its
 * absence.
 */

/*
 * NOTHING IS IMPORTED FROM `@foliage/leaf` HERE, and the absence is rule 2 made structural.
 *
 * The functions this page would reach for — `attributionLedger`, `publishableLeaflets`,
 * `leafletVisibility` — all take a raw `Leaf`, i.e. a whole portfolio, and this is a public
 * surface. Everything this page may say about a person now arrives already projected, so the
 * open plane's per-portfolio API has nothing left to offer it. `renderTree.test.ts` asserts the
 * absence over this file's source, because "we no longer call it" is a fact about today's code
 * and the gate has to be about tomorrow's.
 */
import { canopySize, projectTree, type LeafPolicyLookup, type PublicLeaf, type Tree } from "@foliage/canopy";

import { documentName, withoutMachinePath } from "./publicPath.ts";

import {
  fabricationSignals,
  type LeafEntryFailure,
  type LeafSource,
  type TreeLoad,
  type TreeLoadCause,
  type TreeManifest,
  type TreeSource,
} from "./treeDocument.ts";

/** Escape for both text nodes and double-quoted attribute values. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/*
 * NO TIER VOCABULARY LIVES IN THIS MODULE ANY MORE. It carried a `TIER_LABEL` map for the roster's
 * Verified / Pending / Excluded triple; the triple was the leak (rule 2) and the map went with it.
 * `renderPublic.ts` keeps its own, because a LEAFLET legitimately wears a tier and this page has
 * no leaflet on it. A shared copy here would be a tier vocabulary sitting on the one surface that
 * must not name a person's tiers, which is how the triple grows back.
 */

/**
 * THE NO-SCORE POLICY LABEL — an exempt region of the NO SCORE blocklist.
 *
 * The blocklist is a substring check over what this module writes, and a label saying no rating
 * is produced may need to name the thing it refuses. So exempt regions carry
 * `data-policy="no-score"` and the blocklist skips them — but only as FROZEN CONSTANTS that
 * interpolate nothing, so no count, name or path can reach them, and the tests require each to
 * appear in the served bytes EXACTLY. The exemption is worth these known strings and no more.
 */
export const NO_SCORE_POLICY = `<section class="cell tree-policy" data-policy="no-score" aria-labelledby="tree-policy-h">
<h2 id="tree-policy-h" class="fol-label">No company-wide figure</h2>
</section>`;

/**
 * The roster's order caption. It sits at the roster, next to the order it describes, and it
 * contains "rank" — so it is the second member of the CLOSED, ENUMERATED exemption set
 * (`POLICY_REGIONS`), never a wildcard on the attribute.
 */
export const ROSTER_ORDER_POLICY = `<p class="aside" data-policy="no-score">Not ranked</p>`;

/**
 * Every region the NO SCORE blocklist is not applied to. Enumerated, constant, and interpolating
 * nothing — no count, name or path from any document can reach any of them.
 */
export const POLICY_REGIONS: readonly string[] = Object.freeze([
  NO_SCORE_POLICY,
  ROSTER_ORDER_POLICY,
]);

/**
 * Strip the policy regions, so the NO SCORE blocklist can be applied to everything else.
 *
 * Exported because the TESTS are the consumer: the invariant belongs to the contract this module
 * owns, so the scoping rule lives here next to the exemptions it scopes rather than being
 * re-derived by each test that checks it.
 */
export function withoutPolicyRegions(html: string): string {
  return POLICY_REGIONS.reduce((acc, region) => acc.split(region).join(""), html);
}

/** Human wording for each way a manifest entry can fail to load. */
const CAUSE_LABEL: Readonly<Record<LeafEntryFailure["cause"], string>> = Object.freeze({
  absent: "No document at that path",
  unreadable: "Could not be read",
  malformed: "Not valid JSON",
  invalid: "Not a leaf document",
  duplicate: "Duplicate leaf id",
  // The leaf was fine; the sibling policy document was not. Named as ITS OWN failure — folding
  // it into "invalid" would send the person fixing it to the wrong file.
  "policy-invalid": "Policy document could not be used",
});

/*
 * NO STANDALONE `mark()` HELPER ANY MORE. `navBar` below is the one place this document's mark is
 * drawn, and it is a `<use>` reference — NEVER inline path data. The sprite itself is injected
 * once per document by `server.mjs`, straight out of `@foliage/tokens/foliage-sprite.svg`, so
 * this repository holds exactly one copy of the mark; an external `<use href="sprite.svg#id">`
 * is not an option (Chrome and Safari dropped cross-document references, and it never resolved
 * under `file://` at all). `#fol-mark-sm` is the ICON tier — three solid pairs, the correct asset
 * below ~20px, where the display tiers' leaflets close up and go to mud.
 */

/**
 * A native `<details>` disclosure: keyboard operable, announced by screen readers, no script (the
 * CSP forbids inline script). `detail` is markup the caller already escaped; `summary` is escaped
 * here. Used sparingly — the owner's rule (2026-09-27) is no explanations on the page.
 */
export function disclose(summary: string, detail: string): string {
  return `<details class="tree-why"><summary>${esc(summary)}</summary>
<div class="tree-why-body">${detail}</div>
</details>`;
}

/**
 * A line-art glyph from the same sprite.
 *
 * `.ico` is not optional decoration here: the `i-*` symbols carry no `fill` or `stroke` of their
 * own, so the class is what supplies `fill:none; stroke:currentColor` and the compensated
 * stroke-width. Without it the alert glyph renders as a solid disc. Always `aria-hidden` — every
 * one of these sits beside text that already says the same thing, and a second announcement is
 * noise to a screen reader.
 */
export function glyph(id: string, size: 14 | 16 | 20): string {
  return `<svg class="ico ico-${size}" aria-hidden="true"><use href="#${esc(id)}"></use></svg>`;
}

/**
 * THE FOUR REAL-DATA SURFACES OF THIS APP, and what they have in common.
 *
 *   /               the canopy itself — the public front door, and which tree(s) it loads
 *   /tree           a company and the people it gathers
 *   /leaf/<id>      one person's PUBLISHED work
 *   /leaflet/<id>   one PUBLISHED artifact
 *
 * `Surface` is what the page IS, and it is a parameter rather than a property of which module
 * rendered it — `apps/leaf/src/render.ts` states the whole argument, and the correction it
 * records is the one worth carrying: keying anything on the FACE worked only for as long as one
 * surface happened to be the exception. All four of these take the DAY face, because all four
 * are documents somebody else reads; `tree.css` keys the reading measure on `data-canopy-surface`
 * so a leaflet gets a document's line length while a roster keeps a table's.
 */
export type Surface = "canopy" | "tree" | "leaf" | "leaflet" | "demo" | "individuals" | "organizations";

/**
 * The state attribute each surface publishes, so a verification hook cannot be a guess.
 *
 * `/tree` keeps `data-tree-state` — it is the contract its own seams already pin, and renaming
 * it to please a shared helper would be a test-driven change to a shipped hook. `/` takes its own
 * `data-canopy-state` rather than reusing that name, because `/`'s vocabulary is the SAME
 * `TreeLoadCause` set plus `"ok"` — the causes agree, but a hook selecting `[data-tree-state]`
 * must keep meaning "the tree page" and not start also matching the front door. The two public
 * per-person pages take `data-public-state`, because their states are a different set entirely
 * (`listed`, `nothing-offered`, `nothing-publishable`, `not-reachable`, `ambiguous`) and one
 * attribute carrying two unrelated vocabularies is how a selector starts matching the wrong page.
 */
const STATE_ATTR: Readonly<Record<Surface, string>> = Object.freeze({
  canopy: "data-canopy-state",
  tree: "data-tree-state",
  leaf: "data-public-state",
  leaflet: "data-public-state",
  demo: "data-demo-state",
  individuals: "data-canopy-state",
  organizations: "data-canopy-state",
});

/**
 * THE .fol-nav CHROME, shared by every surface above — `@foliage/tokens`' component, never a
 * page-local copy (see `packages/foliage-tokens/src/shell.html`, the reference this markup
 * follows). The five links lead to this app's front door, two audience pages, Tree and Demo.
 * A leaf or a leaflet is reached by name from a reader route, not a top-level nav item, and
 * still carries this bar so the chrome remains consistent through the chain. The plane badge
 * names the public reading surface without asserting a publication exists: `/` and `/tree` can be empty, and `/demo` is an input
 * preview. The frozen publication reader has its own explicit Published badge.
 *
 * THE BRAND ICON IS `aria-hidden`, NOT `role="img" aria-label="Foliage"`. The old masthead this
 * replaces paired the mark with a DIFFERENT string ("Foliage — a tree") and needed the label to
 * name itself; this bar pairs it with the word "Foliage" right next to it in the same link, so a
 * second announcement of the same word would be pure repetition to a screen reader. This is the
 * same lockup `shell.html` demonstrates, and `treeCss.test.ts` pins this exact shape.
 */
function navBar(surface: Surface): string {
  const current = (target: Surface): string =>
    surface === target ? ' aria-current="page"' : "";
  return `<header class="fol-nav">
<div class="fol-nav-wrap">
<a class="fol-nav-brand" href="/"><svg class="m" width="17.6" height="20" aria-hidden="true"><use href="#fol-mark-sm"></use></svg>Foliage</a>
<nav class="fol-nav-list" aria-label="Primary">
<ul>
<li><a href="/"${current("canopy")}>Canopy</a></li>
<li><a href="/individuals"${current("individuals")}>Individuals</a></li>
<li><a href="/organizations"${current("organizations")}>Organizations</a></li>
<li><a href="/tree"${current("tree")}>Tree</a></li>
<li><a href="/demo"${current("demo")}>Demo</a></li>
</ul>
</nav>
<span class="fol-nav-plane" data-plane="public"><span class="fol-nav-plane-dot" aria-hidden="true"></span>Public view</span>
</div>
</header>`;
}

/**
 * THE ONE DOCUMENT SHELL FOR EVERY REAL-DATA PAGE THIS APP SERVES.
 *
 * Exported, and shared rather than copied, for a reason this repository has already paid for
 * twice in the stylesheet: THE FOUR `<link>`s ARE ORDER-DEPENDENT. tokens defines the primitives
 * and the face, roles aliases them, foliage builds components on the roles, and `tree.css` is
 * last so it can override a component without `!important`. Shuffle two and rules silently swap
 * winners on equal specificity. A second copy of this head in `renderPublic.ts` would be a
 * second place for that order to drift, with nothing on screen to show it had.
 *
 * The skip link and the `.fol-nav` masthead (`navBar`, one function up) are shared for the same
 * reason one class down: they are the same chrome, and a reader moving `/` → `/tree` →
 * `/leaf/<id>` → `/leaflet/<id>` is moving through one surface.
 */
export function shell(opts: {
  readonly title: string;
  readonly surface: Surface;
  readonly state: string;
  readonly body: string;
}): string {
  return `<!doctype html>
<html lang="en" data-face="day">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<link rel="stylesheet" href="/foliage-tokens.css">
<link rel="stylesheet" href="/roles.css">
<link rel="stylesheet" href="/foliage.css">
<link rel="stylesheet" href="/tree.css">
${opts.surface === "leaf" ? '<link rel="stylesheet" href="/portfolio.css">' : ""}
</head>
<body data-canopy-surface="${esc(opts.surface)}" ${STATE_ATTR[opts.surface]}="${esc(opts.state)}">
<a class="tree-skip" href="#tree-main">Skip to content</a>
${navBar(opts.surface)}
<main id="tree-main" class="tree-main">
${opts.body}
</main>
</body>
</html>
`;
}

function page(opts: {
  readonly title: string;
  readonly state: string;
  readonly body: string;
}): string {
  return shell({ ...opts, surface: "tree" });
}

/* ==============================================================================================
   THE ADDRESSES OF THE CANOPY CHAIN, declared ONCE.

   `/tree` links into `/leaf/<id>`, `/leaf/<id>` links into `/leaflet/<id>`, and `server.mjs`
   matches all three. Three consumers, one definition — a rendered `href` and the prefix the
   router tests against are the same fact, and this repository has already shipped the version of
   that bug where they were not (`apps/leaf/src/render.ts` records it: "a rendered href and the
   path the server matches cannot drift apart").

   THEY LIVE IN THIS MODULE RATHER THAN IN `renderPublic.ts`, WHICH IS THE ONLY THING ABOUT THIS
   PLACEMENT THAT IS NOT OBVIOUS. `renderPublic.ts` imports the shell, `esc` and `glyph` from
   here; putting the addresses there and importing them back would make the two modules a cycle.
   A cycle between two modules that both run at import time is a real hazard in ESM, not a style
   objection — one of them observes the other's `const` bindings in the temporal dead zone,
   depending only on which the runtime reaches first. So the shared, dependency-free facts sit in
   the module at the bottom of the graph, and the pages sit above it.

   `encodeURIComponent` then `esc`: the first makes an id survive a URL, the second makes it
   survive an HTML attribute. Ids come out of intake (`git:<sha>`) and out of a manifest, and
   neither is a string this module gets to trust.
   ============================================================================================== */

export const PUBLIC_LEAF_ROUTE = "/leaf/";
export const PUBLIC_LEAFLET_ROUTE = "/leaflet/";

/** The address of one person's PUBLISHED work. */
export function publicLeafHref(id: string): string {
  return `${PUBLIC_LEAF_ROUTE}${encodeURIComponent(id)}`;
}

/**
 * The address of one PUBLISHED artifact.
 *
 * `leaf` is OPTIONAL and it is a disambiguator, not an access control — see `resolvePublicLeaflet`
 * in `renderPublic.ts` for the measurement that forced it. A `LeafletId` is unique within one
 * person's document and nothing makes it unique across a company: intake mints `git:<sha>`, so
 * two colleagues who both take evidence from the same repository mint the same id. Qualifying the
 * address is what lets each of their artifacts have one.
 *
 * It grants nothing. A qualified request runs the same two domain gates as an unqualified one,
 * and a wrong or absent `leaf` produces the identical refusal — the parameter can only narrow.
 */
export function publicLeafletHref(id: string, leaf?: string): string {
  const base = `${PUBLIC_LEAFLET_ROUTE}${encodeURIComponent(id)}`;
  return leaf === undefined ? base : `${base}?leaf=${encodeURIComponent(leaf)}`;
}

/**
 * Exported so `renderCanopy.ts` can carry the identical warning onto the front door — the same
 * band, from the same signals, rather than a second rendering of "this is not real" that could
 * say it in different words on the two pages a reader meets it on.
 */
export function fabricationBand(manifest: TreeManifest, leafSources: readonly LeafSource[]): string {
  const signals = fabricationSignals(manifest, leafSources);
  if (signals.length === 0) return "";
  return `<aside class="cell tree-band" role="alert" data-fabricated="true">
<strong class="fol-label">${glyph("i-alert", 14)} Example tree — not a real company</strong>
<p>Nothing on this page describes a real company or real people — ${esc(signals.join("; "))}.</p>
</aside>`;
}

/**
 * What a row says in place of a figure, for each of the projection's two empty states.
 *
 * ONE SHORT SENTENCE EACH, AND THEY ARE THE HEADLINES `/leaf/<id>` USES VERBATIM.
 *
 * THE TWO ARE NEVER MERGED. "Published nothing" and "published work, none of it proven" are
 * different facts, and `publicProjection.ts` keeps them apart precisely so a page cannot print the
 * false one about somebody. Neither of them is a zero, and neither implies a size.
 *
 * The state is also published as `data-person-state` on the row — the same string `/leaf/<id>`
 * publishes as `data-public-state`. It discloses nothing the link does not, and it is what lets a
 * verification hook address a row's state without parsing copy.
 */
const PERSON_STATE_NOTE: Readonly<Record<Exclude<PublicLeaf["state"], "listed">, string>> =
  Object.freeze({
    "nothing-offered": "Nothing is published on this leaf.",
    "nothing-publishable": "Nothing here can be published as a claim.",
  });

/**
 * One person's row: their name, and the ONE figure the projection is willing to state about them.
 *
 * IT TAKES A `PublicLeaf`, NOT A `Leaf`, AND THAT IS THE FIX C3 EXISTS FOR. The parameter type is
 * the guarantee: a `PublicLeaf` has no `leaflets` field to count, no tier to tally and no ledger
 * to call, so the leak this row used to be cannot be re-expressed here without someone
 * deliberately threading a raw document back in. See rule 2 in the header for what it printed and
 * what that told a stranger.
 *
 * THE `listed` ARM PRINTS `listed.length` AND NOTHING ELSE. That number is the count of artifacts
 * this person has published — the exact set the reader can go and look at by following the link
 * in this row. Counting what you are already showing is the only count a public surface may make.
 *
 * THE OTHER TWO ARMS PRINT NO NUMBER AT ALL, and they print DIFFERENT SENTENCES. "This person
 * published nothing" and "this person published work none of which is proven" are different
 * facts, and `publicProjection.ts` keeps them apart precisely so a page cannot merge them into
 * one false one. Neither is a zero: the projection's empty arms have no `listed` field, so there
 * is no number here to print even by accident.
 *
 * THE NAME IS THE LINK INTO THE PERSON, AND EVERY ROW GETS ONE — including the rows of people
 * who have published nothing. That is deliberate and it is the opposite of the rule the leaf app
 * follows one plane down, so it is worth stating why the two differ.
 *
 *   On the subject's OWN leaf, a row for a private leaflet offers no link, because a link that
 *   404s on its owner is worse than no link (`openLink` in apps/leaf/src/render.ts).
 *
 *   Here, a person's page NEVER 404s: `projectLeaf` returns a person in all three of its states,
 *   and the two empty ones are real pages carrying that person's name and the honest reason
 *   there is nothing under it. So there is no dead link to avoid — and withholding the link for
 *   the empty states would be worse than useless, because the ABSENCE of a link would itself
 *   announce, on the roster, which of these people have published nothing. A link that leads to
 *   "nothing is published here" discloses exactly what the page it leads to discloses.
 *
 * AND THE PERSON IS NEVER DROPPED. Hiding a row to avoid printing a figure would be a different
 * leak wearing the fix's clothes: a roster shorter than the manifest tells a reader exactly which
 * of a company's people have nothing published, which is more than the figure ever did.
 * `projectTree` maps every leaf for the same reason, and this view maps every person it returns.
 *
 * The anchor wraps the name INSIDE the heading rather than replacing it, so the heading is still
 * the row's name to a screen reader and to `data-roster-row`'s contract.
 */
function rosterRow(person: PublicLeaf, source: LeafSource): string {
  /*
   * BOTH ARMS ARE `@foliage/tokens` COMPONENTS AND NEITHER NEEDS A NEW RULE IN `tree.css`, which
   * matters because this row changed shape and the stylesheet did not.
   *
   * `.metric` verbatim: label left, mono tabular numeral right, hairline under. ONE of them where
   * there used to be three, so `.tree-counts > .metric:last-child` still lands — on the only
   * child. Not a `.proof` badge and no tier anywhere: see R4 in the header, a tier belongs to a
   * leaflet and never to a human being.
   *
   * The empty arm is `.aside` and carries NO class of its own. A class with no rule behind it is
   * a hook that looks like styling and is not, and this surface's stylesheet belongs to another
   * file; the addressable thing is `data-person-empty`, which is a contract rather than a
   * selector nobody wrote.
   */
  const figure =
    person.state === "listed"
      ? `<div class="tree-counts">
<div class="metric" data-count="published"><span class="fol-label">Published</span><b class="fol-metric">${person.listed.length}</b></div>
</div>`
      : `<p class="aside" data-person-empty="${esc(person.state)}">${esc(
          PERSON_STATE_NOTE[person.state],
        )}</p>`;

  return `<li class="tree-person" data-roster-row="true" data-person-state="${esc(
    person.state,
  )}"${source.declaredExample ? ' data-fabricated="true"' : ""}>
<div class="tree-person-id">
<h3 class="tree-person-name"><a href="${esc(publicLeafHref(person.id))}">${esc(
    person.subject,
  )}</a></h3>
<p class="tree-person-src"><span class="fol-label">Document</span>
<span class="fol-metric">${esc(documentName(source.path))}</span></p>
</div>
${figure}
</li>`;
}

/**
 * The entries that did not load.
 *
 * Rendered ADJACENT to the roster and never below the fold of it, because the whole purpose is
 * that a reader counting people cannot finish counting without meeting this section.
 */
function failureSection(failures: readonly LeafEntryFailure[], named: number): string {
  if (failures.length === 0) return "";
  return `<section class="tree-failures" id="tree-failures" aria-labelledby="tree-failures-h" tabindex="-1">
<h2 id="tree-failures-h">${failures.length} of ${named} not loaded</h2>
<ul class="tree-failure-list">
${failures
  .map(
    (f) => `<li class="cell tree-failure" data-entry-failure="${esc(f.cause)}">
<h3 class="fol-label">${glyph("i-alert", 14)} ${esc(CAUSE_LABEL[f.cause])}</h3>
<p class="tree-failure-entry"><span class="fol-label">Entry</span>
<span class="fol-metric">${esc(f.entry)}</span></p>
<p class="tree-failure-detail">${esc(withoutMachinePath(f.detail, f.path))}</p>
${
  f.issues === undefined
    ? ""
    : `<ul class="tree-issues">
${f.issues
  .map(
    (i) =>
      `<li><span class="fol-metric tree-issue-at">${esc(i.at)}</span> ${esc(i.message)}</li>`,
  )
  .join("\n")}
</ul>`
}
</li>`,
  )
  .join("\n")}
</ul>
</section>`;
}

function renderTree(
  tree: Tree,
  manifest: TreeManifest,
  source: TreeSource,
  leafSources: readonly LeafSource[],
  policyFor: LeafPolicyLookup,
  failures: readonly LeafEntryFailure[],
): string {
  // RULE 1: the roster size is the domain's number, not `tree.leaves.length`.
  const size = canopySize({ trees: [tree] });
  const named = manifest.leaves.length;
  const complete = failures.length === 0;

  /*
   * THE HONEST EMPTY STATE, as a real `.plate` — glyph and `.plate-t` title, then the one fix.
   * There is deliberately NO loading plate anywhere on this surface: a synchronous
   * server render has no loading state, and drawing one would be a picture of something that
   * never happens here.
   */
  const emptyBlock = `<section class="tree-empty" data-tree-empty="true" aria-labelledby="tree-empty-h">
<div class="plate">
${glyph("i-folder", 20)}
<h2 id="tree-empty-h" class="plate-t">No leaf is on this tree yet.</h2>
</div>
<p class="aside">Add paths under <span class="fol-metric">leaves</span> in
<span class="fol-metric">${esc(documentName(source.path))}</span>.</p>
</section>`;

  /*
   * THE PROJECTION IS TAKEN ONCE, HERE, AND THE ROWS ARE BUILT FROM IT — rule 2.
   *
   * `projectTree` maps `tree.leaves` one-for-one and in order, so `people[i]` and `leafSources[i]`
   * are still the same manifest entry and the index pairing the loader established survives. That
   * ordering is `projectTree`'s documented contract ("Order is the tree's order, which is the
   * manifest's. Not sorted, ever."), which is also rule 4 of this file getting its guarantee from
   * the domain rather than from this loop remembering not to sort.
   */
  const people = projectTree(tree, policyFor).people;

  const rosterBlock = `<section class="tree-roster" id="tree-roster" aria-labelledby="tree-roster-h" tabindex="-1">
<h2 id="tree-roster-h">People</h2>
${ROSTER_ORDER_POLICY}
<ul class="tree-list">
${people.map((person, i) => rosterRow(person, leafSources[i] as LeafSource)).join("\n")}
</ul>
</section>`;

  return page({
    title: `${tree.company} — Canopy`,
    state: complete ? "ok" : "partial",
    body: `${fabricationBand(manifest, leafSources)}
<section class="tree-subject">
<h1>${esc(tree.company)}</h1>
<div class="cells-2 tree-facts">
<div class="cell tree-fact"><h2 class="fol-label">Leaves loaded</h2>
<b class="fol-metric" data-fact="leaves">${size.leaves}</b></div>
<div class="cell tree-fact"><h2 class="fol-label">Named by manifest</h2>
<b class="fol-metric" data-fact="named">${named}</b></div>
</div>
${
  complete
    ? ""
    : `<p class="aside tree-incomplete"><a href="#tree-failures">${
        named - size.leaves
      } not loaded</a> — counts are of what loaded.</p>`
}
</section>
${size.leaves === 0 && named === 0 ? emptyBlock : rosterBlock}
${failureSection(failures, named)}
${NO_SCORE_POLICY}
<footer class="tree-source">
<span class="fol-label">Manifest</span>
<span class="fol-metric">${esc(documentName(source.path))}</span>
<span class="fol-metric">${source.bytes} bytes</span>
<time class="fol-metric" datetime="${esc(source.readAt)}">read ${esc(source.readAt)}</time>
</footer>`,
  });
}

/**
 * A load failure, rendered as a page rather than a stack trace.
 *
 * Each cause keeps its own state. The first-run public page is an empty publication state;
 * configuration instructions belong in operator logs rather than on the reader's page.
 */
function renderFailure(load: Extract<TreeLoad, { ok: false }>): string {
  const heading: Readonly<Record<TreeLoadCause, string>> = {
    unconfigured: "Nothing published here yet.",
    absent: "No tree manifest at that path.",
    unreadable: "Could not read the tree manifest.",
    malformed: "The tree manifest is not valid JSON.",
    invalid: "That file is not a tree manifest.",
  };

  /*
   * One short line per cause: the fix where there is one, and otherwise what was NOT done —
   * nothing was counted, and nothing was guessed — because the failure mode this product is
   * guarding against is a page that quietly renders a zero. The first-run state omits this
   * operator detail entirely.
   */
  const sentence: Readonly<Record<TreeLoadCause, string>> = {
    unconfigured: "",
    absent: "No company was counted, and none was guessed.",
    unreadable: "No company was counted, and none was guessed.",
    malformed: "No company was counted, and none was guessed.",
    invalid: "Fix the fields below.",
  };

  const issues =
    load.cause === "invalid"
      ? `<ul class="tree-issues">
${load.issues
  .map(
    (i) => `<li><span class="fol-metric tree-issue-at">${esc(i.at)}</span> ${esc(i.message)}</li>`,
  )
  .join("\n")}
</ul>`
      : "";

  const where =
    load.path === null
      ? ""
      : `<p class="tree-person-src"><span class="fol-label">Path</span>
<span class="fol-metric">${esc(documentName(load.path))}</span></p>`;

  return page({
    // The heading is a sentence and carries its full stop; a <title> is a label and does not.
    title: `${heading[load.cause].replace(/\.$/, "")} — Canopy`,
    state: load.cause,
    body: `<section class="tree-fail" aria-labelledby="tree-fail-h">
<h1 id="tree-fail-h">${esc(heading[load.cause])}</h1>
${sentence[load.cause] ? `<p class="plate-b tree-fail-lede">${esc(sentence[load.cause])}</p>` : ""}
${load.cause === "unconfigured" ? "" : `<p class="tree-fail-detail">${esc(withoutMachinePath(load.detail, load.path))}</p>`}
${where}
${issues}
</section>`,
  });
}

/** The one entry point. Renders whichever of the six states the load produced. */
export function renderTreePage(load: TreeLoad): string {
  if (!load.ok) return renderFailure(load);
  // The rail's lookup is the loader's index alignment made loud: `policies[i]` missing for a
  // leaf the tree carries is a loader bug, and publishing under a guessed policy is the one
  // wrong answer — so it throws instead.
  return renderTree(
    load.tree,
    load.manifest,
    load.source,
    load.leafSources,
    (leaf, i) => {
      const policy = load.policies[i];
      if (policy === undefined) {
        throw new Error(`no policy loaded for tree.leaves[${i}] ("${leaf.id}") — refusing to project without the rail`);
      }
      return policy;
    },
    load.failures,
  );
}
