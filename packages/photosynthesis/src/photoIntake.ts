/**
 * PHOTOGRAPH INTAKE — the domain half. What a photograph can and cannot establish, and
 * nothing else.
 *
 * A second light source. Git history is one kind of raw material already on someone's machine;
 * photographs are another — a whiteboard from a design session, a conference stage, a physical
 * build, an award. This module turns OBSERVATIONS about image files into leaflet CANDIDATES a
 * person then reviews. Walking a directory, hashing bytes, running `sips`, asking a local model
 * — all of that is I/O and lives in `apps/leaf/src/photoSource.ts`. The judgement about proof
 * lives here, for the same reason `commitsToLeaflets` does: the person whose portfolio is being
 * judged has to be able to read the rule.
 *
 * WHAT A PHOTOGRAPH ESTABLISHES: that a file with these exact bytes was on the machine when it
 * was read, and — if the machine could decode it — what size the image is. That is the whole
 * list. It does NOT establish who made the thing depicted, who took the photograph, or when.
 * A photo-derived candidate is therefore a SUGGESTION, and promotion turns an approved one into
 * a `pending` leaflet, never a `verified` one. `verified` in this product means a signature was
 * checked and accepted; there is no cryptography anywhere in a JPEG's provenance, and EXIF
 * authorship is self-declared exactly the way `git config user.email` is. Nothing in this file
 * can reach the verified tier, and that is structural rather than a promise: a `HarvestCandidate`
 * carries no tier at all, and `promoteApproved` writes `pending` unconditionally.
 *
 * EVIDENCE IS THE DIGEST, NOT THE PATH. A path is a name someone can change this afternoon; the
 * content digest is the checkable part, so it is what becomes the evidence ref and what the
 * candidate id is built from. Two consequences worth stating: re-running intake after a rename
 * produces the SAME candidate id (so promotion's duplicate refusal catches it, instead of the
 * portfolio quietly growing a second copy), and two files with identical bytes are one artifact
 * — the second is skipped with a named cause rather than drafted twice.
 *
 * TWO HAZARDS OF MACHINE DESCRIPTION, both MEASURED on the machine this was written on, and both
 * of which shape the types above rather than being left as advice:
 *
 *   1. A CONSTRAINED DECODER CANNOT DECLINE. Grammar-enforced structured output (ollama's
 *      `format`) means the model physically cannot leave the schema — which is exactly why every
 *      field in that schema must be NULLABLE. With a required non-nullable field whose answer is
 *      not in the image, the only way for the decoder to satisfy the grammar is to invent one.
 *      So `DraftedDescription` carries `string | null` per field, "the describer did not answer"
 *      is a first-class value, and an absence that arrives here LEAVES here as an absence: an
 *      unanswered summary produces a title made of file facts, credited to `photo-file` and not
 *      to the model, because crediting a model for a title it did not write is a lie about
 *      provenance in the one field review uses to decide whether to trust a draft.
 *
 *   2. THE MODEL FABRICATES OCCLUDED TEXT AND MIS-TRANSCRIBES SMALL TEXT. Measured: asked what a
 *      headline clipped at the crop edge said, gemma4:12b answered "CANOPY IS A COLLECTION OF"
 *      where the truth was "A portfolio is a collection of" — despite an explicit instruction not
 *      to guess; and it read "01 — TARDING" where the image said "01 · TAXONOMY". Therefore
 *      TRANSCRIBED TEXT NEVER ENTERS A CANDIDATE. It is returned BESIDE the candidates, in
 *      `transcriptions`, where a caller has to handle it deliberately and can label it as the
 *      draft it is. This is the same shape as `uncheckedSignatures` in `@foliage/leaf`: the fact
 *      travels next to the result instead of being folded into it, because folding it in is how
 *      a guess becomes a claim.
 *
 * TOTAL and PURE, like every domain function here: no fs, no network, no clock, no throw. It
 * takes what the app measured and returns either candidates or every reason it could not build
 * them. And like `promoteApproved`, it RE-VALIDATES its own output with the real gate
 * (`parseHarvestDocument`) before returning — the candidates handed back are the ones the gate
 * produced, not this function's opinion of what it built.
 *
 * Complexity: O(n) over images, one pass, plus an O(n) Map of digests for duplicate detection.
 */

import {
  MEDIA_TYPES,
  RATING_SHAPED,
  isIsoInstant,
  type MediaType,
  type PixelDimensions,
} from "@foliage/leaf";

import {
  parseHarvestDocument,
  type HarvestCandidate,
  type HarvestDocumentIssue,
} from "./harvestDocument.ts";

/**
 * The mechanism, as it appears in each evidence ref's `source`. A constant rather than a
 * caller-supplied string, same reasoning as `GIT_SOURCE`: this function reads images and only
 * images, so letting a caller label the output "git" would let it mislabel real evidence.
 */
export const PHOTO_SOURCE = "photo";

/**
 * The extractor identity for a title built from FILE FACTS ALONE — the name, the pixel size,
 * and the plain statement that nothing was drafted. It is what appears after promotion as
 * `photosynthesis:photo-file`, and it is used whenever no description was available, INCLUDING
 * when a describer ran and answered nothing. A model that declined did not write the title.
 */
export const PHOTO_FILE_EXTRACTOR = "photo-file";

/** The digest algorithm every ref is built from, named in the ref so it can be re-computed. */
const DIGEST_ALGORITHM = "sha256";

/** Lowercase hex SHA-256, full length. Mirrors `OBJECT_NAME` in @foliage/leaf's intake. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The pixel size of an image, or the named reason it is not known.
 *
 * NOT `width: 0`. "The decoder is not installed on this machine" and "this image is zero pixels
 * wide" are different facts, and collapsing them into a zero is the bug this repository exists
 * to refuse, one datum smaller. `sips` is macOS-only and is the only image pipeline present on
 * the machine this was built on; its absence has to survive as a cause, not as a number.
 *
 * RE-EXPORTED FROM `@foliage/leaf`, not declared twice. It was declared twice for exactly as long
 * as this module had nothing to do with the leaf's media object: the dependency runs one way
 * (photosynthesis imports leaf, never the reverse), so the duplicate was the cheap side of a
 * cycle. Now that a measured size crosses the seam INTO a media element, two definitions of one
 * shape would be two definitions that can disagree, and the disagreement would surface as a
 * promotion refused by the leaf gate. The alias is kept so callers that name
 * `photosynthesis.PixelDimensions` still compile.
 */
export type { PixelDimensions } from "@foliage/leaf";

/**
 * What a describer returned about one image. EVERY FIELD IS NULLABLE, and that is load-bearing
 * rather than defensive — see hazard 1 in the header.
 */
export interface DraftedDescription {
  /**
   * The identity of whatever produced this — "local-model:gemma4:12b". Never blank: it becomes
   * the candidate's `extractor`, which is the field review reads before deciding whether to
   * trust a drafted line.
   */
  readonly describer: string;
  /** One line about what the image SHOWS, or null when the describer did not answer. */
  readonly summary: string | null;
  /**
   * Text the describer claims is visible in the image, or null. A DRAFT, and never stored: it is
   * returned in `transcriptions` and never reaches a candidate. See hazard 2.
   */
  readonly visibleText: string | null;
}

/**
 * One image as the app layer ACTUALLY MEASURED IT. Observations only; every conclusion drawn
 * from them is this module's job.
 */
export interface ObservedImage {
  /**
   * Where the file was found. Operator-facing ONLY — it addresses them in reports and supplies
   * the file name used in a factual title. It is never evidence and never a ref: paths change,
   * digests do not.
   */
  readonly path: string;
  /** Lowercase hex SHA-256 of the file's bytes. The checkable part, and the whole evidence. */
  readonly digest: string;
  /** Size in bytes, as the filesystem reported it. */
  readonly byteLength: number;
  readonly dimensions: PixelDimensions;
  /** What a describer said about it, or null when none ran. */
  readonly description: DraftedDescription | null;
  /**
   * What the app can actually SERVE for these bytes, or null when it cannot serve them at all.
   *
   * NULL IS THE ORDINARY CASE, not a failure: the file was measured, the digest is real, and the
   * candidate is drafted either way — a photograph the machine could not store is still evidence
   * that the file exists, which is the entire claim a photo leaflet makes. What null costs is the
   * picture on the page, and that cost is the operator's to see in the app's own store report.
   *
   * IT IS THE PUBLISHED TYPE, NOT THE SOURCE TYPE, and the distinction is the seam. A store that
   * strips metadata changes the file, and one that decodes HEIC changes it further — so the bytes
   * a browser will be handed may be a JPEG when the file on disk is a HEIC. Writing the source
   * type into the document would make the page announce a format nobody will be served. The ref
   * still names the file AS FOUND, which is what `shasum -a 256` reproduces; see the media
   * store's "two digests" note for how a reader is told which one checked what.
   */
  readonly published: PublishedMedia | null;
}

/**
 * What one image will be served as, measured by whatever actually holds the bytes.
 *
 * A separate shape from `LeafletMedia` even though it will become one, because this is an
 * OBSERVATION the app made and that is a claim the document makes. `dimensions` is not repeated
 * here: it is already on the `ObservedImage`, and one fact recorded twice is one fact that can
 * disagree with itself.
 */
export interface PublishedMedia {
  /** The IANA type of the bytes the app would serve — the leaf format's own closed vocabulary. */
  readonly mediaType: MediaType;
}

export interface PhotoIntakeRequest {
  readonly images: readonly ObservedImage[];
  /** When the directory was read, as an ISO-8601 instant with an offset. */
  readonly observedAt: string;
}

/** One reason intake could not proceed, addressed to whoever ran it. */
export interface PhotoIntakeIssue {
  /** Where the problem is: `observedAt`, `images[3].digest`. */
  readonly at: string;
  readonly message: string;
}

/**
 * Why an observed image did not become a candidate.
 *
 * `empty-file`     — zero bytes. There is no image in no bytes, and hashing nothing produces a
 *                    perfectly valid digest of nothing, which would be a ref pointing at no
 *                    artifact. WHO REACHES THIS, stated because a cause nobody can reach implies
 *                    coverage that does not exist: `readImages` identifies a file by its first
 *                    bytes, so a file that is empty for the whole scan never arrives here as an
 *                    image — it is counted as an empty file there and reported as one. What does
 *                    arrive here is the RACE: the head is read at one instant and the size at
 *                    another, so a file truncated in between is identified as an image and
 *                    measured at zero, and its digest is then sha256 of nothing. Any caller that
 *                    identifies by extension instead of by content reaches it on the ordinary
 *                    path. The guard stays because deleting it makes both of those a candidate.
 * `duplicate-digest` — the same bytes were already seen at another path. ONE artifact, one
 *                    candidate; the other path is named so the operator sees the copy rather
 *                    than wondering where a file went.
 *
 * A skip is not an error and it is never silent — this is the `excluded` discipline applied one
 * layer earlier: a cause, a reason, and a count.
 */
export type PhotoSkipCause = "empty-file" | "duplicate-digest";

export interface PhotoSkip {
  readonly path: string;
  readonly cause: PhotoSkipCause;
  readonly reason: string;
}

/** One candidate whose title came from the file rather than from a description, and why. */
export interface PhotoDraftNote {
  readonly path: string;
  readonly reason: string;
}

/**
 * One image whose pixel size is not known, carrying the APP's own reason verbatim.
 *
 * This type exists because the reason was already being built and then thrown away. The app
 * measures with `sips` and, when that produces nothing usable, writes an exact cause — which
 * decoder is missing, or what the tool printed instead of a size. This module already treats
 * that reason as load-bearing enough to REFUSE an observation whose `why` is blank; a reason
 * worth refusing an input over is a reason worth showing the operator, and until it had a
 * channel out of here nobody ever saw one.
 */
export interface PhotoUnmeasured {
  readonly path: string;
  /** Exactly what the app reported, not a paraphrase of it. */
  readonly why: string;
}

/** Text a describer claims to see in an image. Reported, never recorded. */
export interface PhotoTranscription {
  readonly path: string;
  /** The evidence ref of the image it was read off, so the operator can find it again. */
  readonly ref: string;
  readonly describer: string;
  readonly text: string;
}

export type PhotoIntake =
  | {
      readonly ok: true;
      /** Exactly as `parseHarvestDocument` accepted them. */
      readonly candidates: readonly HarvestCandidate[];
      /** Observed images that produced no candidate, each with its cause. Never silent. */
      readonly skipped: readonly PhotoSkip[];
      /**
       * Every candidate whose title is file facts rather than a drafted line, with the reason:
       * no describer ran, the describer answered nothing, or its draft was refused below.
       * A caller that prints "N candidates drafted by the local model" without reading this list
       * is overstating what the model did — which is the whole reason it is returned.
       */
      readonly undescribed: readonly PhotoDraftNote[];
      /**
       * Drafts refused for carrying a rating-shaped number, WITH the text that was refused.
       *
       * Overlaps `undescribed` on purpose: that list accounts for where each title came from,
       * this one says what was silenced. Neither is derivable from the other, and a refusal
       * nobody can see is indistinguishable from a describer that had nothing to say.
       */
      readonly refusedRatingShapedDrafts: readonly PhotoDraftNote[];
      /**
       * Candidates whose FILE NAME carries a rating-shaped number, so the name was kept out of
       * the title — with the name itself, quoted.
       *
       * A separate register from `refusedRatingShapedDrafts` because the two are different
       * events with different remedies: there, a model wrote a rating and the file title stands
       * instead; here, the operator's own file name is the rating, and the title has to say so.
       * Folding them together would report "a draft was refused" about a directory where no
       * describer ever ran.
       */
      readonly refusedRatingShapedNames: readonly PhotoDraftNote[];
      /**
       * Every candidate whose title states no pixel size, and the app's exact reason it could
       * not be measured. A title that simply omits the size looks identical whether the decoder
       * is missing, the file is truncated, or nobody looked — and the app knew which.
       */
      readonly unmeasuredDimensions: readonly PhotoUnmeasured[];
      /**
       * Text a describer claims to see, for the OPERATOR to read — not for the document. See
       * hazard 2 in the header: this model demonstrably invents occluded text and mis-reads
       * small text, so a transcription is a lead, not a fact, and storing it would make it one.
       */
      readonly transcriptions: readonly PhotoTranscription[];
    }
  | {
      /** The observations themselves are unusable; nothing was built. */
      readonly ok: false;
      readonly cause: "unusable-observations";
      readonly issues: readonly PhotoIntakeIssue[];
    }
  | {
      /**
       * The candidates this function built were refused by the harvest gate. If this ever occurs
       * it is a bug in THIS module, not in the caller's input — reported with the gate's own
       * issues rather than thrown, exactly as `promoteApproved` does.
       */
      readonly ok: false;
      readonly cause: "round-trip-rejected";
      readonly issues: readonly HarvestDocumentIssue[];
    };

/**
 * The last path segment, without importing `node:path`.
 *
 * @foliage/leaf and @foliage/photosynthesis use no Node built-ins at all, which is what keeps
 * the open set trivially portable — and a basename is two string operations, so reaching for a
 * built-in here would trade that property for nothing. Both separators are handled because the
 * observation is a string the app measured, and the app is not guaranteed to be posix.
 */
function fileNameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = cut === -1 ? path : path.slice(cut + 1);
  return name.trim().length > 0 ? name : path;
}

/**
 * The first non-blank line of a describer's answer, or null.
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
 * What stands where the file name would be when the name itself carries a rating.
 *
 * A statement about the artifact, in the same register as the rest of the title: it says that a
 * name exists and why it is not printed, rather than silently dropping the field or printing a
 * doctored version of it. The name reaches the operator through
 * `refusedRatingShapedNames`, and the candidate is still told apart by its id, which is the
 * digest.
 */
const WITHHELD_NAME = "(file name withheld: it carries a rating-shaped number)";

/**
 * A title made only of things that were measured: the file's name, its pixel size when the
 * machine could read it, and the plain statement that nothing was drafted.
 *
 * The same discipline as `titleOf` in @foliage/leaf's intake, where a commit with no message
 * becomes "(commit recorded with no message)" — a statement of fact about the artifact, not
 * invented content. The file name is included because it is the one observed thing that tells
 * two undescribed images apart, and a review queue of identical titles is not a review queue.
 *
 * `name` is passed in rather than derived here, because the caller is where the decision to
 * print the name or to withhold it is made, and one function returning a title it might have
 * censored is a function whose output cannot be read at the call site.
 */
function titleFromFile(image: ObservedImage, name: string): string {
  const size = image.dimensions.known
    ? `${image.dimensions.width}×${image.dimensions.height} `
    : "";
  return `${name} — ${size}image file, no description drafted`;
}

/**
 * Turn observed images into leaflet candidates, or report every reason they cannot be.
 *
 * Fails as a whole rather than per-image for unusable OBSERVATIONS (a malformed digest, an
 * instant with no offset), for the same reason `commitsToLeaflets` does: a partial answer here
 * asserts a smaller harvest than the directory holds. A file that is simply not draftable —
 * empty, or a byte-identical copy of one already seen — is a SKIP with a named cause, which is
 * a different thing and is reported as one. That divergence from the git path is deliberate:
 * observing the same commit twice means the read is broken, whereas two copies of one photograph
 * is what an ordinary export folder looks like.
 */
export function photosToCandidates(request: PhotoIntakeRequest): PhotoIntake {
  const issues: PhotoIntakeIssue[] = [];

  if (!isIsoInstant(request.observedAt)) {
    issues.push({
      at: "observedAt",
      message:
        `"${request.observedAt}" is not an ISO-8601 instant with an offset (e.g. ` +
        `2026-08-16T09:41:00Z). A local-time stamp is an observation plus an unstated ` +
        `assumption about where it was made.`,
    });
  }

  const drafts: Record<string, unknown>[] = [];
  const skipped: PhotoSkip[] = [];
  const undescribed: PhotoDraftNote[] = [];
  const refusedRatingShapedDrafts: PhotoDraftNote[] = [];
  const refusedRatingShapedNames: PhotoDraftNote[] = [];
  const unmeasuredDimensions: PhotoUnmeasured[] = [];
  const transcriptions: PhotoTranscription[] = [];
  /** digest -> the first path it was seen at, so a duplicate can name its original. */
  const seen = new Map<string, string>();

  for (const [i, image] of request.images.entries()) {
    const path = image.path.trim();
    if (path === "") {
      issues.push({
        at: `images[${i}].path`,
        message:
          `an observed image must carry the path it was found at. It is not evidence — the ` +
          `digest is — but a report that cannot name the file cannot be acted on.`,
      });
      continue;
    }

    const digest = image.digest.trim().toLowerCase();
    if (!SHA256_HEX.test(digest)) {
      issues.push({
        at: `images[${i}].digest`,
        message:
          `"${image.digest}" is not a lowercase hex SHA-256 digest of ${path}. A ref that ` +
          `cannot be re-computed is indistinguishable from a fabricated one, so it is refused ` +
          `rather than recorded as provenance.`,
      });
      continue;
    }

    if (!Number.isInteger(image.byteLength) || image.byteLength < 0) {
      issues.push({
        at: `images[${i}].byteLength`,
        message: `${image.byteLength} is not a byte count for ${path}.`,
      });
      continue;
    }

    if (image.dimensions.known) {
      const { width, height } = image.dimensions;
      if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        issues.push({
          at: `images[${i}].dimensions`,
          message:
            `${width}×${height} is not a pixel size for ${path}. Dimensions that could not be ` +
            `measured are { known: false } WITH a reason — never a zero standing in for one.`,
        });
        continue;
      }
    } else if (image.dimensions.why.trim() === "") {
      issues.push({
        at: `images[${i}].dimensions.why`,
        message:
          `unknown dimensions for ${path} require a reason. "Not measured" with no cause is ` +
          `the absence this product refuses: the operator cannot tell a missing decoder from ` +
          `an unreadable file.`,
      });
      continue;
    }

    if (image.byteLength === 0) {
      skipped.push({
        path,
        cause: "empty-file",
        reason:
          `${path} is zero bytes. Hashing nothing yields a perfectly valid digest of nothing, ` +
          `so it would become a ref pointing at no artifact.`,
      });
      continue;
    }

    const firstSeenAt = seen.get(digest);
    if (firstSeenAt !== undefined) {
      skipped.push({
        path,
        cause: "duplicate-digest",
        reason:
          `byte-identical to ${firstSeenAt}, which was already drafted. Identical bytes are ONE ` +
          `artifact and carry one candidate id; the copy is reported rather than drafted twice.`,
      });
      continue;
    }
    seen.set(digest, path);

    const description = image.description;
    if (description !== null && description.describer.trim() === "") {
      issues.push({
        at: `images[${i}].description.describer`,
        message:
          `a description of ${path} arrived with no describer identity. That identity becomes ` +
          `the candidate's extractor, which is what review reads before deciding whether to ` +
          `trust a drafted line — an anonymous draft cannot be reviewed.`,
      });
      continue;
    }

    const ref = `${DIGEST_ALGORITHM}:${digest}`;

    // Transcribed text is collected for the OPERATOR and goes no further. See hazard 2.
    if (description !== null) {
      const text = description.visibleText === null ? "" : description.visibleText.trim();
      if (text !== "") {
        transcriptions.push({
          path,
          ref,
          describer: description.describer.trim(),
          text,
        });
      }
    }

    let summary = description === null ? null : oneLine(description.summary);
    if (summary !== null && RATING_SHAPED.test(summary)) {
      refusedRatingShapedDrafts.push({
        path,
        reason:
          `the drafted title carried a rating-shaped number and was refused: "${summary}". ` +
          `Nothing in this product emits a number that reads like a rating; the file title ` +
          `stands instead, and the refused text is printed here so it is visible rather than ` +
          `quietly discarded.`,
      });
      summary = null;
    }

    if (summary === null) {
      undescribed.push({
        path,
        reason:
          description === null
            ? `no describer ran, so the title states only what was measured about the file.`
            : `${description.describer.trim()} returned no usable summary for this image, so ` +
              `the title states only what was measured. The draft is credited to ` +
              `"${PHOTO_FILE_EXTRACTOR}" and not to the model, which wrote none of it.`,
      });
    }

    // THE OTHER DOOR A RATING CAN COME THROUGH. Only reached when the file title is the one
    // being used — a drafted summary displaces the name entirely, and a name that never enters
    // a title is not a claim this product made about anybody.
    let title = summary;
    if (title === null) {
      const name = fileNameOf(path);
      const rated = RATING_SHAPED.test(name);
      if (rated) {
        refusedRatingShapedNames.push({
          path,
          reason:
            `the file name carries a rating-shaped number and was kept OUT of the title: ` +
            `"${name}". The name is not rewritten — it is what was observed on this machine, ` +
            `and editing an observation to satisfy a rule about claims would falsify the ` +
            `observation. Rename the file if you want it to appear.`,
        });
      }
      title = titleFromFile(image, rated ? WITHHELD_NAME : name);
    }

    // WHY THIS TITLE CARRIES NO PIXEL SIZE, carried out of here instead of ending at the
    // absence. The app builds an exact cause and this is the only channel it has.
    if (!image.dimensions.known) {
      unmeasuredDimensions.push({ path, why: image.dimensions.why.trim() });
    }

    // WHO WROTE THIS TITLE, stated exactly. A model that declined, or whose draft was refused
    // above, did not write the line that ends up on the candidate — so it is not credited with
    // it. The `description === null` half of this condition is not reachable while `summary` is
    // non-null (the summary comes from the description); it is written out anyway so the
    // extractor is decided by one total expression rather than by an inference.
    const extractor =
      summary === null || description === null
        ? PHOTO_FILE_EXTRACTOR
        : description.describer.trim();

    // THE PICTURE ITSELF, declared on the candidate so review sees it before approving — the
    // whole argument for the field is in `harvestDocument.ts`. Only when the app said it can
    // serve these bytes: a media element pointing at an object nothing holds would publish a
    // broken image under a real ref, which reads as "the evidence is missing" rather than "this
    // machine could not store it". The absence is reported by the app, not papered over here.
    const published = image.published ?? null;
    if (published !== null && !MEDIA_TYPES.includes(published.mediaType)) {
      issues.push({
        at: `images[${i}].published.mediaType`,
        message:
          `"${published.mediaType}" is not one of ${MEDIA_TYPES.join(", ")}. The list is closed ` +
          `by the leaf format, and a type outside it would be refused at promotion — after ` +
          `somebody had already approved the candidate.`,
      });
      continue;
    }
    // Not `unmeasuredDimensions`: this is the same fact travelling with the image rather than
    // with the title, and `{ known: false, why }` is a legal, checked value in the format. What
    // it must never become is a zero.
    const mediaEntry =
      published === null
        ? null
        : { ref, media: { mediaType: published.mediaType, dimensions: image.dimensions } };

    drafts.push({
      id: `${PHOTO_SOURCE}:${ref}`,
      title,
      evidence: [{ source: PHOTO_SOURCE, ref, observedAt: request.observedAt }],
      extractor,
      draftedAt: request.observedAt,
      review: { state: "candidate" },
      ...(mediaEntry === null ? {} : { media: [mediaEntry] }),
    });
  }

  if (issues.length > 0) {
    return { ok: false, cause: "unusable-observations", issues: Object.freeze(issues) };
  }

  // Round-trip: serialize what was built and let the HARVEST gate judge it, exactly as
  // `promoteApproved` submits to the leaf gate. The candidates returned are the gate's, so this
  // function cannot emit one the CLI would then refuse to write.
  const validated = parseHarvestDocument(JSON.parse(JSON.stringify({ candidates: drafts })));
  if (!validated.ok) {
    return { ok: false, cause: "round-trip-rejected", issues: validated.issues };
  }

  return {
    ok: true,
    candidates: validated.harvest.candidates,
    skipped: Object.freeze(skipped),
    undescribed: Object.freeze(undescribed),
    refusedRatingShapedDrafts: Object.freeze(refusedRatingShapedDrafts),
    refusedRatingShapedNames: Object.freeze(refusedRatingShapedNames),
    unmeasuredDimensions: Object.freeze(unmeasuredDimensions),
    transcriptions: Object.freeze(transcriptions),
  };
}
