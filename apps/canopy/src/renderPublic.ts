import { ui } from "@foliage/ui";
/**
 * THE TWO PAGES A RECRUITER ACTUALLY LANDS ON.
 *
 *   GET /leaf/<id>      one person's PUBLISHED work
 *   GET /leaflet/<id>   one PUBLISHED artifact — the page somebody forwards to a board
 *
 * ------------------------------------------------------------------------------------------
 * PRECEDENCE AT /leaf/:id — decision D2 plus its 2026-08-27 addendum (`.loop/MERGE-DECISIONS.md`):
 * a FROZEN PUBLISHED ARTIFACT (`publishedLeaf.ts` + `renderPublished.ts`), when one exists for
 * the id, is the page a stranger receives — the owner's D2. This module's live re-projection
 * answers only when NO artifact exists (a broken artifact is refused, never downgraded to a
 * projection), which keeps the tree→person→artifact walk alive for a subject who offered
 * leaflets with `share --as` but never crossed a whole document. The precedence itself lives in
 * `server.mjs`'s /leaf/ handler; do not add a second route to these renderers.
 *
 * MEASURED BEFORE THIS FILE EXISTED, 2026-08-19: `apps/canopy/server.mjs` routed `/` and `/tree`
 * and nothing else. The canopy could name a person on a roster and had no page to send a reader
 * to, so the whole chain terminated one link short of the artifact it exists to publish.
 *
 * ------------------------------------------------------------------------------------------
 * THE ONE RULE THIS MODULE IS BUILT AROUND: IT CANNOT REACH A PRIVATE LEAFLET.
 *
 * `Tree.leaves` holds whole `Leaf` documents, and a leaf document is a person's ENTIRE
 * portfolio — the `pending` work they have not proven, the `excluded` work that turned out to
 * be somebody else's, and every leaflet they never offered anyone. A renderer handed that list
 * publishes all of it the moment somebody writes an innocent-looking `.map`. Measured on a fresh
 * intake of this repository, that is all 40 leaflets, every one of them `private` by default.
 *
 * So THIS FILE NEVER READS `leaf.leaflets`. Not once, not defensively, not "just to count". The
 * only sets it can see are the ones `@foliage/canopy`'s public projection hands back —
 * `PublicLeaf.listed` and the single result of `findPublicLeaflet` — both of which have already
 * had the subject's visibility gate AND the tier gate applied by the domain that owns those
 * rules. A grep for `.leaflets` in this file is a review failure, and `renderPublic.test.ts`
 * asserts the absence mechanically rather than trusting the grep to be run.
 *
 * ------------------------------------------------------------------------------------------
 * TWO CONSENTS, TWO CODE PATHS, AND THAT IS WHY THE ARTIFACT ADDRESS TAKES AN OPTIONAL `?leaf=`.
 *
 * `@foliage/leaf` splits sharing into two questions that a boolean would collapse: may this be
 * handed to whoever holds the LINK (`unlisted`), and may it additionally be ENUMERATED
 * (`public`). The projection carries that split into the cloud plane — the browse view has no
 * field an unlisted leaflet can reach, and the single-artifact lookup takes the raw document.
 * This module keeps them in separate routes so the two cannot be crossed by accident:
 *
 *   /leaflet/<id>                a BROWSE address. Answered only from `PublicLeaf.listed` — the
 *                                enumerable set. An unlisted leaflet is invisible here, exactly
 *                                as it is invisible in a roster and in a count.
 *   /leaflet/<id>?leaf=<leafId>  a LINK address, qualified by whose leaf it is. Answered by
 *                                `findPublicLeaflet` against that one document, so an unlisted
 *                                leaflet can be served to someone who was given the link.
 *
 * THE QUALIFIER IS NOT AN ACCESS CONTROL AND GRANTS NOTHING. Both paths run the domain's gates;
 * a wrong, absent or unparseable `leaf` produces the identical refusal. What it buys is that
 * every artifact HAS an address at all — see `resolvePublicLeaflet` for the collision that
 * forces it.
 *
 * ------------------------------------------------------------------------------------------
 * A PRIVATE ID AND AN ABSENT ID MUST BE INDISTINGUISHABLE, and here that is a byte-for-byte
 * claim rather than an intention. `findPublicLeaflet` answers `not-reachable` for "no such id",
 * "private", "unlisted and you guessed it", and "offered but not verified" alike; this module
 * renders one page for that one cause, carrying nothing but the id the requester already had.
 * The test compares the served bytes of a real private id against a real absent one with the id
 * substituted out and requires them equal — an assertion, not a promise, because the failure it
 * guards against is somebody enumerating a portfolio by trying ids until the wording changed.
 *
 * ------------------------------------------------------------------------------------------
 * EVERY FIGURE THESE PAGES PRINT, swept as part of C3 and recorded so the audit is not re-derived.
 * The rule the sweep applies is `/tree`'s rule 2 — A PUBLIC SURFACE MAY ONLY COUNT WHAT IT MAY
 * SHOW, because a count discloses existence — and each survives it:
 *
 *   `PublicLeaf.listed.length`   "Artifacts", and the page is showing every one of them
 *                                immediately below the number. The leaf's own size is never
 *                                stated: "3 of 47" tells a reader about 44 artifacts this person
 *                                did not offer them.
 *   `describeValue`'s `v.length` Inside "an array of N", describing an UNREADABLE field of an
 *                                artifact that already passed both gates. It is a fact about the
 *                                thing being shown, not about a set being withheld.
 *
 * Nothing here reads a raw portfolio to produce any of them. `load.tree.leaves` is touched in
 * exactly one place — `resolvePublicLeaflet`'s qualified path, to find ONE named document for the
 * domain to gate — and what is taken from it is an index, never a length.
 *
 * ------------------------------------------------------------------------------------------
 * DENSITY — `CLAUDE.md` is the contract for anything rendered, and it overrides the comment
 * discipline the rest of this file is written in. MEASURED ON THE REAL RENDERED PAGES BEFORE THIS
 * PASS, 2026-08-19: `/leaf/<id>` listing eight real artifacts was 256 words, of which 145 were
 * prose about how the page works; `/leaflet/<id>` on one artifact was 132 words, of which 93 were.
 * A recruiter lands here cold, does not care how it works, and will not read an essay about proof
 * tiers before looking at somebody's work.
 *
 * NO EXPLANATIONS ON THE PAGE (owner, 2026-09-27). The design reasoning this surface used to argue
 * on itself — why the leaf's own size is not stated, why a private id and an absent one answer
 * identically, why one id can name two artifacts — lives in these comments and nowhere else.
 *
 * WHAT MAY NEVER MOVE, at any density, because a reader would be MISLED by its absence: the
 * fabrication band, the example-document marker, and `TIER_STANDING[...].fact` — above all
 * `pending`'s, which is the sentence saying authorship is NOT cryptographically established. This
 * is the PUBLIC plane; a reader who cannot see that sentence infers proof that does not exist.
 * `renderPublic.test.ts` asserts each of them is present AND outside every `<details>`. The one
 * disclosure left is `tierStanding` on a person's list, which holds the same `fact` the artifact
 * page prints in the open.
 *
 * ------------------------------------------------------------------------------------------
 * DESIGN. Day face (paper): this is the public plane, and night is for instrument surfaces.
 * Every component is `@foliage/tokens`' — `.cell`, `.metric`, `.plate`, `.proof`, `.aside` — and
 * the page chrome is `tree.css`, which the shell links in the one fixed order. The accent
 * appears at most twice per screen and neither of these pages spends it more than once: the
 * plane band's 7px dot. It is deliberately NOT spent on the `verified` badge, which takes
 * `--fol-verified-day` (#1A6344) rather than the chartreuse — measured, the accent is 1.68:1 on
 * paper and would be illegible as text at the badge's 11px.
 */

import { GIT_SOURCE, PROOF_TIERS, type Provenance } from "@foliage/leaf";
import {
  findPublicLeaflet,
  projectTree,
  redactPublicationText,
  type PublicLeaf,
  type PublicTree,
  type ReachableLeaflet,
} from "@foliage/canopy";

import { disclose, esc, glyph, publicLeafHref, publicLeafletHref, shell } from "./renderTree.ts";
import { documentName, withoutMachinePath } from "./publicPath.ts";
import {
  fabricationSignals,
  httpStatusFor,
  type LeafSource,
  type TreeLoad,
  type TreeSource,
} from "./treeDocument.ts";

/**
 * Human wording for each tier. Nothing here implies an order.
 *
 * Exported so `renderPublished.ts` — the OTHER surface that prints a tier to a stranger — quotes
 * this rather than keeping a second copy: two spellings of "Pending" is how one of them goes
 * stale while a reader keeps trusting the other.
 */
export const TIER_LABEL: Readonly<Record<(typeof PROOF_TIERS)[number], string>> = Object.freeze({
  verified: "Verified",
  pending: "Pending",
  excluded: "Excluded",
});

/**
 * The glyph each tier takes. Distinguishable by SHAPE and not only by hue — a check, an open
 * arc, a bar — which is WCAG 1.4.1 and is also what makes the badge survive the greyscale print
 * a portfolio eventually gets. None of the three is bigger, heavier or brighter than the others.
 */
const TIER_ICON: Readonly<Record<(typeof PROOF_TIERS)[number], string>> = Object.freeze({
  verified: "i-check",
  pending: "i-partial",
  excluded: "i-exclude",
});

/**
 * WHAT THIS SURFACE IS ALLOWED TO CLAIM OF A TIER — addressed to a reader who is NOT the subject.
 *
 * `apps/leaf/src/render.ts` carries its own `TIER_MEANING` and this is deliberately not a copy of
 * it. That one defines the vocabulary for the person whose portfolio it is, on their own machine,
 * across all three tiers, because their own page shows all three. This one speaks to a stranger
 * about an artifact somebody handed them, and its job is the narrower one of saying what the word
 * does NOT promise. Two audiences, two sentences, no shared string to drift.
 *
 * ONE FIELD, `fact`: what a reader would be MISLED without, and nothing else. The reasoning that
 * used to sit beside it was cut (owner, 2026-09-27: no explanations on the page). `pending.fact` is
 * the sentence this whole product turns on, so it is the one that may never move: a reader who
 * cannot see "authorship is NOT cryptographically established" is being shown an unproven
 * artifact on a public page with nothing saying so.
 *
 * THE MAP STAYS TOTAL OVER `PROOF_TIERS` even though `excluded` cannot be reached here, and the
 * comment that used to sit in this place had already gone stale — it said `verified` was the only
 * reachable key, which was true under a tier gate the domain has since removed. Today's gate is
 * `isReachableByLink`/`isListable`, which asks whether the subject offered the work and whether it
 * is theirs, and NOT how strongly proven it is; a `pending` artifact its subject published is
 * listed here with its tier shown. So two keys are live and one is not, and hardcoding either
 * consequence would render nothing at all the day the rule moves again. The unreachable entry is
 * written honestly rather than left as a placeholder.
 */
export const TIER_STANDING: Readonly<
  Record<(typeof PROOF_TIERS)[number], { readonly fact: string }>
> = Object.freeze({
  verified: {
    fact: "Authorship is cryptographically established. It says who wrote the thing, not how good it is.",
  },
  pending: { fact: "Authorship is NOT cryptographically established." },
  excluded: { fact: "Could not be attributed to this person." },
});

/**
 * THE PROOF BADGE, the system's `.proof`.
 *
 * The variant rides on `data-pill-tier`, not `data-tier`: `apps/leaf` measured the alternative —
 * `data-tier` marks a leaflet ("this IS of tier X") and a badge merely DEPICTS one, so sharing
 * the attribute made a single selector count rows and badges together and return 755 on a
 * 377-leaflet document. Both the class modifier and the attribute are emitted, because
 * `foliage.css` styles the first and the assertions key on the second; a badge that lost its
 * modifier renders untinted and still reads as a badge.
 *
 * Exported for the same reason `TIER_LABEL` and `TIER_STANDING` are: `renderPublished.ts` prints
 * this exact badge for a frozen artifact's rows, and a second implementation is how the two pages
 * end up rendering the same tier two different ways.
 */
export function proofBadge(tier: (typeof PROOF_TIERS)[number]): string {
  return `<span class="proof proof-${esc(tier)}" data-pill-tier="${esc(
    tier,
  )}"><svg class="ico ico-14" aria-hidden="true"><use href="#${TIER_ICON[tier]}"></use></svg>${esc(
    TIER_LABEL[tier],
  )}</span>`;
}

/**
 * IS THIS TITLE THE ARTIFACT'S OWN WORDS, OR SOMETHING A MACHINE WROTE ABOUT IT?
 *
 * AN ALLOW-LIST, WHICH IS WHERE THIS SURFACE DEPARTS FROM `apps/leaf` ON PURPOSE. That app asks
 * whether the provenance source is NOT the promoter's prefix — a deny-list, correct for the
 * sources that exist today and open by default to the next producer somebody adds. This is the
 * outward surface, so it fails closed: a title is attested as verbatim only when its provenance
 * names a source THIS module can point at the copying line for. `commitsToLeaflets` sets
 * `title: titleOf(commit.subject)`, which copies the subject and does nothing else to it, so
 * `GIT_SOURCE` qualifies and nothing else does yet.
 *
 * Why it matters beyond pedantry: `data-verbatim="title"` is an ATTESTATION — it says these exact
 * words came out of the underlying artifact and none of them are Foliage's — and the no-score
 * check is scoped by it. Emitting it over a drafted title both misattributes the words and
 * exempts them from the gate, which is the pair of defects `a2a4b62` fixed one plane down.
 *
 * The constant is IMPORTED from `@foliage/leaf`, never spelled again here: the producer builds
 * the same string from the same constant, so a rename moves both ends at once instead of
 * silently un-marking every title on this page.
 */
function carriesVerbatimTitle(leaflet: ReachableLeaflet): boolean {
  const provenance = "provenance" in leaflet ? leaflet.provenance : undefined;
  return provenance !== undefined && provenance.source === GIT_SOURCE;
}

/** The one attribute that says whose words a title is. Only `data-verbatim` exempts the region. */
function titleProvenanceAttr(carried: boolean): string {
  return carried ? 'data-verbatim="title"' : 'data-authored="drafted-title"';
}

/** Tree shares use the same identifier redaction as frozen publications. Changed words are never attested as verbatim. */
function outwardTitle(leaflet: ReachableLeaflet): { readonly text: string; readonly attr: string } {
  const text = redactPublicationText(leaflet.title);
  return text === leaflet.title
    ? { text, attr: titleProvenanceAttr(carriesVerbatimTitle(leaflet)) }
    : { text, attr: 'data-title-redacted="true"' };
}

/**
 * The evidence a claim rests on: where it came from, which object it is, and when that was read.
 *
 * All three terms, always. This surface has no roster row that shows the observed instant in a
 * column of its own, so there is nothing here to de-duplicate against — and dropping a term to
 * save a line would remove the one that says `observedAt` is when INTAKE READ the evidence and
 * not when the work happened.
 */
function provenanceRow(p: Provenance): string {
  const observed = new Date(p.observedAt);
  const observedLabel = Number.isNaN(observed.getTime()) ? p.observedAt : new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(observed);
  return `<dl class="pub-prov">
<div><dt class="fol-label">Source</dt><dd>${esc(p.source)}</dd></div>
<div><dt class="fol-label">Ref</dt><dd class="fol-metric">${esc(p.ref)}</dd></div>
<div><dt class="fol-label">Observed</dt><dd class="fol-metric"><time datetime="${esc(
    p.observedAt,
  )}" title="${esc(p.observedAt)}">${esc(observedLabel)}</time></dd></div>
</dl>`;
}

/* ==============================================================================================
   WHAT EVERY PUBLIC PAGE NEEDS FROM A LOADED TREE, AND NOTHING MORE.
   ============================================================================================== */

/**
 * The chrome facts a public page carries regardless of which id was asked for.
 *
 * `signals` IS TREE-LEVEL AND THAT IS LOAD-BEARING, not a convenience. The fabrication band on
 * these pages is computed from the manifest and every leaf source in it, so it is IDENTICAL on
 * an artifact page and on a refusal — which it has to be, because those two pages are compared
 * byte for byte to prove that a private id and an absent id answer the same way. A band computed
 * from the leaf the request happened to hit would be exactly the oracle that comparison exists
 * to refuse: present on a hit, absent on a miss.
 *
 * It is also the honest reading of what the signal is about. `fabricationSignals` answers "is
 * this tree an illustration", which is a fact about the manifest a reader is standing in, not
 * about the artifact they asked for.
 */
export interface PublicContext {
  readonly company: string;
  readonly signals: readonly string[];
  readonly source: TreeSource;
}

/** One person, one page. Total over what a lookup on a loaded tree can produce. */
export type PublicLeafView =
  | { readonly kind: "unloadable"; readonly load: Extract<TreeLoad, { ok: false }> }
  | { readonly kind: "person"; readonly ctx: PublicContext; readonly person: PublicLeaf }
  | { readonly kind: "no-such-leaf"; readonly ctx: PublicContext; readonly requestedId: string };

/** One artifact, one page. */
export type PublicLeafletView =
  | { readonly kind: "unloadable"; readonly load: Extract<TreeLoad, { ok: false }> }
  | {
      readonly kind: "artifact";
      readonly ctx: PublicContext;
      readonly leaflet: ReachableLeaflet;
      readonly leafId: string;
      readonly subject: string;
      /** THIS artifact's own document declares `"example": true`. */
      readonly declaredExample: boolean;
    }
  | { readonly kind: "not-reachable"; readonly ctx: PublicContext; readonly requestedId: string }
  | {
      readonly kind: "ambiguous";
      readonly ctx: PublicContext;
      readonly requestedId: string;
      /** Every candidate here is `public`, i.e. already enumerated on its own leaf page. */
      readonly candidates: readonly { readonly leafId: string; readonly subject: string }[];
    };

function contextOf(load: Extract<TreeLoad, { ok: true }>): PublicContext {
  return {
    company: load.tree.company,
    signals: fabricationSignals(load.manifest, load.leafSources),
    source: load.source,
  };
}

/**
 * Resolve `/leaf/<id>`.
 *
 * ONE CAUSE FOR A MISS, and unlike the leaflet lookup that is NOT a collapse of several. A person
 * is never hidden by the projection: `projectLeaf` returns them in all three of its states, and
 * the two empty ones are real pages carrying their name. So the only way to miss is that no leaf
 * with this id is on this tree, and the company's own manifest is what put the others there —
 * `/tree` already names every one of them and links to every one of them, so answering "no such
 * leaf" discloses nothing a reader could not read off the roster.
 */
/**
 * The projection with the rail attached — the ONE way this module may project the tree.
 * `load.policies` is index-aligned with `tree.leaves` by the loader; a hole is a loader bug
 * and throws rather than projecting somebody without their rail.
 */
function projectLoadedTree(load: Extract<TreeLoad, { ok: true }>) {
  return projectTree(load.tree, (leaf, i) => {
    const policy = load.policies[i];
    if (policy === undefined) throw new Error(`no policy loaded for tree.leaves[${i}] ("${leaf.id}") — refusing to project without the rail`);
    return policy;
  });
}

export function resolvePublicLeaf(load: TreeLoad, id: string): PublicLeafView {
  if (!load.ok) return { kind: "unloadable", load };
  const ctx = contextOf(load);
  const person = projectLoadedTree(load).people.find((p) => p.id === id);
  if (person === undefined) return { kind: "no-such-leaf", ctx, requestedId: id };
  return { kind: "person", ctx, person };
}

/**
 * Resolve `/leaflet/<id>`, optionally qualified by whose leaf it is.
 *
 * THE COLLISION THAT FORCES THE QUALIFIER, and it is measured rather than imagined. `LeafletId`
 * is unique within one person's document and nothing makes it unique across a company: intake
 * mints `git:<sha>` (`commitsToLeaflets` in @foliage/leaf), so two colleagues who both draw
 * evidence from the same repository mint the SAME id. That is not a corner case — it is the
 * ordinary shape of a company, and this repository's own seam tests build it by accident. An
 * unqualified `/leaflet/git:abc…` therefore names two artifacts belonging to two people, and
 * every way of answering it with one of them is wrong:
 *
 *   - serving the first match silently attributes one person's work to an address that equally
 *     names another's, with nothing on the page to show a choice was made;
 *   - refusing the whole address takes both artifacts off the canopy because a third party
 *     happened to cite the same commit.
 *
 * So the address is qualified where it is generated — every link this app renders into an
 * artifact carries `?leaf=` — and the unqualified form is answered when it is unambiguous and
 * reported as `ambiguous` when it is not. An `ambiguous` answer names its candidates, which is
 * safe precisely because the unqualified path can only see the `listed` set: every candidate is
 * a `public` leaflet already enumerated on its own person's page, so nothing is disclosed that
 * following the roster would not disclose. THAT IS WHY THE TWO PATHS READ DIFFERENT SETS — if
 * this swept the link-shareable set instead, a disambiguation page would enumerate the very
 * `unlisted` leaflets whose whole consent is that they are not enumerated.
 *
 * O(people) for the qualified path plus O(leaflets) inside one document; O(people × listed) for
 * the unqualified sweep. A tree is a company and a portfolio is human-sized; an index would be a
 * second structure to keep in agreement with documents that are re-read on every request anyway.
 */
export function resolvePublicLeaflet(
  load: TreeLoad,
  id: string,
  scope: string | null,
): PublicLeafletView {
  if (!load.ok) return { kind: "unloadable", load };
  const ctx = contextOf(load);
  const leaves = load.tree.leaves;
  const sourceAt = (i: number): LeafSource | undefined => load.leafSources[i];

  if (scope !== null) {
    /*
     * THE LINK PATH. One named document, and the domain decides. `findPublicLeaflet` takes the
     * raw `Leaf` on purpose — the browse projection cannot express an `unlisted` leaflet, so
     * serving this route out of it would answer "nothing there" for every leaflet whose entire
     * purpose is to be reachable by link.
     *
     * A `scope` naming nobody falls through to the same refusal as a scope naming somebody who
     * has no such leaflet. Answering those differently would turn `?leaf=` into an oracle for
     * which leaf ids exist — and it would be a pointless one, since `/tree` lists them.
     */
    const at = leaves.findIndex((l) => l.id === scope);
    const leaf = at === -1 ? undefined : leaves[at];
    if (leaf !== undefined) {
      const found = findPublicLeaflet(leaf, id);
      if (found.found) {
        return {
          kind: "artifact",
          ctx,
          leaflet: found.leaflet,
          leafId: found.leaf,
          subject: found.subject,
          declaredExample: sourceAt(at)?.declaredExample ?? false,
        };
      }
    }
    return { kind: "not-reachable", ctx, requestedId: id };
  }

  /*
   * THE BROWSE PATH. Only the enumerable set, read straight off the projection — this loop can
   * see `PublicLeaf.listed` and nothing else, so an unlisted or private leaflet is not merely
   * filtered out here, it was never in the data structure.
   */
  const people = projectLoadedTree(load).people;
  const hits: { leaflet: ReachableLeaflet; leafId: string; subject: string; at: number }[] = [];
  people.forEach((person, at) => {
    if (person.state !== "listed") return;
    const match = person.listed.find((l) => l.id === id);
    if (match !== undefined) {
      hits.push({ leaflet: match, leafId: person.id, subject: person.subject, at });
    }
  });

  const only = hits[0];
  if (only === undefined) return { kind: "not-reachable", ctx, requestedId: id };
  if (hits.length > 1) {
    return {
      kind: "ambiguous",
      ctx,
      requestedId: id,
      candidates: hits.map((h) => ({ leafId: h.leafId, subject: h.subject })),
    };
  }
  return {
    kind: "artifact",
    ctx,
    leaflet: only.leaflet,
    leafId: only.leafId,
    subject: only.subject,
    declaredExample: sourceAt(only.at)?.declaredExample ?? false,
  };
}

/* ==============================================================================================
   STATUS — beside the causes, so the view never makes an HTTP decision.
   ============================================================================================== */

/**
 * 404 for a leaf nobody has. The load failures keep `httpStatusFor`'s answers, because the thing
 * that failed is the tree and it failed identically no matter which page asked for it.
 */
export function publicLeafStatus(view: PublicLeafView): 200 | 404 | 500 {
  switch (view.kind) {
    case "unloadable":
      return httpStatusFor(view.load);
    case "person":
      return 200;
    case "no-such-leaf":
      return 404;
    default: {
      const impossible: never = view;
      throw new Error(`unhandled leaf view: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * 300 FOR `ambiguous`, and it is the honest code rather than a clever one.
 *
 * RFC 9110 §15.4.1: the request has more than one possible response and the server has no
 * preferred choice. That is exactly the state — two people published an artifact under one id and
 * this service will not pick one of them on a reader's behalf. No `Location` is sent, because
 * sending one would BE the preference the status says does not exist; a browser renders the body,
 * which is the list of choices.
 *
 * The plausible alternatives are each a lie of a different kind. 200 would tell a script the
 * address resolved. 404 would say no such artifact when there are two. 500 would blame this
 * service for a company having two people who cite the same commit, which is not a fault.
 */
export function publicLeafletStatus(view: PublicLeafletView): 200 | 300 | 404 | 500 {
  switch (view.kind) {
    case "unloadable":
      return httpStatusFor(view.load);
    case "artifact":
      return 200;
    case "ambiguous":
      return 300;
    case "not-reachable":
      return 404;
    default: {
      const impossible: never = view;
      throw new Error(`unhandled leaflet view: ${JSON.stringify(impossible)}`);
    }
  }
}

/* ==============================================================================================
   THE PAGES
   ============================================================================================== */

/**
 * The fabrication band, identical on every public page of one tree.
 *
 * It is the loudest element on the page when it fires, and it is not dismissible: a reader who
 * lands on a page showing a named person and a signed commit reads it as real unless told
 * otherwise, and an HTML comment does not tell them.
 */
function fabricationBand(signals: readonly string[]): string {
  if (signals.length === 0) return "";
  return `<aside class="cell tree-band" role="alert" data-fabricated="true">
<strong class="fol-label">${glyph("i-alert", 14)} Example tree — not a real company</strong>
<p>Nothing on this page describes a real company or real people — ${esc(signals.join("; "))}.</p>
</aside>`;
}

/** Where the reader is, and where the bytes came from. The same three facts `/tree` closes with. */
function sourceFooter(ctx: PublicContext, extra = ""): string {
  return `<footer class="pub-foot" id="portfolio-source" tabindex="-1">
${extra}
<span class="fol-label">Manifest</span>
<span class="fol-metric">${esc(documentName(ctx.source.path))}</span>
<time class="fol-metric" datetime="${esc(ctx.source.readAt)}">read ${esc(ctx.source.readAt)}</time>
</footer>`;
}

/**
 * ONE PUBLISHED ARTIFACT AS A ROW on a person's page.
 *
 * The title is NOT the anchor, and that is the same correction `apps/leaf` records: the title
 * carries `data-verbatim="title"` only while those exact words came out of the underlying
 * artifact. A redacted title loses that attestation. Wrapping it in an anchor this module
 * wrote would put authored chrome inside that region — and the no-score check is scoped by the
 * attribute, so the damage would not be cosmetic. The affordance is its own element beneath.
 *
 * The link is QUALIFIED with this person's leaf id, so a row always leads to THIS person's
 * artifact even where another leaf on the tree cites the same commit.
 */
function publishedRow(leaflet: ReachableLeaflet, leafId: string): string {
  const provenance = "provenance" in leaflet ? leaflet.provenance : undefined;
  const title = outwardTitle(leaflet);
  const reference = provenance?.ref ?? "";
  const briefReference = /^[0-9a-f]{40,64}$/i.test(reference) ? reference.slice(0, 7) : reference.length > 18 ? `${reference.slice(0, 15)}…` : reference;
  return `<li class="pub-item" data-published-row="true" id="portfolio-record-${esc(leaflet.id)}">
<div>
<h3 class="pub-item-title" ${title.attr}>${esc(
    title.text,
  )}</h3>
${
  provenance === undefined
    ? `<p class="pub-item-ref"><span class="fol-label">Evidence</span> none</p>`
    : `<p class="pub-item-ref"><span class="fol-label">${esc(
        provenance.source,
      )}</span><span class="fol-metric" title="${esc(reference)}">${esc(briefReference)}</span></p>`
}
${provenance === undefined ? "" : `<details class="portfolio-evidence"><summary>Source details</summary>${provenanceRow(provenance)}</details>`}
<p class="pub-item-open">${ui.link("Open", {
    className: "pub-link", href: publicLeafletHref(leaflet.id, leafId),
  })}</p>
</div>
<p class="pub-item-tier">${proofBadge(leaflet.tier)}</p>
</li>`;
}

/**
 * WHAT THE BADGES ON A LIST MEAN — each listed tier's `fact`, once per tier present, one click
 * behind a summary naming the tiers. The artifact's own page prints the same sentence in the open.
 *
 * TOTAL OVER THE TIERS ACTUALLY LISTED, never over `PROOF_TIERS`: printing what `Verified` means
 * on a page with no verified artifact teaches a reader to expect a badge this person does not
 * have. Taken over `{ tier }[]` so `renderPublished.ts` shares it rather than keeping a copy.
 */
export function tierStanding(
  listed: readonly { readonly tier: (typeof PROOF_TIERS)[number] }[],
): string {
  const present = PROOF_TIERS.filter((tier) => listed.some((l) => l.tier === tier));
  if (present.length === 0) return "";

  const names = present.map((tier) => TIER_LABEL[tier]);
  const summary =
    names.length === 1
      ? `What ${names[0] as string} means`
      : `What ${names.slice(0, -1).join(", ")} and ${names[names.length - 1] as string} mean`;

  return disclose(
    summary,
    present
      .map(
        (tier) =>
          `<p class="aside" data-standing="listed" data-standing-tier="${esc(
            tier,
          )}"><span class="fol-label">${esc(TIER_LABEL[tier])}</span> ${esc(TIER_STANDING[tier].fact)}</p>`,
      )
      .join("\n"),
  );
}

/**
 * THE THREE STATES OF A PERSON, kept apart because merging any two of them prints a false
 * sentence.
 *
 * `nothing-offered` and `nothing-publishable` look identical on a screen — an empty page with
 * this person's name on it — and they are completely different facts. Saying "has published
 * nothing" about someone who published twelve artifacts that are all `pending` is a false
 * statement to a reader and an unfair one to the subject. The projection names them separately
 * for exactly this reason and this page keeps them separate.
 *
 * NEITHER EMPTY STATE CARRIES A NUMBER, and the projection makes that structural rather than
 * disciplined: the empty arms have no `listed` field to count. A zero is a claim, and here it
 * would be a claim about the size of a set the reader is not entitled to know the size of.
 */
function personBody(person: PublicLeaf, ctx: PublicContext): string {
  const head = `<section class="pub-subject portfolio-identity" id="portfolio-top">
<span class="portfolio-botanical" aria-hidden="true"></span>
<span class="fol-label">Leaf</span>
<h1>${esc(person.subject)}</h1>
<p class="pub-tree"><span class="fol-label">Tree</span> <a class="pub-link" href="/tree">${esc(
    ctx.company,
  )}</a></p>
<nav class="portfolio-nav" aria-label="Portfolio sections">
${person.state === "listed" ? '<a href="#portfolio-work">Work</a>' : ""}
<a href="#portfolio-source">Source</a>
</nav>
</section>`;

  if (person.state === "listed") {
    return `<div class="portfolio-layout">${head}
<section class="pub-published portfolio-work" id="portfolio-work" aria-labelledby="pub-published-h" tabindex="-1">
<h2 id="pub-published-h">Published</h2>
<div class="cell pub-count">
<span class="fol-label">Artifacts</span>
<b class="fol-metric">${person.listed.length}</b>
</div>
${tierStanding(person.listed)}
<ul class="pub-list">
${person.listed.map((l) => publishedRow(l, person.id)).join("\n")}
</ul>
</section></div>`;
  }

  /*
   * AN EMPTY STATE MAY KEEP A FULL SENTENCE — `CLAUDE.md`'s stated exception, because there is
   * nothing else on the screen and the reader is stuck. What it may not keep is a paragraph, and
   * what it may not lose is the clause that stops a false inference about a PERSON: a page saying
   * only "nothing is published here" invites a reader to conclude this person has done nothing.
   * So the second sentence of each plate is the anti-inference, visible.
   *
   * THE `nothing-publishable` COPY HAS NOW BEEN FALSE TWICE, AND THE SECOND TIME IS THIS COMMENT'S
   * FAULT — F-028. Round one: it said authorship was "not cryptographically established", which
   * described a tier gate the domain removed on 2026-08-19. Round two: the sentence written to
   * replace it said "none of it could be attributed to them", and this comment is why — it asserted
   * the state "is now reached only when everything the subject offered is `excluded`". That was
   * never true. `publicProjection.ts`'s `projectLeaf` reaches it from TWO facts: everything offered
   * is `excluded` (attribution), OR everything offered is absolutely DENIED by the publish rail
   * (`deny-rating-shaped-title`, `deny-third-party-evidence`, `deny-no-evidence`). Measured
   * 2026-09-03: one leaflet, tier `verified`, real git provenance, published by its own subject,
   * titled with an engineering percentage → the rail refuses it as designed → this page told a
   * stranger their work could not be attributed to them, with ZERO `excluded` leaflets in the leaf.
   *
   * SO THE PLATE MAY NOT NAME A CAUSE AT ALL. The projection deliberately does not carry which one
   * applies ("a denied leaflet is silently absent, its deny REASON never travels into the
   * projection") — because a public roster printing "withheld because …" leaks the thing the rule
   * protects. Copy that names either cause is therefore guessing, and on a page about a named
   * person a guess is a false statement. What the plate says instead is the one thing true under
   * both: nothing here can be printed under their name.
   */
  const plate =
    person.state === "nothing-offered"
      ? `<h2 id="pub-empty-h" class="plate-t">Nothing is published on this leaf.</h2>
<p class="plate-b">This page says nothing about what else the leaf holds.</p>`
      : `<h2 id="pub-empty-h" class="plate-t">Nothing here can be published as a claim.</h2>
<p class="plate-b">${esc(person.subject)} offered work; none of it can be printed under their name
here, and nothing here failed.</p>`;

  return `<div class="portfolio-layout">${head}
<section class="pub-empty" data-public-empty="${esc(person.state)}" aria-labelledby="pub-empty-h">
<div class="plate">
${glyph("i-folder", 20)}
${plate}
</div>
</section></div>`;
}

/** Render `/leaf/<id>`. Total over `PublicLeafView`. */
export function renderPublicLeafPage(view: PublicLeafView): string {
  if (view.kind === "unloadable") return renderUnloadable(view.load, "leaf");

  if (view.kind === "no-such-leaf") {
    return shell({
      title: "Foliage — no leaf at this address",
      surface: "leaf",
      state: "no-such-leaf",
      body: `${fabricationBand(view.ctx.signals)}
<section class="pub-refusal" aria-labelledby="pub-refusal-h">
<span class="fol-label">Leaf</span>
<h1 id="pub-refusal-h">No leaf at this address.</h1>
<p class="pub-refusal-id fol-metric">${esc(view.requestedId)}</p>
<p class="aside"><a class="pub-link" href="/tree">Tree</a></p>
</section>
${sourceFooter(view.ctx)}`,
    });
  }

  return shell({
    // The person's NAME is in the <h1> and not in the <title>. A window title escapes the page —
    // it is the tab, the history entry, the bookmark and the text a link preview quotes — and
    // the whole point of this surface is that a reader is looking at a company's roster already.
    // Naming the company rather than the person keeps the chrome saying only what the canopy is.
    title: `Foliage — a leaf on ${view.ctx.company}`,
    surface: "leaf",
    state: view.person.state,
    body: `${fabricationBand(view.ctx.signals)}
${personBody(view.person, view.ctx)}
${sourceFooter(view.ctx)}`,
  });
}

/**
 * THE BODY, and the asymmetry that shapes it.
 *
 * `BodyElement` is `{ provenance, text? }` — the REF is required and the WORDS are optional. An
 * element with a ref and no text is an honest evidence listing: the refs are real and the prose
 * does not exist yet. Inventing a sentence to fill that gap is the fabrication the format exists
 * to refuse, so this renderer states the absence and never writes a stand-in.
 *
 * IT READS THE FIELD STRUCTURALLY EVEN THOUGH THE GATE HAS ALREADY VALIDATED IT. Not distrust of
 * `parseLeafDocument` — distrust of the claim that every document reaching this server came
 * through it, which is exactly the assumption a future producer or a future route breaks. An
 * element this module cannot read is NAMED at its index rather than dropped, because a silently
 * shorter artifact reads as a complete one while a named unreadable element is visibly wrong.
 */
type ElementRead =
  | {
      readonly ok: true;
      readonly text: string | null;
      readonly provenance: Provenance;
      /**
       * Whether this element carries an IMAGE, and nothing else about it.
       *
       * A BOOLEAN HERE AND A DESCRIPTION ONE PLANE DOWN, deliberately. The leaf app reads the
       * media object because it can serve the bytes and has to say what type and what size they
       * are; this plane holds no bytes at all — the canopy is a hosted index of other people's
       * documents and there is no media route on it — so the only fact it can state is that an
       * image is part of this artifact and is not on this page. Parsing more would let the
       * surface print a pixel size for a picture it cannot show, which is detail standing in for
       * the thing itself.
       *
       * WHAT THIS REPLACED IS THE POINT. Before it, a media element rendered here as its caption
       * over its ref, with the photograph silently absent and the page looking complete — the
       * same class of failure as a silently shorter body, which the paragraph above refuses.
       */
      readonly carriesMedia: boolean;
    }
  | { readonly ok: false; readonly at: string; readonly found: string };

function describeValue(v: unknown): string {
  if (v === undefined) return "nothing (the field is absent)";
  if (v === null) return "null";
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (typeof v === "string") return v.trim().length === 0 ? "an empty string" : "a string";
  if (typeof v === "object") return `an object with keys ${Object.keys(v).join(", ") || "(none)"}`;
  return `a ${typeof v}`;
}

function readElement(value: unknown, at: string): ElementRead {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, at, found: describeValue(value) };
  }
  const record = value as Record<string, unknown>;
  const p = record["provenance"];
  if (typeof p !== "object" || p === null || Array.isArray(p)) {
    return { ok: false, at: `${at}.provenance`, found: describeValue(p) };
  }
  const prov = p as Record<string, unknown>;
  for (const key of ["source", "ref", "observedAt"] as const) {
    if (typeof prov[key] !== "string" || (prov[key] as string).trim() === "") {
      return { ok: false, at: `${at}.provenance.${key}`, found: describeValue(prov[key]) };
    }
  }
  const text = record["text"];
  return {
    ok: true,
    text: typeof text === "string" && text.trim() !== "" ? text : null,
    provenance: {
      source: prov["source"] as string,
      ref: prov["ref"] as string,
      observedAt: prov["observedAt"] as string,
    },
    // PRESENCE of the key, exactly as the format discriminates it. Not truthiness: an element
    // carrying a broken or empty `media` is still an element that says it has a picture, and
    // reading it as text is how the omission became invisible in the first place.
    carriesMedia: "media" in record,
  };
}

function bodySection(leaflet: ReachableLeaflet): string {
  const raw: unknown = leaflet.body;
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
    return `<section class="pub-body" data-body="absent" aria-labelledby="pub-body-h">
<h2 id="pub-body-h">Body</h2>
<p class="aside">No body.</p>
</section>`;
  }
  if (!Array.isArray(raw)) {
    return `<section class="pub-body" data-body="unreadable" aria-labelledby="pub-body-h">
<h2 id="pub-body-h">Body</h2>
<p class="aside">Unreadable: <span class="fol-metric">body</span> is ${esc(describeValue(raw))}.</p>
</section>`;
  }

  const elements = raw.map((v, i) => readElement(v, `body[${i}]`));
  /*
   * WHERE THE "no claim is stated" SENTENCE GOES depends on whether the body is mixed, and this
   * was measured on a running page one plane down: where NO element has words, the per-element
   * sentence rendered once per cell and buried the refs it was describing. When every element is
   * ref-only, the section says it ONCE; when some elements do state a claim, the ones that do not
   * have to say so individually, or a reader scanning the column takes the silence as the
   * previous element's sentence continuing.
   */
  const allRefOnly = elements.every((e) => !e.ok || (e.text === null && !e.carriesMedia));
  const items = elements
    .map((e) =>
      e.ok
        ? `<li class="cell pub-element" data-element="${
            e.carriesMedia ? "media-elsewhere" : e.text === null ? "ref-only" : "stated"
          }">
${
  e.text === null
    ? allRefOnly || e.carriesMedia
      ? ""
      : `<p class="aside">No text.</p>`
    : `<p class="pub-element-text" data-verbatim="body-element">${esc(e.text)}</p>`
}
${
  // SAID, NOT SHOWN AND NOT SKIPPED. The bytes live in the store beside the subject's own leaf;
  // this plane indexes documents and holds no media, so the honest answer is the fact plus where
  // it is — never a broken image, and never nothing.
  e.carriesMedia
    ? `<p class="aside" data-media="not-served-here">Image not shown here.</p>\n`
    : ""
}${provenanceRow(e.provenance)}
</li>`
        : `<li class="cell pub-element" data-element="unreadable">
<p class="aside">Unreadable: <span class="fol-metric">${esc(e.at)}</span> is ${esc(e.found)}.</p>
</li>`,
    )
    .join("\n");

  return `<section class="pub-body" data-body="present" aria-labelledby="pub-body-h">
<h2 id="pub-body-h">Body</h2>
<ul class="pub-elements">
${items}
</ul>
</section>`;
}

/** Render `/leaflet/<id>`. Total over `PublicLeafletView`. */
export function renderPublicLeafletPage(view: PublicLeafletView): string {
  if (view.kind === "unloadable") return renderUnloadable(view.load, "leaflet");

  if (view.kind === "not-reachable") {
    /*
     * THE REFUSAL. It states the RULE and never which case applied — there is no artifact with
     * that id, or there is one its subject has not offered, or there is one the leaf itself marks
     * `excluded` because it could not be attributed to them (`isReachableByLink` is link-share
     * AND subject's-own-work, and no longer a tier gate), and this page reads identically for all
     * of them. It names the id that was ASKED FOR, which
     * the requester already had, and nothing else: not the ids that exist, not how many there
     * are, not whose leaf they are on. "Did you mean…" here would be an enumeration oracle.
     */
    return shell({
      title: "Foliage — nothing published at this address",
      surface: "leaflet",
      state: "not-reachable",
      body: `${fabricationBand(view.ctx.signals)}
<section class="pub-refusal" aria-labelledby="pub-refusal-h">
<span class="fol-label">Leaflet</span>
<h1 id="pub-refusal-h">Nothing is published at this address.</h1>
<p class="pub-refusal-id fol-metric">${esc(view.requestedId)}</p>
</section>
${sourceFooter(view.ctx)}`,
    });
  }

  if (view.kind === "ambiguous") {
    return shell({
      title: "Foliage — more than one artifact at this address",
      surface: "leaflet",
      state: "ambiguous",
      body: `${fabricationBand(view.ctx.signals)}
<section class="pub-refusal" aria-labelledby="pub-refusal-h">
<span class="fol-label">Leaflet</span>
<h1 id="pub-refusal-h">More than one artifact here.</h1>
<p class="plate-b pub-refusal-lede">Choose one.</p>
<p class="pub-refusal-id fol-metric">${esc(view.requestedId)}</p>
<ul class="pub-list">
${view.candidates
  .map(
    (c) => `<li class="pub-item" data-ambiguous-row="true">
<div>
<h3 class="pub-item-title"><a class="pub-link" href="${esc(
      publicLeafletHref(view.requestedId, c.leafId),
    )}">${esc(c.subject)}</a></h3>
<p class="pub-item-ref"><span class="fol-label">Leaf</span><span class="fol-metric">${esc(
      c.leafId,
    )}</span></p>
</div>
</li>`,
  )
  .join("\n")}
</ul>
</section>
${sourceFooter(view.ctx)}`,
    });
  }

  const { leaflet, subject, leafId, ctx, declaredExample } = view;
  const provenance = "provenance" in leaflet ? leaflet.provenance : undefined;

  /*
   * WHAT THIS PAGE IS ALLOWED TO CLAIM, said on the page rather than assumed by the reader.
   *
   * A FABRICATED DOCUMENT OVERRIDES THE TIER, and it overrides it HERE rather than being left to
   * the band. The band says the tree is an illustration; this sentence makes a statement about
   * THIS artifact, and "authorship is cryptographically established" is false about a leaflet
   * whose ref is the string `example-ref-not-a-commit-0001`. Two true sentences and one false one
   * on a page is not honesty — a reader takes the specific claim over the general disclaimer.
   * The tier is still shown and still named; what is withdrawn is that it was observed of anyone.
   */
  const standing = declaredExample
    ? `<p class="aside" data-standing="example">Example document — no evidence on this page was observed.</p>`
    : `<p class="aside" data-standing="outward">${esc(TIER_STANDING[leaflet.tier].fact)}</p>`;

  /*
   * THE DOCUMENT <title> IS NOT THE ARTIFACT'S TITLE. `<title>` is the one string that escapes
   * the page — tab, history, bookmark, link preview — and intake over a real repository produced
   * a leaflet whose commit subject carried a third party's email address. Neither the browser
   * title nor the artifact heading may repeat it. The heading uses the publication redaction
   * gate; `git show <ref>` still finds the source words privately.
   */
  const handle = provenance?.ref ?? leaflet.id;
  const shortHandle = handle.length > 12 ? handle.slice(0, 12) : handle;
  const title = outwardTitle(leaflet);

  return shell({
    title: `Foliage — ${TIER_LABEL[leaflet.tier].toLowerCase()} artifact ${shortHandle}`,
    surface: "leaflet",
    state: "artifact",
    body: `${fabricationBand(ctx.signals)}
<article class="pub-leaflet" data-tier="${esc(leaflet.tier)}">
<span class="fol-label">Leaflet</span>
<h1 ${title.attr}>${esc(title.text)}</h1>
<p class="pub-tier">${proofBadge(leaflet.tier)}</p>
${standing}
${bodySection(leaflet)}
<section class="pub-prov-section" aria-labelledby="pub-prov-h">
<h2 id="pub-prov-h">Provenance</h2>
${
  provenance === undefined
    ? `<p class="aside">None recorded.</p>`
    : provenanceRow(provenance)
}
</section>
</article>
${sourceFooter(
  ctx,
  `<span class="fol-label">Leaf</span>
<span><a class="pub-link" href="${esc(publicLeafHref(leafId))}">${esc(subject)}</a></span>
<span class="fol-label">Tree</span>
<span><a class="pub-link" href="/tree">${esc(ctx.company)}</a></span>`,
)}`,
  });
}

/**
 * A tree load failure does not say anything about a person or artifact. An unconfigured
 * public reader gets a calm empty state; the technical cause stays in the response state
 * and server log. Other failures keep the existing distinct error treatment.
 */
function renderUnloadable(load: Extract<TreeLoad, { ok: false }>, surface: "leaf" | "leaflet"): string {
  if (load.cause === "unconfigured") {
    return shell({
      title: "Nothing published here — Canopy",
      surface,
      state: load.cause,
      body: `<section class="pub-refusal" aria-labelledby="pub-refusal-h">
<h1 id="pub-refusal-h">Nothing published here yet.</h1>
<p class="aside"><a class="pub-link" href="/">Canopy</a></p>
</section>`,
    });
  }
  return shell({
    title: "No tree could be read — Canopy",
    surface,
    state: load.cause,
    body: `<section class="pub-refusal" aria-labelledby="pub-refusal-h">
<span class="fol-label">Canopy</span>
<h1 id="pub-refusal-h">No tree could be read.</h1>
<p class="plate-b pub-refusal-lede">Nothing was counted and nothing was guessed.</p>
<p class="pub-refusal-id">${esc(withoutMachinePath(load.detail, load.path))}</p>
<p class="aside"><a class="pub-link" href="/tree">Tree status</a></p>
</section>`,
  });
}
