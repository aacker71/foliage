/**
 * ONE SHARED STEP for all three propose producers in `apps/leaf/harvest.mjs` — `propose`,
 * `propose-photos`, `propose-brain` — extracted so the target-binding rule cannot fork across
 * producers a third way.
 *
 * PR #17 REVIEW, BLOCKER 1. Before this file existed, `propose` alone preserved an existing
 * `subject`/`leafId` binding across a `--into`-less `--force` refresh; `proposePhotos` and
 * `proposeBrain` each built `{ candidates }` with no binding fields at all. LIVE REPRODUCED by
 * the review: `propose --into leaf.json` (bound), then `propose-photos --out <same path>
 * --force` — an equally documented, equally unremarkable refresh — and the document lost both
 * fields, the identical clobber one producer over. That is exactly the lesson PR-16 already
 * named: a rule that lives in more than one producer is a rule free to disagree with itself, and
 * copying it correctly into a SECOND place is no guarantee a THIRD place gets it right. One
 * function, called identically by all three, closes this by construction — a fourth producer
 * inherits the fix rather than needing to remember it.
 *
 * The prior document is read here AFTER slow source/model work. Callers hold the shared
 * cross-process document locks from this fresh read through validation and writeDocument.
 * Synchronous code alone cannot prevent another process from saving a decision in between.
 * This function only reads and computes; producers own locking and publication of the result.
 */

import { readFileSync } from "node:fs";

import {
  gitLineage,
  mergeGitQueue,
  parseHarvestDocument,
  reviewSubjectDigest,
  withCandidates,
  type DraftTitle,
  type HarvestCandidate,
  type HarvestDocument,
  type HarvestDocumentIssue,
  type QueueCommit,
} from "@foliage/photosynthesis";
import { isImportedObservationCandidate } from "./integrationImport.ts";

/** What a real `--into <leaf.json>` resolves to — just enough to check and record a binding. */
export interface ProposeTarget {
  readonly subject: string;
  readonly id: string;
}

/** One candidate's shape, minimal enough to fit all three producers' own candidate types. */
export interface CarriableCandidate {
  readonly id: string;
  readonly title: string;
  readonly evidence: ReadonlyArray<{ readonly source: string; readonly ref: string }>;
  /** Required on every real candidate shape; `reviewSubjectDigest` needs it too. */
  readonly extractor: string;
  readonly review: { readonly state: string; readonly by?: string };
  readonly shownPages?: readonly unknown[];
  readonly media?: readonly unknown[];
}

/** Either half of a binding, independently — the same optionality `HarvestDocument` allows. */
export interface Binding {
  readonly subject?: string;
  readonly leafId?: string;
}

export type PrepareProposedDocumentResult<C extends CarriableCandidate> =
  | {
      readonly ok: true;
      /** Exactly what the caller should `JSON.stringify` and write — already gate-validated. */
      readonly document: {
        readonly subject?: string;
        readonly leafId?: string;
        readonly repo?: string;
        readonly candidates: readonly (C | HarvestCandidate)[];
      };
      readonly carried: number;
      readonly reopened: readonly string[];
      /** Ids this run drafted: every incoming candidate, or the git drafts the merge (re)built. */
      readonly drafted: readonly string[];
      /** Undecided git drafts this run removed: every ref they held is gone or now decided. */
      readonly withdrawn: readonly string[];
      /** Attributed commits a decision already holds. Zero outside the git producer. */
      readonly held: number;
      /** Non-null only when this run gave no target and an existing binding was kept instead —
       * the caller's cue to print that it did, so preserving one is never indistinguishable from
       * having none. */
      readonly bindingPreservedWithoutTarget: Binding | null;
    }
  | {
      /** `target` disagreed with whatever is ALREADY on disk — a rebind, not a drift. Only
       * `propose` can ever produce this: it is the one producer with a `target` to disagree. */
      readonly ok: false;
      readonly cause: "rebind-disagreement";
      readonly existing: Binding;
      readonly attempted: ProposeTarget;
    }
  | {
      /** Unreachable from a real caller's own candidates — guarded anyway, the same self-check
       * discipline every write in this app already applies to its own output. */
      readonly ok: false;
      readonly cause: "invalid-document";
      readonly issues: readonly HarvestDocumentIssue[];
    };

/**
 * Only ENOENT means absent. Unreadable, malformed and invalid bytes must survive a refresh.
 */
function readExisting(path: string): HarvestDocument | undefined {
  try {
    const parsed = parseHarvestDocument(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.ok) throw new Error(`invalid harvest: ${parsed.issues.map(i => `${i.at}: ${i.message}`).join("; ")}`);
    return parsed.harvest;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error(`Cannot refresh ${path}; prior bytes were preserved: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * A document's binding, or `null` when it carries NEITHER field. Both-absent is not "bound to
 * nothing" in the sense a mismatch check would refuse — it is simply nothing to carry, which is
 * why this collapses the two optional fields into one nullable shape rather than exposing
 * `undefined`/`undefined` for the caller to re-derive the same fact twice.
 */
function bindingOf(doc: HarvestDocument | undefined): Binding | null {
  if (doc === undefined) return null;
  if (doc.subject === undefined && doc.leafId === undefined) return null;
  // Conditional spread, not a direct assignment: `exactOptionalPropertyTypes` is on, and a
  // present-but-`undefined`-valued key is a different value than an absent one under that flag.
  return {
    ...(doc.subject === undefined ? {} : { subject: doc.subject }),
    ...(doc.leafId === undefined ? {} : { leafId: doc.leafId }),
  };
}

/**
 * Carry review decisions forward across a --force re-propose.
 *
 * WITHOUT THIS, a refresh silently destroyed review work — measured 2026-08-23: approve two
 * clusters, commit more work, `foliage grow` again, and both were back to "candidate". An
 * approval vanishing is wasted work; a REJECTION vanishing is worse — the discarded thing
 * quietly reapplies for the leaf. Same bug class the leaf side fixed in f3ac6f2, one document up.
 *
 * THE RULE IS THE REVIEW GATE'S OWN: an approval covers exactly what the reviewer saw. So a
 * decision carries forward ONLY when the candidate is what they decided on — same id, same
 * title, same evidence ref set. If the evidence or title changed, the decision does NOT stretch
 * to cover material nobody looked at: the candidate REOPENS, and the reopening is printed with
 * the old decision named, never silent.
 *
 * PURE: returns a NEW candidate array rather than editing the one it was given.
 *
 * Photos and brain only. The git producer never reopens: its decided candidates are frozen and new
 * commits come back as their own draft (`mergeGitQueue`).
 */
function carryDecisionsForward<C extends CarriableCandidate>(
  previous: HarvestDocument | undefined,
  candidates: readonly C[],
): { candidates: C[]; carried: number; reopened: string[] } {
  const untouched = { candidates: [...candidates], carried: 0, reopened: [] as string[] };
  if (previous === undefined) return untouched; // ENOENT only; unreadable prior bytes are refused
  const old = new Map(previous.candidates.map((c) => [String(c.id), c]));
  let carried = 0;
  const reopened: string[] = [];
  const refs = (c: {
    readonly evidence: ReadonlyArray<{ readonly source: string; readonly ref: string }>;
  }) => c.evidence.map((e) => `${e.source}\u0000${e.ref}`).sort().join("\n");
  /*
   * WHAT A DECISION MAY STRETCH TO COVER — found 2026-08-24, cross-model, and the shape of the
   * bug is this repo's oldest: the claim (the recorded approval) and the effect (what promotion
   * publishes) were derived from DIFFERENT values. This compare used title + sorted source/ref
   * pairs, while promote lifts each evidence EXCERPT into public body text — so a refresh that
   * added excerpts under an old approval published words nobody reviewed.
   *
   * Decisions recorded since carry `review.subjectDigest` — the canonical hash of everything
   * publish-affecting (`reviewSubjectDigest`, one function, no hand-picked field list) — and
   * carry-forward is digest equality, nothing else. LEGACY decisions (no digest) keep the old
   * equality PLUS a hard guard: they may not carry onto a draft holding material classes the old
   * compare never looked at (an excerpt, media, shown pages). Equal-by-the-old-rule AND
   * nothing-new-to-cover is the most a legacy record can honestly claim; it is then upgraded with
   * the fresh digest so the strict path takes over from here on.
   */
  const legacyExtras = (c: { media?: unknown; shownPages?: unknown; evidence: readonly { excerpt?: unknown }[] }) =>
    (Array.isArray(c.media) && c.media.length > 0) ||
    (Array.isArray(c.shownPages) && c.shownPages.length > 0) ||
    c.evidence.some((e) => e.excerpt !== undefined);
  const merged = candidates.map((now) => {
    const was = old.get(String(now.id));
    if (was === undefined || was.review.state === "candidate") return now;
    const nowDigest = reviewSubjectDigest(now);
    const wasDigest = (was.review as { subjectDigest?: string }).subjectDigest;
    const covers =
      wasDigest !== undefined
        ? wasDigest === nowDigest
        : was.title === now.title && refs(was) === refs(now) && !legacyExtras(now as never);
    if (covers) {
      carried += 1;
      return { ...now, review: { ...was.review, subjectDigest: nowDigest } as unknown as C["review"] };
    }
    reopened.push(
      `${now.id} — REOPENED: the ${was.review.state === "approved" ? "approval" : "rejection"} by ` +
        `${was.review.by} covered different material than this draft holds` +
        `${
          wasDigest === undefined && was.title === now.title && refs(was) === refs(now)
            ? " (it predates review-subject digests, and this draft carries material — an excerpt, media or shown pages — that old decisions never saw)"
            : ""
        }. A decision does not stretch to cover what nobody looked at.`,
    );
    return now;
  });
  return { candidates: merged, carried, reopened };
}

/**
 * What a producer hands the shared step. Photos and brain hand finished candidates, and decisions
 * carry forward by digest. Git hands commits: decided candidates are frozen and new material is
 * drafted around them (`mergeGitQueue`), so an approval is never reopened by new work.
 */
export type ProposedMaterial<C extends CarriableCandidate> =
  | { readonly mode: "carry"; readonly candidates: readonly C[] }
  | {
      readonly mode: "git";
      readonly commits: readonly QueueCommit[];
      /** False for a narrowed read: drafts it did not see are kept, not dropped. */
      readonly complete: boolean;
      /**
       * Every sha still in the repository: this walk's commits, whoever they are attributed to,
       * and what the collector's other checkouts hold. A draft whose refs are here stays queued.
       */
      readonly present: ReadonlySet<string>;
      /** Commits never drafted again beyond what decided candidates hold (legacy packet decisions). */
      readonly heldExtra: ReadonlySet<string>;
      readonly observedAt: string;
      /** Local-model titles for exact drafts, keyed by `draftKey`. */
      readonly titles?: ReadonlyMap<string, DraftTitle>;
      /** The extractor this run was asked to title with, when one was asked for. */
      readonly extractor?: string;
    };

const isDecided = (c: { readonly review: { readonly state: string } }): boolean => c.review.state !== "candidate";

function mergeMaterial<C extends CarriableCandidate>(
  previous: HarvestDocument | undefined,
  material: ProposedMaterial<C>,
): {
  readonly candidates: readonly (C | HarvestCandidate)[];
  readonly carried: number;
  readonly reopened: readonly string[];
  readonly drafted: readonly string[];
  readonly withdrawn: readonly string[];
  readonly held: number;
} {
  switch (material.mode) {
    case "carry": {
      const report = carryDecisionsForward(previous, material.candidates);
      // An unrelated photo/brain refresh owns neither the explicitly imported snapshots nor the git
      // queue. Both stay, with their decisions, in the same document; absence is not deletion.
      const incomingIds = new Set(material.candidates.map((candidate) => String(candidate.id)));
      const passed = previous?.candidates.filter((candidate) =>
        (isImportedObservationCandidate(candidate) || gitLineage(candidate.id) !== null) &&
        !incomingIds.has(String(candidate.id))) ?? [];
      return {
        candidates: [...report.candidates, ...passed],
        carried: report.carried + passed.filter(isDecided).length,
        reopened: report.reopened,
        drafted: material.candidates.map((candidate) => String(candidate.id)),
        withdrawn: [],
        held: 0,
      };
    }
    case "git": {
      const merged = mergeGitQueue({
        previous,
        commits: material.commits,
        present: material.present,
        heldExtra: material.heldExtra,
        observedAt: material.observedAt,
        complete: material.complete,
        ...(material.titles === undefined ? {} : { titles: material.titles }),
        ...(material.extractor === undefined ? {} : { extractor: material.extractor }),
      });
      return {
        candidates: merged.document.candidates,
        carried: merged.document.candidates.filter(isDecided).length,
        reopened: [],
        drafted: merged.drafted,
        withdrawn: merged.withdrawn,
        held: merged.held,
      };
    }
    default: {
      const impossible: never = material;
      throw new Error(`unhandled proposed material: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * The repository an existing queue's git work came from, with its decisions and the drafts still
 * waiting for one, or null when there is nothing a different repository could mix into or replace.
 * A waiting draft counts: the git merge withdraws a draft whose commits the repository it reads
 * does not hold, so another repository's run would discard it without a word. The caller compares
 * repositories (git I/O) under the document lock, before `prepareProposedDocument` merges. `refs`
 * are the commits the waiting drafts name, so a queue with no decision can still be judged by them
 * when the recorded repository cannot be read (`queueRepositoryMatch`).
 */
export function queuedRepository(out: string): {
  readonly repo: string;
  readonly decided: readonly string[];
  readonly waiting: readonly string[];
  readonly refs: readonly string[];
} | null {
  const previous = readExisting(out);
  const git = (previous?.candidates ?? []).filter((c) => gitLineage(c.id) !== null);
  const decided = git.filter(isDecided).map((c) => String(c.id));
  const waiting = git.filter((c) => !isDecided(c)).map((c) => String(c.id));
  const refs = git.filter((c) => !isDecided(c)).flatMap((c) => c.evidence.map((e) => e.ref));
  return previous?.repo === undefined || decided.length + waiting.length === 0 ? null : { repo: previous.repo, decided, waiting, refs };
}

/**
 * THE SHARED STEP. See the file header for the full argument; in one sentence: read `out` fresh
 * — right now, at call time — decide the binding (this run's own `target` if given, refusing a
 * disagreement with what is already there; otherwise whatever is already recorded, carried
 * forward), carry review decisions forward the same way, assemble the document, and validate it
 * with the real gate.
 *
 * SYNCHRONOUS, deliberately — see BLOCKER 2 above. Nothing here `await`s anything, so nothing can
 * run on the event loop between this function's own read and whatever the caller does next.
 */
export function prepareProposedDocument<C extends CarriableCandidate>(args: ProposedMaterial<C> & {
  readonly out: string;
  /** The real leaf this run's own `--into` named, if it named one. `undefined` for the two
   * producers (`propose-photos`, `propose-brain`) that have no `--into` flag at all — they can
   * still carry an existing binding forward, they simply cannot disagree with one. */
  readonly target: ProposeTarget | undefined;
  /**
   * The repository this run drafted from, absolute — or undefined for a producer that has no
   * repository (photos, brain). Recorded on the document so `foliage grow` can tell a legitimate
   * reopen (same repository, material changed) from a queue being replaced by a different
   * repository's work, which silently discards decisions.
   */
  readonly repo?: string;
}): PrepareProposedDocumentResult<C> {
  const previous = readExisting(args.out);
  const previousBinding = bindingOf(previous);

  if (args.target !== undefined && previousBinding !== null) {
    const subjectDiffers =
      previousBinding.subject !== undefined && previousBinding.subject !== args.target.subject;
    const leafIdDiffers =
      previousBinding.leafId !== undefined && previousBinding.leafId !== args.target.id;
    if (subjectDiffers || leafIdDiffers) {
      return {
        ok: false,
        cause: "rebind-disagreement",
        existing: previousBinding,
        attempted: args.target,
      };
    }
  }

  const merged = mergeMaterial(previous, args);
  // THE BINDING TO WRITE: this run's own target wins when given (already checked above for
  // disagreement); absent a target, an EXISTING binding is CARRIED FORWARD rather than dropped —
  // exactly like a review decision, and for the same reason: a fact nobody re-decided does not
  // silently revert because an unrelated flag, or an entirely different producer, ran instead.
  const binding: Binding | undefined =
    args.target !== undefined
      ? { subject: args.target.subject, leafId: args.target.id }
      : previousBinding ?? undefined;

  // THE ONE REASSEMBLY POINT, ledger F-024: `withCandidates` (`@foliage/photosynthesis`) is the
  // same function `decide()` and `recordDecision()` now call to replace candidates without
  // dropping whatever else the document carries.
  const document = withCandidates(
    {
      ...(binding ?? {}),
      /*
       * THIS RUN'S REPOSITORY WINS, and the previous document's is carried when this producer has
       * none (photos and brain have no repository). Recorded rather than inferred, and never
       * guessed: absent means unchecked, which is what an older document carries.
       */
      ...(args.repo !== undefined
        ? { repo: args.repo }
        : previous?.repo === undefined
          ? {}
          : { repo: previous.repo }),
    },
    merged.candidates,
  );
  const validated = parseHarvestDocument(JSON.parse(JSON.stringify(document)));
  if (!validated.ok) {
    return { ok: false, cause: "invalid-document", issues: validated.issues };
  }

  return {
    ok: true,
    document,
    carried: merged.carried,
    reopened: merged.reopened,
    drafted: merged.drafted,
    withdrawn: merged.withdrawn,
    held: merged.held,
    bindingPreservedWithoutTarget:
      args.target === undefined && previousBinding !== null ? previousBinding : null,
  };
}
