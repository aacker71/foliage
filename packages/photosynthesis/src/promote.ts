/**
 * PROMOTION — the one door from the harvest side of the seam into a leaf.
 *
 * An APPROVED candidate becomes a real leaflet at tier "pending": a drafted-and-reviewed
 * entry is attributable — a named person approved a draft over named evidence — but nothing
 * about that act is cryptographically verified, and "pending" is the tier that says exactly
 * that. Marking it "verified" would be the overclaim this codebase exists to refuse.
 *
 * WHAT CROSSES THE SEAM, corrected 2026-08-19 — and the correction is the point of this
 * paragraph, because the sentence it replaces was false in a way that showed up on the page.
 * This function used to move the approved title and exactly ONE provenance, the primary
 * evidence ref, on the reasoning that the full evidence list "stays in the harvest document,
 * which remains the auditable record". Measured on this repository (ledger row F9): the
 * approved candidate `git-cluster:cleanup` carries SEVEN evidence refs, promotion moved ONE,
 * and the server then rendered a leaflet titled "cleanup: 7 commits" above a single Ref cell.
 * Six real refs were dropped at the seam, no field on the leaflet named the document that
 * still held them, and the artifact printed a count it could not substantiate — the exact
 * overclaim shape this codebase exists to refuse.
 *
 * So EVERY evidence ref now crosses, as the leaflet's `body`: one grounded element per ref,
 * in the candidate's own order. The primary ref appears twice on purpose — once as
 * `provenance`, which is the leaflet's own handle on its evidence, and once as the first body
 * element, which is the complete list. A reader must not have to infer that the primary is
 * "also" in the body.
 *
 * NO TEXT IS COMPOSED ONTO ANY BODY ELEMENT. The one text that crosses is a candidate
 * evidence entry's `excerpt` — the artifact's own verbatim words (a commit subject), written at
 * propose time and printed on the review surface — lifted onto that element as its `text`,
 * copied by ref exactly as media is. Synthesising anything here — "commit aaaa111 touched four
 * files" — would still be this module fabricating claims nobody drafted and nobody approved;
 * the excerpt clears that bar because the approval covered it: the reviewer saw those words
 * beside that ref before deciding. The lift is also a TRANSLATION, deliberately: the leaf
 * gate's `PROVENANCE_KEYS` refuses prose on a ref, so the excerpt does not survive on the
 * provenance — it becomes the element's text or it does not cross at all.
 *
 * MEDIA CROSSES THE SAME WAY, AND ONLY THE SAME WAY. A body element is TEXT or MEDIA; the
 * media half is written here from `candidate.media`, joined to the body by REF, and it is
 * copied rather than composed — `CandidateMedia.media` is the leaf format's own object, gated
 * by the leaf gate's own function one layer earlier. This function reads no store, opens no
 * file and identifies no format, which is what keeps it pure and total; more importantly, it is
 * what stops a photograph the reviewer never saw declared from being attached under their
 * approval. A ref with no media entry stays a text element, exactly as before.
 *
 * PROMOTED LEAFLETS ARE PRIVATE, by omitting `visibility` entirely: absence means `private`
 * (`leafletVisibility`). Approving a draft is a judgement that it is TRUE, not a decision to
 * SHOW it to anyone, and collapsing those two would make review a publish button. Sharing is
 * a separate, explicit act by the subject on their own document.
 *
 * The rest of the machine metadata — who approved it and when, the draft time, the extractor's
 * own bookkeeping, the pages a drafter was shown — STAYS in the harvest document, which
 * remains the auditable record of the extraction.
 *
 * THE TARGET LEAF IS CONSULTED ABOUT THE EVIDENCE, added 2026-08-19 (D5), and its absence was
 * the fabrication this product exists to refuse. This function received the `Leaf` and read
 * exactly one thing off it — the set of ids already taken — while writing `tier: "pending"`
 * unconditionally over EVERY evidence ref. `pending` is defined to the reader, in the leaf
 * page's own legend, as "attributed to one of this person's declared identities". So on any
 * multi-author repository a promoted leaflet could rest on shas the SAME document records as
 * `excluded` — "could not be attributed to this subject" — and one artifact would then contradict
 * its own attribution verdict about the same commits. REPRODUCED 2026-08-19 by the adversarial
 * pass: `harvest.mjs propose` clustered every commit `git log` returned, with no identity filter
 * of any kind, and promotion carried the whole cluster across without ever asking the leaf.
 *
 * So a candidate carrying an evidence ref the target leaf marks `excluded` is REFUSED, whole,
 * with the offending refs named and the LEAF'S OWN reason carried beside this module's — both
 * causes, per the error-masking rule. Two decisions inside that, both deliberate:
 *
 *   IT IS REFUSED RATHER THAN TRIMMED. Dropping the offending refs and promoting the remainder
 *   would leave an APPROVED TITLE standing over evidence nobody approved it against — and the
 *   deterministic extractor's titles are literally counts ("cleanup: 7 commits"), so a quietly
 *   shorter body makes the title's own number false. The reviewer approved a claim over a list;
 *   editing the list behind them is not a smaller version of promoting it.
 *
 *   SILENCE IS NOT A VERDICT. A ref the leaf says NOTHING about is not a conflict: the leaf may
 *   have been read from another repository, or before that commit existed. Only a recorded
 *   `excluded` — the tier whose whole meaning is "this is not yours" — refuses anything here.
 *   Absence would be this module inventing an exclusion, which is the same overclaim wearing the
 *   opposite hat.
 *
 * Refusals, both reported and never silent:
 *   - a non-approved candidate is SKIPPED with its state (and, for rejected, the recorded
 *     reason) carried on the result;
 *   - a candidate whose id already names a leaflet in the target leaf is REFUSED — appending
 *     it would produce a document the leaf gate rejects, and overwriting the existing
 *     leaflet would silently rewrite someone's portfolio;
 *   - a candidate whose evidence the target leaf attributes to somebody else is REFUSED, as
 *     above, and every conflicting ref is named.
 *
 * SUPERSEDE, added 2026-09-06, owner decision: the id-collision refusal above is right and
 * stays the default — the corpse that forced this is a garden in use, measured: about half
 * of its cluster leaflets were a stale generation, re-approved a week later, and
 * the leaf never changed, because there was no way to say yes. So this function may now REPLACE
 * an existing leaflet in place, but ONLY for a candidate id the caller names in `permission` —
 * every id not named there refuses exactly as before, byte-for-byte the same reason. Permission
 * is not enough by itself; a replacement additionally requires ALL of, each checked and refused
 * BY NAME rather than folded into one boolean:
 *   - the harvest's target binding was CHECKED (never "unbound-legacy") — a document that was
 *     never confirmed to belong to this leaf at all has proved nothing about this id either;
 *   - the existing leaflet's `provenance.source` is THIS candidate's extractor
 *     (`photosynthesis:<extractor>`) — a git-owned or hand-written row is never superseded by
 *     a draft, no matter who says yes;
 *   - the existing leaflet is the SAME LINEAGE as this candidate: its `provenance.ref` is this
 *     candidate's PRIMARY evidence ref, OR every ref it holds (provenance and body) is among this
 *     candidate's evidence refs. The id is minted from a commit-subject prefix
 *     (`git-cluster:<prefix>`), which two unrelated clusters can share, so the id alone is never
 *     the same-subject proof. The subset arm was added 2026-09-28, measured on a garden in use:
 *     approved clusters had grown by new commits since their leaflets were promoted, most of them
 *     with a NEWER primary ref, so the primary-only rule refused work that only ever gained
 *     evidence. A subset loses nothing the leaf already shows; a leaflet holding a ref this
 *     candidate does not is still a different piece of work and still refused.
 * A replacement PRESERVES the existing leaflet's `visibility` unconditionally: the person is
 * being asked about THIS body, at the caller's edge, not asked to re-decide whether to share it.
 * WHO ASKS IS NOT THIS MODULE'S JOB — `permission` arrives pre-decided, because this function
 * stays pure and total. No surface asks today (the one queue is decided at /review, which
 * passes none), so a "yes" can only ever be a decision about the new body, never one inherited
 * by an id.
 *
 * THE RESULT IS RE-VALIDATED WITH `parseLeafDocument` BEFORE IT IS RETURNED. A promote that
 * can emit a document the leaf gate refuses is the untrustworthy-producer bug that
 * intake.ts's self-check exists to prevent; this closes the same loop mechanically, and the
 * `Leaf` handed back is the one the gate itself produced — not this function's own opinion
 * of what it built.
 *
 * THE TARGET BINDING IS CHECKED FIRST, BEFORE ANY CANDIDATE, ledger F-014. Everything above
 * this paragraph asks "does this candidate's evidence belong here" — a per-candidate question.
 * This is the question one layer up: "does this HARVEST belong here at all". Nothing before
 * this fix answered it: `harvest.mjs propose` never recorded whose leaf a document was drafted
 * for, so `promoteApproved` had no way to notice `--into` naming somebody else's leaf, and a
 * forgotten or wrong flag spliced subject B's approved candidates into subject A's leaf —
 * silently, exit 0. The check is the same posture `mergeIntakeIntoLeaf` already takes for a
 * leaf-id or subject mismatch, one seam over (`packages/leaf/src/merge.ts`): refuse the WHOLE
 * operation, by name, with both values shown, rather than trim or guess. `subject` and `leafId`
 * on the harvest document are each optional and each checked independently when present — a
 * leaf can be renamed without its id changing, so the two catch different mistakes.
 *
 * BOTH ABSENT IS NOT A MATCH. An older document (proposed before this field existed) or a
 * `propose` run with no `--into` carries neither field, and that is reported as `"binding":
 * "unbound-legacy"` on success rather than silently treated as verified — the same backward
 * honesty this codebase applies everywhere absence of a check is itself a fact worth stating.
 *
 * TOTAL and PURE: no fs, no clock, no throw. Complexity: O(existing + existing bodies +
 * candidates + candidate evidence) — one pass over each, an O(n) Set for id collision detection,
 * an O(n) Map from id to the existing leaflet (for the supersede checks) and an O(n) Map from
 * excluded ref to the leaflet that excluded it. The binding check adds O(1); testing candidate
 * id membership in `permission` is an O(1) Set lookup per candidate.
 */

import {
  leafletId,
  leafletVisibility,
  parseLeafDocument,
  type Leaf,
  type LeafDocumentIssue,
  type Leaflet,
  type LeafletBody,
  type LeafletVisibility,
  type Provenance,
} from "@foliage/leaf";

import type { HarvestCandidate, HarvestDocument } from "./harvestDocument.ts";
import { checkCellDraft, type CellStore } from "./cells.ts";
import { PROMOTED_SOURCE_PREFIX } from "./promotedHandle.ts";

// The drafter's label and the one-evidence rule (`promotedHandle.ts`), kept apart so the search
// records apply the rule too without this module's imports.
export { PROMOTED_SOURCE_PREFIX, provenanceIsPromotedHandle } from "./promotedHandle.ts";

/** One candidate that did not promote, and exactly why. Nothing leaves this function unexplained. */
export interface PromoteSkip {
  readonly id: string;
  readonly reason: string;
}

/**
 * One evidence ref the TARGET LEAF itself attributes to somebody else.
 *
 * Both verdicts travel, because reporting only this module's would hide the one a reader can
 * check: the leaflet is in the document they are about to publish, its reason is already written
 * there, and quoting it is what lets them confirm the refusal without taking this code's word.
 */
export interface PromoteConflict {
  /** The candidate's evidence ref, verbatim as the candidate carries it. */
  readonly ref: string;
  /** The `excluded` leaflet in the target leaf that names that ref. */
  readonly leafletId: string;
  /** THAT leaflet's own recorded reason — the leaf's words, never a paraphrase of them. */
  readonly leafReason: string;
}

/**
 * A candidate refused because its evidence contradicts the target leaf's own attribution.
 *
 * `cause` is a named constant rather than something a caller must recognise from prose: a
 * refusal a caller can only detect by matching a sentence is a refusal that silently stops
 * working when the sentence is improved.
 */
export interface PromoteRefusal {
  readonly id: string;
  readonly cause: "evidence-excluded-by-target-leaf";
  readonly reason: string;
  /** Every conflicting ref, named. A bare count is the collapse this repository refuses. */
  readonly conflicts: readonly PromoteConflict[];
}

/**
 * One existing leaflet REPLACED IN PLACE by a candidate the caller had permission for.
 *
 * WHY ITS OWN LIST, not folded into `promoted`: a superseded candidate did not become a NEW
 * leaflet — the header's own words about the id-collision refusal ("appending it would produce
 * a document the leaf gate rejects") do not apply here, because nothing was appended. `promoted`
 * staying exactly "candidate ids that became NEW pending leaflets" keeps that count meaning one
 * thing; a caller who also cares about replacements reads this list.
 *
 * `visibility` is the value that SURVIVED the replacement — always the existing leaflet's own,
 * per the header's "PRESERVES ... unconditionally" — reported rather than left for a caller to
 * re-derive, because a caller confirming what a supersede actually did should not have to
 * re-open the leaf and guess which visibility belongs to which write.
 */
export interface PromoteSupersede {
  readonly id: string;
  readonly visibility: LeafletVisibility;
  /** Evidence refs present in the new body that were not in the old one, in the candidate's order. */
  readonly refsAdded: readonly string[];
  /** Evidence refs present in the old body that are not in the new one, in the old body's order. */
  readonly refsRemoved: readonly string[];
}

/**
 * One way the harvest's own TARGET BINDING (recorded at propose time) disagrees with the leaf
 * it is actually being promoted into. Ledger F-014.
 *
 * Both values travel, same reason as `PromoteConflict`: a refusal a caller can only re-state,
 * never re-check, is a refusal that has to be trusted rather than confirmed.
 */
export interface PromoteBindingMismatch {
  readonly field: "subject" | "leafId";
  /** What this harvest document was proposed FOR. */
  readonly harvestValue: string;
  /** What the TARGET leaf actually is. */
  readonly leafValue: string;
  readonly message: string;
}

export type PromoteOutcome =
  | { readonly ok: false; readonly cause: "cell-authority-refused"; readonly reason: string }
  | {
      readonly ok: true;
      /** The new leaf, exactly as `parseLeafDocument` accepted it. The input leaf is untouched. */
      readonly leaf: Leaf;
      /** Candidate ids that became pending leaflets. */
      readonly promoted: readonly string[];
      readonly skippedNotApproved: readonly PromoteSkip[];
      readonly refusedDuplicates: readonly PromoteSkip[];
      /**
       * Approved candidates whose evidence the target leaf attributes to somebody else.
       *
       * Its own list rather than another `PromoteSkip`, because the two are different events with
       * different remedies: a duplicate id is a bookkeeping collision the operator resolves by
       * renaming or by pointing `--into` elsewhere, while this one says the drafted cluster is
       * not this person's work and the remedy is to re-draft it against the identities they
       * actually declared.
       */
      readonly refusedContradicted: readonly PromoteRefusal[];
      /**
       * Existing leaflets REPLACED in place, one entry per candidate id the caller had
       * permission for AND that passed every named supersede check. See the header's SUPERSEDE
       * paragraph. Empty when `permission` was empty or every permitted id failed a check — the
       * ordinary, unconditioned-by-this-parameter path this whole function had before it.
       */
      readonly superseded: readonly PromoteSupersede[];
      /**
       * Whether the harvest's target binding (`subject`/`leafId`) was checked against this leaf
       * before anything promoted. `"unbound-legacy"` means the document carried NEITHER field —
       * proposed before F-014's binding existed, or with no `--into` given — and this run
       * promoted it anyway, with that caveat reported rather than silently assuming a match.
       */
      readonly binding: "checked" | "unbound-legacy";
    }
  | {
      /**
       * The document promote built was refused by the leaf gate. If this ever occurs it is a
       * bug in THIS module, not in the caller's input — reported with the gate's own issues
       * rather than thrown, so the caller can print every reason.
       */
      readonly ok: false;
      readonly cause: "round-trip-rejected";
      readonly issues: readonly LeafDocumentIssue[];
    }
  | {
      /**
       * The harvest's own recorded target does not name this leaf. Refused WHOLE, before any
       * candidate is looked at — the same posture `mergeIntakeIntoLeaf` takes for a leaf-id or
       * subject mismatch (`packages/leaf/src/merge.ts`), one seam over: promoting the candidates
       * that do not conflict is not a smaller version of this mistake, it is the mistake with a
       * smaller blast radius, so nothing promotes and nothing is written.
       */
      readonly ok: false;
      readonly cause: "binding-mismatch";
      readonly mismatches: readonly PromoteBindingMismatch[];
    };

/**
 * Every ref the leaf RECORDS AS SOMEBODY ELSE'S, mapped to the leaflet that says so.
 *
 * Read off `excluded` leaflets only — that tier's entire meaning is "could not be attributed to
 * this subject", and it is the only statement in a leaf strong enough to refuse a promotion.
 * Both places a leaflet can hold a ref are indexed: its own `provenance`, and every element of
 * its `body`. A ref recorded in a body is a ref the leaf attributes to somebody else just as
 * squarely as its primary one, and indexing only the primary would let the same fabrication
 * back in through a leaflet that carries seven.
 *
 * FIRST WRITER WINS on a duplicate ref, which cannot change the outcome — one conflict refuses
 * the candidate exactly as five do — and keeps the reported leaflet the first one a reader
 * scrolling the document would meet.
 *
 * O(leaflets + body elements). Pure and total.
 */
function excludedRefs(leaf: Leaf): ReadonlyMap<string, PromoteConflict> {
  const index = new Map<string, PromoteConflict>();
  for (const leaflet of leaf.leaflets) {
    if (leaflet.tier !== "excluded") continue;
    for (const ref of leafletRefs(leaflet)) {
      if (index.has(ref)) continue;
      index.set(
        ref,
        Object.freeze({ ref, leafletId: leaflet.id as string, leafReason: leaflet.reason }),
      );
    }
  }
  return index;
}

/**
 * The target leaf's own verdict on ONE candidate's evidence, deduplicated by ref — shared by
 * the brand-new path and the supersede path below, because a replacement is not exempt from
 * the same question a fresh candidate answers: "no pending leaflet in the result rests on an
 * excluded ref" is an invariant over the WHOLE document, not a check this function may skip
 * because a person already said yes to something else (replacing an id).
 *
 * O(candidate evidence). Pure and total.
 */
function conflictsFor(
  candidate: HarvestCandidate,
  excluded: ReadonlyMap<string, PromoteConflict>,
): readonly PromoteConflict[] {
  const seen = new Set<string>();
  const conflicts: PromoteConflict[] = [];
  for (const ref of candidate.evidence) {
    const conflict = excluded.get(ref.ref);
    if (conflict === undefined || seen.has(ref.ref)) continue;
    seen.add(ref.ref);
    conflicts.push(conflict);
  }
  return conflicts;
}

/** `conflictsFor`'s refusal, worded once so the brand-new path and the supersede path say the
 * identical thing about the identical fact. */
function contradictionRefusal(
  candidate: HarvestCandidate,
  conflicts: readonly PromoteConflict[],
): PromoteRefusal {
  return Object.freeze({
    id: candidate.id,
    cause: "evidence-excluded-by-target-leaf" as const,
    reason:
      `${conflicts.length} of this candidate's ${candidate.evidence.length} evidence ` +
      `ref(s) are ones the target leaf itself records as EXCLUDED — "could not be ` +
      `attributed to this subject". Promoting it would write a "pending" leaflet, which ` +
      `this product's own legend defines as attributed to one of this person's declared ` +
      `identities, over evidence the same document says is somebody else's: one artifact ` +
      `contradicting its own verdict about the same refs. It is refused WHOLE rather than ` +
      `trimmed to the refs that do attribute, because the reviewer approved this title ` +
      `over this list — and a deterministic title is a count of it, so a quietly shorter ` +
      `body would leave the approved title asserting a number that is no longer true. ` +
      `Re-draft this cluster against the identities the subject actually declared.`,
    conflicts: Object.freeze(conflicts),
  });
}

/**
 * Build the pending leaflet a candidate promotes to — the shared shape both an APPENDED
 * (brand-new id) and a SUPERSEDING (replaced id) candidate produce. `visibility` is the one
 * axis that differs by caller: absent for a brand-new leaflet (the safe default, per the
 * header's PROMOTED LEAFLETS ARE PRIVATE paragraph), or the existing leaflet's own visibility,
 * carried forward, for a replacement — never invented here, always handed in. Exported so queue
 * adoption judges a replacement by the very leaflet promotion would write, not a lookalike.
 */
export function buildPromotedLeaflet(
  candidate: HarvestCandidate,
  primary: HarvestCandidate["evidence"][number],
  visibility?: LeafletVisibility,
): Leaflet {
  // The PRIMARY evidence ref becomes the leaflet's provenance: its own handle on what it
  // rests on. `observedAt` travels with the ref it belongs to — inventing a fresher
  // timestamp here would claim an observation that never happened at that moment.
  const provenance: Provenance = Object.freeze({
    source: `${PROMOTED_SOURCE_PREFIX}${candidate.extractor}`,
    ref: primary.ref,
    observedAt: primary.observedAt,
  });
  // EVERY ref, in the candidate's order, as grounded body elements. The evidence refs are
  // already `Provenance` — the same type, not a lookalike — so nothing is translated,
  // relabelled or reordered on the way across, and each element keeps the source that
  // actually produced it ("git") rather than inheriting this module's label.
  // The media entries, keyed by the ref they belong to. A Map rather than a `find` per ref:
  // O(refs + media) instead of O(refs × media), and it makes the join total — a ref with no
  // entry is a text element, which is the shape every candidate had before media existed.
  const mediaByRef = new Map(
    (candidate.media ?? []).map((entry) => [entry.ref, entry.media] as const),
  );
  const body: LeafletBody = Object.freeze(
    candidate.evidence.map((ref) => {
      const media = mediaByRef.get(ref.ref);
      // The clean triple, reconstructed: the harvest entry may carry `excerpt`, and the leaf
      // gate refuses any fourth key on a provenance — so the ref crosses as exactly the three
      // fields, and the excerpt crosses as the element's `text` (see the header).
      const refProvenance = Object.freeze({ source: ref.source, ref: ref.ref, observedAt: ref.observedAt });
      // Both spreads conditional rather than `undefined`-valued, because
      // `exactOptionalPropertyTypes` is on and a present-but-undefined key is a different
      // document: it would serialize to nothing here and to `"text": null` / `"media": null`
      // in anything that round-trips through a less careful serializer.
      return Object.freeze({
        provenance: refProvenance,
        ...(ref.excerpt === undefined ? {} : { text: ref.excerpt }),
        ...(media === undefined ? {} : { media }),
      });
    }),
  );
  return Object.freeze({
    id: leafletId(candidate.id),
    title: candidate.title,
    // UNCONDITIONAL. A body of real refs is more evidence, not a different KIND of proof:
    // a person approved a machine's draft, which is attributable and is not verification.
    // "pending" is the tier that says exactly that, and a fuller body must never be the
    // thing that talks this function into "verified".
    tier: "pending" as const,
    provenance,
    body,
    ...(visibility === undefined ? {} : { visibility }),
  });
}

/**
 * Why a permitted supersede is STILL refused, named — the three checks from the header's
 * SUPERSEDE paragraph, run in this order because the first is the cheapest and the least
 * specific to any one candidate. `null` means every check held: this candidate may replace.
 */
function supersedeRefusalReason(
  existingLeaflet: Leaflet,
  candidateSource: string,
  candidateRefs: ReadonlySet<string>,
  primaryRef: string,
  binding: "checked" | "unbound-legacy",
): string | null {
  if (binding === "unbound-legacy") {
    return (
      `permission to replace it was given, but this harvest document's target binding was ` +
      `never checked (it was proposed with no --into, or before F-014 existed) — it has not ` +
      `been confirmed to belong to THIS leaf at all, so nothing on it is trusted enough to ` +
      `replace an existing entry. Re-propose with --into pointing at this leaf, then promote ` +
      `again.`
    );
  }
  const existingSource = existingLeaflet.provenance?.source;
  if (existingSource !== candidateSource) {
    return (
      `permission to replace it was given, but the existing leaflet's provenance is ` +
      `${existingSource === undefined ? "absent" : `"${existingSource}"`}, not "${candidateSource}" — it ` +
      `was not produced by this extractor. A git-owned or hand-written row is never ` +
      `superseded by a draft.`
    );
  }
  const existingRef = existingLeaflet.provenance?.ref;
  const existingRefs = leafletRefs(existingLeaflet);
  const outside = existingRefs.filter((ref) => !candidateRefs.has(ref));
  if (existingRef !== primaryRef && outside.length > 0) {
    return (
      `permission to replace it was given, but the existing leaflet's provenance ref ` +
      `"${existingRef}" does not match this candidate's primary evidence ref "${primaryRef}", and ` +
      `it holds ${outside.length} ref(s) this candidate does not (${outside.join(", ")}) — ` +
      `sharing an id prefix is not the same subject; these are two different pieces of work.`
    );
  }
  return null;
}

/** Every ref a leaflet holds — its provenance, then each body element's — in document order. */
function leafletRefs(leaflet: Leaflet): readonly string[] {
  return [
    ...(leaflet.provenance === undefined ? [] : [leaflet.provenance.ref]),
    ...(leaflet.body ?? []).map((e) => e.provenance.ref),
  ];
}

/**
 * Append every approved candidate in `harvest` to `leaf` as a pending leaflet.
 *
 * Pure function of its inputs: the caller owns the clock (timestamps come from the evidence,
 * observed when it was observed) and the disk (writing the result is the CLI's job).
 */
export function promoteApproved(
  harvest: HarvestDocument,
  leaf: Leaf,
  /**
   * Candidate ids the CALLER already has an explicit yes for, to REPLACE an existing leaflet of
   * that id in place rather than be refused as a duplicate — see the header's SUPERSEDE
   * paragraph. Defaulting to empty refuses every duplicate. `harvest.mjs promote --supersede` and
   * `harvest.mjs adopt` pass it; the review page and `cells.mjs` do not.
   */
  permission: ReadonlySet<string> = new Set(),
  cellStore?: CellStore,
): PromoteOutcome {
  const cellCandidates = harvest.candidates.filter(c => c.id.startsWith("cells:") || c.extractor === "explicit-cell-selection" || c.evidence.some(e => e.source === "cell-snapshot"));
  if (cellCandidates.length) {
    if (!cellStore) return { ok: false, cause: "cell-authority-refused", reason: "Cell drafts require the current private store. Use cells.mjs promote; offline approval is insufficient." };
    try { checkCellDraft(cellStore, { ...harvest, candidates: cellCandidates }); }
    catch (error) { return { ok: false, cause: "cell-authority-refused", reason: error instanceof Error ? error.message : String(error) }; }
  }
  // 0. THE TARGET BINDING, checked before any candidate is looked at — ledger F-014. Each of
  //    the two optional fields is checked independently when present; either one disagreeing
  //    refuses the WHOLE run, both values named, so an operator can confirm the refusal by
  //    reading the same two documents this function did.
  const mismatches: PromoteBindingMismatch[] = [];
  if (harvest.subject !== undefined && harvest.subject !== leaf.subject) {
    mismatches.push({
      field: "subject",
      harvestValue: harvest.subject,
      leafValue: leaf.subject,
      message:
        `this harvest was proposed for subject "${harvest.subject}" and the target leaf ` +
        `describes "${leaf.subject}" — promoting into it would splice one subject's approved ` +
        `candidates into another subject's leaf. Point --into at the leaf this harvest was ` +
        `actually proposed for.`,
    });
  }
  if (harvest.leafId !== undefined && harvest.leafId !== (leaf.id as string)) {
    mismatches.push({
      field: "leafId",
      harvestValue: harvest.leafId,
      leafValue: leaf.id as string,
      message:
        `this harvest was proposed for leaf id "${harvest.leafId}" and the target leaf's id is ` +
        `"${leaf.id}" — the same refusal as the subject check, one field over: a leaf can be ` +
        `renamed without its id changing, so this catches a mismatch the subject check alone ` +
        `might miss.`,
    });
  }
  if (mismatches.length > 0) {
    return { ok: false, cause: "binding-mismatch", mismatches: Object.freeze(mismatches) };
  }
  // BOTH ABSENT is not a match — it is UNCHECKED, reported as such on success rather than
  // assumed. A document with exactly one of the two still counts as checked: whichever field it
  // carries was compared above and agreed.
  const binding: "checked" | "unbound-legacy" =
    harvest.subject !== undefined || harvest.leafId !== undefined ? "checked" : "unbound-legacy";

  // `existingLeafletById` is the ORIGINAL leaf's own leaflets, keyed for O(1) lookup — the
  // supersede checks need the actual leaflet, not merely the fact of a collision. `existing`
  // stays a Set because it also has to record ids a NEW candidate claims within this same run,
  // which never have a leaflet to look up.
  const existingLeafletById = new Map<string, Leaflet>(leaf.leaflets.map((l) => [l.id as string, l]));
  const existing = new Set<string>(existingLeafletById.keys());
  // The leaf's OWN verdict on the evidence, computed once for the whole run rather than
  // re-derived per candidate: the target document does not change while this function runs.
  const excluded = excludedRefs(leaf);
  const appended: Leaflet[] = [];
  // id → the leaflet that REPLACES it, applied when the final leaflets array is assembled —
  // see below. A candidate that supersedes never appears in `appended`: nothing is appended,
  // an existing entry is replaced in place.
  const replacements = new Map<string, Leaflet>();
  const promoted: string[] = [];
  const skippedNotApproved: PromoteSkip[] = [];
  const refusedDuplicates: PromoteSkip[] = [];
  const refusedContradicted: PromoteRefusal[] = [];
  const superseded: PromoteSupersede[] = [];

  for (const candidate of harvest.candidates) {
    if (candidate.review.state !== "approved") {
      skippedNotApproved.push({
        id: candidate.id,
        reason:
          candidate.review.state === "candidate"
            ? `still "candidate" — unreviewed. Only approved candidates promote; a draft ` +
              `nobody has looked at must not become a portfolio entry.`
            : `rejected by ${candidate.review.by} at ${candidate.review.at}: ` +
              `${candidate.review.reason}`,
      });
      continue;
    }

    const primary = candidate.evidence[0];
    if (primary === undefined) {
      // Unreachable from a PARSED harvest document — the gate refuses evidence-empty
      // candidates. Guarded anyway so a hand-built value degrades into a reported skip
      // rather than an undefined provenance, keeping this function total.
      skippedNotApproved.push({
        id: candidate.id,
        reason:
          `approved but carries no evidence refs, so there is nothing to record as ` +
          `provenance. A harvest document that passed parseHarvestDocument cannot reach ` +
          `this state; this value did not.`,
      });
      continue;
    }

    if (existing.has(candidate.id)) {
      const existingLeaflet = existingLeafletById.get(candidate.id);
      // UNCHANGED TODAY'S REASON, verbatim: a candidate id claimed earlier IN THIS RUN by
      // another new candidate has no existing leaflet to check against, and is refused this way
      // regardless of permission — there is nothing here for a supersede check to compare. So is
      // any id nobody asked permission for; the ordinary, unconditioned-by-this-parameter path.
      if (existingLeaflet === undefined || !permission.has(candidate.id)) {
        refusedDuplicates.push({
          id: candidate.id,
          reason:
            `a leaflet with id "${candidate.id}" already exists in the target leaf. Appending ` +
            `it would be refused by the leaf gate, and replacing it would silently rewrite an ` +
            `existing entry — so it is refused and reported instead.`,
        });
        continue;
      }
      // PERMITTED. Still refused unless every named check holds — see the header's SUPERSEDE
      // paragraph and `supersedeRefusalReason`.
      const candidateSource = `${PROMOTED_SOURCE_PREFIX}${candidate.extractor}`;
      const newRefSet = new Set(candidate.evidence.map((e) => e.ref));
      const refusal = supersedeRefusalReason(existingLeaflet, candidateSource, newRefSet, primary.ref, binding);
      if (refusal !== null) {
        refusedDuplicates.push({ id: candidate.id, reason: refusal });
        continue;
      }
      // EVERY NAMED CHECK HELD. Still not exempt from the target leaf's own verdict on the
      // evidence — see `conflictsFor`'s header comment.
      const conflicts = conflictsFor(candidate, excluded);
      if (conflicts.length > 0) {
        refusedContradicted.push(contradictionRefusal(candidate, conflicts));
        continue;
      }
      const visibility = leafletVisibility(existingLeaflet);
      // Deduped by ref, same reason `conflictsFor`'s own `seen` Set exists just above: the
      // parser enforces no ref-uniqueness within one evidence list, so a candidate citing the
      // same ref twice must not be counted as two refs added — the person reads this count
      // BEFORE consenting to the replacement, and an inflated count is the overclaim this
      // module exists to refuse.
      const oldRefSet = new Set(leafletRefs(existingLeaflet));
      // The existing SPELLING is carried, not only its meaning: a private leaflet that said so by
      // omitting the key stays that way, so a replacement changes no byte it was not asked to.
      replacements.set(candidate.id, buildPromotedLeaflet(candidate, primary, existingLeaflet.visibility));
      superseded.push(
        Object.freeze({
          id: candidate.id,
          visibility,
          refsAdded: Object.freeze([...newRefSet].filter((r) => !oldRefSet.has(r))),
          refsRemoved: Object.freeze([...oldRefSet].filter((r) => !newRefSet.has(r))),
        }),
      );
      continue;
    }

    // THE TARGET LEAF'S OWN VERDICT, consulted before anything is built.
    const conflicts = conflictsFor(candidate, excluded);
    if (conflicts.length > 0) {
      refusedContradicted.push(contradictionRefusal(candidate, conflicts));
      continue;
    }

    // Only now is the id spoken for. Reserving it above would have made a later candidate with
    // the same id report "duplicate" about an entry that was itself refused and never written.
    existing.add(candidate.id);
    appended.push(buildPromotedLeaflet(candidate, primary));
    promoted.push(candidate.id);
  }

  // Round-trip: serialize what was built and let the LEAF gate judge it. Validating even
  // when nothing promoted keeps the invariant unconditional — every leaf this function
  // returns has passed parseLeafDocument, no exceptions to reason about.
  // EVERYTHING the input leaf carries beyond the leaflets must survive this function — the
  // clobber class intake's merge rule exists for, found again 2026-08-24 the same day
  // `headline` was born: promotion rebuilt the document from three named fields and silently
  // deleted the one line only the subject may write. Preserve all parsed document settings,
  // including the person's chosen highlights; collectors never select or erase those.
  const document = {
    ...leaf,
    // Every ORIGINAL leaflet, REPLACED IN PLACE where a supersede applies (so a replacement
    // keeps its position rather than moving to the end), then every brand-new leaflet appended.
    leaflets: [
      ...leaf.leaflets.map((l) => replacements.get(l.id as string) ?? l),
      ...appended,
    ],
  };
  const validated = parseLeafDocument(JSON.parse(JSON.stringify(document)));
  if (!validated.ok) {
    return { ok: false, cause: "round-trip-rejected", issues: validated.issues };
  }

  return {
    ok: true,
    leaf: validated.leaf,
    promoted: Object.freeze(promoted),
    skippedNotApproved: Object.freeze(skippedNotApproved),
    refusedDuplicates: Object.freeze(refusedDuplicates),
    refusedContradicted: Object.freeze(refusedContradicted),
    superseded: Object.freeze(superseded),
    binding,
  };
}
