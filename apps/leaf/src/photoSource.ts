/**
 * Reading real image files out of a real directory, and — only when asked — showing one to a
 * local model.
 *
 * The I/O half of the photograph light source. Everything here is measurement: walk a directory
 * the operator named, decide what is an image by looking at its BYTES, hash it, ask the machine
 * how big it is, and (optionally) hand a downscaled copy to a model on loopback. What any of
 * that MEANS about proof is not decided here — that is `photosToCandidates` in
 * @foliage/photosynthesis, for the same reason the tiering rule is not in `gitIntake.ts`.
 *
 * THE RULES THIS FILE ENFORCES, all three of them the same rule wearing different clothes:
 *
 *   A FAILED READ IS NEVER A ZERO. `readImages` returns a discriminated union naming which of
 *   three things went wrong, and a successful scan still carries `notRead` — every entry the
 *   walk declined to read, with its cause. "I found 3 images" must never be able to mean "I
 *   found 3 of 40 and could not open the rest", which is the same undercount as `commitCount: 0`
 *   with a nicer number on it. Each entry carries a `NotReadCause` and not only prose, because
 *   the caller has to act on two different situations differently — the walk DECLINING by its
 *   own rule (a symlink, the depth cap) is a fact to print, and the machine REFUSING (EACCES, a
 *   file that vanished mid-scan) is a failed read that must stop the command before it writes.
 *   A caller sorting those by matching the detail string would be matching prose, which is the
 *   mistake `gitIntake.ts` refuses when it reads commit objects instead of git's stderr.
 *
 *   ZERO BYTES IS ITS OWN ANSWER. A file with no bytes is not "not an image by its bytes" — that
 *   sentence claims bytes were examined. It is counted and named separately (`emptyFiles`), so a
 *   report can never imply a 0-byte file was read and found to be prose.
 *
 *   THE BYTES ARE CAPTURED WHILE THE FILE IS STILL THERE, AND THEY ARE CAPTURED CLEAN. A scan
 *   measures a digest and a candidate carries it as a ref — and a ref whose bytes cannot be
 *   produced later is a promise, not evidence. The operator's Pictures folder is not a store:
 *   files there get renamed, moved and deleted, which is the whole reason `photoIntake.ts`
 *   refuses to use a path as a ref. So this is the moment the artifact becomes durable, and it is
 *   the only moment it can be — by promotion time the leaflet holds the digest and nothing knows
 *   where the file was. `mediaStore.ts` strips the metadata on the way in (measured: `sips`
 *   carries a GPS IFD through both a format conversion AND a downscale, so the strip is that
 *   module's own), and every put comes back as a named outcome per image rather than as silence.
 *
 *   AN ABSENT TOOL IS A NAMED CAUSE, NOT A CRASH AND NOT A GUESS. `sips` is macOS-only. It is
 *   the only image pipeline on the machine this was built on — no PIL, no ImageMagick — so it
 *   is used where it exists and its absence travels as `dimensions: { known: false, why }`
 *   through to the report. Nothing here requires it; nothing here invents a size without it.
 *
 *   THE MODEL PATH IS LOOPBACK ONLY AND FAILS CLOSED, THROUGH ONE SHARED GUARD. The open plane's
 *   privacy claim is zero network calls to anything but 127.0.0.1, and it is now enforced in
 *   exactly one place — `loopbackFetch.ts` — which owns both the host check and the `fetch`.
 *   This file used to write the rule out itself, as did `brainSource.ts` and
 *   `draftTitleWithLocalModel` in harvest.mjs: three copies, agreeing on the day they were
 *   written, each passing its own tests while a later edit strengthened one and left two.
 *
 *   `redirected` IS ITS OWN CAUSE, DISTINCT FROM `unreachable`. Checking the hostname and then
 *   calling `fetch` without `redirect: "manual"` left a real hole, reproduced with two live
 *   servers: a 307 PRESERVES METHOD AND BODY, so an endpoint answering on the trusted port could
 *   name any host and undici would carry the request — here, an operator's photograph, base64 in
 *   the body — to it. The claim and the effect were derived from DIFFERENT VALUES: the loopback
 *   claim came from the configured url, the effect happened on the socket actually opened. The
 *   two causes stay apart because the remedies are opposite: something is redirecting a port you
 *   trust, versus the model is down.
 *
 *   Every failure — not-loopback, redirected, unreachable, timed out, non-200, unparseable, a
 *   body that is not the shape that was asked for — is a named cause the caller must handle, and
 *   the caller's answer is to write nothing. A drafted title silently substituted for a model
 *   that never ran is worse than no title.
 *
 * WHY EVERY FIELD OF THE MODEL'S SCHEMA IS NULLABLE, and it is the most important line in this
 * file. Ollama's `format` is GRAMMAR-ENFORCED: the decoder physically cannot emit a token
 * outside the schema — measured, by instructing it to leave an enum and watching it fail to.
 * That is a guarantee about SHAPE, and it becomes a hazard the moment a required field's answer
 * is not in the image: the only way to satisfy the grammar is then to invent one. So the schema
 * asks for `["string", "null"]` everywhere, the prompt says null is the right answer when the
 * image does not show it, and a null arrives here as a null and leaves as an absence.
 *
 * `node:crypto`, `node:fs`, `node:child_process` and `fetch` are all built in, so the
 * zero-third-party-runtime-dependency claim is unaffected.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import type { MediaType } from "@foliage/leaf";
import type { DraftedDescription, ObservedImage, PublishedMedia } from "@foliage/photosynthesis";

import { loopbackFetch, loopbackHostOf, type LoopbackFailure } from "./loopbackFetch.ts";
import {
  mediaRootFromEnv,
  putImage,
  stripKnownContainer,
  type PublishedFormat,
  type PutOutcome,
} from "./mediaStore.ts";

/**
 * Formats identified by their MAGIC BYTES, never by their extension. A `.png` suffix is a
 * claim the file makes about itself; the operator's directory is full of files they did not
 * name, and a screenshot saved as `.txt` is still a screenshot. Reading the first bytes is
 * cheap, total, and cannot be talked out of the truth.
 */
export type ImageFormat = "jpeg" | "png" | "gif" | "heif" | "tiff" | "webp";

/** Enough bytes for every signature below, including the ISO-BMFF brand at offset 8. */
const HEAD_BYTES = 32;

/**
 * ISO base media file format brands that mean "this box holds still images" — HEIC, HEIF and
 * AVIF, which is what an iPhone photograph and a macOS wallpaper actually are. `ftyp` sits at
 * offset 4 and the major brand at offset 8; both are fixed by the container format.
 */
const HEIF_BRANDS: ReadonlySet<string> = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);

/** How deep the walk descends. A cap rather than an assumption: exceeding it is REPORTED. */
const MAX_DEPTH = 8;

/** Ceiling on any single `sips` invocation. A measurement may fail; it may not hang. */
const SIPS_TIMEOUT_MS = 60_000;

/**
 * Longest edge of the copy handed to the model.
 *
 * MEASURED on this machine, not chosen for taste: gemma4:12b's image tokens SATURATE at 284 —
 * 1536px and 3840px produce identical token counts and identical prompt-eval times, so past
 * this size you pay base64 transfer for exactly zero fidelity. Below it there is real loss:
 * 384px made the model miscount objects in a photograph; 768px was the smallest size that got
 * the same answer as the full-size image. 1536 is the top of the flat part of that curve.
 */
const MAX_EDGE_PX = 1536;

/** The local model endpoint. LOOPBACK ONLY — enforced by `loopbackFetch`, never by this line. */
const DEFAULT_ENDPOINT = "http://127.0.0.1:11434/api/generate";

/**
 * The model asked to look at an image. Exported so the CLI's usage text names the same model
 * this file will actually call — a help string that has drifted from the code is a lie with a
 * long half-life, and one constant cannot drift from itself.
 */
export const LOCAL_DESCRIBER_MODEL = "gemma4:12b";

/**
 * Per-request ceiling, the same 180s as `draftTitleWithLocalModel` and for the same measured
 * reason: a request to this model took 39.2s wall on the one machine it has run on, and a
 * ceiling set just above a measurement fails closed the first time the machine is busy. Safe
 * only because the failure is loud — nothing is written and the cause is printed.
 */
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * The JSON Schema handed to ollama's `format`. EVERY FIELD IS NULLABLE — see the header. There
 * is no field here that could hold a rating, a confidence or a count that reads like one, and
 * there never will be: the schema is part of the product's posture, not a serialization detail.
 */
const DESCRIBE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    summary: { type: ["string", "null"] },
    visibleText: { type: ["string", "null"] },
  },
  required: ["summary", "visibleText"],
  additionalProperties: false,
});

/**
 * Ceiling on the model's OUTPUT, in tokens, sent explicitly rather than left to the server.
 *
 * MEASURED, and it is the reason this constant is here at all: with no `num_predict` in the
 * request, a real run over a 3840×2160 screenshot was cut off at 128 tokens MID-STRING — the
 * grammar never got to close the JSON object, so the answer was unparseable and the command
 * failed closed with nothing written. The server's default is a number this code did not choose
 * and cannot see; naming it here is the same discipline as reading the commit object instead of
 * trusting `%G?`. 400 tokens is comfortably more than the bounded answer the prompt asks for,
 * and an answer that still overruns it is REPORTED as an overrun rather than as a mystery.
 */
const MAX_ANSWER_TOKENS = 400;

/**
 * The instruction. It asks for what the image SHOWS and it makes declining the correct answer
 * rather than a failure — the grammar permits null, and the prompt has to say that null is
 * wanted, or a model trained to be helpful will fill the field anyway.
 *
 * `visibleText` is deliberately asked for as a SHORT QUOTE and not a transcription. Two reasons,
 * both measured: a text-dense screenshot sends this model into a page-long dump of increasingly
 * garbled characters that runs past any output ceiling, and its transcriptions are wrong in
 * exactly the way that matters — it invented "CANOPY IS A COLLECTION OF" for a headline clipped
 * at the crop edge, and read "01 — TARDING" for "01 · TAXONOMY". A short quote is a lead for the
 * operator, which is all this field is ever allowed to be; whole-page OCR wants a deterministic
 * reader, not a language model.
 */
const DESCRIBE_PROMPT =
  `Look at this image and answer about THIS IMAGE ONLY.\n` +
  `- summary: one short factual line describing what the image shows. No praise, no ratings, ` +
  `no numbers that read like a score. If you cannot tell what it shows, answer null.\n` +
  `- visibleText: at most one short line quoting the single most prominent piece of text, ` +
  `copied exactly, and only if it is large and completely legible. If text is cut off, ` +
  `blurred, small, dense, or you are unsure of one character, answer null. Never transcribe a ` +
  `page.\n` +
  `Answering null is correct and expected. Do not guess, and do not describe what is probably ` +
  `there.`;

/** What this machine is equipped to do with an image file, and why not when it cannot. */
export interface ImageToolchain {
  /** Whether `sips` could be executed here at all. macOS-only, and never required. */
  readonly sipsRuns: boolean;
  /** Why it did not run. Null when it did — a different fact from "unknown". */
  readonly sipsUnavailable: string | null;
}

/**
 * One image file as this scan measured it: everything `ObservedImage` needs except the
 * description, which is a separate act, plus the format the magic bytes named.
 */
export interface ScannedImage extends Omit<ObservedImage, "description"> {
  readonly format: ImageFormat;
  /**
   * What happened when these bytes were put into the media store, or null when no store was
   * configured for this scan.
   *
   * NOT COLLAPSED TO A BOOLEAN, and not folded into `notRead`: the file WAS read — it is measured
   * and it will become a candidate either way — and the store is a separate act that can fail for
   * its own reasons (an absent decoder, a full disk, an object already there under different
   * bytes). A caller that wants to know whether a promoted leaflet will be able to show its
   * photograph reads this; a caller that wants to know what the directory holds does not.
   */
  readonly stored: PutOutcome | null;
}

/**
 * Why one entry was not read.
 *
 * The first three are the WALK DECLINING by a rule stated in this file: they are decisions, they
 * are not failures, and a scan that hits one is still a complete answer about what it agreed to
 * look at. The last two are the MACHINE REFUSING — the file or the directory is there and could
 * not be read — which means the scan's counts are an undercount of the directory, and a caller
 * that writes a document from one is writing the `commitCount: 0` bug.
 */
export type NotReadCause =
  | "symbolic-link"
  | "depth-cap"
  | "not-a-regular-file"
  | "directory-unreadable"
  | "file-unreadable";

/** One entry the walk did not read, and exactly why. Never a silent omission. */
export interface NotReadEntry {
  readonly path: string;
  readonly cause: NotReadCause;
  readonly detail: string;
}

/** The causes above where the machine refused, kept in one place so no caller re-derives it. */
const READ_FAILURES: ReadonlySet<NotReadCause> = new Set<NotReadCause>([
  "directory-unreadable",
  "file-unreadable",
]);

/**
 * Did the MACHINE refuse this entry, or did the walk decline it by rule?
 *
 * Exported because the CLI's decision to write or not turns on exactly this question, and the
 * answer belongs beside the causes rather than in a caller's copy of the list.
 */
export function isReadFailure(entry: NotReadEntry): boolean {
  return READ_FAILURES.has(entry.cause);
}

export type ImageScan =
  | {
      readonly ok: true;
      /** The directory as it was resolved. */
      readonly dir: string;
      readonly images: readonly ScannedImage[];
      /** Every file the walk looked at, images and not. */
      readonly filesSeen: number;
      /**
       * Files that were read whole and whose bytes are not one of the formats above. Not an
       * error; a fact — and a claim ABOUT BYTES, which is why zero-byte files are not counted
       * here.
       */
      readonly nonImageFiles: number;
      /**
       * Files of zero length, by path. There is nothing in them to identify, so calling one
       * "not an image by its bytes" would assert a reading of bytes that do not exist.
       *
       * `filesSeen` = `images` + `nonImageFiles` + `emptyFiles` + the file-level entries of
       * `notRead`. Every file the walk collected is in exactly one of those four.
       */
      readonly emptyFiles: readonly string[];
      readonly notRead: readonly NotReadEntry[];
      readonly toolchain: ImageToolchain;
      /** The media store these bytes were put into, or null when the scan was told not to. */
      readonly storeRoot: string | null;
    }
  | {
      readonly ok: false;
      readonly cause: "no-such-path" | "not-a-directory" | "unreadable-directory";
      readonly detail: string;
      readonly path: string;
    };

export type DescribeOutcome =
  | {
      readonly ok: true;
      readonly description: DraftedDescription;
      /** Whether the model saw a downscaled copy or the original bytes. */
      readonly prepared: "downscaled" | "original";
      /** How many bytes were actually sent, so the operator can see the transfer they paid. */
      readonly sentBytes: number;
    }
  | {
      readonly ok: false;
      /**
       * `timed-out` is SEPARATE FROM `unreachable`, and it is separate for the same reason
       * `done_reason: "length"` is separate from a grammar violation below: the remedies differ
       * and the operator cannot tell them apart from the text.
       *
       * MEASURED, against the ollama actually running on this machine: `describeImage(img,
       * {timeoutMs: 1500})` produced `cause: "unreachable"` with the detail "could not be
       * reached: The operation was aborted due to timeout" — the same discriminant a dead port
       * produces. But a dead port means START THE MODEL, and a ceiling reached by a model that
       * is running and answering means the machine is busy or the image is large: RAISE THE
       * CEILING. One says the server is absent when it was present the whole time.
       *
       * `redirected` is separate from BOTH, and it is the one that is not about the model at
       * all: the endpoint answered a 3xx, so something on the port this operator trusts tried to
       * move their photograph elsewhere. It was not followed and the named host received
       * nothing. Reported as `unreachable` it would read as "start ollama" — the one action that
       * does not address it.
       */
      readonly cause:
        | "not-loopback"
        | "redirected"
        | "unreadable-file"
        | "unreachable"
        | "timed-out"
        | "http-error"
        | "unparseable";
      readonly detail: string;
    };

export interface DescribeOptions {
  readonly endpoint?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly toolchain?: ImageToolchain;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function codeOf(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) return String(err.code);
  return "UNKNOWN";
}

/**
 * Both causes, always — the AGENTS.md error-masking rule. `fetch` wraps the real socket error
 * in `cause`, and printing only "fetch failed" is how a connection refusal becomes a mystery.
 */
function messageWithCause(err: unknown): string {
  const outer = messageOf(err);
  const cause = err instanceof Error && err.cause !== undefined ? err.cause : undefined;
  return cause === undefined ? outer : `${outer} (cause: ${messageOf(cause)})`;
}

/**
 * The shared guard's refusal, said in the vocabulary `DescribeOutcome` already published.
 *
 * A TRANSLATION, NOT A SECOND CHECK. `loopbackFetch` decided; this only names the decision in the
 * words a caller of this module already handles, so closing the redirect hole did not oblige
 * every consumer to learn a second set of cause names.
 *
 * Two of the guard's causes land on ONE of ours on purpose. A string that will not parse as a URL
 * has no host to check, and this module has always reported that as `not-loopback`; splitting it
 * out now would change a published discriminant without changing what happened — the endpoint was
 * refused and nothing was sent.
 *
 * `redirected` does NOT land on `unreachable`, which is the whole point of the guard: see the
 * type above.
 */
function describeFailure(
  failure: LoopbackFailure,
  model: string,
  endpoint: string,
  timeoutMs: number,
): DescribeOutcome {
  switch (failure.cause) {
    case "not-loopback":
    case "malformed-endpoint":
      return {
        ok: false,
        cause: "not-loopback",
        detail:
          `refusing to describe: ${failure.detail} Photographs are the last thing that should ` +
          `leave a machine by accident. Nothing was described and nothing was written.`,
      };
    case "redirected":
      return {
        ok: false,
        cause: "redirected",
        detail:
          `refusing to describe: ${failure.detail} The image was NOT sent to that location, ` +
          `nothing was described and nothing was written. This is not the model being down — ` +
          `restarting it changes nothing — so the question to answer is what is answering on ` +
          `${endpoint}.`,
      };
    case "unreachable":
      // WHICH failure, from the error's NAME rather than its message. `AbortSignal.timeout`
      // rejects with a DOMException whose name is "TimeoutError" — a name fixed by the web
      // standard, the same kind of anchor as a magic number or an armor header, where the
      // message ("The operation was aborted due to timeout") is a string that moves with the
      // runtime. A model that answered nothing within the ceiling was RUNNING; saying it could
      // not be reached would send the operator to start a server that is already up. The guard
      // carries the thrown value out precisely so this distinction survives the move into it.
      if (failure.error instanceof Error && failure.error.name === "TimeoutError") {
        return {
          ok: false,
          cause: "timed-out",
          detail:
            `${model} at ${endpoint} did not answer within ${timeoutMs}ms and the request was ` +
            `aborted at that ceiling: ${messageWithCause(failure.error)}. This is NOT a refused ` +
            `connection — a loaded machine, a cold model load and a large image all look like ` +
            `this — so raising the ceiling is the first thing to try, not starting a server ` +
            `that may already be running. Nothing was described and nothing was written.`,
        };
      }
      return {
        ok: false,
        cause: "unreachable",
        detail:
          `${model} at ${failure.detail}. Nothing was described and nothing was written — no ` +
          `deterministic result was substituted.`,
      };
  }
}

interface Run {
  readonly ok: boolean;
  readonly stdout: string;
  readonly detail: string;
}

/**
 * Run a program once, with no shell: arguments go to execFile directly, so a file name
 * containing a space, a quote or a `;` is one argument and cannot be re-interpreted.
 */
function run(program: string, args: readonly string[], timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    execFile(program, [...args], { timeout: timeoutMs, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err === null) {
        resolve({ ok: true, stdout, detail: "" });
        return;
      }
      resolve({
        ok: false,
        stdout,
        detail: `${messageOf(err)} [${codeOf(err)}] ${stderr.trim()}`.trim(),
      });
    });
  });
}

/** Can `sips` be executed here at all? `--version` touches no file and no image. */
async function probeSips(): Promise<ImageToolchain> {
  const probe = await run("sips", ["--version"], SIPS_TIMEOUT_MS);
  if (probe.ok) return Object.freeze({ sipsRuns: true, sipsUnavailable: null });
  return Object.freeze({
    sipsRuns: false,
    sipsUnavailable:
      `sips could not be executed: ${probe.detail}. It is macOS-only and it is not required — ` +
      `pixel dimensions are reported as unmeasured, with this as the reason, and HEIF files ` +
      `cannot be decoded for the local model on this machine.`,
  });
}

/**
 * What format these first bytes say the file is, or null.
 *
 * Pure and total. Every signature below is a WIRE FORMAT fixed by its specification — the same
 * discipline as matching `-----BEGIN SSH SIGNATURE-----` in gitIntake rather than matching
 * git's stderr: a magic number does not move with anyone's version or locale.
 */
export function imageFormatOf(head: Uint8Array): ImageFormat | null {
  const at = (i: number): number => head[i] ?? -1;
  const ascii = (start: number, end: number): string =>
    String.fromCharCode(...[...head.slice(start, end)].map((b) => (b >= 32 && b < 127 ? b : 0)));

  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (
    at(0) === 0x89 &&
    ascii(1, 4) === "PNG" &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return "png";
  }
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  if (ascii(4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(8, 12).toLowerCase())) return "heif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  // TIFF, both endiannesses: "II" + 42 little-endian, "MM" + 42 big-endian.
  if (ascii(0, 2) === "II" && at(2) === 0x2a && at(3) === 0x00) return "tiff";
  if (ascii(0, 2) === "MM" && at(2) === 0x00 && at(3) === 0x2a) return "tiff";
  return null;
}

/**
 * The first `HEAD_BYTES` of a file, or a named failure.
 *
 * Read BEFORE hashing, deliberately: identification is 32 bytes and hashing is the whole file,
 * so sniffing first means a directory holding one photograph and a 4 GB video reads 32 bytes of
 * the video instead of all of it. Two opens for an image, one for everything else.
 */
async function readHead(path: string): Promise<Uint8Array | string> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (err) {
    return `could not be opened: ${messageOf(err)} [${codeOf(err)}]`;
  }
  try {
    const buffer = new Uint8Array(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.slice(0, bytesRead);
  } catch (err) {
    return `could not be read: ${messageOf(err)} [${codeOf(err)}]`;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * SHA-256 of a file's bytes, streamed.
 *
 * Streamed rather than read whole because the digest is the evidence: it has to be computable
 * for a 200 MB raw photograph on a machine that cannot hold one in memory, and O(1) memory is
 * free here. The algorithm is named in every ref this produces (`sha256:…`), so the check can
 * be reproduced by hand with `shasum -a 256`.
 */
async function digestOf(path: string): Promise<string | { readonly error: string }> {
  const hash = createHash("sha256");
  try {
    await pipeline(createReadStream(path), hash);
  } catch (err) {
    return { error: `could not be hashed: ${messageOf(err)} [${codeOf(err)}]` };
  }
  return hash.digest("hex");
}

/**
 * Pixel dimensions from `sips`, or the reason they are not known.
 *
 * Parsed by KEY (`pixelWidth: 1536`) rather than by line position, because sips prints the
 * resolved path first and follows symlinks while doing it — the first line of its output is not
 * reliably the file that was asked about, and the labelled values are.
 */
async function dimensionsOf(
  path: string,
  toolchain: ImageToolchain,
): Promise<ObservedImage["dimensions"]> {
  if (!toolchain.sipsRuns) {
    return { known: false, why: toolchain.sipsUnavailable ?? "sips is not available here" };
  }
  const measured = await run(
    "sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", path],
    SIPS_TIMEOUT_MS,
  );
  if (!measured.ok) {
    return { known: false, why: `sips could not measure this file: ${measured.detail}` };
  }
  const width = /^\s*pixelWidth:\s*(\d+)\s*$/m.exec(measured.stdout);
  const height = /^\s*pixelHeight:\s*(\d+)\s*$/m.exec(measured.stdout);
  if (width === null || height === null) {
    return {
      known: false,
      why:
        `sips ran but printed no pixelWidth/pixelHeight for this file. Its output was: ` +
        `${JSON.stringify(measured.stdout.trim().slice(0, 160))}`,
    };
  }
  return { known: true, width: Number(width[1]), height: Number(height[1]) };
}

/**
 * Walk one directory tree, collecting files and naming everything skipped.
 *
 * SYMBOLIC LINKS ARE NOT FOLLOWED, and that is a rule rather than an omission: a link can point
 * anywhere on the machine, including outside the directory the operator actually named, and a
 * cycle would not terminate. Depth is capped for the same reason. Both are REPORTED per entry,
 * so a scan that skipped something says so instead of quietly returning a smaller number.
 */
async function walk(
  dir: string,
  depth: number,
  files: string[],
  notRead: NotReadEntry[],
): Promise<void> {
  if (depth > MAX_DEPTH) {
    notRead.push({
      path: dir,
      cause: "depth-cap",
      detail: `not descended: nesting deeper than ${MAX_DEPTH} directories was not walked.`,
    });
    return;
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    notRead.push({
      path: dir,
      cause: "directory-unreadable",
      detail: `directory could not be listed: ${messageOf(err)} [${codeOf(err)}]`,
    });
    return;
  }
  // Sorted, so two scans of an unchanged directory produce the same document.
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      notRead.push({
        path: full,
        cause: "symbolic-link",
        detail:
          `symbolic link not followed: it can point outside the directory that was named, and ` +
          `a loop would not terminate. Point --dir at the target directly to include it.`,
      });
      continue;
    }
    if (entry.isDirectory()) {
      await walk(full, depth + 1, files, notRead);
      continue;
    }
    if (entry.isFile()) {
      files.push(full);
      continue;
    }
    notRead.push({
      path: full,
      cause: "not-a-regular-file",
      detail: `not a regular file or directory; skipped.`,
    });
  }
}

/**
 * What the store's three publishable containers are called in IANA's vocabulary.
 *
 * A table rather than `` `image/${format}` ``, because the two vocabularies agree by coincidence
 * for these three and would stop agreeing the moment either gains a member — `image/jpeg` is not
 * `image/jpg`, and a `tiff` published format would have to be spelled out anyway. The table is
 * exhaustive by TYPE, so adding a `PublishedFormat` fails to compile until its type is named.
 */
const PUBLISHED_MEDIA_TYPES: Readonly<Record<PublishedFormat, MediaType>> = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
});

/**
 * What the app will actually SERVE for one image, or null when it will serve nothing.
 *
 * THE ANSWER COMES FROM THE STORE AND NOWHERE ELSE. It would have been one line shorter to read
 * the format the magic bytes named at the top of this file and call that the media type — and it
 * would have been wrong for every HEIC on the machine, because the store transcodes what it
 * cannot strip in place: a phone photograph goes in as HEIC and comes out as JPEG. The document
 * announces what a browser will be handed, so this reads the manifest of the object that will
 * hand it over. A failed put yields null, and a null yields no media element rather than a ref
 * pointing at bytes nothing holds.
 */
export function publishedMediaOf(stored: PutOutcome | null): PublishedMedia | null {
  if (stored === null || !stored.ok) return null;
  return { mediaType: PUBLISHED_MEDIA_TYPES[stored.manifest.publishedFormat] };
}

/** How a scan is told where to put the bytes it finds. */
export interface ScanOptions {
  /**
   * The media store root. Omit it and the store beside the configured leaf document is used —
   * which is what the CLI wants, since a portfolio and its photographs are one artifact. Pass
   * `null` to scan and measure WITHOUT capturing anything, which is a smaller, honest operation
   * and the one a test that is only exercising the reader should ask for.
   */
  readonly store?: string | null;
}

/**
 * Scan a directory the operator named for image files, measuring each one AND capturing its bytes.
 *
 * Never recursive into the Photos library by default and never anywhere by default at all: the
 * caller names the directory. That is not caution for its own sake — the macOS Photos library is
 * TCC-gated (a fresh process reading it gets `authorization denied`), so a tool that pointed
 * itself there would fail for a reason that has nothing to do with the operator's intent.
 *
 * WHY A "READ" WRITES, stated plainly because a surprising side effect deserves a defence. This
 * is the only moment both halves of the evidence are in hand: the digest that becomes the ref,
 * and the file the digest was taken from. A candidate is drafted here, approved days later and
 * promoted from a document that holds the digest alone — by then the path is gone from every
 * structure, and on a tidied machine so is the file. Capturing later is not a smaller version of
 * this feature; it is an impossible one. The capture is content-addressed, so a second scan of an
 * unchanged directory writes nothing new, and it is reported per image rather than assumed.
 *
 * Complexity: O(files) directory entries, O(bytes) over identified images only, and one strip +
 * one write per DISTINCT digest.
 */
export async function readImages(dirPath: string, options: ScanOptions = {}): Promise<ImageScan> {
  try {
    const info = await stat(dirPath);
    if (!info.isDirectory()) {
      return {
        ok: false,
        cause: "not-a-directory",
        detail: `${dirPath} exists but is not a directory, so there is nothing to walk.`,
        path: dirPath,
      };
    }
  } catch (err) {
    const code = codeOf(err);
    return {
      ok: false,
      cause: code === "ENOENT" ? "no-such-path" : "unreadable-directory",
      detail: `${dirPath} could not be examined: ${messageOf(err)} [${code}]`,
      path: dirPath,
    };
  }

  const files: string[] = [];
  const notRead: NotReadEntry[] = [];
  await walk(dirPath, 0, files, notRead);

  const toolchain = await probeSips();
  const storeRoot = options.store === undefined ? mediaRootFromEnv() : options.store;
  const images: ScannedImage[] = [];
  const emptyFiles: string[] = [];
  /** digest → the put that already happened, so a byte-identical duplicate is not re-stripped. */
  const putByDigest = new Map<string, PutOutcome>();
  let nonImageFiles = 0;

  for (const path of files) {
    const head = await readHead(path);
    if (typeof head === "string") {
      notRead.push({ path, cause: "file-unreadable", detail: head });
      continue;
    }
    // ZERO BYTES BEFORE FORMAT, because "not an image by its bytes" is a claim about bytes that
    // were read, and there are none here to read. A 0-byte file counted as a non-image is the
    // same collapse as a failed read counted as a zero, one datum smaller.
    if (head.length === 0) {
      emptyFiles.push(path);
      continue;
    }
    const format = imageFormatOf(head);
    if (format === null) {
      nonImageFiles++;
      continue;
    }
    let byteLength: number;
    try {
      byteLength = (await stat(path)).size;
    } catch (err) {
      notRead.push({
        path,
        cause: "file-unreadable",
        detail: `size could not be read: ${messageOf(err)} [${codeOf(err)}]`,
      });
      continue;
    }
    const digest = await digestOf(path);
    if (typeof digest !== "string") {
      // No digest, no evidence. Reported as unread rather than carried with a placeholder ref:
      // a candidate whose ref cannot be re-computed is indistinguishable from a fabricated one.
      notRead.push({ path, cause: "file-unreadable", detail: digest.error });
      continue;
    }
    // `byteLength` can still be 0 here, and it is not dead: the head was read at one instant and
    // the size at another, so a file truncated in between arrives identified as an image and
    // empty. The digest would then be sha256 of nothing — a ref for no artifact — which is the
    // `empty-file` skip `photosToCandidates` exists to catch. The domain holds that rule.
    let stored: PutOutcome | null = null;
    if (storeRoot !== null) {
      const already = putByDigest.get(digest);
      stored =
        already ??
        (await putImage({
          root: storeRoot,
          sourcePath: path,
          sourceDigest: digest,
          sourceFormat: format,
          sipsRuns: toolchain.sipsRuns,
        }));
      putByDigest.set(digest, stored);
    }
    images.push({
      path,
      digest,
      byteLength,
      dimensions: await dimensionsOf(path, toolchain),
      format,
      stored,
      published: publishedMediaOf(stored),
    });
  }

  return {
    ok: true,
    dir: dirPath,
    images: Object.freeze(images),
    filesSeen: files.length,
    nonImageFiles,
    emptyFiles: Object.freeze(emptyFiles),
    notRead: Object.freeze(notRead),
    toolchain: Object.freeze(toolchain),
    storeRoot,
  };
}

/**
 * A copy of the image no larger than `MAX_EDGE_PX` on its longest edge, as JPEG.
 *
 * One `sips` call does both jobs, which is why it is one call: HEIF is what an iPhone photo and
 * the macOS wallpaper actually are, and no model endpoint takes HEIF, so the conversion is not
 * an optimisation but the only way those files can be looked at at all.
 *
 * Returns the ORIGINAL path when sips is unavailable. That is deliberate and it is reported: a
 * PNG or JPEG can be sent as-is, so losing sips costs transfer bytes rather than the feature.
 */
async function prepareForModel(
  image: ScannedImage,
  toolchain: ImageToolchain,
  scratch: string,
): Promise<{ readonly path: string; readonly prepared: "downscaled" | "original" }> {
  if (!toolchain.sipsRuns) return { path: image.path, prepared: "original" };
  const out = join(scratch, "scaled.jpg");
  const scaled = await run(
    "sips",
    ["-s", "format", "jpeg", "-Z", String(MAX_EDGE_PX), image.path, "--out", out],
    SIPS_TIMEOUT_MS,
  );
  if (!scaled.ok) return { path: image.path, prepared: "original" };
  return { path: out, prepared: "downscaled" };
}

/**
 * Answers that are an ABSENCE WEARING A STRING.
 *
 * MEASURED on a real run: asked for `visibleText` on the macOS wallpaper, gemma4:12b returned
 * the four characters `null` rather than a JSON null — a grammar that permits null does not
 * oblige a model to reach for it, and a decoder trained on prose will spell the word instead.
 * Carrying that through would put the literal title "null" in front of a reviewer, which is the
 * exact failure the nullable schema exists to prevent, arriving one layer further in.
 *
 * Matched only on the WHOLE trimmed value, case-folded. A summary that happens to contain the
 * word "none" is a real answer and is left alone.
 */
const ABSENCE_WORDS: ReadonlySet<string> = new Set([
  "null",
  "none",
  "nil",
  "n/a",
  "na",
  "unknown",
  "no text",
  "no visible text",
  "undefined",
]);

/** A model answer field: a string with content, or an absence. Blank and "null" are absences. */
function fieldOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return ABSENCE_WORDS.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Show one image to the local model and return what it said, or exactly why it said nothing.
 *
 * FAILS CLOSED on every path. There is no fallback here and there must not be one: the caller's
 * only correct response to a failure is to write nothing, because a candidate whose extractor
 * says "local-model:gemma4:12b" when the model never ran is a lie in the one field review uses
 * to decide whether to trust a drafted line.
 *
 * An all-null answer is NOT a failure — it is the model declining, which is the outcome the
 * nullable schema exists to make possible. It comes back as a `DraftedDescription` whose fields
 * are null, and the domain turns it into a title made of file facts.
 */
export async function describeImage(
  image: ScannedImage,
  options: DescribeOptions = {},
): Promise<DescribeOutcome> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? LOCAL_DESCRIBER_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const toolchain = options.toolchain ?? (await probeSips());

  // REFUSED BEFORE THE IMAGE IS TOUCHED, not merely before it is sent. `loopbackFetch` would
  // refuse this endpoint anyway, but downscaling a photograph and reading it into memory for a
  // request we will decline to make is work this module should not do — `loopbackHostOf` is
  // exported so it need not.
  const reachable = loopbackHostOf(endpoint);
  if (!reachable.ok) return describeFailure(reachable.failure, model, endpoint, timeoutMs);

  let scratch: string;
  try {
    scratch = await mkdtemp(join(tmpdir(), "foliage-photo-"));
  } catch (err) {
    return {
      ok: false,
      cause: "unreadable-file",
      detail: `no scratch directory could be made for the downscaled copy: ${messageOf(err)}`,
    };
  }

  try {
    const { path, prepared } = await prepareForModel(image, toolchain, scratch);
    let bytes: Buffer;
    try {
      const handle = await open(path, "r");
      try {
        bytes = await handle.readFile();
      } finally {
        await handle.close().catch(() => undefined);
      }
    } catch (err) {
      return {
        ok: false,
        cause: "unreadable-file",
        detail: `${path} could not be read to send: ${messageOf(err)} [${codeOf(err)}]`,
      };
    }

    // NOTHING IS SENT WITH ITS EXIF ON, not even to loopback, and this is a fix rather than a
    // precaution. MEASURED 2026-08-19 on a JPEG carrying a real GPS IFD: `sips -Z 1536` — the
    // downscale immediately above — preserves the whole EXIF block, re-serialized big-endian.
    // So the copy this function prepared for the model still held the coordinates, and the
    // redirect hole `loopbackFetch` closed was a hole through which exactly that would have
    // travelled. The model is asked what the picture SHOWS; where it was taken is not part of
    // the question. Bytes in a container this cannot strip are sent as they are, because a
    // silent pass-through is what is being refused — the send is not smaller for hiding it.
    const cleaned = stripKnownContainer(bytes);
    const toSend = cleaned !== null && cleaned.ok ? Buffer.from(cleaned.bytes) : bytes;

    const sent = await loopbackFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: DESCRIBE_PROMPT,
        images: [toSend.toString("base64")],
        format: DESCRIBE_SCHEMA,
        options: { num_predict: MAX_ANSWER_TOKENS },
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // jscpd:ignore-start — this response-parsing block is identical to brainSource.ts's;
    // historical duplication predating this gate, not retriaged here.
    if (!sent.ok) return describeFailure(sent.failure, model, endpoint, timeoutMs);
    const response = sent.response;
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 200);
      return {
        ok: false,
        cause: "http-error",
        detail: `${endpoint} answered HTTP ${response.status}: ${body || "(no body)"}`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      return {
        ok: false,
        cause: "unparseable",
        detail: `the response body was not JSON: ${messageWithCause(err)}`,
      };
    }
    const body =
      payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const envelope = body["response"];
    // WHY THE GENERATION STOPPED, read from the server rather than inferred from the text.
    // "length" means the answer was CUT OFF at the output ceiling, which is a different problem
    // with a different remedy from a model that ignored its grammar — and the two are
    // indistinguishable from the truncated string alone.
    const stopped = typeof body["done_reason"] === "string" ? body["done_reason"] : "unstated";
    // jscpd:ignore-end
    const cutOff = stopped === "length";
    if (typeof envelope !== "string") {
      return {
        ok: false,
        cause: "unparseable",
        detail: `the response carried no "response" string: ${JSON.stringify(payload).slice(0, 200)}`,
      };
    }
    let answer: unknown;
    try {
      answer = JSON.parse(envelope);
    } catch (err) {
      // Grammar-enforced decoding should make this unreachable, so BOTH causes are reported:
      // what the parser said, and what the server said about why it stopped generating.
      return {
        ok: false,
        cause: "unparseable",
        detail:
          (cutOff
            ? `${model}'s answer was CUT OFF at the ${MAX_ANSWER_TOKENS}-token output ceiling ` +
              `(done_reason "length"), so the JSON it was emitting never closed`
            : `${model} answered outside the schema it was given (done_reason "${stopped}")`) +
          ` — ${messageOf(err)}: ${JSON.stringify(envelope.slice(0, 200))}. Nothing was ` +
          `described.`,
      };
    }
    if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
      return {
        ok: false,
        cause: "unparseable",
        detail: `${model} answered with ${JSON.stringify(answer).slice(0, 120)}, not an object.`,
      };
    }
    const fields = answer as Record<string, unknown>;

    return {
      ok: true,
      description: Object.freeze({
        describer: `local-model:${model}`,
        summary: fieldOrNull(fields["summary"]),
        visibleText: fieldOrNull(fields["visibleText"]),
      }),
      prepared,
      sentBytes: toSend.byteLength,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}
