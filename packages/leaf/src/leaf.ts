/**
 * The compound leaf: one person's portfolio.
 *
 *   LEAF     one person's portfolio
 *     LEAFLET  one artifact of evidence within it
 *
 * A leaflet is, in botany, a subdivision of a compound leaf — so "a leaf is composed of
 * leaflets" is literally true, which is why the containment reads naturally.
 *
 * THIS PACKAGE IS THE OPEN-SOURCE CORE, and the boundary was drawn here deliberately: a
 * person's portfolio and the evidence behind it are theirs, so the code that models and
 * renders them is something they can read, run, fork and self-host without asking anyone.
 * A privacy guarantee you cannot inspect is only a promise; this is the part that makes it
 * checkable.
 *
 * The aggregation layer above it — canopy and trees, i.e. many people's leaves gathered
 * into a hosted service — lives in @foliage/canopy and is NOT open. That is the product
 * boundary: the leaf is yours, the canopy is the service.
 *
 * Nothing here may import from a closed package; `pnpm check:boundary` enforces it.
 */

/** Opaque id types, so a LeafletId can never be passed where a LeafId is expected. */
export type LeafId = string & { readonly __brand: "LeafId" };
export type LeafletId = string & { readonly __brand: "LeafletId" };

export const leafId = (s: string): LeafId => s as LeafId;
export const leafletId = (s: string): LeafletId => s as LeafletId;

/**
 * Proof tier of a single leaflet.
 *
 * DELIBERATELY UNORDERED. There is no comparison function and no numeric mapping, in
 * either direction, anywhere in this package. That is a product constraint, not an
 * oversight: an ordered tier invites a weighted aggregate, and a weighted aggregate is a
 * score. Under the FCRA posture this product never shows a score to an employer, so the
 * type system refuses to make one convenient.
 *
 * `excluded` is NOT an error. Work that cannot be attributed to the subject is reported
 * as excluded, with a reason, rather than silently dropped or counted as theirs.
 */
export type ProofTier = "verified" | "pending" | "excluded";

export const PROOF_TIERS: readonly ProofTier[] = Object.freeze([
  "verified",
  "pending",
  "excluded",
]);

/** Where a claim's evidence came from. A leaflet with no provenance cannot be verified. */
export interface Provenance {
  /** e.g. "git", "upload", "connector" — the mechanism that produced the evidence. */
  readonly source: string;
  /** Commit sha, file digest, or equivalent stable handle for the underlying artifact. */
  readonly ref: string;
  /** When the evidence was observed, as an ISO-8601 instant. */
  readonly observedAt: string;
}

/**
 * A PHOTOGRAPH IS THE ARTIFACT, not an illustration of one.
 *
 * THE MEASURED GAP THIS CLOSES. A body element could hold a sentence and a citation and nothing
 * else, so media was unrepresentable — while the photo path in @foliage/photosynthesis already
 * read the bytes, computed `sha256:<hex>`, asked a local model what it saw, and then DISCARDED
 * the photograph, keeping one drafted line about it. For a welder, a chef, a stagehand or a
 * joiner the work IS visual: the bead, the plate, the rig, the joint. Converting it to prose and
 * throwing the image away is not a lossy format, it is the whole portfolio discarded.
 *
 * A MEDIA ELEMENT IS NOT A WEAKER ELEMENT. `provenance` is REQUIRED on it for exactly the reason
 * it is required on a text element: a photograph with no ref is precisely as unsourced as a
 * sentence with no ref, and "but you can see it" is not a citation. The grounding rule does not
 * relax because the element became visual.
 *
 * IT IS ALSO NOT PROOF OF AUTHORSHIP. Bytes establish that these bytes existed; who made the
 * thing depicted is not in the file, and EXIF authorship is self-declared exactly the way
 * `git config user.email` is. That is why photo intake promotes to `pending` and never to
 * `verified`, and nothing here changes it.
 *
 * A captured MP4 is also evidence, but only of the recorded bytes. It is not independent proof
 * that the depicted work happened as shown. The local capture adapter keeps its clip private
 * until the owner reviews the joint still/video candidate, then explicitly selects the clip
 * again for publication. The content digest establishes byte integrity after recording, not
 * the truth of any scene or edit.
 */

/**
 * The media types a leaflet may carry. A CLOSED list, refused by name when it does not match.
 *
 * JUSTIFIED BY WHAT THIS PRODUCT CAN ACTUALLY OBSERVE, not by taste. `apps/leaf/src/photoSource.ts`
 * identifies files by their MAGIC BYTES and never by their extension — a `.png` suffix is a claim
 * the file makes about itself — and this list is exactly those signatures: JPEG, PNG, GIF, WebP,
 * TIFF, and the ISO-BMFF still-image family that an iPhone photograph and a macOS wallpaper
 * really are. HEIC and AVIF share one magic-byte family and are named separately because they are
 * different media types, and the media type is what a server has to send.
 *
 * HEIC AND TIFF ARE ON THE LIST AND MOST BROWSERS WILL NOT DISPLAY THEM. Deliberate: the artifact
 * is the bytes and their digest, so refusing the file a scanner or a phone actually produced
 * would answer "here is my photograph" with "your file does not exist". A surface that cannot
 * display one must SAY so — the same discipline as an unmeasured dimension carrying its cause.
 *
 * SVG IS NOT AN IMAGE IN THE SENSE THIS TYPE MEANS, and it is left off for a security reason
 * rather than an aesthetic one: an SVG is a document that executes. It can carry script and
 * reference remote resources, which would break the zero-network claim on the very surface a
 * stranger opens, and its dimensions are a viewport hint rather than a property of the bytes.
 *
 * WHY AN IANA MEDIA TYPE AND NOT AN ENUM LIKE "jpeg". It is what an HTTP response and a
 * `<source type>` need verbatim, so an enum would only be re-mapped at every boundary; and it is
 * the shape in which `"video/mp4"` is one entry rather than a new field. Unordered, like every
 * other closed list here: no format is "better" than another.
 */
export type MediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/avif"
  | "image/heic"
  | "image/tiff"
  | "video/mp4";

export const MEDIA_TYPES: readonly MediaType[] = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/tiff",
  "video/mp4",
]);

/**
 * The pixel size of an image, or the NAMED REASON it is not known.
 *
 * NOT `width: 0`. "The decoder is not installed on this machine" and "this image is zero pixels
 * wide" are different facts, and collapsing them into a zero is the failure this repository
 * exists to refuse, one datum smaller.
 *
 * THE SAME SHAPE AS `PixelDimensions` IN @foliage/photosynthesis, and a second declaration rather
 * than an import BECAUSE THE DEPENDENCY RUNS THE OTHER WAY: photosynthesis imports this package,
 * so importing back would be a cycle. Same name and same shape on purpose — that makes the
 * intended end state a delete-and-import rather than a rename, and any observation photo intake
 * measured is assignable here without translation. Stated out loud because an unnamed duplicate
 * is how two definitions drift.
 */
export type PixelDimensions =
  | { readonly known: true; readonly width: number; readonly height: number }
  | { readonly known: false; readonly why: string };

/**
 * The media an element carries: WHAT it is and HOW BIG it is. Not WHERE it is, and not WHAT IT IS
 * CALLED — both of those are `provenance.ref`, which for a media element IS the content digest.
 *
 * THE DIGEST IS THE NAME. Giving media a second identifier — a file name, a uuid, a storage key —
 * would create the one thing this format refuses: two names for one artifact, which can drift
 * until nobody can say which is the file. With the ref as the digest, whoever is served the image
 * can hash what they received and compare it with what the document says; the bytes and the
 * reference cannot disagree without that being visible to anyone who checks.
 *
 * THE RULE IS ENFORCED BY THE PARSER, NOT BY THIS TYPE, and that is a tradeoff worth naming: a
 * branded `DigestRef` would carry it in the type system, but `Provenance` is shared with git
 * intake, where the ref is a commit sha and is not a digest at all — so branding would either
 * infect every ref in the product or need a second Provenance. `parseLeafDocument` refuses a
 * media element whose ref is not `sha256:<64 lowercase hex>`, with the reason stated.
 *
 * NO BYTE LENGTH, on purpose. It is derivable from the bytes anyone can fetch, and a stated size
 * that disagrees with the file would be a second source of truth about a fact the digest already
 * settles.
 */
export interface LeafletMedia {
  readonly mediaType: MediaType;
  /** Required. An unknown size states its cause; it never appears as a zero or as an absence. */
  readonly dimensions: PixelDimensions;
}

/**
 * ONE GROUNDED ELEMENT OF A LEAFLET'S BODY.
 *
 * WHY THE BODY IS A LIST AND NEVER A BLOB. A title is a small thing for a machine to invent;
 * a paragraph is where an invented claim hides between two true ones. So the body is a list
 * of elements each carrying its OWN evidence ref, which buys two properties that a free-text
 * field cannot have:
 *
 *   MUST-GROUND HOLDS ELEMENT-WISE, not merely document-wise. "Which part of this is
 *   sourced?" has an answer per element rather than per artifact.
 *
 *   THERE IS NOWHERE FOR UNSOURCED PROSE TO LIVE, because the format has no field for it.
 *   Same move as refusing unknown keys: make the dangerous thing unrepresentable rather than
 *   policing it after the fact.
 *
 * `provenance` is REQUIRED and `text` is OPTIONAL, and that asymmetry is the whole design.
 * An element with a ref and no words is an honest evidence listing — the refs are real, the
 * prose does not exist yet, and inventing a sentence to fill the field would be exactly the
 * fabrication this format refuses. Words with no ref are not expressible at all.
 *
 * KNOWN GAP, stated rather than implied away: the refusal of score-shaped material is applied
 * to KEYS by the document gate, not to the CONTENT of `text`. A drafter that writes a rating
 * into a sentence is stopped by nothing here. That is the same unfixed finding the harvest
 * document records about drafted titles; a body widens the surface it applies to.
 *
 * AN ELEMENT IS TEXT OR MEDIA, and the two differ by ONE key. Everything above holds unchanged
 * for both: `provenance` required, `text` optional, no third place for an unsourced claim to
 * sit. A media element adds `media` and nothing else — see `LeafletMedia`.
 */
export interface TextBodyElement {
  /** The evidence this element rests on. Required: an element is grounded or it is nothing. */
  readonly provenance: Provenance;
  /** One claim, when there is one. Absent means this element is the bare evidence ref. */
  readonly text?: string;
}

/**
 * A body element whose artifact is the media itself.
 *
 * `text` STAYS OPTIONAL HERE, and it is a caption rather than a description: a claim ABOUT the
 * photograph, resting on the photograph's own digest. Optional for the same reason as on a text
 * element — an image with a ref and no words is an honest evidence listing, and writing a
 * sentence to fill the field is the fabrication this format exists to refuse. It is exactly what
 * a machine describer must NOT be allowed to fill in silently.
 */
export interface MediaBodyElement {
  readonly provenance: Provenance;
  readonly media: LeafletMedia;
  readonly text?: string;
}

export type BodyElement = TextBodyElement | MediaBodyElement;

/**
 * Does this element carry media?
 *
 * THE ONE PLACE THAT QUESTION IS ANSWERED, for the same reason `leafletVisibility` is the one
 * place the private default lives: the alternative is every surface inventing its own test, and
 * a renderer that guesses wrong either omits a photograph or prints a broken image where a
 * sentence was. Discriminated by the PRESENCE of `media` rather than by a tag field, because a
 * required tag would refuse every document written before media existed and an optional tag is
 * not a discriminant at all.
 */
export function isMediaBodyElement(element: BodyElement): element is MediaBodyElement {
  return "media" in element;
}

/** A leaflet's body: grounded elements, in the order the artifact presents them. */
export type LeafletBody = readonly BodyElement[];

/**
 * PER-LEAFLET VISIBILITY, for the OPEN plane.
 *
 * Deliberately NOT `ReleaseState` from @foliage/enterprise-policy, and not a copy of it. Two
 * separate reasons, and either alone would be sufficient:
 *
 *   THE BOUNDARY. `open` may not reach `enterprise`; `pnpm check:boundary` would refuse the
 *   import, and it would be right to — the open core has to stand alone or the open-source
 *   claim is marketing.
 *
 *   THEY ANSWER DIFFERENT QUESTIONS. The enterprise state machine models a COMPANY DECISION
 *   about outward release: events, actors, a transition table, and the difference between
 *   "approved" and "live" because approval and egress are separate corporate acts. This is a
 *   PERSON deciding what to hand to someone else about their own work. There is no reviewer,
 *   no policy owner, and no workflow — so there are no events and no transitions here, only a
 *   property of the artifact. Narrower on purpose.
 *
 * Three states, because "shared" is not one bit — the same lesson the enterprise header
 * records, arrived at from the other side:
 *
 *   `private`   the subject's own accounting. THE DEFAULT, and the only safe default: a
 *               leaflet nobody has decided to share must not be shareable by omission.
 *   `unlisted`  may be handed to whoever holds the link. This is what lets ONE leaflet be
 *               shared without the compound — the leaf holds pending and excluded entries
 *               that are the subject's private accounting and were never outward claims.
 *   `public`    may additionally be listed on the compound leaf and offered outward.
 *
 * UNORDERED, like `ProofTier`: no comparator, no numeric mapping, no "level". Callers ask the
 * two questions below rather than comparing states themselves, so the rule lives in one place.
 *
 * This field NEVER overrides the enterprise release machine. Where a leaf is governed by a
 * company, that machine decides egress; this says only what the subject has offered.
 */
export type LeafletVisibility = "private" | "unlisted" | "public";

export const LEAFLET_VISIBILITIES: readonly LeafletVisibility[] = Object.freeze([
  "private",
  "unlisted",
  "public",
]);

/**
 * The visibility of a leaflet, with the safe default applied in ONE place.
 *
 * The field is optional on the type because a document written before visibility existed is
 * still a valid document, and because making it required would force every producer in the
 * tree to state a visibility it has no opinion about. That leaves `undefined` in the type,
 * and `undefined` read raw by a renderer is exactly how "not decided" becomes "not private".
 * So nothing reads the field directly: this function is the only place the default lives.
 */
export function leafletVisibility(leaflet: {
  readonly visibility?: LeafletVisibility;
}): LeafletVisibility {
  return leaflet.visibility ?? "private";
}

/**
 * May this leaflet be served at its own URL to someone holding the link?
 *
 * The question a per-leaflet route has to ask before it renders anything.
 */
export function isLinkShareable(visibility: LeafletVisibility): boolean {
  return visibility === "unlisted" || visibility === "public";
}

/**
 * May this leaflet be LISTED — named in the compound leaf's outward view, or anywhere else
 * that enumerates a person's work to a reader who is not them?
 *
 * Exactly one state qualifies. `unlisted` deliberately does not: being willing to hand
 * someone a link is a different consent from being enumerated, and collapsing the two is the
 * boolean mistake.
 */
export function isListedOnLeaf(visibility: LeafletVisibility): boolean {
  return visibility === "public";
}

/**
 * A LEAFLET IS THE ARTIFACT — self-contained, evidence-bearing, independently addressable,
 * independently shareable. `body` and `visibility` are what make that true rather than
 * aspirational, and both are OPTIONAL so every document written before they existed still
 * parses unchanged.
 *
 * The measurement that forced `body`, re-derived on this repository 2026-08-19 and recorded
 * in ledger row F9: an approved candidate carrying SEVEN evidence refs promoted into a
 * leaflet with ONE `provenance.ref`, and the page then rendered the title "cleanup: 7
 * commits" above a single Ref cell. Six real refs were dropped at the seam because the format
 * had nowhere to put them, and the artifact could not substantiate a count it was printing.
 */
export type Leaflet =
  | {
      readonly id: LeafletId;
      readonly title: string;
      readonly tier: "verified";
      readonly provenance: Provenance;
      readonly body?: LeafletBody;
      readonly visibility?: LeafletVisibility;
    }
  | {
      readonly id: LeafletId;
      readonly title: string;
      readonly tier: "pending";
      readonly provenance?: Provenance;
      readonly body?: LeafletBody;
      readonly visibility?: LeafletVisibility;
    }
  | {
      /**
       * An excluded leaflet MUST carry a reason. Making the field required in the type is
       * what stops "excluded" from degrading into an unexplained absence — the previous
       * system collapsed four distinct causes into `commitCount: 0` and then asserted
       * "0 commits" about work it had never read.
       */
      readonly id: LeafletId;
      readonly title: string;
      readonly tier: "excluded";
      readonly reason: string;
      readonly provenance?: Provenance;
      readonly body?: LeafletBody;
      readonly visibility?: LeafletVisibility;
    };

/** A bounded presentation choice made by the owner; never computed from proof tiers. */
export const MAX_FEATURED_LEAFLETS = 12;
export interface LeafCuration {
  /** Owner-selected order. The first entry names the leading tip. References survive
   * collection changes so only the owner can replace or clear an unavailable choice. */
  readonly featured: readonly LeafletId[];
}

/** Storage bounds, not ratings or a measure of a person's work. */
export const PORTFOLIO_LIMITS = Object.freeze({
  id: 100, title: 180, bio: 2600, direction: 1000, passions: 12, passion: 100,
  achievements: 64, claims: 24, claimText: 2600, citations: 32,
  collections: 24, collectionDescription: 1200, collectionLeaflets: 512,
});
export const ACHIEVEMENT_CLAIM_KINDS = ["summary", "problem", "intent", "decision", "challenge", "pivot", "discovery", "learning", "contribution", "outcome", "ai-contribution"] as const;
export type AchievementClaimKind = (typeof ACHIEVEMENT_CLAIM_KINDS)[number];
/** Narrative categories, not stages every person must fill or assertions of success. */
export const ACHIEVEMENT_CLAIM_LABELS: Readonly<Record<AchievementClaimKind, string>> = Object.freeze({
  summary: "Résumé statement", problem: "The problem", intent: "Why it mattered",
  decision: "Key decision", challenge: "Roadblock & response", pivot: "Change of direction",
  discovery: "What I discovered", learning: "What I learned", contribution: "My contribution",
  outcome: "What changed", "ai-contribution": "How AI helped",
});
export const LEAF_COLLECTION_KINDS = ["company", "role", "body-of-work"] as const;
export type LeafCollectionKind = (typeof LEAF_COLLECTION_KINDS)[number];

/** The person's own account. Collectors must neither invent nor overwrite these words. */
export interface LeafProfile {
  readonly bio?: string;
  readonly direction?: string;
  readonly passions?: readonly string[];
}
/** An exact retained reference, not an assertion that it establishes a claimed outcome. */
export interface ClaimCitation {
  readonly leaflet: LeafletId;
  readonly provenance: Provenance;
}
export interface AchievementClaim {
  /** Stable within its achievement, for an exact claim link independent of display order. */
  readonly id: string;
  readonly kind: AchievementClaimKind;
  readonly text: string;
  /** Missing or empty means support has not been attached, never that a claim is verified. */
  readonly citations?: readonly ClaimCitation[];
}
export interface LeafAchievement {
  readonly id: string;
  readonly title: string;
  readonly claims: readonly AchievementClaim[];
}
/** Private recovery record. Restoring a version creates another edit; history is never proof. */
export interface JourneyEdit {
  readonly id: string;
  readonly at: string;
  readonly actor: "manual" | "agent";
  readonly achievement: string;
  readonly before: LeafAchievement | null;
  readonly after: LeafAchievement;
}
/** A named view over the same evidence. It is not another copy or permission to publish it. */
export interface LeafCollection {
  readonly id: string;
  readonly title: string;
  readonly kind: LeafCollectionKind;
  readonly description?: string;
  readonly achievements: readonly string[];
  readonly leaflets: readonly LeafletId[];
}

export interface Leaf {
  readonly id: LeafId;
  /** Display name of the person whose portfolio this is. */
  readonly subject: string;
  /**
   * One line the SUBJECT wrote about themselves, or nothing (DT-1).
   *
   * This prose is authored rather than derived: no machine — intake, harvest, promote, any drafter — may ever write
   * or invent it, and every renderer must mark it as the subject's own words
   * (`data-authored="subject"`), never as something Foliage said. Absent means absent: a leaf
   * without one renders its derived lede, not a placeholder inviting one.
   */
  readonly headline?: string;
  /** Absent means no choices; an empty list explicitly clears the featured selection. */
  readonly curation?: LeafCuration;
  readonly presentation?: import("./portfolio.ts").PortfolioPresentation;
  /** All portfolio context stays private unless separately selected for publication. */
  readonly profile?: LeafProfile;
  /** Owner-selected order: the first achievement is their keystone, never a computed rank. */
  readonly achievements?: readonly LeafAchievement[];
  /** Private before/after versions; never part of an outward portfolio projection. */
  readonly journeyHistory?: readonly JourneyEdit[];
  readonly collections?: readonly LeafCollection[];
  readonly leaflets: readonly Leaflet[];
}

/** A leaflet that is THIS SUBJECT'S OWN WORK — every tier except `excluded`. */
export type SubjectsOwnLeaflet = Exclude<Leaflet, { readonly tier: "excluded" }>;

/**
 * Is this leaflet the subject's own work, or somebody else's?
 *
 * A question of ATTRIBUTION, not of proof strength: `excluded` means this leaflet could not be
 * attributed to the subject — `intake.ts` mints it for a commit whose author is an identity the
 * subject never declared, and it carries a `reason` saying why. Treating it as this subject's
 * work would not be an overclaim about proof, which a tier disclosure fixes; it would be a
 * FALSE ATTRIBUTION, and no disclosure fixes that. `verified` and `pending` ARE the subject's
 * own work at different proof strengths, a different question answered elsewhere
 * (`publishableLeaflets`, `attributionLedger`).
 *
 * EXHAUSTIVE ON PURPOSE: `verified` and `pending` are enumerated by name rather than defaulted,
 * so a fourth `ProofTier` fails to compile here (`TS2366`, verified against tsc 5.9.3) instead
 * of quietly reaching a public page — no ordering, no comparison, and a `!== "excluded"` test
 * would have admitted a new tier silently. Exported so a second surface — `@foliage/canopy`'s
 * public projection — imports this rather than restating it.
 */
export function isSubjectsOwnWork(leaflet: Leaflet): leaflet is SubjectsOwnLeaflet {
  switch (leaflet.tier) {
    case "verified":
    case "pending":
      return true;
    case "excluded":
      return false;
  }
}

/** Resolve the owner's choices without defaults or a proof-tier comparison. Missing or
 * excluded choices remain in curation for review, but never become presented work. */
export function featuredLeaflets(leaf: Leaf): readonly SubjectsOwnLeaflet[] {
  const records = new Map(leaf.leaflets.map(leaflet => [leaflet.id, leaflet]));
  return (leaf.curation?.featured ?? []).flatMap(id => {
    const record = records.get(id);
    return record && isSubjectsOwnWork(record) ? [record] : [];
  });
}

/**
 * Only verified leaflets may be published as claims.
 *
 * Pending and excluded leaflets are still surfaced to the subject in their own view, and
 * still counted honestly by `attributionLedger`, but they are never rendered outward as
 * assertions about what someone did.
 *
 * THIS ANSWERS THE TIER QUESTION ONLY, and since per-leaflet visibility exists that is half
 * the question. Tier says whether a leaflet MAY be a claim; visibility says whether the
 * subject has OFFERED it to anyone. A surface handing a leaflet to a reader who is not the
 * subject must satisfy both — this filter plus `isLinkShareable` or `isListedOnLeaf`. The two
 * are kept separate rather than merged here because a subject's own view legitimately wants
 * the tier filter without the visibility one.
 */
export function publishableLeaflets(leaf: Leaf): readonly Leaflet[] {
  return leaf.leaflets.filter((l) => l.tier === "verified");
}

export interface AttributionLedger {
  readonly verified: number;
  readonly pending: number;
  readonly excluded: number;
  /** Reasons for every exclusion, so the count is explainable rather than just a number. */
  readonly exclusionReasons: readonly string[];
}

/**
 * An honest tally of a leaf.
 *
 * Returns counts per tier and never a ratio, percentage, or composite. A caller that
 * wants "96% grounded" has to compute it themselves and own that choice; this package
 * will not hand out a figure that reads like a rating.
 *
 * O(n) in the number of leaflets, single pass.
 */
export function attributionLedger(leaf: Leaf): AttributionLedger {
  let verified = 0;
  let pending = 0;
  let excluded = 0;
  const exclusionReasons: string[] = [];

  for (const l of leaf.leaflets) {
    switch (l.tier) {
      case "verified":
        verified++;
        break;
      case "pending":
        pending++;
        break;
      case "excluded":
        excluded++;
        exclusionReasons.push(l.reason);
        break;
    }
  }

  return Object.freeze({
    verified,
    pending,
    excluded,
    exclusionReasons: Object.freeze(exclusionReasons),
  });
}
