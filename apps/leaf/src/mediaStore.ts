/**
 * A CONTENT-ADDRESSED MEDIA STORE for the bytes a leaflet's evidence names, and the metadata
 * stripper that stands between a phone photograph and a published page.
 *
 * The leaf document names digests; this holds bytes at those digests. Same discipline as git,
 * and the same reason `photoIntake.ts` gives for refusing to use a path as a ref: *paths change,
 * digests do not*. A store keyed by path would break the first time somebody tidied their
 * Pictures folder, and would break silently, which is worse.
 *
 * ── THE METADATA RULE, AND WHY IT IS NOT THE NO-SILENT-REWRITER RULE ────────────────────────
 *
 * This repository refuses to rewrite EVIDENCE. `photoIntake.ts` will not scrub a rating out of a
 * file NAME — it withholds the name and reports it verbatim — because editing an observation to
 * satisfy a rule about claims falsifies the observation.
 *
 * EXIF IS NOT THE EVIDENCE. It is metadata ATTACHED to the evidence by the camera. Removing the
 * GPS block does not change one pixel of what the photograph SHOWS, which is the entire content
 * of the claim a photo leaflet makes. Removing it from the file name would change what was
 * observed; removing it from an APP1 segment changes only what the file discloses about the
 * person who took it. The two rules point the same way: never falsify what the evidence says,
 * never publish what the subject did not mean to publish.
 *
 * The hazard is not hypothetical and it is not small. A phone photograph carries GPS
 * coordinates, a device serial, and often the owner's name in `Artist`. **A photograph of
 * somebody's workbench publishes their home address.** So the strip happens on the way IN — the
 * stored bytes are clean before anything can serve them — and it is REPORTED, never silent:
 * every object carries a manifest naming what was removed, in bytes, so an operator can see that
 * location data existed and is gone.
 *
 * ── sips CANNOT BE TRUSTED TO STRIP, AND THIS IS MEASURED ───────────────────────────────────
 *
 * `sips` is the only image tool on this machine (no PIL, no ImageMagick). It is NOT the
 * stripper. Measured 2026-08-19 against a JPEG carrying a real EXIF APP1 with a GPS IFD
 * (tags 0x0001–0x0004) and `Make`/`Model`/`Artist`:
 *
 *   sips -s format jpeg in.jpg --out out.jpg   →  GPS IFD SURVIVES (re-serialized big-endian,
 *                                                 plus a new APP13 Photoshop block)
 *   sips -Z 32        in.jpg --out out.jpg     →  GPS IFD SURVIVES
 *
 * A converted copy and a downscaled copy both still carry the coordinates. So the guarantee is
 * this file's own: JPEG, PNG and GIF are stripped by walking their containers and dropping the
 * metadata boxes EXACTLY — no re-encode, so the pixels are bit-identical to the original. `sips`
 * is used for one job only, as a DECODER for containers this file cannot rewrite safely (HEIF,
 * TIFF, WebP): it turns them into a JPEG, and then the JPEG stripper — not sips — makes the
 * guarantee. Its absence is a NAMED CAUSE and nothing is stored; unstripped bytes never pass.
 *
 * Every strip is VERIFIED after the fact by re-walking the output for metadata markers. If any
 * survived, the put fails with `metadata-survived` and nothing is written. Fail closed.
 *
 * ── TWO DIGESTS, AND SAYING WHICH ONE CHECKED ───────────────────────────────────────────────
 *
 * Stripping changes the file, so it changes its digest — and the ref in the leaflet names the
 * ORIGINAL file, because that is what `shasum -a 256 <path>` reproduces. Each object therefore
 * records both: the SOURCE digest (its address, and the ref) and the PUBLISHED digest (the clean
 * bytes actually served). `readMedia` hashes what it is about to send and refuses on mismatch —
 * `digest-mismatch`, deliberately a different cause from `not-in-store`, because a store that can
 * serve bytes which are not what its ref names is worse than no store: the ref makes it look
 * checkable.
 *
 * It also says WHICH digest did the checking, and that distinction is not decoration:
 *
 *   verifiedAgainst: "ref"       nothing was stripped, so published === source. The bytes are
 *                                checked end-to-end against the ref in the document itself, and
 *                                the manifest is not trusted for anything.
 *   verifiedAgainst: "manifest"  metadata was removed (or the container was transcoded), so the
 *                                served bytes are a DERIVED rendition. They are checked against
 *                                a digest recorded beside them, which catches truncation, a
 *                                partial write and bit rot — and does not, on its own, catch
 *                                somebody who can rewrite both files. Say so rather than imply
 *                                a guarantee that is not there.
 *
 * `node:crypto`, `node:fs`, `node:path` and `node:child_process` are built in, so the
 * zero-third-party-runtime-dependency claim is unaffected.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* ═════════════════════════════════════════════════════════════ where the store lives ════ */

/** Names a media store explicitly, for a self-hoster whose bytes do not belong beside the JSON. */
export const MEDIA_ENV = "FOLIAGE_MEDIA";

/** The leaf document's own variable, read here only to derive the default location beside it. */
const DOCUMENT_ENV = "FOLIAGE_LEAF";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where `apps/leaf` reads a leaf from when nothing says otherwise. Mirrors `leafDocument.ts`. */
const DEFAULT_DOCUMENT_PATH = resolve(APP_DIR, "leaf.json");

/**
 * The store that belongs to a given leaf document: `media/` beside it.
 *
 * BESIDE THE DOCUMENT, not inside the app, because the two are one artifact — a portfolio moved
 * to another machine without its photographs is a document full of refs that resolve to nothing.
 */
export function mediaRootFor(leafPath: string): string {
  return join(dirname(resolve(leafPath)), "media");
}

/**
 * The store this process should use, from the environment, by the same precedence the leaf
 * document itself uses. `FOLIAGE_MEDIA` wins; otherwise it is `media/` beside `FOLIAGE_LEAF`;
 * otherwise beside `besideDocument` — the default leaf unless the caller names the document it
 * is writing.
 *
 * A PHOTO HARVEST NAMES ITS HARVEST DOCUMENT HERE (QA #24). With neither variable set it used to
 * land beside the default leaf, inside the app — so `propose-photos --out <garden>/harvest.json`
 * put the candidates in the garden and the photographs in the checkout, and the garden's server
 * answered 404 for every one. A garden keeps its leaf, its harvest and `media/` side by side, so
 * the harvest being written is the best answer to "which garden" when nothing else says.
 */
export function mediaRootFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  besideDocument: string = DEFAULT_DOCUMENT_PATH,
): string {
  const configured = env[MEDIA_ENV];
  if (configured !== undefined && configured.trim() !== "") return resolve(configured.trim());
  const leaf = env[DOCUMENT_ENV];
  return mediaRootFor(leaf !== undefined && leaf.trim() !== "" ? leaf.trim() : besideDocument);
}

/**
 * THE STORE IGNORES ITSELF FROM GIT, and it writes that rule the first time it is created.
 *
 * `.gitignore` in this repository anchors the leaf document, the harvest and the policy by exact
 * path and by naming convention, because all three hold a real person's data. A directory of
 * their PHOTOGRAPHS is the same class of thing and cannot be covered by a name pattern — the
 * files are digests. So the store carries the rule inside it: a `.gitignore` holding `*`, written
 * at creation, which travels with the store wherever the operator points it and covers every
 * object without anyone having to remember.
 */
const STORE_GITIGNORE = `# A media store: one person's photographs, addressed by digest.\n*\n`;

/* ═══════════════════════════════════════════════════════════════════════ the ref ════════ */

/** The one algorithm this store speaks. Named in every ref so a ref can be re-checked by hand. */
const DIGEST_ALGORITHM = "sha256";

/** Lowercase hex SHA-256, full length. The same shape `photoIntake.ts` builds its refs from. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type RefParse =
  | { readonly ok: true; readonly ref: string; readonly digest: string }
  | { readonly ok: false; readonly detail: string };

/**
 * Read `sha256:<64 lowercase hex>` and nothing else.
 *
 * TOTAL AND NARROW, because the digest becomes a path segment. A ref that is not exactly this
 * shape never reaches the filesystem — there is no `..` in 64 hex characters, no separator, and
 * no case to fold. That is a stronger guarantee than any containment check on a path built from
 * a string the caller chose, which is the same argument the asset allow-map in `server.mjs`
 * makes.
 */
export function parseMediaRef(ref: string): RefParse {
  const trimmed = ref.trim();
  const marker = `${DIGEST_ALGORITHM}:`;
  if (!trimmed.startsWith(marker)) {
    return {
      ok: false,
      detail: `a media ref must begin "${marker}"; this one is ${JSON.stringify(trimmed.slice(0, 80))}.`,
    };
  }
  const digest = trimmed.slice(marker.length);
  if (!SHA256_HEX.test(digest)) {
    return {
      ok: false,
      detail:
        `"${digest.slice(0, 80)}" is not a lowercase hex SHA-256 of 64 characters, so it names ` +
        `nothing this store could hold.`,
    };
  }
  return { ok: true, ref: `${marker}${digest}`, digest };
}

/**
 * Where one object's directory is: `sha256/<first two>/<digest>/`.
 *
 * Two levels, git's fan-out, for git's reason: one flat directory of tens of thousands of entries
 * is slow to list on every filesystem that has ever shipped.
 */
export function mediaObjectDir(root: string, digest: string): string {
  return join(resolve(root), DIGEST_ALGORITHM, digest.slice(0, 2), digest);
}

/** The clean bytes. No extension: the container is a fact of the bytes, re-read on every serve. */
const OBJECT_FILE = "published";

/** What was removed, what was kept, and the digest of what is beside it. Written LAST. */
const MANIFEST_FILE = "manifest.json";

/* ══════════════════════════════════════════════════════ what the store can publish ══════ */

/**
 * The containers this store can strip EXACTLY, and therefore the only ones it will publish.
 *
 * Not a taste: each of these three is a flat sequence of length-delimited boxes, so metadata can
 * be dropped by copying the structural boxes and skipping the rest — no decode, no re-encode, the
 * pixel data byte-identical to the original. HEIF, TIFF and WebP hold their metadata inside the
 * structure a decoder needs (TIFF's IFDs *are* EXIF), and rewriting those safely is a different
 * project. They are transcoded to JPEG first and then stripped by the same exact code.
 */
export type PublishedFormat = "jpeg" | "png" | "gif";

const CONTENT_TYPES: Readonly<Record<PublishedFormat, string>> = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
});

/**
 * Which of the three published containers these bytes are, or null.
 *
 * Deliberately NARROWER than `imageFormatOf` in `photoSource.ts`, and deliberately not a call
 * into it: that function answers "is this file worth reading" over six formats, and this one
 * answers "did this store publish these bytes" over the three it can produce. Keeping them apart
 * is what stops a HEIF file appearing at a served address — a stored object that sniffs as
 * anything but these three is refused rather than sent.
 */
export function publishedFormatOf(head: Uint8Array): PublishedFormat | null {
  const at = (i: number): number => head[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return "png";
  }
  const ascii = String.fromCharCode(...[...head.slice(0, 6)].map((b) => (b >= 32 && b < 127 ? b : 0)));
  if (ascii === "GIF87a" || ascii === "GIF89a") return "gif";
  return null;
}

/**
 * Ceiling on any single object read whole into memory — to strip it, and to hash it before it is
 * served. Hashing before sending REQUIRES the whole object in hand: reading it once to hash and
 * again to send would leave a window in which the second read is not the thing that was checked,
 * which is precisely the guarantee this store exists to make. So the cost is a ceiling, named
 * rather than discovered as an out-of-memory crash at 3am.
 */
export const MAX_OBJECT_BYTES = 64 * 1024 * 1024;

/** Ceiling on one `sips` invocation. A transcode may fail; it may not hang. */
const SIPS_TIMEOUT_MS = 120_000;

/* ═════════════════════════════════════════════════════════════════ the strippers ════════ */

/** One box that was dropped, or kept, with its size. Reported so an absence is never a mystery. */
export interface StripRecord {
  /** The box, named the way the format's own specification names it. */
  readonly what: string;
  /** Its size in bytes, including the header, so "removed" is a measurement not an assertion. */
  readonly bytes: number;
}

export type StripMethod =
  | "jpeg-segments"
  | "png-chunks"
  | "gif-blocks"
  | "sips-transcode+jpeg-segments";

export interface StripReport {
  readonly method: StripMethod;
  readonly removed: readonly StripRecord[];
  /**
   * Metadata boxes KEPT ON PURPOSE, listed for exactly the same reason the removals are: an
   * operator has to be able to see what is still in the file. Only colour management survives —
   * see `KEPT_APP_SEGMENTS`.
   */
  readonly retained: readonly StripRecord[];
  /** Set when the container had to be decoded to something strippable first. */
  readonly transcodedFrom: string | null;
}

export type StripOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly report: StripReport }
  | {
      readonly ok: false;
      readonly cause: "unparseable-container" | "metadata-survived";
      readonly detail: string;
    };

/* ────────────────────────────────────────────────────────────────────────── JPEG ──────── */

/**
 * JPEG markers that are STRUCTURE and are copied through: frame headers, Huffman and quantization
 * tables, restart intervals, the scan itself. 0xC0–0xDF is that whole range and it is closed by
 * the specification, so the rule is stated as a range rather than as a list somebody will fail to
 * extend.
 *
 * Everything else — APP0…APP15 (0xE0–0xEF), the JPG extensions (0xF0–0xFD) and COM (0xFE) — is
 * metadata and is DROPPED BY DEFAULT. Default-deny, because the failure of an allow-list is a
 * file that renders slightly wrong and the failure of a deny-list is somebody's home address.
 */
function isStructuralJpegMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xdf;
}

/**
 * The two APP segments kept, both by their payload signature rather than by their marker number.
 *
 * `ICC_PROFILE` — an embedded colour profile. Dropping it is not neutral: a Display-P3 photograph
 * decoded as sRGB renders visibly over-saturated, which would make the published image show
 * something the original did not. A profile carries a human-readable description tag, so this is
 * the one place a name could survive; it is REPORTED as retained with its size for that reason.
 *
 * `Adobe` (APP14) — declares the colour transform. Dropping it makes CMYK and YCCK JPEGs decode
 * with inverted colours. It holds a version, a flags pair and a transform code: no text at all.
 *
 * Matched on the payload, not the marker, because APP2 also carries MPF — the multi-picture
 * container an iPhone uses to embed a second full image (the HDR gain map, the Live Photo still)
 * WITH ITS OWN EXIF. An allow-rule written as "keep APP2" would have kept that.
 */
const KEPT_APP_SEGMENTS: readonly { readonly marker: number; readonly signature: string; readonly what: string }[] =
  Object.freeze([
    { marker: 0xe2, signature: "ICC_PROFILE\0", what: "APP2 (ICC_PROFILE)" },
    { marker: 0xee, signature: "Adobe", what: "APP14 (Adobe colour transform)" },
  ]);

/** Markers that stand alone: no length, no payload. */
function isStandaloneJpegMarker(marker: number): boolean {
  return marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function jpegSegmentName(marker: number): string {
  if (marker >= 0xe0 && marker <= 0xef) return `APP${marker - 0xe0}`;
  if (marker === 0xfe) return "COM (comment)";
  return `marker 0x${marker.toString(16)}`;
}

/**
 * Copy a JPEG's structure and drop its metadata, without decoding a single pixel.
 *
 * WHY THE ENTROPY-CODED SCAN IS WALKED RATHER THAN COPIED TO THE END. The obvious shortcut — on
 * reaching SOS, copy the remainder verbatim — is wrong twice over: a progressive JPEG has several
 * scans with segments BETWEEN them, and some cameras append an APP1 after EOI, which the shortcut
 * would carry straight through. So the scan is walked byte by byte, honouring 0xFF00 stuffing and
 * the restart markers, until the next real marker. Everything after EOI is dropped and reported.
 *
 * Complexity: O(bytes), one pass, allocation proportional to what is kept.
 */
export function stripJpeg(input: Uint8Array): StripOutcome {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    return {
      ok: false,
      cause: "unparseable-container",
      detail: `these bytes do not begin with a JPEG SOI marker, so there is no structure to walk.`,
    };
  }
  const kept: Uint8Array[] = [Uint8Array.from([0xff, 0xd8])];
  const removed: StripRecord[] = [];
  const retained: StripRecord[] = [];
  let i = 2;

  while (i < input.length) {
    if (input[i] !== 0xff) {
      return {
        ok: false,
        cause: "unparseable-container",
        detail: `expected a marker at byte ${i} and found 0x${(input[i] ?? 0).toString(16)}.`,
      };
    }
    // A run of 0xFF is legal padding before a marker.
    let markerAt = i;
    while (markerAt < input.length && input[markerAt] === 0xff) markerAt++;
    const marker = input[markerAt];
    if (marker === undefined) {
      return { ok: false, cause: "unparseable-container", detail: `the file ends mid-marker.` };
    }
    if (marker === 0xd9) {
      kept.push(Uint8Array.from([0xff, 0xd9]));
      const trailing = input.length - (markerAt + 1);
      if (trailing > 0) {
        // Bytes after EOI are not part of the image and are exactly where an appended EXIF or a
        // vendor blob hides. Dropped, and named, because a silent truncation is indistinguishable
        // from a corrupt file.
        removed.push({ what: "bytes trailing after EOI", bytes: trailing });
      }
      return finishJpeg(kept, removed, retained);
    }
    if (isStandaloneJpegMarker(marker)) {
      kept.push(Uint8Array.from([0xff, marker]));
      i = markerAt + 1;
      continue;
    }
    if (markerAt + 3 > input.length) {
      return {
        ok: false,
        cause: "unparseable-container",
        detail: `segment 0x${marker.toString(16)} at byte ${markerAt} has no length field.`,
      };
    }
    const length = ((input[markerAt + 1] ?? 0) << 8) | (input[markerAt + 2] ?? 0);
    if (length < 2 || markerAt + 1 + length > input.length) {
      return {
        ok: false,
        cause: "unparseable-container",
        detail:
          `segment 0x${marker.toString(16)} at byte ${markerAt} declares ${length} bytes, which ` +
          `runs past the end of the file.`,
      };
    }
    const segmentStart = markerAt - 1;
    const payloadStart = markerAt + 3;
    const segmentEnd = markerAt + 1 + length;

    if (marker === 0xda) {
      // SOS: the header is structure, and the entropy-coded data that follows is the image.
      const scanEnd = endOfJpegScan(input, segmentEnd);
      kept.push(input.subarray(segmentStart, scanEnd));
      i = scanEnd;
      continue;
    }

    if (isStructuralJpegMarker(marker)) {
      kept.push(input.subarray(segmentStart, segmentEnd));
      i = segmentEnd;
      continue;
    }

    const keep = KEPT_APP_SEGMENTS.find(
      (candidate) =>
        candidate.marker === marker &&
        signatureMatches(input, payloadStart, segmentEnd, candidate.signature),
    );
    if (keep !== undefined) {
      retained.push({ what: keep.what, bytes: segmentEnd - segmentStart });
      kept.push(input.subarray(segmentStart, segmentEnd));
      i = segmentEnd;
      continue;
    }
    removed.push({
      what: `${jpegSegmentName(marker)}${describeJpegPayload(input, payloadStart, segmentEnd)}`,
      bytes: segmentEnd - segmentStart,
    });
    i = segmentEnd;
  }
  // No EOI. A truncated file still renders in most decoders, so it is published rather than
  // refused — but the absence is recorded as an observation, not smoothed over.
  removed.push({ what: "no EOI marker (the file ends inside the scan)", bytes: 0 });
  return finishJpeg(kept, removed, retained);
}

/** Does the segment payload begin with this signature? Read from the bytes, never from a name. */
function signatureMatches(
  input: Uint8Array,
  from: number,
  to: number,
  signature: string,
): boolean {
  if (to - from < signature.length) return false;
  for (let k = 0; k < signature.length; k++) {
    if (input[from + k] !== signature.charCodeAt(k)) return false;
  }
  return true;
}

/**
 * Name what a dropped segment actually held, from its own first bytes.
 *
 * "APP1" tells an operator nothing. "APP1 (Exif)" tells them their camera wrote metadata and it
 * is gone. The names come from the payload signature each specification fixes — the same anchor
 * as a magic number, and the same reason `gitIntake.ts` matches an armor header instead of git's
 * stderr.
 */
function describeJpegPayload(input: Uint8Array, from: number, to: number): string {
  const signatures: readonly [string, string][] = [
    ["Exif\0", "Exif"],
    ["http://ns.adobe.com/xap/1.0/\0", "XMP"],
    ["http://ns.adobe.com/xmp/extension/\0", "XMP extension"],
    ["Photoshop 3.0\0", "Photoshop/IPTC"],
    ["JFIF\0", "JFIF"],
    ["JFXX\0", "JFIF extension"],
    ["MPF\0", "MPF — an embedded second image"],
    ["ICC_PROFILE\0", "ICC_PROFILE"],
    ["FPXR\0", "FlashPix"],
  ];
  for (const [signature, name] of signatures) {
    if (signatureMatches(input, from, to, signature)) return ` (${name})`;
  }
  return "";
}

/**
 * Walk entropy-coded scan data to the next real marker.
 *
 * Inside a scan a literal 0xFF byte is written as 0xFF 0x00, and restart markers 0xD0–0xD7 are
 * interleaved. Anything else after an 0xFF ends the scan. This is the whole reason the scan can be
 * skipped over without decoding it.
 */
function endOfJpegScan(input: Uint8Array, from: number): number {
  let i = from;
  while (i < input.length) {
    if (input[i] !== 0xff) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < input.length && input[j] === 0xff) j++;
    const next = input[j];
    if (next === undefined) return input.length;
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      i = j + 1;
      continue;
    }
    return i;
  }
  return input.length;
}

function finishJpeg(
  kept: readonly Uint8Array[],
  removed: readonly StripRecord[],
  retained: readonly StripRecord[],
): StripOutcome {
  const bytes = concat(kept);
  const survivors = jpegMetadataSegments(bytes);
  const unexpected = survivors.filter(
    (name) => !retained.some((record) => record.what === name),
  );
  if (unexpected.length > 0) {
    return {
      ok: false,
      cause: "metadata-survived",
      detail:
        `the stripped JPEG still carries ${unexpected.join(", ")}. Nothing was stored: bytes ` +
        `this file cannot prove clean are not published.`,
    };
  }
  return {
    ok: true,
    bytes,
    report: {
      method: "jpeg-segments",
      removed: Object.freeze([...removed]),
      retained: Object.freeze([...retained]),
      transcodedFrom: null,
    },
  };
}

/**
 * Every metadata segment still present in a JPEG, named.
 *
 * The POST-CONDITION, exported because it is also the honest way to test the stripper: a test
 * that asserts "we removed APP1" is asserting our own bookkeeping, and a test that walks the
 * output and finds no APP1 is asserting the file.
 */
export function jpegMetadataSegments(input: Uint8Array): readonly string[] {
  const found: string[] = [];
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return ["(not a JPEG)"];
  let i = 2;
  while (i < input.length) {
    if (input[i] !== 0xff) return found;
    let markerAt = i;
    while (markerAt < input.length && input[markerAt] === 0xff) markerAt++;
    const marker = input[markerAt];
    if (marker === undefined || marker === 0xd9) return found;
    if (isStandaloneJpegMarker(marker)) {
      i = markerAt + 1;
      continue;
    }
    if (markerAt + 3 > input.length) return found;
    const length = ((input[markerAt + 1] ?? 0) << 8) | (input[markerAt + 2] ?? 0);
    const segmentEnd = markerAt + 1 + length;
    if (length < 2 || segmentEnd > input.length) return found;
    if (marker === 0xda) {
      i = endOfJpegScan(input, segmentEnd);
      continue;
    }
    if (!isStructuralJpegMarker(marker)) {
      const keep = KEPT_APP_SEGMENTS.find(
        (candidate) =>
          candidate.marker === marker &&
          signatureMatches(input, markerAt + 3, segmentEnd, candidate.signature),
      );
      found.push(
        keep !== undefined
          ? keep.what
          : `${jpegSegmentName(marker)}${describeJpegPayload(input, markerAt + 3, segmentEnd)}`,
      );
    }
    i = segmentEnd;
  }
  return found;
}

/* ─────────────────────────────────────────────────────────────────────────── PNG ──────── */

/**
 * PNG ancillary chunks kept: everything a decoder needs to render the image the way it was
 * authored, and nothing that holds text.
 *
 * Critical chunks (an uppercase first letter — IHDR, PLTE, IDAT, IEND) are kept unconditionally
 * because dropping one does not strip the file, it destroys it. Every OTHER ancillary chunk is
 * dropped, INCLUDING ones this list has never heard of: `tEXt`, `zTXt` and `iTXt` are where a
 * phone writes XMP, and an unknown lowercase chunk is exactly where the next one will.
 */
const KEPT_PNG_CHUNKS: ReadonlySet<string> = new Set([
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "bKGD",
  "pHYs",
  "hIST",
  "sPLT",
  "cICP",
  "mDCv",
  "cLLi",
  // APNG: the animation IS the image. Dropping these would publish a still of a moving file.
  "acTL",
  "fcTL",
  "fdAT",
]);

const PNG_CHUNK_MEANINGS: Readonly<Record<string, string>> = Object.freeze({
  tEXt: "tEXt (uncompressed text)",
  zTXt: "zTXt (compressed text)",
  iTXt: "iTXt (international text — where XMP lives)",
  eXIf: "eXIf (EXIF, including GPS)",
  tIME: "tIME (last-modified time)",
});

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Copy a PNG's chunks and drop the ones carrying text or EXIF.
 *
 * Chunks are copied VERBATIM, header and CRC together, so every CRC in the output is still the
 * one the encoder computed. Recomputing them would be a chance to get one wrong.
 */
export function stripPng(input: Uint8Array): StripOutcome {
  if (input.length < 8 || !PNG_SIGNATURE.every((byte, k) => input[k] === byte)) {
    return {
      ok: false,
      cause: "unparseable-container",
      detail: `these bytes do not begin with the PNG signature, so there is no chunk stream.`,
    };
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const kept: Uint8Array[] = [PNG_SIGNATURE];
  const removed: StripRecord[] = [];
  const retained: StripRecord[] = [];
  let i = 8;

  while (i + 8 <= input.length) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(
      input[i + 4] ?? 0,
      input[i + 5] ?? 0,
      input[i + 6] ?? 0,
      input[i + 7] ?? 0,
    );
    const end = i + 12 + length;
    if (end > input.length) {
      return {
        ok: false,
        cause: "unparseable-container",
        detail: `chunk "${type}" at byte ${i} declares ${length} bytes, past the end of the file.`,
      };
    }
    const critical = type.charCodeAt(0) >= 0x41 && type.charCodeAt(0) <= 0x5a;
    if (critical || KEPT_PNG_CHUNKS.has(type)) {
      if (type === "iCCP") retained.push({ what: "iCCP (ICC colour profile)", bytes: end - i });
      kept.push(input.subarray(i, end));
    } else {
      removed.push({ what: PNG_CHUNK_MEANINGS[type] ?? `${type} (ancillary)`, bytes: end - i });
    }
    i = end;
    if (type === "IEND") break;
  }
  if (i < input.length) {
    removed.push({ what: "bytes trailing after IEND", bytes: input.length - i });
  }
  const bytes = concat(kept);
  const survivors = pngMetadataChunks(bytes);
  if (survivors.length > 0) {
    return {
      ok: false,
      cause: "metadata-survived",
      detail: `the stripped PNG still carries ${survivors.join(", ")}. Nothing was stored.`,
    };
  }
  return {
    ok: true,
    bytes,
    report: {
      method: "png-chunks",
      removed: Object.freeze(removed),
      retained: Object.freeze(retained),
      transcodedFrom: null,
    },
  };
}

/** Every text-or-EXIF chunk still present. The post-condition, and the honest test. */
export function pngMetadataChunks(input: Uint8Array): readonly string[] {
  const found: string[] = [];
  if (input.length < 8) return found;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let i = 8;
  while (i + 8 <= input.length) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(
      input[i + 4] ?? 0,
      input[i + 5] ?? 0,
      input[i + 6] ?? 0,
      input[i + 7] ?? 0,
    );
    const critical = type.charCodeAt(0) >= 0x41 && type.charCodeAt(0) <= 0x5a;
    if (!critical && !KEPT_PNG_CHUNKS.has(type)) found.push(type);
    const end = i + 12 + length;
    if (end > input.length) return found;
    i = end;
    if (type === "IEND") return found;
  }
  return found;
}

/* ─────────────────────────────────────────────────────────────────────────── GIF ──────── */

/**
 * Copy a GIF's blocks and drop its comment, plain-text and application extensions.
 *
 * The one application extension kept is `NETSCAPE2.0`, which is a loop count and nothing else:
 * dropping it would turn a looping animation into a single-play one, changing what the published
 * file shows. XMP travels as an application extension too (`XMP DataXMP`), and it goes.
 */
export function stripGif(input: Uint8Array): StripOutcome {
  const header = String.fromCharCode(...[...input.subarray(0, 6)]);
  if (header !== "GIF87a" && header !== "GIF89a") {
    return {
      ok: false,
      cause: "unparseable-container",
      detail: `these bytes do not begin with a GIF header, so there is no block stream.`,
    };
  }
  if (input.length < 13) {
    return { ok: false, cause: "unparseable-container", detail: `the GIF ends inside its header.` };
  }
  const packed = input[10] ?? 0;
  let i = 13;
  if ((packed & 0x80) !== 0) i += 3 * (1 << ((packed & 0x07) + 1));
  if (i > input.length) {
    return {
      ok: false,
      cause: "unparseable-container",
      detail: `the GIF ends inside its global colour table.`,
    };
  }
  const kept: Uint8Array[] = [input.subarray(0, i)];
  const removed: StripRecord[] = [];

  /** Walk length-prefixed sub-blocks to the terminating zero. Returns the index past it. */
  const endOfSubBlocks = (from: number): number => {
    let k = from;
    while (k < input.length) {
      const size = input[k] ?? 0;
      if (size === 0) return k + 1;
      k += 1 + size;
    }
    return input.length;
  };

  while (i < input.length) {
    const introducer = input[i];
    if (introducer === 0x3b) {
      kept.push(Uint8Array.from([0x3b]));
      if (input.length > i + 1) {
        removed.push({ what: "bytes trailing after the GIF trailer", bytes: input.length - i - 1 });
      }
      break;
    }
    if (introducer === 0x21) {
      const label = input[i + 1] ?? 0;
      const end = endOfSubBlocks(i + 2);
      const keepGraphicControl = label === 0xf9;
      const keepNetscape =
        label === 0xff && signatureMatches(input, i + 3, input.length, "NETSCAPE2.0");
      if (keepGraphicControl || keepNetscape) {
        kept.push(input.subarray(i, end));
      } else {
        removed.push({ what: gifExtensionName(label), bytes: end - i });
      }
      i = end;
      continue;
    }
    if (introducer === 0x2c) {
      if (i + 10 > input.length) {
        return {
          ok: false,
          cause: "unparseable-container",
          detail: `the GIF ends inside an image descriptor at byte ${i}.`,
        };
      }
      const localPacked = input[i + 9] ?? 0;
      let dataAt = i + 10;
      if ((localPacked & 0x80) !== 0) dataAt += 3 * (1 << ((localPacked & 0x07) + 1));
      const end = endOfSubBlocks(dataAt + 1);
      kept.push(input.subarray(i, end));
      i = end;
      continue;
    }
    return {
      ok: false,
      cause: "unparseable-container",
      detail: `byte ${i} is 0x${(introducer ?? 0).toString(16)}, which introduces no GIF block.`,
    };
  }

  return {
    ok: true,
    bytes: concat(kept),
    report: {
      method: "gif-blocks",
      removed: Object.freeze(removed),
      retained: Object.freeze([]),
      transcodedFrom: null,
    },
  };
}

/**
 * Strip whichever of the three containers these bytes are, or say there is nothing this can do.
 *
 * Exported for the one caller outside the store: the model path in `photoSource.ts`, which sends
 * an image over loopback and has no business sending GPS coordinates with it. `null` means the
 * bytes are not one of the three — and a caller must then decide, out loud, whether to send
 * unstripped bytes at all. It is deliberately NOT a silent pass-through.
 */
export function stripKnownContainer(bytes: Uint8Array): StripOutcome | null {
  const format = publishedFormatOf(bytes);
  if (format === "jpeg") return stripJpeg(bytes);
  if (format === "png") return stripPng(bytes);
  if (format === "gif") return stripGif(bytes);
  return null;
}

function gifExtensionName(label: number): string {
  if (label === 0xfe) return "comment extension";
  if (label === 0x01) return "plain-text extension";
  if (label === 0xff) return "application extension (XMP travels here)";
  return `extension 0x${label.toString(16)}`;
}

/* ═══════════════════════════════════════════════════════════════════ the store API ══════ */

/** What a stored object records about itself. Written LAST, so a half-written object has none. */
export interface MediaManifest {
  /** The evidence ref — the digest of the file AS FOUND, which is what the leaf document names. */
  readonly ref: string;
  /** Digest of the bytes actually stored, which differ whenever anything was removed. */
  readonly publishedDigest: string;
  readonly publishedBytes: number;
  readonly publishedFormat: PublishedFormat;
  /** What the file was before anything was done to it. */
  readonly sourceFormat: string;
  readonly sourceBytes: number;
  /** ISO-8601 instant with an offset. */
  readonly storedAt: string;
  readonly strip: StripReport;
}

export type PutOutcome =
  | {
      readonly ok: true;
      readonly ref: string;
      /** `written` the first time; `already-present` when this exact object was already held. */
      readonly stored: "written" | "already-present";
      readonly manifest: MediaManifest;
      readonly dir: string;
    }
  | {
      readonly ok: false;
      /**
       * Every way this can fail, each with its own remedy — never one "could not store".
       *
       * `no-stripper` is the one that must never degrade into a pass-through: the container needs
       * `sips` to become something strippable and `sips` is not here, so NOTHING IS STORED. An
       * unstripped photograph in a store whose whole promise is that its bytes are clean would be
       * the worst outcome available.
       */
      readonly cause:
        | "unreadable-source"
        | "source-digest-mismatch"
        | "too-large"
        | "unsupported-container"
        | "no-stripper"
        | "transcode-failed"
        | "unparseable-container"
        | "metadata-survived"
        | "unwritable-store"
        | "occupied-by-a-different-object";
      readonly detail: string;
    };

export interface PutRequest {
  /** The store root. */
  readonly root: string;
  /** The file as found on the operator's machine. */
  readonly sourcePath: string;
  /** Lowercase hex SHA-256 the scan measured. RE-CHECKED here; see `source-digest-mismatch`. */
  readonly sourceDigest: string;
  /** What the scan's magic-byte read said it is. */
  readonly sourceFormat: string;
  /** Whether `sips` can be executed, so a caller that already probed does not probe again. */
  readonly sipsRuns: boolean;
}

/**
 * Put one image into the store, CLEAN.
 *
 * The order is the whole design: read → re-hash → strip → verify the strip → hash the result →
 * write the bytes → write the manifest. Nothing is written before the strip is proven, and the
 * manifest lands last so an interrupted put leaves an object that reads as incomplete rather than
 * as verified.
 *
 * THE SOURCE DIGEST IS RE-COMPUTED HERE and compared to the one the caller measured. That is not
 * belt-and-braces paranoia: a scan hashes a file and this reads it again some seconds later, and
 * in between an operator can save over it. Storing bytes at an address that no longer describes
 * them is the exact failure this store exists to make impossible, so it is checked at the one
 * moment both facts are in hand.
 *
 * Complexity: O(bytes), two passes over the file (hash, strip) plus one write.
 */
export async function putImage(request: PutRequest): Promise<PutOutcome> {
  let source: Buffer;
  try {
    const info = await stat(request.sourcePath);
    if (info.size > MAX_OBJECT_BYTES) {
      return {
        ok: false,
        cause: "too-large",
        detail:
          `${request.sourcePath} is ${info.size} bytes and the ceiling for an object read whole ` +
          `into memory is ${MAX_OBJECT_BYTES}. Nothing was stored. The ceiling exists because the ` +
          `bytes are hashed before they are served, which requires holding them.`,
      };
    }
    source = await readFile(request.sourcePath);
  } catch (err) {
    return {
      ok: false,
      cause: "unreadable-source",
      detail: `${request.sourcePath} could not be read: ${messageOf(err)} [${codeOf(err)}]`,
    };
  }

  const actualDigest = createHash("sha256").update(source).digest("hex");
  if (actualDigest !== request.sourceDigest) {
    return {
      ok: false,
      cause: "source-digest-mismatch",
      detail:
        `${request.sourcePath} hashed to ${actualDigest} now and ${request.sourceDigest} when it ` +
        `was scanned, so the file changed underneath. Nothing was stored — an object filed at a ` +
        `digest its bytes do not produce is worse than a missing one, because the ref makes it ` +
        `look checkable.`,
    };
  }

  const prepared = await prepareForStore(source, request);
  if (!prepared.ok) return prepared;

  const publishedDigest = createHash("sha256").update(prepared.bytes).digest("hex");
  const publishedFormat = publishedFormatOf(prepared.bytes);
  if (publishedFormat === null) {
    return {
      ok: false,
      cause: "metadata-survived",
      detail:
        `the stripped bytes are not a JPEG, PNG or GIF, so this store cannot say what it would ` +
        `be serving. Nothing was stored.`,
    };
  }

  const manifest: MediaManifest = {
    ref: `${DIGEST_ALGORITHM}:${request.sourceDigest}`,
    publishedDigest: `${DIGEST_ALGORITHM}:${publishedDigest}`,
    publishedBytes: prepared.bytes.byteLength,
    publishedFormat,
    sourceFormat: request.sourceFormat,
    sourceBytes: source.byteLength,
    storedAt: new Date().toISOString(),
    strip: prepared.report,
  };

  const dir = mediaObjectDir(request.root, request.sourceDigest);
  const existing = await readManifest(dir);
  if (existing.ok) {
    // ALREADY HELD. The object is content-addressed, so a second put of the same file is a no-op
    // — but only after checking that what is on disk is what its own manifest claims. A store
    // that skips a write because "the digest is there" and never looks at the bytes has stopped
    // being a checkable store.
    const held = await readObjectBytes(dir);
    if (held.ok && `${DIGEST_ALGORITHM}:${sha256(held.bytes)}` === existing.manifest.publishedDigest) {
      return { ok: true, ref: manifest.ref, stored: "already-present", manifest: existing.manifest, dir };
    }
    return {
      ok: false,
      cause: "occupied-by-a-different-object",
      detail:
        `${dir} already holds an object whose bytes do not match its own manifest ` +
        `(${existing.manifest.publishedDigest}). Nothing was written and nothing was repaired: ` +
        `silently overwriting it would erase the only evidence that something went wrong there. ` +
        `Delete that directory to re-store the file.`,
    };
  }

  try {
    await ensureStore(request.root);
    await mkdir(dir, { recursive: true });
    // BYTES FIRST, MANIFEST LAST, both through a rename so neither is ever seen half-written.
    // A crash between them leaves an object with no manifest, which `readMedia` reports as
    // `incomplete-object` and refuses — the safe direction.
    await writeThroughRename(join(dir, OBJECT_FILE), prepared.bytes);
    await writeThroughRename(
      join(dir, MANIFEST_FILE),
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    );
  } catch (err) {
    return {
      ok: false,
      cause: "unwritable-store",
      detail: `${dir} could not be written: ${messageOf(err)} [${codeOf(err)}]`,
    };
  }
  return { ok: true, ref: manifest.ref, stored: "written", manifest, dir };
}

type Prepared =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly report: StripReport }
  | Extract<PutOutcome, { ok: false }>;

/**
 * Get the file into a container this module can strip exactly, then strip it.
 *
 * `sips` appears here and NOWHERE ELSE in the strip path, as a decoder. Its output is not
 * trusted to be clean — measured, it is not: a format conversion carries the GPS IFD straight
 * through — so its JPEG goes through `stripJpeg` like any other.
 */
async function prepareForStore(source: Buffer, request: PutRequest): Promise<Prepared> {
  const direct: Record<string, (bytes: Uint8Array) => StripOutcome> = {
    jpeg: stripJpeg,
    png: stripPng,
    gif: stripGif,
  };
  const stripper = direct[request.sourceFormat];
  if (stripper !== undefined) return asPrepared(stripper(source));

  if (!["heif", "tiff", "webp"].includes(request.sourceFormat)) {
    return {
      ok: false,
      cause: "unsupported-container",
      detail:
        `${request.sourceFormat} is not a container this store knows how to strip or decode, so ` +
        `nothing was stored. Publishing it unstripped is the one option that is not available.`,
    };
  }
  if (!request.sipsRuns) {
    return {
      ok: false,
      cause: "no-stripper",
      detail:
        `${request.sourcePath} is ${request.sourceFormat}, whose metadata lives inside the ` +
        `structure a decoder needs, so it has to be decoded to JPEG before it can be stripped ` +
        `exactly — and sips, the only image decoder on this machine, could not be run. NOTHING ` +
        `WAS STORED. An iPhone photograph carries GPS coordinates and the owner's name; passing ` +
        `those bytes through unstripped because the tool was missing would publish somebody's ` +
        `home address.`,
    };
  }

  let scratch: string;
  try {
    scratch = await mkdtemp(join(tmpdir(), "foliage-media-"));
  } catch (err) {
    return {
      ok: false,
      cause: "transcode-failed",
      detail: `no scratch directory could be made to decode into: ${messageOf(err)}`,
    };
  }
  try {
    const out = join(scratch, "decoded.jpg");
    const converted = await runSips(["-s", "format", "jpeg", request.sourcePath, "--out", out]);
    if (!converted.ok) {
      return {
        ok: false,
        cause: "transcode-failed",
        detail:
          `sips could not decode ${request.sourcePath} to JPEG: ${converted.detail}. Nothing was ` +
          `stored.`,
      };
    }
    let decoded: Buffer;
    try {
      decoded = await readFile(out);
    } catch (err) {
      return {
        ok: false,
        cause: "transcode-failed",
        detail: `sips reported success but wrote nothing readable: ${messageOf(err)}`,
      };
    }
    const stripped = asPrepared(stripJpeg(decoded));
    if (!stripped.ok) return stripped;
    return {
      ok: true,
      bytes: stripped.bytes,
      report: {
        method: "sips-transcode+jpeg-segments",
        removed: stripped.report.removed,
        retained: stripped.report.retained,
        transcodedFrom: request.sourceFormat,
      },
    };
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

function asPrepared(outcome: StripOutcome): Prepared {
  if (outcome.ok) return outcome;
  return { ok: false, cause: outcome.cause, detail: outcome.detail };
}

/* ═══════════════════════════════════════════════════════════════════════ reading ════════ */

export type MediaRead =
  | {
      readonly ok: true;
      readonly ref: string;
      readonly bytes: Buffer;
      readonly contentType: string;
      readonly format: PublishedFormat;
      readonly manifest: MediaManifest;
      /**
       * WHICH digest proved these bytes. `"ref"` when nothing was stripped, so the check runs
       * against the digest the leaf document itself names; `"manifest"` when the served bytes are
       * a derived rendition and the digest that checks them lives beside them. See the header.
       */
      readonly verifiedAgainst: "ref" | "manifest";
    }
  | {
      readonly ok: false;
      /**
       * `digest-mismatch` IS NOT `not-in-store`, and separating them is the point of the route.
       * "There is nothing here" is an ordinary answer. "There is something here and it is not
       * what the ref names" is a corrupted store, and a store that answers both with 404 has
       * quietly stopped being checkable while still looking like it is.
       */
      readonly cause:
        | "malformed-ref"
        | "not-in-store"
        | "incomplete-object"
        | "unreadable-object"
        | "too-large"
        | "digest-mismatch"
        | "not-an-image";
      readonly detail: string;
    };

/**
 * Read one object and PROVE it before handing it back.
 *
 * The bytes are hashed here, in this call, against the digest recorded for them — not on the way
 * in, not last Tuesday. A caller that streamed the file to a socket and hashed it separately
 * would be checking one read and sending another.
 */
export async function readMedia(root: string, ref: string): Promise<MediaRead> {
  const parsed = parseMediaRef(ref);
  if (!parsed.ok) return { ok: false, cause: "malformed-ref", detail: parsed.detail };

  const dir = mediaObjectDir(root, parsed.digest);
  const manifest = await readManifest(dir);
  if (!manifest.ok) {
    return manifest.cause === "absent"
      ? { ok: false, cause: "not-in-store", detail: `${parsed.ref} is not held at ${root}.` }
      : { ok: false, cause: manifest.cause, detail: manifest.detail };
  }

  const held = await readObjectBytes(dir);
  if (!held.ok) return { ok: false, cause: held.cause, detail: held.detail };

  const actual = `${DIGEST_ALGORITHM}:${sha256(held.bytes)}`;
  if (actual !== manifest.manifest.publishedDigest) {
    return {
      ok: false,
      cause: "digest-mismatch",
      // The fact, the consequence, the remedy — and no more. WHY this is not a 404 is a design
      // decision and it lives in the header and in `serveMedia`, not in front of an operator
      // whose store is broken right now.
      detail:
        `the object stored for ${parsed.ref} hashes to ${actual}, and its manifest records ` +
        `${manifest.manifest.publishedDigest}. NOTHING WAS SERVED — these bytes are not what ` +
        `that ref names. Delete ${dir} and re-run the scan that stored it.`,
    };
  }

  const format = publishedFormatOf(held.bytes);
  if (format === null || format !== manifest.manifest.publishedFormat) {
    return {
      ok: false,
      cause: "not-an-image",
      detail:
        `the object stored for ${parsed.ref} does not begin like the ` +
        `${manifest.manifest.publishedFormat} its manifest names (its magic bytes say ` +
        `${format ?? "nothing this store publishes"}). Nothing was served.`,
    };
  }

  return {
    ok: true,
    ref: parsed.ref,
    bytes: held.bytes,
    contentType: CONTENT_TYPES[format],
    format,
    manifest: manifest.manifest,
    verifiedAgainst: manifest.manifest.publishedDigest === manifest.manifest.ref ? "ref" : "manifest",
  };
}

/** One line about the whole store, for a startup banner. Counts, never a guess. */
export interface StoreSummary {
  readonly root: string;
  readonly objects: number;
  /** Objects whose manifest records at least one removed box. */
  readonly withMetadataRemoved: number;
  /** Total bytes of metadata removed across the store. A measurement, not an estimate. */
  readonly metadataBytesRemoved: number;
  /** Object directories that hold no readable manifest — half-written, and refused on read. */
  readonly incomplete: number;
  /** Why the store could not be summarized at all. Null when it could. */
  readonly unreadable: string | null;
}

/**
 * Walk the store and say what is in it.
 *
 * WHY THIS EXISTS AT ALL: stripping somebody's GPS coordinates and saying nothing would be a
 * silent rewrite, which is the thing this repository refuses everywhere else. The manifest beside
 * each object is the record; this is the one-line reading of it that a server can print at
 * startup, so an operator learns that location data existed and is gone without opening a file.
 */
export async function summarizeStore(root: string): Promise<StoreSummary> {
  const empty = {
    root,
    objects: 0,
    withMetadataRemoved: 0,
    metadataBytesRemoved: 0,
    incomplete: 0,
  };
  let shards: string[];
  try {
    shards = await readdir(join(resolve(root), DIGEST_ALGORITHM));
  } catch (err) {
    return codeOf(err) === "ENOENT"
      ? { ...empty, unreadable: null }
      : { ...empty, unreadable: `${root} could not be listed: ${messageOf(err)} [${codeOf(err)}]` };
  }
  let objects = 0;
  let withMetadataRemoved = 0;
  let metadataBytesRemoved = 0;
  let incomplete = 0;
  for (const shard of shards) {
    let digests: string[];
    try {
      digests = await readdir(join(resolve(root), DIGEST_ALGORITHM, shard));
    } catch {
      continue;
    }
    for (const digest of digests) {
      const manifest = await readManifest(join(resolve(root), DIGEST_ALGORITHM, shard, digest));
      if (!manifest.ok) {
        incomplete++;
        continue;
      }
      objects++;
      const removed = manifest.manifest.strip.removed;
      if (removed.length > 0) {
        withMetadataRemoved++;
        for (const record of removed) metadataBytesRemoved += record.bytes;
      }
    }
  }
  return { root, objects, withMetadataRemoved, metadataBytesRemoved, incomplete, unreadable: null };
}

/* ══════════════════════════════════════════════════════════════════════ mechanics ═══════ */

type ManifestRead =
  | { readonly ok: true; readonly manifest: MediaManifest }
  | {
      readonly ok: false;
      readonly cause: "absent" | "incomplete-object" | "unreadable-object";
      readonly detail: string;
    };

/**
 * Read and CHECK a manifest, rather than trusting `JSON.parse` to have produced the right shape.
 *
 * A manifest that is JSON but not a manifest is `incomplete-object`, not `absent`: the first
 * means something went wrong here and the operator has to act, the second means there is simply
 * nothing at this address. Collapsing them would be the error masking this repository keeps
 * paying for.
 */
async function readManifest(dir: string): Promise<ManifestRead> {
  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST_FILE), "utf8");
  } catch (err) {
    const code = codeOf(err);
    if (code === "ENOENT") return { ok: false, cause: "absent", detail: `no manifest in ${dir}.` };
    return {
      ok: false,
      cause: "unreadable-object",
      detail: `${join(dir, MANIFEST_FILE)} could not be read: ${messageOf(err)} [${code}]`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      cause: "incomplete-object",
      detail: `${join(dir, MANIFEST_FILE)} is not valid JSON: ${messageOf(err)}`,
    };
  }
  const manifest = asManifest(json);
  if (manifest === null) {
    return {
      ok: false,
      cause: "incomplete-object",
      detail:
        `${join(dir, MANIFEST_FILE)} is JSON but is not a media manifest — it does not carry a ` +
        `ref, a published digest, a size and a format. The object beside it cannot be verified, ` +
        `so it is not served.`,
    };
  }
  return { ok: true, manifest };
}

function asManifest(value: unknown): MediaManifest | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const str = (key: string): string | null => {
    const v = rec[key];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  const num = (key: string): number | null => {
    const v = rec[key];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const ref = str("ref");
  const publishedDigest = str("publishedDigest");
  const publishedFormat = str("publishedFormat");
  const sourceFormat = str("sourceFormat");
  const storedAt = str("storedAt");
  const publishedBytes = num("publishedBytes");
  const sourceBytes = num("sourceBytes");
  if (
    ref === null ||
    publishedDigest === null ||
    publishedFormat === null ||
    sourceFormat === null ||
    storedAt === null ||
    publishedBytes === null ||
    sourceBytes === null
  ) {
    return null;
  }
  if (publishedFormat !== "jpeg" && publishedFormat !== "png" && publishedFormat !== "gif") {
    return null;
  }
  const strip = rec["strip"];
  if (strip === null || typeof strip !== "object" || Array.isArray(strip)) return null;
  const stripRec = strip as Record<string, unknown>;
  const records = (key: string): readonly StripRecord[] => {
    const list = stripRec[key];
    if (!Array.isArray(list)) return [];
    const out: StripRecord[] = [];
    for (const entry of list) {
      if (entry === null || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e["what"] === "string" && typeof e["bytes"] === "number") {
        out.push({ what: e["what"], bytes: e["bytes"] });
      }
    }
    return Object.freeze(out);
  };
  const method = stripRec["method"];
  const transcodedFrom = stripRec["transcodedFrom"];
  return {
    ref,
    publishedDigest,
    publishedBytes,
    publishedFormat,
    sourceFormat,
    sourceBytes,
    storedAt,
    strip: {
      method: (typeof method === "string" ? method : "jpeg-segments") as StripMethod,
      removed: records("removed"),
      retained: records("retained"),
      transcodedFrom: typeof transcodedFrom === "string" ? transcodedFrom : null,
    },
  };
}

async function readObjectBytes(
  dir: string,
): Promise<
  | { readonly ok: true; readonly bytes: Buffer }
  | {
      readonly ok: false;
      readonly cause: "incomplete-object" | "unreadable-object" | "too-large";
      readonly detail: string;
    }
> {
  const path = join(dir, OBJECT_FILE);
  try {
    const info = await stat(path);
    if (info.size > MAX_OBJECT_BYTES) {
      return {
        ok: false,
        cause: "too-large",
        detail:
          `${path} is ${info.size} bytes; the ceiling for an object held in memory to be hashed ` +
          `before it is served is ${MAX_OBJECT_BYTES}. Nothing was served.`,
      };
    }
    return { ok: true, bytes: await readFile(path) };
  } catch (err) {
    const code = codeOf(err);
    return code === "ENOENT"
      ? {
          ok: false,
          cause: "incomplete-object",
          detail:
            `${dir} holds a manifest and no bytes. A put was interrupted between writing the ` +
            `object and writing its manifest, or the object was deleted by hand.`,
        }
      : {
          ok: false,
          cause: "unreadable-object",
          detail: `${path} could not be read: ${messageOf(err)} [${code}]`,
        };
  }
}

/** Create the store and the ignore rule that keeps its contents out of any repository. */
async function ensureStore(root: string): Promise<void> {
  const dir = resolve(root);
  await mkdir(dir, { recursive: true });
  // `wx` — written once, never overwritten. An operator who edited it meant to.
  await writeFile(join(dir, ".gitignore"), STORE_GITIGNORE, { encoding: "utf8", flag: "wx" }).catch(
    () => undefined,
  );
}

/** Write through a temp file and a rename, so a reader never sees a half-written object. */
let writeSequence = 0;
async function writeThroughRename(path: string, bytes: Uint8Array): Promise<void> {
  writeSequence += 1;
  const temp = `${path}.tmp-${process.pid}-${writeSequence}`;
  await writeFile(temp, bytes, { flag: "wx" });
  await rename(temp, path);
}

function runSips(args: readonly string[]): Promise<{ ok: boolean; detail: string }> {
  return new Promise((done) => {
    execFile("sips", [...args], { timeout: SIPS_TIMEOUT_MS, encoding: "utf8" }, (err, _out, errText) => {
      if (err === null) {
        done({ ok: true, detail: "" });
        return;
      }
      done({ ok: false, detail: `${messageOf(err)} [${codeOf(err)}] ${String(errText).trim()}`.trim() });
    });
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function codeOf(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) return String(err.code);
  return "UNKNOWN";
}
