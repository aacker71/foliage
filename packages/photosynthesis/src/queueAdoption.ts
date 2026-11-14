/**
 * QUEUE ADOPTION — the one-time plan that lands approvals the leaf could not take.
 *
 * THE CORPSE, measured 2026-09-28 on a garden in use (read-only): approved clusters that never
 * reached the leaf. Each had been promoted once, then grew by new commits and was approved
 * again. Promotion refused every re-approval: the harvest carried no target binding (so nothing
 * on it was trusted to replace a leaflet), and most of them had a newer primary ref than their
 * leaflet. The approvals stood in the harvest and the
 * leaf kept the older bodies.
 *
 * This plan says exactly what adoption would change, and refuses by name when any of it would lose
 * something. It records the binding the harvest lacks (subject and leaf id, read off the leaf; the
 * repository, handed in), dates every git ref with its author date, and lists the approved
 * candidates whose private leaflet the approval extends. The caller runs `promoteApproved` with
 * permission for exactly those ids; `promote.ts` still makes every one of its own checks.
 *
 * AN EXTENSION LOSES NOTHING, and each clause below is what makes that true:
 *   - the leaflet was made by this candidate's extractor (never a git row or a hand-written one);
 *   - every ref it holds is among the candidate's refs, so the replacement only adds evidence;
 *   - it carries nothing promotion does not rebuild — no unknown key, no media the candidate does
 *     not carry, no text other than the commit subject the reviewer saw;
 *   - it is private, so no shared page changes under anyone's eyes;
 *   - it is pending, the tier promotion writes — a verified leaflet would come back pending;
 *   - no achievement citation that resolves to it today would stop resolving: promotion rebuilds
 *     every ref with the approval's `observedAt`, and a citation matches on the exact triple;
 *   - the approval's recorded digest is the candidate as it stands, so the body that lands is the
 *     body that was approved. The same holds for an approval that is APPENDED: no leaflet to
 *     extend does not mean nothing to check.
 * IN THE LEAF means the approved body is there — title, refs, and each ref's excerpt and media.
 * A leaflet that matches on title and refs but lacks approved words is judged as an extension.
 * Any clause failing refuses the WHOLE plan, named, rather than landing the rest: this runs once,
 * by the owner's hand, and a partial adoption is a second migration nobody planned.
 *
 * THE DATES NEVER MOVE A DECISION. `authoredAt` is outside the review digest by construction; the
 * plan still recomputes every decided digest after the backfill and refuses if one moved, so a
 * future change to the digest cannot slip through this door.
 *
 * A HELD COMMIT MAY BE UNDATED. The caller hands in every commit the repository holds, with the
 * `%aI` git printed for it. A commit with no author date, or one git cannot print as an instant
 * (`%aI` verbatim, a `+99:99` offset, a five-digit year), is held and stays undated: it is never
 * refused as missing, and the plan never writes a date the harvest loader would reject.
 *
 * PURE and TOTAL: no fs, no git, no clock. The caller reads the repository and hands in the dates.
 */

import {
  isIsoInstant,
  isMediaBodyElement,
  leafletVisibility,
  resolveClaimCitation,
  type ClaimCitation,
  type Leaf,
  type Leaflet,
  type LeafletMedia,
} from "@foliage/leaf";

import {
  reviewSubjectDigest,
  withCandidates,
  type HarvestCandidate,
  type HarvestDocument,
  type HarvestEvidence,
} from "./harvestDocument.ts";
import { buildPromotedLeaflet, PROMOTED_SOURCE_PREFIX } from "./promote.ts";

/** One approved candidate whose private leaflet the approval extends. */
export interface QueueExtension {
  readonly id: string;
  readonly oldTitle: string;
  readonly approvedTitle: string;
  /** Refs the approval holds and the leaflet does not, in the candidate's order. */
  readonly refsAdded: readonly string[];
  /** Refs the leaflet holds without an approved excerpt or media of theirs, in the candidate's order. */
  readonly refsFilled: readonly string[];
}

export interface QueueAdoptionPlan {
  readonly binding: { readonly subject: string; readonly leafId: string };
  readonly repo: string;
  /** The harvest to write: binding and repository recorded, git refs dated. */
  readonly adopted: HarvestDocument;
  /** Evidence entries this plan dates. */
  readonly backfill: number;
  readonly extensions: readonly QueueExtension[];
  /** Approved candidates the leaf already holds, ref for ref. */
  readonly inLeaf: readonly string[];
  /** Approved candidates with no leaflet yet: promotion appends them, private. */
  readonly waiting: readonly string[];
  /** True when there is nothing left to record, date, extend or append. */
  readonly alreadyAdopted: boolean;
}

export type QueueAdoptionCause =
  | "binding-mismatch"
  | "missing-commit"
  | "digest-changed"
  | "foreign-leaflet"
  | "extra-fields"
  | "refs-removed"
  | "not-private"
  | "not-pending"
  | "cited";

export type QueueAdoption =
  | { readonly ok: true; readonly plan: QueueAdoptionPlan }
  | {
      readonly ok: false;
      readonly cause: QueueAdoptionCause;
      /**
       * What is refused, named: candidate ids, except the missing shas for `missing-commit` and
       * the disagreeing fields (subject, leafId, repo) for `binding-mismatch`.
       */
      readonly ids: readonly string[];
    };

/** The plain label for each refusal. Exhaustive: a new cause is a compile error here. */
export function adoptionRefusalLabel(cause: QueueAdoptionCause): string {
  switch (cause) {
    case "binding-mismatch":
      return "Queue belongs to another leaf or repository";
    case "missing-commit":
      return "Commits missing from the repository";
    case "digest-changed":
      return "Approved material changed since approval";
    case "foreign-leaflet":
      return "Leaflet made by something else";
    case "extra-fields":
      return "Leaflet holds more than promotion rebuilds";
    case "refs-removed":
      return "Leaflet holds commits the approval does not";
    case "not-private":
      return "Leaflet is shared";
    case "not-pending":
      return "Leaflet is not pending";
    case "cited":
      return "Achievement citation would go stale";
    default: {
      const unhandled: never = cause;
      return unhandled;
    }
  }
}

/** Refusals are reported in this order; the first cause that names anything wins. */
const CAUSE_ORDER: readonly QueueAdoptionCause[] = [
  "binding-mismatch",
  "missing-commit",
  "digest-changed",
  "foreign-leaflet",
  "extra-fields",
  "refs-removed",
  "not-private",
  "not-pending",
  "cited",
];

/** The leaflet keys promotion rebuilds. Anything else on a replaced leaflet would be lost. */
const REBUILT_KEYS: ReadonlySet<string> = new Set(["id", "title", "tier", "provenance", "body", "visibility"]);

const isGitRef = (e: HarvestEvidence): boolean => e.source === "git";

const refsOf = (leaflet: Leaflet): readonly string[] => [
  ...(leaflet.provenance === undefined ? [] : [leaflet.provenance.ref]),
  ...(leaflet.body ?? []).map((e) => e.provenance.ref),
];

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** The author date git printed for `ref`, when it is an instant the harvest can hold. */
const authorDateOf = (dates: ReadonlyMap<string, string>, ref: string): string | undefined => {
  const printed = dates.get(ref);
  return printed !== undefined && isIsoInstant(printed) ? printed : undefined;
};

/** Date one candidate's git refs that carry no author date yet. */
function dated(candidate: HarvestCandidate, dates: ReadonlyMap<string, string>): HarvestCandidate {
  const evidence = candidate.evidence.map((e) => {
    const authoredAt = isGitRef(e) && e.authoredAt === undefined ? authorDateOf(dates, e.ref) : undefined;
    return authoredAt === undefined ? e : Object.freeze({ ...e, authoredAt });
  });
  return evidence.every((e, i) => e === candidate.evidence[i])
    ? candidate
    : Object.freeze({ ...candidate, evidence: Object.freeze(evidence) });
}

/**
 * Whether replacing `leaflet` with `replacement` would turn an achievement citation that resolves
 * today into a stale one. `undefined` is a candidate with no evidence, which promotion never
 * builds: every current citation into it would be lost.
 */
function breaksCitation(leaf: Leaf, leaflet: Leaflet, replacement: Leaflet | undefined): boolean {
  const after: Leaf = { ...leaf, leaflets: leaf.leaflets.map((l) => (l.id === leaflet.id && replacement !== undefined ? replacement : l)) };
  const current = (doc: Leaf, citation: ClaimCitation): boolean => resolveClaimCitation(doc, citation).status === "current";
  return (leaf.achievements ?? [])
    .flatMap((a) => a.claims.flatMap((claim) => claim.citations ?? []))
    .filter((citation) => citation.leaflet === leaflet.id)
    .some((citation) => current(leaf, citation) && (replacement === undefined || !current(after, citation)));
}

/** One body element as promotion writes it or a leaflet holds it: the ref, its words, its media. */
interface Element {
  readonly ref: string;
  readonly text: string | undefined;
  readonly media: LeafletMedia | undefined;
}

/** Every element promotion writes for `candidate`, one per evidence entry — a repeated ref stays two elements. */
function approvedBody(candidate: HarvestCandidate): readonly Element[] {
  const media = new Map((candidate.media ?? []).map((m) => [m.ref, m.media] as const));
  return candidate.evidence.map((e) => ({ ref: e.ref, text: e.excerpt, media: media.get(e.ref) }));
}

const heldBody = (leaflet: Leaflet): readonly Element[] =>
  (leaflet.body ?? []).map((e) => ({ ref: e.provenance.ref, text: e.text, media: isMediaBodyElement(e) ? e.media : undefined }));

const mediaKey = (media: LeafletMedia | undefined): string =>
  JSON.stringify(
    media === undefined
      ? null
      : [media.mediaType, ...(media.dimensions.known ? [media.dimensions.width, media.dimensions.height] : [media.dimensions.why])],
  );

const elementKey = (e: Element): string => JSON.stringify([e.ref, e.text ?? null, mediaKey(e.media)]);

/** Whether replacing `leaflet` would drop something it carries: an unknown key, or words or media no approved element of its ref holds. */
function carriesMore(leaflet: Leaflet, held: readonly Element[], approved: readonly Element[]): boolean {
  if (Object.keys(leaflet).some((key) => !REBUILT_KEYS.has(key))) return true;
  return held.some(
    (h) =>
      (h.text !== undefined || h.media !== undefined) &&
      !approved.some(
        (a) =>
          a.ref === h.ref &&
          (h.text === undefined || h.text === a.text) &&
          (h.media === undefined || mediaKey(h.media) === mediaKey(a.media)),
      ),
  );
}

type Verdict =
  | { readonly kind: "waiting" }
  | { readonly kind: "in-leaf" }
  | { readonly kind: "extension"; readonly extension: QueueExtension }
  | {
      readonly kind: "refused";
      readonly cause: "foreign-leaflet" | "extra-fields" | "refs-removed" | "not-private" | "not-pending" | "cited";
    };

/** What adoption does with one APPROVED candidate, given the leaflet of its id (if any) in `leaf`. */
function verdictFor(candidate: HarvestCandidate, leaflet: Leaflet | undefined, leaf: Leaf): Verdict {
  if (leaflet === undefined) return { kind: "waiting" };
  const refs = new Set(candidate.evidence.map((e) => e.ref));
  const held = new Set(refsOf(leaflet));
  const approved = approvedBody(candidate);
  const body = heldBody(leaflet);
  // In the leaf means the approved BODY is there, element for element — not merely its title and refs.
  if (sameSet(refs, held) && leaflet.title === candidate.title && sameSet(new Set(body.map(elementKey)), new Set(approved.map(elementKey)))) {
    return { kind: "in-leaf" };
  }
  if (leaflet.provenance?.source !== `${PROMOTED_SOURCE_PREFIX}${candidate.extractor}`) {
    return { kind: "refused", cause: "foreign-leaflet" };
  }
  if (carriesMore(leaflet, body, approved)) return { kind: "refused", cause: "extra-fields" };
  if ([...held].some((ref) => !refs.has(ref))) return { kind: "refused", cause: "refs-removed" };
  if (leafletVisibility(leaflet) !== "private") return { kind: "refused", cause: "not-private" };
  if (leaflet.tier !== "pending") return { kind: "refused", cause: "not-pending" };
  const primary = candidate.evidence[0];
  const replacement = primary === undefined ? undefined : buildPromotedLeaflet(candidate, primary, leaflet.visibility);
  if (breaksCitation(leaf, leaflet, replacement)) return { kind: "refused", cause: "cited" };
  return {
    kind: "extension",
    extension: Object.freeze({
      id: candidate.id,
      oldTitle: leaflet.title,
      approvedTitle: candidate.title,
      refsAdded: Object.freeze([...refs].filter((ref) => !held.has(ref))),
      refsFilled: Object.freeze([
        ...new Set(approved.filter((a) => held.has(a.ref) && !body.some((h) => elementKey(h) === elementKey(a))).map((a) => a.ref)),
      ]),
    }),
  };
}

/**
 * Plan the adoption of `harvest` into `leaf`, with `dates` (every commit `repo` holds → the `%aI`
 * git printed for it) read from `repo`. Every git ref in the harvest must be a key of `dates`: a
 * ref the repository does not hold is refused as `missing-commit`, never dated by guess. A held
 * ref whose printed date is not an instant stays undated.
 */
export function planQueueAdoption(
  harvest: HarvestDocument,
  leaf: Leaf,
  dates: ReadonlyMap<string, string>,
  repo: string,
): QueueAdoption {
  const binding = Object.freeze({ subject: leaf.subject, leafId: leaf.id as string });

  const candidates = harvest.candidates.map((c) => dated(c, dates));
  const backfill = candidates.reduce(
    (n, c, i) => n + c.evidence.filter((e, j) => e !== harvest.candidates[i]?.evidence[j]).length,
    0,
  );

  const leafletById = new Map(leaf.leaflets.map((l) => [l.id as string, l] as const));
  const verdicts = candidates
    .filter((c) => c.review.state === "approved")
    .map((c) => ({ candidate: c, verdict: verdictFor(c, leafletById.get(c.id), leaf) }));
  const idsWhere = (test: (v: Verdict) => boolean): readonly string[] =>
    verdicts.filter(({ verdict }) => test(verdict)).map(({ candidate }) => candidate.id as string);
  const refusedAs = (cause: Extract<Verdict, { kind: "refused" }>["cause"]): readonly string[] =>
    idsWhere((v) => v.kind === "refused" && v.cause === cause);
  const extensions = verdicts.flatMap(({ verdict }) => (verdict.kind === "extension" ? [verdict.extension] : []));
  const waiting = idsWhere((v) => v.kind === "waiting");
  // Every candidate adoption writes into the leaf: replaced in place, or appended.
  const lands: ReadonlySet<string> = new Set([...extensions.map((e) => e.id), ...waiting]);

  const refusals: Readonly<Record<QueueAdoptionCause, readonly string[]>> = {
    "binding-mismatch": [
      ...(harvest.subject !== undefined && harvest.subject !== binding.subject ? ["subject"] : []),
      ...(harvest.leafId !== undefined && harvest.leafId !== binding.leafId ? ["leafId"] : []),
      ...(harvest.repo !== undefined && harvest.repo !== repo ? ["repo"] : []),
    ],
    "missing-commit": [
      ...new Set(harvest.candidates.flatMap((c) => c.evidence.filter(isGitRef).map((e) => e.ref))),
    ]
      .filter((ref) => !dates.has(ref))
      .sort(),
    // An approval covers the candidate it was recorded against: the backfill must not move any
    // decided digest, and whatever lands — extended or appended — is the body its approval's digest names.
    "digest-changed": candidates
      .filter((c, i) => {
        if (c.review.state === "candidate") return false;
        const before = harvest.candidates[i];
        if (before === undefined || reviewSubjectDigest(c) !== reviewSubjectDigest(before)) return true;
        return lands.has(c.id) && c.review.subjectDigest !== reviewSubjectDigest(c);
      })
      .map((c) => c.id as string),
    "foreign-leaflet": refusedAs("foreign-leaflet"),
    "extra-fields": refusedAs("extra-fields"),
    "refs-removed": refusedAs("refs-removed"),
    "not-private": refusedAs("not-private"),
    "not-pending": refusedAs("not-pending"),
    cited: refusedAs("cited"),
  };
  const first = CAUSE_ORDER.find((cause) => refusals[cause].length > 0);
  if (first !== undefined) return { ok: false, cause: first, ids: Object.freeze([...refusals[first]]) };

  const adopted: HarvestDocument = Object.freeze({
    ...withCandidates({ subject: binding.subject, leafId: binding.leafId, repo }, Object.freeze(candidates)),
  });
  const recorded = harvest.subject !== undefined && harvest.leafId !== undefined && harvest.repo !== undefined;
  return {
    ok: true,
    plan: Object.freeze({
      binding,
      repo,
      adopted,
      backfill,
      extensions: Object.freeze(extensions),
      inLeaf: idsWhere((v) => v.kind === "in-leaf"),
      waiting,
      alreadyAdopted: recorded && backfill === 0 && extensions.length === 0 && waiting.length === 0,
    }),
  };
}
