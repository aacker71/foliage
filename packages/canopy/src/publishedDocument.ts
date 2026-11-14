import { parsePublicPortfolio, publicPortfolioJson, type PublishedPortfolio } from "./publicPortfolio.ts";
/**
 * THE PUBLISHED ARTIFACT — the thing that crosses the plane boundary, and the gate that reads it
 * back on the other side.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE DECISION: A REDACTED DOCUMENT THE CANOPY RENDERS, NOT A PRE-RENDERED PAGE.
 *
 * Both were on the table. A pre-rendered page is tempting — publish becomes "write HTML to a
 * directory", ingest becomes "serve a file", and the canopy needs no domain code at all. It was
 * rejected on four grounds, in order of weight:
 *
 *   1. PROVENANCE. This product's whole claim is that a page states only what the evidence says
 *      and names what it does not know. A canopy handed 40KB of HTML cannot tell a verified
 *      leaflet from a sentence — it can only serve the bytes and hope. Serving a page it cannot
 *      read is the canopy asserting somebody else's markup under its own name. With a document,
 *      every line the page shows is re-derived here from a typed field, and anything that is not
 *      a field cannot appear.
 *
 *   2. INSPECTABILITY BEFORE EGRESS. Consent is only real if the thing consented to is legible.
 *      A person can read a thirty-line JSON document and see exactly what leaves their machine.
 *      Nobody audits generated HTML for a leaked address, which means "review before publish"
 *      over a rendered page is a ritual rather than a check.
 *
 *   3. FAILURE STATES. A static file has two states: it serves, or it 404s. `/tree` keeps five
 *      causes apart because collapsing them is the defect this project keeps paying for, and a
 *      pre-rendered artifact would reintroduce the collapse at the moment of egress — a truncated
 *      upload and a missing publication would be the same event. A document can be absent,
 *      unreadable, malformed or invalid, each named separately, and this file is what makes the
 *      last two distinguishable.
 *
 *   4. RE-PUBLISH AND UNPUBLISH. Re-publish is one file replaced and two documents that diff
 *      field by field — you can see precisely which claim changed. Diffing two rendered pages
 *      diffs chrome. Unpublish is one file removed, with nothing cached in a second form. And a
 *      rendered page is a FOSSIL: when the redaction gate is improved, a document can be run
 *      through the better gate again, while a page published under the old one is already out.
 *
 * The cost is honestly stated: the canopy now runs code over a file a publisher produced, so this
 * gate has to be as suspicious of an artifact as `parseLeafDocument` is of a leaf document. That
 * is the whole content of this file.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE FORMAT, on disk — the unphotographed writer emits version 5 for named portfolios;
 * an explicitly selected photo set emits version 6. Historical versions remain readable.
 *
 *   {
 *     "artifact": "foliage/published-leaf",
 *     "artifactVersion": 5,
 *     "publishedAt": "2026-08-17T21:04:11.402Z",
 *     "source": { "documentDigest": "sha256:<64 hex>", "documentBytes": 214053,
 *                 "policyDigest": "sha256:<64 hex>" },
 *     "leaf": {
 *       "id": "alex-a",
 *       "subject": "Alex A",
 *       "subjectRedacted": false,
 *       "leaflets": [
 *         { "id": "git:4f884f6", "title": "…", "tier": "verified", "titleRedacted": false,
 *           "provenance": { "source": "git", "ref": "4f884f6…", "observedAt": "…Z" } }
 *       ]
 *     },
 *     "withheld": { "count": 801, "kinds": [{ "kind": "not-shared", "count": 801 }] }
 *   }
 *
 * WHY EACH FIELD IS THERE, INCLUDING THE ONES THAT ARE NOT:
 *
 *   `publishedAt` AND `source` ANSWER "WHEN, AND FROM WHAT". An artifact that cannot say when it
 *   was made is one nobody can date-check, and an artifact that cannot say what it was made from
 *   cannot be reproduced. The digest is of the LEAF DOCUMENT'S BYTES, so anyone holding that file
 *   can hash it and prove — or disprove — that this artifact came from it. That is a real check,
 *   not a label.
 *
 *   THE SOURCE PATH IS DELIBERATELY ABSENT. `/tree` prints its manifest path in the footer, which
 *   is right for an operator-facing page about an operator's own file. This is a PUBLIC page
 *   about a PERSON, and an absolute path is `/Users/<their account name>/…` — an identifier they
 *   never agreed to publish, arriving through a field nobody was looking at. The digest gives the
 *   same reproducibility with none of the disclosure. The publish command prints the path to the
 *   operator on their own terminal, where it belongs.
 *
 *   THE WITHHELD REPORT IS NOT IN HERE, ON PURPOSE. `publish.ts` states it plainly: the report is
 *   a PRIVATE review artifact. It names every withholding by leaflet id, and a git leaflet's id is
 *   built from its ref — so shipping the report would republish exactly the refs the gate withheld
 *   for containing an identifier. What crosses is the SHAPE of the loss: how many entries, and of
 *   which kinds. That is what a reader needs to know this page is not the whole leaf; the detail
 *   stays with the subject.
 *
 *   `withheld.count` IS ENTRIES IN THE REVIEW, NOT LEAFLETS. A whole leaflet that did not cross is
 *   one entry, and so is a single address redacted out of a title that did cross. They are not the
 *   same unit, they cannot be added into "leaflets missing", and the renderer is required to word
 *   it as entries. `kinds` carries the per-kind counts and MUST sum to `count`; an artifact where
 *   it does not is refused, which is a cross-check a hand-edited file fails.
 *
 *   `tier` IS `"verified"` OR `"pending"`, NEVER ANYTHING ELSE, AND THE PARSER SAYS WHICH LEAFLET
 *   AND WHY. Until 2026-09-06 this field did not exist — every leaflet in a published artifact was
 *   verified by construction, so there was nothing to say. The owner decision recorded at
 *   `.loop/MERGE-DECISIONS.md` row D1 changed what the gate acts on: `pending` now crosses beside
 *   `verified`, and the reader is told which by this field rather than being left to assume. What
 *   has NOT changed is `excluded`: it is refused BY NAME here too, because it is not a proof tier
 *   this format degrades to — `excluded` means the work is not the subject's at all, and a
 *   published artifact asserting it would be a false attribution no disclosure fixes. See
 *   `publish.ts`'s header for the argument; this file only enforces it on the way back in.
 *
 *   NO SCORE, EVER. Score-shaped keys are refused BY NAME here, in the canopy's own list, and not
 *   by importing the leaf format's. The duplication is deliberate: this is the EGRESS gate, the
 *   leaf format is open and forkable, and a fork that relaxed its list must not thereby relax what
 *   the hosted canopy will serve. `publishedDocument.test.ts` pins that this list is a superset of
 *   what the leaf format refuses, so the two cannot drift apart silently.
 *
 *   VERSION 3 WRITES BOTH REVIEW PROVENANCE AND EXPLICIT TIERS. Two earlier branches used
 *   version 2 for different closed shapes: one required source.policyDigest and omitted tiers
 *   (verified-only); the other required tiers and omitted policyDigest. Both stay readable.
 *   Version 1 also stays readable, with its original absent-tier/absent-policy shape. A missing
 *   tier means verified only in the historical shapes whose publisher required verified work.
 *   The retired unproven-leaflet withholding kind is allowed only in those shapes. Hybrid v2
 *   objects, missing v3 policy provenance, unknown keys and unknown versions are refused.
 *   Reading and serializing preserve the original shape; an explicit publish writes v5 or v6.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE INGEST GATE RE-RUNS THE REDACTION GATE. `parsePublishedDocument` reconstructs a `Leaf` from
 * the artifact and runs `reviewForPublication` over it. If that review withholds ANYTHING, the
 * artifact is refused as invalid. An artifact produced by the gate re-runs clean — that is
 * idempotence, and it is tested on real data — so a failure means the file was not produced by
 * this gate, or was edited after it was. The canopy cannot verify that a redaction HAPPENED (it
 * never sees the original), and this does not pretend to; it verifies that what it is about to
 * serve contains nothing the gate would withhold. That is the checkable half, and the checkable
 * half is what gets enforced.
 *
 * `titleRedacted` and `subjectRedacted` are the publisher's word and CANNOT be checked here — only
 * someone holding the original knows whether text was altered. They are therefore preserved from
 * the artifact rather than recomputed, and the renderer treats them as a claim: a title marked
 * redacted is never labelled verbatim, and the page says why.
 *
 * TOTAL, PURE, DETERMINISTIC. No fs, no network, no clock, no throw. Complexity: O(total
 * characters) for the re-run of the gate, plus O(n) over leaflets with an O(n) set for duplicate
 * ids.
 */

import { createHash } from "node:crypto";

import {
  isIsoInstant,
  leafId,
  leafletId,
  type Leaf,
  type LeafDocumentIssue,
  type Leaflet,
  type Provenance,
} from "@foliage/leaf";

import {
  reviewForPublication,
  publicNarrativeIssue,
  publicAuthoredTextIssue,
  type PublishedNarrative,
  type PublishedPhoto,
  publicPhotoIssue, MAX_PUBLIC_PHOTOS,
  type PublishedVideo,
  publicVideoIssue, MAX_PUBLIC_VIDEOS,
  type PublicationReview,
  type PublishedLeaf,
  type PublishedLeaflet,
  type WithholdingKind,
} from "./publish.ts";

/** The format tag. An artifact that does not declare exactly this is not read as one. */
export const PUBLISHED_ARTIFACT = "foliage/published-leaf";

/**
 * The version this canopy WRITES today. See the header's `artifactVersion` paragraph for what
 * changed at version 3; version 4 added selected narrative, version 5 named portfolios, and
 * photo-bearing publications use version 6 and selected video uses version 7. Historical formats still read.
 */
export const PUBLISHED_ARTIFACT_VERSION = 5;

/**
 * Every version this canopy can still READ — a strict superset of what it writes, on purpose: an
 * old file does not stop serving the day the write format moves on. A version outside this set is
 * refused BY NUMBER rather than parsed optimistically, naming the version found and the remedy —
 * a canopy that guessed at an unknown format would be rendering rules it does not know, and the
 * failure mode of guessing is publishing something that format meant to withhold.
 */
const READABLE_ARTIFACT_VERSIONS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6, 7]);

/** The versions `parsePublishedDocument` can produce a document for. */
export type PublishedArtifactVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * What a published leaf may be called, and therefore what URL it gets.
 *
 * Constrained rather than escaped. An id that has to be escaped to be a path segment is an id
 * that will eventually be un-escaped by something else, and the two answers will differ. Lower
 * case, digits and interior hyphens only — refused, never silently transformed, because two
 * different ids that slugified to the same string would land on the same URL and one person's
 * page would overwrite another's.
 */
export const PUBLISHED_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** `sha256:` followed by exactly 64 lower-case hex digits. */
export const DOCUMENT_DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface PublishedSource {
  /** Digest of the LEAF DOCUMENT's bytes, so the artifact can be tied back to its input. */
  readonly documentDigest: string;
  readonly documentBytes: number;
  /** Effective policy provenance; absent only in v1 and the explicit-tier v2 dialect. */
  readonly policyDigest: string | null;
}

/**
 * `unproven-leaflet` was a real withholding kind through 2026-09-05 and was removed from
 * `WithholdingKind` (see `publish.ts`) when `pending` stopped being gated. It is readded HERE,
 * separately, rather than left in `WithholdingKind` itself, because the two questions are
 * different: `WithholdingKind` is what `reviewForPublication` — and therefore
 * `buildPublishedDocument` — can still PRODUCE, and the answer is no, never again. This type is
 * what `parsePublishedDocument` can still ACCEPT, and the answer is yes, but only when reading a
 * v1 or policy-provenance v2 artifact. One type per direction keeps
 * the retired kind from riding back into the write path by way of a shared union.
 */
export type ReadableWithholdingKind = WithholdingKind | "unproven-leaflet";

/** How many review entries of one kind. A count, never a rating — see the header. */
export interface WithholdingCount {
  readonly kind: ReadableWithholdingKind;
  readonly count: number;
}

export interface PublishedWithholdings {
  /** Entries in the review report. NOT a number of leaflets — see the header. */
  readonly count: number;
  /** Per-kind counts. Must sum to `count`, and the parse gate enforces it. */
  readonly kinds: readonly WithholdingCount[];
}

export interface PublishedLeafDocument {
  readonly artifact: typeof PUBLISHED_ARTIFACT;
  /** The version this FILE actually declared — 1 for a legacy artifact still being served as-is. */
  readonly artifactVersion: PublishedArtifactVersion;
  /** ISO-8601 instant with an offset. When this artifact was made. */
  readonly publishedAt: string;
  readonly source: PublishedSource;
  readonly leaf: PublishedLeaf;
  readonly withheld: PublishedWithholdings;
}

export type PublishedDocumentParse =
  | { readonly ok: true; readonly document: PublishedLeafDocument }
  | { readonly ok: false; readonly issues: readonly LeafDocumentIssue[] };

/**
 * Every withholding kind, as a runtime list.
 *
 * Built from a `Record<WithholdingKind, true>` so that adding a kind to the union without adding
 * it here fails the typecheck in this file, rather than producing a gate that silently refuses a
 * kind the gate itself now emits.
 */
const KIND_TABLE: Readonly<Record<WithholdingKind, true>> = Object.freeze({
  "email-address": true,
  "identity-trailer": true,
  "account-handle": true,
  "phone-number": true,
  "not-shared": true,
  "unattributed-leaflet": true,
  "policy-denied": true,
  "unpublishable-provenance": true,
});

export const WITHHOLDING_KINDS: readonly WithholdingKind[] = Object.freeze(
  Object.keys(KIND_TABLE) as WithholdingKind[],
);

const KIND_SET: ReadonlySet<string> = new Set<string>(WITHHOLDING_KINDS);

/** Retired by explicit-tier formats; retained when reading verified-only formats. */
const LEGACY_WITHHOLDING_KIND = "unproven-leaflet";

/**
 * Kinds the historical verified-only artifacts may still name. `KIND_SET` plus the one retired
 * kind — see `ReadableWithholdingKind`'s comment for why it is not simply added to `KIND_SET`
 * itself: that set also backs the "known kinds" list shown for an explicit-tier artifact, which must
 * keep refusing it.
 */
const LEGACY_KIND_SET: ReadonlySet<string> = new Set<string>([
  ...WITHHOLDING_KINDS,
  LEGACY_WITHHOLDING_KIND,
]);

/**
 * Keys that would put a rating into a PUBLISHED artifact. Refused by name — see the header for
 * why this list is the canopy's own rather than an import from the open leaf format.
 */
const SCORE_SHAPED: ReadonlySet<string> = new Set([
  "score",
  "scores",
  "rating",
  "ratings",
  "rank",
  "ranking",
  "grade",
  "gpa",
  "percentile",
  "percentage",
  "percent",
  "weight",
  "weighted",
  "composite",
  "stars",
  "points",
  "confidence",
  "strength",
  "level",
  "tier",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function describe(v: unknown): string {
  if (v === undefined) return "nothing (the field is absent)";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "string") return v.trim().length === 0 ? "an empty string" : "a string";
  if (typeof v === "object") return "an object";
  return `a ${typeof v}`;
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/**
 * Unknown keys are refused, not ignored — the same rule `parseLeafDocument` carries, for the same
 * reason: a misspelling must not become an invisible omission, and a smuggled field must not
 * become an invisible addition. Score-shaped keys are named explicitly.
 */
function checkKeys(
  rec: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
  issues: LeafDocumentIssue[],
): void {
  for (const key of Object.keys(rec)) {
    if (allowed.has(key)) continue;
    const where = at === "" ? key : `${at}.${key}`;
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      issues.push({
        at: where,
        message:
          `"${key}" is refused by name: a published artifact carries no rating of any kind. ` +
          `Proof is reported as per-tier counts on the subject's own leaf, never as a number ` +
          `that reads like a score, and never on a public page at all.`,
      });
    } else {
      issues.push({
        at: where,
        message:
          `unknown field "${key}". Unrecognised fields are refused rather than ignored, so a ` +
          `misspelling cannot become an invisible omission and an extra field cannot ride along ` +
          `unread. Allowed here: ${[...allowed].join(", ")}.`,
      });
    }
  }
}

const ROOT_KEYS: ReadonlySet<string> = new Set([
  "artifact",
  "artifactVersion",
  "publishedAt",
  "source",
  "leaf",
  "withheld",
]);
const LEGACY_SOURCE_KEYS: ReadonlySet<string> = new Set(["documentDigest", "documentBytes"]);
const SOURCE_KEYS: ReadonlySet<string> = new Set([...LEGACY_SOURCE_KEYS, "policyDigest"]);
const LEAF_KEYS: ReadonlySet<string> = new Set(["id", "subject", "subjectRedacted", "leaflets"]);
const LEAFLET_KEYS: ReadonlySet<string> = new Set([
  "id",
  "title",
  "tier",
  "titleRedacted",
  "provenance",
]);
/** The only two tiers a published leaflet may carry. `excluded` is refused by `parseLeaflet`. */
const PUBLISHABLE_TIERS: ReadonlySet<string> = new Set(["verified", "pending"]);
const PROVENANCE_KEYS: ReadonlySet<string> = new Set(["source", "ref", "observedAt"]);
const WITHHELD_KEYS: ReadonlySet<string> = new Set(["count", "kinds"]);
const KIND_KEYS: ReadonlySet<string> = new Set(["kind", "count"]);

function parseProvenance(v: unknown, at: string, issues: LeafDocumentIssue[]): Provenance | null {
  if (!isRecord(v)) {
    issues.push({ at, message: `provenance must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, PROVENANCE_KEYS, at, issues);

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
      message:
        `required: a stable handle for the artifact (commit sha, digest), got ${describe(ref)}. ` +
        `A published leaflet without one is an unfalsifiable claim.`,
    });
    bad = true;
  }
  if (!nonEmptyString(observedAt)) {
    issues.push({
      at: `${at}.observedAt`,
      message: `required: an ISO-8601 instant, got ${describe(observedAt)}`,
    });
    bad = true;
  } else if (!isIsoInstant(observedAt)) {
    issues.push({
      at: `${at}.observedAt`,
      message:
        `"${observedAt}" is not an ISO-8601 instant with an offset. An offset is required ` +
        `(e.g. 2026-08-13T09:41:00Z): a local-time stamp is an observation plus an unstated ` +
        `assumption about where it was made.`,
    });
    bad = true;
  }

  if (bad) return null;
  return Object.freeze({
    source: source as string,
    ref: ref as string,
    observedAt: observedAt as string,
  });
}

function parseLeaflet(
  v: unknown,
  index: number,
  issues: LeafDocumentIssue[],
  implicitVerified: boolean,
  narrativeAllowed: boolean,
  photosAllowed: boolean,
  videosAllowed: boolean,
): PublishedLeaflet | null {
  const at = `leaf.leaflets[${index}]`;
  if (!isRecord(v)) {
    issues.push({ at, message: `must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, new Set([...LEAFLET_KEYS, ...(narrativeAllowed ? ["narrative"] : []), ...(photosAllowed ? ["photos"] : []), ...(videosAllowed ? ["videos"] : [])]), at, issues);

  const id = v["id"];
  const title = v["title"];
  const tierGiven = "tier" in v;
  const tier = v["tier"];
  const titleRedacted = v["titleRedacted"];
  let bad = false;
  if (implicitVerified && tierGiven) {
    issues.push({ at: `${at}.tier`, message: "This verified-only legacy format does not carry an explicit tier. Republish the source document to write the current format." });
    bad = true;
  }

  if (!nonEmptyString(id)) {
    issues.push({ at: `${at}.id`, message: `required: a non-empty id, got ${describe(id)}` });
    bad = true;
  }
  if (!nonEmptyString(title)) {
    issues.push({ at: `${at}.title`, message: `required: a non-empty title, got ${describe(title)}` });
    bad = true;
  }

  // ONE TIER FACT SURVIVES THE GATE: `excluded` is refused BY NAME, not merely by falling outside
  // `PUBLISHABLE_TIERS` — the reason is attribution, not an unrecognised value, and the message
  // has to say so rather than "must be verified or pending", which would read as an arbitrary
  // restriction rather than the structural refusal it is. See `publish.ts`'s header.
  //
  // Only the historical verified-only shapes may omit tier; they must not add an explicit
  // tier either. The newer v2 dialect and v3 require the exact tier on every leaflet.
  let tierValue: "verified" | "pending" | null = null;
  if (!tierGiven && implicitVerified) {
    tierValue = "verified";
  } else if (tier === "excluded") {
    issues.push({
      at: `${at}.tier`,
      message:
        `"excluded" may never appear on a published leaflet. This is not this format's proof ` +
        `gate — it is attribution: an excluded leaflet could not be attributed to the subject, ` +
        `so it was never theirs to publish, and no artifact may assert otherwise (@foliage/leaf's ` +
        `isSubjectsOwnWork). A published leaflet's tier is "verified" or "pending".`,
    });
    bad = true;
  } else if (typeof tier === "string" && PUBLISHABLE_TIERS.has(tier)) {
    tierValue = tier as "verified" | "pending";
  } else {
    issues.push({
      at: `${at}.tier`,
      message:
        `required, and must be "verified" or "pending", got ${describe(tier)}. A published ` +
        `leaflet always says which, so the reader is told what is proven rather than left to ` +
        `assume it.`,
    });
    bad = true;
  }

  if (typeof titleRedacted !== "boolean") {
    issues.push({
      at: `${at}.titleRedacted`,
      message:
        `required, and must be a boolean, got ${describe(titleRedacted)}. It is not optional: a ` +
        `missing value would default to "this is the artifact's own words", and a page must not ` +
        `claim text is verbatim because a field was forgotten.`,
    });
    bad = true;
  }

  // PROVENANCE IS REQUIRED FOR `verified`, THE SAME RULE `Leaflet` ITSELF CARRIES: a verified
  // claim with no record of what was observed is an assertion rather than a proof. `pending`'s is
  // optional — a hand-written pending entry may have none — and, when given, is parsed exactly
  // the same way; a `pending` leaflet whose provenance IS present still gets it checked for an
  // identifier, so consent-worthy evidence does not become an unfalsifiable shortcut.
  const provenanceGiven = "provenance" in v;
  const provenance = provenanceGiven ? parseProvenance(v["provenance"], `${at}.provenance`, issues) : null;
  if (tierValue === "verified" && !provenanceGiven) {
    issues.push({
      at: `${at}.provenance`,
      message:
        `required for a verified leaflet: verification with no record of what was observed is an ` +
        `assertion rather than a proof.`,
    });
    bad = true;
  } else if (provenanceGiven && provenance === null) {
    bad = true;
  }

  let narrative: readonly PublishedNarrative[] | undefined;
  if ("narrative" in v && narrativeAllowed) {
    const raw = v["narrative"];
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) {
      issues.push({ at: `${at}.narrative`, message: "must contain between 1 and 64 explicitly chosen paragraphs" }); bad = true;
    } else {
      const paragraphs: PublishedNarrative[] = [];
      raw.forEach((item, i) => {
        const path = `${at}.narrative[${i}]`;
        if (!isRecord(item)) { issues.push({ at: path, message: "must be a text paragraph with its evidence reference" }); bad = true; return; }
        checkKeys(item, new Set(["text", "provenance"]), path, issues);
        const ref = parseProvenance(item["provenance"], `${path}.provenance`, issues);
        if (!ref) { bad = true; return; }
        const paragraph = { text: item["text"] as string, provenance: ref };
        const issue = publicNarrativeIssue(paragraph);
        if (issue) { issues.push({ at: path, message: issue }); bad = true; return; }
        paragraphs.push(Object.freeze(paragraph));
      });
      narrative = Object.freeze(paragraphs);
    }
  }
  let photos: readonly PublishedPhoto[] | undefined;
  if ("photos" in v && photosAllowed) {
    const raw = v["photos"];
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PUBLIC_PHOTOS) {
      issues.push({ at: `${at}.photos`, message: `Choose between 1 and ${MAX_PUBLIC_PHOTOS} photos.` }); bad = true;
    } else {
      const rows: PublishedPhoto[] = [], seen = new Set<string>();
      raw.forEach((item, i) => {
        const path = `${at}.photos[${i}]`;
        if (!isRecord(item)) { issues.push({ at: path, message: "A photo must be a closed rendition reference." }); bad = true; return; }
        checkKeys(item, new Set(["sourceRef", "renditionDigest", "bytes", "format", "alt", "caption"]), path, issues);
        const photo = item as unknown as PublishedPhoto;
        const issue = publicPhotoIssue(photo);
        if (issue || seen.has(photo.sourceRef)) { issues.push({ at: path, message: issue ?? "The same source image was selected twice in this Leaflet." }); bad = true; return; }
        seen.add(photo.sourceRef);
        rows.push(Object.freeze({ sourceRef: photo.sourceRef, renditionDigest: photo.renditionDigest, bytes: photo.bytes, format: photo.format, alt: photo.alt, ...(photo.caption === undefined ? {} : { caption: photo.caption }) }));
      });
      photos = Object.freeze(rows);
    }
  }
  let videos: readonly PublishedVideo[] | undefined;
  if ("videos" in v && videosAllowed) {
    const raw = v["videos"];
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PUBLIC_VIDEOS) {
      issues.push({ at: `${at}.videos`, message: `Choose between 1 and ${MAX_PUBLIC_VIDEOS} videos.` }); bad = true;
    } else {
      const rows: PublishedVideo[] = [], seen = new Set<string>();
      raw.forEach((item, i) => {
        const path = `${at}.videos[${i}]`;
        if (!isRecord(item)) { issues.push({ at: path, message: "A clip must be a closed reference to selected bytes." }); bad = true; return; }
        checkKeys(item, new Set(["sourceRef", "bytes", "durationSeconds", "posterRef", "caption"]), path, issues);
        const video = item as unknown as PublishedVideo;
        const issue = publicVideoIssue(video);
        if (issue || seen.has(video.sourceRef) || !photos?.some(photo => photo.sourceRef === video.posterRef)) {
          issues.push({ at: path, message: issue ?? (seen.has(video.sourceRef) ? "The same clip was selected twice." : "A clip requires a selected photo from this Leaflet as its poster.") }); bad = true; return;
        }
        seen.add(video.sourceRef);
        rows.push(Object.freeze({ sourceRef: video.sourceRef, bytes: video.bytes, durationSeconds: video.durationSeconds, posterRef: video.posterRef, ...(video.caption === undefined ? {} : { caption: video.caption }) }));
      });
      videos = Object.freeze(rows);
    }
  }
  if (bad || tierValue === null) return null;

  const result = Object.freeze(
    tierValue === "verified"
      ? {
          id: leafletId(id as string),
          title: title as string,
          tier: "verified" as const,
          // `bad` is false here, so a `verified` leaflet always reached this branch with a
          // successfully parsed `provenance` — the `!` reflects that, not an assumption.
          provenance: provenance as Provenance,
          titleRedacted: titleRedacted as boolean,
        }
      : provenance !== null
        ? {
            id: leafletId(id as string),
            title: title as string,
            tier: "pending" as const,
            provenance,
            titleRedacted: titleRedacted as boolean,
          }
        : {
            id: leafletId(id as string),
            title: title as string,
            tier: "pending" as const,
            titleRedacted: titleRedacted as boolean,
          },
  );
  return Object.freeze({ ...result, ...(narrative ? { narrative } : {}), ...(photos ? { photos } : {}), ...(videos ? { videos } : {}) });
}

function parseWithheld(
  v: unknown,
  issues: LeafDocumentIssue[],
  isLegacyVersion: boolean,
): PublishedWithholdings | null {
  if (!isRecord(v)) {
    issues.push({
      at: "withheld",
      message:
        `required, and must be an object, got ${describe(v)}. A published artifact always states ` +
        `the shape of what did not cross — "nothing was withheld" is written as ` +
        `{"count": 0, "kinds": []}, which is a statement, whereas an absent field is silence.`,
    });
    return null;
  }
  checkKeys(v, WITHHELD_KEYS, "withheld", issues);

  const count = v["count"];
  const kinds = v["kinds"];
  let bad = false;

  if (!isCount(count)) {
    issues.push({
      at: "withheld.count",
      message: `required: a non-negative integer number of review entries, got ${describe(count)}`,
    });
    bad = true;
  }

  const parsedKinds: WithholdingCount[] = [];
  if (!Array.isArray(kinds)) {
    issues.push({
      at: "withheld.kinds",
      message: `required, and must be an array — "nothing was withheld" is written as [], got ${describe(kinds)}`,
    });
    bad = true;
  } else {
    const seen = new Set<string>();
    kinds.forEach((entry, i) => {
      const at = `withheld.kinds[${i}]`;
      if (!isRecord(entry)) {
        issues.push({ at, message: `must be an object, got ${describe(entry)}` });
        bad = true;
        return;
      }
      checkKeys(entry, KIND_KEYS, at, issues);
      const kind = entry["kind"];
      const n = entry["count"];
      // A verified-only legacy artifact may still name the retired `unproven-leaflet` kind;
      // explicit-tier formats may not, since
      // nothing this canopy writes has produced it since 2026-09-06.
      const knownKinds = isLegacyVersion ? LEGACY_KIND_SET : KIND_SET;
      if (typeof kind !== "string" || !knownKinds.has(kind)) {
        issues.push({
          at: `${at}.kind`,
          message:
            `${typeof kind === "string" ? `"${kind}"` : describe(kind)} is not a withholding kind ` +
            `this canopy knows${isLegacyVersion ? " for a verified-only legacy artifact" : ""}. Known kinds: ` +
            `${[...knownKinds].join(", ")}. An unknown kind is refused rather than shown, because ` +
            `the page would otherwise print a word it cannot explain to a reader.`,
        });
        bad = true;
        return;
      }
      if (seen.has(kind)) {
        issues.push({
          at: `${at}.kind`,
          message: `"${kind}" appears twice — each kind is counted once, or the totals cannot be checked.`,
        });
        bad = true;
        return;
      }
      seen.add(kind);
      if (!isCount(n) || n === 0) {
        issues.push({
          at: `${at}.count`,
          message:
            `required: a positive integer, got ${describe(n)}. A kind listed with zero entries ` +
            `would name a withholding that did not happen.`,
        });
        bad = true;
        return;
      }
      parsedKinds.push(Object.freeze({ kind: kind as ReadableWithholdingKind, count: n }));
    });
  }

  if (bad) return null;

  const total = parsedKinds.reduce((n, k) => n + k.count, 0);
  if (total !== count) {
    issues.push({
      at: "withheld",
      message:
        `the per-kind counts add up to ${total} but "count" says ${String(count)}. They must ` +
        `agree: the total is the only number a reader sees, and if the breakdown disagrees with ` +
        `it one of them is describing a review that did not happen. This is the cross-check a ` +
        `hand-edited artifact fails.`,
    });
    return null;
  }

  return Object.freeze({ count: count as number, kinds: Object.freeze(parsedKinds) });
}

/**
 * Parse an untrusted value into a published artifact, or into every reason it is not one.
 *
 * Never throws, never partially succeeds. A single bad leaflet fails the whole artifact rather
 * than being dropped: serving the rest would publish a page that silently claims less than the
 * file describes, which is the same failure class as collapsing four causes into a zero.
 */
export function parsePublishedDocument(value: unknown): PublishedDocumentParse {
  const issues: LeafDocumentIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: Object.freeze([
        {
          at: "(document)",
          message: `a published artifact must be a JSON object — got ${describe(value)}`,
        },
      ]),
    };
  }

  checkKeys(value, ROOT_KEYS, "", issues);

  const artifact = value["artifact"];
  if (artifact !== PUBLISHED_ARTIFACT) {
    issues.push({
      at: "artifact",
      message:
        `required, and must be exactly "${PUBLISHED_ARTIFACT}" — got ${
          typeof artifact === "string" ? `"${artifact}"` : describe(artifact)
        }. The tag is checked before anything else so that a leaf document, a tree manifest or an ` +
        `unrelated JSON file is refused as "not this format" rather than as a list of missing fields.`,
    });
  }

  // Known versions only. Unknown versions are still inspected for independent defects.
  const rawVersion = value["artifactVersion"];
  const versionReadable = typeof rawVersion === "number" && READABLE_ARTIFACT_VERSIONS.has(rawVersion);
  if (!versionReadable) {
    issues.push({
      at: "artifactVersion",
      message:
        `required, and must be 1, 2, 3, 4, 5, 6 or 7 — got ${
          typeof rawVersion === "number" ? String(rawVersion) : describe(rawVersion)
        }. This canopy reads version 7 (selected video), version 6 (selected photos), version 5 (named portfolio), version 4, version 3, both known version-2 formats, and version 1. ` +
        `An unknown version is refused. Republish this leaf with this canopy to write a version it reads.`,
    });
  }
  const artifactVersion: PublishedArtifactVersion = versionReadable
    ? (rawVersion as PublishedArtifactVersion)
    : PUBLISHED_ARTIFACT_VERSION;
  // Two independent branches used v2. The policy-provenance dialect never wrote tiers;
  // the explicit-tier dialect never wrote policyDigest. Closed keys reject hybrid shapes.
  const rawSource = value["source"];
  const policyV2 = artifactVersion === 2 && isRecord(rawSource) && "policyDigest" in rawSource;
  const hasPolicyProvenance = artifactVersion >= 3 || policyV2;
  const implicitVerified = artifactVersion === 1 || policyV2;

  const publishedAt = value["publishedAt"];
  if (!nonEmptyString(publishedAt)) {
    issues.push({
      at: "publishedAt",
      message:
        `required: an ISO-8601 instant, got ${describe(publishedAt)}. An artifact that cannot ` +
        `say when it was made is one nobody can date-check.`,
    });
  } else if (!isIsoInstant(publishedAt)) {
    issues.push({
      at: "publishedAt",
      message:
        `"${publishedAt}" is not an ISO-8601 instant with an offset. The offset is required for ` +
        `the same reason it is on a leaflet's observedAt: a local-time stamp is an instant plus ` +
        `an unstated assumption about where the clock was.`,
    });
  }

  let source: PublishedSource | null = null;
  if (!isRecord(rawSource)) {
    issues.push({
      at: "source",
      message: `required, and must be an object naming what this artifact was made from, got ${describe(rawSource)}`,
    });
  } else {
    checkKeys(rawSource, hasPolicyProvenance ? SOURCE_KEYS : LEGACY_SOURCE_KEYS, "source", issues);
    const digest = rawSource["documentDigest"];
    const bytes = rawSource["documentBytes"];
    const policyDigest = rawSource["policyDigest"];
    let bad = false;
    if (typeof digest !== "string" || !DOCUMENT_DIGEST.test(digest)) {
      issues.push({
        at: "source.documentDigest",
        message:
          `required: "sha256:" followed by 64 lower-case hex digits, got ${describe(digest)}. ` +
          `This is the digest of the leaf document's bytes, and it is what lets anyone holding ` +
          `that file prove — or disprove — that this artifact came from it.`,
      });
      bad = true;
    }
    if (!isCount(bytes)) {
      issues.push({
        at: "source.documentBytes",
        message: `required: a non-negative integer byte count of the leaf document, got ${describe(bytes)}`,
      });
      bad = true;
    }
    if (hasPolicyProvenance && (typeof policyDigest !== "string" || !DOCUMENT_DIGEST.test(policyDigest))) {
      issues.push({ at: "source.policyDigest", message: `required in this format: policyDigest must be "sha256:" followed by 64 lower-case hex digits, got ${describe(policyDigest)}.` });
      bad = true;
    }
    if (!bad) {
      source = Object.freeze({ documentDigest: digest as string, documentBytes: bytes as number,
        policyDigest: hasPolicyProvenance ? policyDigest as string : null });
    }
  }

  const withheld = parseWithheld(value["withheld"], issues, implicitVerified);

  let id: string | null = null;
  let subject: string | null = null;
  let subjectRedacted: boolean | null = null;
  const leaflets: PublishedLeaflet[] = [];
  let leafOk = true;

  const rawLeaf = value["leaf"];
  if (!isRecord(rawLeaf)) {
    issues.push({
      at: "leaf",
      message: `required, and must be an object with id, subject, subjectRedacted and leaflets, got ${describe(rawLeaf)}`,
    });
    leafOk = false;
  } else {
    checkKeys(rawLeaf, artifactVersion >= 5 ? new Set([...LEAF_KEYS, "portfolio"]) : LEAF_KEYS, "leaf", issues);

    const rawId = rawLeaf["id"];
    if (!nonEmptyString(rawId)) {
      issues.push({ at: "leaf.id", message: `required: a non-empty id, got ${describe(rawId)}` });
      leafOk = false;
    } else if (!PUBLISHED_ID.test(rawId)) {
      issues.push({
        at: "leaf.id",
        message:
          `"${rawId}" cannot be a published id. It must match ${String(PUBLISHED_ID)} — lower-case ` +
          `letters, digits and interior hyphens — because the id IS the URL this leaf gets. It is ` +
          `refused rather than transformed: two different ids that slugified to the same string ` +
          `would land on one URL, and one person's page would overwrite another's.`,
      });
      leafOk = false;
    } else {
      id = rawId;
    }

    const rawSubject = rawLeaf["subject"];
    if (!nonEmptyString(rawSubject)) {
      issues.push({
        at: "leaf.subject",
        message: `required: the display name of the person this page is about, got ${describe(rawSubject)}`,
      });
      leafOk = false;
    } else {
      subject = rawSubject;
    }

    const rawRedacted = rawLeaf["subjectRedacted"];
    if (typeof rawRedacted !== "boolean") {
      issues.push({
        at: "leaf.subjectRedacted",
        message:
          `required, and must be a boolean, got ${describe(rawRedacted)}. Not optional, for the ` +
          `same reason as a leaflet's: an absent value would default to "these are the person's ` +
          `own words".`,
      });
      leafOk = false;
    } else {
      subjectRedacted = rawRedacted;
    }

    const rawLeaflets = rawLeaf["leaflets"];
    if (!Array.isArray(rawLeaflets)) {
      issues.push({
        at: "leaf.leaflets",
        message:
          `required, and must be an array, got ${describe(rawLeaflets)}. A published leaf with ` +
          `nothing verified is written as [] and is an honest empty page — it is not the same ` +
          `statement as the field being missing.`,
      });
      leafOk = false;
    } else {
      const seen = new Set<string>();
      rawLeaflets.forEach((raw, i) => {
        const leaflet = parseLeaflet(raw, i, issues, implicitVerified, artifactVersion >= 4, artifactVersion >= 6, artifactVersion >= 7);
        if (leaflet === null) {
          leafOk = false;
          return;
        }
        if (seen.has(leaflet.id)) {
          issues.push({
            at: `leaf.leaflets[${i}].id`,
            message: `duplicate id "${leaflet.id}" — ids must be unique within a published leaf.`,
          });
          leafOk = false;
          return;
        }
        seen.add(leaflet.id);
        leaflets.push(leaflet);
      });
    }
  }

  let portfolio: PublishedPortfolio | undefined;
  if (artifactVersion >= 5 && isRecord(rawLeaf) && rawLeaf["portfolio"] !== undefined && id !== null && subject !== null) {
    const parsed = parsePublicPortfolio(rawLeaf["portfolio"], { id, subject, leaflets }, publicAuthoredTextIssue);
    if (parsed.ok) portfolio = parsed.portfolio;
    else issues.push(...parsed.issues);
  }
  if (leaflets.reduce((n, l) => n + (l.photos?.length ?? 0), 0) > MAX_PUBLIC_PHOTOS) {
    issues.push({ at: "leaf.leaflets", message: `Choose at most ${MAX_PUBLIC_PHOTOS} photos in one publication.` });
  }
  if (leaflets.reduce((n, l) => n + (l.videos?.length ?? 0), 0) > MAX_PUBLIC_VIDEOS) {
    issues.push({ at: "leaf.leaflets", message: `Choose at most ${MAX_PUBLIC_VIDEOS} videos in one publication.` });
  }

  if (issues.length > 0 || !leafOk || source === null || withheld === null || id === null) {
    return { ok: false, issues: Object.freeze(issues) };
  }

  /*
   * THE INGEST GATE. Reconstruct a `Leaf` and run the redaction gate over it again. The gate is
   * idempotent on its own output, so an artifact it produced withholds nothing on a second pass;
   * anything it does withhold here is text that should never have been in the file.
   *
   * `declaredExample: false` is not an assumption being smuggled in — an example document is
   * refused WHOLE by `reviewForPublication`, so no artifact can exist for one, and there is no
   * field in this format that could carry the flag. What is being checked here is the text.
   *
   * `visibility: "public"` is not an assumption either, and for the same shape of reason: this
   * format carries no visibility field at all, on purpose — a leaflet reaches this artifact only
   * after `reviewForPublication` already found it `public` at publish time, and the consent
   * question is not one a hosted page needs to keep re-asking about a decision already acted on.
   * Reconstructing with the DEFAULT (private) would make the ingest gate refuse every artifact it
   * has ever produced, which is the opposite of what "idempotent on its own output" means. What
   * this re-run checks is the TEXT, exactly as the comment above says.
   *
   * `tier` IS carried from the artifact, unlike `visibility` above — it is a field on disk now
   * (see the header), and `reviewForPublication` needs the true value to ask the right question of
   * each leaflet: an `unpublishable-provenance` check runs for both tiers, but a `verified`
   * leaflet's provenance is required and a `pending` one's is not. Recording it as `"verified"`
   * unconditionally, as this reconstruction did before tier travelled, would silently demand
   * provenance of a `pending` leaflet that never carried one.
   */
  const reconstructed: Leaf = {
    id: leafId(id),
    subject: subject as string,
    leaflets: leaflets.map(
      (l): Leaflet =>
        l.tier === "verified"
          ? { id: l.id, title: l.title, tier: "verified", provenance: l.provenance, visibility: "public" }
          : l.provenance !== undefined
            ? { id: l.id, title: l.title, tier: "pending", provenance: l.provenance, visibility: "public" }
            : { id: l.id, title: l.title, tier: "pending", visibility: "public" },
    ),
  };

  const review: PublicationReview = reviewForPublication({
    leaf: reconstructed,
    declaredExample: false,
  });

  if (!review.ok) {
    for (const refusal of review.refusals) {
      issues.push({ at: refusal.at, message: refusal.reason });
    }
    return { ok: false, issues: Object.freeze(issues) };
  }

  if (review.withheld.length > 0) {
    for (const w of review.withheld) {
      issues.push({
        at: w.at,
        message:
          `this artifact carries text the publication gate withholds (${w.kind}). An artifact ` +
          `produced by that gate passes it a second time unchanged, so this file was either not ` +
          `produced by it or was edited afterwards. It is refused rather than re-redacted here: ` +
          `silently fixing it would serve a page whose publisher never saw what it says.`,
      });
    }
    return { ok: false, issues: Object.freeze(issues) };
  }

  return {
    ok: true,
    document: Object.freeze({
      artifact: PUBLISHED_ARTIFACT,
      // The version this FILE declared, preserved rather than stamped with the current write
      // version — a version-1 artifact that reads clean is still a version-1 artifact until
      // somebody republishes it (see the header's `artifactVersion` paragraph), and the footer
      // this renders honestly says which.
      artifactVersion,
      publishedAt: publishedAt as string,
      source,
      /*
       * The brand is minted HERE and the mint is honest: `reviewForPublication` just ran over
       * this exact text and withheld nothing. `subjectRedacted` and `titleRedacted` are carried
       * from the artifact rather than from the re-run, because only someone holding the original
       * document knows whether text was altered — the re-run would report false for every field
       * and the page would then claim redacted text as verbatim.
       */
      leaf: Object.freeze({
        id: leafId(id),
        subject: subject as string,
        leaflets: Object.freeze(leaflets),
        ...(portfolio ? { portfolio } : {}),
        subjectRedacted: subjectRedacted as boolean,
        reviewedForPublication: true as const,
      }),
      withheld,
    }),
  };
}

/**
 * The digest recorded in `source.documentDigest`.
 *
 * SHA-256 over the leaf document's bytes exactly as they sit on disk — not over a re-serialization
 * of the parsed value, which would change with key order and whitespace and make the digest
 * unverifiable by anyone with the file and a shasum binary. `node:crypto`, so no dependency.
 */
export function documentDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export interface PublishedBuild {
  readonly review: Extract<PublicationReview, { ok: true }>;
  /** ISO-8601 instant with an offset. Injected, never read from a clock in here. */
  readonly publishedAt: string;
  readonly documentDigest: string;
  readonly documentBytes: number;
  readonly policyDigest: string;
}

/**
 * Assemble a published artifact from a review that passed.
 *
 * Kept pure and clock-free: `publishedAt` is a parameter so this function is deterministic and so
 * the ONE place a timestamp enters is the command that a human consented to run. It validates its
 * own inputs and refuses rather than emitting an artifact its own parser would reject — the same
 * self-check discipline `intake.mjs` uses, mechanised instead of asserted.
 *
 * O(w) in withholdings for the per-kind tally, O(1) otherwise — the leaflets are already gated.
 */
export function buildPublishedDocument(
  build: PublishedBuild,
): { ok: true; document: PublishedLeafDocument } | { ok: false; issues: readonly LeafDocumentIssue[] } {
  const issues: LeafDocumentIssue[] = [];

  if (!isIsoInstant(build.publishedAt)) {
    issues.push({
      at: "publishedAt",
      message: `"${build.publishedAt}" is not an ISO-8601 instant with an offset.`,
    });
  }
  if (!DOCUMENT_DIGEST.test(build.documentDigest)) {
    issues.push({
      at: "source.documentDigest",
      message: `"${build.documentDigest}" is not a sha256 digest of the expected shape.`,
    });
  }
  if (!DOCUMENT_DIGEST.test(build.policyDigest)) {
    issues.push({ at: "source.policyDigest", message: `"${build.policyDigest}" is not a sha256 digest of the expected shape.` });
  }
  if (!isCount(build.documentBytes)) {
    issues.push({
      at: "source.documentBytes",
      message: `${String(build.documentBytes)} is not a non-negative integer byte count.`,
    });
  }
  if (!PUBLISHED_ID.test(build.review.published.id)) {
    issues.push({
      at: "leaf.id",
      message:
        `"${build.review.published.id}" cannot be a published id — it must match ` +
        `${String(PUBLISHED_ID)}, because the id is the URL. Give the leaf a url-safe id and ` +
        `publish again; it is not transformed here, since a silently altered id is a different ` +
        `page from the one anyone was told about.`,
    });
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };

  const tally = new Map<WithholdingKind, number>();
  for (const w of build.review.withheld) {
    tally.set(w.kind, (tally.get(w.kind) ?? 0) + 1);
  }
  // Emitted in the declaration order of `WITHHOLDING_KINDS`, not in encounter order, so two runs
  // over the same document produce byte-identical artifacts.
  const kinds: WithholdingCount[] = WITHHOLDING_KINDS.filter((k) => (tally.get(k) ?? 0) > 0).map(
    (kind) => Object.freeze({ kind, count: tally.get(kind) as number }),
  );

  return {
    ok: true,
    document: Object.freeze({
      artifact: PUBLISHED_ARTIFACT,
      artifactVersion: build.review.published.leaflets.some(l => l.videos?.length) ? 7 :
        build.review.published.leaflets.some(l => l.photos?.length) ? 6 : PUBLISHED_ARTIFACT_VERSION,
      publishedAt: build.publishedAt,
      source: Object.freeze({
        documentDigest: build.documentDigest,
        documentBytes: build.documentBytes,
        policyDigest: build.policyDigest,
      }),
      leaf: build.review.published,
      withheld: Object.freeze({ count: build.review.withheld.length, kinds: Object.freeze(kinds) }),
    }),
  };
}

/**
 * The artifact as plain JSON, in a fixed key order.
 *
 * Explicit rather than `JSON.stringify(document)` for two reasons. The branded
 * `reviewedForPublication` marker is a TYPE-LEVEL fact that must not become an on-disk field — it
 * is minted by re-running the gate, and a field a hand-edited file could set would let something
 * claim the brand without earning it. `tier`, by contrast, IS an on-disk field since 2026-09-06
 * (see the header): it is what tells a reader which leaflets are proven, so it has to survive the
 * round trip, and `provenance` is emitted only when the leaflet carries one — a `pending` leaflet
 * may not (mirroring `Leaflet` itself). A fixed key order makes two publications of an unchanged
 * document differ in exactly one line, which is what makes re-publish reviewable with `diff`.
 */
export function toArtifactJson(document: PublishedLeafDocument): Record<string, unknown> {
  return {
    artifact: document.artifact,
    artifactVersion: document.artifactVersion,
    publishedAt: document.publishedAt,
    source: {
      documentDigest: document.source.documentDigest,
      documentBytes: document.source.documentBytes,
      ...(document.source.policyDigest === null ? {} : { policyDigest: document.source.policyDigest }),
    },
    leaf: {
      id: document.leaf.id,
      subject: document.leaf.subject,
      subjectRedacted: document.leaf.subjectRedacted,
      ...(document.artifactVersion >= 5 && document.leaf.portfolio ? { portfolio: publicPortfolioJson(document.leaf.portfolio) } : {}),
      leaflets: document.leaf.leaflets.map((l) => ({
        id: l.id,
        title: l.title,
        ...(document.artifactVersion >= 4 && l.narrative ? { narrative: l.narrative.map(p => ({ text: p.text, provenance: { source: p.provenance.source, ref: p.provenance.ref, observedAt: p.provenance.observedAt } })) } : {}),
        ...(document.artifactVersion >= 6 && l.photos ? { photos: l.photos.map(p => ({ sourceRef: p.sourceRef, renditionDigest: p.renditionDigest, bytes: p.bytes, format: p.format, alt: p.alt, ...(p.caption === undefined ? {} : { caption: p.caption }) })) } : {}),
        ...(document.artifactVersion >= 7 && l.videos ? { videos: l.videos.map(v => ({ sourceRef: v.sourceRef, bytes: v.bytes, durationSeconds: v.durationSeconds, posterRef: v.posterRef, ...(v.caption === undefined ? {} : { caption: v.caption }) })) } : {}),

        ...(document.artifactVersion === 1 || (document.artifactVersion === 2 && document.source.policyDigest !== null) ? {} : { tier: l.tier }),
        titleRedacted: l.titleRedacted,
        ...(l.provenance !== undefined
          ? {
              provenance: {
                source: l.provenance.source,
                ref: l.provenance.ref,
                observedAt: l.provenance.observedAt,
              },
            }
          : {}),
      })),
    },
    withheld: {
      count: document.withheld.count,
      kinds: document.withheld.kinds.map((k) => ({ kind: k.kind, count: k.count })),
    },
  };
}
