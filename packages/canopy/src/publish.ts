import { projectPublicPortfolio, type PublishedPortfolio, type PortfolioOmission } from "./publicPortfolio.ts";
/**
 * THE REDACTION GATE — what a leaf may ever expose publicly.
 *
 * WHY THIS EXISTS, AND WHY IT BLOCKS EVERYTHING ELSE. A leaflet title is copied VERBATIM out of
 * the underlying artifact: for a git leaflet, the commit subject exactly as somebody wrote it.
 * On a multi-author repository those subjects carry other people's names and email addresses,
 * and the leaf page renders them. Ledger rows C1, C2 and C5 all recorded the same defect and all
 * three marked it NOT FIXED: exclusion *reasons* withhold the author's address by construction
 * (`exclusionReason` in @foliage/leaf), verbatim *titles* never did. Measured, not hypothesised —
 * intake over a real 800-commit repository produced an excluded leaflet whose title quoted a real
 * third party's address, and the canopy roster row was rendered from documents with 186 real
 * author identities in them. Until publication passes through a gate, publishing anything means
 * publishing somebody else's personal data on a page they were never asked about. So this is the
 * product decision, not a formatting concern, and nothing may be published until it runs.
 *
 * WHY IT IS IN THE CLOUD PLANE. Publication is EGRESS: it is the moment a person's file leaves
 * the machine they control and becomes a page other people read. The open plane makes no network
 * call beyond 127.0.0.1 and holds no notion of "public" at all — a self-hosted leaf is rendered
 * for its own subject, on their own machine, and the whole page is theirs to look at. The
 * judgement "this may cross to strangers" belongs to the hosted service that does the crossing,
 * so it lives here in @foliage/canopy, next to trees and tenancy, and `pnpm check:boundary`
 * keeps it from being reachable from the open set.
 *
 * WHAT CANOPY IS, SINCE "THE PLANE THAT MAY MAKE NETWORK CALLS" IS THE WRONG READING AND WAS
 * BRIEFLY THE WORKING ONE. Canopy is the GATE A PERSON PREPARES AT — the surface where someone
 * decides, strategically and over time, what of their work is ready to be seen. That is the
 * product; hosting is merely how the decision is served. The distinction has teeth in two places:
 *
 *   1. CANOPY IS NOT A THIRD-PARTY-CALL SYSTEM. Crossing a plane boundary licenses ONE new
 *      call — the person's own artifact reaching the service they chose. It licenses nothing
 *      else. A published leaf must make ZERO third-party calls, exactly like the local one: a
 *      portfolio that leaks its readers to a tracker has broken the same promise the open plane
 *      keeps, and a visitor to someone's leaf never consented to anything. This makes an
 *      injecting CDN a CORRECTNESS failure rather than a preference to mitigate — a host that
 *      rewrites the payload to add an analytics beacon or an email-decode script is disqualified
 *      unless the injection is provably suppressed AND a test asserts it.
 *   2. PREPARATION IS THE FEATURE, NOT THE FRICTION. If canopy were only a delivery tier, the
 *      redaction report below would be a checkbox in the way. It is the opposite: the report is
 *      the thing being used. Publishing is meant to be considered, revisited, and narrowed — so
 *      the gate returns what it withheld and why, per leaflet, so a person can act on it rather
 *      than be told a count.
 *
 * WHAT THIS FUNCTION IS. Total, pure, deterministic: no model call, no network, no clock, no
 * randomness, no throw. Same input, same output, forever — which is what makes a human review of
 * its report meaningful, because the thing they consented to is the thing that gets published.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * DETECTION HONESTY — READ THIS BEFORE TRUSTING ANY OUTPUT OF THIS MODULE.
 *
 * A regular expression over free text is a FLOOR, NOT A PROOF. It finds text SHAPED like an
 * identifier. It cannot find an identifier that is not shaped like one, and it cannot tell a
 * person from a package. Concretely, and stated in the output as `PUBLICATION_LIMITS` so no
 * caller can render the report without the caveat being available beside it:
 *
 *   - A PERSON'S NAME IN ORDINARY PROSE IS NOT DETECTED. "thanks to Rowan for the catch" carries
 *     a third party's name and no deterministic rule separates a personal name from a library, a
 *     place, or a product without a name list or a model. This gate makes no model call by
 *     design, so it does not pretend. Names ARE caught in the one place git puts them in a
 *     machine-readable form — a `Co-authored-by:`-style trailer — and nowhere else.
 *   - AN OBFUSCATED ADDRESS IS NOT DETECTED: "rowan dot vale at example dot invalid",
 *     "rowan[at]example", a bare `user@localhost`, an IP-literal domain, or a unicode local part.
 *   - THE UNDERLYING ARTIFACT IS NOT REDACTED. A published leaflet carries its provenance ref,
 *     and anyone who can read the repository can read the full commit — author name and address
 *     included. This gate governs the PAGE, and claiming more would be the overclaim.
 *   - IT WITHHOLDS MORE THAN IT MUST. `@media`, `@Override` and `@param` are account-handle
 *     shaped and get withheld. That direction is chosen deliberately: a withheld word is a
 *     visible loss on the subject's own page and is reported to them; a published address cannot
 *     be recalled.
 *
 * Nothing in the report says "safe", "clean" or "no personal data". An empty `withheld` list
 * means THIS MECHANISM FOUND NOTHING, which is a statement about the mechanism.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * WHAT CROSSES, AND THE ARGUMENT FOR IT.
 *
 *   WHOSE WORK THIS IS, IS ASKED FIRST. `isSubjectsOwnWork` answers attribution — verified and
 *   pending are the subject's own work at different proof strengths, `excluded` is not the
 *   subject's work AT ALL. That question logically precedes consent: whether the subject
 *   "offered" a leaflet presupposes it is theirs to offer, and a leaflet that is somebody else's
 *   was never the subject's to withhold OR to share, so its refusal must never be phrased as if
 *   it might change with visibility. An excluded leaflet is withheld as `unattributed-leaflet`
 *   regardless of what `visibility` says — including the common case where `visibility` was never
 *   set at all, which is the normal, only state intake produces for an excluded leaflet.
 *
 *   THE SUBJECT MUST HAVE OFFERED IT, ASKED SECOND, OF WHAT IS ALREADY ESTABLISHED AS THEIRS.
 *   `visibility` is the subject's own decision about what leaves their machine at all — absent
 *   means private, the only safe default (@foliage/leaf). A leaflet that is the subject's own
 *   work but whose visibility is not `public` is withheld as `not-shared` BEFORE its tier is even
 *   looked at: "we did not publish it because it is not verified" is the wrong reason to give a
 *   leaflet the subject never offered in the first place. That is a consent refusal, not a proof
 *   refusal, and the two must never trade places — a verified leaflet can still be `not-shared`.
 *   `isListedOnLeaf` and `isSubjectsOwnWork` are imported from `@foliage/leaf` rather than
 *   restated here: `publicProjection.ts` asks the identical two questions of the identical two
 *   functions, and a second copy of either is exactly how the live projection and the frozen
 *   artifact would end up disagreeing about the same leaflet.
 *
 *   ONE PREDICATE, AND THE TIER IS NOT PART OF IT (owner decision, 2026-09-06, recorded in
 *   `.loop/MERGE-DECISIONS.md` row D1): offered, not excluded, crosses — `verified` and `pending`
 *   alike — and the tier travels WITH the leaflet instead of deciding whether it travels at all.
 *   `publicProjection.ts:47-53` already made this argument for the live projection, and it is not
 *   restated here because it applies unchanged: whether a `pending` leaflet is fit to publish is
 *   a question about how it is PRESENTED, not whether it exists on the page, and gating on
 *   `verified` here while the live projection does not is exactly the disagreement that let a
 *   stranger see two different answers about one leaflet depending on which surface they landed
 *   on. `PublishedLeaflet.tier` carries the word, and `apps/canopy/src/renderPublished.ts` prints
 *   it beside every row — that disclosure is the load-bearing half of this change, because
 *   removing the gate WITHOUT carrying the tier would publish unproven work with nothing on the
 *   page to say so, which is the overclaim the old gate existed to prevent.
 *
 *   `excluded` DOES NOT CROSS, AND THIS IS NOT A HEDGE — it is the one tier fact this gate still
 *   acts on, because it answers a different question. It means the work is SOMEBODY ELSE'S:
 *   publishing it on the subject's portfolio would put a third party's commit message on a page
 *   about a different person, for zero benefit to either of them. `verified` and `pending` both
 *   remain fully visible to the SUBJECT in their own leaf view regardless of what crosses here —
 *   this gate governs egress, not the subject's sight of their own file.
 *
 *   A DECLARED EXAMPLE NEVER CROSSES AT ALL. `parseLeafDocument` reports `declaredExample` for a
 *   document that says it is a fabricated illustration; the leaf renderer paints a fabrication
 *   band over it. A band is the right answer for a page its own author is looking at and the
 *   WRONG answer for egress, because a band is a caption and a caption travels badly — screenshot
 *   it, quote it, index it, and the caption is gone while the fabricated claims remain. So this
 *   returns `ok: false` and publishes nothing. `declaredExample` is a REQUIRED field of the
 *   request rather than an optional one for the same reason: a caller that forgets it would
 *   default silently to "not fabricated", and a silent default is how fabricated data ships.
 *
 *   EVERY ADDRESS IS WITHHELD, INCLUDING THE SUBJECT'S OWN. This gate is not told which
 *   addresses the subject claims, and even if it were, publishing your own contact details is a
 *   deliberate act. A pattern match is not consent. So all of them go, each one named in the
 *   report, and a subject who wants their address on their page can put it there on purpose.
 *
 * HOW MUCH IS REMOVED — THE SPAN, NOT THE FIELD. A detection redacts its own character range and
 * leaves the rest of the title standing. Dropping the whole title on a match would make every
 * false positive cost a whole piece of the subject's evidence, which is a real harm; redacting
 * `hi@example.invalid` out of "fix: use hi@example.invalid in the README" keeps the sentence
 * legible and the loss proportionate. PROVENANCE IS THE EXCEPTION: `ref` is a machine handle
 * whose only job is to be resolvable, and a redacted ref resolves to nothing, so an identifier
 * found anywhere in a leaflet's provenance withholds the ENTIRE LEAFLET rather than corrupting
 * the one thing that makes it checkable.
 *
 * A REDACTED TITLE IS NO LONGER VERBATIM, and `PublishedLeaflet.titleRedacted` says so. The leaf
 * renderer marks verbatim regions `data-verbatim="title"`, a claim about provenance of TEXT; a
 * renderer that carried that marker over a redacted string would be asserting the artifact said
 * something it did not.
 *
 * THE REPORT IS THE REVIEWABLE ARTIFACT. It is what a human reads before consenting to publish,
 * so every entry names its leaflet, what class of thing was withheld, why, and where to look at
 * the original for themselves. Never a bare count — a count is not reviewable, it is a number to
 * nod at. Two consequences worth stating:
 *
 *   THE REPORT NEVER CONTAINS THE WITHHELD VALUE. Printing the address into the report just
 *   moves the egress from the page into the document people paste into chat. Each entry instead
 *   carries `inspect`: the exact command that shows the operator the original, following the
 *   pattern `exclusionReason` already set in @foliage/leaf.
 *   EVERY TITLE QUOTED IN THE REPORT IS QUOTED IN ITS REDACTED FORM — including titles of
 *   leaflets that were dropped wholesale for their tier, which are precisely the ones most
 *   likely to carry a third party's address.
 *
 * COMPLEXITY. O(total characters) for detection — each pattern is linear and scans each field
 * once — plus O(m log m) to sort and merge m detections per field, where m is tiny. One pass
 * over the leaflets. No allocation proportional to anything but the output.
 */

import {
  detectRedactableSpans as detect,
  evaluatePolicy,
  isIsoInstant,
  isAbsoluteDenial,
  isListedOnLeaf,
  isSubjectsOwnWork,
  leafletVisibility,
  redactIdentifiers as redact,
  REDACTION_DESCRIPTIONS as DESCRIBES,
  type DetectedKind,
  type Leaf,
  type LeafId,
  type LeafletId,
  type Provenance,
  type PublishPolicy,
  type RedactionSpan as Span,
  type SubjectsOwnLeaflet,
} from "@foliage/leaf";
import { orderAdmittedLeaflets } from "./curationOrder.ts";

/**
 * Why something did not cross. Detected shapes, plus the three structural withholdings.
 *
 * There used to be a fourth, `unproven-leaflet`, for a `pending` leaflet — removed 2026-09-06
 * when `pending` stopped being gated (see the header, "ONE PREDICATE"). It is deleted rather than
 * left unreachable: a withholding kind nothing can ever produce is a kind `publishedDocument.ts`
 * would still have to accept from a hand-edited artifact, which would let one back in the door
 * the gate just closed.
 */
export type WithholdingKind =
  | DetectedKind
  /** Visibility is not `public`: the subject never offered this leaflet outward at all. */
  | "not-shared"
  /** An `excluded` leaflet: somebody else's work. */
  | "unattributed-leaflet"
  /** The subject's absolute publication deny rule blocked this leaflet. */
  | "policy-denied"
  /** A leaflet whose provenance itself carried an identifier. */
  | "unpublishable-provenance";

/**
 * One thing that did not cross, addressed to the human deciding whether to publish.
 *
 * Deliberately not a count and deliberately not the withheld value.
 */
export interface Withholding {
  readonly kind: WithholdingKind;
  /** The leaflet this concerns, or `null` when it concerns the leaf itself (e.g. `subject`). */
  readonly leaflet: LeafletId | null;
  /** Where, in a path a human can find: `subject`, `leaflets[git:4f884f6].title`. */
  readonly at: string;
  /**
   * Which item this is, in ALREADY-REDACTED form, so the reviewer can recognise the row without
   * the report itself becoming the leak.
   */
  readonly item: string;
  /** Full prose. Names what was withheld and why, and never quotes the withheld value. */
  readonly reason: string;
  /** How to see the original for yourself. A command, never the value. */
  readonly inspect: string;
}

/** Why a whole document may not be published. */
export interface PublicationRefusal {
  readonly at: string;
  readonly reason: string;
}

/**
 * A leaflet that has passed the gate.
 *
 * Structurally a `SubjectsOwnLeaflet`, so a renderer can consume it directly, plus the one fact a
 * renderer must not lose: whether the title is still the artifact's own words.
 *
 * A UNION ON `tier`, MIRRORING `Leaflet` ITSELF, AND FOR THE SAME REASON: a `verified` leaflet's
 * `provenance` is required — an unfalsifiable verified claim is the one this format refuses to
 * even represent — while a `pending` leaflet's is optional, because `Leaflet` already allows a
 * hand-written pending entry with none. Widening `provenance` to optional for BOTH arms would
 * make an unfalsifiable verified leaflet a value this type can hold; this way it is not.
 */
/** Public context is selected separately from offering a leaflet. It is never evidence of authorship. */
export interface PublishedNarrative {
  readonly text: string;
  readonly provenance: Provenance;
}
export interface NarrativeSelection { readonly leaflet: number; readonly element: number }

/** Shared write/read guard. Selection is still required; pattern checks cannot establish consent. */
const localFileLocation = (value: string): boolean =>
  /(?:file:\/\/|(?:^|[\s("'])\/(?:Users|home|private|tmp|var|Volumes)\/|(?:^|[\s("'])[A-Za-z]:[\\/]|(?:^|[\s("'])~\/)/.test(value);

export function publicAuthoredTextIssue(text: string): string | null {
  if (typeof text !== "string" || !text.trim() || text.length > 4000) return "Use non-empty authored text of at most 4,000 characters.";
  if (detect(text).length) return "Identifying text must be removed from the private draft before offering it.";
  if (localFileLocation(text)) return "Local file locations must be removed from the private draft before offering it.";
  return null;
}
export function publicNarrativeIssue(value: PublishedNarrative): string | null {
  if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 4000) return "Choose a non-empty paragraph of at most 4,000 characters.";
  const p = value.provenance;
  if (!p || ![p.source, p.ref, p.observedAt].every(v => typeof v === "string" && v.trim().length > 0 && v.length <= 1024) || !isIsoInstant(p.observedAt)) return "The paragraph needs a valid, dated evidence reference.";
  const fields = [value.text, p.source, p.ref, p.observedAt];
  if (fields.some(v => detect(v).length > 0)) return "This paragraph or its reference contains identifying text that the publication gate withholds. Edit the private draft before offering it.";
  if (fields.some(localFileLocation)) return "This paragraph or its reference contains a local file location. Remove it from the private draft before offering it.";
  return null;
}

/** Selected stripped renditions. Source evidence and published bytes have distinct digests. */
export interface PublishedPhoto {
  readonly sourceRef: string;
  readonly renditionDigest: string;
  readonly bytes: number;
  readonly format: "jpeg" | "png" | "gif";
  readonly alt: string;
  readonly caption?: string;
}
export const MAX_PUBLIC_PHOTOS = 4;
export const MAX_PUBLIC_PHOTO_BYTES = 512 * 1024;
export function publicPhotoIssue(photo: PublishedPhoto): string | null {
  if (!photo || typeof photo.sourceRef !== "string" || typeof photo.renditionDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(photo.sourceRef) || !/^sha256:[0-9a-f]{64}$/.test(photo.renditionDigest) ||
    !Number.isSafeInteger(photo.bytes) || photo.bytes < 1 || photo.bytes > MAX_PUBLIC_PHOTO_BYTES || !["jpeg", "png", "gif"].includes(photo.format)) return "A photo needs separate source and rendition digests, a supported container and at most 512 KiB of stripped bytes.";
  for (const text of [photo.alt, ...(photo.caption === undefined ? [] : [photo.caption])]) {
    if (typeof text !== "string" || !text.trim() || text.length > 1000) return "Describe the image with 1–1,000 characters; selected captions have the same limit.";
    if (detect(text).length || localFileLocation(text)) return "The image description or caption contains text the disclosure gate refuses. Edit it before sharing.";
  }
  return null;
}
/** An explicitly selected, byte-identical captured clip. Its poster is a selected photo. */
export interface PublishedVideo {
  readonly sourceRef: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly posterRef: string;
  readonly caption?: string;
}
export const MAX_PUBLIC_VIDEOS = 2;
/** Inline hosted transfer stays beneath the existing bounded request body. */
export const MAX_PUBLIC_VIDEO_BYTES = 1024 * 1024;
export function publicVideoIssue(video: PublishedVideo): string | null {
  if (!video || typeof video.sourceRef !== "string" || typeof video.posterRef !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(video.sourceRef) || !/^sha256:[0-9a-f]{64}$/.test(video.posterRef) ||
      video.sourceRef === video.posterRef || !Number.isSafeInteger(video.bytes) || video.bytes < 12 ||
      video.bytes > MAX_PUBLIC_VIDEO_BYTES || !Number.isFinite(video.durationSeconds) ||
      video.durationSeconds <= 0 || video.durationSeconds > 30) {
    return "A selected clip needs its SHA-256 ref, a separately selected poster, a duration and at most 1 MiB of MP4 bytes.";
  }
  if (video.caption !== undefined &&
      (typeof video.caption !== "string" || !video.caption.trim() || video.caption.length > 1000 ||
       detect(video.caption).length > 0 || localFileLocation(video.caption))) {
    return "The clip caption must be 1–1,000 characters without identifying or local-path text.";
  }
  return null;
}
export type PublishedLeaflet = { readonly narrative?: readonly PublishedNarrative[]; readonly photos?: readonly PublishedPhoto[]; readonly videos?: readonly PublishedVideo[] } & (
  | {
      readonly id: LeafletId;
      readonly title: string;
      readonly tier: "verified";
      readonly provenance: Provenance;
      /** True when `title` differs from the artifact's text. It is then NOT verbatim. */
      readonly titleRedacted: boolean;
    }
  | {
      readonly id: LeafletId;
      readonly title: string;
      readonly tier: "pending";
      readonly provenance?: Provenance;
      readonly titleRedacted: boolean;
    });

/**
 * A leaf that has passed the gate.
 *
 * `reviewedForPublication` is a brand, and its direction is the point: a `PublishedLeaf` is
 * assignable to `Leaf` (a renderer takes it without ceremony), while a `Leaf` is NOT assignable
 * to `PublishedLeaf` — so an ungated leaf cannot be handed to a publication path by accident.
 */
export interface PublishedLeaf {
  readonly id: LeafId;
  readonly subject: string;
  readonly leaflets: readonly PublishedLeaflet[];
  /** True when `subject` was altered. The person's own display name is then not their words. */
  readonly subjectRedacted: boolean;
  readonly reviewedForPublication: true;
  readonly portfolio?: PublishedPortfolio;
}

/**
 * A leaf document as `parseLeafDocument` hands it over: the leaf, and whether the file declared
 * itself a fabricated illustration. Both fields required — see the header on silent defaults.
 */
export interface PublicationRequest {
  readonly leaf: Leaf;
  readonly declaredExample: boolean;
  /** Omitted only by public artifact revalidation, which cannot read the private policy. */
  readonly policy?: PublishPolicy;
  /** Body positions explicitly chosen on the source-digest-bound local review. Omission shares no narrative. */
  readonly narrative?: readonly NarrativeSelection[];
  /** A separate, explicit review choice. Omitting it shares no authored portfolio context. */
  readonly includePortfolio?: boolean;
}

export type PublicationReview =
  | {
      readonly ok: true;
      readonly published: PublishedLeaf;
      /** Private review only; never serialized or added to public withholding counts. */
      readonly portfolioOmissions?: readonly PortfolioOmission[];
      /** Everything withheld, item by item. Empty means this mechanism found nothing. */
      readonly withheld: readonly Withholding[];
      /**
       * What the mechanism CANNOT catch, carried in the result rather than left in a comment so
       * a report cannot be rendered without its own caveat within reach.
       */
      readonly limits: readonly string[];
    }
  | { readonly ok: false; readonly refusals: readonly PublicationRefusal[] };

/**
 * What this gate cannot catch. Shipped WITH every review, never as documentation only.
 *
 * Phrased as flat statements a non-engineer can read, because the person consenting to publish
 * is the subject of the portfolio, not the person who wrote the regex.
 */
export const PUBLICATION_LIMITS: readonly string[] = Object.freeze([
  "A name written in ordinary prose is NOT detected; only git identity trailers (Co-authored-by: and siblings) are.",
  "An address written around the pattern is NOT detected: \"rowan dot vale at example dot invalid\", \"rowan[at]example\", user@localhost, IP-literal or non-ASCII.",
  "Personal facts that are not identifiers (employer, location, health) are NOT detected.",
  "The repository is untouched: anyone who can read it can read the full commit, author address included.",
  "Withholds MORE than it must: @media, @Override, @param and similar handle-shaped words.",
  "An empty withheld list means this mechanism FOUND NOTHING, not that the text is free of personal data.",
  "This private report names each record, and a git record's id comes from its commit ref.",
]);

/* ── Detection ──────────────────────────────────────────────────────────────────────────────
 *
 * The patterns, the overlap merge and the placeholders live in `@foliage/leaf`'s `redaction.ts`,
 * the ONE rule `apps/leaf/export.mjs` also gates on (F-021: the two used to keep separate email
 * patterns, and the export's dropped the apostrophe). Moved, with one change: the email pattern
 * is now the union of the two, so this gate also catches a typo'd `rowan@northwind..invalid`,
 * which only the export did before. This gate's policy — redact the span, report it, withhold a
 * whole leaflet whose provenance matched — stays here.
 */

/** The same deterministic text gate for explicitly submitted assessment packets, not proof. */
export function redactPublicationText(text: string): string {
  return redact(text).text;
}

/**
 * How the reviewer sees the original of something withheld from a leaflet.
 *
 * A command, never the value — the same choice `exclusionReason` makes in @foliage/leaf, and for
 * the same reason: the subject can read their own repository, so naming the artifact costs them
 * nothing while quoting the address would republish it into the report.
 */
function inspectFor(provenance: Provenance | undefined): string {
  if (provenance === undefined) {
    return "this leaflet carries no provenance, so there is no artifact to open — the original " +
      "text is in the leaf document itself.";
  }
  if (provenance.source === "git") {
    return `run "git show ${provenance.ref}" in the repository this leaflet came from.`;
  }
  return `open the artifact recorded as ${provenance.source} ${provenance.ref}.`;
}

/** Sentence describing what a set of detections found, for a reason that must name both causes. */
function describeSpans(spans: readonly Span[]): string {
  const kinds = [...new Set(spans.map((s) => s.kind))];
  return kinds.map((k) => DESCRIBES.get(k) ?? k).join(", ");
}

/**
 * Build the crossed leaflet, exhaustive over the two tiers that may cross.
 *
 * A `switch` with no `default`, on purpose: `SubjectsOwnLeaflet` is `Leaflet` minus `excluded`
 * (@foliage/leaf), so a fourth tier — the physical-work tier `docs/ENGINEERING-PLAN.md` §3 names
 * as coming — fails this function to compile rather than silently taking `pending`'s shape or
 * `verified`'s. The branches are not merged because they are not the same claim: `verified`'s
 * `provenance` is required, `pending`'s is not, and merging them would let an unfalsifiable
 * verified leaflet become a value this type can hold.
 */
function toPublishedLeaflet(
  leaflet: SubjectsOwnLeaflet,
  title: string,
  titleRedacted: boolean,
): PublishedLeaflet {
  switch (leaflet.tier) {
    case "verified":
      return Object.freeze({
        id: leaflet.id,
        title,
        tier: "verified",
        provenance: leaflet.provenance,
        titleRedacted,
      });
    case "pending":
      return Object.freeze(
        leaflet.provenance !== undefined
          ? { id: leaflet.id, title, tier: "pending", provenance: leaflet.provenance, titleRedacted }
          : { id: leaflet.id, title, tier: "pending", titleRedacted },
      );
  }
}

/**
 * Decide what one leaf may expose publicly, and report everything it may not.
 *
 * Total: every input produces a review. Pure and deterministic: no model, no network, no clock,
 * no randomness, no throw. The only `ok: false` is a document that declared itself fabricated —
 * a partially-published illustration is not a thing this product will produce.
 */
export function reviewForPublication(request: PublicationRequest): PublicationReview {
  const { leaf, declaredExample, policy } = request;

  if (declaredExample) {
    return {
      ok: false,
      refusals: Object.freeze([
        {
          at: "example",
          reason:
            `this document declares itself an example — a fabricated illustration — so none of it ` +
            `may be published. The leaf renderer paints a fabrication band over such a document, ` +
            `which is right for a page its own author is reading and wrong for publication: a band ` +
            `is a caption, and a caption is lost the moment the page is screenshotted, quoted or ` +
            `indexed, while the fabricated claims travel on. Nothing is redacted here and nothing ` +
            `is published; remove "example": true from a document describing real evidence.`,
        },
      ]),
    };
  }

  const withheld: Withholding[] = [];

  // The subject's own display name is text on a public page like any other. An address in it is
  // withheld too — this gate is not told which addresses are the subject's, and a pattern match
  // is not consent to publish your own contact details.
  const subject = redact(leaf.subject);
  for (const span of subject.spans) {
    withheld.push({
      kind: span.kind,
      leaflet: null,
      at: "subject",
      item: subject.text,
      reason:
        `the subject line of this leaf contains ${DESCRIBES.get(span.kind)}, and it was removed ` +
        `from the published name. Every address is withheld, including the subject's own: ` +
        `publishing your own contact details is a deliberate act, and a pattern match is not that.`,
      inspect: `open the leaf document and read its "subject" field.`,
    });
  }

  const leaflets: PublishedLeaflet[] = [];

  for (const leaflet of leaf.leaflets) {
    // Redact BEFORE anything is quoted, including for leaflets that are about to be dropped
    // wholesale — the report is read by humans and passed around, and a dropped leaflet is
    // exactly the one most likely to be carrying somebody else's address.
    const title = redact(leaflet.title);
    const at = `leaflets[${leaflet.id}]`;
    const provenanceSpans = leaflet.provenance === undefined ? [] : [
      ...detect(leaflet.provenance.source),
      ...detect(leaflet.provenance.ref),
      ...detect(leaflet.provenance.observedAt),
    ];
    const inspect = provenanceSpans.length === 0 ? inspectFor(leaflet.provenance)
      : `open the leaf document and read the "provenance" of the leaflet this entry names. ` +
        `The ref is not repeated in this sentence because it is what was withheld.`;
    // Every cause below drops the leaflet whole, and all of them travel with this: the detections
    // say what else was in the title even though nothing of it crosses, so a reviewer never reads
    // silence here as "nothing was found".
    const alsoFound =
      title.spans.length > 0
        ? ` Its title also contains ${describeSpans(title.spans)}; that is moot here, since no ` +
          `part of this leaflet crosses, and it is stated so the omission is not read as ` +
          `"nothing was found".`
        : "";

    // ATTRIBUTION, ASKED FIRST — see the header. Whose work this is precedes whether it was
    // offered: an excluded leaflet is not the subject's to offer or withhold, so its refusal
    // must name the true cause regardless of `visibility` — including the common case where
    // `visibility` was never set at all.
    if (!isSubjectsOwnWork(leaflet)) {
      // excluded: not the subject's work at all, whatever visibility says.
      withheld.push({
        kind: "unattributed-leaflet",
        leaflet: leaflet.id,
        at,
        item: title.text,
        reason:
          `this leaflet is excluded: it could not be attributed to the subject, which means ` +
          `it is somebody else's work. Publishing it would put another person's artifact on ` +
          `this subject's portfolio, for no benefit to either of them. The recorded reason ` +
          `for the exclusion is: ${redact(leaflet.reason).text}${alsoFound}`,
        inspect,
      });
      continue;
    }

    // CONSENT, ASKED SECOND, of what attribution has already established as the subject's own
    // work. Whether the subject offered this leaflet outward at all is a different question
    // from whether it is proven, and a leaflet that has not been offered is withheld for that
    // reason even when it is verified.
    if (!isListedOnLeaf(leafletVisibility(leaflet))) {
      withheld.push({
        kind: "not-shared",
        leaflet: leaflet.id,
        at,
        item: title.text,
        reason:
          `this leaflet was never offered beyond the subject's own device — its visibility is ` +
          `"${leafletVisibility(leaflet)}", and only a "public" leaflet crosses. This is a ` +
          `consent refusal, not a proof refusal: the leaflet may be verified and still be ` +
          `withheld here, because the subject decides what leaves their machine before anything ` +
          `asks how well it is proven. It stays fully visible to the subject in their own leaf.` +
          `${alsoFound}`,
        inspect,
      });
      continue;
    }

    // A publication confirmation never overrides an absolute deny rule, for either proof tier.
    if (policy !== undefined) {
      const decision = evaluatePolicy(policy, leaflet);
      if (isAbsoluteDenial(decision) && decision.outcome === "denied" && decision.cause === "denied-by-rule") {
        withheld.push({ kind: "policy-denied", leaflet: leaflet.id, at, item: title.text,
          reason: `the publication rule "${decision.denied.rule.id}" blocks this leaflet: ` +
            `${decision.denied.rule.reason} A deny rule is absolute, so the typed publication ` +
            `confirmation cannot override it.${alsoFound}`, inspect });
        continue;
      }
    }

    // Redacting an evidence handle makes it uncheckable, so withhold the entire leaflet.
    if (provenanceSpans.length > 0) {
      withheld.push({
        kind: "unpublishable-provenance",
        leaflet: leaflet.id,
        at: `${at}.provenance`,
        item: title.text,
        reason:
          `this leaflet's provenance contains ${describeSpans(provenanceSpans)}. Provenance is ` +
          `the handle that makes a claim checkable, so it is never rewritten — a redacted ref ` +
          `resolves to nothing and a claim you cannot check is worse than one you do not make. ` +
          `The whole leaflet is withheld instead.`,
        // Deliberately NOT the `git show <ref>` form: that sentence quotes the ref, and the ref
        // is the field being withheld. Note the honest limit — the report identifies every
        // withholding by leaflet id, and a git leaflet's id is built FROM its ref, so an
        // identifier hiding in a ref does reach the report. The report is the subject's private
        // review artifact; what this gate withholds is what reaches the public page.
        inspect:
          `open the leaf document and read the "provenance" of the leaflet this entry names. ` +
          `The ref is not repeated in this sentence because it is what was withheld.`,
      });
      continue;
    }

    for (const span of title.spans) {
      withheld.push({
        kind: span.kind,
        leaflet: leaflet.id,
        at: `${at}.title`,
        item: title.text,
        reason:
          `the title of this leaflet is copied verbatim from the artifact and contains ` +
          `${DESCRIBES.get(span.kind)}. That text was removed and the rest of the title kept, so ` +
          `the loss is proportionate. The published title is therefore NOT verbatim.`,
        inspect,
      });
    }

    leaflets.push(toPublishedLeaflet(leaflet, title.text, title.spans.length > 0));
  }

  const selections = request.narrative ?? [];
  const selected = new Map<string, PublishedNarrative[]>();
  const seen = new Set<string>();
  const refusals: PublicationRefusal[] = [];
  for (const selection of selections) {
    const at = `narrative[${selection.leaflet}:${selection.element}]`;
    const original = leaf.leaflets[selection.leaflet], element = original?.body?.[selection.element];
    if (!Number.isSafeInteger(selection.leaflet) || !Number.isSafeInteger(selection.element) || selection.leaflet < 0 || selection.element < 0 ||
      !original || !element || "media" in element || !leaflets.some(l => l.id === original.id) || seen.has(at)) {
      refusals.push({ at, reason: "Choose each text paragraph once, from a Leaflet permitted by the current publication rules. Attachments cannot be published through narrative selection." });
      continue;
    }
    seen.add(at);
    const candidate = { text: element.text ?? "", provenance: element.provenance };
    const issue = publicNarrativeIssue(candidate);
    if (issue) { refusals.push({ at, reason: issue }); continue; }
    const rows = selected.get(original.id) ?? [];
    if (rows.length >= 64) { refusals.push({ at, reason: "Choose at most 64 paragraphs per Leaflet." }); continue; }
    rows.push(Object.freeze({ text: candidate.text, provenance: Object.freeze({ ...candidate.provenance }) }));
    selected.set(original.id, rows);
  }
  if (refusals.length) return { ok: false, refusals: Object.freeze(refusals) };
  const authored = request.includePortfolio === true ? projectPublicPortfolio(leaf, leaflets, publicAuthoredTextIssue) : null;
  const withNarrative = leaflets.map(l => selected.has(l.id) ? Object.freeze({ ...l, narrative: Object.freeze(selected.get(l.id)!) }) : l);

  return {
    ok: true,
    published: Object.freeze({
      id: leaf.id,
      subject: subject.text,
      // Narrative selections refer to original document positions. Resolve them before applying
      // the owner's display order, and reorder only the records that passed every public gate.
      leaflets: orderAdmittedLeaflets(leaf, withNarrative),
      subjectRedacted: subject.spans.length > 0,
      reviewedForPublication: true as const,
      ...(authored?.portfolio ? { portfolio: authored.portfolio } : {}),
    }),
    ...(authored ? { portfolioOmissions: authored.omissions } : {}),
    withheld: Object.freeze(withheld),
    limits: PUBLICATION_LIMITS,
  };
}
