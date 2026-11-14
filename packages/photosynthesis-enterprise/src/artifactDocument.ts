/**
 * The ENTERPRISE ARTIFACT DOCUMENT — the on-disk form of organizational portfolio candidates,
 * and the total function that turns untrusted JSON into one.
 *
 * WHY A THIRD FORMAT AND NOT A FLAG ON THE HARVEST. A harvest candidate belongs to the person
 * whose machine drafted it; the review is theirs and the promotion target is their own leaf.
 * An enterprise artifact carries three things a harvest candidate structurally cannot:
 *
 *   ITS SUBJECT MAY NOT BE A PERSON  — see subject.ts. A branch artifact (a team's) has no
 *   single owner, and the format must be able to say so rather than picking one.
 *
 *   ITS REVIEWER ACTED IN A ROLE     — in the open plane the reviewer IS the subject. Here they
 *   are usually not, so `role` records which capacity the reviewer acted in, using
 *   @foliage/enterprise-policy's `Actor` rather than a second vocabulary for the same idea.
 *
 *   ITS RELEASE IS GOVERNED          — an artifact carries a `ReleaseState` from the policy
 *   machine. It is a FIELD here and a TRANSITION there; release.ts is the only door between
 *   them, and it drives `applyEvent` rather than assigning the field itself. Because it is a
 *   field, THIS PARSER IS THE SECOND DOOR of the review gate: a document that declares an end
 *   state its own API could never have produced is refused here, by name, or the gate on the
 *   transition would be a gate somebody can walk around. See reviewGate.ts.
 *
 * Everything else is the harvest document's discipline, unchanged and deliberately so:
 *
 *   UNKNOWN KEYS ARE REFUSED, and score-shaped keys are refused BY NAME, with `SCORE_SHAPED`
 *   IMPORTED from @foliage/leaf rather than copied — one list, now three gates, so they cannot
 *   drift. The pressure is strongest here: an "organizational intelligence layer" is exactly
 *   the product that gets asked for a per-person number, and the format has to refuse it at
 *   the door rather than in a review meeting.
 *
 *   AN ARTIFACT WITH NO EVIDENCE CANNOT EXIST. The title is prose a machine wrote; the refs
 *   are the only checkable part, and they are the ONLY thing this package will read about a
 *   person (see the charter in subject.ts).
 *
 *   A NAMED CONTRIBUTOR MUST BE INSIDE THE SUBJECT, checked with `containment` and refused
 *   with its `why`. Attributing a branch's work to somebody who is not on that branch is not a
 *   formatting error, it is a false statement about a person.
 *
 * TOTAL and PURE, exactly like `parseLeafDocument` and `parseHarvestDocument`: `unknown` in,
 * either an `EnterpriseDocument` or the complete list of reasons it is not one. No fs, no
 * network, no throw. The small validation helpers below are the third copy in this repository
 * of a deliberately duplicated shape — the RULES that must never drift (`SCORE_SHAPED`,
 * `isIsoInstant`, the release states, the actor roles) are imported, and only the local
 * plumbing is restated.
 *
 * Complexity: O(n) over artifacts, their evidence and their contributors, one pass, plus an
 * O(n) Set for duplicate artifact ids and an O(c) Set per artifact for duplicate contributors.
 */

import {
  NON_PUBLIC_STATES,
  TRANSITIONS,
  isPublic,
  type Actor,
  type ReleaseState,
} from "@foliage/enterprise-policy";
import type { ReviewState } from "@foliage/photosynthesis";
import { SCORE_SHAPED, isIsoInstant, type Provenance } from "@foliage/leaf";

import {
  boughId,
  branchId,
  containment,
  describeSubject,
  leafId,
  subjectKey,
  treeId,
  SUBJECT_KINDS,
  type BranchPath,
  type LeafSubject,
  type Subject,
  type SubjectKind,
} from "./subject.ts";
import { UNREVIEWED_RELEASE_STATES } from "./reviewGate.ts";

/** Opaque id, so an artifact id cannot be passed where a subject id is expected. */
export type EnterpriseArtifactId = string & { readonly __brand: "EnterpriseArtifactId" };
export const enterpriseArtifactId = (s: string): EnterpriseArtifactId =>
  s as EnterpriseArtifactId;

/**
 * Review, DERIVED from the open plane's `ReviewState` rather than restated beside it.
 *
 * The three states and their rules — `rejected` requires a reason, `approved` carries who and
 * when — are @foliage/photosynthesis's, and this type is built out of them with `Extract`/
 * `Exclude` so that a change there lands here instead of quietly diverging. The one thing the
 * enterprise plane adds is `role`: WHICH CAPACITY the reviewer acted in. It is on the reviewed
 * arms only, because an unreviewed candidate has no reviewer to have had a role.
 *
 * "DERIVED" WAS ONCE TRUE OF THE TYPE AND FALSE OF THE PARSER, which is the more dangerous half.
 * The type below was built with `Extract`/`Exclude`, but the two things the parser actually
 * consults at run time — the list of state names, and which keys each state may carry — were
 * hand-copied from harvestDocument.ts, where both are module-private and cannot be imported. A
 * fourth arm added there would have type-checked here and then been refused at run time by a
 * stale list: exactly the drift the derivation was supposed to prevent, wearing the word
 * "derived". They are now generated from this type instead (see `REVIEW_KEYS_BY_STATE`), so an
 * upstream change is a compile error in this file rather than a silent run-time refusal, and
 * artifactDocument.test.ts drives BOTH parsers over the same review values so the claim is
 * checked by behaviour and not only by types.
 *
 * `role` records; it does not authorise. Who may fire which release event is
 * @foliage/enterprise-policy's decision and it is made in exactly one place — restating it
 * here would give this package a second, forkable opinion about company policy.
 */
export type EnterpriseReview =
  | Extract<ReviewState, { state: "candidate" }>
  | (Exclude<ReviewState, { state: "candidate" }> & { readonly role: Actor });

/**
 * One named person's contribution to an artifact, and the evidence that names them.
 *
 * A contribution is EVIDENCE, not a portion. There is no share, no percentage and no rank —
 * the refusal and its reasoning live in ledger.ts, and the format is shaped so that a caller
 * who wanted a league table would have to build one out of counts and own that choice.
 */
export interface Contribution {
  readonly subject: LeafSubject;
  /** At least one, enforced by the parser: a named person with no refs is an assertion. */
  readonly evidence: readonly Provenance[];
}

export interface EnterpriseArtifact {
  readonly id: EnterpriseArtifactId;
  /** The DRAFT — machine-written prose. It becomes a claim only after review and release. */
  readonly title: string;
  /** Who this artifact belongs to, at whichever level of the hierarchy actually owns it. */
  readonly subject: Subject;
  /**
   * The people named on it, if any. An EMPTY list is a real and honest state: "we migrated the
   * billing platform" can belong to a branch and to no one person, and inventing names for it
   * would be exactly the fabrication this package refuses.
   */
  readonly contributors: readonly Contribution[];
  /** At least one, enforced by the parser. */
  readonly evidence: readonly Provenance[];
  /** The identity of whatever drafted this — "git-cluster", "local-model:gemma4:12b". */
  readonly extractor: string;
  readonly draftedAt: string;
  readonly review: EnterpriseReview;
  /**
   * Where the artifact stands with the company release policy. Moved only by release.ts, and a
   * value release.ts could not have produced for this `review` is refused by the parser.
   */
  readonly release: ReleaseState;
}

export interface EnterpriseDocument {
  readonly artifacts: readonly EnterpriseArtifact[];
}

/** One reason a document is not an enterprise portfolio, addressed to whoever is editing it. */
export interface EnterpriseDocumentIssue {
  /** `artifacts[2].contributors[0].evidence[1].ref` — the index is named, same rule as the others. */
  readonly at: string;
  readonly message: string;
}

export type EnterpriseDocumentParse =
  | { readonly ok: true; readonly document: EnterpriseDocument }
  | { readonly ok: false; readonly issues: readonly EnterpriseDocumentIssue[] };

/**
 * Every release state, DERIVED from @foliage/enterprise-policy's own declarations rather than
 * re-listed here. The policy package declares its states as data — the non-public set plus the
 * transition table — so taking the union of both is the closest thing to asking it directly,
 * and a state added there is accepted here without anyone remembering to.
 */
export const RELEASE_STATES: readonly ReleaseState[] = Object.freeze([
  ...new Set<ReleaseState>([
    ...NON_PUBLIC_STATES,
    ...TRANSITIONS.flatMap((t) => [t.from, t.to]),
  ]),
]);

/** Likewise the actor roles: whoever appears in the policy table is a role that exists. */
const ACTOR_ROLES: readonly Actor[] = Object.freeze([
  ...new Set<Actor>(TRANSITIONS.flatMap((t) => t.actors)),
]);

const DOCUMENT_KEYS: ReadonlySet<string> = new Set(["artifacts"]);
const ARTIFACT_KEYS: ReadonlySet<string> = new Set([
  "id",
  "title",
  "subject",
  "contributors",
  "evidence",
  "extractor",
  "draftedAt",
  "review",
  "release",
]);
const CONTRIBUTION_KEYS: ReadonlySet<string> = new Set(["subject", "evidence"]);
const EVIDENCE_KEYS: ReadonlySet<string> = new Set(["source", "ref", "observedAt"]);
const BRANCH_PATH_KEYS: ReadonlySet<string> = new Set(["tree", "bough", "branch"]);

/**
 * Which keys each subject kind may carry. Per kind rather than one superset, the same rule as
 * the review states: a `branch` on a bough subject would be attached, never read, and quietly
 * wrong about who the artifact belongs to.
 */
const SUBJECT_KEYS_BY_KIND: Readonly<Record<SubjectKind, ReadonlySet<string>>> = Object.freeze({
  tree: new Set(["kind", "tree"]),
  bough: new Set(["kind", "tree", "bough"]),
  branch: new Set(["kind", "tree", "bough", "branch"]),
  leaf: new Set(["kind", "tree", "leaf", "branches"]),
});

/** The review state names, as the discriminant of the imported union — never a second list. */
type ReviewStateName = ReviewState["state"];

/**
 * Exactly the keys of one review arm, turned into the Set the key check needs.
 *
 * `Record<keyof T & string, true>` is the whole point: on an object literal it refuses a MISSING
 * key and an EXTRA one alike, so this cannot drift from the type the parser claims to enforce —
 * including when that type changes in the other package. Sets of key names cannot be derived
 * from a type at run time, and this is the closest available thing: the names are still typed,
 * so the compiler checks them.
 */
function keysOf<T>(keys: Readonly<Record<keyof T & string, true>>): ReadonlySet<string> {
  return new Set(Object.keys(keys));
}

/**
 * Which keys each review state may carry — `reason` belongs to `rejected` and nowhere else.
 *
 * Keyed by `ReviewStateName`, so a fourth arm added to @foliage/photosynthesis's `ReviewState`
 * fails to compile HERE, on the missing property, instead of being accepted by the type and
 * refused at run time by a list nobody remembered to update.
 */
const REVIEW_KEYS_BY_STATE: Readonly<Record<ReviewStateName, ReadonlySet<string>>> = Object.freeze({
  candidate: keysOf<Extract<EnterpriseReview, { state: "candidate" }>>({ state: true }),
  approved: keysOf<Extract<EnterpriseReview, { state: "approved" }>>({
    state: true,
    by: true,
    role: true,
    at: true,
    // Inherited from the open plane's ReviewState on 2026-08-24 — the review-subject digest.
    // This tripwire fired exactly as designed (a new shared key must be DECIDED here): the
    // enterprise format permits it, so a document that carried one survives the round trip.
    subjectDigest: true,
  }),
  rejected: keysOf<Extract<EnterpriseReview, { state: "rejected" }>>({
    state: true,
    by: true,
    role: true,
    at: true,
    reason: true,
    subjectDigest: true,
  }),
});

/** The names themselves, read back off that map so there is one list in this file, not two. */
const REVIEW_STATES: readonly ReviewStateName[] = Object.freeze(
  Object.keys(REVIEW_KEYS_BY_STATE) as ReviewStateName[],
);

const isReviewStateName = (v: unknown): v is ReviewStateName =>
  typeof v === "string" && (REVIEW_STATES as readonly string[]).includes(v);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Same wording rules as document.ts and harvestDocument.ts: say what was there, absence included. */
function describe(v: unknown): string {
  if (v === undefined) return "nothing (the field is absent)";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "string") return v.trim().length === 0 ? "an empty string" : "a string";
  if (typeof v === "object") return "an object";
  return `a ${typeof v}`;
}

function checkKeys(
  rec: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
  issues: EnterpriseDocumentIssue[],
): void {
  for (const key of Object.keys(rec)) {
    if (allowed.has(key)) continue;
    const where = at === "" ? key : `${at}.${key}`;
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      issues.push({
        at: where,
        message:
          `"${key}" is refused by name: no rating of any kind may enter this format, and least ` +
          `of all one attached to a person. Contribution is expressed as evidence refs and ` +
          `counts of them — never a number that reads like a rating of somebody's work.`,
      });
    } else {
      issues.push({
        at: where,
        message:
          `unknown field "${key}". Unrecognised fields are refused rather than ignored, so a ` +
          `misspelling cannot become an invisible omission. Allowed here: ` +
          `${[...allowed].join(", ")}.`,
      });
    }
  }
}

function checkInstant(
  v: unknown,
  at: string,
  what: string,
  issues: EnterpriseDocumentIssue[],
): v is string {
  if (!nonEmptyString(v)) {
    issues.push({ at, message: `required: ${what} as an ISO-8601 instant, got ${describe(v)}` });
    return false;
  }
  if (!isIsoInstant(v)) {
    issues.push({
      at,
      message:
        `"${v}" is not an ISO-8601 instant with an offset (e.g. 2026-08-16T09:41:00Z). A ` +
        `local-time stamp is an observation plus an unstated assumption about where it was made.`,
    });
    return false;
  }
  return true;
}

/** Require a non-empty string id, reporting the absence rather than substituting a blank. */
function requireId(
  v: unknown,
  at: string,
  what: string,
  issues: EnterpriseDocumentIssue[],
): v is string {
  if (nonEmptyString(v)) return true;
  issues.push({ at, message: `required: ${what}, got ${describe(v)}` });
  return false;
}

/**
 * One evidence ref. The RULES are `Provenance`'s rules — same fields, same instant requirement
 * via the imported `isIsoInstant` — because these objects are the entire checkable surface of
 * an artifact and a looser gate here would admit a claim the open plane would refuse.
 */
// jscpd:ignore-start — this evidence-ref validator is the same cross-plane parallelism this
// repo already documents (.loop/STATUS.md row C9): identical to harvestDocument.ts's, minus the
// open plane's later-added `excerpt` field. Historical, not retriaged here.
function parseEvidenceRef(
  v: unknown,
  at: string,
  issues: EnterpriseDocumentIssue[],
): Provenance | null {
  if (!isRecord(v)) {
    issues.push({ at, message: `an evidence ref must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, EVIDENCE_KEYS, at, issues);

  const source = v["source"];
  const ref = v["ref"];
  const observedAt = v["observedAt"];
  let bad = false;

  if (!nonEmptyString(source)) {
    issues.push({
      at: `${at}.source`,
      message: `required: the mechanism that produced the evidence (e.g. "git"), got ${describe(source)}`,
    });
    bad = true;
  }
  if (!nonEmptyString(ref)) {
    issues.push({
      at: `${at}.ref`,
      message: `required: a stable handle for the artifact (commit sha, digest), got ${describe(ref)}`,
    });
    bad = true;
  }
  if (!checkInstant(observedAt, `${at}.observedAt`, "when the evidence was observed", issues)) {
    bad = true;
  }

  if (bad) return null;
  return Object.freeze({
    source: source as string,
    ref: ref as string,
    observedAt: observedAt as string,
  });
}
// jscpd:ignore-end

/** An array of evidence refs with at least one entry, or every reason it is not one. */
function parseEvidenceList(
  v: unknown,
  at: string,
  emptyMessage: string,
  issues: EnterpriseDocumentIssue[],
): readonly Provenance[] | null {
  if (!Array.isArray(v)) {
    issues.push({
      at,
      message: `required: an array of at least one evidence ref, got ${describe(v)}. ${emptyMessage}`,
    });
    return null;
  }
  if (v.length === 0) {
    issues.push({ at, message: `must contain at least one evidence ref. ${emptyMessage}` });
    return null;
  }
  const refs: Provenance[] = [];
  let bad = false;
  for (const [i, raw] of v.entries()) {
    const parsed = parseEvidenceRef(raw, `${at}[${i}]`, issues);
    if (parsed === null) bad = true;
    else refs.push(parsed);
  }
  return bad ? null : Object.freeze(refs);
}

function parseBranchPath(
  v: unknown,
  at: string,
  tree: string,
  issues: EnterpriseDocumentIssue[],
): BranchPath | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message:
        `a branch membership must be an object naming the tree, bough and branch it sits in, ` +
        `got ${describe(v)}. The whole path travels with the membership so that "is this ` +
        `person in that business unit" can be answered without a directory lookup that could fail.`,
    });
    return null;
  }
  checkKeys(v, BRANCH_PATH_KEYS, at, issues);

  const memberTree = v["tree"];
  const bough = v["bough"];
  const branch = v["branch"];
  let bad = false;

  if (!requireId(memberTree, `${at}.tree`, "the tree this branch grows on", issues)) bad = true;
  if (!requireId(bough, `${at}.bough`, "the bough this branch belongs to", issues)) {
    bad = true;
  }
  if (!requireId(branch, `${at}.branch`, "the branch id", issues)) bad = true;
  if (bad) return null;

  if (memberTree !== tree) {
    issues.push({
      at: `${at}.tree`,
      message:
        `this membership names tree "${String(memberTree)}" but the person's leaf is on tree ` +
        `"${tree}". A tree is one company and the tenancy boundary of this plane; a membership ` +
        `that crossed one would be a leak rather than a hierarchy.`,
    });
    return null;
  }

  return Object.freeze({
    tree: treeId(memberTree as string),
    bough: boughId(bough as string),
    branch: branchId(branch as string),
  });
}

function parseSubject(
  v: unknown,
  at: string,
  issues: EnterpriseDocumentIssue[],
): Subject | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message:
        `a subject must be an object with a "kind" of ${SUBJECT_KINDS.join(", ")}, got ` +
        `${describe(v)}. An artifact always belongs to somebody, even when that somebody is a ` +
        `branch rather than a person.`,
    });
    return null;
  }

  const kind = v["kind"];
  if (typeof kind !== "string" || !(SUBJECT_KINDS as readonly string[]).includes(kind)) {
    issues.push({
      at: `${at}.kind`,
      message: `required: one of ${SUBJECT_KINDS.map((k) => `"${k}"`).join(", ")} — got ${
        typeof kind === "string" ? `"${kind}"` : describe(kind)
      }. These kinds nest; none of them outranks another.`,
    });
    // Without a kind there is no way to know which other keys are even legal here.
    return null;
  }

  const allowed = SUBJECT_KEYS_BY_KIND[kind as SubjectKind];
  checkKeys(v, allowed, at, issues);

  const tree = v["tree"];
  if (!requireId(tree, `${at}.tree`, "the tree this subject grows on", issues)) {
    return null;
  }

  switch (kind as SubjectKind) {
    case "tree":
      return Object.freeze({ kind: "tree" as const, tree: treeId(tree) });

    case "bough": {
      const bough = v["bough"];
      if (!requireId(bough, `${at}.bough`, "the business unit id", issues)) return null;
      return Object.freeze({
        kind: "bough" as const,
        tree: treeId(tree),
        bough: boughId(bough),
      });
    }

    case "branch": {
      const bough = v["bough"];
      const branch = v["branch"];
      let bad = false;
      if (!requireId(bough, `${at}.bough`, "the bough this branch belongs to", issues)) {
        bad = true;
      }
      if (!requireId(branch, `${at}.branch`, "the branch id", issues)) bad = true;
      if (bad) return null;
      return Object.freeze({
        kind: "branch" as const,
        tree: treeId(tree),
        bough: boughId(bough as string),
        branch: branchId(branch as string),
      });
    }

    case "leaf": {
      const leaf = v["leaf"];
      if (!requireId(leaf, `${at}.leaf`, "the person's leaf id", issues)) return null;

      const rawBranches = v["branches"];
      if (!Array.isArray(rawBranches)) {
        issues.push({
          at: `${at}.branches`,
          message:
            `required: an array of branch memberships, got ${describe(rawBranches)}. An empty ` +
            `array [] is valid and means this person is on no branch — a real state, and not ` +
            `the same fact as the field being missing.`,
        });
        return null;
      }
      const branches: BranchPath[] = [];
      let bad = false;
      for (const [i, raw] of rawBranches.entries()) {
        const parsed = parseBranchPath(raw, `${at}.branches[${i}]`, tree, issues);
        if (parsed === null) bad = true;
        else branches.push(parsed);
      }
      if (bad) return null;
      return Object.freeze({
        kind: "leaf" as const,
        tree: treeId(tree),
        leaf: leafId(leaf),
        branches: Object.freeze(branches),
      });
    }
  }
}

function parseReview(
  v: unknown,
  at: string,
  issues: EnterpriseDocumentIssue[],
): EnterpriseReview | null {
  if (!isRecord(v)) {
    issues.push({ at, message: `review must be an object with a "state", got ${describe(v)}` });
    return null;
  }

  const state = v["state"];
  if (!isReviewStateName(state)) {
    issues.push({
      at: `${at}.state`,
      message: `required: one of ${REVIEW_STATES.map((s) => `"${s}"`).join(", ")} — got ${
        typeof state === "string" ? `"${state}"` : describe(state)
      }.`,
    });
    return null;
  }

  checkKeys(v, REVIEW_KEYS_BY_STATE[state], at, issues);

  if (state === "candidate") return Object.freeze({ state: "candidate" as const });

  const by = v["by"];
  const role = v["role"];
  const reviewedAt = v["at"];
  let bad = false;

  if (!nonEmptyString(by)) {
    issues.push({
      at: `${at}.by`,
      message:
        `required: who ${state} this artifact, got ${describe(by)}. In this plane the reviewer ` +
        `and the subject are usually different people, so a decision about someone else's work ` +
        `has to name the person who made it.`,
    });
    bad = true;
  }
  if (typeof role !== "string" || !(ACTOR_ROLES as readonly string[]).includes(role)) {
    issues.push({
      at: `${at}.role`,
      message:
        `required: the capacity the reviewer acted in — one of ` +
        `${ACTOR_ROLES.map((a) => `"${a}"`).join(", ")} — got ${
          typeof role === "string" ? `"${role}"` : describe(role)
        }. "${String(by)}" is a name; the role is what says whether they were speaking for ` +
        `themselves or for the company.`,
    });
    bad = true;
  } else if (role === "system" && state === "approved") {
    issues.push({
      at: `${at}.role`,
      message:
        `a review may not be approved by "system". @foliage/enterprise-policy says of approval ` +
        `"A company decision. Never automatic." — automation may keep an artifact in (a system ` +
        `rejection is allowed and safe) but it may never be what lets one out.`,
    });
    bad = true;
  }
  if (!checkInstant(reviewedAt, `${at}.at`, `when the artifact was ${state}`, issues)) bad = true;

  if (state === "approved") {
    if (bad) return null;
    return Object.freeze({
      state: "approved" as const,
      by: by as string,
      role: role as Actor,
      at: reviewedAt as string,
    });
  }

  const reason = v["reason"];
  if (!nonEmptyString(reason)) {
    issues.push({
      at: `${at}.reason`,
      message:
        `a rejected artifact requires a reason, got ${describe(reason)}. The same discipline as ` +
        `the excluded tier and the harvest's rejected review: a rejection with no reason is a ` +
        `silent disappearance, and here it is also a decision made ABOUT someone by someone ` +
        `else, which they are entitled to read.`,
    });
    return null;
  }
  if (bad) return null;
  return Object.freeze({
    state: "rejected" as const,
    by: by as string,
    role: role as Actor,
    at: reviewedAt as string,
    reason,
  });
}

function parseContribution(
  v: unknown,
  at: string,
  owner: Subject | null,
  issues: EnterpriseDocumentIssue[],
): Contribution | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message: `a contribution must be an object with a subject and evidence, got ${describe(v)}`,
    });
    return null;
  }
  checkKeys(v, CONTRIBUTION_KEYS, at, issues);

  const subject = parseSubject(v["subject"], `${at}.subject`, issues);
  let bad = subject === null;

  if (subject !== null && subject.kind !== "leaf") {
    issues.push({
      at: `${at}.subject.kind`,
      message:
        `a contributor is a person: got ${describeSubject(subject)}. A branch inside a branch ` +
        `artifact would be a second hierarchy hiding in the contributor list, and the ledger ` +
        `would be counting two different kinds of thing in one column.`,
    });
    bad = true;
  }

  // The containment rule, and the reason this package models the hierarchy at all: naming
  // somebody on an artifact that is not theirs is a false statement about a person, not a
  // formatting slip. Reported with `containment`'s own `why` so the message says which
  // relation was missing.
  if (subject !== null && subject.kind === "leaf" && owner !== null) {
    const relation = containment(owner, subject);
    if (relation.relation === "separate") {
      issues.push({
        at: `${at}.subject`,
        message:
          `this contributor is not inside the artifact's subject: ${relation.why} An artifact ` +
          `may only name contributors that ${describeSubject(owner)} actually contains.`,
      });
      bad = true;
    }
  }

  const evidence = parseEvidenceList(
    v["evidence"],
    `${at}.evidence`,
    `A named contributor with no refs is an unsourced assertion about a person, which is the ` +
      `one thing this format exists to make impossible.`,
    issues,
  );
  if (evidence === null) bad = true;

  if (bad || subject === null || subject.kind !== "leaf" || evidence === null) return null;
  return Object.freeze({ subject, evidence });
}

function parseArtifact(
  v: unknown,
  index: number,
  issues: EnterpriseDocumentIssue[],
): EnterpriseArtifact | null {
  const at = `artifacts[${index}]`;
  if (!isRecord(v)) {
    issues.push({ at, message: `must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, ARTIFACT_KEYS, at, issues);

  const id = v["id"];
  const title = v["title"];
  const extractor = v["extractor"];
  const draftedAt = v["draftedAt"];
  const release = v["release"];
  let bad = false;

  if (!nonEmptyString(id)) {
    issues.push({ at: `${at}.id`, message: `required: a non-empty id, got ${describe(id)}` });
    bad = true;
  }
  if (!nonEmptyString(title)) {
    issues.push({
      at: `${at}.title`,
      message: `required: the drafted title, got ${describe(title)}`,
    });
    bad = true;
  }
  if (!nonEmptyString(extractor)) {
    issues.push({
      at: `${at}.extractor`,
      message:
        `required: the identity of what drafted this (e.g. "git-cluster", ` +
        `"local-model:gemma4:12b"), got ${describe(extractor)}. Review has to see what wrote a ` +
        `draft before deciding whether to trust it.`,
    });
    bad = true;
  }
  if (!checkInstant(draftedAt, `${at}.draftedAt`, "when the draft was produced", issues)) bad = true;

  if (typeof release !== "string" || !(RELEASE_STATES as readonly string[]).includes(release)) {
    issues.push({
      at: `${at}.release`,
      message:
        `required: one of ${RELEASE_STATES.map((s) => `"${s}"`).join(", ")} — got ${
          typeof release === "string" ? `"${release}"` : describe(release)
        }. "internal" is the default and the only safe one; the state is moved by ` +
        `applyReleaseEvent and never assigned by hand.`,
    });
    bad = true;
  }

  const subject = parseSubject(v["subject"], `${at}.subject`, issues);
  if (subject === null) bad = true;

  const evidence = parseEvidenceList(
    v["evidence"],
    `${at}.evidence`,
    `An artifact with no evidence cannot exist — the title is prose a machine wrote, and the ` +
      `refs are the only part of it that is checkable.`,
    issues,
  );
  if (evidence === null) bad = true;

  const rawContributors = v["contributors"];
  const contributors: Contribution[] = [];
  if (!Array.isArray(rawContributors)) {
    issues.push({
      at: `${at}.contributors`,
      message:
        `required: an array of contributors, got ${describe(rawContributors)}. An empty array ` +
        `[] is valid and says that no one person is named on this artifact — a branch's ` +
        `migration belongs to the branch — which is a different fact from the field being absent.`,
    });
    bad = true;
  } else {
    const seenContributors = new Set<string>();
    for (const [i, raw] of rawContributors.entries()) {
      const contribution = parseContribution(raw, `${at}.contributors[${i}]`, subject, issues);
      if (contribution === null) {
        bad = true;
        continue;
      }
      const key = subjectKey(contribution.subject);
      if (seenContributors.has(key)) {
        issues.push({
          at: `${at}.contributors[${i}].subject`,
          message:
            `"${contribution.subject.leaf}" is already named on this artifact. One entry ` +
            `per person: two entries would be counted twice and read as twice the work.`,
        });
        bad = true;
        continue;
      }
      seenContributors.add(key);
      contributors.push(contribution);
    }
  }

  const review = "review" in v ? parseReview(v["review"], `${at}.review`, issues) : null;
  if (review === null) {
    if (!("review" in v)) {
      issues.push({
        at: `${at}.review`,
        message:
          `required: a review state. An artifact nobody has looked at is ` +
          `{"state": "candidate"} — explicitly unreviewed, not silently unstated.`,
      });
    }
    bad = true;
  }

  // THE DOCUMENT DOOR of the review gate (reviewGate.ts). The pair is checked, not the fields
  // separately: each of these values is legal on its own, and it is their COMBINATION that this
  // package's own API cannot produce. Only reached once both fields parsed, so the message is
  // about an unreachable pair rather than about a state that does not exist.
  if (
    review !== null &&
    review.state === "candidate" &&
    typeof release === "string" &&
    (RELEASE_STATES as readonly string[]).includes(release) &&
    !UNREVIEWED_RELEASE_STATES.has(release as ReleaseState)
  ) {
    issues.push({
      at: `${at}.release`,
      message:
        `release "${release}" beside review {"state": "candidate"} is a pair applyReleaseEvent ` +
        `cannot produce, and it is refused rather than carried. An unreviewed draft can only be ` +
        `${[...UNREVIEWED_RELEASE_STATES].map((s) => `"${s}"`).join(", ")}: leaving that needs ` +
        `"propose", which is refused until a person approves the draft, and a review never ` +
        `returns to "candidate" once somebody has read it. Declaring the end state in the file ` +
        `is how the review gate gets walked around — a machine wrote the title and this ` +
        `document says it is already ${isPublic(release as ReleaseState) ? "public" : "cleared"}. ` +
        `A rejected review is a different matter: "${release}" beside {"state": "rejected"} is ` +
        `real — reviewed, then rejected afterwards — and stays valid so it can still be pulled.`,
    });
    bad = true;
  }

  if (bad || subject === null || evidence === null || review === null) return null;
  return Object.freeze({
    id: enterpriseArtifactId(id as string),
    title: title as string,
    subject,
    contributors: Object.freeze(contributors),
    evidence,
    extractor: extractor as string,
    draftedAt: draftedAt as string,
    review,
    release: release as ReleaseState,
  });
}

/**
 * Parse an untrusted value into an `EnterpriseDocument`, or into every reason it is not one.
 *
 * Never throws and never partially succeeds — one invalid artifact rejects the whole document,
 * for the same reason `parseLeafDocument` and `parseHarvestDocument` work that way: carrying
 * the survivors would present a smaller portfolio than the file describes, and a portfolio
 * that is quietly smaller than the evidence is the failure mode this product exists to refuse.
 */
export function parseEnterpriseDocument(value: unknown): EnterpriseDocumentParse {
  const issues: EnterpriseDocumentIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          at: "(document)",
          message:
            `an enterprise portfolio document must be a JSON object with an artifacts array — ` +
            `got ${describe(value)}`,
        },
      ],
    };
  }

  checkKeys(value, DOCUMENT_KEYS, "", issues);

  const rawArtifacts = value["artifacts"];
  const artifacts: EnterpriseArtifact[] = [];
  if (rawArtifacts === undefined) {
    issues.push({
      at: "artifacts",
      message:
        `required: an array of artifacts. An empty array [] is valid and means an honest empty ` +
        `portfolio — it is not the same as the field being missing.`,
    });
  } else if (!Array.isArray(rawArtifacts)) {
    issues.push({ at: "artifacts", message: `must be an array, got ${describe(rawArtifacts)}` });
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of rawArtifacts.entries()) {
      const artifact = parseArtifact(raw, i, issues);
      if (artifact === null) continue;
      if (seen.has(artifact.id)) {
        issues.push({
          at: `artifacts[${i}].id`,
          message: `duplicate id "${artifact.id}" — ids must be unique within a document.`,
        });
        continue;
      }
      seen.add(artifact.id);
      artifacts.push(artifact);
    }
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };

  return { ok: true, document: Object.freeze({ artifacts: Object.freeze(artifacts) }) };
}
