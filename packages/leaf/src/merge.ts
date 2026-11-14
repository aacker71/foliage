/**
 * THE MERGE RULE — what a re-run of evidence intake is allowed to do to a leaf that already
 * exists, and what it may never do.
 *
 * WHY THIS EXISTS. Measured, in one command, on the running demo document (2026-08-18): a leaf
 * held 59 leaflets, 2 of them promoted through Photosynthesis after a human clicked Approve.
 * Re-running `intake --force` over the same path left 68 leaflets and 0 promoted — both
 * approvals gone, no warning, no mention in the output, exit 0. The cause was not subtle:
 * intake wrote the WHOLE document while `promote.ts` APPENDS to it, so the last writer erased
 * the only rows in the file a person had actually reviewed. That is worse than ordinary data
 * loss. The product's entire claim is that a portfolio changes only because a human approved
 * something, and a refresh path that silently un-approves is that claim's mirror-image
 * failure — a silent un-verify.
 *
 * WHY THE RULE LIVES HERE AND THE WRITE DOES NOT. "Which rows does a refresh own?" is a claim
 * about whose work is whose, exactly the class of judgement `@foliage/leaf` exists to hold in
 * the open where the person being judged can read it. Opening the file, renaming a temp file
 * over it, and deciding what to print are I/O details of one app. Same split as
 * document.ts / leafDocument.ts and intake.ts / gitIntake.ts.
 *
 * TOTAL and PURE: no fs, no network, no clock, no throw. It takes the existing document's
 * STATE — including the states where there is no document to merge — and the leaflets this run
 * derived, and returns either the merged leaf with a full account of what happened to every
 * single leaflet, or every reason it refused.
 *
 * THE OWNERSHIP RULE, stated once so nothing has to infer it:
 *
 *   Intake owns a leaflet when `provenance.source === "git"` AND this run re-derived that id.
 *   Nothing else. A leaflet with any other source, or with no provenance at all, was put there
 *   by something intake is not — a human approving a candidate, an upload, a connector — and
 *   is carried forward BYTE-IDENTICAL. Ownership is DECLARED by the provenance the writer
 *   stamped on the row, never inferred from shape, position, or recency.
 *
 * A GIT LEAFLET THE RUN DID NOT RE-DERIVE IS NOT A LEAFLET TO DELETE. It is a question. The
 * history moved, or the declared identities changed, or the commit is simply no longer
 * reachable — and this function CANNOT TELL WHICH, because telling them apart needs a
 * repository and this function is not allowed one. So it reports the id and names the fact it
 * actually observed (`not-re-derived`), and it retains the row by default. A caller that DID
 * the git work may hand back what it established per id, and that named cause is reported
 * instead. What never happens is a guess: collapsing "history rewritten", "identity changed"
 * and "commit unreachable" into one confident answer is the same failure as collapsing four
 * causes into `commitCount: 0`, wearing a merge's clothes.
 *
 * NOTHING IS WRITTEN FROM A DOCUMENT WE COULD NOT READ. `ExistingLeaf` carries `unreadable`
 * and `unparseable` as first-class states precisely so a caller cannot fall through to
 * overwrite: both refuse. "I could not read your file" must never resolve to "so I replaced
 * it".
 *
 * WHAT THE RESULT LOOKS LIKE, and why it is not a count. Every leaflet in the merged leaf is
 * in exactly one of `added` / `kept` / `updated` / `carriedForward` / `wouldDrop`, each entry
 * an id with a named reason. A number cannot be audited and cannot be printed usefully: "68
 * leaflets" is what the broken run said on its way out.
 *
 * A RE-READ IS NOT A CHANGE. Intake stamps `observedAt` from the clock at read time, so on an
 * ordinary re-run every re-derived leaflet differs from the row on disk in that one field. Such a
 * row is KEPT exactly as it was, first observation included; only a leaflet that is new or that
 * really changed carries the run's instant. Measured before this rule (QA 2026-10-02 #11): a
 * no-op `foliage grow` re-stamped every intake leaflet, an export dated all work to the latest
 * scheduled run, and every private-brain session granting one answered 409 scope-changed. An
 * update entry still names every field that moved, `provenance.observedAt` included.
 *
 * A SECOND CORPSE, measured on this same running document (2026-08-19): `foliage grow` runs
 * intake with `--force` on a schedule, intake's derivation never sets `visibility` or `body`
 * (neither is a fact git can tell it), and the "updated" branch below used to write the
 * re-derived row WHOLESALE. Every share decision and every body a person had written onto a
 * git-owned leaflet was erased on the very next grow — not by a bug in the write, by design:
 * "own it, replace it" did not yet know that the row's own fields are not the whole row. So an
 * update now carries `visibility` and `body` forward from the row that was already there, with
 * one exception: a leaflet that re-derives to `excluded` is no longer this person's work at
 * all, and a public flag surviving onto somebody else's commit is exactly the silent widening
 * the product refuses. That drop is never quiet — `"visibility"` joins `changed` so a person
 * watching their report sees WHY a shared row went dark instead of noticing only in a browser.
 *
 * Complexity: O(n + m) over existing and derived leaflets — two Maps, one pass each, plus an
 * O(n) walk to rebuild in the existing document's order. Order is preserved deliberately: a
 * refresh that reshuffles the rows on a person's page has changed their page.
 */

import type { LeafDocumentIssue } from "./document.ts";
import { GIT_SOURCE } from "./intake.ts";
import type { Leaf, LeafId, Leaflet, LeafletId } from "./leaf.ts";

/**
 * The state of the document the run is about to write over — INCLUDING the states in which
 * there is nothing to merge.
 *
 * A discriminated union rather than `Leaf | null` because "there is no file yet" and "there is
 * a file and I could not read it" are opposite facts that a nullable type reports identically,
 * and the second one must stop the write. This is the type that makes the fall-through
 * impossible rather than merely discouraged.
 */
export type ExistingLeaf =
  /** No document at the output path. The ordinary first run. */
  | { readonly state: "absent" }
  /** A document that `parseLeafDocument` accepted. */
  | { readonly state: "present"; readonly leaf: Leaf }
  /** A document exists and could not be read at all — permissions, a directory, an I/O error. */
  | { readonly state: "unreadable"; readonly detail: string }
  /** A document exists, was read, and is not a leaf. The parser's issues travel with it. */
  | { readonly state: "unparseable"; readonly issues: readonly LeafDocumentIssue[] };

/** Why a leaflet this run produced is in the merged leaf. */
export type AddReason = "new-this-run";

/**
 * Why a leaflet intake owns came through unchanged: re-derived identical in every field, or in
 * every field except `provenance.observedAt`, the instant of the read itself.
 */
export type KeepReason = "re-derived-identical";

/** Why a leaflet intake owns was replaced in place. */
export type UpdateReason = "re-derived-changed";

/**
 * Why a leaflet intake does NOT own was carried forward untouched.
 *
 * Both values are read directly off the row rather than inferred. `no-provenance` is separate
 * from `foreign-source` because they are different situations with different remedies: one row
 * says who made it and it was not intake, the other says nothing at all — and a row that says
 * nothing is exactly the one you must not delete on a hunch.
 */
export type CarryReason = "foreign-source" | "no-provenance";

/**
 * What became of a git-sourced leaflet this run did not re-derive.
 *
 * `retain` is the default and the safe direction. `discard` still reports the entry by id and
 * cause — a caller can drop these rows, it can never drop them quietly.
 */
export type UnDerivedDisposition = "retain" | "discard";

/**
 * A cause the CALLER established by doing work this function is not allowed to do.
 *
 * None of these is ever inferred here. They exist so that a caller which went and looked —
 * `git cat-file -e <sha>`, reading the commit's author, comparing the run's declared
 * identities — can put what it found on the record instead of the weaker observation below.
 */
export type EstablishedDropCause =
  /** The ref is no longer reachable in the repository that was read. */
  | "commit-unreachable"
  /** The commit is still there and its author is not among this run's declared identities. */
  | "identity-not-declared"
  /** The ref is gone and an equivalent commit exists under a new object name. */
  | "history-rewritten";

/**
 * Why a git-sourced leaflet was not re-derived.
 *
 * `not-re-derived` is the honest floor: this run produced no leaflet with that id, and nothing
 * available to a pure function narrows it further. It is a statement of what was observed, not
 * a diagnosis, and it is deliberately not dressed up as one.
 */
export type DropCause = "not-re-derived" | EstablishedDropCause;

export interface AddedLeaflet {
  readonly id: LeafletId;
  readonly reason: AddReason;
}

export interface KeptLeaflet {
  readonly id: LeafletId;
  readonly reason: KeepReason;
}

export interface UpdatedLeaflet {
  readonly id: LeafletId;
  readonly reason: UpdateReason;
  /**
   * The document paths that actually moved — `title`, `tier`, `reason`, `provenance`,
   * `provenance.ref`, `provenance.observedAt`, `provenance.source` — sorted, never empty.
   *
   * Present because "updated" on its own does not say what moved. `provenance.observedAt` alone
   * never makes an update (see the header) unless a share decision was dropped beside it. A
   * caller printing a refresh summary should say which of these it is looking at.
   */
  readonly changed: readonly string[];
}

export interface CarriedForwardLeaflet {
  readonly id: LeafletId;
  readonly reason: CarryReason;
  /**
   * The `provenance.source` string on the row, or `null` when the row carries no provenance.
   * Named so a caller can say "2 carried forward (photosynthesis)" — a person who approved
   * something wants to see the thing they approved named, not tallied.
   */
  readonly source: string | null;
}

export interface WouldDropLeaflet {
  readonly id: LeafletId;
  readonly cause: DropCause;
  /** The `provenance.ref` of the row — the sha to run `git show` on to settle the question. */
  readonly ref: string;
  /** What this merge actually did with it, per the caller's `unDerived` disposition. */
  readonly outcome: UnDerivedDisposition;
}

/**
 * Why the merge refused. Nothing is written on any of these.
 *
 * Every variant carries the values that were compared as well as a message, so a caller can
 * both react programmatically and print something a person can act on. Refusals are returned
 * as a LIST for the same reason `parseLeafDocument` returns all its issues at once: fixing one
 * problem per run is how a person ends up running a command five times.
 */
export type MergeRefusal =
  | {
      readonly cause: "existing-unreadable";
      readonly detail: string;
      readonly message: string;
    }
  | {
      readonly cause: "existing-unparseable";
      readonly issues: readonly LeafDocumentIssue[];
      readonly message: string;
    }
  | {
      readonly cause: "leaf-id-mismatch";
      readonly existingId: LeafId;
      readonly incomingId: LeafId;
      readonly message: string;
    }
  | {
      readonly cause: "subject-mismatch";
      readonly existingSubject: string;
      readonly incomingSubject: string;
      readonly message: string;
    }
  | {
      readonly cause: "leaflet-id-claimed";
      readonly ids: readonly LeafletId[];
      readonly message: string;
    }
  | {
      readonly cause: "derived-not-git-sourced";
      readonly ids: readonly LeafletId[];
      readonly message: string;
    }
  | {
      readonly cause: "derived-duplicate-id";
      readonly ids: readonly LeafletId[];
      readonly message: string;
    };

export interface MergeRequest {
  /** The document at the output path, in whatever state the caller found it. */
  readonly existing: ExistingLeaf;
  /** The leaflets this run derived. Every one must carry `provenance.source === "git"`. */
  readonly derived: readonly Leaflet[];
  /** The leaf id this run intends to write. Must equal the existing document's when present. */
  readonly incomingId: LeafId;
  /** The subject this run intends to write. Must equal the existing document's when present. */
  readonly incomingSubject: string;
  /**
   * What to do with git-sourced leaflets this run did not re-derive. Default `retain`.
   *
   * A named two-state rather than a boolean, so the call site reads as the decision it is.
   * Either way every such leaflet is reported by id and cause; only the merged leaf differs.
   */
  readonly unDerived?: UnDerivedDisposition;
  /**
   * What the caller ESTABLISHED, by id, about leaflets it expects to be un-derived.
   *
   * Optional and never required. Entries for ids that were re-derived are unused — a caller is
   * allowed to have probed more than it needed, and treating that as an error would punish
   * thoroughness.
   */
  readonly establishedDropCauses?: ReadonlyMap<LeafletId, EstablishedDropCause>;
}

export type LeafMerge =
  | {
      readonly ok: true;
      /** The document to write. Existing order preserved; new leaflets appended. */
      readonly leaf: Leaf;
      /** Derived leaflets with no counterpart in the existing document. */
      readonly added: readonly AddedLeaflet[];
      /** Owned leaflets re-derived to exactly what was already on disk. */
      readonly kept: readonly KeptLeaflet[];
      /** Owned leaflets re-derived to something different, replaced in place. */
      readonly updated: readonly UpdatedLeaflet[];
      /** Leaflets intake does not own, carried through untouched. */
      readonly carriedForward: readonly CarriedForwardLeaflet[];
      /** Owned leaflets this run did not produce. Retained unless the caller said otherwise. */
      readonly wouldDrop: readonly WouldDropLeaflet[];
    }
  | { readonly ok: false; readonly refusals: readonly MergeRefusal[] };

/** Does this row declare that evidence intake produced it? */
function isIntakeOwned(leaflet: Leaflet): boolean {
  return leaflet.provenance?.source === GIT_SOURCE;
}

/**
 * Which document paths differ between two leaflets.
 *
 * Written out field by field rather than compared through `JSON.stringify`, which is
 * key-order-dependent and would report a difference between two identical rows written by two
 * versions of the same producer. The leaflet shape is closed and small; an explicit comparator
 * is the cheaper thing to keep correct.
 */
function changedFields(before: Leaflet, after: Leaflet): readonly string[] {
  const changed: string[] = [];

  if (before.title !== after.title) changed.push("title");
  if (before.tier !== after.tier) changed.push("tier");

  const beforeReason = before.tier === "excluded" ? before.reason : null;
  const afterReason = after.tier === "excluded" ? after.reason : null;
  if (beforeReason !== afterReason) changed.push("reason");

  const bp = before.provenance;
  const ap = after.provenance;
  if (bp === undefined || ap === undefined) {
    if (bp !== ap) changed.push("provenance");
  } else {
    if (bp.source !== ap.source) changed.push("provenance.source");
    if (bp.ref !== ap.ref) changed.push("provenance.ref");
    if (bp.observedAt !== ap.observedAt) changed.push("provenance.observedAt");
  }

  return changed.sort();
}

/**
 * The row an "updated" entry actually writes: the re-derivation's own fields, plus the share
 * decision and body a person put on the row that was already there.
 *
 * Intake's derivation never sets `visibility` or `body` — neither is a fact git can tell it —
 * so carrying the re-derived row wholesale, as this function did not do before this rule
 * existed, silently erased both on every later grow. The one exception: a row that re-derives
 * to `excluded` is no longer this person's own work, so a visibility it carried does not
 * survive the change — reported here as `droppedVisibility` so the caller can say why.
 *
 * `body` has no such exception: an excluded leaflet still legitimately has a body (the
 * subject's own note about work that turned out not to be theirs), and `body` alone carries no
 * outward consent the way `visibility` does.
 */
function carryConsent(
  existing: Leaflet,
  rederived: Leaflet,
): { readonly leaflet: Leaflet; readonly droppedVisibility: boolean } {
  const droppedVisibility = rederived.tier === "excluded" && existing.visibility !== undefined;
  const visibility = droppedVisibility ? undefined : existing.visibility;
  const body = existing.body;

  // exactOptionalPropertyTypes: spread the optional fields in only when present, the same
  // discipline `parseLeafletFrom` keeps at document.ts:684-692 — an absent key must stay
  // absent, never become present-and-undefined.
  const carried = {
    ...(body === undefined ? {} : { body }),
    ...(visibility === undefined ? {} : { visibility }),
  };

  return { leaflet: Object.freeze({ ...rederived, ...carried }), droppedVisibility };
}

/**
 * Merge a run's derived leaflets into the leaf that is already there.
 *
 * Identity is the leaflet `id` throughout — the same handle the document format makes unique,
 * so there is exactly one notion of "the same leaflet" in the system.
 */
export function mergeIntakeIntoLeaf(request: MergeRequest): LeafMerge {
  const refusals: MergeRefusal[] = [];

  // 1. A document we could not read is a full stop, not a starting point. Reported alone
  //    because nothing downstream can be computed and a list of consequences would bury it.
  if (request.existing.state === "unreadable") {
    return {
      ok: false,
      refusals: Object.freeze([
        {
          cause: "existing-unreadable" as const,
          detail: request.existing.detail,
          message:
            `the existing leaf document could not be read (${request.existing.detail}), so ` +
            `nothing was written. "I could not read your file" must never resolve to "so I ` +
            `replaced it": the rows this run does not own — anything a human approved — are ` +
            `exactly the ones that would be lost.`,
        },
      ]),
    };
  }
  if (request.existing.state === "unparseable") {
    return {
      ok: false,
      refusals: Object.freeze([
        {
          cause: "existing-unparseable" as const,
          issues: request.existing.issues,
          message:
            `the existing leaf document is not a leaf, so nothing was written. Fix the issues ` +
            `listed, or point the output somewhere else. Overwriting an unparseable document ` +
            `destroys whatever it held, and a document nobody can parse is still a document ` +
            `somebody wrote.`,
        },
      ]),
    };
  }

  // 2. The run's own output has to satisfy the ownership rule before it can be applied by it.
  //    A caller that hands in a "photosynthesis" leaflet would otherwise acquire the right to
  //    overwrite human-approved rows just by mislabelling its input.
  const notGitSourced: LeafletId[] = [];
  const duplicateDerived: LeafletId[] = [];
  const derivedById = new Map<LeafletId, Leaflet>();
  for (const leaflet of request.derived) {
    if (!isIntakeOwned(leaflet)) notGitSourced.push(leaflet.id);
    if (derivedById.has(leaflet.id)) duplicateDerived.push(leaflet.id);
    else derivedById.set(leaflet.id, leaflet);
  }
  if (notGitSourced.length > 0) {
    refusals.push({
      cause: "derived-not-git-sourced",
      ids: Object.freeze([...notGitSourced]),
      message:
        `${notGitSourced.length} leaflet(s) handed to the merge do not declare ` +
        `provenance.source "${GIT_SOURCE}". This rule lets a run replace only what it owns, ` +
        `and ownership is read off that field — so a leaflet claiming another source cannot ` +
        `be applied by it without giving the run authority over rows it did not produce.`,
    });
  }
  if (duplicateDerived.length > 0) {
    refusals.push({
      cause: "derived-duplicate-id",
      ids: Object.freeze([...duplicateDerived]),
      message:
        `${duplicateDerived.length} leaflet id(s) appear more than once in this run's output. ` +
        `Merging them would silently keep one and discard the other; ids are unique within a ` +
        `leaf, so this is a bug in the producer rather than a conflict to resolve.`,
    });
  }

  // 3. Nothing to merge: the honest first run. Still validated above, still reported in full —
  //    an empty existing document and an empty run are DIFFERENT results, not both zero.
  if (request.existing.state === "absent") {
    if (refusals.length > 0) return { ok: false, refusals: Object.freeze(refusals) };
    return {
      ok: true,
      leaf: Object.freeze({
        id: request.incomingId,
        subject: request.incomingSubject,
        leaflets: Object.freeze([...request.derived]),
      }),
      added: Object.freeze(
        request.derived.map((l) => Object.freeze({ id: l.id, reason: "new-this-run" as const })),
      ),
      kept: Object.freeze([]),
      updated: Object.freeze([]),
      carriedForward: Object.freeze([]),
      wouldDrop: Object.freeze([]),
    };
  }

  const existing = request.existing.leaf;

  // 4. Is this even the same leaf? A mismatch means the output path points at somebody else's
  //    portfolio, which is the one case where a merge would be worse than an overwrite: it
  //    would blend two people's evidence into one document and both of them would be wrong.
  if (existing.id !== request.incomingId) {
    refusals.push({
      cause: "leaf-id-mismatch",
      existingId: existing.id,
      incomingId: request.incomingId,
      message:
        `the existing document is leaf "${existing.id}" and this run writes leaf ` +
        `"${request.incomingId}". Merging them would combine two portfolios into one file. ` +
        `Pass --id "${existing.id}" to refresh that leaf, or write somewhere else.`,
    });
  }
  if (existing.subject !== request.incomingSubject) {
    refusals.push({
      cause: "subject-mismatch",
      existingSubject: existing.subject,
      incomingSubject: request.incomingSubject,
      message:
        `the existing document describes "${existing.subject}" and this run describes ` +
        `"${request.incomingSubject}". A rename is a real thing that happens, and so is ` +
        `pointing the output at the wrong person's leaf — this rule cannot tell them apart, ` +
        `so it refuses rather than guessing. Edit the document's subject if it is a rename.`,
    });
  }

  if (refusals.length > 0) return { ok: false, refusals: Object.freeze(refusals) };

  // 5. A derived id may not land on a row intake does not own. It cannot happen with today's
  //    id schemes ("git:<sha>" against "photosynthesis-<candidate>"), and if it ever does the
  //    two candidates are a human's row and a machine's row wearing one name: refuse, because
  //    either resolution silently discards something somebody meant.
  const claimed: LeafletId[] = [];
  for (const leaflet of existing.leaflets) {
    if (!isIntakeOwned(leaflet) && derivedById.has(leaflet.id)) claimed.push(leaflet.id);
  }
  if (claimed.length > 0) {
    return {
      ok: false,
      refusals: Object.freeze([
        {
          cause: "leaflet-id-claimed" as const,
          ids: Object.freeze([...claimed]),
          message:
            `${claimed.length} leaflet id(s) in this run's output are already held by rows ` +
            `this run does not own. One id, two writers: replacing the existing row would ` +
            `discard something a person put there, and skipping the derived one would drop ` +
            `real evidence. Nothing was written.`,
        },
      ]),
    };
  }

  // 6. Walk the existing document IN ORDER, so a refresh does not reshuffle a person's page.
  const added: AddedLeaflet[] = [];
  const kept: KeptLeaflet[] = [];
  const updated: UpdatedLeaflet[] = [];
  const carriedForward: CarriedForwardLeaflet[] = [];
  const wouldDrop: WouldDropLeaflet[] = [];
  const merged: Leaflet[] = [];

  const disposition: UnDerivedDisposition = request.unDerived ?? "retain";
  const established = request.establishedDropCauses;

  for (const leaflet of existing.leaflets) {
    if (!isIntakeOwned(leaflet)) {
      // Everything a human touched lands here, byte-identical. This is the line the broken
      // --force path did not have.
      carriedForward.push(
        Object.freeze({
          id: leaflet.id,
          reason: leaflet.provenance === undefined ? "no-provenance" : "foreign-source",
          source: leaflet.provenance?.source ?? null,
        }),
      );
      merged.push(leaflet);
      continue;
    }

    const rederived = derivedById.get(leaflet.id);
    if (rederived === undefined) {
      const cause: DropCause = established?.get(leaflet.id) ?? "not-re-derived";
      wouldDrop.push(
        Object.freeze({
          id: leaflet.id,
          cause,
          ref: leaflet.provenance?.ref ?? "",
          outcome: disposition,
        }),
      );
      if (disposition === "retain") merged.push(leaflet);
      continue;
    }

    const changed = changedFields(leaflet, rederived);
    const { leaflet: mergedLeaflet, droppedVisibility } = carryConsent(leaflet, rederived);
    // A re-read is not a change: when the only field that moved is `observedAt` — the instant
    // of THIS read — the row on disk stays as it was, first observation included. Unless the
    // update path would drop a share decision, which must still happen and still be reported.
    const reObservedOnly =
      changed.length === 1 && changed[0] === "provenance.observedAt" && !droppedVisibility;
    if (changed.length === 0 || reObservedOnly) {
      kept.push(Object.freeze({ id: leaflet.id, reason: "re-derived-identical" }));
      merged.push(leaflet);
    } else {
      updated.push(
        Object.freeze({
          id: leaflet.id,
          reason: "re-derived-changed",
          // A dropped visibility is reported IN THE SAME LIST as every other moved field —
          // not a separate flag a caller could forget to check.
          changed: Object.freeze(
            droppedVisibility ? [...changed, "visibility"].sort() : changed,
          ),
        }),
      );
      // Replaced IN PLACE — not appended — so a re-run cannot duplicate a leaflet it already
      // has, which is the other half of what "68 leaflets" meant. Carrying `visibility` and
      // `body` forward is the other half of THIS file's rule: intake owns the fields it
      // derives, never the ones only a human could have set.
      merged.push(mergedLeaflet);
    }
  }

  // 7. Whatever the run produced that the document did not already hold, in the run's order.
  const existingIds = new Set<LeafletId>(existing.leaflets.map((l) => l.id));
  for (const leaflet of request.derived) {
    if (existingIds.has(leaflet.id)) continue;
    added.push(Object.freeze({ id: leaflet.id, reason: "new-this-run" }));
    merged.push(leaflet);
  }

  return {
    ok: true,
    leaf: Object.freeze({
      // Intake owns only the derived rows. The owner's headline and exact featured choices
      // survive even when a selected record becomes unavailable in this refresh.
      ...existing,
      leaflets: Object.freeze(merged),
    }),
    added: Object.freeze(added),
    kept: Object.freeze(kept),
    updated: Object.freeze(updated),
    carriedForward: Object.freeze(carriedForward),
    wouldDrop: Object.freeze(wouldDrop),
  };
}
