/**
 * KNOWLEDGE-BASE INTAKE — the domain half. What a page someone wrote about their own work can
 * establish, what it cannot, and what must not leave the machine because of it.
 *
 * A third light source. Git history says what a person committed; photographs say a file with
 * these bytes was on the machine; a personal knowledge base says what the person WROTE DOWN
 * about their projects, their meetings and their decisions. That is the richest of the three
 * and the most dangerous, and both facts have the same cause: it is prose, written by the
 * subject, about a world that includes other people.
 *
 * WHAT A NOTE ESTABLISHES: that a page at this path, on this machine, says this. That is the
 * whole list. It does not establish that the work described happened, that the subject did it,
 * or that anything on the page is true — a knowledge base is a record of what someone believed
 * while typing, and no part of it is signed, timestamped by a third party, or checkable. So a
 * note-derived candidate is a SUGGESTION for a human to approve, and promotion turns an
 * approved one into a `pending` leaflet. Nothing here can reach `verified`, and that is
 * structural rather than a promise: a `HarvestCandidate` carries no tier at all, and
 * `promoteApproved` writes `pending` unconditionally.
 *
 * THE EVIDENCE REF IS THE PAGE'S PATH, and it is the one place this module diverges from
 * `photoIntake`, deliberately. There the ref is a content digest, because a photograph is a
 * fixed artifact and a path is a name someone can change this afternoon. A note is the
 * opposite: it is a LIVING document whose bytes change every time its author fixes a typo, so a
 * digest would make every candidate un-reopenable at the first edit and would evidence a
 * version of the page nobody can get back. What a reviewer needs from this source is the page
 * itself, openable, right now — so the ref is the path, and the cost of that choice is stated
 * rather than hidden: the path is machine-local and absolute, and `apps/leaf`'s renderer prints
 * `Ref` verbatim on the page, so promoting one of these publishes a directory layout. That is
 * REPORTED at propose time and again at review time, and it is never rewritten — see below for
 * why a rewriter is the wrong tool here.
 *
 * AND BECAUSE THE REF IS A PATH, THE PATH HAS TO HAVE BEEN THERE. A `RetrievedNode` carries its
 * OWN `observedAt`, one per page, and the type is the enforcement: the app cannot build one
 * without an instant, and it has nothing honest to put in that field unless it went and looked.
 * This closes a real defect. Retrieval ranks INDEX ENTRIES and opens nothing — that property is
 * the whole reason this source can be audited — but an index describes the disk as it was when
 * the index was built. A page deleted afterwards is still in it, so a candidate could carry a ref
 * to a file that no longer exists, stamped with an instant asserting somebody observed it. A
 * citation that looks checkable and resolves to nothing is WORSE than an uncited claim, because
 * it defeats the inspection it invites. One instant per ref rather than one per run because that
 * is what was actually measured: each page was confirmed at its own moment, and a single
 * run-level stamp copied onto every ref would be one measurement wearing the authority of n.
 * `draftedAt` stays run-level, because the drafting run is one event.
 *
 * IN THE DETERMINISTIC MODE, NO NOTE CONTENT ENTERS THE DOCUMENT AT ALL. A candidate drafted
 * without a model carries the page's path and the plain statement that nothing was drafted —
 * not its summary, not its title, not a line of its body. A harvest document is a file the
 * operator will hand around; content crosses into it only when a model was explicitly asked to
 * draft a claim, and then it is one line the operator reviews. The absolute path stays out of
 * the TITLE for the same reason and appears only in the ref, where it has a job.
 *
 * THE HAZARD THAT SHAPES THIS FILE — a knowledge base holds notes about OTHER PEOPLE. In the
 * knowledge base this was built against, `people/`, `companies/`, `deals/` and `meetings/` are
 * exactly that, and its own `ACCESS_POLICY.md` says the default posture is "private,
 * owner-first" and, verbatim, "When in doubt about whether something is shareable, treat it as
 * owner-only and ask." A leaflet drafted off a meeting note therefore carries a colleague's
 * name, a client's name or deal terms onto a page whose whole purpose is to be shown to
 * strangers.
 *
 * WHAT OF THAT POLICY IS IMPLEMENTED, AND WHAT IS NOT — stated because quoting a document as
 * authority while honouring half of it is how a protection gets ANNOUNCED and not delivered, and
 * an operator who relaxes on the strength of it is worse off than one who was told nothing. The
 * sentence above is the posture this file implements: the directory convention below decides what
 * to withhold, and withholding-and-naming is how a machine "asks". Two further operative rules
 * are NOT implemented:
 *
 *   - "New pages default to owner-only unless explicitly tagged `access: work`" — DELIBERATELY
 *     not implemented, and it would be wrong here. That rule governs what an agent may surface
 *     INTO a work context; this command runs as the owner, on the owner's machine, over the
 *     owner's own notes, and applying it literally would withhold every page in a vault where no
 *     page carries the tag — i.e. all of them today — which is not a protection, it is the
 *     feature switched off while still claiming to run.
 *   - "A page tagged `access: owner-only` is never surfaced to the work tier, even if it lives in
 *     a work directory" — UNIMPLEMENTED, and it is a real gap: a page the owner has explicitly
 *     marked owner-only is treated here exactly like any other page. The reason is measured, not
 *     assumed. The signal is claimed to be on hand in `tools/vault/.vault/index.jsonl`, which
 *     carries a `tags` array per node, and it is not: built with the shipping tool over a page
 *     whose frontmatter reads `access: owner-only`, that node's index entry came out `tags: []` —
 *     `extractTags` in tools/vault/lib/vault.mjs reads `tags`, `type`, `node_type` and inline
 *     `#tags`, and a bare `access:` key is none of those. (Written as a tag it does survive:
 *     a `tags:` block list holding `access/owner-only`, and an inline `#access/owner-only`, both
 *     land in the array; the inline-array form `tags: [access/owner-only]` came out as the single
 *     literal string `"[access/owner-only]"`.) And `ask.mjs --json` does not forward `tags` at
 *     all — a selected entry carries `id`, `path`, `depth`, `via`, `edge`, `tokensEst`. So
 *     honouring the rule needs a change in a tool this module does not own, in one of two places:
 *     `extractTags` capturing the `access` key, or the retriever's JSON carrying `tags` through.
 *     Until one of those exists, a rule invented here would fire on a string this file guessed at
 *     and would report a protection nobody measured.
 *
 * THREE THINGS THIS DOES ABOUT IT, and one it refuses to do:
 *
 *   1. IT CLASSIFIES BY DIRECTORY, AND SAYS ONLY WHAT A PATH CAN SAY. `brainPageKind` reports
 *      `third-party-shaped` for the four directories above and `unclassified` for everything
 *      else. `unclassified` does NOT mean safe and is never printed as if it did: a page in
 *      `projects/` can name six colleagues, and no path can tell you that. It means the path
 *      said nothing, which is a different fact from "there is nothing here".
 *   2. IT WITHHOLDS THEM BY DEFAULT, and never silently. `partitionRetrieved` returns them in
 *      `withheld`, each with the reason and the flag that would include them, so the operator
 *      sees the exposure BEFORE anything is drafted rather than discovering it in a review
 *      queue. This is stricter than "mark and warn", and the reason is that the policy above
 *      says to ask — a default that drafts first has already answered.
 *   3. WHEN THE OPERATOR DOES INCLUDE THEM, EVERY REF SAYS SO. A ref off one of those
 *      directories carries `source: "brain-note:third-party"` instead of `"brain-note"`, inside
 *      the document, where review and any later reader can see it. The mark belongs to the ref
 *      rather than to the candidate: one candidate can rest on one page of the operator's own
 *      and one about somebody else, and a candidate-level flag could not say which was which.
 *   4. AND BECAUSE THAT MARK IS NOT ENOUGH, THE WHOLE PACK IS RECORDED. The mark in (3) is
 *      derived from the ref's PATH, and the refs are only the pages a candidate CITES — while
 *      the drafter is shown every offered page at once, in one prompt. So a third party's
 *      identity can arrive through page CONTENT and land in a line that cites a different page,
 *      and a register built from the refs is silent about it. MEASURED: a page under `projects/`
 *      (classified `unclassified`, because that is all its path says) naming a client and two
 *      individuals produced a gemma4:12b title that named the client ("negotiated and closed the
 *      <client> logistics contract"), whose evidence source was plain `brain-note` and whose
 *      third-party register was empty. So every drafted candidate carries `shownPages`: the
 *      pages the drafter was looking at when it wrote that line, each with what its path said
 *      and how much of it the model actually saw. Review reads that list and says so out loud
 *      whenever ANY shown page was third-party-shaped — not only when a ref happens to be one.
 *
 *      THE ALTERNATIVES WERE WORSE, and the choice is the product's whole posture. A silent
 *      rewriter is refused below. A NAME DETECTOR is refused for the same reason with a number
 *      attached: measured on this project's own history, a mature PII redactor over 800 real
 *      commit subjects altered 12 lines and 11 were FALSE POSITIVES — a detector reporting
 *      confidence would have printed a number about that. Marking every ref of such a run
 *      third-party would be a lie about pages that are not. What is left is what is actually
 *      KNOWN — which pages were offered, which were third-party-shaped, and that a drafted line
 *      may carry content from any of them — reported to the one reader who can check it. The
 *      cost is stated: under `--include-third-party` the harvest document now names pages no
 *      candidate cites, which is a real exposure inside that file. It is bounded — `shownPages`
 *      never crosses the seam, because promotion emits a title and ONE evidence ref — and it is
 *      the price of a caution a reviewer can act on instead of one they cannot.
 *
 *   AND IT NEVER REWRITES. There is no redactor here and there must not be one. MEASURED on
 *   this project's own history: a mature PII redactor run over 800 real commit subjects altered
 *   12 lines and 11 of those were FALSE POSITIVES — "bring README.ru.md hero in line" became
 *   "bring <HOSTNAME> hero in line". A rewriter does not remove a name; it falsifies what the
 *   evidence says and leaves the operator unable to tell which. Detect, report, refuse if you
 *   must — the human at review is the one who knows whether a colleague minds being named.
 *
 * A MODEL THAT CITES A SOURCE IT WAS NOT GIVEN IS REFUSED WHOLE. This is the fabrication vector
 * that matters most for this source: retrieval is deterministic and auditable, so every claim
 * can be traced to a page — unless the drafter invents a path, at which point the audit trail
 * points at nothing and the candidate is an unsourced assertion wearing a citation. The refusal
 * is the whole draft and not merely the bad ref, because a drafter that cited a page it never
 * saw has told you its other citations are guesses too. Reported with the offending path, never
 * dropped.
 *
 * WHAT THAT CHECK DOES NOT ESTABLISH, written here because a reader will otherwise take it for
 * more than it is. It proves a cited path was IN THE PACK — nothing more. It does not prove the
 * page SUPPORTS the line: a model shown A and B can cite A for a claim that came from B, and
 * every path in that citation resolves, so nothing here fails. It is exact rather than fuzzy on
 * purpose (a near-miss path, `../` and `/private/tmp` equivalents, and a non-string citation all
 * fail closed, and the whole draft is refused rather than repaired), and that strictness is what
 * makes the negative result meaningful — but "grounded in the pack" and "grounded in the cited
 * page" are different claims, and only the human reading the page catches the difference.
 * `shownPages` exists partly so that reader knows which pages to open.
 *
 * WHY EVERY FIELD OF A DRAFT IS NULLABLE: grammar-enforced structured output (ollama's
 * `format`) means the decoder physically cannot leave the schema, so a required non-nullable
 * field whose answer is absent can only be satisfied by INVENTING one. `DraftedLeaflet` carries
 * `string | null` throughout, "the drafter declined" is a first-class value, and an absence that
 * arrives here leaves as an absence rather than as a title.
 *
 * TOTAL and PURE: no fs, no network, no clock, no throw, and no Node built-in. Like
 * `photosToCandidates` it RE-VALIDATES its own output with the real gate
 * (`parseHarvestDocument`) before returning, so the candidates handed back are the gate's and
 * not this function's opinion of what it built.
 *
 * Complexity: O(nodes + drafts × citations), one pass, plus O(nodes) Maps for path resolution
 * and O(candidates) Sets for id collisions.
 */

import { isIsoInstant, RATING_SHAPED } from "@foliage/leaf";

import {
  parseHarvestDocument,
  type HarvestCandidate,
  type HarvestDocumentIssue,
  type ShownPageKind,
} from "./harvestDocument.ts";

/**
 * The mechanism, as it appears in an evidence ref's `source`. A constant rather than a
 * caller-supplied string, same reasoning as `PHOTO_SOURCE`: this module reads knowledge-base
 * pages and nothing else, so letting a caller label the output "git" would let it mislabel real
 * evidence.
 */
export const BRAIN_SOURCE = "brain-note";

/**
 * The same mechanism, on a page that lives where notes about OTHER PEOPLE live. It is a
 * different `source` string rather than a flag on the candidate because the harvest format
 * refuses unknown keys — and because the fact belongs to the individual ref: one candidate can
 * rest on one page of the operator's own work and one page about somebody else, and a
 * candidate-level flag could not say which was which.
 */
export const BRAIN_THIRD_PARTY_SOURCE = "brain-note:third-party";

/**
 * The extractor identity for a title built from the PAGE'S PATH ALONE — no model wrote it. It
 * appears after promotion as `photosynthesis:brain-node`, and it is used whenever no drafter
 * ran and whenever a drafter's line was refused. A model whose line was not used did not write
 * the title, and crediting it would be a lie in the one field review reads first.
 */
export const BRAIN_NODE_EXTRACTOR = "brain-node";

/**
 * Directories whose contents are notes ABOUT OTHER, IDENTIFIABLE PEOPLE.
 *
 * This is the gbrain convention (`~/brain/RESOLVER.md` files a person under `people/`, a
 * company under `companies/`, a transaction under `deals/`, an event under `meetings/`), and it
 * is a rule about what evidence MEANS, which is why it lives in the domain rather than in the
 * app that walks the disk. A knowledge base that does not use this convention gets
 * `unclassified` for everything, and the app says so plainly instead of implying it looked.
 */
export const THIRD_PARTY_DIRECTORIES: ReadonlySet<string> = new Set([
  "people",
  "companies",
  "deals",
  "meetings",
]);

/**
 * What a page's PATH says about whose page it is — which is all a path can say.
 *
 * `unclassified` is not a clean bill of health and is never reported as one. It means the path
 * carried no signal; the page may still name half a team. Only the reviewer reading it knows.
 */
export type BrainPageKind = ShownPageKind;

/**
 * Classify a page by the first segment of its path inside the knowledge base.
 *
 * Both separators are handled because the caller measured this string on a machine this
 * package makes no assumptions about, and a leading separator is tolerated for the same reason.
 * Pure and total: any string in, one of two answers out.
 */
export function brainPageKind(relPath: string): BrainPageKind {
  const normalized = relPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const cut = normalized.indexOf("/");
  if (cut <= 0) return "unclassified";
  const head = normalized.slice(0, cut).toLowerCase();
  return THIRD_PARTY_DIRECTORIES.has(head) ? "third-party-shaped" : "unclassified";
}

/**
 * One page the deterministic retrieval step SELECTED — a name out of an index, and nothing yet
 * observed about the file itself.
 *
 * Kept apart from `RetrievedNode` on purpose: the retrieval ranks index entries and opens
 * nothing, so at this point the only honest claim is "the index says a page with this id lives
 * at this path". Whether it is still there is a separate measurement, and the type says so.
 */
export interface SelectedNode {
  /** The retrieval layer's own id for the page, e.g. `brain:projects/foliage`. */
  readonly id: string;
  /**
   * Where the file is, absolutely. THE EVIDENCE REF — the one string that lets a reviewer open
   * the page and read what the claim rests on.
   */
  readonly path: string;
  /**
   * The page's path INSIDE the knowledge base, as the retrieval index names it
   * (`projects/foliage`, extension not included). It is what the directory classification reads
   * and what a title states — a title carries this, never `path`, because a title is prose this
   * product may publish and `path` names the operator's home directory.
   */
  readonly relPath: string;
}

/**
 * A selected page whose presence on disk was CONFIRMED, and the instant it was confirmed at.
 *
 * Observations only — the ranking that chose it, and the reading of the file, are the app's
 * job. Note what is NOT here: the page's body. The domain never sees note content, because
 * nothing it decides depends on it; the only content that can enter a document is a line a
 * model drafted, and that arrives as a `DraftedLeaflet`.
 *
 * `observedAt` becomes the evidence ref's own `observedAt`, so what that field says is what
 * actually happened: at this instant, this path resolved to a file on this machine. It is not
 * derivable from the retrieval — see the header — and requiring it here is what stops a stale
 * index from producing a citation to a page nobody could open.
 */
export interface RetrievedNode extends SelectedNode {
  /** When this page's presence was confirmed, as an ISO-8601 instant with an offset. */
  readonly observedAt: string;
}

/**
 * One page a drafter was actually shown, and how much of it.
 *
 * The app caps how much of a page it sends; a claim drafted off the first fraction of a page is
 * still cited to the WHOLE page. That was printed once at propose time and recorded nowhere, so
 * `review` could not repeat it days later. It travels into the document as `shownPages`.
 */
export interface ShownPageInput {
  readonly node: RetrievedNode;
  /** Characters of this page put in front of the drafter. */
  readonly charsShown: number;
  /** The page's full length in characters, as read. Equal to `charsShown` when nothing was cut. */
  readonly charsInPage: number;
}

/** A page that was retrieved and deliberately not offered for drafting, and exactly why. */
export interface WithheldNode {
  readonly node: RetrievedNode;
  readonly reason: string;
}

/** The deterministic retrieval step's judgement: what may be drafted from, and what may not. */
export interface RetrievalPartition {
  readonly offered: readonly RetrievedNode[];
  readonly withheld: readonly WithheldNode[];
}

/**
 * Split a retrieved set into what may be drafted from and what is withheld.
 *
 * Called BEFORE anything is drafted, so the operator sees the exposure first and so the drafter
 * is never shown a page the operator did not agree to expose. `includeThirdParty` is the
 * operator's explicit answer to the question `ACCESS_POLICY.md` says to ask; there is no
 * default that answers it for them, which is why the parameter is required rather than
 * optional.
 *
 * Pure and total, and it never drops anything: every input appears in exactly one of the two
 * lists.
 */
export function partitionRetrieved(
  retrieved: readonly RetrievedNode[],
  includeThirdParty: boolean,
): RetrievalPartition {
  const offered: RetrievedNode[] = [];
  const withheld: WithheldNode[] = [];
  for (const node of retrieved) {
    if (includeThirdParty || brainPageKind(node.relPath) !== "third-party-shaped") {
      offered.push(node);
      continue;
    }
    withheld.push({
      node,
      reason:
        `${node.relPath} sits under a directory this knowledge base uses for notes about OTHER ` +
        `people (${[...THIRD_PARTY_DIRECTORIES].join(", ")}), so it was NOT shown to the ` +
        `drafter and nothing was drafted from it. It is named here rather than dropped ` +
        `silently: withholding it is a decision, and you are the one entitled to overrule it. ` +
        `Pass --include-third-party to draft from it — every ref off such a page is then marked ` +
        `"${BRAIN_THIRD_PARTY_SOURCE}" in the document, that mark is read off the PATH and so ` +
        `covers only the pages a claim cites, and every drafted candidate therefore also records ` +
        `the whole pack it was written from, because a drafter shown this page alongside others ` +
        `can carry a name out of it into a line citing one of them. Review names that pack, and ` +
        `review is where you decide whether a name belongs on a public page.`,
    });
  }
  return Object.freeze({ offered: Object.freeze(offered), withheld: Object.freeze(withheld) });
}

/**
 * One leaflet a drafter proposed. EVERY FIELD IS NULLABLE — see the header: a grammar-enforced
 * decoder cannot decline, so declining has to be representable or it will be invented.
 */
export interface DraftedLeaflet {
  /**
   * The identity of whatever drafted this — "local-model:gemma4:12b". Never blank: it becomes
   * the candidate's `extractor`, which is what review reads before deciding whether to trust a
   * drafted line.
   */
  readonly drafter: string;
  /** One line claiming what the subject did, or null when the drafter had nothing to say. */
  readonly title: string | null;
  /**
   * The paths the drafter says this claim rests on, or null. Checked against the set it was
   * actually given — see the header. Item nulls are tolerated because the wire format permits
   * them; they are not citations and are not counted as any.
   */
  readonly citedPaths: readonly (string | null)[] | null;
}

export interface BrainIntakeRequest {
  /** Exactly the pages the drafter was shown. Nothing outside this set may be cited. */
  readonly offered: readonly RetrievedNode[];
  /**
   * Pages that were retrieved and withheld. Passed in so a citation to one of them can be told
   * apart from a citation to a page that does not exist — two different events with two
   * different remedies, and the AGENTS.md rule is that both causes get reported.
   */
  readonly withheld: readonly WithheldNode[];
  /**
   * What the drafter returned, or null when NO DRAFTER RAN. The distinction is load-bearing:
   * null produces one path-only candidate per offered page, whereas an empty array means a
   * drafter ran and drafted nothing, which produces nothing. Substituting the first for the
   * second would answer a request for a model's work with a machine's.
   */
  readonly drafts: readonly DraftedLeaflet[] | null;
  /**
   * What the drafter was SHOWN, one entry per offered page, or null when no drafter ran.
   *
   * REQUIRED whenever `drafts` is non-null, and checked against `offered` rather than trusted:
   * the whole point of the record is that it names the pack the drafter saw, so a pack that
   * disagrees with the pages it was offered is not a record of anything. Refused as an unusable
   * retrieval, because a drafted candidate whose pack cannot be stated is one review cannot be
   * warned about — and the warning is the protection.
   */
  readonly shown: readonly ShownPageInput[] | null;
  /** When this drafting run happened, as an ISO-8601 instant with an offset. */
  readonly draftedAt: string;
}

/** One reason intake could not proceed, addressed to whoever ran it. */
export interface BrainIntakeIssue {
  /** Where the problem is: `observedAt`, `offered[2].path`. */
  readonly at: string;
  readonly message: string;
}

/**
 * Why a proposed leaflet did not become a candidate.
 *
 * `cited-a-source-it-was-not-given` — THE ONE THAT MATTERS. The drafter named a path that was
 *                    not among the pages it was shown and is not one that was withheld: it
 *                    invented a source. The whole draft is refused.
 * `cited-a-withheld-page` — the drafter named a real page that was deliberately kept from it.
 *                    Distinct from the above because the remedy is different and knowable:
 *                    re-run with --include-third-party if that exposure is acceptable. Reaching
 *                    this at all means the drafter produced a path it was never shown, so the
 *                    draft is refused just as firmly.
 * `cited-nothing`  — a title with no citations. A candidate with no evidence cannot exist; the
 *                    harvest gate refuses one, and refusing it here names the cause instead of
 *                    reporting a round-trip bug in this module.
 * `empty-draft`    — the drafter returned an entry with no title. There is no draft in it. A
 *                    page is an artifact that exists whether or not a model spoke about it, but
 *                    a proposed leaflet IS the model's output — with no line, nothing was
 *                    proposed, and inventing a path-only candidate here would be putting a
 *                    machine's work under a request for a model's.
 * `duplicate-evidence-set` — two drafts rest on exactly the same pages, so they would carry the
 *                    same id. Caught here, with the drafter named as the cause, rather than at
 *                    the round-trip gate, which would report a duplicate id as a bug in this
 *                    module when it is a nondeterministic decoder saying one thing twice.
 */
export type BrainRefusalCause =
  | "cited-a-source-it-was-not-given"
  | "cited-a-withheld-page"
  | "cited-nothing"
  | "empty-draft"
  | "duplicate-evidence-set";

export interface BrainRefusal {
  readonly cause: BrainRefusalCause;
  /** The line that was refused, verbatim, or null when there was none. Never paraphrased. */
  readonly title: string | null;
  readonly reason: string;
}

/** One candidate whose title came from the page's path rather than from a drafter, and why. */
export interface BrainDraftNote {
  /** The candidate this is about, by id, so the operator can find it in the review queue. */
  readonly id: string;
  readonly reason: string;
}

/**
 * One candidate that rests, wholly or partly, on a page from a third-party-shaped directory.
 *
 * Returned as well as marked in the document, because a mark inside a JSON file is not a
 * warning: the operator has to be told at the moment it happens, and again at review, and this
 * is the channel that lets the CLI do it.
 */
export interface BrainExposure {
  readonly id: string;
  /** The third-party-shaped pages it rests on, by their in-knowledge-base path. */
  readonly pages: readonly string[];
}

export type BrainIntake =
  | {
      readonly ok: true;
      /** Exactly as `parseHarvestDocument` accepted them. */
      readonly candidates: readonly HarvestCandidate[];
      /** Every proposed leaflet that did not become one, with its cause. Never silent. */
      readonly refusals: readonly BrainRefusal[];
      /**
       * Every candidate whose title states the page's path rather than a drafted claim, with
       * the reason. A caller that prints "N leaflets drafted by the local model" without
       * reading this list is overstating what the model did.
       */
      readonly undrafted: readonly BrainDraftNote[];
      /** Drafts refused for carrying a rating-shaped number, WITH the text that was refused. */
      readonly refusedRatingShapedDrafts: readonly BrainDraftNote[];
      /**
       * Candidates whose PAGE PATH carries a rating-shaped number, so the path was kept out of
       * the title — with the path itself, quoted. A separate register from the drafts, because
       * the two have different remedies: there a model wrote a rating and its line was dropped;
       * here the operator's own file name is the rating, and the file is still the evidence.
       */
      readonly refusedRatingShapedPaths: readonly BrainDraftNote[];
      /** Candidates resting on third-party-shaped pages. Empty unless the operator included them. */
      readonly thirdPartyExposure: readonly BrainExposure[];
      /**
       * The third-party-shaped pages the DRAFTER WAS SHOWN, by in-knowledge-base path, whether
       * or not any candidate cites one.
       *
       * A separate register from `thirdPartyExposure` because it answers a different question,
       * and the difference is the defect this closes: that one lists candidates whose REFS are
       * pages about other people, and it is empty when the model read such a page and cited
       * another. This one is non-empty whenever such a page was in the pack at all, which is the
       * condition under which a drafted line can carry a name. Empty when no drafter ran: a
       * deterministic candidate carries no page content, so there is nothing for a name to
       * travel in.
       */
      readonly thirdPartyShown: readonly string[];
    }
  | {
      /** The retrieval itself is unusable; nothing was built. */
      readonly ok: false;
      readonly cause: "unusable-retrieval";
      readonly issues: readonly BrainIntakeIssue[];
    }
  | {
      /**
       * The candidates this function built were refused by the harvest gate. If this occurs it
       * is a bug in THIS module, not in the caller's input — reported with the gate's own issues
       * rather than thrown, exactly as `photosToCandidates` does.
       */
      readonly ok: false;
      readonly cause: "round-trip-rejected";
      readonly issues: readonly HarvestDocumentIssue[];
    };

/**
 * What stands where the page path would be when the path itself carries a rating.
 *
 * A statement about the artifact rather than a doctored version of it — the same discipline as
 * `photoIntake`'s withheld file name. The path is still the evidence ref, because it is what
 * was measured and where the page actually is; it is only kept out of the prose.
 */
const WITHHELD_PATH = "(page path withheld: it carries a rating-shaped number)";

/**
 * A title made only of what was measured: where the page is inside the knowledge base, and the
 * plain statement that no claim was drafted from it.
 *
 * The same discipline as `titleFromFile` and as @foliage/leaf's "(commit recorded with no
 * message)" — a statement of fact about the artifact, not invented content. It states the
 * in-knowledge-base path and never the absolute one: a title is prose this product may publish,
 * and the absolute path names the operator's home directory.
 */
function titleFromPages(pages: readonly string[]): string {
  const shown = pages.map((p) => (RATING_SHAPED.test(p) ? WITHHELD_PATH : p));
  const [first] = shown;
  if (first === undefined) return `knowledge-base page, no claim drafted`;
  if (shown.length === 1) return `${first} — knowledge-base page, no claim drafted`;
  return `${shown.join(", ")} — ${shown.length} knowledge-base pages, no claim drafted`;
}

/**
 * The first non-blank line of a drafter's answer, or null.
 *
 * Null in, null out — and blank in, null out too: a decoder that satisfied the grammar with an
 * empty string declined just as surely as one that emitted a JSON null, and turning either into
 * a title would be inventing content out of an absence.
 */
function oneLine(value: string | null): string | null {
  if (value === null) return null;
  const line = value.split("\n").find((l) => l.trim().length > 0);
  return line === undefined ? null : line.trim();
}

/**
 * The candidate id for a set of pages: the retrieval layer's ids, sorted, joined.
 *
 * WHY THE EVIDENCE SET AND NOT A SLUG OF THE TITLE. The id is what promotion's duplicate
 * refusal compares, so it has to say what the claim RESTS ON rather than how it was worded —
 * two runs of a nondeterministic decoder over the same pages produce two wordings of one claim,
 * and an id built from the wording would let both into a portfolio. Sorted so the id does not
 * depend on the order the drafter happened to cite them in, and joined verbatim so the id is
 * readable in a review queue and traceable back to the pages by eye.
 */
function candidateIdFor(nodeIds: readonly string[]): string {
  return `${BRAIN_SOURCE}:${[...nodeIds].sort().join("+")}`;
}

/** Same wording rule as the parsers: say what was actually there, absence included. */
function describe(v: unknown): string {
  if (v === undefined) return "nothing (the field is absent)";
  if (v === null) return "null";
  if (typeof v === "string") return v.trim().length === 0 ? "an empty string" : `"${v}"`;
  return `a ${typeof v}`;
}

/**
 * Turn a deterministic retrieval — and, when one ran, a drafter's proposals — into leaflet
 * candidates, or report every reason they cannot be.
 *
 * Fails as a whole rather than per-page for an unusable RETRIEVAL (a page with no path, an
 * instant with no offset, the same page twice), for the same reason `commitsToLeaflets` does: a
 * partial answer asserts a smaller harvest than the retrieval actually returned, and a
 * duplicate page means the read is broken. A DRAFT that cannot be used is a different thing —
 * it is refused with a named cause and reported, because a drafter proposing something
 * unusable is an ordinary event and not a broken machine.
 */
export function brainNotesToCandidates(request: BrainIntakeRequest): BrainIntake {
  const issues: BrainIntakeIssue[] = [];

  if (!isIsoInstant(request.draftedAt)) {
    issues.push({
      at: "draftedAt",
      message:
        `${describe(request.draftedAt)} is not an ISO-8601 instant with an offset (e.g. ` +
        `2026-08-16T09:41:00Z). A local-time stamp is an observation plus an unstated ` +
        `assumption about where it was made.`,
    });
  }

  /** absolute path -> the page it names, for resolving what a drafter cited. */
  const byPath = new Map<string, RetrievedNode>();
  for (const [i, node] of request.offered.entries()) {
    const at = `offered[${i}]`;
    const path = node.path.trim();
    const id = node.id.trim();
    const relPath = node.relPath.trim();
    if (path === "") {
      issues.push({
        at: `${at}.path`,
        message:
          `a retrieved page must carry the path it was found at. It is the evidence ref — the ` +
          `one string that lets a reviewer open the page a claim rests on — so a page without ` +
          `one cannot be evidence for anything.`,
      });
      continue;
    }
    if (id === "") {
      issues.push({
        at: `${at}.id`,
        message:
          `${path} arrived with no retrieval id. The id is what the candidate id is built from, ` +
          `and an id built from a blank is not stable across runs.`,
      });
      continue;
    }
    if (relPath === "") {
      issues.push({
        at: `${at}.relPath`,
        message:
          `${path} arrived with no in-knowledge-base path. That path is what the directory ` +
          `classification reads, so without it this module cannot tell whether the page is one ` +
          `about somebody else — and guessing "probably not" is exactly the failure this ` +
          `classification exists to prevent.`,
      });
      continue;
    }
    const already = byPath.get(path);
    if (already !== undefined) {
      issues.push({
        at: `${at}.path`,
        message:
          `${path} was retrieved twice (also as "${already.id}"). One page is one piece of ` +
          `evidence; seeing it twice means the retrieval is double-counting, which would draft ` +
          `two candidates over one page and report a larger harvest than the knowledge base ` +
          `supports.`,
      });
      continue;
    }
    // THE INSTANT THIS PAGE WAS CONFIRMED AT. It becomes the ref's `observedAt`, so a value that
    // is not an instant would put an unreadable stamp on the one field that says somebody
    // actually looked. Checked per page rather than once for the run, because it is measured per
    // page — see the header.
    if (!isIsoInstant(node.observedAt)) {
      issues.push({
        at: `${at}.observedAt`,
        message:
          `${path} arrived with ${describe(node.observedAt)} for the instant its presence was ` +
          `confirmed, which is not an ISO-8601 instant with an offset (e.g. ` +
          `2026-08-16T09:41:00Z). This becomes the evidence ref's observedAt, and a ref that ` +
          `says a page was observed has to name a moment somebody could have observed it at.`,
      });
      continue;
    }
    byPath.set(path, Object.freeze({ id, path, relPath, observedAt: node.observedAt }));
  }

  /** absolute path -> the withheld page it names, so a citation to one is told apart. */
  const withheldByPath = new Map<string, WithheldNode>();
  for (const entry of request.withheld) {
    const path = entry.node.path.trim();
    if (path !== "") withheldByPath.set(path, entry);
  }

  const drafts = request.drafts;
  if (drafts !== null) {
    for (const [i, draft] of drafts.entries()) {
      if (draft.drafter.trim() === "") {
        issues.push({
          at: `drafts[${i}].drafter`,
          message:
            `a proposed leaflet arrived with no drafter identity. That identity becomes the ` +
            `candidate's extractor, which is what review reads before deciding whether to trust ` +
            `a drafted line — an anonymous draft cannot be reviewed.`,
        });
      }
    }
  }

  /**
   * THE PACK, checked against the pages it claims to be. `shownPages` is what review reads to
   * decide whether a drafted line could be carrying somebody's name, so a pack that disagrees
   * with what was offered would make that warning describe a different run.
   */
  const shownByPath = new Map<string, ShownPageInput>();
  if (drafts === null && request.shown !== null) {
    issues.push({
      at: "shown",
      message:
        `no drafter ran, and yet a pack of ${request.shown.length} page(s) is recorded as having ` +
        `been shown to one. Nothing was shown to anything: a deterministic candidate is titled ` +
        `from the page's path, so recording a pack here would attach a model's reading to a ` +
        `title no model wrote.`,
    });
  } else if (drafts !== null) {
    if (request.shown === null) {
      issues.push({
        at: "shown",
        message:
          `a drafter ran and what it was shown was not recorded. Every drafted title has to ` +
          `carry the pack it was written from — the drafter sees every offered page at once, so ` +
          `a line citing one page can carry content from another, and the pack is the only ` +
          `thing that tells a reviewer which pages to open.`,
      });
    } else {
      for (const [i, entry] of request.shown.entries()) {
        const at = `shown[${i}]`;
        const path = entry.node.path.trim();
        if (path === "" || !byPath.has(path)) {
          issues.push({
            at: `${at}.node.path`,
            message:
              `${describe(entry.node.path)} was recorded as shown to the drafter and is not one ` +
              `of the ${byPath.size} page(s) offered. The pack and the offered set describe one ` +
              `event and they disagree.`,
          });
          continue;
        }
        if (shownByPath.has(path)) {
          issues.push({
            at: `${at}.node.path`,
            message: `${path} is recorded as shown twice. One page shown twice is one page.`,
          });
          continue;
        }
        if (
          !Number.isInteger(entry.charsShown) ||
          !Number.isInteger(entry.charsInPage) ||
          entry.charsShown < 0 ||
          entry.charsInPage < 0 ||
          entry.charsShown > entry.charsInPage
        ) {
          issues.push({
            at: `${at}.charsShown`,
            message:
              `${path} was recorded as ${entry.charsShown} character(s) shown of ` +
              `${entry.charsInPage}, which is not a reading anything could have performed. This ` +
              `pair is what tells a reviewer the model saw a FRACTION of a page the claim cites ` +
              `whole.`,
          });
          continue;
        }
        shownByPath.set(path, entry);
      }
      for (const path of byPath.keys()) {
        if (shownByPath.has(path)) continue;
        issues.push({
          at: "shown",
          message:
            `${path} was offered to the drafter and does not appear in the pack that was ` +
            `recorded. A pack missing a page understates what the drafter read, which is the ` +
            `exact direction this record exists to close.`,
        });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, cause: "unusable-retrieval", issues: Object.freeze(issues) };
  }

  const built: Record<string, unknown>[] = [];
  const refusals: BrainRefusal[] = [];
  const undrafted: BrainDraftNote[] = [];
  const refusedRatingShapedDrafts: BrainDraftNote[] = [];
  const refusedRatingShapedPaths: BrainDraftNote[] = [];
  const thirdPartyExposure: BrainExposure[] = [];
  /** candidate id -> the draft that claimed it first, so a collision names its twin. */
  const claimed = new Map<string, string>();

  /**
   * Record one candidate over a resolved set of pages. Shared by both modes because the
   * evidence rules do not change with who wrote the title: the ref is the path, the source says
   * whether the page is one about somebody else, and the id is the evidence set.
   *
   * Returns whether a candidate was recorded, so a caller never files a note about one that was
   * refused — a register describing a candidate the document does not contain is a report about
   * nothing.
   */
  const build = (
    pages: readonly RetrievedNode[],
    title: string | null,
    drafter: string | null,
  ): boolean => {
    const id = candidateIdFor(pages.map((p) => p.id));
    const twin = claimed.get(id);
    if (twin !== undefined) {
      refusals.push({
        cause: "duplicate-evidence-set",
        title,
        reason:
          `this rests on exactly the pages "${twin}" already rests on, so it would carry that ` +
          `same id and the harvest gate would refuse the whole document. Two claims over one ` +
          `identical evidence set are one claim drafted twice; the second is reported here ` +
          `rather than written.`,
      });
      return false;
    }
    claimed.set(id, title ?? id);

    const finalTitle = title ?? titleFromPages(pages.map((p) => p.relPath));
    const ratedPaths = pages.filter((p) => RATING_SHAPED.test(p.relPath));
    if (title === null && ratedPaths.length > 0) {
      refusedRatingShapedPaths.push({
        id,
        reason:
          `the page path carries a rating-shaped number and was kept OUT of the title: ` +
          `${ratedPaths.map((p) => `"${p.relPath}"`).join(", ")}. The path is not rewritten — ` +
          `it is where the page actually is, and it remains the evidence ref so the page can ` +
          `still be opened. Rename the page if you want its name to appear.`,
      });
    }

    const exposed = pages.filter((p) => brainPageKind(p.relPath) === "third-party-shaped");
    if (exposed.length > 0) {
      thirdPartyExposure.push({ id, pages: Object.freeze(exposed.map((p) => p.relPath)) });
    }

    // THE PACK TRAVELS WITH THE DRAFTER'S PROSE AND ONLY WITH IT. A title the drafter did not
    // write — no drafter ran, or its line was refused — carries no page content, so there is
    // nothing for a name to have travelled in and nothing here to warn about. Recording a pack
    // on such a candidate would say a model's reading stands behind a line it did not write.
    const carriesDraftedProse = title !== null && drafter !== null;

    built.push({
      id,
      title: finalTitle,
      evidence: pages.map((p) => ({
        source:
          brainPageKind(p.relPath) === "third-party-shaped"
            ? BRAIN_THIRD_PARTY_SOURCE
            : BRAIN_SOURCE,
        ref: p.path,
        // The instant THIS page was confirmed at, not the run's — see the header.
        observedAt: p.observedAt,
      })),
      extractor: title === null || drafter === null ? BRAIN_NODE_EXTRACTOR : drafter,
      draftedAt: request.draftedAt,
      review: { state: "candidate" },
      ...(carriesDraftedProse && shownByPath.size > 0
        ? {
            shownPages: [...shownByPath.values()].map((s) => ({
              page: s.node.path,
              kind: brainPageKind(s.node.relPath),
              charsShown: s.charsShown,
              charsInPage: s.charsInPage,
            })),
          }
        : {}),
    });
    return true;
  };

  if (drafts === null) {
    // NO DRAFTER RAN. One candidate per page, carrying the page's path and nothing else — no
    // summary, no title, no line of the body. See the header: content enters a harvest document
    // only when a model was asked for a claim.
    for (const node of byPath.values()) {
      if (!build([node], null, null)) continue;
      undrafted.push({
        id: candidateIdFor([node.id]),
        reason:
          `no drafter ran, so the title states where the page is and nothing about what it ` +
          `says. Add --draft-with-local-model to have a local model propose a claim from the ` +
          `pages themselves.`,
      });
    }
  } else {
    for (const draft of drafts) {
      const drafter = draft.drafter.trim();
      const title = oneLine(draft.title);
      if (title === null) {
        refusals.push({
          cause: "empty-draft",
          title: null,
          reason:
            `${drafter} proposed a leaflet with no title. Nothing was proposed, so nothing is ` +
            `recorded — a path-only candidate here would be this module's work standing in for ` +
            `a model's, credited to neither honestly.`,
        });
        continue;
      }

      const cited = draft.citedPaths ?? [];
      const pages: RetrievedNode[] = [];
      const seen = new Set<string>();
      let refused = false;
      for (const raw of cited) {
        const path = raw === null ? "" : raw.trim();
        if (path === "") continue; // not a citation; there is nothing in it to check
        const node = byPath.get(path);
        if (node === undefined) {
          const withheld = withheldByPath.get(path);
          refusals.push(
            withheld === undefined
              ? {
                  cause: "cited-a-source-it-was-not-given",
                  title,
                  reason:
                    `${drafter} cited "${path}", which is not one of the ${byPath.size} page(s) ` +
                    `it was shown and is not a page that was withheld from it. It named a ` +
                    `source that was never in front of it, so this draft is refused WHOLE and ` +
                    `not merely stripped of that ref: a citation to a page it never saw says ` +
                    `its other citations are guesses too. Nothing about this claim was written.`,
                }
              : {
                  cause: "cited-a-withheld-page",
                  title,
                  reason:
                    `${drafter} cited "${path}", a page that was deliberately withheld from it ` +
                    `(${withheld.reason}) — so it produced a path it was never shown, and the ` +
                    `draft is refused. If that exposure is acceptable, re-run with ` +
                    `--include-third-party and the page will be offered and marked.`,
                },
          );
          refused = true;
          break;
        }
        if (seen.has(node.path)) continue; // one page cited twice is one piece of evidence
        seen.add(node.path);
        pages.push(node);
      }
      if (refused) continue;

      if (pages.length === 0) {
        refusals.push({
          cause: "cited-nothing",
          title,
          reason:
            `${drafter} proposed this line with no citation. A candidate with no evidence ` +
            `cannot exist — the line is prose a machine wrote, and the refs are the only part ` +
            `of it that is checkable — so it is refused rather than recorded unsourced.`,
        });
        continue;
      }

      if (RATING_SHAPED.test(title)) {
        const id = candidateIdFor(pages.map((p) => p.id));
        if (!build(pages, null, null)) continue;
        refusedRatingShapedDrafts.push({
          id,
          reason:
            `the drafted line carried a rating-shaped number and was refused: "${title}". ` +
            `Nothing in this product emits a number that reads like a rating; the page path ` +
            `stands as the title instead, credited to "${BRAIN_NODE_EXTRACTOR}" and not to ` +
            `${drafter}, and the refused text is printed here so it is visible rather than ` +
            `quietly discarded.`,
        });
        undrafted.push({
          id,
          reason:
            `${drafter}'s line was refused for carrying a rating-shaped number, so the title ` +
            `states where the pages are instead. The model wrote none of it.`,
        });
        continue;
      }

      build(pages, title, drafter);
    }
  }

  // Round-trip: serialize what was built and let the HARVEST gate judge it, exactly as
  // `photosToCandidates` does. The candidates returned are the gate's, so this function cannot
  // emit one the CLI would then refuse to write.
  const validated = parseHarvestDocument(JSON.parse(JSON.stringify({ candidates: built })));
  if (!validated.ok) {
    return { ok: false, cause: "round-trip-rejected", issues: validated.issues };
  }

  return {
    ok: true,
    candidates: validated.harvest.candidates,
    refusals: Object.freeze(refusals),
    undrafted: Object.freeze(undrafted),
    refusedRatingShapedDrafts: Object.freeze(refusedRatingShapedDrafts),
    refusedRatingShapedPaths: Object.freeze(refusedRatingShapedPaths),
    thirdPartyExposure: Object.freeze(thirdPartyExposure),
    // Every third-party-shaped page that was IN THE PACK, independent of what anything cited —
    // and independent of whether any draft survived, because a model that read such a page and
    // then had its every line refused still read it, and the operator asked to know.
    thirdPartyShown: Object.freeze(
      [...shownByPath.values()]
        .filter((s) => brainPageKind(s.node.relPath) === "third-party-shaped")
        .map((s) => s.node.relPath),
    ),
  };
}
