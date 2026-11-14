import { workspaceNavigation } from "./workspaceNavigation.ts";
import { portfolioStyle, redactIdentifiers, type PortfolioPresentation } from "@foliage/leaf";
/**
 * Rendering this app's core surfaces to HTML, and the shared shell every owner page now sits in.
 *
 *   `/leaf`          the compound leaf — one person's portfolio. Lived at `/` until the studio
 *                    grew a dashboard; `/` now renders the dashboard instead, with a prominent
 *                    link here (see `overview.ts`), rather than a redirect.
 *   `/leaflet/<id>`  ONE leaflet as a standalone artifact, linkable and shareable WITHOUT
 *                    handing over the compound. Its own section below states what that costs.
 *   `/review`        the harvest queue: machine-drafted candidates a person approves or rejects,
 *                    written back through the same gate the CLI writes through.
 *
 * The four rules below were written for the first of those and bind all three.
 *
 * `page()` IS EXPORTED, and `/`, `/garden`, `/policy` and `/publish` are rendered by sibling
 * modules (`overview.ts`, `garden.ts`, `policyPage.ts`, `publishPreview.ts`) that call it rather
 * than duplicating it — the same "one renderer" discipline `export.mjs`'s header states for
 * `renderLeafPage`. What those four modules do NOT get from here is the safety property `nav`
 * exists to protect: only THIS file may decide which surfaces are reachable by a stranger
 * (`renderLeafletArtifact`, `renderNotShareable`, every failure page, and `renderLeaf` under
 * `audience: "published"`), because only this file sees both the owner surfaces and the public
 * ones side by side. A sibling module can render an owner page; it cannot make one public.
 *
 * DIVISION OF OWNERSHIP. This module owns the CONTRACT: which state the page is in, which
 * numbers appear and where they come from, what is escaped, and what may never appear. The
 * visual layer — `public/leaf.css` — owns everything else, and the markup here carries stable
 * hooks (`data-leaf-state`, `data-leaf-empty`, `data-ledger`, `data-tier`) so the styling and
 * the verification can both address it without depending on copy.
 *
 * FOUR RULES, each one a defect if broken:
 *
 *   1. EVERY NUMBER COMES FROM `attributionLedger()`. The view never counts anything itself.
 *      A view that recomputes a count is a second implementation of the tally, and the two
 *      will disagree eventually — at which point the page is asserting something the domain
 *      never said.
 *
 *   2. PUBLIC WORK IS ADMITTED BEFORE PRESENTATION. Export projects to the subject's listed,
 *      policy-served records; the reader's lead list repeats that gate. A pending row says
 *      "Attributed, unverified" and an excluded row can never become shared work.
 *
 *   3. NO SCORE. No ratio, percentage, composite, grade, star or ordering of tiers, in anything
 *      THIS MODULE WRITES. The tiers are rendered in the order `PROOF_TIERS` lists them, which
 *      is a grouping, not a ranking. See `data-verbatim` below for why the distinction between
 *      what this module writes and what it carries has to be marked in the markup.
 *
 *   4. THE SIX STATES STAY SIX. `absent` and "valid but empty" produce visibly different
 *      pages. Collapsing them is the failure this capability exists to avoid.
 *
 * Every interpolated value is escaped. A leaf document is a file the operator controls, but it
 * may well have been generated from a repository, a filename or a commit message, and none of
 * those are trustworthy HTML.
 *
 * `data-verbatim` — WHICH WORDS ARE FOLIAGE'S, AND WHICH ARE THE SUBJECT'S EVIDENCE.
 *
 * SOME leaflet titles are copied VERBATIM out of the underlying artifact — for a git leaflet,
 * the commit subject exactly as it was written. Everything else on the page is this module (or
 * the domain) speaking. Those two kinds of text carry completely different guarantees, and until
 * they were distinguishable in the markup, one invariant was being checked against both:
 *
 *   NO SCORE was enforced as a substring blocklist over the WHOLE served page. On this
 *   repository's own real history that passes, but only by luck — a real commit is titled
 *   "feat(vault): retrieval-first graph layer — router, index scoring, budgeted walk", and it
 *   survives the check solely because "scoring" does not contain "score". A person whose real
 *   work included a commit titled "add score normalizer" would turn the check red, and the
 *   only correct response then is NOT to alter the product: refusing to render someone's real
 *   commit subject would falsify the very evidence this page exists to carry. So the invariant
 *   has to be scoped to authored chrome, and scoping needs a marker.
 *
 * "VERBATIM" IS A CLAIM, SO IT IS CONDITIONAL — `carriesVerbatimTitle` below decides it per
 * leaflet, and this used to be emitted unconditionally, which was false in both directions:
 *
 *   IT MISLABELLED MACHINE PROSE AS THE ARTIFACT'S OWN WORDS. A leaflet promoted out of
 *   photosynthesis carries `provenance.source` "photosynthesis:<extractor>", and its title was
 *   written by that extractor — this repository's own leaf currently holds one reading
 *   "canopy: 4 commits", which is Foliage counting, not a commit subject. A leaflet with NO
 *   provenance at all is worse: nothing on file says where the words came from, so the honest
 *   move is the weaker claim, not the stronger one.
 *
 *   AND — because the NO SCORE check is scoped by this attribute — it handed that machine prose
 *   the exemption meant for a person's real commit subject. A drafter emitting "top 10% of
 *   commits" as a title went straight to the DOM with the gate stripped off it. Measured, on
 *   both surfaces, before this was conditional. The gate now sees every title Foliage or a
 *   drafter wrote and still exempts every title a person actually committed.
 *
 * The complementary marker is `data-authored="drafted-title"`: same region, weaker claim, NOT a
 * `data-verbatim` value — the check strips the attribute by name, so a new value would have been
 * a rename, not a fix.
 *
 * A public title that contains an identifier-shaped span is redacted by the same rule Canopy
 * applies. That changed text loses the verbatim attestation. The private owner view retains
 * the source words; the document `<title>` uses a tier and short handle in either view.
 *
 * The attribute states provenance of TEXT. It is not a styling hook and carries no visual. Its
 * values name what the text is rather than merely that it is not ours: `title` is the artifact's
 * own title, `body-element` is a line of a leaflet body — prose a drafter proposed and a person
 * approved, which is the subject's side of the line even though no machine copied it verbatim
 * from anywhere. Both are excluded from the NO SCORE chrome check for the same reason: refusing
 * to render someone's real words would falsify the evidence the page exists to carry.
 *
 * DENSITY — THE FIFTH RULE, AND THE ONE THIS MODULE KEPT BREAKING.
 *
 * Measured on a 57-leaflet document, before the pass that added `disclosure` below:
 * `GET /` carried **4,006 visible words** and **184 sentences longer than eight words**, longest
 * 42. Every tier carried a paragraph; every row that had no link carried 55 words explaining why.
 *
 * The cause is not carelessness. It is THIS FILE'S OWN COMMENT DISCIPLINE — say WHY, name the
 * trap, record the measurement — applied to the wrong surface. A comment is read ONCE, by a
 * maintainer who needs the reasoning. A UI is read CONSTANTLY, by someone who needs the fact and
 * nothing else. Everything above this paragraph belongs in a comment. Almost none of it belonged
 * in the HTML, and it had leaked there.
 *
 * So: SHOW THE FACT, OFFER THE EXPLANATION, NEVER ASSERT IT. A label, not a sentence; a sentence,
 * not a paragraph. `CLAUDE.md` is the contract and it governs every string this module emits.
 *
 * HONESTY IS NOT VERBOSITY, and that distinction is the whole risk of a density pass. Cutting
 * text must never cut a caveat — every caveat that left a surface landed in `disclosure`, which
 * keeps it in the served bytes. The test before removing anything: would a reasonable person be
 * MISLED by its absence? The three answers that are always "yes", at every density: the
 * fabrication band, the example-document marker, and any statement whose omission would let a
 * reader infer something false about a person.
 *
 * `data-tier` vs `data-pill-tier` — ONE ATTRIBUTE, ONE MEANING.
 *
 * `data-tier` marks a LEAFLET ROW and means "this leaflet IS of tier X". Nothing else carries it.
 * The pill is a component that DEPICTS a tier, which is a different claim, so its variant is
 * `data-pill-tier`. The distinction is not pedantry — it was measured on the running page:
 *
 *   Both the row and its pill once carried `data-tier`, and so did the legend's pill, which
 *   depicts a tier while describing no leaflet at all. `[data-tier="excluded"]` therefore counted
 *   rows + row-pills + the legend entry. On this repository's own real history — 0 excluded — the
 *   selector returned 1. On a real multi-author document showing 377 excluded leaflets it returned
 *   755. Neither number is the number of anything on screen, and the smaller one is worse: it
 *   reports an exclusion on a page that displays none.
 *
 *   The tests did not catch it because every one of them had already routed around it, matching the
 *   compound string `class="leaf-leaflet" data-tier="..."` instead. That is the actual tell: when
 *   every reader of an attribute has learned to avoid the obvious selector, the attribute is
 *   overloaded, and the workaround is load-bearing knowledge nobody wrote down.
 *
 * So the row keeps `data-tier` and the pill takes `data-pill-tier`. `[data-tier="excluded"]` now
 * counts excluded leaflets and nothing else, at every count including zero, and the invariant that
 * every excluded row shows its reason is expressible as the equality a reader would first reach
 * for: one `.leaf-reason` per `[data-tier="excluded"]`. `renderedTierCounts` in the tests pins it.
 */

import { ui, workspaceHeader } from "@foliage/ui";
import {
  PROOF_TIERS,
  attributionLedger,
  featuredLeaflets,
  isListedOnLeaf,
  isLinkShareable,
  isMediaDigestRef,
  isSubjectsOwnWork,
  leafletVisibility,
  type AttributionLedger,
  type Leaf,
  type Leaflet,
  type Provenance,
  type PublishPolicy,
  type PublishRule,
} from "@foliage/leaf";
import {
  PROMOTED_SOURCE_PREFIX,
  orderReviewQueue,
  provenanceIsPromotedHandle,
  reviewSubjectDigest,
  shownQueue,
  type HarvestCandidate,
  type HarvestDocument,
  type HarvestDocumentIssue,
  type HarvestEvidence,
  type JevMark,
  type QueueGroup,
  type ReviewState,
} from "@foliage/photosynthesis";

import { homedir } from "node:os";
import { sep } from "node:path";

import { fabricationSignals, type LeafLoad, type LeafLoadCause, type LeafSource } from "./leafDocument.ts";
import { HARVEST_LOAD_LABEL, LEAF_LOAD_LABEL, LeafLoadError, leafLoadProblem } from "./loadLabels.ts";
import { outwardStateOf } from "./policy.ts";
import { inlineSpriteFor } from "./sprite.ts";
import { renderLeafFrond } from "./frond.ts";
import { STORY_SECTIONS, readStoryElement, storyElements, storyEvidence, type SavedStory } from "./leafletStory.ts";
import { portfolioTimeline, type PortfolioOrder, type PortfolioTimelineEntry } from "./portfolioTimeline.ts";
import { renderPersonHero, renderKeystones } from "@foliage/ui/person-portfolio";
import type { PortfolioWorkDates } from "./portfolioWorkDates.ts";
export { STORY_SECTIONS, readStoryElement } from "./leafletStory.ts";
import { isImportedObservationCandidate } from "./integrationImport.ts";
import type { PolicySource } from "./policyDocument.ts";
import { canTellStory } from "./leafletStory.ts";
import { addAfterCreate, CREATE_RECORD } from "./recordStart.ts";

/** Escape for both text nodes and double-quoted attribute values. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A DOCUMENT PATH, GARDEN-RELATIVE — `~/.foliage/leaf.json` on the page, the untouched absolute
 * path in a `title` attribute. A user-testing session found raw filesystem paths rendering as
 * body copy on Overview, the promote confirmation and `/policy` — a real path is exactly the
 * kind of fact this product's OWN convention already shortens without deleting (see
 * `disclosure`'s header, right above: a caveat relocated, never dropped). Collapsing the actual
 * `homedir()` prefix is the general mechanism — every document this app writes by default lives
 * under the garden (`~/.foliage`), so the common case reads exactly as garden-relative.
 *
 * A path OUTSIDE the home directory (an explicit `--out` elsewhere, a test fixture under `/tmp`)
 * renders UNCHANGED. Inventing a shortened form for a path that is not actually under the home
 * directory would be the dishonest direction — this function only ever shortens what is true.
 */
export function pathChip(path: string): string {
  const prefix = homedir().endsWith(sep) ? homedir() : homedir() + sep;
  const short = path === homedir() ? "~" : path.startsWith(prefix) ? `~${sep}${path.slice(prefix.length)}` : path;
  return short === path
    ? `<span class="fol-metric">${esc(path)}</span>`
    : `<span class="fol-metric" title="${esc(path)}">${esc(short)}</span>`;
}

/**
 * `describePolicySource` (`policyDocument.ts`), in HTML — same wording, but the embedded path
 * renders through `pathChip` rather than raw. Kept here rather than in `policyDocument.ts`,
 * which is deliberately not an HTML-composing module (its own header states the separation): this
 * is where `overview.ts` and `policyPage.ts` already reach for shared markup, and the plain-string
 * `describePolicySource` stays as it is for its OTHER caller, `server.mjs`'s boot log, which is
 * not HTML and must not gain markup.
 */
export function describePolicySourceHtml(source: PolicySource): string {
  return source.kind === "default" ? "the default rules" : pathChip(source.path);
}

/**
 * A DISCLOSURE — where a caveat goes when it stops being asserted.
 *
 * This is the mechanism that makes a density pass honest rather than lossy. `Pending` beside a
 * link to what pending means is EXACTLY as honest as three sentences of it and far more usable.
 * `Pending` with the explanation deleted is a different product. Everything relocated here is
 * still in the served bytes, still found by the browser's own find-in-page, still read aloud by
 * a screen reader that opens it — and no longer aimed at a reader who did not ask.
 *
 * WHAT MAY NEVER GO IN HERE. `<details>` is closed by default, so a statement whose ABSENCE
 * would mislead is deleted by being put here, not relocated. The fabrication band, the
 * example-document marker, "0 verified is the correct result", "this server has no
 * authentication", "approving does not publish" — those stay on the surface at every density.
 * What belongs here is RATIONALE: why the tier set is unordered, why counts are never combined,
 * why two refusals answer identically. A reader is not misled by not being told why.
 *
 * `data-more` names the topic so a test can address the disclosure without depending on its copy,
 * the same discipline `data-ledger`/`data-tier` follow. The summary is a QUESTION or a noun
 * phrase, never a sentence — it is a label on a drawer, and a drawer labelled with a paragraph is
 * the paragraph again.
 */
export function disclosure(key: string, summary: string, body: string): string {
  return `<details class="leaf-more" data-more="${esc(key)}">
<summary>${esc(summary)}</summary>
<div class="leaf-more-body">
${body}
</div>
</details>`;
}

/** Human wording for each tier. Nothing here implies an order. */
const TIER_LABEL: Readonly<Record<(typeof PROOF_TIERS)[number], string>> = Object.freeze({
  verified: "Verified",
  pending: "Pending",
  excluded: "Excluded",
});

/**
 * The PUBLIC wording — what a stranger reads on the published face (DT-3, gate-approved).
 *
 * "Pending" in ordinary English means QUEUED — someone is working on it, it will resolve. Here
 * it is terminal, and a reader who waits for the number to move is waiting on nothing. The
 * owner's instrument keeps the domain word (it matches the TUI, the review queue and the
 * documents on disk); the published face says what the tier actually established, in the words
 * of its own definition's first clause. The DOMAIN value is unchanged — `data-pill-tier`,
 * `data-tier` and every marker still say `pending` — this is display vocabulary only.
 * Comprehension gets tested at M1's recipient read, not assumed here.
 */
const TIER_LABEL_PUBLIC: Readonly<Record<(typeof PROOF_TIERS)[number], string>> = Object.freeze({
  verified: "Verified",
  pending: "Attributed, unverified",
  excluded: "Excluded",
});

export const tierLabel = (tier: (typeof PROOF_TIERS)[number], audience: LeafAudience): string =>
  audience === "published" ? TIER_LABEL_PUBLIC[tier] : TIER_LABEL[tier];

/**
 * The glyph each tier takes, from the design system's sprite.
 *
 * The three are distinguishable by SHAPE, not only by hue: a check, an open arc, a bar. That is
 * WCAG 1.4.1 and it is also why the badge survives a greyscale print — which a portfolio gets.
 * None of the three is bigger, heavier or brighter than the others, because a grouping that
 * ranks its members is a score with a different silhouette.
 */
const TIER_ICON: Readonly<Record<(typeof PROOF_TIERS)[number], string>> = Object.freeze({
  verified: "i-check",
  pending: "i-partial",
  excluded: "i-exclude",
});

/**
 * THE PROOF BADGE — the system's `.proof`, and the one place this app departs from the adoption
 * contract's markup, on measured grounds.
 *
 * The contract (§2.5) specifies `.proof` carrying `data-tier`. That spelling would REINTRODUCE a
 * defect this repository already measured and fixed: `data-tier` marks a leaflet ROW ("this
 * leaflet IS of tier X") and the badge merely DEPICTS a tier, so putting the same attribute on
 * both made `[data-tier="excluded"]` count rows + row badges + the legend's badge. On a real
 * document showing 377 excluded leaflets the selector returned 755; on this repository's own
 * history, showing none, it returned 1. The header of this module records the whole measurement.
 *
 * So the component class comes from the system — the geometry, the type, the tints and the
 * sprout animation are `foliage.css`'s, retyped nowhere — and the variant stays on
 * `data-pill-tier`, which is this repo's real contract.
 *
 * BOTH SPELLINGS ARE EMITTED. `proof-verified` is what `foliage.css` styles (it supports the
 * Open Design class spelling as a free alias precisely so markup can carry it); `data-pill-tier`
 * is what the assertions key on. Emitting both means neither can be dropped without the other
 * noticing, and `render.test.ts` asserts they agree on every badge — a `.proof` that lost its
 * modifier renders a silently untinted badge that still reads as a badge.
 */
export function proofBadge(tier: (typeof PROOF_TIERS)[number], audience: LeafAudience): string {
  return `<span class="proof proof-${esc(tier)}" data-pill-tier="${esc(tier)}"><svg class="ico ico-14" aria-hidden="true"><use href="#${TIER_ICON[tier]}"></use></svg>${esc(
    tierLabel(tier, audience),
  )}</span>`;
}

/**
 * THE FACE IS A PARAMETER, AND WHICH SURFACE TAKES WHICH IS AN ARGUED CHOICE.
 *
 * `day` (paper) is the PUBLIC plane and `night` (canvas) is the instrument plane — leaf.css
 * states the whole argument at its head. Three surfaces now render from this module and they do
 * not all sit on the same plane:
 *
 *   `/`              day    the portfolio. A public surface, so it takes the public face.
 *   `/leaflet/<id>`  day    ONE artifact OUT OF that portfolio, and the thing a subject actually
 *                           hands to an employer. Rendering it on canvas while the leaf it came
 *                           from renders on paper would say "internal instrument" about the most
 *                           outward-facing page this product has. The plane signal is the whole
 *                           reason the two faces exist, so the shared artifact keeps the shared
 *                           plane. THIS IS A DEPARTURE from "night face for instrument surfaces":
 *                           it is taken because a shared leaflet is not an instrument, and it is
 *                           one argument away from being reversed — this parameter.
 *   `/review`        night  the harvest queue. Nobody is ever shown this: it is the operator
 *                           looking at machine drafts on their own machine. An instrument.
 */
type Face = "day" | "night";

/**
 * THE MARK, AT THE SIZE IT IS DRAWN FOR.
 *
 * `#fol-mark-sm` is the ICON tier — three pinna pairs, each plume collapsed to one solid leaf —
 * and it is the correct asset here rather than a degraded one. The primary tier draws 96 separate
 * leaflets and the expressive tier 160; below roughly 20px none of them survives, and the masthead
 * mark is 28px. The token file states the rule and `sprite.test.ts` in that package checks the
 * geometry; this constant is the leaf app obeying it in one place instead of three.
 */
const MARK_SYMBOL = "fol-mark-sm";

/**
 * WHICH SURFACE THIS IS — named in the markup, because it is what decides the face.
 *
 * Constraint: face is a property of what a surface IS, not of which app serves it. `data-surface`
 * says that out loud on every page, and `leaf.css` keys the reading measure on it rather than on
 * the face. Keying the measure on the FACE worked only because `/review` happens to be the one
 * night surface here; the day a second instrument surface existed it would have silently taken a
 * document's measure.
 */
export type Surface =
  | "compound"
  | "leaf"
  | "leaflet"
  | "review"
  | "overview"
  | "garden"
  | "policy"
  | "publish"
  | "scarlet";

/**
 * Which item of the STUDIO NAV is active — see `renderNav` below, right after this app's route
 * constants are declared. A `Surface` names what a page IS (and picks its reading measure);
 * `NavKey` names where it sits in the owner's navigation, and the two are not the same
 * question — `leaflet` is a `Surface` with no nav entry at all.
 */
export type NavKey = "work" | "journey" | "workflow" | "overview" | "leaf" | "review" | "garden" | "policy" | "publish" | "scarlet";

export function page(opts: {
  readonly title: string;
  readonly state: string;
  readonly empty: boolean;
  readonly body: string;
  readonly face?: Face;
  readonly surface: Surface;
  /** Which reader this page is for. Renders the audience band; absent = no band (review page). */
  readonly audience?: LeafAudience;
  /** The band's words where the audience alone would overstate who can open this page. */
  readonly audienceLabel?: string;
  /** The words beside the mark. Never a link — no surface here has navigation. */
  readonly chrome?: string;
  /**
   * Which STUDIO NAV item is active, or absent for a surface the bar does not cover.
   *
   * ABSENCE IS THE WHOLE SAFETY PROPERTY. Every surface a stranger can reach — the published
   * leaflet artifact, "nothing is shared at this address", every public failure page, and
   * `renderLeaf` under the `"published"` audience — never sets this. The private owner artifact
   * does use the Portfolio shell. Only owner call sites name it; `renderNav` accepts the closed
   * `NavKey` union.
   */
  readonly nav?: NavKey | undefined;
  /** First-use portfolio pages use the primary setup action without a duplicate rail action. */
  readonly showPortfolioAction?: boolean;
  /** Only the private Photosynthesis workspace opts into the fixed, same-origin client. */
  readonly enhanceScarlet?: boolean;
  /** Keep the workspace layout when no model is configured and there is no client to load. */
  readonly styleScarlet?: boolean;
  /** The private 3D explorer alone loads its bundled renderer. */
  readonly enhanceCompound?: boolean;
  /** A missing or stale renderer keeps the stylesheet and readable artifact links. */
  readonly enhanceCompoundScript?: boolean;
  /** Only the private reading route opts into same-origin freshness updates. */
  readonly enhancePortfolio?: boolean;
  /** The private presentation editor alone loads its bounded preset preview. */
  readonly enhancePresentation?: boolean;
  readonly portfolioLeaf?: boolean;
  readonly portfolioLeafScript?: boolean;
}): string {
  const face: Face = opts.face ?? "day";
  const application = opts.nav !== undefined && face === "night";
  // Built first, then scanned: the sprite carries exactly the symbols this document references,
  // computed from the document rather than declared beside it. See src/sprite.ts for why both
  // halves of that matter — a dangling <use> is invisible and an unused symbol is invisible too.
  const header =
    opts.nav === undefined
      ? `<header class="leaf-head">
<span class="lockup">
<svg class="m leaf-mark" role="img" aria-label="Foliage" width="28" height="28"><use href="#${MARK_SYMBOL}"></use></svg>
<span class="fol-label">${esc(opts.chrome ?? "Foliage — a leaf")}</span>${
          opts.audience === "private"
            ? `<span class="fol-label leaf-audience" data-audience="private">private</span>`
            : opts.audience === "published"
              ? `<span class="fol-label leaf-audience" data-audience="published">${esc(opts.audienceLabel ?? "published")}</span>`
              : ""
        }
</span>
</header>`
      : renderNav(opts.nav, application, opts.showPortfolioAction);
  const content = `<a class="leaf-skip" href="#leaf-main">Skip to content</a>
${header}
<main id="leaf-main" class="leaf-main${opts.nav === undefined ? "" : " leaf-main-nav"}${application ? " fol-app-main" : ""}">
${application ? '<div class="fol-app-content">' : ""}${opts.body}${application ? "</div>" : ""}
</main>`;

  return `<!doctype html>
<html lang="en" data-face="${face}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<!-- tokens.css carries the @font-face block; roles.css maps primitives to roles; foliage.css
     (the Open Design system) declares no @font-face by design, so it is linked after tokens
     and wins on every token it redefines. leaf.css is the thin screen-local layer on top. -->
<link rel="icon" href="/mark-icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/roles.css">
<link rel="stylesheet" href="/foliage.css">
<link rel="stylesheet" href="/leaf.css">
${opts.enhanceCompound ? '<link rel="stylesheet" href="/compound-leaf.css">' : ""}
${opts.enhanceCompound && opts.enhanceCompoundScript !== false ? '<script type="module" src="/compound-leaf.bundle.js"></script>' : ""}
${opts.enhancePortfolio ? '<script type="module" src="/portfolio-reader.mjs"></script>' : ""}
${opts.enhancePresentation ? '<script type="module" src="/presentation-editor.mjs"></script>' : ""}
${opts.portfolioLeaf ? '<link rel="stylesheet" href="/portfolio-leaf.css">' : ""}
${opts.portfolioLeafScript ? '<script type="module" src="/portfolio-leaf.bundle.js"></script>' : ""}
${opts.styleScarlet || opts.enhanceScarlet ? '<link rel="stylesheet" href="/scarlet.css">' : ""}
${opts.enhanceScarlet ? '<script type="module" src="/scarlet-client.mjs"></script>' : ""}
${application ? '<link rel="stylesheet" href="/controls.css"><link rel="stylesheet" href="/empty-state.css"><link rel="stylesheet" href="/workspace-shell.css">' : ""}
</head>
<body${application ? ' class="fol-app"' : ""} data-surface="${opts.surface}" data-leaf-state="${esc(opts.state)}"${opts.empty ? ' data-leaf-empty="true"' : ""}>
${inlineSpriteFor(content)}
${content}
</body>
</html>
`;
}

/**
 * The evidence a claim rests on: where it came from, which object it is, and when that was read.
 *
 * `omitObserved` EXISTS FOR ONE MEASURED REASON. On the leaf, a leaflet row now carries the
 * observed instant in its own third column — that is the roster row's shape, and the column is
 * what makes a list of them scannable. Rendering the full provenance list inside the same row
 * printed the identical timestamp twice, 24px apart, on all 681 rows of a real document. Two
 * copies of one fact is not thoroughness: a reader who notices asks what the difference is, and
 * there is none. The row drops it here and shows it there; the leaflet page and the review queue
 * have no such column and keep all three terms.
 *
 * CALL IT WITH AN EXPLICIT ARROW INSIDE `.map`. `evidence.map(provenanceRow)` passes the ARRAY
 * INDEX as the second argument, so the first ref would keep its timestamp (index 0, falsy) and
 * every ref after it would silently lose one (index 1, 2, … truthy). Review now uses its own
 * compact row, but it keeps the same three terms; this function still requires explicit calls.
 */
function shortEvidenceRef(ref: string): string {
  // An imported record's ref is its JSON key (provider, tenant, account, record, revision): exact in Full reference.
  if (ref.startsWith("integration-record:")) return "Imported record";
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(ref);
  if (digest) return `sha256:${digest[1]!.slice(0, 7)}…`;
  return /^[a-f0-9]{40,64}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

function evidenceSourceLabel(source: string): string {
  if (source === "git") return "Git";
  if (source === "owner-selected:figma-export") return "Figma export · labeled by owner";
  if (source === "owner-selected:design-image") return "Design image · selected by owner";
  if (source === "owner-reference:dribbble") return "Dribbble link · entered by owner";
  if (source.startsWith("photosynthesis:reviewer:")) return `Reviewed by ${source.slice("photosynthesis:reviewer:".length)}`;
  if (source.startsWith(PROMOTED_SOURCE_PREFIX)) return draftedBy(source.slice(PROMOTED_SOURCE_PREFIX.length));
  return source;
}

function provenanceRow(p: Provenance, omitObserved = false, excerpt?: string): string {
  const source = evidenceSourceLabel(p.source);
  const shortRef = shortEvidenceRef(p.ref);
  const fullRef = shortRef === p.ref ? "" : `<details class="leaf-full-ref"><summary>Full reference</summary><code class="fol-metric">${esc(p.ref)}</code></details>`;
  const observed = omitObserved
    ? ""
    : `\n<div><dt class="fol-label">Observed</dt><dd class="fol-metric"><time datetime="${esc(
        p.observedAt,
      )}">${esc(reviewDate.format(new Date(p.observedAt)))}</time></dd></div>`;
  return `<dl class="leaf-prov">
<div><dt class="fol-label">Source</dt><dd>${esc(source)}</dd></div>
<div><dt class="fol-label">Ref</dt><dd class="fol-metric"><span title="${esc(p.ref)}">${esc(shortRef)}</span>${fullRef}</dd></div>${observed}${
    excerpt === undefined ? "" : `\n<div><dt class="fol-label">Excerpt</dt><dd data-verbatim="evidence-excerpt">${esc(excerpt)}</dd></div>`
  }
</dl>`;
}

/**
 * Where one leaflet lives. ONE definition, used by the row's link and by the server's route, so
 * a rendered href and the path the server matches cannot drift apart.
 *
 * `encodeURIComponent` and then `esc`: the first makes the id survive a URL, the second makes it
 * survive an HTML attribute. A leaflet id comes out of intake and is therefore not a string this
 * module gets to trust.
 */
export const LEAFLET_ROUTE = "/leaflet/";
/**
 * The OWNER'S route to the same artifact. Two routes because they answer different questions:
 * /leaflet/<id> is the SHARE surface — its 404s are the product's rails (visibility, publish
 * policy) proven end-to-end by the seam tests, and the owner's convenience may not dissolve
 * them. /my/leaflet/<id> is the instrument — the owner clicks any blade and sees the full
 * report. It is never emitted on a published rendering, so it never leaves this machine.
 */
export const OWNER_LEAFLET_ROUTE = "/my/leaflet/";
export const OWNER_MEDIA_ROUTE = "/my/media/";
export function ownerLeafletHref(id: string): string {
  return `${OWNER_LEAFLET_ROUTE}${encodeURIComponent(id)}`;
}

export function leafletHref(id: string): string {
  return `${LEAFLET_ROUTE}${encodeURIComponent(id)}`;
}

/**
 * The share address as its OWNER sees it, on owner surfaces only and only where the share route
 * answers (`findLeaflet` on the published audience). This server binds loopback, so the address
 * opens on this computer and nowhere else; the label says so rather than letting "Public" imply
 * a reader who cannot reach it.
 */
export function sharedAddressLink(id: string): string {
  const href = leafletHref(id);
  return `<a href="${esc(href)}" data-shared-address>${esc(href)}</a> <span class="fol-label">on this computer</span>`;
}

/**
 * Where the bytes of a media element are served from. Same one-definition rule as above, and it
 * matters more here: the address IS the evidence ref, character for character as the document
 * writes it, so anyone can `shasum -a 256` what they were served and compare it to a string they
 * can read in their own JSON. A renderer that encoded the ref differently from the route that
 * serves it would break that check while both halves still looked correct.
 */
export const MEDIA_ROUTE = "/media/";

/**
 * The address of one media ref, or null when there is no address to give.
 *
 * NO `encodeURIComponent`, and that is the one thing to get right here. `sha256:abc…` percent-
 * encodes its colon to `%3A`, the server slices the raw pathname and hands it to `parseMediaRef`,
 * and the ref no longer matches — a 404 on a photograph that is present. So the ref is checked
 * for the shape the route accepts INSTEAD of being escaped into one: `isMediaDigestRef` is the
 * gate's own function, and a ref that fails it has no bytes at any address. Null is a real
 * answer, and the caller renders the absence rather than a link that cannot work.
 *
 * This is not a security shortcut — the result still goes through `esc` into the attribute.
 * `[0-9a-f]{64}` simply has nothing in it that an attribute can be broken out of.
 */
export function mediaHref(ref: string, audience: LeafAudience = "published"): string | null {
  if (!isMediaDigestRef(ref)) return null;
  // The owner's report reads through the owner's media route, which is not share-gated: the
  // bytes are the owner's own file, hashed off their own disk. The share route's gate stays the
  // egress rail for everyone else — the seam tests pin that a photograph must not outlive its
  // share THERE, and this does not touch it.
  return `${audience === "private" ? OWNER_MEDIA_ROUTE : MEDIA_ROUTE}${ref}`;
}

/** Personal application navigation; published readers never receive owner controls. */
export const OVERVIEW_ROUTE = "/";
/** The compound leaf, moved off `/` so `/` could become the dashboard. Same renderer either way. */
export const LEAF_ROUTE = "/leaf";
export const GARDEN_ROUTE = "/garden";
export const POLICY_ROUTE = "/policy";
export const PUBLISH_ROUTE = "/publish";
export const SCARLET_WORKSPACE_ROUTE = "/scarlet/workspace";

/**
 * The bar itself. `REVIEW_ROUTE` et al. are declared LATER in this file, in the review section —
 * referencing them here is safe (and stays ONE spelling of each address, the same rule
 * `LEAFLET_ROUTE` states above) because this function's body runs at REQUEST time, long after
 * the whole module — every `const` in it — has finished loading. Nothing here calls `renderNav`
 * before the server has started.
 *
 * Personal navigation remains within this application. Advanced tools are disclosed on demand.
 */
function renderNav(active: NavKey, application = false, showPortfolioAction = true): string {
  if (application) return workspaceHeader(workspaceNavigation(active, { showPortfolioAction }));

  const link=(key:NavKey,href:string,label:string)=>`<li><a href="${esc(href)}"${key===active?' aria-current="page"':''}>${label}</a></li>`;
  const primary=link('leaf',LEAF_ROUTE,'Portfolio')+link('journey','/leaf/scarlet','Scarlet')+link('workflow','/workflow','Sources');
  const more=link('overview',OVERVIEW_ROUTE,'Overview')+link('review',REVIEW_ROUTE,'Review')+
    link('garden',GARDEN_ROUTE,'Harvest')+link('policy',POLICY_ROUTE,'Policy')+
    link('publish',PUBLISH_ROUTE,'Publish')+link('scarlet',SCARLET_WORKSPACE_ROUTE,'Photosynthesis');
  return `<header class="fol-nav"><div class="fol-nav-wrap">
<a class="fol-nav-brand" href="${LEAF_ROUTE}"><svg class="m" width="17.6" height="20" aria-hidden="true"><use href="#${MARK_SYMBOL}"></use></svg>Foliage</a>
<nav class="fol-nav-list" aria-label="Primary"><ul>${primary}<li class="fol-nav-more"><details${['leaf','journey','workflow'].includes(active)?'':' open'}><summary>More</summary><ul>${more}</ul></details></li></ul></nav>
<span class="fol-nav-plane" data-plane="studio">Personal</span></div></header>`;
}

/**
 * IS THIS TITLE THE ARTIFACT'S OWN WORDS, OR SOMETHING A MACHINE WROTE ABOUT IT?
 *
 * The header's `data-verbatim` section has the full argument; this is the decision procedure, in
 * one place so the two surfaces that render a title cannot answer it differently.
 *
 * It keys on PROVENANCE rather than on the text, because the text cannot be inspected for its own
 * origin — "canopy: 4 commits" and a real commit subject are the same shape. Provenance is the
 * document's record of where the artifact came from, so it is the only field that knows:
 *
 *   `GIT_SOURCE` ("git") and any other intake source  -> carried. `titleOf(commit.subject)` in
 *      @foliage/leaf copies the subject and does nothing else to it.
 *   `PROMOTED_SOURCE_PREFIX` ("photosynthesis:...")   -> NOT carried. `promoteApproved` copies
 *      the CANDIDATE's title, and a candidate's title is drafted — by the deterministic
 *      clusterer or by a local model. A person approved that the candidate should become a
 *      leaflet; nobody claimed the words were copied off a commit.
 *   no provenance at all                              -> NOT carried. Nothing on file says where
 *      the words came from, and the weaker claim is the true one. The page already says as much
 *      in prose for such a leaflet ("No provenance recorded yet, so nothing is asserted").
 *
 * The prefix is IMPORTED, not spelled again here: `promote.ts` builds the source string from that
 * same constant, so a rename moves both ends at once instead of silently un-marking every
 * promoted leaflet on the page.
 */
export function carriesVerbatimTitle(l: Leaflet): boolean {
  const provenance = "provenance" in l ? l.provenance : undefined;
  return provenance !== undefined && !provenance.source.startsWith(PROMOTED_SOURCE_PREFIX);
}

/**
 * The one attribute that says whose words a title is. Both values name the region for the NO
 * SCORE check; only `data-verbatim` exempts it from the check, which is the whole point.
 */
export function titleProvenanceAttr(carried: boolean): string {
  return carried ? 'data-verbatim="title"' : 'data-authored="drafted-title"';
}

/** A public heading uses the same identifier rule as Canopy; changed words are not verbatim. */
function visibleLeafletTitle(leaflet: Leaflet, audience: LeafAudience): { readonly text: string; readonly attr: string } {
  const text = audience === "private" ? leaflet.title : redactIdentifiers(leaflet.title).text;
  return {
    text,
    attr: text === leaflet.title ? titleProvenanceAttr(carriesVerbatimTitle(leaflet)) : 'data-title-redacted="true"',
  };
}

/**
 * The link OUT of the list and INTO the artifact — WHEN there is one to offer.
 *
 * IT IS NOT THE TITLE, DELIBERATELY. A carried title may sit inside `data-verbatim="title"`,
 * which states that those exact words came out of the underlying artifact.
 * Wrapping it in an anchor this module wrote would put authored chrome inside a region whose
 * whole claim is that it holds nothing authored — and the NO SCORE check is scoped by that
 * attribute, so the damage would not be cosmetic. The affordance is its own element instead.
 *
 * THIS IS ALSO WHERE THE SUBJECT LEARNS WHAT THE SHARE ROUTE WILL NOT TELL A STRANGER. The route
 * answers "private" and "no such id" identically on purpose (`findLeaflet`), so the fact has to
 * reach its owner somewhere — and their own leaf is the right somewhere. A row with no link says
 * why, in the visibility's own words, rather than offering a link that would 404 on them.
 *
 * A LINK THAT WOULD 404 IS WORSE THAN NO LINK. `private` is the domain's default, so before this
 * gate existed every row on a fresh intake document offered a link into a page that refuses.
 *
 * AND THE SAME ARGUMENT IS WHY THE POLICY IS ASKED HERE. A deny rule is evaluated at publish time
 * and beats the subject's own share — that is the asymmetry `@foliage/leaf` is built around — so
 * a row that read only `visibility` would offer a link into an address the rail refuses. Worse
 * than a 404: the subject would believe they had published something they had not. This is the
 * one place in the product where it overrides its own user, so the row NAMES THE RULE and quotes
 * the reason its author wrote. A bare "withheld" here would be unanswerable.
 *
 * The three states are asked in the order they bind: the rail first (it beats the person), then
 * the person's act, then the link. `outwardStateOf` composes them once for the whole app.
 *
 * IT IS A LABEL PER ROW, AND THE PARAGRAPH IS ON THE PAGE ONCE. This is where the density failure
 * was most expensive and the arithmetic says why: the private branch was 55 words, `private` is
 * the domain's default, and a real document has hundreds of rows. On the measured 57-leaflet page
 * that single branch was ~3,100 of 4,006 words — a paragraph reprinted 56 times, saying the same
 * thing about a different row each time. Nobody reads the fifty-sixth copy.
 *
 * So the row states WHICH of the three it is (`Private`, `Withheld`, or a link). The page carries
 * no paragraph about it; `readingNotes` below quotes only the rules that actually fired.
 *
 * THE RULE'S REASON MOVED TOO, AND THAT WAS MEASURED AFTER THE FIRST CUT. The withheld row kept
 * `${rule.reason}` inline, on the argument that a bare "Withheld" is unanswerable. That argument
 * is right and the placement was still wrong: a reason is a property of the RULE, not of the row,
 * and on this repository's own real document one rule matched 377 leaflets. Its five-sentence
 * reason was therefore printed 377 times — 1,131 of the 2,201 remaining over-eight-word sentences
 * on `GET /`, which is the same defect the private branch had, arriving by a second route.
 *
 * The row now names the rule (`data-withheld-by-rule` plus the id, visible and in mono) and every
 * DISTINCT rule that fired is quoted once, in its author's own words, under Attribution. The
 * answer to "why was this withheld?" is still on the page and still complete; it is stated once
 * per rule instead of once per leaflet.
 */
function openLink(l: Leaflet, policy: PublishPolicy, audience: LeafAudience = "published", publishedHref: string | null = null): string {
  const visibility = leafletVisibility(l);
  const outward = outwardStateOf(policy, l);
  // A published page names no mechanism and links no route: "Private — not shared by link" tells
  // a stranger about a control they do not have, and "Open this leaflet" points into a server a
  // static folder does not carry. The row itself still renders — audience changes chrome, never
  // which facts appear.
  if (audience === "published") return publishedHref === null
    ? ""
    : `<p class="leaf-leaflet-open"><a href="${esc(publishedHref)}">Open</a></p>`;
  // PRIVATE: every row opens. The old behaviour — no link unless shareable — protected the
  // share route from strangers by also locking the owner out of their own artifact, and the
  // report page is where the full accounting lives. The visibility stays visible as a fact.
  return `<p class="leaf-leaflet-open" data-visibility="${esc(visibility)}"><a href="${esc(
    ownerLeafletHref(l.id),
  )}">Open</a> <span class="fol-label">${esc(visibility)}</span>${
    outward.kind === "withheld-by-rule"
      ? ` <span class="fol-label" data-withheld-by-rule="${esc(outward.rule.id)}">withheld · ${esc(outward.rule.id)}</span>`
      : ""
  }</p>`;
}

/**
 * ONE LEAFLET AS A ROW — Open Design's roster row (`prototypes/public-leaf.html`), which is a
 * three-column grid: the badge, what the thing is, and when it was observed.
 *
 * WHAT DID NOT COME ACROSS FROM THAT PROTOTYPE, and why it matters here. Its rows carry a
 * subtitle like "12 commits · released by …", and the roster is ordered newest-first. Neither is
 * available honestly:
 *
 *   - a per-leaflet commit COUNT is a fact this document does not hold. `Leaflet` has a title, a
 *     tier, an optional provenance ref and (for an exclusion) a reason. Rendering a count would
 *     mean inventing one.
 *   - NEWEST-FIRST NEEDS A DATE THE DOMAIN DOES NOT HAVE. The only timestamp on a leaflet is
 *     `provenance.observedAt`, which is when INTAKE READ IT, not when the work happened — and a
 *     bulk intake stamps every leaflet in the same second. Sorting by it would present the order
 *     a file was walked in as a chronology of somebody's career. The rows therefore stay in
 *     document order and the page says so, the same discipline `/tree` states for its roster.
 *
 * The third column shows `observedAt` LABELLED as an observation. The row previews recorded
 * words when they exist; its evidence disclosure keeps every distinct supporting reference.
 */
function leafletRow(l: Leaflet, policy: PublishPolicy, audience: LeafAudience = "published", publishedHref: string | null = null): string {
  const title = visibleLeafletTitle(l, audience);
  const firstAccount = audience === "published" ? storyElements(l).find(element => element.text?.trim()) : undefined;
  const account = firstAccount ? readStoryElement(firstAccount)?.text ?? firstAccount.text : undefined;
  // The person's story is previewed as their account, never counted as its own evidence.
  const references = storyEvidence(l);
  const oneRef = references.length === 1 ? references[0] : undefined;
  const evidenceLabel = oneRef ? shortEvidenceRef(oneRef.ref) : `${references.length} references`;
  // `true` = do not repeat the observed instant: this row shows it in its own third column.
  const prov =
    audience === "published"
      ? references.length
        ? `<details class="leaf-row-evidence"><summary>Evidence <span class="fol-metric"${oneRef ? ` title="${esc(oneRef.ref)}"` : ""}>${esc(evidenceLabel)}</span></summary>${references.map(ref => provenanceRow(ref, !!oneRef)).join("")}</details>`
        : ""
      : l.provenance === undefined ? "" : provenanceRow(l.provenance, true);
  const reason =
    l.tier === "excluded"
      ? `<p class="leaf-reason"><span class="fol-label">Reason</span> ${esc(l.reason)}</p>`
      : "";
  // NO SECOND SENTENCE ABOUT A MISSING REF. The row already shows `Observed — not recorded`,
  // carrying `data-prov="absent"`, which IS the fact; "so nothing is asserted about this" was the
  // same fact restated as a claim about claims, once per pending row. The reassurance was cut
  // (owner, 2026-09-27: no explanations on the surface).
  // The observed instant is a METRIC (mono, tabular) and carries its machine-readable form as
  // well, because the two are the same fact and a reader should not have to trust the rendering.
  const observed =
    "provenance" in l && l.provenance !== undefined
      ? `<p class="leaf-leaflet-when"><span class="fol-label">Observed</span>
<time class="fol-metric" datetime="${esc(l.provenance.observedAt)}">${esc(
          // DATE-ONLY ON THE COMPOUND (DT-9, gate-approved): 106 full ISO instants was the
          // page's loudest noise, and the sub-day precision says nothing here — a bulk intake
          // stamps every row in the same second. The machine-readable instant stays in
          // `datetime`; the artifact page still shows the full instant, where one row has room.
          l.provenance.observedAt.slice(0, 10),
        )}</time></p>`
      : `<p class="leaf-leaflet-when"><span class="fol-label">Observed</span>
<span class="fol-metric" data-prov="absent">not recorded</span></p>`;
  return `<li class="leaf-leaflet blade-row" data-tier="${esc(l.tier)}">
<svg class="lf-blade" data-frond-tier="${esc(l.tier)}" aria-hidden="true"><use href="#fol-leaflet"></use></svg>
<p class="leaf-tier">${proofBadge(l.tier, audience)}</p>
<div class="leaf-leaflet-what">
<h3 class="leaf-leaflet-title" ${title.attr}>${esc(title.text)}</h3>
${account ? `<p class="leaf-row-excerpt" data-verbatim="body-element">${esc(account)}</p>` : ""}
${reason}
${prov}
${openLink(l, policy, audience, publishedHref)}
</div>
${observed}
</li>`;
}

/**
 * The honest tally. Counts come from the ledger; the lists below them are the same leaflets
 * grouped for display. The rendered row count and the ledger count are asserted to agree in
 * the tests, so display and tally cannot drift apart unnoticed.
 */
/**
 * Where the PRIVATE tier counts send the owner. Published pages carry no tier counts or links
 * into the private archive; their shared work is read in one list before attribution context.
 *
 * A count with nothing behind it gets NO link — see below. This is not decoration: the domain
 * deliberately carries `exclusionReasons` alongside the numbers so a count is explainable
 * rather than merely stated, and the affordance from the number to its explanation is that
 * promise made operable.
 */
const TIER_TARGET: Readonly<Record<(typeof PROOF_TIERS)[number], string>> = Object.freeze({
  verified: "#leaf-work",
  pending: "#leaf-group-pending",
  excluded: "#leaf-group-excluded",
});

/**
 * What each tier MEANS, on the page, next to the numbers it explains.
 *
 * WHY THIS EXISTS — it is not decoration, it closes a real hole. Before this, the page showed
 * three counts and a pill per row and never once said what any of them meant. Two misreadings
 * follow from that silence, and the second is a product defect:
 *
 *   1. "Pending" in ordinary English means QUEUED — someone is working on it, it will resolve.
 *      Here it is terminal: unsigned history stays pending forever, and signing new work does
 *      not reach back. A reader who waits for the number to move is waiting on nothing.
 *   2. Three unlabelled tiers with counts, read top to bottom, look like a ladder — and a ladder
 *      is a ranking, and a ranking is one aggregation away from the score this codebase refuses
 *      to compute (`ProofTier` is deliberately unordered, leaf.ts). The NO SCORE invariant is
 *      enforced in the domain; leaving the tiers unexplained lets it leak back in at the surface,
 *      where the reader supplies the missing order themselves.
 *
 * So the wording states what is ESTABLISHED, never what is worth more. It is also pitched at the
 * tier's own altitude rather than git's: this renderer is source-agnostic, and a legend that said
 * "signature" outright would be asserting a git-specific rule over evidence from any future
 * source. The mechanism appears as the example it currently is, not as the definition.
 */
const TIER_MEANING: Readonly<Record<(typeof PROOF_TIERS)[number], string>> = Object.freeze({
  verified: "Authorship cryptographically established. A matching name alone is self-declared.",
  pending: "Attributed · authorship not cryptographically established. Not a queue.",
  excluded: "Could not be attributed to this person. Not an error; always carries its reason.",
});

/**
 * The legend, rendered from the same `PROOF_TIERS` order as the cells so display order is one
 * decision made once. The term is the SAME pill component the rows use, which is what makes the
 * glyph→meaning mapping direct rather than something the reader has to hold in their head.
 *
 * IT IS BEHIND DISCLOSURE NOW, and that is the sanctioned form of this exact case: `Pending` is
 * the fact and belongs on the row; the three sentences about what pending means belong one click
 * away. The definitions are unchanged and still in the served bytes — a reader who wants to know
 * what the word means opens one drawer instead of reading 110 words to find the row they came for.
 *
 * The unverified state stays visible outside this disclosure. For admitted shared work a compact
 * cue follows the list; the private and unprojected empty-claim states retain their plate.
 */
function tierLegend(audience: LeafAudience): string {
  const rows = PROOF_TIERS.map(
    (tier) => `<div class="leaf-legend-row" data-legend-tier="${esc(tier)}">
<dt>${proofBadge(tier, audience)}</dt>
<dd>${esc(TIER_MEANING[tier])}</dd>
</div>`,
  ).join("\n");

  return disclosure(
    "tiers",
    "Tiers",
    `<dl class="leaf-legend" data-legend="tiers">
${rows}
</dl>`,
  );
}

/**
 * The rules that withheld something on this page — private face only, each quoted once in its
 * author's own words. The rationale that used to share this drawer was cut (owner, 2026-09-27:
 * no explanations on the surface).
 */
function readingNotes(opts: {
  readonly audience: LeafAudience;
  /** Every DISTINCT rule that withheld something on THIS page, in the order they first fired. */
  readonly firedRules: readonly PublishRule[];
  /** How many of the withheld leaflets the subject actually shared. The rail fires either way. */
  readonly sharedWithheld: "all" | "some" | "none";
}): string {
  if (opts.audience !== "private" || opts.firedRules.length === 0) return "";
  // "even though you shared it" is pinned by `policySeam.test.ts`: it stops a subject believing
  // they published something the rail refused. Keep it on ONE line, and only when it is true of
  // every withheld row: with some shared, say some; with none, the rule's effect is on a future
  // share, not a refused one.
  const said =
    opts.sharedWithheld === "all" ? "Withheld even though you shared it."
    : opts.sharedWithheld === "some" ? "Withheld, including some you shared."
    : "Stays private even if you share it.";
  return disclosure(
    "withheld",
    "Withheld by policy",
    `<p>${said}</p>
<dl class="leaf-rules" data-fired-rules="${opts.firedRules.length}">
${opts.firedRules
  .map(
    (rule) => `<div class="leaf-rule" data-rule="${esc(rule.id)}">
<dt class="fol-metric">${esc(rule.id)}</dt>
<dd>${esc(rule.reason)}</dd>
</div>`,
  )
  .join("\n")}
</dl>`,
  );
}

/**
 * THE COUNTS STRIP — three tinted tiers and one untinted total, on the system's `.cell`.
 * PRIVATE AUDIENCE ONLY, and this is the one place in this function that reads `audience` at all.
 *
 * verified/pending/excluded/total for ONE PERSON, summed, is exactly what publicProjection.ts
 * refuses in its own words: "Per artifact the tier is a fact the reader needs. Per person,
 * summed, it is a score." The tier printed on each ROW stays on both audiences — that is a fact
 * about the artifact — but the four numbers that add rows up into a figure about the PERSON are
 * the subject's own accounting of their own work, so they render only where the reader is the
 * subject. `ledgerSection`'s other children carry no per-tier NUMBER. Published rows already in
 * Shared work are omitted from its explanatory grouping so they are not repeated.
 *
 * THE FOURTH CELL IS THE TOTAL AND MAY ONLY EVER BE THE TOTAL. A fourth counts cell that is not
 * the total is a fourth tier wearing a number, and there are exactly three tiers. The total is a
 * count of this person's own artifacts — the shape "38 leaflets · 28 verified · 7 pending · 3
 * excluded", never "96% complete" — so it is a fact about a document rather than a figure standing
 * for a person.
 *
 * IT IS DERIVED FROM THE LEDGER, not counted off the array, because rule 1 at the head of this
 * module is that the view never counts anything itself. Adding the ledger's own three numbers is
 * arithmetic over what the domain already said; `leaf.leaflets.length` would be a second
 * implementation of the tally, and `render.test.ts` asserts the two agree so a divergence is a
 * failure rather than a quiet disagreement between the strip and the list under it.
 *
 * The total cell carries NO tint and NO link. Tinting it would make it look like a fourth state;
 * linking it would point at the whole page.
 */
function countStripMarkup(ledger: AttributionLedger, audience: LeafAudience, targets = TIER_TARGET): string {
  const total = ledger.verified + ledger.pending + ledger.excluded;
  const cells = ([
    ["verified", ledger.verified],
    ["pending", ledger.pending],
    ["excluded", ledger.excluded],
  ] as const)
    .map(([tier, n]) => {
      const inner = `<span class="fol-label">${esc(tierLabel(tier, audience))}</span>
<b class="fol-metric leaf-count" data-count="${tier}">${n}</b>`;
      // A zero count has no rows to jump to, so it is not a link — rather than a link that
      // goes nowhere, or one pointing at a section that was never rendered. The two cases are
      // driven by the SAME number that is displayed, so a live link can never miss its target.
      return n === 0
        ? `<div class="cell leaf-count-cell" data-ledger="${tier}" data-disabled="true" aria-disabled="true">
${inner}
</div>`
        : `<a class="cell leaf-count-cell" data-ledger="${tier}" href="${esc(targets[tier])}">
${inner}
</a>`;
    })
    .concat(
      `<div class="cell leaf-count-cell" data-count-total="true">
<span class="fol-label">Leaflets</span>
<b class="fol-metric leaf-count" data-count="total">${total}</b>
</div>`,
    )
    .join("\n");
  return `<div class="leaf-counts">
${cells}
</div>`;
}

function ledgerSection(
  leaf: Leaf,
  policy: PublishPolicy,
  audience: LeafAudience = "published",
  privateTargets?: { verified?: string | undefined; pending?: string | undefined },
  presentedWork: ReadonlySet<string> = new Set(),
): string {
  const ledger = attributionLedger(leaf);
  // A non-empty record with no verified attribution needs an explicit reading cue. The public
  // work list can contain owner-shared pending rows, each labelled unverified at row level.
  const noneVerified =
    ledger.verified === 0 && leaf.leaflets.length > 0 && audience === "published" && presentedWork.size > 0
      ? `<p class="aside" data-leaf-plate="none-verified">Shared work · attribution unverified</p>`
      : ledger.verified === 0 && leaf.leaflets.length > 0
        ? `<div class="plate" data-leaf-plate="none-verified">
<svg class="ico" aria-hidden="true"><use href="#i-partial"></use></svg>
<p class="plate-t">Nothing verified yet</p>
${audience === "private" ? "" : `<p class="plate-b">A correct result, not a fault. Nothing is claimed on this page.</p>`}
</div>`
        : "";
  const firstVerified = leaf.leaflets.find(record => record.tier === "verified");
  const countsStrip = audience === "private" ? countStripMarkup(ledger, audience, {
    ...TIER_TARGET,
    verified: privateTargets?.verified ?? (firstVerified ? `#portfolio-record-${encodeURIComponent(firstVerified.id)}` : TIER_TARGET.verified),
    pending: privateTargets?.pending ?? TIER_TARGET.pending,
  }) : "";

  const grouped = PROOF_TIERS.filter((t) => t !== "verified" && (audience !== "private" || t === "excluded"))
    .map((tier) => {
      const rows = leaf.leaflets.filter((l) => l.tier === tier && !presentedWork.has(l.id));
      if (rows.length === 0) return "";
      return `<section class="leaf-group" id="leaf-group-${esc(tier)}" data-group="${esc(tier)}" tabindex="-1">
<h3 class="fol-label">${esc(tierLabel(tier, audience))}</h3>
<ul class="leaf-list">
${rows.map((l) => leafletRow(l, policy, audience)).join("\n")}
</ul>
</section>`;
    })
    .filter((s) => s !== "")
    .join("\n");

  // WHAT THE ROWS ACTUALLY SHOW, asked of the rendered page rather than assumed, so the drawer
  // below explains the states that are on screen and no others.
  const shown = leaf.leaflets.map((l) => ({ leaflet: l, state: outwardStateOf(policy, l) }));
  // Distinct BY ID, in first-fired order: a Map keyed on the id is what makes 377 matches of one
  // rule quote that rule once. `Map` preserves insertion order, so the list reads in the order the
  // reader met the rules going down the page rather than in the policy file's order.
  const firedRules = new Map<string, PublishRule>();
  let withheld = 0;
  let sharedWithheld = 0;
  for (const { leaflet, state } of shown) {
    if (state.kind !== "withheld-by-rule") continue;
    if (!firedRules.has(state.rule.id)) firedRules.set(state.rule.id, state.rule);
    withheld += 1;
    if (isLinkShareable(leafletVisibility(leaflet))) sharedWithheld += 1;
  }
  const notes = readingNotes({
    audience,
    firedRules: [...firedRules.values()],
    sharedWithheld: sharedWithheld === 0 ? "none" : sharedWithheld === withheld ? "all" : "some",
  });
  // Pending and excluded rows are never claims (rule 2); one caption says so, on both faces.
  const accounting =
    !(audience === "published" && presentedWork.size > 0) && leaf.leaflets.some((l) => l.tier !== "verified")
    ? `<p class="aside" data-scope="ledger">Not claims · the person's own accounting</p>`
    : "";

  return `<section class="leaf-ledger" data-region="ledger" aria-labelledby="leaf-ledger-h">
<h2 id="leaf-ledger-h">Attribution</h2>
${accounting}
${noneVerified}
${countsStrip}
${tierLegend(audience)}
${notes}
${grouped}
</section>`;
}

export function fabricationBand(source: LeafSource): string {
  const signals = fabricationSignals(source);
  if (signals.length === 0) return "";
  // THE BAND IS EXEMPT FROM THE CUT. Every other surface lost its explanatory prose; this one
  // stays visible, as its label plus the signals that fired, because it is the statement whose
  // absence misleads most and it may not go behind a drawer. The reader does not need to know
  // why an example exists to know this is one.
  return `<aside class="leaf-band" role="alert" data-fabricated="true">
<strong class="fol-label">Example document — not real evidence</strong>
<p>${esc(signals.join("; "))}</p>
</aside>`;
}

/** A server-rendered freshness fragment, never accepted from a document or a request field. */
interface PrivatePortfolioOptions {
  readonly freshnessHtml?: string;
  readonly freshnessRevision?: string;
  readonly policyRevision?: string;
  readonly enhancePortfolio?: boolean;
  readonly portfolioLeafReady?: boolean;
  readonly portfolioLeafReason?: string;
  readonly order?: PortfolioOrder;
  readonly collection?: string;
  readonly records?: "source";
  readonly page?: number;
  readonly workDates?: PortfolioWorkDates;
}

/** Shared private image rendering for the reader and style editor. */
export function renderPortfolioMedia(record: Leaflet): string {
  const media = record.body?.find(element => "media" in element);
  return media && "media" in media ? `<div class="lp-media">${mediaFigure(readMediaHalf(media.media), media.provenance.ref, media.text ?? null, "private", true)}</div>` : "";
}

function privatePortfolioRow(entry: PortfolioTimelineEntry, policy: PublishPolicy, pendingTarget: boolean, visualIndex: number, featuredOrder: number, collections: readonly string[], selectedCollection: string, presentation?: PortfolioPresentation): string {
  const l = entry.record;
  const paragraphs = storyElements(l).filter(element => element.text?.trim());
  const visual = renderPortfolioMedia(l);
  const context = (elements: typeof paragraphs, limit: number) => elements.map(element => {
    const story = readStoryElement(element), text = story?.text ?? element.text!;
    return `${story ? `<p class="fol-label lp-story-label">${esc(STORY_SECTIONS.find(section => section.key === story.section)!.label)}</p>` : ""}<p class="lp-excerpt" data-verbatim="body-element">${esc(text.slice(0, limit))}${text.length > limit ? "…" : ""}</p>`;
  }).join("");
  const snippet = paragraphs.length ? context(paragraphs.slice(0, 2), 420) : "";
  // A story cannot cite itself: its sections stay above as the owner's account, and Evidence
  // lists the same references the story form offers.
  const refs = storyEvidence(l);
  const source = l.provenance?.source ?? "Source not recorded";
  const kind = source === "git" ? "git" : source.startsWith("photosynthesis:") ? "photosynthesis" : "other";
  const partialDate = entry.workRefs.length < entry.workRefCount;
  const date = entry.workAt ? `${partialDate ? "<span>Latest known</span>" : ""}<time class="fol-metric" aria-label="${partialDate ? "Latest known Git author date" : "Git author date"}" datetime="${esc(entry.workAt)}">${esc(entry.workDay!)}</time>` : "";
  const highlight = entry.leading ? "leading" : entry.featured ? "featured" : "";
  const style = portfolioStyle(presentation, l.id, selectedCollection || undefined);
  const baseStyle = portfolioStyle(presentation, l.id);
  const collectionStyles = Object.fromEntries(collections.map(id => [id, portfolioStyle(presentation, l.id, id)]));
  return `<li class="lp-record" data-tier="${esc(l.tier)}" data-leaflet="${esc(l.id)}" data-record-id="${esc(l.id)}" data-collection-ids="${esc(JSON.stringify(collections))}" data-base-style="${esc(JSON.stringify(baseStyle))}" data-collection-styles="${esc(JSON.stringify(collectionStyles))}"${selectedCollection && !collections.includes(selectedCollection) ? " hidden" : ""} data-reading-typography="${style.typography}" data-reading-spacing="${style.spacing}" data-reading-palette="${style.palette}" data-reading-layout="${style.layout}" data-reading-hero="${style.hero}" data-reading-media="${style.media}" data-document-index="${entry.documentIndex}" data-featured-order="${featuredOrder}" data-leading="${entry.leading}" data-source-kind="${kind}" data-date="${esc(entry.workAt ?? "")}" data-date-kind="${entry.dateBasis}" data-portfolio-side="${visualIndex % 2 ? "right" : "left"}"${highlight ? ` data-highlight="${highlight}"` : ""} id="portfolio-record-${esc(encodeURIComponent(l.id))}">
${pendingTarget ? '<span id="leaf-group-pending" tabindex="-1"></span>' : ""}
${entry.workMonth ? `<p class="lp-period" data-portfolio-period><time class="fol-metric" datetime="${esc(entry.workMonth)}">${esc(entry.workMonth)}</time></p>` : ""}
<article class="lp-panel" data-portfolio-panel aria-labelledby="portfolio-title-${esc(encodeURIComponent(l.id))}">
${visual}
${highlight ? `<p class="lp-highlight">${entry.leading ? '<span data-leading-label>Leading tip</span>' : "Highlight"}</p>` : ""}
<h3 class="leaf-leaflet-title" id="portfolio-title-${esc(encodeURIComponent(l.id))}" ${titleProvenanceAttr(carriesVerbatimTitle(l))}>${esc(l.title)}</h3>
<div class="lp-record-meta"><p class="lp-source"><span class="lp-source-mark" data-source-kind="${kind}" aria-hidden="true"></span><span>${esc(kind === "photosynthesis" ? "Photosynthesis" : source === "git" ? "Git" : source)}</span></p>${date}</div>
${snippet}
<details data-portfolio-evidence class="lp-evidence personal-work-evidence" id="portfolio-evidence-${esc(encodeURIComponent(l.id))}"><summary><span>Evidence <span class="fol-metric">${refs.length}</span></span>${proofBadge(l.tier, "private")}</summary>
${refs.length ? refs.map(ref => provenanceRow(ref, true)).join("") : '<p class="aside">No provenance</p>'}
${entry.workAt ? `${entry.workRefs.length < entry.workRefCount ? '<p class="aside">Some Git dates unreadable</p>' : ""}${entry.workRefs.map(ref => `<p class="lp-date"><code>${esc(ref.ref)}</code><time class="fol-metric" datetime="${esc(ref.authoredAt)}">${esc(ref.authoredAt)}</time></p>`).join("")}` : ""}
<p class="lp-date">Observed ${entry.observedAt ? `<time class="fol-metric" datetime="${esc(entry.observedAt)}">${esc(entry.observedDay!)}</time>` : "—"}</p>
</details>
<div class="lp-actions">${openLink(l, policy, "private")}${ui.button("Locate", { type: "button", id: `portfolio-focus-${encodeURIComponent(l.id)}`, "data-focus-leaflet": "true", "aria-label": `Locate ${l.title}`, disabled: true })}</div>
<details class="lp-detail" id="portfolio-context-${esc(encodeURIComponent(l.id))}"><summary>More</summary>${paragraphs.length > 2 ? context(paragraphs.slice(2), 1200) : ""}
<div class="lp-actions">${l.tier === "pending" && (!l.visibility || l.visibility === "private") ? `<a href="/leaf/story?leaflet=${encodeURIComponent(l.id)}">Tell story</a>` : ""}<a href="/leaf/curate${highlight ? "" : `?leaflet=${encodeURIComponent(l.id)}`}">${highlight ? "Arrange highlights" : "Highlight"}</a><a href="/leaf/presentation?edit=style&amp;leaflet=${encodeURIComponent(l.id)}">Customize</a><a href="/leaf/explore?leaflet=${encodeURIComponent(l.id)}">Orbit</a></div></details>
</article></li>`;
}

/** Raw Git observations remain addressable evidence; an owner's story or selection stays in Work. */
function isGitSourceRecord(record: Leaflet, selected: ReadonlySet<string>): boolean {
  return record.provenance?.source === "git" && !!record.provenance.ref && !record.body?.length &&
    leafletVisibility(record) === "private" && !selected.has(record.id);
}

function privateSourceRecordRow(entry: PortfolioTimelineEntry, policy: PublishPolicy): string {
  const record = entry.record;
  const id = encodeURIComponent(record.id);
  const ref = record.provenance?.ref ?? "";
  return `<li class="lp-source-record" data-tier="${record.tier}" data-source="git" data-visibility="private" data-leaflet="${esc(record.id)}" data-record-id="${esc(record.id)}" data-date="${esc(entry.workAt ?? "")}" data-date-kind="${entry.dateBasis}" id="portfolio-record-${esc(id)}">
<h3 ${titleProvenanceAttr(carriesVerbatimTitle(record))}>${esc(record.title)}</h3>
<div class="lp-source-record-meta">${entry.workAt ? `<time class="fol-metric" datetime="${esc(entry.workAt)}">${esc(entry.workDay!)}</time>` : ""}<code class="fol-metric" title="${esc(ref)}" aria-label="Git ref ${esc(ref)}">${esc(ref.slice(0, 12))}</code>${proofBadge(record.tier, "private")}${openLink(record, policy, "private")}${canTellStory(record) ? `<a href="/leaf/story?leaflet=${id}" aria-label="Tell story: ${esc(record.title)}">Tell story</a>` : ""}</div>
</li>`;
}

function privatePortfolio(leaf: Leaf, source: LeafSource, policy: PublishPolicy, options: PrivatePortfolioOptions): string {
  const recordsMode = options.records === "source" ? "source" : "work";
  const order = recordsMode === "source" && options.order !== "oldest" ? "newest" : options.order ?? "notable";
  const model = portfolioTimeline(leaf, order, options.workDates?.dates);
  const highlights = featuredLeaflets(leaf);
  const ledger = attributionLedger(leaf);
  const ready = options.portfolioLeafReady === true;
  const collections = leaf.collections ?? [];
  const ownerSelected = new Set([...highlights.map(record => record.id), ...collections.flatMap(item => item.leaflets), ...(leaf.presentation?.leaflets ?? []).map(item => item.id)]);
  const sourceEntries = model.entries.filter(entry => isGitSourceRecord(entry.record, ownerSelected));
  const sourceIds = new Set(sourceEntries.map(entry => entry.record.id));
  const workEntries = model.entries.filter(entry => !sourceIds.has(entry.record.id));
  const achievements = (leaf.achievements ?? []).filter(item => item.claims.length);
  const sourceOnly = workEntries.length === 0 && sourceEntries.length > 0;
  const firstPending = workEntries.find(entry => entry.record.tier === "pending")?.record.id;
  const selectedCollection = recordsMode === "work" ? collections.find(item => item.id === options.collection) : undefined;
  const selectedId = selectedCollection?.id ?? "";
  const membership = (id: string) => collections.filter(item => item.leaflets.some(member => member === id)).map(item => item.id);
  const modeEntries = recordsMode === "source" ? sourceEntries : workEntries;
  const selectedEntries = selectedCollection ? modeEntries.filter(entry => selectedCollection.leaflets.includes(entry.record.id)) : modeEntries;
  const visibleCount = selectedEntries.length;
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(visibleCount / pageSize));
  const requestedPage = Number.isSafeInteger(options.page) && options.page! > 0 ? options.page! : 1;
  const pageNumber = Math.min(requestedPage, pageCount);
  const pageStart = (pageNumber - 1) * pageSize;
  const pageEntries = selectedEntries.slice(pageStart, pageStart + pageSize);
  const pageHref = (number: number, collection = selectedId, mode = recordsMode) => {
    const params = new URLSearchParams({ order: mode === "source" && order !== "oldest" ? "newest" : order, ...(mode === "source" ? { records: "source" } : {}), ...(collection ? { collection } : {}), ...(number > 1 ? { page: String(number) } : {}) });
    return `/leaf?${params.toString()}${mode === "work" && sourceOnly ? achievements.length ? "#portfolio-keystones" : "#source-preview" : "#leaf-highlights"}`;
  };
  const tierHref = (tier: "verified" | "pending") => {
    const target = model.entries.find(entry => entry.record.tier === tier);
    if (!target) return undefined;
    const mode = sourceIds.has(target.record.id) ? "source" : "work";
    const index = (mode === "source" ? sourceEntries : workEntries).findIndex(entry => entry.record.id === target.record.id);
    const targetPage = Math.floor(index / pageSize) + 1;
    const anchor = `#portfolio-record-${encodeURIComponent(target.record.id)}`;
    return !selectedId && recordsMode === mode && pageNumber === targetPage ? anchor
      : `${pageHref(targetPage, "", mode).replace(/#leaf-highlights$/, "")}${anchor}`;
  };
  const selectedAchievements = selectedCollection ? achievements.filter(item => selectedCollection.achievements.includes(item.id)) : achievements;
  const keystones = renderKeystones({ heading: "Achievements", selectedCollection: selectedId,
    items: selectedAchievements.map(item => ({ id: item.id, title: item.title,
      summary: (item.claims.find(claim => claim.kind === "summary") ?? item.claims.find(claim => claim.kind === "contribution") ?? item.claims[0])!.text,
      href: `/leaf/achievement?id=${encodeURIComponent(item.id)}`,
      collectionIds: collections.filter(view => view.achievements.includes(item.id)).map(view => view.id) })),
    ...(!model.entries.length && !achievements.length ? { empty: { text: "No achievements yet", action: { label: "Add achievement", href: "/leaf/presentation?edit=achievement" } } } : {}) });
  const chronology = options.workDates?.resolved ? "" : "Work dates unavailable";
  const readingStyle = portfolioStyle(leaf.presentation, undefined, selectedId || undefined);
  const baseStyle = portfolioStyle(leaf.presentation);
  const collectionStyles = Object.fromEntries(collections.map(item => [item.id, portfolioStyle(leaf.presentation, undefined, item.id)]));
  const rangeStart = visibleCount ? pageStart + 1 : 0;
  const rangeEnd = Math.min(pageStart + pageSize, visibleCount);
  // A record enters Selected work when its owner tells its story. Say so only while a source
  // record can still take one, and lead to Work's records, where each such row offers it.
  const storyReady = sourceEntries.some(entry => canTellStory(entry.record));
  const sourceOnlyPrompt = sourceOnly && achievements.length === 0 && recordsMode === "work" ? `<section class="lp-source-preview" id="source-preview" aria-labelledby="source-preview-heading"><h2 id="source-preview-heading">No selected work yet</h2>${storyReady ? "<p>Tell a record's story to add it here.</p>" : ""}<div class="lp-source-preview-actions">${storyReady ? '<a href="/leaf/photosynthesis?view=records">Choose a record to tell its story</a>' : ""}<a href="${esc(pageHref(1, "", "source"))}">Browse source records</a><a href="${REVIEW_ROUTE}">Review candidates</a></div></section>` : "";
  const pagination = pageCount > 1 ? `<nav class="lp-pagination" aria-label="${recordsMode === "source" ? "Source record pages" : "Timeline pages"}"><div class="lp-pagination-links">
${pageNumber > 1 ? `<a rel="prev" href="${esc(pageHref(pageNumber - 1))}">Previous</a>` : `<span aria-disabled="true">Previous</span>`}
<span class="fol-metric" aria-current="page">${pageNumber} / ${pageCount}</span>
${pageNumber < pageCount ? `<a rel="next" href="${esc(pageHref(pageNumber + 1))}">Next</a>` : `<span aria-disabled="true">Next</span>`}</div>
<form method="get" action="/leaf"><input type="hidden" name="order" value="${order}">${recordsMode === "source" ? '<input type="hidden" name="records" value="source">' : `<input type="hidden" name="collection" value="${esc(selectedId)}">`}<label for="portfolio-page-number">Page</label><input id="portfolio-page-number" class="fol-metric" name="page" type="number" min="1" max="${pageCount}" value="${pageNumber}" required>${ui.button("Go", { type: "submit" })}</form></nav>` : "";
  return `<div id="personal-portfolio" data-reading-typography="${readingStyle.typography}" data-reading-spacing="${readingStyle.spacing}" data-reading-palette="${readingStyle.palette}" data-reading-layout="${readingStyle.layout}" data-reading-hero="${readingStyle.hero}" data-reading-media="${readingStyle.media}" data-base-style="${esc(JSON.stringify(baseStyle))}" data-collection-styles="${esc(JSON.stringify(collectionStyles))}" class="lp-portfolio" data-personal-portfolio="true"${recordsMode === "work" && pageEntries.length ? " data-leaf-portfolio" : ""} data-portfolio-paged="true" data-portfolio-records-mode="${recordsMode}"${sourceOnly ? ' data-source-only="true"' : ""} data-portfolio-page="${pageNumber}" data-portfolio-page-count="${pageCount}" data-date-purpose="work" data-portfolio-order="${order}" data-portfolio-collection="${esc(selectedId)}" data-work-dates-revision="${esc(options.workDates?.revision ?? "")}" data-portfolio-revision="${esc(source.documentDigest)}" data-policy-revision="${esc(options.policyRevision ?? "")}">
${fabricationBand(source)}
${renderPersonHero({ subject: leaf.subject, ...(leaf.headline ? { headline: leaf.headline } : {}), ...(leaf.profile?.bio ? { biography: leaf.profile.bio } : {}), ...(leaf.profile?.direction ? { direction: leaf.profile.direction } : {}), ...(leaf.profile?.passions ? { passions: leaf.profile.passions } : {}),
  composition: readingStyle.hero,
  actions: recordsMode === "work" && selectedAchievements.length ? [{ label: "Open my work", href: "#portfolio-keystones" }] : model.entries.length ? [] : [{ label: "Add introduction", href: "/leaf/presentation" }],
  secondaryActions: [{ label: "Edit", href: "/leaf/presentation" }, { label: "Look & feel", href: "/leaf/presentation?edit=style" }, { label: "New Leaf view", href: "/leaf/presentation?edit=collection" }, { label: "Résumé", href: "/leaf/resume" }, { label: "Import a portfolio", href: "/leaf/import" }],
})}
${sourceEntries.length ? `<nav class="lp-record-modes" aria-label="Private work and source records"><a href="${esc(pageHref(1, selectedId, "work"))}"${recordsMode === "work" ? ' aria-current="page"' : ""}>Selected work <span class="fol-metric">${workEntries.length + achievements.length}</span></a><a href="${esc(pageHref(1, "", "source"))}"${recordsMode === "source" ? ' aria-current="page"' : ""}>Source records <span class="fol-metric">${sourceEntries.length}</span></a></nav>` : ""}
${sourceOnlyPrompt}
<div class="lp-collection-switch"><form method="get" action="/leaf"><input type="hidden" name="order" value="${order}" data-portfolio-order-input><select aria-label="Leaf view" id="portfolio-collection-select" name="collection" data-portfolio-collection><option value="" data-description="">All work</option>${collections.map(item => `<option value="${esc(item.id)}" data-description="${esc(item.description ?? "")}"${item.id === selectedId ? " selected" : ""}>${esc(item.title)} · ${esc(item.kind === "body-of-work" ? "Body of work" : item.kind === "company" ? "Company" : "Role")}</option>`).join("")}</select>${ui.button("Open", { type: "submit", className: "lp-apply" })}</form></div>
<p class="lp-quiet" data-portfolio-collection-note${selectedCollection?.description ? "" : " hidden"}>${esc(selectedCollection?.description ?? "")}</p>
${recordsMode === "source" ? "" : keystones}
${recordsMode === "work" && achievements.length ? `<p class="lp-actions"><a href="/leaf/presentation?edit=achievement">Arrange achievements</a><a href="/leaf/claim-check">Cited work</a><a href="${SCARLET_WORKSPACE_ROUTE}">Photosynthesis</a></p>` : ""}
<section aria-label="${recordsMode === "source" ? "Source records" : "Timeline"}" id="leaf-highlights" tabindex="-1">
<div class="lp-section-heading"><h2>${recordsMode === "source" ? "Git source records" : "Timeline"}</h2><p><span class="fol-metric">${rangeStart}–${rangeEnd}</span> of <span class="fol-metric">${visibleCount}</span></p></div>
<div class="lp-toolbar"><form class="lp-order" method="get" action="/leaf">${recordsMode === "source" ? '<input type="hidden" name="records" value="source">' : `<input type="hidden" name="collection" value="${esc(selectedId)}" data-portfolio-collection-input>`}<select aria-label="Order" id="portfolio-order" name="order" data-portfolio-order>${(recordsMode === "source" ? [["newest", "Newest"], ["oldest", "Oldest"]] : [["notable", "Notable"], ["newest", "Newest"], ["oldest", "Oldest"]]).map(([value, label]) => `<option value="${value}"${order === value ? " selected" : ""}>${label}</option>`).join("")}</select>${ui.button("Apply", { type: "submit", id: "portfolio-apply", className: "lp-apply" })}</form>
${recordsMode === "work" ? `<div class="lp-toolbar-actions"><details class="lp-timeline-tools"><summary>View options</summary><div><a href="/leaf/curate">${highlights.length ? "Arrange highlights" : "Choose highlights"}</a>${ready ? ui.button("Pause motion", { type: "button", id: "portfolio-motion", "data-portfolio-motion": "true", disabled: true }) : ""}<a href="/leaf/explore">Orbit</a><p data-portfolio-status role="status">${workEntries.length && !ready ? "Motion unavailable" : ""}</p></div></details></div>` : ""}</div>
${recordsMode === "work" && model.unavailableChoices.length ? '<p class="lp-quiet">A highlight is missing. <a href="/leaf/curate">Review</a></p>' : ""}
${recordsMode === "work" && ready && workEntries.length ? `<ul class="lp-source-legend" aria-label="Sources"><li data-source-kind="git"><span aria-hidden="true"></span>Git</li><li data-source-kind="photosynthesis"><span aria-hidden="true"></span>Photosynthesis</li><li data-source-kind="other"><span aria-hidden="true"></span>Other source</li></ul>` : ""}
${recordsMode === "source" ? `<ul class="lp-source-archive">${pageEntries.map(entry => privateSourceRecordRow(entry, policy)).join("\n")}</ul>${pagination}` : `<div class="lp-journey" data-portfolio-journey id="leaf-work" tabindex="-1"><div class="lp-visual"><canvas data-portfolio-canvas tabindex="0" aria-label="Portfolio leaf"></canvas></div>
${workEntries.length ? `<ul class="lp-records" data-portfolio-records>${pageEntries.map((entry, index) => privatePortfolioRow(entry, policy, entry.record.id === firstPending, index, highlights.findIndex(record => record.id === entry.record.id), membership(entry.record.id), selectedId, leaf.presentation)).join("\n")}</ul><p data-portfolio-collection-empty${visibleCount ? " hidden" : ""}>Empty view. <a href="/leaf/presentation?edit=collection${selectedId ? `&amp;collection=${encodeURIComponent(selectedId)}` : ""}">Choose work</a></p>${pagination}` : sourceEntries.length ? "" : `<div class="lp-empty"${leaf.leaflets.length === 0 ? ' data-leaf-plate="no-leaflets"' : ""}><h2>${leaf.leaflets.length === 0 ? "No leaflets yet" : "Nothing attributed yet"}</h2>${ui.link("Review", { href: REVIEW_ROUTE })}</div>`}
</div><div class="lp-caption"><p data-portfolio-order-note data-date-note="${chronology}">${order === "notable" ? "" : chronology}</p></div>`}${options.workDates?.reason ? `<details class="lp-quiet" id="portfolio-date-context"><summary>Work dates</summary><p>${esc(options.workDates.reason)}</p></details>` : ""}</section>
<details class="personal-accounting" id="portfolio-collection"><summary>Collection &amp; publication</summary><div id="portfolio-freshness" class="portfolio-freshness"${options.freshnessRevision === undefined ? "" : ` data-revision="${esc(options.freshnessRevision)}"`} role="status" aria-live="polite">${options.freshnessHtml ?? `<p>Read <time class="fol-metric" datetime="${esc(source.readAt)}">${esc(source.readAt)}</time></p>`}</div></details>
<details class="personal-accounting" id="portfolio-accounting"><summary>Attribution</summary>${ledgerSection(leaf, policy, "private", { verified: tierHref("verified"), pending: tierHref("pending") })}</details>
</div><p id="portfolio-sync" class="personal-sync" role="status"></p>`;
}

function renderLeaf(leaf: Leaf, source: LeafSource, policy: PublishPolicy, audience: LeafAudience = "published", options: PrivatePortfolioOptions = {}, publishedLeafletHref?: (id: string) => string | null): string {
  const empty = leaf.leaflets.length === 0;
  // Export hands this renderer an admitted projection. Apply the same gate to the work section
  // itself so a direct caller cannot promote a private, unlisted, excluded, policy-denied, or
  // example record into the reader's lead list. These are shared records, not all verified claims.
  const sharedWork = audience === "published" && fabricationSignals(source).length === 0
    ? leaf.leaflets.filter((record) =>
        isSubjectsOwnWork(record) &&
        isListedOnLeaf(leafletVisibility(record)) &&
        outwardStateOf(policy, record).kind === "served")
    : [];
  const presentedWork = new Set(sharedWork.map((record) => record.id));

  // AN EMPTY STATE IS THE EXCEPTION TO THE DENSITY RULE, deliberately: nothing else is on the
  // screen and the reader is stuck. One sentence and the remedy is still the budget, so the three
  // clauses about how photosynthesis grows leaflets went; what stayed is the distinction that
  // matters — the document is VALID and empty, which is not the same as missing.
  const emptyBlock = `<section class="leaf-empty" data-leaf-plate="no-leaflets" aria-labelledby="leaf-empty-h">
<div class="plate">
<svg class="ico" aria-hidden="true"><use href="#i-folder"></use></svg>
<h2 class="plate-t" id="leaf-empty-h">Nothing published yet</h2>
</div>
</section>`;

  // The reader encounters the actual shared work before the attribution explanation. A pending
  // row retains its public "Attributed, unverified" badge; it is not promoted into a claim.
  // Rows already shown here are omitted from the ledger so the same record is not printed twice.
  const workBlock =
    sharedWork.length === 0
      ? ""
      : `<section class="leaf-work" id="leaf-work" data-region="work" aria-labelledby="leaf-work-h" tabindex="-1">
<h2 id="leaf-work-h">Shared work</h2>
<ul class="leaf-list">
${sharedWork.map((l) => leafletRow(l, policy, audience, publishedLeafletHref?.(l.id) ?? null)).join("\n")}
</ul>
</section>`;

  return page({
    title: leaf.subject,
    state: "ok",
    surface: "leaf",
    empty,
    face: audience === "private" ? "night" : "day",
    ...(audience === "published" && empty ? {} : { audience }),
    chrome: audience === "private" ? "Foliage — your leaf" : "Foliage — a leaf",
    // NAV ONLY ON THE OWNER'S OWN VIEW. `renderLeaf` is also `export.mjs`'s renderer under
    // `audience: "published"` — the one caller of this function with that audience, so gating on
    // it here is exactly gating on "reached via /leaf", never on "reached via the export folder".
    nav: audience === "private" ? "leaf" : undefined,
    enhancePortfolio: audience === "private" && options.enhancePortfolio === true,
    portfolioLeaf: audience === "private",
    portfolioLeafScript: audience === "private" && options.portfolioLeafReady === true,
    body: audience === "private" ? privatePortfolio(leaf, source, policy, options) : `${fabricationBand(source)}
<section class="leaf-subject">
<div class="leaf-subject-text">
<span class="fol-label">Leaf</span>
<h1>${esc(leaf.subject)}</h1>

${
  // THE AUTHORED HEADLINE (DT-1). When the subject wrote one, the page opens in their voice
  // instead of this renderer's; data-authored marks WHOSE words these are, the same discipline
  // as data-verbatim on carried titles. When they did not, nothing renders here — never a
  // placeholder inviting one, because an empty slot rendered as an invitation is the machine
  // drafting the subject's self-description by nagging.
  leaf.headline !== undefined
    ? `<p class="leaf-lede leaf-headline" data-authored="subject">${esc(leaf.headline)}</p>`
    : ""
}
</div>
${renderLeafFrond(leaf.leaflets, attributionLedger(leaf), audience)}
</section>
${empty ? emptyBlock : workBlock}
${ledgerSection(leaf, policy, audience, undefined, presentedWork)}`,
  });
}

function issueList(load: Extract<LeafLoad, { cause: "invalid" }>): string {
  return `<ul class="leaf-issues">
${load.issues
  .map(
    (i) => `<li><span class="fol-metric leaf-issue-at">${esc(i.at)}</span> ${esc(i.message)}</li>`,
  )
  .join("\n")}
</ul>`;
}

/**
 * Render a failure. The switch is exhaustive with a `never` check, so adding a sixth cause to
 * `LeafLoad` fails the typecheck here rather than silently rendering one of the others —
 * `strict` plus `noFallthroughCasesInSwitch` makes the compiler the enforcement.
 */
function renderFailure(load: Extract<LeafLoad, { ok: false }>, audience: LeafAudience): string {
  // The system's ERROR plate. There is no LOADING plate anywhere in this app and there must not
  // be one: these routes are a synchronous server render, so a loading state is a picture of
  // something that never happens. Empty and error only.
  //
  // The last line is the same on all five, deliberately. "Nothing counted" is the error posture
  // of this whole product: a failed read produces NO number, not a zero, and no inference
  // stands in for the file.
  const shell = (heading: string, extra = "") =>
    page({
      title: `Foliage — ${heading}`,
      state: load.cause,
      surface: "leaf",
      empty: false,
      audience,
      body: `<section class="leaf-state" data-leaf-plate="${esc(load.cause)}" aria-labelledby="leaf-state-h">
<div class="plate">
<svg class="ico" aria-hidden="true"><use href="#i-alert"></use></svg>
<h1 class="plate-t" id="leaf-state-h">${esc(heading)}</h1>
<p class="plate-b" data-refusal="nothing-counted">Nothing counted</p>
</div>
${audience === "private" ? extra : ""}
</section>`,
    });

  switch (load.cause) {
    // ONE SENTENCE AND THE REMEDY, on all five. An error state is the density rule's exception
    // — the reader is stuck and nothing else is on screen — but the exception is a SENTENCE, not
    // a paragraph, and each of these was three. What every one of them keeps is the distinction
    // it exists to draw, because collapsing those is the failure this capability is about.
    case "unconfigured":
      return shell(
        "No leaf document configured",
        `<p class="aside">Check the local launch settings.</p>`,
      );

    case "absent":
      if (audience === "private") return page({
        title: "Portfolio · Foliage",
        state: "absent",
        surface: "leaf",
        empty: false,
        face: "night",
        audience,
        nav: "leaf",
        showPortfolioAction: false,
        body: `<section class="leaf-state leaf-start" data-leaf-plate="absent" aria-labelledby="leaf-state-h">
<h1 class="plate-t" id="leaf-state-h">Start your record</h1>
<a class="fol-button fol-button-primary" href="/leaf/setup">Create private record</a>
</section>`,
      });
      return shell(
        "No leaf document found",
      );

    // A file to repair on disk: the next step, and the file and what the loader saw under a
    // closed Technical details, as on every other page that could not read the record.
    case "unreadable":
      return shell(
        "Leaf document unreadable",
        `<p class="aside">Error <span class="fol-metric">${esc(load.errno)}</span>. Check the file's permissions, then reload.</p>${leafLoadTechnical(load)}`,
      );

    case "malformed":
      return shell("Leaf document is not valid JSON", `<p class="aside">Correct the file, then reload.</p>${leafLoadTechnical(load)}`);

    case "invalid":
      return shell("Not a leaf document", issueList(load));

    default: {
      const impossible: never = load;
      throw new Error(`unhandled load cause: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * Render whatever the loader returned. Total: every state produces a page.
 *
 * THE POLICY IS A REQUIRED PARAMETER AND NOT AN OPTIONAL ONE, which costs every existing caller
 * a line and is worth it: an optional rail is a rail a route can forget, and the route that
 * forgets it is the route that offers a link into an address the rail refuses. A caller that
 * genuinely wants no rules passes `{ rules: [] }` — an empty policy withholds every PROPOSAL and
 * fires no deny, which is a state the domain already models rather than a hole punched here.
 */
/**
 * WHO IS HOLDING THIS PAGE. One leaf, two faces, never ambiguous — the owner's 2026-08-23 rule,
 * after the private working view and the shareable artifact turned out to be the same rendering
 * differing only by URL:
 *
 *   "private"    the NIGHT instrument the person works in on this machine. May show internal
 *                mechanisms (visibility, the review link), because its reader can act on them.
 *   "published"  the DAY document a stranger holds — the person's presence toward the canopy.
 *                No internal chrome: a stranger cannot act on a mechanism, and showing them one
 *                is noise wearing honesty's clothes. No links to routes a folder does not carry.
 *
 * The default is "published" so anything that renders without choosing gets the surface that
 * asserts LESS. The server chooses "private" explicitly.
 */
export type LeafAudience = "private" | "published";

export function renderLeafPage(
  load: LeafLoad,
  policy: PublishPolicy,
  audience: LeafAudience = "published",
  options: PrivatePortfolioOptions = {},
  publishedLeafletHref?: (id: string) => string | null,
): string {
  return load.ok ? renderLeaf(load.leaf, load.source, policy, audience, options, publishedLeafletHref) : renderFailure(load, audience);
}

/* ==============================================================================================
   ONE LEAFLET AS AN ARTIFACT — GET /leaflet/<id>
   ==============================================================================================

   WHAT MAKES THIS A DIFFERENT PAGE AND NOT A FILTERED LEAF. The leaflet is the unit of evidence;
   the leaf is the compound of them. Until this route existed the product rendered a LIST OF
   CITATIONS and nothing could be opened, linked or handed to anyone on its own.

   PRIVACY IS THE POINT OF THE ROUTE, NOT A CONSTRAINT ON IT. A leaf holds `pending` and
   `excluded` entries which are the subject's OWN ACCOUNTING and were never outward claims —
   `publishableLeaflets` is the domain saying exactly that. Handing someone one leaflet must
   therefore not hand them the compound, and "must not" here means the bytes:

     - no other leaflet's title, id or exclusion reason appears anywhere in the response;
     - no ledger, no per-tier count, not even a total — a count is a fact about the compound;
     - no navigation back to `/`, because a link to the whole portfolio IS handing it over.

   `leafletPageLeaks` in seam.test.ts greps the served bytes for every other leaflet's title, id
   and reason, on a document built to contain all three kinds. A test that reads the DOM would not
   have caught a leak in a comment or an attribute; this one reads what went over the wire.

   THE FOOTER IS DELIBERATELY THIN. The leaf page names its document path, byte count and read
   time, because that page is the operator's own view of their own install. This one is what a
   stranger receives, and the path of a file on somebody's machine is not part of the artifact.

   WHAT IS STILL MISSING, SAID PLAINLY: there is no per-leaflet VISIBILITY state in the open plane
   (`.loop/STATUS.md` F9). So this route serves any leaflet the document holds, including a
   pending or excluded one, and marks what it is rather than pretending it is a claim. When
   visibility lands, the refusal belongs in the domain and this renderer stops being the only
   thing standing between an id and a page.

   THE FABRICATION BAND IS PART OF THIS PAGE, AND ITS ABSENCE WAS THE WORST DEFECT THIS PRODUCT
   HAS SHIPPED. Measured by differential control — one server binary, one document (the bundled
   example, copied, `"example": true` intact), one leaflet marked `unlisted`:

     GET /                            data-fabricated appeared once
     GET /leaflet/example-verified-1  data-fabricated appeared ZERO times, and the served bytes
                                      read "This is an outward claim: authorship is
                                      cryptographically established." about an illustration.

   Two routes over the same bytes disagreed about whether those bytes were real, and the outward
   one — the page a subject hands an employer — is the one that said they were. The shipped
   example survived a reader's eye only because its own title starts "EXAMPLE —", which is the
   document AUTHOR's wording. The whole point of the `example` flag is that the PRODUCT says it,
   about any document that declares itself one, so a copied example under a different title is
   exactly the case that had no control at all.

   The cause was structural rather than a forgotten line: `renderLeafPage` took the `LeafSource`
   and `renderLeafletPage` took only the leaflet, so this route could not have rendered the band
   even if it had wanted to — provenance about the DOCUMENT stopped at the leaf page. So the
   source is now a REQUIRED parameter of `renderLeafletPage`, and the typechecker is what stops
   the next route from dropping it: a surface that renders a document's contents must be handed
   what is known about that document, and there is no signature here that lets it decline.

   The band is document-level and names no leaflet, so it discloses nothing about the compound
   and it renders identically on the artifact and on the refusal — which is required, because
   those two pages are compared byte for byte to prove a private leaflet and a missing one are
   indistinguishable.
*/

/** What a request for one leaflet resolved to. A missing one is a NAMED cause, never a blank. */
export type LeafletLoad =
  /** `shared`: private audience only — whether the share route answers for this id. */
  | { readonly ok: true; readonly leaflet: Leaflet; readonly subject: string; readonly shared?: boolean }
  | { readonly ok: false; readonly cause: "not-shareable"; readonly requestedId: string };

/**
 * Find one leaflet by id, IF the subject has made it shareable by link AND the publish policy
 * does not refuse it. Pure and total; the id is whatever came off the URL.
 *
 * ONE REFUSAL FOR THREE CAUSES, AND THAT COLLAPSE IS DELIBERATE — which is worth arguing, because
 * collapsing distinct causes is normally the exact failure this codebase refuses.
 *
 *   "there is no leaflet with that id" and "there is one and it is `private`" are different
 *   facts. Answering them differently tells whoever holds the URL WHICH ONE IT WAS, and that is
 *   an existence oracle: try ids until the wording changes and you have enumerated a portfolio
 *   whose owner shared exactly one leaflet from it. The distinction the reader would gain is
 *   worth less than the disclosure it costs, so this route makes exactly one statement.
 *
 *   The cause is not lost, it is moved to the audience that may have it: the SUBJECT sees, on
 *   their own leaf page, which of their leaflets are shareable and which are not, per row. So
 *   "unchecked" and "verified" stay different words for the person who owns the file, and the
 *   stranger at the URL learns only the rule.
 *
 * `private` IS THE DEFAULT, in the domain, for every document written before visibility existed
 * and every leaflet a producer had no opinion about. So a fresh intake document shares nothing
 * by link until its owner says otherwise, and that is the correct first state rather than a gap.
 *
 * Linear scan, O(n) over a person's own portfolio. An index would be a second structure to keep
 * in agreement with the document that is re-read on every request anyway, and n here is the
 * number of leaflets one human has — the scan is not the cost.
 */
export function findLeaflet(
  leaf: Leaf,
  id: string,
  policy: PublishPolicy,
  audience: LeafAudience = "published",
): LeafletLoad {
  const found = leaf.leaflets.find((l) => l.id === id);
  // THE OWNER'S INSTRUMENT HIDES NOTHING FROM ITS OWNER (owner ask, 2026-08-23: click any
  // leaflet, see the full report). The share-by-link protections below exist for whoever else
  // holds a URL; on the private audience the reader IS the subject, and a portfolio that
  // refuses its own owner a view of their own artifact protects nobody.
  // `shared` asks the published branch below rather than restating its rule, so the owner is
  // shown a share address exactly when that address answers.
  if (audience === "private") {
    return found === undefined
      ? { ok: false, cause: "not-shareable", requestedId: id }
      : { ok: true, leaflet: found, subject: leaf.subject, shared: findLeaflet(leaf, id, policy).ok };
  }
  // THREE CAUSES, ONE ANSWER, AND THE THIRD IS THE RAIL. A leaflet the publish policy denies is
  // refused with the SAME value as a private one and a nonexistent one — deliberately, and for
  // the same reason the first two are collapsed. Answering "withheld by policy" here would tell
  // whoever holds the URL that the id is real and that its subject shared it, which is more than
  // they learn today from a private one. The subject is told which of the three it is on their
  // own leaf page (`openLink`), where the audience is entitled to the distinction.
  if (found === undefined || !isLinkShareable(leafletVisibility(found))) {
    return { ok: false, cause: "not-shareable", requestedId: id };
  }
  if (outwardStateOf(policy, found).kind !== "served") {
    return { ok: false, cause: "not-shareable", requestedId: id };
  }
  return { ok: true, leaflet: found, subject: leaf.subject };
}

/**
 * THE BODY, and the asymmetry that shapes how it renders.
 *
 * A `BodyElement` is TEXT or MEDIA: the REF is required, the WORDS are optional, and the PICTURE
 * is optional. An element with a ref and no text is an honest evidence listing — the refs are
 * real and the prose does not exist yet. Inventing a sentence to fill that gap would be the
 * fabrication the format exists to refuse, so this renderer states the absence instead and never
 * writes a stand-in.
 *
 * The gate has already refused anything that is not this shape, so the renderer does not
 * re-validate. It reads the field STRUCTURALLY anyway — the elements it cannot read are named at
 * their index rather than dropped — because this app also renders documents that reached it by
 * some path a future producer takes, and a silently shorter artifact reads as complete while a
 * named unreadable element is visibly wrong. That check is cheap and it fails in the safe
 * direction; the alternative is trusting a shape this module cannot enforce.
 *
 * THE MEDIA HALF IS WHY THAT PARAGRAPH IS NOT PARANOIA. Before this lane, `readBody` read
 * `provenance` and `text` and ignored every other key — so a media element rendered as a caption
 * over a ref with the PHOTOGRAPH SILENTLY ABSENT. Nothing false was printed and nothing crashed,
 * which is exactly what made it the bad kind of failure: the page looked complete. An element
 * that says it carries media and cannot be shown now says so at its index.
 */
type MediaRead =
  | {
      readonly ok: true;
      readonly mediaType: string;
      readonly dimensions:
        | { readonly known: true; readonly width: number; readonly height: number }
        | { readonly known: false; readonly why: string };
    }
  | { readonly ok: false; readonly found: string };

type BodyElementRead =
  | {
      readonly ok: true;
      readonly text: string | null;
      readonly provenance: Provenance;
      /** Null when this element is text. Never "media with nothing known about it". */
      readonly media: MediaRead | null;
    }
  | { readonly ok: false; readonly at: string; readonly found: string };

type BodyRead =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly elements: readonly BodyElementRead[] };

/** Say what was actually there, absence included — the same wording rule as the document gates. */
function describeValue(v: unknown): string {
  if (v === undefined) return "nothing (the field is absent)";
  if (v === null) return "null";
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (typeof v === "string") return v.trim().length === 0 ? "an empty string" : "a string";
  if (typeof v === "object") return `an object with keys ${Object.keys(v).join(", ") || "(none)"}`;
  return `a ${typeof v}`;
}

function readProvenance(v: unknown): Provenance | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  const source = rec["source"];
  const ref = rec["ref"];
  const observedAt = rec["observedAt"];
  const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;
  if (!nonEmpty(source) || !nonEmpty(ref) || !nonEmpty(observedAt)) return null;
  return { source, ref, observedAt };
}

/**
 * The media half of one element, read structurally.
 *
 * NOT VALIDATED AGAINST `MEDIA_TYPES`. The gate's closed list decides what may be WRITTEN; this
 * decides what can be SHOWN, and those are different questions with different right answers. A
 * document may legally carry `image/tiff` — a scanner produced it and refusing the file would
 * answer "here is my evidence" with "your file does not exist" — and no browser will render it.
 * So the type is carried through as the string it is and the display decision is made once,
 * below, by asking whether a browser can be expected to draw it.
 */
function readMediaHalf(v: unknown): MediaRead {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, found: describeValue(v) };
  }
  const rec = v as Record<string, unknown>;
  const mediaType = rec["mediaType"];
  if (typeof mediaType !== "string" || mediaType.trim() === "") {
    return { ok: false, found: `media.mediaType is ${describeValue(mediaType)}` };
  }
  const dims = rec["dimensions"];
  if (typeof dims !== "object" || dims === null || Array.isArray(dims)) {
    return { ok: false, found: `media.dimensions is ${describeValue(dims)}` };
  }
  const d = dims as Record<string, unknown>;
  const width = d["width"];
  const height = d["height"];
  if (
    d["known"] === true &&
    typeof width === "number" &&
    Number.isInteger(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isInteger(height) &&
    height > 0
  ) {
    return { ok: true, mediaType, dimensions: { known: true, width, height } };
  }
  const why = d["why"];
  if (d["known"] === false && typeof why === "string" && why.trim() !== "") {
    return { ok: true, mediaType, dimensions: { known: false, why } };
  }
  // A ZERO IS NOT A SIZE and a size with no reason for being absent is not an absence — both are
  // the collapse this repository refuses, so neither is rendered as a measurement.
  return { ok: false, found: `media.dimensions is ${describeValue(dims)}` };
}

function readBody(l: Leaflet): BodyRead {
  const raw: unknown = l.body;
  if (raw === undefined) return { kind: "absent" };
  if (!Array.isArray(raw)) {
    return { kind: "present", elements: [{ ok: false, at: "body", found: describeValue(raw) }] };
  }
  const elements: BodyElementRead[] = raw.map((element, i): BodyElementRead => {
    const at = `body[${i}]`;
    if (typeof element !== "object" || element === null || Array.isArray(element)) {
      return { ok: false, at, found: describeValue(element) };
    }
    const rec = element as Record<string, unknown>;
    // THE REF IS THE ELEMENT. Without one there is nothing to render that would not be an
    // unsourced claim, so this is the only condition that makes an element unreadable.
    const provenance = readProvenance(rec["provenance"]);
    if (provenance === null) {
      return { ok: false, at: `${at}.provenance`, found: describeValue(rec["provenance"]) };
    }
    const text = rec["text"];
    return {
      ok: true,
      text: typeof text === "string" && text.trim().length > 0 ? text : null,
      provenance,
      // PRESENCE of the key is the discriminant, exactly as the format defines it — never
      // truthiness. An element carrying `"media": null` is a producer bug, and reading it as
      // "this is text" would hide the bug behind a page that looks finished.
      media: "media" in rec ? readMediaHalf(rec["media"]) : null,
    };
  });
  return { kind: "present", elements };
}

/**
 * What a browser can be expected to DRAW. A strict subset of the format's `MEDIA_TYPES`, and the
 * gap between the two lists is the point rather than an oversight: `image/heic` is what a phone
 * produces and `image/tiff` is what a scanner produces, both are legal evidence, and neither
 * renders in any shipping browser. A surface that cannot show one has to SAY it cannot, which is
 * the whole reason this list is separate from the one the gate enforces.
 */
const DISPLAYABLE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

/**
 * ONE MEDIA ELEMENT, as a figure.
 *
 * WHAT IS ASSERTED HERE IS ONLY WHAT WAS MEASURED: the type and pixel size (or the named reason
 * there isn't one). Image metadata is removed by the image store; a captured MP4 keeps its exact
 * source bytes. There is no caption unless a person approved one.
 *
 * THE ALT TEXT IS THE HONEST GAP, stated rather than papered over. When no caption exists this
 * product has no description of the image and will not compose one, so alt names what the thing
 * IS and says the description does not exist.
 *
 * KNOWN GAP, recorded rather than left to be discovered: this function renders what the DOCUMENT
 * says, and it does not know whether the store on this machine actually holds the bytes. A leaf
 * moved without its `media/` directory therefore renders a broken image rather than a named
 * cause, which is the one place in this path where a failure is not spelled out. Closing it means
 * handing the renderer the set of refs the store holds — a real change to this function's
 * signature and to the leaflet route — and it is a change worth making the moment a leaf is ever
 * moved off the machine that harvested it. Nothing false is printed today; the ref is on the
 * page and `/media/<ref>` answers with the store's own cause when asked directly.
 */
function mediaFigure(media: MediaRead, ref: string, caption: string | null, audience: LeafAudience = "published", preview = false, exportedHref?: string | null, posterHref?: string | null, evidenceHtml?: string): string {
  if (!media.ok) {
    return `<p class="aside" data-media="unreadable">Unreadable media: ${esc(media.found)}</p>`;
  }
  const video = media.mediaType === "video/mp4";
  // A shared local Leaflet has no clip-selection state. Only the static export's explicit
  // selected media map may put a video on the published face.
  if (video && audience === "published" && !exportedHref) return "";
  const href = exportedHref === undefined ? mediaHref(ref, audience) : exportedHref;
  const size = media.dimensions.known
    ? `<dd class="fol-metric">${media.dimensions.width} × ${media.dimensions.height}</dd>`
    : `<dd><span class="fol-metric">not measured</span> <span class="aside">${esc(
        media.dimensions.why,
      )}</span></dd>`;
  // These are measured file facts, kept beside the artifact in an inspectable disclosure on
  // the published face. The still is a stripped copy; the captured MP4 keeps its source bytes.
  const facts = `<dl class="leaf-prov leaflet-media-facts">
<div><dt class="fol-label">${video ? "Video" : "Image"}</dt><dd class="fol-metric">${esc(media.mediaType)}</dd></div>
<div><dt class="fol-label">Size</dt>${size}</div>
${exportedHref === null
  ? `<div><dt class="fol-label">Export</dt><dd>${video ? "Video" : "Image"} unavailable</dd></div>`
  : video ? '<div><dt class="fol-label">File</dt><dd>Original capture</dd></div>'
    : `<div><dt class="fol-label">${preview ? "Display copy" : "Published"}</dt><dd>metadata removed</dd></div>`}
</dl>`;
  const evidence = audience === "published" && evidenceHtml
    ? `<details class="leaflet-media-details"><summary>Evidence</summary>${facts}${evidenceHtml}</details>`
    : facts;

  if (href === null) {
    return `<figure class="leaflet-media" data-media="unaddressable">
<p class="aside">${exportedHref === null ? `${video ? "Video" : "Image"} unavailable in this export` : `No ${video ? "video" : "image"} address`}</p>
${evidence}
</figure>`;
  }
  if (video) {
    const dims = media.dimensions.known
      ? ` width="${media.dimensions.width}" height="${media.dimensions.height}"`
      : "";
    return `<figure class="leaflet-media leaflet-video" data-media="shown">
<video class="leaflet-media-video" controls playsinline preload="none"${posterHref ? ` poster="${esc(posterHref)}"` : ""} aria-label="Recorded work demo"${dims}><source src="${esc(href)}" type="video/mp4">Video playback unavailable. <a href="${esc(href)}">Open video</a></video>
${preview && caption ? `<figcaption data-verbatim="body-element">${esc(caption)}</figcaption>` : ""}
${posterHref ? `<img class="leaflet-video-print" src="${esc(posterHref)}" alt="Captured demo still">` : ""}
${evidence}
</figure>`;
  }
  if (!DISPLAYABLE_MEDIA_TYPES.has(media.mediaType)) {
    return `<figure class="leaflet-media" data-media="not-displayable">
<p class="aside">Format not displayable. <a href="${esc(href)}">Open file</a></p>
${evidence}
</figure>`;
  }
  const alt = caption ?? "Evidence image";
  const dims = media.dimensions.known
    ? ` width="${media.dimensions.width}" height="${media.dimensions.height}"`
    : "";
  // NOT `loading="lazy"`, and it was until a browser was pointed at the real page. This is the
  // ONE artifact on a leaflet's own address — the thing the page exists to show — so deferring it
  // buys nothing (there is no list to scroll) and costs the cases where a deferred image never
  // loads at all: a full-page capture, a print, a save-page-as. It rendered as an empty bordered
  // box in exactly that way. `decoding="async"` stays; it defers only the decode, never the
  // fetch.
  return `<figure class="leaflet-media" data-media="shown">
<a class="leaflet-media-link" href="${esc(href)}"><img class="leaflet-media-img" src="${esc(
    href,
  )}" alt="${esc(alt)}"${dims}${preview ? ' loading="lazy"' : ""} decoding="async"></a>
${preview && caption ? `<figcaption data-verbatim="body-element">${esc(caption)}</figcaption>` : ""}
<p data-media-unavailable hidden role="status">Image unavailable. <a href="${esc(href)}">Open image</a></p>
${evidence}
</figure>`;
}

/**
 * The body section.
 *
 * `data-verbatim="body-element"` on the text: the attribute states WHOSE WORDS these are, and
 * these are not this renderer's. A body element is prose a drafter proposed and a person
 * approved — it belongs to the subject's evidence side of the line, which is what the attribute
 * marks and what the NO SCORE chrome check is scoped by.
 */
function storyAccount(story: SavedStory): string {
  return `<h3 class="story-account-heading">${esc(STORY_SECTIONS.find(section => section.key === story.section)!.label)}</h3>
<p class="leaflet-element-text" data-verbatim="body-element">${esc(story.text)}</p>
<details class="story-account-reference"><summary>Reference</summary>
<p class="aside">The person's account; the reference does not verify it.</p>
${provenanceRow(story.supporting)}
<p class="aside">Recorded by <span data-verbatim="body-element">${esc(story.reviewer)}</span> on <time class="fol-metric" datetime="${esc(story.at)}">${esc(reviewDate.format(new Date(story.at)))}</time>.</p>
</details>`;
}

function bodySection(l: Leaflet, audience: LeafAudience = "published", exportedMediaHrefs?: ReadonlyMap<string, string>, exportedPosterHrefs?: ReadonlyMap<string, string>): string {
  const read = readBody(l);
  if (read.kind === "absent") {
    // With no account written yet, show the evidence itself. An empty section is a description
    // of the document schema rather than work the reader can inspect; the private action above
    // already offers Tell story when this record can receive one.
    return "";
  }
  const admittedElements = read.elements.filter((element) =>
    !(audience === "published" && element.ok && element.media?.ok &&
      element.media.mediaType === "video/mp4" && !exportedMediaHrefs?.get(element.provenance.ref)),
  );
  // Static export chooses the still and clip separately, then binds the still to the
  // selected video's poster. A bare, wordless still would otherwise occupy a second
  // full-size frame on the same page. Keep its provenance and original file available
  // in the video's Evidence disclosure; a still with approved words remains its own item.
  const posterSourceByVideo = new Map<string, { provenance: Provenance; href: string }>();
  const posterOnlyElements = new Set<BodyElementRead>();
  if (audience === "published" && exportedMediaHrefs && exportedPosterHrefs) {
    for (const video of admittedElements) {
      if (!video.ok || !video.media?.ok || video.media.mediaType !== "video/mp4") continue;
      const posterHref = exportedPosterHrefs.get(video.provenance.ref);
      if (!posterHref) continue;
      const still = admittedElements.find((element) => element.ok && element.text === null &&
        element.media?.ok && DISPLAYABLE_MEDIA_TYPES.has(element.media.mediaType) &&
        exportedMediaHrefs.get(element.provenance.ref) === posterHref);
      if (!still?.ok) continue;
      posterOnlyElements.add(still);
      posterSourceByVideo.set(video.provenance.ref, { provenance: still.provenance, href: posterHref });
    }
  }
  const visibleElements = admittedElements.filter(element => !posterOnlyElements.has(element));
  if (visibleElements.length === 0) return "";
  // WHERE THE "no claim" SENTENCE GOES depends on whether the body is mixed, and this was
  // measured on the running page: on a real promoted leaflet, where NO element has words yet,
  // the per-element sentence rendered three times in a column of three cells and buried the refs
  // it was describing. When every element is ref-only the section note above says it ONCE; when
  // some elements do state a claim, the ones that do not have to say so individually, or a
  // reader scanning the column reads the silence as the previous element's sentence continuing.
  // A MEDIA ELEMENT IS NOT SILENT, so it is excluded from this. The "no claim stated" note exists
  // because a bare ref with nothing beside it reads as the claim; an element that puts the
  // photograph on the page has already shown what it rests on, and adding "No claim stated." over
  // a picture is the paragraph-per-row failure this file was measured for.
  const allRefOnly = visibleElements.every((e) => !e.ok || (e.text === null && e.media === null));
  const sectionOrder = (element: typeof read.elements[number]): number => {
    if (audience === "published" && element.ok && element.media?.ok) return -1;
    const story = element.ok && element.text !== null && element.media === null ? readStoryElement({ text: element.text, provenance: element.provenance }) : null;
    return story ? STORY_SECTIONS.findIndex(section => section.key === story.section) : STORY_SECTIONS.length;
  };
  const items = [...visibleElements].sort((a, b) => sectionOrder(a) - sectionOrder(b))
    .map((element) => {
      const story = element.ok && element.text !== null && element.media === null ? readStoryElement({ text: element.text, provenance: element.provenance }) : null;
      if (story) return `<li class="leaflet-element" data-element="stated" data-story="${esc(story.section)}">${storyAccount(story)}</li>`;
      if (!element.ok) return `<li class="leaflet-element" data-element="unreadable">
<p class="aside">Unreadable at <span class="fol-metric">${esc(element.at)}</span>: ${esc(element.found)}</p>
</li>`;
      const media = element.media;
      const isPublishedMedia = audience === "published" && media?.ok;
      const provenance = provenanceRow(element.provenance);
      const words = element.text === null
        ? allRefOnly || media !== null ? "" : `<p class="aside">No claim stated.</p>`
        : `<p class="leaflet-element-text" data-verbatim="body-element">${esc(element.text)}</p>`;
      const posterSource = posterSourceByVideo.get(element.provenance.ref);
      const figure = media === null ? "" : mediaFigure(
        media, element.provenance.ref, element.text, audience, false,
        exportedMediaHrefs === undefined ? undefined : exportedMediaHrefs.get(element.provenance.ref) ?? null,
        exportedPosterHrefs?.get(element.provenance.ref) ?? null,
        isPublishedMedia ? `${provenance}${posterSource
          ? `<div class="leaflet-poster-source"><span class="fol-label">Poster image</span>${provenanceRow(posterSource.provenance)}<a href="${esc(posterSource.href)}">Open still</a></div>` : ""}` : undefined,
      );
      return `<li class="leaflet-element" data-element="${media !== null ? "media" : element.text === null ? "ref-only" : "stated"}">
${isPublishedMedia ? `${figure}\n${words}` : `${words}\n${figure}\n${provenance}`}
</li>`;
    })
    .join("\n");
  const stated = visibleElements.filter((e) => e.ok && e.text !== null).length;
  const hasMedia = visibleElements.some((e) => e.ok && e.media?.ok);
  // The section note is a CAPTION plus, when it applies, the one statement whose absence would
  // mislead: a column of bare refs with no words has to say that no claim is being made, or the
  // refs read as the claim. The argument for element-wise evidence is rationale and moved.
  return `<section class="leaflet-body" data-body="present"${audience === "published" && hasMedia ? ' data-media-led="true"' : ""} aria-labelledby="leaflet-body-h">
<h2 id="leaflet-body-h">${audience === "private" ? "Recorded content" : "Body"}</h2>
${stated === 0 && !hasMedia ? `<p class="aside">No claims stated</p>
` : ""}<ul class="leaflet-elements">
${items}
</ul>
</section>`;
}

function renderLeafletArtifact(
  leaflet: Leaflet,
  subject: string,
  source: LeafSource,
  audience: LeafAudience = "published",
  exportOptions?: { readonly backHref: string; readonly mediaHrefs: ReadonlyMap<string, string>; readonly posterHrefs?: ReadonlyMap<string, string> },
  shared = false,
): string {
  // PUBLICATION — the facts an owner acts on, shown only where the owner is looking. A stranger
  // holding a shared link gets the artifact, not its sharing mechanics.
  const visibility = leafletVisibility(leaflet);
  const visibilityLabel = visibility === "public" ? "Public" : visibility === "unlisted" ? "Unlisted" : "Private";
  const publication =
    audience === "private"
      ? `<section class="leaflet-prov-section" aria-labelledby="leaflet-pub-h">
<h2 id="leaflet-pub-h">Publication</h2>
<dl class="leaf-prov"><div><dt class="fol-label">Visibility</dt>
<dd><span class="proof">${visibilityLabel}</span></dd></div>${shared ? `
<div><dt class="fol-label">Address</dt>
<dd>${sharedAddressLink(leaflet.id)}</dd></div>` : ""}</dl>
</section>`
      : "";
  // A promoted leaflet's provenance is a handle on its first body element (`git`, same ref, same
  // instant): that element already shows it, so the drafter's label is not printed as a second ref.
  const promotedHandle = provenanceIsPromotedHandle(leaflet);
  const provenanceRepeatedInBody = leaflet.provenance !== undefined && Array.isArray(leaflet.body) && leaflet.body.some(
    element => typeof element === "object" && element !== null && "provenance" in element &&
      typeof element.provenance === "object" && element.provenance !== null &&
      "source" in element.provenance && "ref" in element.provenance && "observedAt" in element.provenance &&
      (element.provenance.source === leaflet.provenance?.source || promotedHandle) && element.provenance.ref === leaflet.provenance?.ref &&
      element.provenance.observedAt === leaflet.provenance?.observedAt &&
      !(audience === "published" && "media" in element && typeof element.media === "object" && element.media !== null &&
        "mediaType" in element.media && element.media.mediaType === "video/mp4" &&
        !exportOptions?.mediaHrefs.get(element.provenance.ref as string)),
  );
  const prov =
    provenanceRepeatedInBody ? "" :
    "provenance" in leaflet && leaflet.provenance !== undefined
      ? `<section class="leaflet-prov-section" aria-labelledby="leaflet-prov-h">
<h2 id="leaflet-prov-h">${audience === "private" ? "Source evidence" : "Provenance"}</h2>
${provenanceRow(leaflet.provenance)}
</section>`
      : `<section class="leaflet-prov-section" aria-labelledby="leaflet-prov-h">
<h2 id="leaflet-prov-h">${audience === "private" ? "Source evidence" : "Provenance"}</h2>
<p class="aside">No provenance</p>
</section>`;

  const reason =
    leaflet.tier === "excluded"
      ? `<p class="leaf-reason"><span class="fol-label">Reason</span> ${esc(leaflet.reason)}</p>`
      : "";

  // WHAT THIS PAGE IS ALLOWED TO CLAIM, said on the page rather than assumed by the reader. Only
  // a verified leaflet is an outward claim; the other two are the subject's own accounting, and a
  // shared link to one has to say so or the sharing itself makes a claim the domain refuses to.
  //
  // A FABRICATED DOCUMENT OVERRIDES THE TIER, and it has to override it HERE rather than being
  // left to the band above. The band says the document is an illustration; this sentence made a
  // statement about THIS artifact, and "authorship is cryptographically established" is false
  // about a leaflet whose provenance ref is the string `example-ref-not-a-commit-0001`. Two true
  // sentences and one false one on the same page is not honesty — the reader takes the specific
  // claim over the general disclaimer. So the tier is still shown and still named, and what is
  // withdrawn is the assertion that it was OBSERVED of anyone.
  //
  // `data-standing` names which of the three this is, so the check does not depend on the copy.
  // The tier pill stays visible in every case; the tier's definition (`TIER_MEANING`) is on the
  // leaf page's legend, not repeated here.
  const fabricated = fabricationSignals(source).length > 0;
  //
  // ALL THREE STAY VISIBLE at every density — each is a statement whose absence would let a
  // reader infer something false about a person, which is the one class that may not go behind a
  // drawer. What the density pass took is the trailing explanation of each, not the claim itself.
  const standing = fabricated
    ? `<p class="aside" data-standing="example">Nothing is claimed here about anyone</p>`
    : leaflet.tier === "verified"
      ? `<p class="aside" data-standing="outward">Outward claim · signed</p>`
      : `<p class="aside" data-standing="own-accounting">Not an outward claim — own accounting</p>`;

  // THE DOCUMENT <title> IS NOT THE ARTIFACT'S TITLE, and that is a correction, not a downgrade.
  //
  // It used to be `leaflet.title` — the raw commit subject. `<title>` is the one string on the
  // page that ESCAPES the page: it is the browser tab, the history entry, the bookmark, the text
  // a link preview quotes. Two things follow, and neither of them needs an owner decision:
  //
  //   1. EGRESS. Intake over a real repository produced a commit subject with a third party's
  //      email address. The public heading now uses the same identifier rule as Canopy's
  //      publication gate; a changed heading cannot attest that its text is verbatim. The
  //      private owner view still has the original words and source ref.
  //   2. THE SAME MARKER PROBLEM AS THE NO SCORE CHECK. `<title>` carries no `data-verbatim`, so
  //      a carried subject sitting there was authored chrome by every rule this file states —
  //      "feat: add score normalizer and a 40% faster ranking pass" in the tab is the product
  //      appearing to write a rating.
  //
  // What replaces it says exactly as much as Foliage can say in its own voice: the tier, and the
  // short form of the ref the artifact is identified by. When there is no provenance the leaflet
  // id is the only handle the document holds — and it is not a new disclosure, because it is
  // already in this page's own URL. The words themselves stay in the <h1>, where the attribute
  // above governs whose they are, and `git show <ref>` still finds the original.
  const handle = ("provenance" in leaflet ? leaflet.provenance?.ref : undefined) ?? leaflet.id;
  const shortHandle = handle.length > 12 ? handle.slice(0, 12) : handle;
  const title = visibleLeafletTitle(leaflet, audience);
  // SHARED, not "published". With no export options this is the Leaf server's share route, which
  // binds loopback: nothing here was published anywhere, it was shared with `foliage share`. The
  // band says that and no more. Whether the share is Public or Link only, and where this copy
  // opens, are sharing mechanics, and a stranger holding a shared link gets the artifact, not its
  // sharing mechanics (the owner's Publication section and /publish carry those). The share route
  // answers only for shared leaflets (`findLeaflet` refuses the rest), so there is no third case.
  // The static export keeps the audience word: where those files are hosted is the owner's choice.
  const audienceLabel = audience === "published" && !exportOptions && isLinkShareable(visibility) ? "shared" : undefined;

  return page({
    title: `Foliage — ${tierLabel(leaflet.tier, audience).toLowerCase()} leaflet ${shortHandle}`,
    state: "leaflet",
    surface: "leaflet",
    empty: false,
    face: audience === "private" ? "night" : "day",
    audience,
    ...(audienceLabel === undefined ? {} : { audienceLabel }),
    chrome: audience === "private" ? "Foliage — your leaflet" : "Foliage — a leaflet",
    nav: audience === "private" ? "leaf" : undefined,
    body: `${fabricationBand(source)}
<article class="leaflet" data-tier="${esc(leaflet.tier)}">
${audience === "private" ? `<p class="leaflet-back"><a href="${LEAF_ROUTE}">My portfolio</a></p>` : exportOptions ? `<p class="leaflet-back"><a href="${esc(exportOptions.backHref)}">All work</a></p>` : ""}
<span class="fol-label">Leaflet</span>
<h1 ${title.attr}>${esc(title.text)}</h1>
<p class="leaflet-tier">${proofBadge(leaflet.tier, audience)}</p>
${standing}
${reason}
${audience === "private" ? `<nav class="leaflet-actions" aria-label="Actions">
${leaflet.tier === "pending" && (!leaflet.visibility || leaflet.visibility === "private") ? ui.link("Tell story", { href: `/leaf/story?leaflet=${encodeURIComponent(leaflet.id)}` }) : ""}
${ui.link("Inspect", { href: `${SCARLET_WORKSPACE_ROUTE}?leaflet=${encodeURIComponent(leaflet.id)}` })}
<a href="${SCARLET_WORKSPACE_ROUTE}?leaflet=${encodeURIComponent(leaflet.id)}&amp;purpose=describe">Improve wording</a>
</nav>` : ""}
${bodySection(leaflet, audience, exportOptions?.mediaHrefs, exportOptions?.posterHrefs)}
${prov}
${publication}
<footer class="leaflet-foot">
<span class="fol-label">From the leaf of</span>
<span>${esc(subject)}</span>
</footer>
</article>`,
  });
}

/**
 * Nothing shareable at this address.
 *
 * STATES THE RULE, NEVER WHICH CASE APPLIED. There is no leaflet here with that id, or there is
 * one its subject has not marked shareable, and this page reads identically either way â see
 * `findLeaflet` for why that collapse is the point rather than a lapse.
 *
 * It names the id that was ASKED FOR, which the requester already had, and nothing else: not the
 * ids that exist, not how many there are, not the subject. "Did you mean..." here would be an
 * enumeration oracle.
 *
 * IT CARRIES THE FABRICATION BAND TOO, which sounds like a disclosure and is not one: the band is
 * a fact about the DOCUMENT and names no leaflet, so it is identical for "no such id" and for "not
 * shared" and cannot separate them. Omitting it here would be worse than pointless — the artifact
 * page and this page are compared byte for byte with the id substituted out, and a band on one of
 * them would make that comparison the oracle it exists to refuse.
 */
function renderNotShareable(requestedId: string, source: LeafSource): string {
  return page({
    title: "Foliage — nothing shared",
    state: "not-shareable",
    surface: "leaflet",
    empty: false,
    chrome: "Foliage — a leaflet",
    body: `${fabricationBand(source)}
<section class="leaf-state" aria-labelledby="leaf-state-h">
<span class="fol-label">not-shareable</span>
<h1 id="leaf-state-h">Nothing shared here</h1>
<p class="leaf-detail fol-metric">${esc(requestedId)}</p>
</section>`,
  });
}

/**
 * Render one leaflet, or the honest reason there is none. Total over `LeafletLoad`.
 *
 * `source` is REQUIRED and describes the DOCUMENT the leaflet came out of, not the leaflet. It is
 * required rather than optional because the caller that omitted it is the defect this parameter
 * exists to prevent: `/leaflet/<id>` served an example document with no fabrication band for as
 * long as the band's input stopped at the leaf page. An optional parameter would have let the same
 * omission compile.
 */
export function renderLeafletPage(
  load: LeafletLoad,
  source: LeafSource,
  audience: LeafAudience = "published",
  exportOptions?: { readonly backHref: string; readonly mediaHrefs: ReadonlyMap<string, string>; readonly posterHrefs?: ReadonlyMap<string, string> },
): string {
  return load.ok
    ? renderLeafletArtifact(load.leaflet, load.subject, source, audience, exportOptions, audience === "private" && load.shared === true)
    : renderNotShareable(load.requestedId, source);
}

/* ==============================================================================================
   THE REVIEW QUEUE — GET /review, POST /review
   ==============================================================================================

   WHAT THIS SURFACE IS. `harvest.mjs` drafts CANDIDATES from real material and a person approves
   or rejects each one by hand before any of it can become a portfolio entry. That review existed
   only as a terminal command. This is the same gate in a browser, and it is the same gate in the
   literal sense: a decision made here is written back through `parseHarvestDocument`, the file it
   writes is the file the CLI reads, and neither one can record something the other would refuse.

   THREE RULES CARRIED OVER FROM THE CLI, NOT REIMPLEMENTED LOOSELY:
     - a REJECTION REQUIRES A REASON. Refused at the POST, exactly as `harvest.mjs reject` refuses
       without `--reason`. A rejection with no reason is a silent disappearance.
     - a decision REQUIRES A REVIEWER. Promotion turns a machine draft into somebody's portfolio
       entry; that act is attributable or it does not happen.
     - a DECIDED candidate is not re-decided. The current state is named in the refusal.

   AND ONE THING THIS SURFACE MUST SAY OUT LOUD: approving is not publishing and not verifying.
   `promoteApproved` emits `pending` leaflets. A queue that read like a publish button would be
   the product overclaiming in its own UI.

   NIGHT FACE. This is the one instrument surface in this app — the operator, alone, looking at
   what a machine drafted. Nobody is ever shown it, which is exactly why it takes the instrument
   plane while `/` and `/leaflet/<id>` take the public one.
*/

export const REVIEW_ROUTE = "/review";

/**
 * Where an approved candidate is carried into the leaf.
 *
 * ITS OWN ROUTE, not a second `decision` value on the review POST, because it is not a decision
 * about a candidate — it is a write to a DIFFERENT document. `/review` writes the harvest and
 * nothing else; this writes the leaf. Keeping them apart is what lets the review POST stay a pure
 * function of the harvest, and it means the method table can say truthfully that `/review` never
 * touches a portfolio.
 */
export const PROMOTE_ROUTE = "/promote";

/** Where a Jev check is asked for. It records a private mark in the workflow, never a decision. */
const JEV_ROUTE = "/workflow/jev";

/**
 * Where Photosynthesis answers one question about the leaf — an AG-UI run over server-sent events.
 *
 * POST only, same-origin only, the same headers as every other response. It reads the leaf and
 * writes nothing: no route of this server reads what a run says, so nothing the model proposes
 * can reach the harvest or the leaf except through the person at `/review`.
 */
export const SCARLET_RUN_ROUTE = "/scarlet/run";

/**
 * The page that asks the same question without a client: one form, the same runner as the
 * route above with a collecting sink, and the answer on the same page. GET renders the form;
 * POST answers it. Nothing is written by either, and nothing asked here is kept.
 */
export const SCARLET_ROUTE = "/scarlet";

/**
 * What the leaf already holds, so the promote panel can state the truth instead of a guess.
 *
 * THIS IS DERIVED, NEVER PASSED THROUGH A REDIRECT. The obvious way to show "promoted 2!" after a
 * POST is a query parameter, and it would be a number the page prints without having measured —
 * forgeable by editing the URL, and wrong the moment the operator reloads. So the panel is handed
 * the ids the leaf ACTUALLY contains and works out what remains; after a promotion the same
 * derivation simply yields a different sentence.
 *
 * The failure branch matters as much as the success one: if the leaf could not be read, the panel
 * says so and offers nothing. A promote button rendered over an unknown target would be offering
 * to write a file this process cannot see.
 *
 * `subject` is the leaf's own display name, read from the same parse: the reviewer a first
 * decision is attributed to when the harvest records no earlier one (see `declaredReviewer`).
 */
export type LeafIndex =
  | { readonly ok: true; readonly ids: ReadonlySet<string>; readonly path: string; readonly subject: string }
  | { readonly ok: false; readonly detail: string };

/** The promote panel on `/review`: every "approved waiting" sentence elsewhere links here. */
export const REVIEW_PROMOTE_HREF = `${REVIEW_ROUTE}#review-promote-h`;

/**
 * Approved candidates the leaf does not hold yet — what "approved waiting" means on every surface
 * that says it (the promote panel, the decision status line, Overview's next step, Work's review
 * card). A subtraction against the leaf's ids, never a count of `approved` alone: once promoted, a
 * candidate stays `approved` in the harvest, and counting it would advertise finished work forever.
 *
 * ONLY A LEAF THAT WAS READ CAN ANSWER IT, so the ids are required. With no leaf there is nothing
 * to subtract from and nothing the promote panel can add into, and a count taken anyway names
 * every approval as waiting — measured: "2 approved waiting" for two drafts already in a leaf that
 * had merely failed validation, linked to a panel with no button. A caller without ids says
 * nothing about waiting work; the panel itself says why the leaf could not be read.
 */
export function approvedNotInLeaf(
  harvest: HarvestDocument,
  inLeaf: ReadonlySet<string>,
): readonly HarvestCandidate[] {
  return harvest.candidates.filter((c) => c.review.state === "approved" && !inLeaf.has(c.id));
}

/** The server and CLI use this setting to select the review document. */
export const HARVEST_ENV = "FOLIAGE_HARVEST";

/**
 * The remedy an empty or absent queue hands the operator, written ONCE.
 *
 * It was written twice, inline, and both copies went stale the day `propose` made `--identity`
 * required: the two surfaces that exist precisely because there is nothing to review were telling
 * the operator to run a command that now exits 2. Loud rather than silent — the CLI names the
 * missing flag — but a remedy that does not work is still a dead end at the exact moment somebody
 * has nothing and is looking for the way forward. One constant, so the next contract change has
 * one place to land instead of two places to be forgotten in.
 */
export const PROPOSE_COMMAND = "node apps/leaf/harvest.mjs propose --repo <path> --identity <email>";

/**
 * What loading the harvest document produced. The SAME five causes as `LeafLoad`, for the same
 * reason: "you have not told me where the file is", "there is no file there", "the OS refused
 * it", "it is not JSON" and "it is JSON but not a harvest" are five different situations, and a
 * queue that renders empty for all five would be the `commitCount: 0` collapse in a new place.
 *
 * WHY THIS UNION LIVES HERE and not beside `LeafLoad` in `leafDocument.ts`: this lane owns
 * `render.ts` and `server.mjs` and no other module of this app. The loader that produces it is in
 * `server.mjs` (it is fs), and the union sits next to the renderer that has to be total over it.
 * If a later change is free to touch `leafDocument.ts`, both halves belong there.
 */
export type HarvestLoad =
  | { readonly ok: true; readonly harvest: HarvestDocument; readonly path: string }
  | { readonly ok: false; readonly cause: "unconfigured"; readonly detail: string }
  | { readonly ok: false; readonly cause: "absent"; readonly detail: string; readonly path: string }
  | {
      readonly ok: false;
      readonly cause: "unreadable";
      readonly detail: string;
      readonly path: string;
      readonly errno: string;
    }
  | { readonly ok: false; readonly cause: "malformed"; readonly detail: string; readonly path: string }
  | {
      readonly ok: false;
      readonly cause: "invalid";
      readonly detail: string;
      readonly path: string;
      readonly issues: readonly HarvestDocumentIssue[];
    };

/**
 * HTTP status for a harvest load, on the same reasoning as `httpStatusFor`: 200 for the two
 * first-run states of a correctly working install, 409 for the three where the draft file on
 * disk needs the owner's repair — an expected state with a page that names it, not a 500.
 */
export function httpStatusForHarvest(load: HarvestLoad): 200 | 409 {
  if (load.ok) return 200;
  switch (load.cause) {
    case "unconfigured":
    case "absent":
      return 200;
    case "unreadable":
    case "malformed":
    case "invalid":
      return 409;
    default: {
      const impossible: never = load;
      throw new Error(`unhandled harvest load cause: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * The status for a POST whose DOCUMENT would not load — a write, or a run, that did not happen.
 *
 * ANY DOCUMENT LOAD, HARVEST OR LEAF. The parameter is the five causes by name (`LeafLoadCause`),
 * not one loader's union: `HarvestLoad` and `LeafLoad` fail for the same five reasons, and the
 * status below is decided by the cause and nothing else on the record (today every cause answers
 * 409, for the reasons given below). It was declared over the harvest union alone, and
 * `scarletPage.ts` re-derived the identical switch for the leaf (PR #28 review, blocker 2) — two
 * copies of one policy, one of which would drift.
 *
 * `httpStatusForHarvest` is the wrong function for this and answering it here was a real defect:
 * it returns 200 for `unconfigured` and `absent`, which is right for a GET (an install with no
 * harvest document is a correctly working install, and the queue says so) and is a lie for a POST.
 * Measured before the fix — POST /review with FOLIAGE_HARVEST pointing at a path with no file
 * answered `200 OK`, and the body never once said that nothing had been recorded. A client with no
 * eyes on the page — a script, a retry wrapper, an uptime check — reads that as "decision
 * recorded". Silently answering success to a write that wrote nothing is the error-masking class
 * this project keeps paying for, in its most expensive form: the caller stops asking.
 *
 * 409 for every cause: the request is well-formed, the method is one this route has, and it
 * could not be completed because of the state of the target — there is no document to record a
 * decision in, or one the owner has to repair first. That is what 409 says, and it is the honest
 * one of the plausible codes:
 *   - 404 would say this ENDPOINT does not exist, and a correct client would stop POSTing to a
 *     route that works as soon as a document exists;
 *   - 400/422 would blame the submission, which is fine — the reviewer would go on editing a form
 *     that was never the problem;
 *   - 500 would claim this app is broken, when an install that has drafted nothing yet is not, and
 *     neither is one whose file on disk needs repair (a GET answers 409 for those three as well).
 *
 * Still total by the same `never` check as its neighbours, so a sixth cause fails the typecheck
 * rather than picking up whichever branch fell through.
 */
export function httpStatusForUnwritable(load: { readonly cause: LeafLoadCause }): 409 {
  switch (load.cause) {
    case "unconfigured":
    case "absent":
    case "unreadable":
    case "malformed":
    case "invalid":
      return 409;
    default: {
      const impossible: never = load.cause;
      throw new Error(`unhandled load cause: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * Why a review POST was refused. Each one is a DIFFERENT thing to tell the reviewer, and each
 * carries the fact that makes it actionable — which id, which state it is already in.
 */
export type ReviewRefusal =
  | { readonly cause: "stale-candidate"; readonly id: string }
  | { readonly cause: "document-busy"; readonly id: string; readonly detail?: string }
  | { readonly cause: "no-such-candidate"; readonly id: string }
  | { readonly cause: "already-decided"; readonly id: string; readonly state: ReviewState }
  | { readonly cause: "missing-reviewer"; readonly id: string }
  | { readonly cause: "missing-reason"; readonly id: string }
  | { readonly cause: "unknown-decision"; readonly given: string }
  | { readonly cause: "title-on-reject"; readonly id: string }
  | { readonly cause: "rating-shaped-title"; readonly id: string };

/**
 * The one caveat a SUCCESSFUL promotion may carry to the queue's next GET, over the redirect —
 * the web analogue of the CLI's own printed caveat (F-014, PR #17 review, blocker 2). `carryIntoLeaf`
 * in `server.mjs` has no response body to put this in (a 303 has none), so it rides the redirect's
 * query string instead, and the GET handler reads it back before calling `renderReviewPage`.
 *
 * ONE MEMBER TODAY because `promoteApproved`'s `binding` field has exactly two states and only
 * one of them — `"unbound-legacy"` — is a caveat; `"checked"` says nothing because a checked
 * binding is the unremarkable case. A second state, should one ever exist, is a second string
 * literal added here, not a boolean recast into a string.
 */
export type PromoteNotice = "unbound-legacy";

/** 404 / 409 / 400 — the refusal's own cause chooses, so the status and the page cannot disagree. */
export function httpStatusForRefusal(refusal: ReviewRefusal): 400 | 404 | 409 {
  switch (refusal.cause) {
    case "no-such-candidate":
      return 404;
    case "already-decided":
    case "stale-candidate":
    case "document-busy":
      return 409;
    case "missing-reviewer":
    case "missing-reason":
    case "unknown-decision":
    case "title-on-reject":
    case "rating-shaped-title":
      return 400;
    default: {
      const impossible: never = refusal;
      throw new Error(`unhandled refusal: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * A refusal in the reviewer's words. THE DRAFT IS NAMED BY ITS TITLE, never by its id: the id is
 * a document key, kept in the card's Technical details, and "git-cluster:www is already approved"
 * names nothing the reviewer can see. The banner passes the title; inside the draft's own card,
 * under that title, `title` is omitted and the sentence says "this draft".
 */
function refusalMessage(refusal: ReviewRefusal, title?: string): string {
  const named = title === undefined ? "this draft" : `“${esc(title)}”`;
  const opening = title === undefined ? "This draft" : named;
  switch (refusal.cause) {
    case "stale-candidate":
      return `Draft changed. Your text is kept below.`;
    case "document-busy":
      return `Another save holds the drafts. Your text is kept below; retry.`;
    case "no-such-candidate":
      return `That draft is no longer in the queue. Reload to see the current drafts.`;
    case "already-decided":
      return `${opening} is already ${describeReview(refusal.state)}.`;
    case "missing-reviewer":
      return `Reviewer required for ${named}.`;
    case "missing-reason":
      return `Reason required to reject ${named}.`;
    case "unknown-decision":
      return `"${esc(refusal.given)}" is not a decision. Use approve or reject.`;
    case "title-on-reject":
      return `Titles apply to approve only.`;
    case "rating-shaped-title":
      return `Your new title for ${named} reads like a score. Use counts and facts.`;
    default: {
      const impossible: never = refusal;
      throw new Error(`unhandled refusal: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * One line describing a review state, reason included, as escaped HTML. The day is the decision's
 * UTC calendar day, the same clock the evidence rows' Observed dates use; the exact instant rides
 * in the `<time>` element's `datetime`, for machines, not in the sentence a reviewer reads.
 */
function describeReview(review: ReviewState): string {
  switch (review.state) {
    case "candidate":
      return "candidate (unreviewed)";
    case "approved":
      return `approved by ${esc(review.by)} on ${decisionDay(review.at)}`;
    case "rejected":
      return `rejected by ${esc(review.by)} on ${decisionDay(review.at)}: ${esc(review.reason)}`;
    default: {
      const impossible: never = review;
      throw new Error(`unhandled review state: ${JSON.stringify(impossible)}`);
    }
  }
}

const REVIEW_STATE_LABEL: Readonly<Record<ReviewState["state"], string>> = Object.freeze({
  candidate: "Unreviewed",
  approved: "Approved",
  rejected: "Rejected",
});

/**
 * A REVIEW STATE IS NOT A PROOF TIER, and this badge is where that has to be visible.
 *
 * It is the same `.proof` component — same geometry, same type, same 44px-safe target area — and
 * it deliberately takes NO tier modifier and NO glyph. So it renders untinted, in the default
 * text colour, and it cannot be mistaken for a proof outcome:
 *
 *   - "Approved" must never share a colour with "Verified". Approving records a decision; it does
 *     not publish the leaflet and it does not verify it, because verification requires evidence
 *     and a decision is not evidence. `promoteApproved` emits a PENDING leaflet.
 *   - "Rejected" must never share a colour with "Excluded". Excluded means read-and-unattributable;
 *     rejected means a person judged a draft. Neither is the other.
 *
 * The variant lives on `data-review-pill`, which is what the assertions key on, and the absence of
 * `data-pill-tier` is itself the guarantee: a selector for proof tiers cannot reach these.
 */
function reviewBadge(state: ReviewState["state"]): string {
  return `<span class="proof" data-review-pill="${esc(state)}">${esc(
    REVIEW_STATE_LABEL[state],
  )}</span>`;
}

const referenceNoun = (count: number): string => count === 1 ? "reference" : "references";
const reviewDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** A decision's UTC day to read, with the recorded instant as the element's machine-readable value. */
const decisionDay = (at: string): string => `<time datetime="${esc(at)}">${esc(reviewDate.format(new Date(at)))}</time>`;

/** What drafted a candidate or a promoted leaflet, in words; the extractor id stays in the document. */
function draftedBy(extractor: string): string {
  if (extractor === "git-cluster") return "Drafted from Git";
  if (extractor.startsWith("reviewer:")) return `Drafted by ${extractor.slice("reviewer:".length)}`;
  if (extractor.startsWith("local-model:")) return "Drafted with a local model";
  return "Drafted from a source";
}
const reviewSource = (candidate: HarvestCandidate): string => candidate.extractor === "owner-selected-design-image"
  ? "Selected by you" : draftedBy(candidate.extractor);

/**
 * Keep the reference readable at a glance while retaining the exact value in the document.
 * Authored (git's author date) sits beside Observed (when intake looked) only when the ref
 * carries one; the two clocks are never merged, and neither stands in for the other. It is not
 * called Committed: a rebased or amended commit was committed later than it was authored.
 */
function reviewProvenanceRow(p: HarvestEvidence, excerpt?: string, foldLongExcerpt = false): string {
  const shortHash = shortEvidenceRef(p.ref);
  const fullRef = shortHash === p.ref ? "" : `<details class="review-full-ref"><summary>Full reference</summary><code class="fol-metric">${esc(p.ref)}</code></details>`;
  const authored = p.source === "git" && p.authoredAt !== undefined
    ? `\n<div class="review-ref-authored"><dt class="fol-label">Authored</dt><dd class="fol-metric"><time datetime="${esc(p.authoredAt)}" title="${esc(p.authoredAt)}">${esc(reviewDate.format(new Date(p.authoredAt)))}</time></dd></div>`
    : "";
  const excerptBody = excerpt === undefined ? "" : foldLongExcerpt && excerpt.length > 360
    ? `<dd><details><summary>Read excerpt</summary><p data-verbatim="evidence-excerpt">${esc(excerpt)}</p></details></dd>`
    : `<dd data-verbatim="evidence-excerpt">${esc(excerpt)}</dd>`;
  return `<dl class="leaf-prov">
<div><dt class="fol-label">Source</dt><dd>${esc(evidenceSourceLabel(p.source))}</dd></div>
<div><dt class="fol-label">Ref</dt><dd class="fol-metric"><span title="${esc(p.ref)}">${esc(shortHash)}</span>${fullRef}</dd></div>${authored}
<div><dt class="fol-label">Observed</dt><dd class="fol-metric"><time datetime="${esc(p.observedAt)}">${esc(reviewDate.format(new Date(p.observedAt)))}</time></dd></div>${excerpt === undefined ? "" : `
<div class="review-ref-excerpt"><dt class="fol-label">Excerpt</dt>${excerptBody}</div>`}
</dl>`;
}

/**
 * The evidence a candidate CITES. Review keeps the leaf's Source, Ref and Observed terms while
 * presenting shorter visible values. An approved candidate's exact refs cross into a Leaflet
 * unchanged; the full hash remains in a native disclosure.
 *
 * One reference and its displayable visual lead the decision. The remaining visible refs and
 * media follow it; refs after the first three sit in one native disclosure. Every cited ref
 * remains in the document. Imported snapshots keep all of this before their decision form.
 */
const REVIEW_EVIDENCE_LEAD = 3;
function reviewCandidateImageHref(candidateId: string, ref: string): string {
  return `${REVIEW_ROUTE}/candidate-image?candidate=${encodeURIComponent(candidateId)}&ref=${encodeURIComponent(ref)}`;
}
function candidateEvidence(candidate: HarvestCandidate): { lead: string; rest: string; imageLed: boolean } {
  const media = candidate.media ?? [];
  const leadMediaIndex = media.findIndex((item) => isMediaDigestRef(item.ref) &&
    (DISPLAYABLE_MEDIA_TYPES.has(String(item.media.mediaType)) || item.media.mediaType === "video/mp4"));
  const imported = isImportedObservationCandidate(candidate);
  const imageLed = !imported && leadMediaIndex >= 0 &&
    DISPLAYABLE_MEDIA_TYPES.has(String(media[leadMediaIndex]!.media.mediaType)) &&
    !media.some((item) => String(item.media.mediaType).startsWith("video/"));
  const matchingRefIndex = leadMediaIndex < 0 ? -1 : candidate.evidence.findIndex((ref) => ref.ref === media[leadMediaIndex]!.ref);
  const leadRefIndex = matchingRefIndex < 0 ? 0 : matchingRefIndex;
  const leadRef = candidate.evidence[leadRefIndex];
  const otherRefs = candidate.evidence.filter((_, index) => index !== leadRefIndex);
  const poster = media.find((item) => DISPLAYABLE_MEDIA_TYPES.has(String(item.media.mediaType)) && isMediaDigestRef(item.ref));
  const posterHref = poster ? reviewCandidateImageHref(candidate.id, poster.ref) : null;
  const previews = media.map((item, index) => {
    const type = String(item.media.mediaType);
    const href = isMediaDigestRef(item.ref)
      ? type.startsWith("image/") ? reviewCandidateImageHref(candidate.id, item.ref) : `/review/media/${item.ref}`
      : null;
    const label = type.startsWith("video/") ? "Recorded demo" : "Evidence image";
    const size = item.media.dimensions.known
      ? `${item.media.dimensions.width} × ${item.media.dimensions.height}`
      : "Size not measured";
    if (href === null) return `<li class="review-media-unavailable">${esc(label)} unavailable for preview</li>`;
    const visual = type === "video/mp4"
      ? `<video controls playsinline preload="metadata"${posterHref ? ` poster="${esc(posterHref)}"` : ""} aria-label="Recorded demo"><source src="${esc(href)}" type="video/mp4">Video playback unavailable. <a href="${esc(href)}">Open video</a></video>`
      : DISPLAYABLE_MEDIA_TYPES.has(type)
        ? `<a class="review-media-open" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Open full evidence image"><img src="${esc(href)}" alt="Evidence image" loading="${index === leadMediaIndex ? "eager" : "lazy"}" decoding="async"></a>`
        : `<p>Preview unavailable. <a href="${esc(href)}">Open file</a></p>`;
    return `<li><figure class="review-media"><div class="review-media-frame">${visual}</div><figcaption><span>${esc(label)}</span><span class="fol-metric">${esc(size)}</span></figcaption></figure></li>`;
  });
  const mediaList = (items: readonly string[], label: string): string => items.length ? `<ul class="review-media-list" aria-label="${label}">${items.join("\n")}</ul>` : "";
  const leadPreview = leadMediaIndex < 0 ? [] : [previews[leadMediaIndex]!];
  const remainingPreviews = previews.filter((_, index) => index !== leadMediaIndex);
  const restRefs = otherRefs.slice(0, REVIEW_EVIDENCE_LEAD - 1);
  const moreRefs = otherRefs.slice(REVIEW_EVIDENCE_LEAD - 1);
  const lead = `<div class="review-evidence">
${imageLed ? "" : `<span class="fol-label">Evidence · ${candidate.evidence.length} ${referenceNoun(candidate.evidence.length)}</span>`}
${imported
    ? `<p class="aside" data-import-disclosure>Imported snapshot · identities declared and unverified · provider and source permission not checked · approval does not publish</p>`
    : ""}
${imageLed ? mediaList(leadPreview, "First captured media") : ""}
${leadRef ? reviewProvenanceRow(leadRef, leadRef.excerpt, !imported) : ""}
${imageLed ? "" : mediaList(leadPreview, "First captured media")}
${candidate.review.state === "candidate" && !imported
    ? `<a class="btn btn-ghost review-jump" href="#${esc(encodeURIComponent(`by-${candidate.id}`))}">Review decision</a>`
    : ""}
</div>`;
  const rest = restRefs.length || moreRefs.length || remainingPreviews.length ? `<div class="review-evidence review-evidence-continuation">
<span class="fol-label">Remaining evidence</span>
${restRefs.map((p) => reviewProvenanceRow(p, p.excerpt)).join("\n")}
${moreRefs.length
    ? `<details class="review-refs-more" data-review-refs-more><summary>All <span class="fol-metric">${candidate.evidence.length}</span> references</summary>
${moreRefs.map((p) => reviewProvenanceRow(p, p.excerpt)).join("\n")}
</details>`
    : ""}
${mediaList(remainingPreviews, "Remaining captured media")}
</div>` : "";
  return { lead, rest, imageLed };
}

/**
 * THE PACK: what the drafter was SHOWN, which is a larger set than what the candidate cites.
 *
 * This is not decoration and it is the one thing a browser review can lose that the CLI has. A
 * drafter shown pages A and B in one prompt can put a name out of B into a line citing only A, so
 * a reviewer reading the refs alone is reading the smaller set. `charsShown` below `charsInPage`
 * says the model saw a FRACTION of a page the line may cite whole.
 */
function candidatePack(candidate: HarvestCandidate): string {
  const pack = candidate.shownPages ?? [];
  if (pack.length === 0) return "";
  const thirdParty = pack.filter((p) => p.kind === "third-party-shaped").length;
  const rows = pack
    .map(
      (p) => `<li data-page-kind="${esc(p.kind)}">
<span class="fol-label">${esc(p.kind === "third-party-shaped" ? "third-party-shaped" : "unclassified")}</span>
<span class="fol-metric review-page-path">${esc(p.page)}</span>
<span class="fol-metric">${
        p.charsShown < p.charsInPage
          ? `${p.charsShown} of ${p.charsInPage} characters shown`
          : `all ${p.charsInPage} characters`
      }</span>
</li>`,
    )
    .join("\n");
  // BOTH BRANCHES STAY VISIBLE, SHORTENED. Each is a statement about identifiable third parties,
  // and both directions mislead by omission: dropping the warning hides a person's name from the
  // reviewer, and dropping the qualifier lets "no third-party pages" read as "nothing here names
  // anyone" — which nothing has checked, because only the PATH was read. The reasoning behind
  // both moved to the queue's own drawer; the fact and the qualifier did not.
  return `<div class="review-pack" data-third-party="${thirdParty > 0 ? "true" : "false"}">
<span class="fol-label">Shown to the drafter — ${pack.length} page(s)</span>
${
  thirdParty > 0
    ? `<p class="aside"><strong>${thirdParty} path${
        thirdParty === 1 ? "" : "s"
      } name${thirdParty === 1 ? "s" : ""} another person.</strong></p>`
    : `<p class="aside">No path names another person (paths only)</p>`
}
<ul class="review-pages">
${rows}
</ul>
</div>`;
}

/**
 * The decision form. No JavaScript anywhere on this surface — the page's CSP is
 * `default-src 'none'` and there is no script for it to permit.
 *
 * Two submit buttons sharing the name `decision`: the browser sends the one that was pressed, so
 * approve and reject are one form over one candidate rather than two forms that could disagree
 * about which reviewer is acting. `reason` is not marked `required` in the markup because HTML
 * cannot make a field conditional on WHICH button was pressed — the refusal is the server's, and
 * the server's is the one that matters, since the CLI writing to the same file enforces it too.
 *
 * THE CONTROLS ARE THE SYSTEM'S. `.field` and `.btn`/`.btn-ghost` come from `foliage.css`, which
 * carries the 44px minimum target, the control-edge boundary (>=3:1, where `--fol-border` is
 * 1.68:1 and would miss WCAG 1.4.11), the focus ring and the disabled treatment. This app used to
 * restate all four in `.review-input`/`.review-btn`; those are retired.
 *
 * BOTH BUTTONS ARE `.btn-ghost`, and neither is `.btn-primary`. Approve and Reject are the same
 * weight on purpose: rejecting is not destructive (it records a reason and keeps the candidate)
 * and approving is not a triumph (it writes a `pending` leaflet). A chartreuse Approve would be
 * the interface leaning on a decision that is the reviewer's to make, and the accent is reserved
 * for "the unfurling moment" — which promoting a machine draft is not.
 *
 * `<label for>` IS REAL, one per control, and the description of the conditional requirement is
 * wired with `aria-describedby` rather than left in a placeholder: a placeholder disappears the
 * moment somebody types, which is exactly when they are deciding what to write.
 *
 * REVIEWER STARTS FILLED, NEVER SILENT. `reviewer` is `declaredReviewer`'s answer — an identity
 * this garden already recorded — and it is only the field's starting value: still `required`,
 * still editable, and still sent with the form, so the server's `missing-reviewer` refusal is the
 * same rule it always was. A refused POST keeps whatever the person typed, even an empty field.
 */
type ReviewDraft = { readonly id: string; readonly by: string; readonly reason: string; readonly title: string };
function decisionForm(candidate: HarvestCandidate, draft: ReviewDraft | null, query: string, reviewer: string): string {
  const id = esc(candidate.id);
  return `<form class="review-form" method="post" action="${REVIEW_ROUTE}">
<input type="hidden" name="id" value="${id}">
<input type="hidden" name="subjectDigest" value="${esc(reviewSubjectDigest(candidate))}">
${query ? `<input type="hidden" name="q" value="${esc(query)}">` : ""}
<div class="review-field">
${ui.label("Reviewer", { className: "fol-label", htmlFor: `by-${candidate.id}` })}
${ui.input({ id: `by-${candidate.id}`, name: "by", defaultValue: draft === null ? reviewer : draft.by, autoComplete: "off", required: true, "aria-describedby": `by-help-${candidate.id}` })}
<p class="aside review-help" id="by-help-${id}">Required</p>
</div>
<div class="review-field">
${ui.label("Reason", { className: "fol-label", htmlFor: `reason-${candidate.id}` })}
${ui.input({ id: `reason-${candidate.id}`, name: "reason", defaultValue: draft?.reason ?? "", autoComplete: "off", "aria-describedby": `reason-help-${candidate.id}` })}
<p class="aside review-help" id="reason-help-${id}">Required to reject</p>
</div>
<details class="review-title-edit"${draft?.title ? " open" : ""}><summary>Edit title</summary><div class="review-field">
${ui.label("New title", { className: "fol-label", htmlFor: `title-${candidate.id}` })}
${ui.input({ id: `title-${candidate.id}`, name: "title", defaultValue: draft?.title ?? "", autoComplete: "off", "aria-describedby": `title-help-${candidate.id}` })}
<p class="aside review-help" id="title-help-${id}">Optional · approve only</p>
</div></details>
<p class="review-safety review-consequence">Added work stays pending; approval does not publish or verify</p>
<div class="review-actions">
${ui.button("Approve", { type: "submit", name: "decision", value: "approve" })}
${ui.button("Reject", { type: "submit", name: "decision", value: "reject" })}
</div>
</form>`;
}

/**
 * The reviewer a new decision starts attributed to: whoever recorded the most recent decision in
 * this harvest, else the leaf's subject (from the leaf, or as the harvest's binding recorded it
 * when the leaf cannot be read), else nobody — an empty, required field. Every one is a name this
 * garden already holds, the plan's "retain a previously declared reviewer identity", and none is
 * guessed: no environment, no account, no machine user name.
 */
function declaredReviewer(harvest: HarvestDocument, index: LeafIndex | null): string {
  let latest: { readonly by: string; readonly at: number } | null = null;
  for (const c of harvest.candidates) {
    if (c.review.state === "candidate") continue;
    const at = Date.parse(c.review.at);
    if (latest === null || at >= latest.at) latest = { by: c.review.by, at };
  }
  return latest?.by ?? (index?.ok === true ? index.subject : harvest.subject) ?? "";
}

/** Where Jev placed an open row, and whether its check may be retried. Labels only: never a number. */
interface RowJev {
  readonly group: QueueGroup;
  readonly retry: boolean;
}
const NO_JEV: RowJev = { group: "open", retry: false };

function jevLabel(group: QueueGroup): string {
  switch (group) {
    case "keep":
      return ` <span class="chip" data-jev-mark="keep">Keep</span>`;
    case "pass":
      return ` <span class="chip" data-jev-mark="pass">Pass</span>`;
    case "open":
      return "";
    default: {
      const impossible: never = group;
      throw new Error(`unhandled queue group: ${JSON.stringify(impossible)}`);
    }
  }
}

/** The owner's own retry of an interrupted or failed Jev check. It checks; it never decides. */
const jevRetryForm = (candidate: HarvestCandidate): string =>
  `<form class="review-form" method="post" action="${JEV_ROUTE}"><input type="hidden" name="action" value="jev-run"><input type="hidden" name="candidate" value="${esc(candidate.id)}">${ui.button("Retry", { type: "submit", variant: "outline" })}</form>`;

/**
 * A CANDIDATE TITLE IS NEVER VERBATIM, unconditionally — this is the one call site with no
 * branch, because there is nothing here that could make it carried.
 *
 * A `HarvestCandidate` has no provenance; it has `evidence[]` and an `extractor`, and the title is
 * what that extractor DRAFTED about the evidence — `${prefix}: N commits` from the deterministic
 * clusterer, or a sentence a local model wrote. `harvestDocument.ts` says it in the domain's own
 * words: "the drafted title is prose a machine wrote". And on this page the machine's draft has
 * not even been approved yet — deciding whether it may stand is the whole purpose of the screen.
 *
 * Marking it `data-verbatim` therefore did two wrong things at once: it attested a machine's prose
 * as the artifact's own words, and it stripped that prose out of the NO SCORE check, which is
 * scoped by exactly this attribute. A model that ignored the "no numbers that read like a score"
 * line in its prompt reached this DOM with the gate lifted off it. Verified by rendering, before
 * and after.
 *
 * One cited source and one captured image or demo lead the decision. The remaining evidence
 * follows it so a 28-commit draft does not put the buttons thousands of pixels below the title.
 * An imported snapshot keeps its supplied text and disclosure entirely before the decision.
 */
function candidateCard(candidate: HarvestCandidate, draft: ReviewDraft | null = null, jev: RowJev = NO_JEV, focusId: string | null = null, refusal: ReviewRefusal | null = null, query = "", reviewer = "", expanded = false): string {
  const decided = candidate.review.state !== "candidate";
  // THE BLADE CARRIES NO TIER. Review rows wear the leaf's blade language (review-blades.html),
  // but the glyph takes no data-frond-tier on purpose: a review state is not a proof tier, and
  // the prototype's decided blades — approved painted verified, rejected painted excluded — are
  // exactly the conflation reviewBadge's comment forbids. State is told by the untinted badge
  // and, mutedly, by the blade's weight (data-review-state on the row), never by a tier hue.
  const focused = candidate.id === focusId;
  const decision = decided
    ? `<p class="review-decision"><span class="fol-label">Decision</span> ${describeReview(candidate.review)}</p>`
    : decisionForm(candidate, draft?.id === candidate.id ? draft : null, query, reviewer);
  // AN IMPORTED SNAPSHOT IS READ BEFORE IT IS DECIDED. Its excerpt is supplied text that promotion
  // carries into the record whole, under identities nobody checked, so its declaration notice and
  // full text keep their place in front of the decision (pinned by integrationReview.test.ts).
  const readFirst = isImportedObservationCandidate(candidate);
  const evidence = candidateEvidence(candidate);
  return `<li id="candidate-${esc(candidate.id)}" class="review-candidate blade-row" data-review-state="${esc(candidate.review.state)}" data-extractor="${esc(candidate.extractor)}"${evidence.imageLed ? ' data-review-media="image"' : ""}${focused ? ' tabindex="-1"' : ""}>
<svg class="lf-blade" aria-hidden="true"><use href="#fol-leaflet"></use></svg>
<details class="review-candidate-disclosure"${focused || expanded ? " open" : ""}>
<summary class="review-candidate-summary"${focused && refusal !== null ? ' autofocus aria-describedby="review-refusal"' : ""}>
<span class="review-title" data-authored="drafted-title">${esc(candidate.title)}</span>
<span class="review-standing">${reviewBadge(candidate.review.state)}${decided ? "" : jevLabel(jev.group)}
<span class="review-ref-count">${esc(reviewSource(candidate))} · <span class="fol-metric">${candidate.evidence.length}</span> ${candidate.extractor === "git-cluster" ? candidate.evidence.length === 1 ? "commit" : "commits" : referenceNoun(candidate.evidence.length)}</span></span>
</summary>
<div class="review-candidate-body">
${focused && refusal !== null ? `<p class="review-inline-error">${refusalMessage(refusal)}</p>` : ""}
${readFirst ? `${evidence.lead}${evidence.rest}` : `<div class="review-decision-layout">${evidence.lead}${decision}</div>${evidence.rest}`}
<details class="review-technical"><summary>Technical details</summary><dl class="review-meta">
<div><dt class="fol-label">Id</dt><dd class="fol-metric">${esc(candidate.id)}</dd></div>
<div><dt class="fol-label">Extractor</dt><dd class="fol-metric">${esc(candidate.extractor)}</dd></div>
<div><dt class="fol-label">Drafted</dt><dd class="fol-metric"><time datetime="${esc(
    candidate.draftedAt,
  )}">${esc(candidate.draftedAt)}</time></dd></div>
</dl></details>
${candidatePack(candidate)}
<p class="review-inspect">${ui.link("Inspect", { href: `${SCARLET_WORKSPACE_ROUTE}?candidate=${encodeURIComponent(candidate.id)}` })}</p>
${!decided && jev.retry ? jevRetryForm(candidate) : ""}
${readFirst ? decision : ""}
</div>
</details>
</li>`;
}

/**
 * The counts. Per state, never combined, and in the order the format declares its states —
 * a grouping, exactly as the tier cells are. Nothing here is a ratio and nothing is a rating of
 * the extractor that drafted them.
 */
function reviewCounts(harvest: HarvestDocument): string {
  const counts = { candidate: 0, approved: 0, rejected: 0 };
  for (const c of harvest.candidates) counts[c.review.state]++;
  const cells = (["candidate", "approved", "rejected"] as const)
    .map(
      (state) => `<span class="review-count-item" data-review-count="${state}">
<span class="fol-label">${esc(REVIEW_STATE_LABEL[state])}</span>
<b class="fol-metric leaf-count">${counts[state]}</b>
</span>`,
    )
    .join("\n");
  return `<div class="review-count-line" aria-label="Review decisions">
${cells}
</div>`;
}

function reviewShell(opts: {
  readonly state: string;
  readonly empty: boolean;
  readonly body: string;
}): string {
  return page({
    title: "Foliage — review queue",
    state: opts.state,
    surface: "review",
    empty: opts.empty,
    face: "night",
    chrome: "Foliage — review queue",
    nav: "review",
    body: opts.body,
  });
}

/**
 * The closed Technical details under a file the owner has to repair: which file, and — for one
 * that would not read or parse — what the loader saw there (the OS error, or where the JSON
 * breaks), which is what makes "repair it" something a person can do. The loader's `detail` opens
 * with the absolute path; the path is shown once, through `pathChip`, and the loader's reason
 * follows it. `extra` is the field list of a file that parsed but failed validation.
 */
function repairDetails(
  file: string,
  load: { readonly cause: string; readonly path: string; readonly detail: string },
  extra = "",
): string {
  const after = load.detail.startsWith(load.path) ? load.detail.indexOf(": ", load.path.length) : -1;
  const reason = load.cause === "unreadable" || load.cause === "malformed"
    ? after >= 0 ? load.detail.slice(after + 2) : load.detail
    : "";
  return `<details class="review-technical"><summary>Technical details</summary><p>${file} ${pathChip(load.path)}</p>${
    reason ? `<p class="fol-metric">${esc(reason)}</p>` : ""
  }${extra}</details>`;
}

/**
 * A record that did not load, said for a closed Technical details: the file and what the loader
 * saw, when that file is the thing to repair. Empty when there is no file yet — nothing to repair,
 * and the page's next step is to start one.
 */
export function leafLoadTechnical(load: Extract<LeafLoad, { ok: false }>): string {
  return load.cause === "unconfigured" || load.cause === "absent" ? "" : repairDetails("Leaf file", load);
}

/** The Technical details a read-failure page shows for what it caught: only a failed record load has any. */
export function technicalFor(error: unknown): string {
  return error instanceof LeafLoadError ? leafLoadTechnical(error.load) : "";
}

/**
 * The queue cannot be shown: the cause, the next step, and — only when the draft file itself needs
 * repair — where that file is, in a closed disclosure. A first run (`absent`) has nothing to repair
 * and its next step is Sources; a file that will not read is fixed on disk and then reloaded, so
 * that page offers Reload, not a detour through Sources.
 */
function reviewFailure(load: Extract<HarvestLoad, { ok: false }>, banner = ""): string {
  const remedy: Readonly<Record<Extract<HarvestLoad, { ok: false }>["cause"], string>> = {
    unconfigured: "",
    absent: "",
    unreadable: "Check the draft file's permissions, then reload.",
    malformed: "Correct the draft file, then reload. It holds your decisions; repair it rather than delete it.",
    invalid: "Repair the fields listed under Technical details, then reload.",
  };
  const repair = load.cause === "unreadable" || load.cause === "malformed" || load.cause === "invalid";
  const technical = repair
    ? repairDetails("Draft file", load, load.cause === "invalid"
        ? `<ul class="leaf-issues">${load.issues
            .map(i => `<li><span class="fol-metric leaf-issue-at">${esc(i.at)}</span> ${esc(i.message)}</li>`)
            .join("\n")}</ul>`
        : "")
    : "";
  return reviewShell({
    state: load.cause,
    empty: false,
    body: `${banner}
<section class="leaf-state" data-leaf-plate="${esc(load.cause)}" aria-labelledby="leaf-state-h">
<div class="plate">
<svg class="ico" aria-hidden="true"><use href="#i-alert"></use></svg>
<h1 class="plate-t" id="leaf-state-h">${esc(HARVEST_LOAD_LABEL[load.cause])}</h1>
</div>
${remedy[load.cause] ? `<p class="aside">${remedy[load.cause]}</p>` : ""}
${repair ? ui.link("Reload", { href: REVIEW_ROUTE }) : ui.link("Sources", { href: "/workflow#sources" })}
${technical}
</section>`,
  });
}

/**
 * A decision arrived and there was no document to record it in. The page is the load's own failure
 * page — the five causes are already written there, each with its remedy — under a banner saying
 * the thing only a WRITE can say: that nothing was recorded.
 *
 * It is stated rather than implied. The failure page alone reads as an account of the queue's
 * state, and a reviewer who has just pressed Approve is not reading it as a verdict on their
 * press. `role="alert"` because it appears in response to their action, and it reuses the same
 * `.review-refusal` element the named refusals use, because it is the same fact — nothing was
 * written — and a second element would need a second style to say one thing twice.
 */
export function renderReviewWriteRefused(
  load: Extract<HarvestLoad, { ok: false }>,
  outcome = "Decision not recorded",
): string {
  return reviewFailure(
    load,
    `<aside class="review-refusal" role="alert" data-refusal="${esc(load.cause)}" data-written="none">
<strong class="fol-label">Nothing was written</strong>
<span>${esc(outcome)}</span>
</aside>`,
  );
}

/**
 * Why "Add N to leaf" added nothing, once the drafts themselves were read. Each carries what its
 * page needs and nothing more; a file path rides along only where repairing that file is the way
 * on, and it is shown only inside the page's closed Technical details.
 */
export type PromoteRefusal =
  | { readonly cause: "leaf-unavailable"; readonly load: Extract<LeafLoad, { ok: false }>; readonly harvest: HarvestDocument }
  | { readonly cause: "cell-authority-refused"; readonly reason: string }
  | {
      readonly cause: "binding-mismatch";
      readonly mismatches: readonly { readonly field: string; readonly harvestValue: string; readonly leafValue: string }[];
      readonly harvestPath: string;
      readonly leafPath: string;
    }
  | { readonly cause: "document-busy"; readonly detail: string };

/**
 * A record the promote panel could not read, as the server hands it over: the sentence, and the
 * load itself. The panel reads everything else from the load's cause — a MISSING record (absent)
 * leads to creating one, a file to repair is named under Technical details — so there is no second
 * marker for "missing" to disagree with it.
 */
export type LeafIndexUnavailable = Extract<LeafIndex, { ok: false }> & { readonly load: Extract<LeafLoad, { ok: false }> };

/** The one action that creates the missing record, as a button; the panel and a refused Add share it. */
const CREATE_RECORD_LINK = `<a class="fol-button fol-button-primary" href="${CREATE_RECORD.href}">${CREATE_RECORD.text}</a>`;

/**
 * A refused promotion as a page in the app's own layout: what stopped it, that nothing was added,
 * the next step, and the way back to the queue. It was a text/plain body naming both documents'
 * absolute paths — a dead end in the browser for the one button that writes the record.
 */
export function renderPromoteRefused(refusal: PromoteRefusal): string {
  const back = `<p><a href="${REVIEW_ROUTE}#review-promote-h">Back to review</a></p>`;
  const technical = (rows: string): string =>
    `<details class="review-technical"><summary>Technical details</summary>${rows}</details>`;
  let heading: string;
  let next: string;
  let action = "";
  let detail = "";
  switch (refusal.cause) {
    case "leaf-unavailable": {
      // The cause chooses the step, as on the promote panel. A record that is MISSING is created
      // (the panel's own action and words, and only the add it can honestly promise follows). One
      // that exists is repaired, never replaced: a file that will not read or parse is fixed on
      // disk, and what that takes — the file and what the loader saw — waits under this page's
      // Technical details; only an invalid one has a Portfolio page listing what to fix. A record
      // location that is not set can be neither created nor added to, so that page leads nowhere.
      const { load } = refusal;
      heading = load.cause === "absent" ? "No private record yet" : LEAF_LOAD_LABEL[load.cause];
      detail = leafLoadTechnical(load);
      switch (load.cause) {
        case "absent": {
          const approved = refusal.harvest.candidates.filter((c) => c.review.state === "approved").length;
          next = approved === 0 ? "Create your private record first." : addAfterCreate(refusal.harvest, approved, "from Review");
          action = CREATE_RECORD_LINK;
          break;
        }
        case "unconfigured":
          next = `${leafLoadProblem(load)} Then add your approved drafts again.`;
          break;
        case "invalid":
          next = "Repair your private record, then add your approved drafts again. Portfolio lists what to fix.";
          action = ui.link("Open Portfolio", { href: "/leaf" });
          break;
        case "malformed":
          next = "Correct the file, then add your approved drafts again.";
          break;
        case "unreadable":
          next = "Check the file's permissions, then add your approved drafts again.";
          break;
        default: {
          const impossible: never = load;
          throw new Error(`unhandled load cause: ${JSON.stringify(impossible)}`);
        }
      }
      break;
    }
    case "cell-authority-refused":
      heading = "These drafts are added from the command line";
      next = "Some approved drafts come from cells, which this page cannot check. Add them with the cells command.";
      detail = technical(`<p>${esc(refusal.reason)}</p>`);
      break;
    case "binding-mismatch":
      heading = "These drafts were collected for another record";
      next = "Open the record these drafts were collected for, or collect again for this one.";
      detail = technical(`<dl class="review-meta">${refusal.mismatches
        .map((m) => `<div><dt class="fol-label">${esc(m.field)}</dt><dd>Drafts: ${esc(m.harvestValue)} · This record: ${esc(m.leafValue)}</dd></div>`)
        .join("")}</dl><p>Draft file ${pathChip(refusal.harvestPath)}</p><p>Leaf file ${pathChip(refusal.leafPath)}</p>`);
      break;
    case "document-busy":
      heading = "Another save is still running";
      next = "Try again in a moment.";
      detail = technical(`<p class="fol-metric">${esc(refusal.detail)}</p>`);
      break;
    default: {
      const impossible: never = refusal;
      throw new Error(`unhandled promote refusal: ${JSON.stringify(impossible)}`);
    }
  }
  return reviewShell({
    state: "promote-refused",
    empty: false,
    body: `<aside class="review-refusal" role="alert" data-refusal="${esc(refusal.cause)}" data-written="none">
<strong class="fol-label">Nothing was written</strong>
<span>Nothing added to your record</span>
</aside>
<section class="leaf-state" data-leaf-plate="promote-refused" aria-labelledby="leaf-state-h">
<div class="plate">
<svg class="ico" aria-hidden="true"><use href="#i-alert"></use></svg>
<h1 class="plate-t" id="leaf-state-h">${esc(heading)}</h1>
</div>
<p class="aside">${esc(next)}</p>
${action}
${back}
${detail}
</section>`,
  });
}

/**
 * Render the queue. Total over `HarvestLoad`, and over the refusal that a POST may have produced.
 *
 * The refusal is rendered ON the queue rather than as its own page: a reviewer who forgot a reason
 * needs the candidate, the form and their own words in front of them, not a dead end with a back
 * button. `role="alert"` because it appears in response to their action.
 */
/**
 * The panel that carries approved candidates into the leaf, or the honest reason there is nothing
 * to carry.
 *
 * WHAT IT DELIBERATELY IS NOT. The surface note above this file says a queue that read like a
 * publish button would be the product overclaiming in its own UI, and that stands. This is not
 * that button: promotion appends `pending` leaflets to a LOCAL document, and publishing is a
 * separate act against a different gate entirely. The copy says so in the same breath as the
 * control, because a button whose caption omits what it does not do is the overclaim arriving by
 * another route.
 *
 * Every number here is counted from the two documents at render time. Nothing is carried over
 * from the POST that may have just run.
 */
function promotePanel(harvest: HarvestDocument, index: LeafIndex | LeafIndexUnavailable | null): string {
  const approved = harvest.candidates.filter((c) => c.review.state === "approved");
  // Nothing approved: say nothing. An empty control with a zero on it invites a click that would
  // do nothing, and the queue above already reports the states.
  if (approved.length === 0) return "";

  // The cause of an unread record, from the load itself (a bare index has none).
  const load = index !== null && !index.ok && "load" in index ? index.load : null;

  // NO RECORD YET IS NOT A FAILURE TO REPORT: it is the step before this one. Still the
  // unavailable plate (nothing can be added), but it names the record step instead of a cause.
  // Approved drafts stay approved, and this same panel adds them once the record exists. Only a
  // record that is MISSING is created: a broken one is repaired below and never replaced, and an
  // unset location (`unconfigured`) can be neither created nor added to, so it promises neither.
  if (load?.cause === "absent") {
    return `<section class="review-promote" aria-labelledby="review-promote-h">
<h2 id="review-promote-h">Your record</h2>
<p data-leaf-plate="promote-unavailable">No private record yet · <span class="fol-metric">${approved.length}</span> approved</p>
<p class="aside">${esc(addAfterCreate(harvest, approved.length, "here", false))}</p>
<p>${CREATE_RECORD_LINK}</p>
</section>`;
  }

  if (index === null || !index.ok) {
    const detail = index === null ? "No leaf document configured" : index.detail;
    // The same split as a refused promotion: Portfolio where it holds the step (the fields to
    // repair), the file and what the loader saw where that file is repaired on disk, and no link
    // at all where the location is not set — Portfolio has nothing to add to the sentence.
    const onDisk = load !== null && (load.cause === "malformed" || load.cause === "unreadable");
    const unset = load !== null && load.cause === "unconfigured";
    return `<section class="review-promote" aria-labelledby="review-promote-h">
<h2 id="review-promote-h">Your record</h2>
<div class="plate" data-leaf-plate="promote-unavailable">
<h3 class="plate-t">${approved.length} approved · no leaf</h3>
<p class="plate-b">${esc(detail)}</p>
</div>
${onDisk || unset ? "" : `<a href="/leaf">Open Portfolio</a>`}${load === null ? "" : leafLoadTechnical(load)}
</section>`;
  }

  const waiting = approvedNotInLeaf(harvest, index.ids);
  const already = approved.length - waiting.length;
  const settled =
    already === 0
      ? ""
      : `<p class="aside">${already} already in your record</p>`;

  if (waiting.length === 0) {
    return `<section class="review-promote" aria-labelledby="review-promote-h">
<h2 id="review-promote-h">Your record</h2>
<p class="review-promotion-done" data-leaf-plate="promote-done"><svg class="ico" aria-hidden="true"><use href="#i-check"></use></svg><span>All approved are in the leaf</span> <a href="/leaf/photosynthesis">View work</a></p>
</section>`;
  }

  // The caveat under the button stays a full sentence and stays VISIBLE. A control captioned
  // "Carry N into the leaf" with the "does not publish" line one click away is the overclaim
  // arriving by another route — the reader presses the button, not the drawer.
  return `<section class="review-promote" aria-labelledby="review-promote-h">
<h2 id="review-promote-h">Your record</h2>
<p>${waiting.length} waiting · added as <span class="fol-metric">pending</span></p>
<p class="aside"><strong>Does not publish anything and does not verify anything</strong></p>
${settled}
<form class="review-form review-promote-form" method="post" action="${PROMOTE_ROUTE}">
<button class="btn btn-primary" type="submit">Add ${waiting.length} to leaf</button>
</form>
<details class="review-technical"><summary>Technical details</summary>${pathChip(index.path)}</details>
</section>`;
}

/**
 * What orders the queue beyond the harvest itself. `marks` are Jev's private outcomes for drafts
 * whose check is current; `retry` names the drafts whose check was interrupted or failed;
 * `paused` hides the undecided git drafts while every collection source is paused. All private to
 * this page: they place rows and never reach a leaf or an export.
 */
export interface ReviewQueueView {
  readonly marks: ReadonlyMap<string, JevMark>;
  readonly retry: ReadonlySet<string>;
  readonly paused: boolean;
}
const UNORDERED_VIEW: ReviewQueueView = { marks: new Map(), retry: new Set(), paused: false };
const REVIEW_VISIBLE_BATCH = 20;

/** The open candidates in queue order, then everything decided, collapsed. */
function reviewQueueList(harvest: HarvestDocument, draft: ReviewDraft | null, view: ReviewQueueView, focusId: string | null, refusal: ReviewRefusal | null, query: string, reviewer: string): string {
  const visible = shownQueue(harvest.candidates, view.paused);
  // A refused write must leave its draft reachable even if collection was paused between the
  // form being shown and the submission. This changes only the response view, never the queue.
  const focusedHidden = focusId === null || visible.shown.some((candidate) => candidate.id === focusId)
    ? null
    : harvest.candidates.find((candidate) => candidate.id === focusId) ?? null;
  const shown = focusedHidden === null ? visible.shown : [...visible.shown, focusedHidden];
  const hidden = visible.hidden - (focusedHidden === null ? 0 : 1);
  const ordered = orderReviewQueue(shown, view.marks);
  const search = query.trim().slice(0, 200);
  const term = search.toLocaleLowerCase();
  const matches = (candidate: HarvestDocument["candidates"][number]) =>
    `${candidate.id} ${candidate.title} ${candidate.extractor} ${candidate.evidence.map((reference) => `${reference.source} ${reference.ref}`).join(" ")}`.toLocaleLowerCase().includes(term);
  const selected = (candidate: HarvestDocument["candidates"][number]) => candidate.id === focusId;
  const open = term ? ordered.open.filter((entry) => matches(entry.candidate) || selected(entry.candidate)) : ordered.open;
  const matchedDecided = term ? ordered.decided.filter((candidate) => matches(candidate) || selected(candidate)) : ordered.decided;
  const matchedCount = term
    ? ordered.open.filter((entry) => matches(entry.candidate)).length + ordered.decided.filter(matches).length
    : 0;
  const selectedOutsideSearch = term && open.length + matchedDecided.length > matchedCount;
  const renderOpen = (entry: (typeof ordered.open)[number], expanded = false): string =>
    candidateCard(entry.candidate, draft, { group: entry.group, retry: view.retry.has(entry.candidate.id) }, focusId, refusal, search, reviewer, expanded);
  const older: string[] = [];
  for (let from = REVIEW_VISIBLE_BATCH; from < open.length; from += REVIEW_VISIBLE_BATCH) {
    const batch = open.slice(from, from + REVIEW_VISIBLE_BATCH);
    const through = from + batch.length;
    older.push(`<details class="review-more" data-review-more${batch.some((entry) => entry.candidate.id === focusId) ? " open" : ""}>
<summary>More drafts <span class="fol-metric">${from + 1}–${through}</span></summary>
<ul class="review-list leaf-list" data-review-open-more>
${batch.map((entry) => renderOpen(entry)).join("\n")}
</ul>
</details>`);
  }
  const decided = matchedDecided.length === 0
    ? ""
    : `<details class="review-decided" data-review-decided${term || matchedDecided.some((candidate) => candidate.id === focusId) ? " open" : ""}>
<summary>Decided (<span class="fol-metric">${matchedDecided.length}</span>)</summary>
<ul class="review-list leaf-list">
${matchedDecided.map((candidate) => candidateCard(candidate, draft, NO_JEV, focusId, refusal, search)).join("\n")}
</ul>
</details>`;
  const find = ordered.open.length + ordered.decided.length > REVIEW_VISIBLE_BATCH || term
    ? `<form class="review-find" method="get" action="/review"><label for="review-find-input">Find drafts</label>${ui.input({ id: "review-find-input", name: "q", type: "search", defaultValue: search, maxLength: 200, autoComplete: "off" })}${ui.button("Find", { type: "submit", variant: "outline" })}</form>`
    : "";
  const result = term ? `<p class="review-find-result" role="status"><span class="fol-metric">${matchedCount}</span> ${matchedCount === 1 ? "match" : "matches"}${selectedOutsideSearch ? " · Selected record shown" : ""}${matchedCount === 0 ? ' · <a href="/review">Clear search</a>' : ""}</p>` : "";
  const findBefore = term || open.length > 5;
  return `<div class="review-heading-line"><h2 id="review-queue-h"><span class="fol-metric">${ordered.open.length}</span> to review</h2>
<p class="review-access">Local access by default · No sign-in</p><details class="review-about"><summary>Review decisions</summary>${reviewCounts(harvest)}</details></div>
${findBefore ? find : ""}${result}
${hidden > 0 ? `<p class="aside" data-queue-paused>Paused <span class="fol-metric">${hidden}</span></p>` : ""}
<ul class="review-list leaf-list" data-review-open>
${open.slice(0, REVIEW_VISIBLE_BATCH).map((entry, index) => renderOpen(entry, index === 0 && focusId === null)).join("\n")}
</ul>
${findBefore ? "" : find}
${older.join("\n")}
${decided}`;
}

/**
 * What the decision just recorded did, said on the page the reviewer lands on next.
 *
 * THE REDIRECT CARRIES ONLY AN ID; THE SENTENCE IS READ BACK. Same rule as `LeafIndex`: a
 * "1 approved waiting" passed through the URL would be a number nobody measured. The state and
 * title come from the harvest and the waiting count from `approvedNotInLeaf` against the leaf, so
 * an edited URL can at most name a decision the document really holds, and an id that is still
 * undecided, or names nothing, gets no line at all. `role="status"`: nothing failed. The count
 * links to the promote panel, the one place approved work becomes part of the record, and only a
 * leaf that was read gives one: without it the line names the decision alone, and the panel below
 * says why nothing can be added.
 */
function decisionStatus(harvest: HarvestDocument, index: LeafIndex | null, decidedId: string | null): string {
  const decided = decidedId === null ? undefined : harvest.candidates.find((c) => c.id === decidedId);
  if (decided === undefined || decided.review.state === "candidate") return "";
  const waiting = index?.ok === true ? approvedNotInLeaf(harvest, index.ids).length : 0;
  return `<p id="review-status" class="review-status" role="status" data-review-decided="${esc(decided.review.state)}">
<strong>${esc(REVIEW_STATE_LABEL[decided.review.state])}:</strong> <span data-authored="drafted-title">${esc(decided.title)}</span>${
    waiting > 0
      ? ` · <a href="#review-promote-h"><span class="fol-metric">${waiting}</span> approved waiting to add to your record</a>`
      : ""
  }
</p>`;
}

export function renderReviewPage(
  load: HarvestLoad,
  refusal: ReviewRefusal | null = null,
  index: LeafIndex | LeafIndexUnavailable | null = null,
  promoteNotice: PromoteNotice | null = null,
  draft: ReviewDraft | null = null,
  view: ReviewQueueView = UNORDERED_VIEW,
  query = "",
  selectedId: string | null = null,
  decidedId: string | null = null,
): string {
  if (!load.ok) return reviewFailure(load);

  const empty = load.harvest.candidates.length === 0;
  const requestedId = refusal === null ? selectedId : "id" in refusal ? refusal.id : draft?.id ?? null;
  // GET focus may open a visible draft or recorded decision, never a paused source draft.
  // POST refusals still reopen their own draft so the reviewer can recover.
  const focusable = refusal === null ? shownQueue(load.harvest.candidates, view.paused).shown : load.harvest.candidates;
  const focusId = requestedId !== null && focusable.some((candidate) => candidate.id === requestedId)
    ? requestedId
    : null;
  // The banner sits above the queue, away from the card, so it names the draft by its title. A
  // busy document's own words name the lock file — recovery for a lock left behind — so they wait
  // in a closed disclosure rather than in the sentence.
  const refusedTitle = refusal !== null && "id" in refusal
    ? load.harvest.candidates.find((candidate) => candidate.id === refusal.id)?.title
    : undefined;
  const banner =
    refusal === null
      ? ""
      : `<aside id="review-refusal" class="review-refusal" role="alert" data-refusal="${esc(refusal.cause)}">
<strong class="fol-label">Nothing was written</strong>
<p>${refusalMessage(refusal, refusedTitle)}</p>
${focusId === null ? "" : ui.link("Review draft", { href: `#candidate-${encodeURIComponent(focusId)}` })}
${refusal.cause === "document-busy" && refusal.detail ? `<details class="review-technical"><summary>Technical details</summary><p class="fol-metric">${esc(refusal.detail)}</p></details>` : ""}
</aside>`;
  // F-014, blocker 2: the web operator sees exactly what the CLI operator sees for the identical
  // outcome — a promote DID just write, and it did so without checking a binding, because the
  // harvest it read carries none. `role="status"`, not `role="alert"`: nothing failed here.
  const promoteBanner =
    promoteNotice === null
      ? ""
      : `<aside class="review-refusal" role="status" data-promote-notice="${esc(promoteNotice)}">
<strong class="fol-label">Unbound document — binding not checked</strong>
</aside>`;

  const intro = `<section class="review-intro">
<h1>Review queue</h1>
</section>`;

  const body = empty
    ? `${banner}${promoteBanner}
${intro}
<section class="review-empty" data-leaf-plate="empty-queue" aria-labelledby="review-empty-h">
<div class="plate">
<svg class="ico" aria-hidden="true"><use href="#i-check"></use></svg>
<h2 class="plate-t" id="review-empty-h">Nothing to review</h2>
</div>
${ui.link("Sources", { href: "/workflow#sources" })}
</section>`
    : `${banner}${promoteBanner}${decisionStatus(load.harvest, index, decidedId)}
${intro}
<section class="review-queue" aria-labelledby="review-queue-h">
${reviewQueueList(load.harvest, draft, view, focusId, refusal, query, declaredReviewer(load.harvest, index))}
</section>
${promotePanel(load.harvest, index)}`;
  return reviewShell({ state: "ok", empty, body });
}
