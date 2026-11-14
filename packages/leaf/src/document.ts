/**
 * The LEAF DOCUMENT — the on-disk form of a compound leaf, and the total function that turns
 * untrusted JSON into a `Leaf`.
 *
 * WHY THIS LIVES IN @foliage/leaf AND NOT IN THE APP. A self-hostable portfolio is only
 * self-hostable if the document format is part of the open core: the person owns the file, so
 * they must be able to read the exact rules their file is judged by. Putting the validator
 * next to the type it validates also means there is one implementation — an app-local
 * validator would drift from `Leaf` the first time the type changed, and every future
 * consumer (evidence intake, an importer, a linter) would write a third one.
 *
 * The function is TOTAL and PURE. No fs, no network, no throw: it takes `unknown` and returns
 * either a `Leaf` or the complete list of reasons it is not one. Deliberately no exceptions —
 * a thrown error carries one problem and a stack trace nobody reads, whereas the caller here
 * needs every problem at once so the person editing the file can fix it in one pass.
 *
 * Two rules that look pedantic and are not:
 *
 *   UNKNOWN KEYS ARE REFUSED, not ignored. Silently dropping an unrecognised key is how
 *   `"reasson"` on an excluded leaflet becomes an unexplained absence, and — the case that
 *   actually motivates it — how a `score` field enters a document and is either invisible or,
 *   worse, later honoured. A key that would smuggle a rating in is refused BY NAME, with the
 *   reason stated, because this product never computes or displays a score.
 *
 *   AN INSTANT NEEDS AN OFFSET. `observedAt` must carry `Z` or `±HH:MM`. A local-time
 *   timestamp is not an observation, it is an observation plus an unstated assumption.
 *
 * A LEAFLET BODY IS GATED ELEMENT-WISE, and the gate is the same one, applied one level
 * deeper. Every body element must carry its own provenance — an ungrounded element is refused
 * rather than rendered — and the unknown-key and score-shaped-key refusals reach INSIDE
 * elements, because a body is more surface for a rating to hide in, not less. `body` is
 * optional, so every document written before it existed still parses; when present, every
 * element of it is judged.
 *
 * A BODY ELEMENT MAY BE TEXT OR MEDIA, and the media half brings ONE extra rule that the text
 * half does not need: `provenance.ref` must BE the content digest. A media element is the only
 * place where the reference and the artifact can be checked against each other by anyone — hash
 * what was served, compare — and that property only exists if the ref is the digest, so a media
 * element whose ref is a path, a file name or a commit sha is REFUSED with that said. Everything
 * else is unchanged and reaches all the way in: unknown keys refused, score-shaped keys refused
 * BY NAME, instants carrying offsets, and dimensions that are either measured or carry the
 * reason they are not. A media element is more surface for a rating to hide in, not less.
 *
 * `visibility` is optional for the same reason, and its ABSENCE means `private`. That default
 * is applied by `leafletVisibility` rather than written into the parsed value on purpose:
 * materialising it here would rewrite the field into documents that never mentioned it, and a
 * gate that edits the file it is judging is a gate you cannot reason about.
 *
 * Complexity: O(n) in leaflets and their body elements, one pass, plus an O(n) Set for
 * duplicate ids.
 */

import {
  LEAFLET_VISIBILITIES,
  MEDIA_TYPES,
  MAX_FEATURED_LEAFLETS,
  PORTFOLIO_LIMITS,
  ACHIEVEMENT_CLAIM_KINDS,
  LEAF_COLLECTION_KINDS,
  PROOF_TIERS,
  leafId,
  leafletId,
  type BodyElement,
  type Leaf,
  type LeafCuration,
  type LeafProfile,
  type LeafAchievement,
  type JourneyEdit,
  type AchievementClaim,
  type ClaimCitation,
  type LeafCollection,
  type Leaflet,
  type LeafletBody,
  type LeafletMedia,
  type LeafletVisibility,
  type MediaType,
  type PixelDimensions,
  type ProofTier,
  type Provenance,
} from "./leaf.ts";

import { RATING_SHAPED } from "./publishPolicy.ts";

/** One reason a document is not a leaf, addressed to the person editing the file. */
export interface LeafDocumentIssue {
  /**
   * Where the problem is, in a path a human can find in their editor:
   * `subject`, `leaflets`, `leaflets[2].reason`, `leaflets[0].provenance.observedAt`.
   * Naming the leaflet INDEX is the point — "invalid leaflet" in a 40-leaflet file is
   * not an error message, it is a scavenger hunt.
   */
  readonly at: string;
  readonly message: string;
}

export type LeafDocumentParse =
  | {
      readonly ok: true;
      readonly leaf: Leaf;
      /**
       * The document declared `"example": true` — it is a fabricated illustration and must
       * never be presented as real evidence. Carried on the parse result rather than on
       * `Leaf` so the domain type stays clean, and read by the renderer to show a
       * non-dismissible band.
       */
      readonly declaredExample: boolean;
    }
  | { readonly ok: false; readonly issues: readonly LeafDocumentIssue[] };

import { parsePortfolioPresentation, type PortfolioPresentation } from "./portfolio.ts";

const DOCUMENT_KEYS: ReadonlySet<string> = new Set([
  "id",
  "subject",
  "headline",
  "curation",
  "presentation",
  "profile",
  "achievements",
  "journeyHistory",
  "collections",
  "leaflets",
  "example",
]);
const CURATION_KEYS: ReadonlySet<string> = new Set(["featured"]);
const PROFILE_KEYS = new Set(["bio", "direction", "passions"]);
const ACHIEVEMENT_KEYS = new Set(["id", "title", "claims"]);
const CLAIM_KEYS = new Set(["id", "kind", "text", "citations"]);
const CITATION_KEYS = new Set(["leaflet", "provenance"]);
const COLLECTION_KEYS = new Set(["id", "title", "kind", "description", "achievements", "leaflets"]);
const LEAFLET_KEYS: ReadonlySet<string> = new Set([
  "id",
  "title",
  "tier",
  "provenance",
  "reason",
  "body",
  "visibility",
]);
const PROVENANCE_KEYS: ReadonlySet<string> = new Set(["source", "ref", "observedAt"]);
/**
 * A body element holds a ref, at most one sentence about it, and — when the artifact IS the
 * image — the media itself. There is no fourth key, and that is the point: every additional
 * field is a place for an unsourced claim to sit beside a sourced one and inherit its
 * credibility. `media` earns its place by being the opposite of that: it carries no assertion at
 * all, only what the bytes are and how big they are, both checkable against the file.
 */
const BODY_ELEMENT_KEYS: ReadonlySet<string> = new Set(["text", "provenance", "media"]);
/** What it is and how big it is. The digest is `provenance.ref`, so there is no id key here. */
const MEDIA_KEYS: ReadonlySet<string> = new Set(["mediaType", "dimensions"]);
const DIMENSIONS_KNOWN_KEYS: ReadonlySet<string> = new Set(["known", "width", "height"]);
const DIMENSIONS_UNKNOWN_KEYS: ReadonlySet<string> = new Set(["known", "why"]);
/**
 * Used ONLY when `known` is not a boolean, so the allowed set cannot be chosen.
 *
 * The document is already rejected at that point, so this changes no verdict — it changes what
 * the person is TOLD. Skipping the key check on the malformed branch would let a `confidence`
 * sitting next to a broken `known` go unmentioned, and the one thing worse than a refused rating
 * is a rating nobody was told about because a neighbouring field was wrong.
 */
const DIMENSIONS_ANY_KEYS: ReadonlySet<string> = new Set([
  "known",
  "width",
  "height",
  "why",
]);

/**
 * Keys that would put a rating into the document format. Refused by name so the refusal is
 * legible: the FCRA posture is that no score is ever shown to an employer, and a format that
 * quietly tolerates a `score` field is one release away from displaying it.
 *
 * EXPORTED ON PURPOSE, and for the same reason `isIsoInstant` is: every gate in the tree has to
 * refuse the SAME names, and the second copy of this list is the one that goes stale. Two other
 * gates read it today: the harvest document parser in @foliage/photosynthesis refuses these keys
 * one layer earlier — an extractor is exactly the kind of producer that wants to attach a
 * `confidence` to its drafts — and the chief-of-staff router (`@foliage/cos`) refuses them in
 * assembled context before it will let anything cross to an inference provider. If either
 * re-declared the list, the day someone adds a name is the day the gates start disagreeing
 * about what a score is. One list, every gate.
 */
export const SCORE_SHAPED: ReadonlySet<string> = new Set([
  "score",
  "scores",
  "rating",
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
]);

/** ISO-8601 instant with a mandatory offset. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Is this an ISO-8601 instant carrying an explicit offset?
 *
 * EXPORTED ON PURPOSE. Evidence intake has to emit instants that this parser will accept, and
 * a second copy of the rule in the producer would drift from this one the first time either
 * changed — at which point intake would cheerfully write documents the loader rejects, and the
 * failure would surface as "your file is invalid" about a file the product itself produced.
 * One definition, both directions.
 */
export function isIsoInstant(v: string): boolean {
  return ISO_INSTANT.test(v) && Number.isFinite(Date.parse(v));
}

/**
 * A content digest ref: the algorithm, a colon, and the lowercase hex digest.
 *
 * THE ALGORITHM IS IN THE REF because a bare hex string cannot be re-computed by anyone who does
 * not already know how it was made, and a ref nobody can re-compute is indistinguishable from a
 * fabricated one. Naming it also means a future algorithm is a new ALTERNATIVE here rather than a
 * silent reinterpretation of the digests already written — which is what changing the meaning of
 * a bare hex field would be.
 *
 * Only `sha256` today, because that is the only digest this product computes: photo intake emits
 * `sha256:<hex>` and the git path's object names are a different thing entirely (a commit sha is
 * not a digest of the file it points at, which is exactly why a commit ref is refused on a media
 * element).
 */
const MEDIA_DIGEST_REF = /^sha256:[0-9a-f]{64}$/;

/**
 * Is this ref a content digest — the form a media element's ref MUST take?
 *
 * EXPORTED ON PURPOSE, same reasoning as `isIsoInstant`: photo intake builds `sha256:${digest}`
 * one layer earlier, and a second copy of the rule in the producer would drift from this one the
 * first time either changed — at which point intake would write media elements this gate refuses,
 * and the failure would read as "your file is invalid" about a file the product itself produced.
 */
export function isMediaDigestRef(ref: string): boolean {
  return MEDIA_DIGEST_REF.test(ref);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Describe what we got, for an error message that does not make the reader guess. */
function describe(v: unknown): string {
  // `undefined` means the field is not there at all, which is a different fact from a field
  // present with a wrong value — and "a undefined" tells the reader neither.
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
  issues: LeafDocumentIssue[],
): void {
  for (const key of Object.keys(rec)) {
    if (allowed.has(key)) continue;
    const where = at === "" ? key : `${at}.${key}`;
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      issues.push({
        at: where,
        message:
          `"${key}" is refused by name: this format carries no rating of any kind. ` +
          `Proof is reported as per-tier counts, never as a number that reads like a score.`,
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

function parseProvenance(
  v: unknown,
  at: string,
  issues: LeafDocumentIssue[],
): Provenance | null {
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
      message: `required: a stable handle for the artifact (commit sha, digest), got ${describe(ref)}`,
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

/**
 * The pixel size, or the named reason there is not one.
 *
 * REFUSES A ZERO IN BOTH DIRECTIONS. `{ known: true, width: 0 }` is refused because zero is not a
 * size, it is the shape a missing measurement takes when nobody made room for a cause; and
 * `{ known: false }` with a blank `why` is refused because "not measured" with no reason leaves
 * the reader unable to tell a missing decoder from an unreadable file. This is the
 * `commitCount: 0` failure at the scale of one field, and it is refused at the same door.
 */
function parsePixelDimensions(
  v: unknown,
  at: string,
  issues: LeafDocumentIssue[],
): PixelDimensions | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message:
        `"dimensions" must be an object — either { "known": true, "width": w, "height": h } or ` +
        `{ "known": false, "why": "..." } — got ${describe(v)}. A size that could not be ` +
        `measured states its cause; it is never a zero and never simply absent.`,
    });
    return null;
  }

  const known = v["known"];
  if (typeof known !== "boolean") {
    // Key-check against the union so a score-shaped neighbour is still named. See
    // DIMENSIONS_ANY_KEYS.
    checkKeys(v, DIMENSIONS_ANY_KEYS, at, issues);
    issues.push({
      at: `${at}.known`,
      message:
        `required: true when the size was measured, false when it was not — got ${describe(known)}. ` +
        `The flag is what forces an unmeasured image to carry a reason instead of a zero.`,
    });
    return null;
  }

  if (known) {
    checkKeys(v, DIMENSIONS_KNOWN_KEYS, at, issues);
    const width = v["width"];
    const height = v["height"];
    const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
    if (!ok(width) || !ok(height)) {
      issues.push({
        at: `${at}`,
        message:
          `a known size is two positive whole pixel counts, got width ${describe(width)} and ` +
          `height ${describe(height)}. Dimensions that could not be measured are ` +
          `{ "known": false } WITH a reason — never a zero standing in for one.`,
      });
      return null;
    }
    return Object.freeze({ known: true as const, width, height });
  }

  checkKeys(v, DIMENSIONS_UNKNOWN_KEYS, at, issues);
  const why = v["why"];
  if (!nonEmptyString(why)) {
    issues.push({
      at: `${at}.why`,
      message:
        `unknown dimensions require a reason, got ${describe(why)}. "Not measured" with no cause ` +
        `is the absence this format refuses: the reader cannot tell a missing decoder from an ` +
        `unreadable file, and neither can the person who wrote the document.`,
    });
    return null;
  }
  return Object.freeze({ known: false as const, why });
}

/**
 * The media an element carries: what it is, and how big.
 *
 * NO IDENTIFIER IS PARSED HERE and none is accepted, because the ref already is one. A `path`, a
 * `name` or a `url` key would be a second name for the same artifact, and two names for one
 * thing is a disagreement waiting to happen — so they land in the unknown-key refusal like
 * anything else.
 *
 * EXPORTED for the same stated reason as `isMediaDigestRef` and `isIsoInstant`: the harvest
 * document (`@foliage/photosynthesis`) carries this exact object one layer earlier, so a
 * reviewer can see what a candidate would publish before approving it. A second copy of these
 * rules in that parser would drift on the first change here, and the failure would arrive as
 * "your harvest is invalid" about a file this product wrote — or worse, as a harvest the gate
 * accepts and the leaf gate then refuses at promotion, which is the one moment a person has
 * already approved something. `issues` is the caller's array because the two formats spell the
 * same issue the same way (`{ at, message }`), so nothing is translated on the way back.
 */
export function parseLeafletMedia(
  v: unknown,
  at: string,
  issues: LeafDocumentIssue[],
): LeafletMedia | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message:
        `"media" must be an object naming what the artifact is and how big it is, got ` +
        `${describe(v)}. Its identity is not in here — that is provenance.ref, which for a media ` +
        `element is the digest of these exact bytes.`,
    });
    return null;
  }
  // The same two refusals as everywhere else, one level deeper again.
  checkKeys(v, MEDIA_KEYS, at, issues);

  let bad = false;

  const mediaType = v["mediaType"];
  if (typeof mediaType !== "string" || !MEDIA_TYPES.includes(mediaType as MediaType)) {
    issues.push({
      at: `${at}.mediaType`,
      message:
        `required: one of ${MEDIA_TYPES.join(", ")} — got ${
          typeof mediaType === "string" ? `"${mediaType}"` : describe(mediaType)
        }. The list is closed and matches the formats this product identifies by magic bytes. ` +
        `"image/svg+xml" is deliberately not on it: an SVG is a document that executes, and it ` +
        `can reach the network from the page a stranger opens. MP4 is the only video type the ` +
        `local capture adapter can record and verify.`,
    });
    bad = true;
  }

  if (!("dimensions" in v)) {
    issues.push({
      at: `${at}.dimensions`,
      message:
        `required: the pixel size, or { "known": false, "why": "..." } saying why there is not ` +
        `one. Omitting the field would make "nobody looked" and "the decoder is missing" look ` +
        `identical, which is the absence this format refuses.`,
    });
    bad = true;
  }
  const dimensions =
    "dimensions" in v
      ? parsePixelDimensions(v["dimensions"], `${at}.dimensions`, issues)
      : null;
  if (dimensions === null) bad = true;

  if (bad || dimensions === null) return null;
  return Object.freeze({ mediaType: mediaType as MediaType, dimensions });
}

/**
 * One grounded body element: a required evidence ref, and at most one sentence about it.
 *
 * The required provenance is the whole gate. An element without it is not "a body element
 * missing a field" — it is unsourced prose, which is the thing a structured body exists to
 * make unrepresentable, so it is refused with that said out loud rather than with a
 * field-shaped complaint the reader has to interpret.
 */
function parseBodyElement(
  v: unknown,
  at: string,
  issues: LeafDocumentIssue[],
): BodyElement | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message:
        `a body element must be an object carrying its own provenance, got ${describe(v)}. ` +
        `A body is a list of grounded elements, never a block of text.`,
    });
    return null;
  }
  // Reaches the unknown-key AND the score-shaped-by-name refusals into the element. A body is
  // the newest place a `confidence` could be attached, and it is gated like everywhere else.
  checkKeys(v, BODY_ELEMENT_KEYS, at, issues);

  let bad = false;

  if (!("provenance" in v)) {
    issues.push({
      at: `${at}.provenance`,
      message:
        `required: every body element carries its own evidence ref. An element without one is ` +
        `an unsourced claim sitting beside sourced ones, which is exactly what a structured ` +
        `body exists to prevent — so it is refused rather than shown ungrounded.`,
    });
    bad = true;
  }
  const provenance =
    "provenance" in v ? parseProvenance(v["provenance"], `${at}.provenance`, issues) : null;
  if (provenance === null) bad = true;

  const text = v["text"];
  if ("text" in v && !nonEmptyString(text)) {
    issues.push({
      at: `${at}.text`,
      message:
        `if present, "text" is one non-empty claim about this element's evidence, got ` +
        `${describe(text)}. Omit the key rather than writing an empty one: an element with a ` +
        `ref and no words is a legitimate, honest evidence listing.`,
    });
    bad = true;
  }

  const media = "media" in v ? parseLeafletMedia(v["media"], `${at}.media`, issues) : null;
  if ("media" in v && media === null) bad = true;

  // THE DIGEST IS THE NAME, enforced here because it cannot be enforced in the type — see
  // `LeafletMedia`. Gated on the element DECLARING media rather than on the media parsing, so a
  // document with both problems is told about both in one pass. A ref that is a path or a commit
  // sha is refused: it would leave the reference and the bytes unable to be checked against each
  // other, which is the entire property that makes carrying an image honest rather than a claim.
  if ("media" in v && provenance !== null && !isMediaDigestRef(provenance.ref)) {
    issues.push({
      at: `${at}.provenance.ref`,
      message:
        `a media element's ref must BE the content digest of its bytes — "sha256:" followed by ` +
        `64 lowercase hex characters — got "${provenance.ref}". The digest is the name: anyone ` +
        `served this media can hash what they received and compare, and that check is only ` +
        `possible while the ref and the bytes cannot disagree. A path or a commit sha names ` +
        `something ELSE that may or may not still be this file.`,
    });
    bad = true;
  }

  if (bad || provenance === null) return null;
  // exactOptionalPropertyTypes: omit each optional key rather than set it undefined, so an
  // element that never mentioned `text` does not round-trip having acquired it.
  if (media !== null) {
    return Object.freeze(
      nonEmptyString(text) ? { provenance, media, text } : { provenance, media },
    );
  }
  return Object.freeze(nonEmptyString(text) ? { provenance, text } : { provenance });
}

/**
 * A leaflet body: a non-empty list of grounded elements.
 *
 * An EMPTY array is refused, which is the opposite call from `leaflets: []` at the document
 * level, and the difference is that `leaflets` is required while `body` is not. There, `[]`
 * is the only way to say "an honest empty portfolio". Here, absence already says "no body",
 * so `[]` would be a second spelling of the same fact — and two spellings is how a renderer
 * ends up printing an empty Body heading over nothing.
 */
function parseBody(v: unknown, at: string, issues: LeafDocumentIssue[]): LeafletBody | null {
  if (!Array.isArray(v)) {
    issues.push({
      at,
      message:
        `"body" must be an array of grounded elements, got ${describe(v)}. It is deliberately ` +
        `not a string: a paragraph is where an invented claim hides between two true ones, so ` +
        `the format has nowhere to put one.`,
    });
    return null;
  }
  if (v.length === 0) {
    issues.push({
      at,
      message:
        `an empty "body" is refused — omit the key instead. An absent body already means this ` +
        `leaflet has none, so [] would be a second way to say the same thing.`,
    });
    return null;
  }

  const elements: BodyElement[] = [];
  let bad = false;
  for (const [i, raw] of v.entries()) {
    const element = parseBodyElement(raw, `${at}[${i}]`, issues);
    if (element === null) {
      bad = true;
      continue;
    }
    elements.push(element);
  }
  if (bad) return null;
  return Object.freeze(elements);
}

/**
 * The subject's own decision about who may see this one leaflet. Absent is legal and means
 * `private` — see `leafletVisibility`, which is where that default is applied.
 */
function parseVisibility(
  v: unknown,
  at: string,
  issues: LeafDocumentIssue[],
): LeafletVisibility | null {
  if (typeof v === "string" && LEAFLET_VISIBILITIES.includes(v as LeafletVisibility)) {
    return v as LeafletVisibility;
  }
  issues.push({
    at,
    message:
      `if present, "visibility" is one of ${LEAFLET_VISIBILITIES.join(", ")} — got ${
        typeof v === "string" ? `"${v}"` : describe(v)
      }. Omitting it means "private", which is the safe default: a leaflet nobody decided to ` +
      `share must not become shareable by omission. These states are unordered.`,
  });
  return null;
}

function parseLeaflet(
  v: unknown,
  index: number,
  issues: LeafDocumentIssue[],
): Leaflet | null {
  const at = `leaflets[${index}]`;
  if (!isRecord(v)) {
    issues.push({ at, message: `must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, LEAFLET_KEYS, at, issues);

  const id = v["id"];
  const title = v["title"];
  const tier = v["tier"];
  let bad = false;

  if (!nonEmptyString(id)) {
    issues.push({ at: `${at}.id`, message: `required: a non-empty id, got ${describe(id)}` });
    bad = true;
  }
  if (!nonEmptyString(title)) {
    issues.push({
      at: `${at}.title`,
      message: `required: a non-empty title, got ${describe(title)}`,
    });
    bad = true;
  }
  if (typeof tier !== "string" || !PROOF_TIERS.includes(tier as ProofTier)) {
    issues.push({
      at: `${at}.tier`,
      message: `required: one of ${PROOF_TIERS.join(", ")} — got ${
        typeof tier === "string" ? `"${tier}"` : describe(tier)
      }. These tiers are unordered; none is "higher" than another.`,
    });
    bad = true;
  }

  // `reason` belongs to the excluded variant alone. Accepting it elsewhere would let a
  // reason be attached and silently never shown.
  if ("reason" in v && tier !== "excluded") {
    issues.push({
      at: `${at}.reason`,
      message: `"reason" is only meaningful on an excluded leaflet; this one is ${
        typeof tier === "string" ? `"${tier}"` : describe(tier)
      }. It would never be displayed.`,
    });
    bad = true;
  }

  const provenance =
    "provenance" in v ? parseProvenance(v["provenance"], `${at}.provenance`, issues) : null;
  if ("provenance" in v && provenance === null) bad = true;

  const body = "body" in v ? parseBody(v["body"], `${at}.body`, issues) : null;
  if ("body" in v && body === null) bad = true;

  const visibility =
    "visibility" in v ? parseVisibility(v["visibility"], `${at}.visibility`, issues) : null;
  if ("visibility" in v && visibility === null) bad = true;

  if (bad || !nonEmptyString(id) || !nonEmptyString(title)) return null;

  // exactOptionalPropertyTypes: spread the optional fields in only when they are present, so
  // an absent body stays absent rather than becoming `undefined` — a document that never
  // mentioned visibility must round-trip without acquiring it.
  const base = {
    id: leafletId(id),
    title,
    ...(body === null ? {} : { body }),
    ...(visibility === null ? {} : { visibility }),
  };

  switch (tier as ProofTier) {
    case "verified": {
      if (provenance === null) {
        issues.push({
          at: `${at}.provenance`,
          message:
            `a verified leaflet requires provenance — verification with no record of what was ` +
            `observed is an assertion, not a proof.`,
        });
        return null;
      }
      return Object.freeze({ ...base, tier: "verified", provenance });
    }
    case "pending": {
      // exactOptionalPropertyTypes: omit the key entirely rather than set it undefined.
      return Object.freeze(
        provenance === null
          ? { ...base, tier: "pending" as const }
          : { ...base, tier: "pending" as const, provenance },
      );
    }
    case "excluded": {
      const reason = v["reason"];
      if (!nonEmptyString(reason)) {
        issues.push({
          at: `${at}.reason`,
          message:
            `an excluded leaflet requires a reason, got ${describe(reason)}. "excluded" is not ` +
            `an error and not an absence: it means this work could not be attributed to the ` +
            `subject, and the reason is what makes the count explainable instead of just a number.`,
        });
        return null;
      }
      return Object.freeze(
        provenance === null
          ? { ...base, tier: "excluded" as const, reason }
          : { ...base, tier: "excluded" as const, reason, provenance },
      );
    }
  }
}

/** Owner choices are retained independently from current source availability. */
function parseCuration(value: unknown, issues: LeafDocumentIssue[]): LeafCuration | null {
  if (!isRecord(value)) {
    issues.push({ at: "curation", message: `if present, curation must be an object containing the owner's featured selection, got ${describe(value)}` });
    return null;
  }
  checkKeys(value, CURATION_KEYS, "curation", issues);
  const featured = value["featured"];
  if (!Array.isArray(featured)) {
    issues.push({ at: "curation.featured", message: "required: an ordered array of Leaflet ids; an empty array clears the owner's selection." });
    return null;
  }
  if (featured.length > MAX_FEATURED_LEAFLETS) {
    issues.push({ at: "curation.featured", message: `choose at most ${MAX_FEATURED_LEAFLETS} featured Leaflets.` });
    return null;
  }
  const ids: ReturnType<typeof leafletId>[] = [];
  const seen = new Set<string>();
  for (const [index, id] of featured.entries()) {
    const at = `curation.featured[${index}]`;
    if (!nonEmptyString(id) || id.length > 300) {
      issues.push({ at, message: "each featured choice must be a non-empty Leaflet id of at most 300 characters." });
      continue;
    }
    if (seen.has(id)) {
      issues.push({ at, message: `duplicate featured choice "${id}" — choose each Leaflet once.` });
      continue;
    }
    seen.add(id);
    ids.push(leafletId(id));
  }
  // Availability is checked when the owner saves a choice and when it is displayed. A source
  // refresh must not discard owner choices or make the entire document unreadable merely
  // because one chosen record is now missing or excluded.
  return Object.freeze({ featured: Object.freeze(ids) });
}

function authoredText(value: unknown, at: string, limit: number, issues: LeafDocumentIssue[], oneLine = false): string | null {
  if (!nonEmptyString(value) || value.length > limit) {
    issues.push({ at, message: `must be non-empty authored text of at most ${limit} characters.` });
    return null;
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value) || (oneLine && /[\r\n]/.test(value))) {
    issues.push({ at, message: oneLine ? "must be one readable line without control characters." : "must not contain control characters." });
    return null;
  }
  if (RATING_SHAPED.test(value)) {
    issues.push({ at, message: "authored text must not rate or score a person; the rule applies whoever writes the words." });
    return null;
  }
  return value.trim();
}

function portfolioId(value: unknown, at: string, issues: LeafDocumentIssue[]): string | null {
  if (typeof value !== "string" || value.length > PORTFOLIO_LIMITS.id || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    issues.push({ at, message: `must be a stable id of at most ${PORTFOLIO_LIMITS.id} ASCII letters, digits, dots, underscores, colons or hyphens, starting with a letter or digit.` });
    return null;
  }
  return value;
}

function portfolioArray(value: unknown, at: string, max: number, issues: LeafDocumentIssue[], min = 0): readonly unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    issues.push({ at, message: `must be an array containing ${min} to ${max} entries.` });
    return [];
  }
  return value;
}

function portfolioMembers(value: unknown, at: string, max: number, issues: LeafDocumentIssue[], evidence = false): readonly string[] {
  const values = portfolioArray(value, at, max, issues), result: string[] = [], seen = new Set<string>();
  for (const [index, raw] of values.entries()) {
    const path = `${at}[${index}]`;
    let id: string | null;
    if (evidence) {
      id = nonEmptyString(raw) && raw.length <= 300 ? raw : null;
      if (id === null) issues.push({ at: path, message: "must be a non-empty Leaflet id of at most 300 characters." });
    } else id = portfolioId(raw, path, issues);
    if (id === null) continue;
    if (seen.has(id)) issues.push({ at: path, message: "duplicate selection; choose each id once." });
    else { seen.add(id); result.push(id); }
  }
  return Object.freeze(result);
}

function parseProfile(value: unknown, issues: LeafDocumentIssue[]): LeafProfile | null {
  if (!isRecord(value)) { issues.push({ at: "profile", message: "must be an object containing the person's own profile words." }); return null; }
  checkKeys(value, PROFILE_KEYS, "profile", issues);
  const bio = "bio" in value ? authoredText(value["bio"], "profile.bio", PORTFOLIO_LIMITS.bio, issues) : null;
  const direction = "direction" in value ? authoredText(value["direction"], "profile.direction", PORTFOLIO_LIMITS.direction, issues) : null;
  let passions: readonly string[] | undefined;
  if ("passions" in value) {
    const entries = portfolioArray(value["passions"], "profile.passions", PORTFOLIO_LIMITS.passions, issues), result: string[] = [];
    const seen = new Set<string>();
    for (const [index, raw] of entries.entries()) {
      const at = `profile.passions[${index}]`, text = authoredText(raw, at, PORTFOLIO_LIMITS.passion, issues, true);
      if (text === null) continue;
      if (seen.has(text)) issues.push({ at, message: "duplicate passion; list each once." });
      else { seen.add(text); result.push(text); }
    }
    passions = Object.freeze(result);
  }
  return Object.freeze({ ...(bio !== null ? { bio } : {}), ...(direction !== null ? { direction } : {}), ...(passions !== undefined ? { passions } : {}) });
}

function parseCitations(value: unknown, at: string, issues: LeafDocumentIssue[]): readonly ClaimCitation[] {
  const entries = portfolioArray(value, at, PORTFOLIO_LIMITS.citations, issues), result: ClaimCitation[] = [], seen = new Set<string>();
  for (const [index, raw] of entries.entries()) {
    const path = `${at}[${index}]`;
    if (!isRecord(raw)) { issues.push({ at: path, message: "must contain a Leaflet id and exact retained provenance." }); continue; }
    checkKeys(raw, CITATION_KEYS, path, issues);
    const id = raw["leaflet"];
    const provenance = parseProvenance(raw["provenance"], `${path}.provenance`, issues);
    if (!nonEmptyString(id) || id.length > 300) { issues.push({ at: `${path}.leaflet`, message: "must be a non-empty Leaflet id of at most 300 characters." }); continue; }
    if (provenance === null) continue;
    const key = JSON.stringify([id, provenance.source, provenance.ref, provenance.observedAt]);
    if (seen.has(key)) { issues.push({ at: path, message: "duplicate citation; attach each exact reference once per claim." }); continue; }
    seen.add(key);
    result.push(Object.freeze({ leaflet: leafletId(id), provenance }));
  }
  return Object.freeze(result);
}

function parseAchievements(value: unknown, issues: LeafDocumentIssue[], location = "achievements"): readonly LeafAchievement[] {
  const entries = portfolioArray(value, location, PORTFOLIO_LIMITS.achievements, issues), result: LeafAchievement[] = [], seen = new Set<string>();
  for (const [index, raw] of entries.entries()) {
    const at = `${location}[${index}]`;
    if (!isRecord(raw)) { issues.push({ at, message: "must be an owner-authored achievement object." }); continue; }
    checkKeys(raw, ACHIEVEMENT_KEYS, at, issues);
    const id = portfolioId(raw["id"], `${at}.id`, issues);
    const title = authoredText(raw["title"], `${at}.title`, PORTFOLIO_LIMITS.title, issues, true);
    const claims: AchievementClaim[] = [], claimIds = new Set<string>();
    for (const [claimIndex, input] of portfolioArray(raw["claims"], `${at}.claims`, PORTFOLIO_LIMITS.claims, issues).entries()) {
      const path = `${at}.claims[${claimIndex}]`;
      if (!isRecord(input)) { issues.push({ at: path, message: "must be an owner-authored claim object." }); continue; }
      checkKeys(input, CLAIM_KEYS, path, issues);
      const claimId = portfolioId(input["id"], `${path}.id`, issues), kind = input["kind"];
      const text = authoredText(input["text"], `${path}.text`, PORTFOLIO_LIMITS.claimText, issues);
      const citations = "citations" in input ? parseCitations(input["citations"], `${path}.citations`, issues) : undefined;
      if (typeof kind !== "string" || !ACHIEVEMENT_CLAIM_KINDS.includes(kind as AchievementClaim["kind"])) {
        issues.push({ at: `${path}.kind`, message: `must be one of ${ACHIEVEMENT_CLAIM_KINDS.join(", ")}. The kind does not verify the claim.` }); continue;
      }
      if (claimId === null || text === null) continue;
      if (claimIds.has(claimId)) { issues.push({ at: `${path}.id`, message: "claim ids must be distinct within an achievement." }); continue; }
      claimIds.add(claimId);
      claims.push(Object.freeze({ id: claimId, kind: kind as AchievementClaim["kind"], text, ...(citations !== undefined ? { citations } : {}) }));
    }
    if (id === null || title === null) continue;
    if (seen.has(id)) { issues.push({ at: `${at}.id`, message: "achievement ids must be distinct." }); continue; }
    seen.add(id); result.push(Object.freeze({ id, title, claims: Object.freeze(claims) }));
  }
  return Object.freeze(result);
}

function parseJourneyHistory(value: unknown, issues: LeafDocumentIssue[]): readonly JourneyEdit[] {
  const result: JourneyEdit[] = [], seen = new Set<string>();
  for (const [index, raw] of portfolioArray(value, 'journeyHistory', 1024, issues).entries()) {
    const at = `journeyHistory[${index}]`;
    if (!isRecord(raw)) { issues.push({ at, message: 'must be a private journey edit.' }); continue; }
    checkKeys(raw, new Set(['id', 'at', 'actor', 'achievement', 'before', 'after']), at, issues);
    const id = portfolioId(raw['id'], `${at}.id`, issues), achievement = portfolioId(raw['achievement'], `${at}.achievement`, issues);
    const before = raw['before'] === null ? null : parseAchievements([raw['before']], issues, `${at}.before`)[0];
    const after = parseAchievements([raw['after']], issues, `${at}.after`)[0];
    if (id === null || achievement === null || before === undefined || !after) continue;
    if (seen.has(id) || typeof raw['at'] !== 'string' || !isIsoInstant(raw['at']) || (raw['actor'] !== 'manual' && raw['actor'] !== 'agent') ||
        (before !== null && before.id !== achievement) || after.id !== achievement || JSON.stringify(before) === JSON.stringify(after)) {
      issues.push({ at, message: 'requires a distinct edit id, valid actor/time, matching journey and changed content.' }); continue;
    }
    seen.add(id);
    result.push(Object.freeze({ id, achievement, at: raw['at'] as string, actor: raw['actor'] as JourneyEdit['actor'], before, after }));
  }
  return Object.freeze(result);
}

function parseCollections(value: unknown, issues: LeafDocumentIssue[]): readonly LeafCollection[] {
  const entries = portfolioArray(value, "collections", PORTFOLIO_LIMITS.collections, issues), result: LeafCollection[] = [], seen = new Set<string>();
  for (const [index, raw] of entries.entries()) {
    const at = `collections[${index}]`;
    if (!isRecord(raw)) { issues.push({ at, message: "must be a named collection of the person's selected work." }); continue; }
    checkKeys(raw, COLLECTION_KEYS, at, issues);
    const id = portfolioId(raw["id"], `${at}.id`, issues), kind = raw["kind"];
    const title = authoredText(raw["title"], `${at}.title`, PORTFOLIO_LIMITS.title, issues, true);
    const description = "description" in raw ? authoredText(raw["description"], `${at}.description`, PORTFOLIO_LIMITS.collectionDescription, issues) : null;
    const achievements = portfolioMembers(raw["achievements"], `${at}.achievements`, PORTFOLIO_LIMITS.achievements, issues);
    const leaflets = portfolioMembers(raw["leaflets"], `${at}.leaflets`, PORTFOLIO_LIMITS.collectionLeaflets, issues, true).map(leafletId);
    if (typeof kind !== "string" || !LEAF_COLLECTION_KINDS.includes(kind as LeafCollection["kind"])) {
      issues.push({ at: `${at}.kind`, message: `must be one of ${LEAF_COLLECTION_KINDS.join(", ")}.` }); continue;
    }
    if (id === null || title === null) continue;
    if (seen.has(id)) { issues.push({ at: `${at}.id`, message: "collection ids must be distinct." }); continue; }
    seen.add(id); result.push(Object.freeze({ id, title, kind: kind as LeafCollection["kind"],
      ...(description !== null ? { description } : {}), achievements, leaflets: Object.freeze(leaflets) }));
  }
  return Object.freeze(result);
}

/**
 * Parse an untrusted value into a `Leaf`, or into every reason it is not one.
 *
 * Never throws and never partially succeeds: if any leaflet is invalid the whole document is
 * rejected. Dropping the bad leaflet and rendering the rest would mean the page silently
 * asserts a smaller portfolio than the file describes — the same class of failure as
 * collapsing four distinct causes into `commitCount: 0`.
 */
export function parseLeafDocument(value: unknown): LeafDocumentParse {
  const issues: LeafDocumentIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          at: "(document)",
          message: `a leaf document must be a JSON object with id, subject and leaflets — got ${describe(value)}`,
        },
      ],
    };
  }

  checkKeys(value, DOCUMENT_KEYS, "", issues);

  const id = value["id"];
  const subject = value["subject"];
  const rawLeaflets = value["leaflets"];
  const example = value["example"];
  let presentation: PortfolioPresentation | undefined;
  if ("presentation" in value) {
    try { presentation = parsePortfolioPresentation(value["presentation"]); }
    catch (error) { issues.push({ at: "presentation", message: error instanceof Error ? error.message : "Invalid presentation" }); }
  }
  const curation = "curation" in value ? parseCuration(value["curation"], issues) : null;
  const profile = "profile" in value ? parseProfile(value["profile"], issues) : null;
  const achievements = "achievements" in value ? parseAchievements(value["achievements"], issues) : undefined;
  const journeyHistory = "journeyHistory" in value ? parseJourneyHistory(value["journeyHistory"], issues) : undefined;
  const collections = "collections" in value ? parseCollections(value["collections"], issues) : undefined;

  if (!nonEmptyString(id)) {
    issues.push({
      at: "id",
      message: `required: a non-empty id for this leaf, got ${describe(id)}`,
    });
  }
  if (!nonEmptyString(subject)) {
    issues.push({
      at: "subject",
      message: `required: the display name of the person this portfolio describes, got ${describe(subject)}`,
    });
  }
  if (example !== undefined && typeof example !== "boolean") {
    issues.push({
      at: "example",
      message: `if present, "example" must be a boolean, got ${describe(example)}`,
    });
  }

  // THE AUTHORED HEADLINE (DT-1). Optional, and validated harder than most fields because it is
  // the one line of prose a subject writes rather than a machine derives: one line only, and the
  // same NO SCORE rule the review queue applies to human retitles — "4.9/5", "top 10%" and
  // friends are refused whoever writes them, because the product will not print a rating in any
  // voice, including the subject's own.
  const headline = value["headline"];
  if (headline !== undefined) {
    if (!nonEmptyString(headline)) {
      issues.push({
        at: "headline",
        message: `if present, "headline" must be a non-empty string — one line the subject wrote about themselves, got ${describe(headline)}`,
      });
    } else if (/[\n\r]/.test(headline)) {
      issues.push({
        at: "headline",
        message: `"headline" is one line; it contains a line break. Longer prose belongs in a leaflet body, where each element carries its own evidence.`,
      });
    } else if (RATING_SHAPED.test(headline)) {
      issues.push({
        at: "headline",
        message: `"headline" reads as a rating (${describe(headline)}). Counts and facts, never a score — the rule applies whoever writes the words, including the subject.`,
      });
    }
  }

  const leaflets: Leaflet[] = [];
  if (rawLeaflets === undefined) {
    issues.push({
      at: "leaflets",
      message:
        `required: an array of leaflets. An empty array [] is valid and means an honest empty ` +
        `portfolio — it is not the same as the field being missing.`,
    });
  } else if (!Array.isArray(rawLeaflets)) {
    issues.push({ at: "leaflets", message: `must be an array, got ${describe(rawLeaflets)}` });
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of rawLeaflets.entries()) {
      const leaflet = parseLeaflet(raw, i, issues);
      if (leaflet === null) continue;
      if (seen.has(leaflet.id)) {
        issues.push({
          at: `leaflets[${i}].id`,
          message: `duplicate id "${leaflet.id}" — ids must be unique within a leaf.`,
        });
        continue;
      }
      seen.add(leaflet.id);
      leaflets.push(leaflet);
    }
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };

  return {
    ok: true,
    leaf: Object.freeze({
      id: leafId(id as string),
      subject: subject as string,
      ...(headline !== undefined ? { headline: (headline as string).trim() } : {}),
      ...(curation !== null ? { curation } : {}),
      ...(presentation ? { presentation } : {}),
      ...(profile !== null ? { profile } : {}),
      ...(achievements !== undefined ? { achievements } : {}),
      ...(journeyHistory !== undefined ? { journeyHistory } : {}),
      ...(collections !== undefined ? { collections } : {}),
      leaflets: Object.freeze(leaflets),
    }),
    declaredExample: example === true,
  };
}
