/**
 * Admit owner-selected browser capture media to the existing private review queue.
 *
 * Capture is not approval. The image bytes use the established photo pipeline; a verified
 * MP4 can join the same candidate before review. No neighbouring file is scanned.
 */
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { RATING_SHAPED } from "@foliage/leaf";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import {
  parseHarvestDocument,
  harvestCandidateId,
  photosToCandidates,
  reviewSubjectDigest,
  withCandidates,
  type HarvestCandidate,
  type HarvestDocument,
} from "@foliage/photosynthesis";

import { IMPORT_DOCUMENT_BYTES } from "./integrationImport.ts";
import { boundedIntegrationFile, integrationJson, readIntegrationTarget } from "./integrationStore.ts";
import { mediaRootFor } from "./mediaStore.ts";
import { captureDemoCandidateId, readCaptureArtifact, readCaptureReceipt } from "./captureLibrary.ts";
import { putCapturedVideo, videoRootFromEnv } from "./videoStore.ts";
import { isReadFailure, readImages } from "./photoSource.ts";
import { dribbbleShotReference } from "./designImageReference.ts";

const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;

export interface CaptureReviewInput {
  /** The one screenshot the owner or capture agent selected; adjacent files are not scanned. */
  readonly screenshotPath: string;
  readonly leafPath: string;
  readonly harvestPath: string;
  /** Defaults to the content-addressed media store beside leafPath. */
  readonly mediaRoot?: string;
  /** The actual capture instant, when supplied by the capture agent. */
  readonly observedAt?: string;
  /** An observed page label or owner-entered draft title; never model-generated here. */
  readonly title?: string;
  readonly expectedSubject?: { readonly id: string; readonly subject: string };
  /** Receipt-checked capture media prepared by queueCapturedDemo, never a caller-supplied URL. */
  readonly demo?: {
    readonly candidateId: string;
    readonly screenshotRef: string;
    readonly videoBytes: Buffer;
    readonly videoRef: string;
    readonly width: number;
    readonly height: number;
    readonly durationSeconds: number;
    readonly completedAt: string;
    readonly evaluation?: { readonly ref: string; readonly excerpt: string; readonly observedAt: string };
  };
}

export interface QueuedScreenshot {
  readonly candidateId: string;
  readonly mediaRef: string;
  /** False means identical material was already in this queue; its review was left untouched. */
  readonly queued: boolean;
  readonly videoRef?: string;
}

export interface CaptureDemoReviewInput {
  readonly captureRoot: string;
  readonly captureId: string;
  readonly leafPath: string;
  readonly harvestPath: string;
  readonly title?: string;
  /** Explicit same-job receipt selection; never inferred from matching titles or URLs. */
  readonly evaluationReceiptPath?: string;
  readonly expectedSubject?: { readonly id: string; readonly subject: string };
}

export interface SelectedDesignImageInput {
  readonly bytes: Buffer;
  readonly format: "png" | "jpeg";
  readonly project: string;
  readonly title: string;
  /** The owner labels a selected file; this is not authenticated provider provenance. */
  readonly origin: "figma-export" | "local-image";
  readonly referenceUrl: string | null;
  readonly leafPath: string;
  readonly harvestPath: string;
  readonly mediaRoot: string;
  readonly expectedLeaf: { readonly id: string; readonly subject: string };
}

/** A selected local artwork image uses the photo store and the one existing Review queue. */
export async function queueSelectedDesignImage(input: SelectedDesignImageInput): Promise<QueuedScreenshot> {
  const leafPath = resolve(input.leafPath), harvestPath = resolve(input.harvestPath);
  if (leafPath === harvestPath) throw new Error("Choose separate Leaf and review documents.");
  const title = `${input.project} · ${input.title}`;
  if (!input.project.trim() || !input.title.trim() || input.project !== input.project.trim() || input.title !== input.title.trim() ||
      title.length > 200 || /[\u0000-\u001f\u007f]/u.test(title) || RATING_SHAPED.test(title) ||
      !["figma-export", "local-image"].includes(input.origin)) throw new Error("Use one short project and image title without control or rating-shaped text.");
  if (input.bytes.length < 1 || input.bytes.length > 4 * 1024 * 1024 ||
      !["png", "jpeg"].includes(input.format)) throw new Error("Choose one PNG or JPEG image of at most 4 MiB.");
  dribbbleShotReference(input.referenceUrl);
  const initialLeaf = await readIntegrationTarget(leafPath);
  if (initialLeaf.id !== input.expectedLeaf.id || initialLeaf.subject !== input.expectedLeaf.subject)
    throw new Error("The private record changed after preview. Choose the image again.");
  checkBinding(await readHarvest(harvestPath), initialLeaf);
  const stage = await mkdtemp(join(tmpdir(), "foliage-selected-design-"));
  let candidate: HarvestCandidate;
  let mediaRef: string;
  try {
    await writeFile(join(stage, input.format === "png" ? "selected.png" : "selected.jpg"), input.bytes, { flag: "wx", mode: 0o600 });
    const scan = await readImages(stage, { store: resolve(input.mediaRoot) });
    if (!scan.ok) throw new Error(`Design image could not be read: ${scan.cause}: ${scan.detail}`);
    if (scan.notRead.filter(isReadFailure).length || scan.images.length !== 1 || scan.nonImageFiles || scan.emptyFiles.length ||
        scan.images[0]?.format !== input.format) throw new Error("Selected file was not one readable PNG or JPEG. Nothing entered Review.");
    const image = scan.images[0]!;
    if (!image.stored?.ok || image.published === null) {
      const cause = image.stored === null ? "no media store was used" : image.stored.ok ? "no previewable media was produced" : image.stored.detail;
      throw new Error(`Design image could not be retained: ${cause}. Nothing entered Review.`);
    }
    const drafted = photosToCandidates({ images: [{ ...image, description: null }], observedAt: new Date().toISOString() });
    if (!drafted.ok || drafted.candidates.length !== 1) throw new Error("Design image could not become one review draft.");
    const original = drafted.candidates[0]!;
    mediaRef = image.stored.ref;
    const selected = {
      ...original,
      id: harvestCandidateId(`selected-design:${mediaRef}`),
      title,
      extractor: "owner-selected-design-image",
      evidence: [
        { ...original.evidence[0]!, source: input.origin === "figma-export" ? "owner-selected:figma-export" : "owner-selected:design-image" },
        ...(input.referenceUrl === null ? [] : [{ source: "owner-reference:dribbble", ref: input.referenceUrl, observedAt: original.draftedAt }]),
      ],
    };
    const parsed = parseHarvestDocument({ candidates: [selected] });
    if (!parsed.ok) throw new Error("Selected image failed Review validation; nothing entered Review.");
    candidate = parsed.harvest.candidates[0]!;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return persistImageCandidate({ leafPath, harvestPath, initialLeaf, candidate, mediaRef, selectedDesign: true });
}

/** Queue the still and clip as ONE review decision. No capture URL or private path enters Harvest. */
export async function queueCapturedDemo(input: CaptureDemoReviewInput): Promise<QueuedScreenshot & { readonly videoRef: string }> {
  const receipt = await readCaptureReceipt(input.captureRoot, input.captureId);
  const still = await readCaptureArtifact(input.captureRoot, input.captureId, "screenshot");
  const video = await readCaptureArtifact(input.captureRoot, input.captureId, "video");
  if (!receipt || !still || !video) throw new Error("Capture files changed or are unavailable. Record again.");
  let evaluation: { ref: string; excerpt: string; observedAt: string } | undefined;
  let candidateId = captureDemoCandidateId(receipt);
  if (input.evaluationReceiptPath !== undefined) {
    const raw = integrationJson(await boundedIntegrationFile(input.evaluationReceiptPath, IMPORT_DOCUMENT_BYTES), "Evaluation receipt");
    const { receiptObservation } = await import(new URL("../../../tools/eval/observation.mjs", import.meta.url).href) as {
      receiptObservation: (value: unknown, target: { id: string; subject: string }) => {
        observations: { recordId: string; excerpt: string; observedAt: string }[];
      };
    };
    const { canonical } = await import(new URL("../../../tools/eval/contract.mjs", import.meta.url).href) as {
      canonical: (value: unknown) => string;
    };
    // This validates the complete envelope before using its binding. Unsigned local reports
    // stay explicitly unsigned; a signed receipt needs the existing trusted-key importer.
    const observation = receiptObservation(raw, await readIntegrationTarget(input.leafPath)).observations[0]!;
    const envelope = raw as { digest: string; evidence: { browser?: { status: string; capture: {
      id: string; receiptDigest: string; screenshotDigest: string; videoDigest: string;
    } | null } } };
    const bound = envelope.evidence.browser;
    const captureDigest = `sha256:${createHash("sha256").update(canonical(receipt)).digest("hex")}`;
    if (bound?.status !== "completed" || bound.capture?.id !== receipt.id || bound.capture.receiptDigest !== captureDigest ||
        bound.capture.screenshotDigest !== receipt.artifacts.screenshot.sha256 || bound.capture.videoDigest !== receipt.artifacts.video.sha256) {
      throw new Error("The evaluation does not bind these exact capture receipts and media. Nothing was queued.");
    }
    evaluation = { ref: envelope.digest, excerpt: observation.excerpt, observedAt: observation.observedAt };
    // One identity per evaluation attempt. Re-sealing changed report/media bytes must
    // conflict with the prior decision, not create a second candidate under a new digest.
    candidateId = `demo:sha256:${createHash("sha256").update(`foliage-eval:${observation.recordId}`).digest("hex")}`;
  }
  const { width, height } = receipt.capture;
  if (width === undefined || height === undefined) {
    throw new Error("This capture has no measured video size. Record again before adding it to Review.");
  }
  if (still.bytes.length < 24 || still.bytes.readUInt32BE(16) !== width || still.bytes.readUInt32BE(20) !== height) {
    throw new Error("Capture viewport and screenshot size disagree. Nothing was queued.");
  }
  const durationSeconds = receipt.capture.frameCount !== undefined && receipt.capture.frameRate !== undefined
    ? receipt.capture.frameCount / receipt.capture.frameRate
    : receipt.capture.requestedDurationSeconds;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 15) {
    throw new Error("This capture has no valid video duration. Record again before adding it to Review.");
  }
  const queued = await queueCapturedScreenshot({
    screenshotPath: join(resolve(input.captureRoot), input.captureId, "screenshot.png"),
    leafPath: input.leafPath,
    harvestPath: input.harvestPath,
    observedAt: receipt.capture.screenshotAt ?? receipt.capture.completedAt,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.expectedSubject === undefined ? {} : { expectedSubject: input.expectedSubject }),
    demo: {
      candidateId,
      screenshotRef: receipt.artifacts.screenshot.sha256,
      videoBytes: video.bytes,
      videoRef: receipt.artifacts.video.sha256,
      width, height, durationSeconds, completedAt: receipt.capture.completedAt,
      ...(evaluation === undefined ? {} : { evaluation }),
    },
  });
  if (!queued.videoRef) throw new Error("Video was not retained for Review.");
  return { ...queued, videoRef: queued.videoRef };
}

/** Read one regular, non-symlink file with a hard byte ceiling. */
async function selectedBytes(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Choose a regular screenshot file.");
    if (info.size === 0 || info.size > MAX_SCREENSHOT_BYTES) {
      throw new Error("Screenshot must be a nonempty PNG of at most 32 MiB.");
    }
    const bytes = Buffer.alloc(MAX_SCREENSHOT_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size === 0 || size > MAX_SCREENSHOT_BYTES) {
      throw new Error("Screenshot must be a nonempty PNG of at most 32 MiB.");
    }
    return bytes.subarray(0, size);
  } finally {
    await file.close();
  }
}

/** ENOENT alone means a new queue. Every other read or format error preserves the old bytes. */
async function readHarvest(path: string): Promise<HarvestDocument | null> {
  let bytes: string;
  try {
    bytes = await boundedIntegrationFile(path, IMPORT_DOCUMENT_BYTES);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  const parsed = parseHarvestDocument(integrationJson(bytes, "Existing review queue"));
  if (!parsed.ok) {
    throw new Error("Existing review queue is invalid; its bytes and decisions were preserved: " +
      parsed.issues.map(issue => `${issue.at}: ${issue.message}`).join("; "));
  }
  return parsed.harvest;
}

function checkBinding(harvest: HarvestDocument | null, leaf: { readonly id: string; readonly subject: string }): void {
  if (harvest === null) return;
  if (harvest.subject !== undefined && harvest.subject !== leaf.subject ||
      harvest.leafId !== undefined && harvest.leafId !== leaf.id) {
    throw new Error("Review queue belongs to another portfolio; nothing was added.");
  }
  // An old unbound queue can contain material from any subject. Binding it as a side effect of
  // adding one screenshot would authorize promotion of that older material to the current Leaf.
  if (harvest.candidates.length > 0 &&
      (harvest.subject !== leaf.subject || harvest.leafId !== leaf.id)) {
    throw new Error("Review queue has unbound work. Link it to this portfolio explicitly before capturing.");
  }
}

/**
 * Queue a real captured PNG and optional verified MP4, never publish either.
 * Repeated calls with the same bytes and title are idempotent even when the capture clock differs.
 */
export async function queueCapturedScreenshot(input: CaptureReviewInput): Promise<QueuedScreenshot> {
  const screenshotPath = resolve(input.screenshotPath);
  const leafPath = resolve(input.leafPath);
  const harvestPath = resolve(input.harvestPath);
  if (leafPath === harvestPath) throw new Error("Choose separate Leaf and review documents.");
  if (input.title !== undefined &&
      (input.title.trim() === "" || input.title !== input.title.trim() || input.title.length > 200 ||
       /[\u0000-\u001f\u007f]/u.test(input.title) || RATING_SHAPED.test(input.title))) {
    throw new Error("Use one short screenshot title without control or rating-shaped text.");
  }

  const initialLeaf = await readIntegrationTarget(leafPath);
  if (input.expectedSubject !== undefined && (initialLeaf.id !== input.expectedSubject.id || initialLeaf.subject !== input.expectedSubject.subject)) {
    throw new Error("The selected portfolio changed before capture Review. Nothing was queued.");
  }
  const initialHarvest = await readHarvest(harvestPath);
  checkBinding(initialHarvest, initialLeaf);

  // The staging directory contains exactly one selected file. Its original name is retained for
  // the factual photo-intake fallback title; its path never becomes provenance.
  const stage = await mkdtemp(join(tmpdir(), "foliage-selected-capture-"));
  let candidate: HarvestCandidate;
  let mediaRef: string;
  try {
    const selected = join(stage, basename(screenshotPath));
    const screenshotBytes = await selectedBytes(screenshotPath);
    if (input.demo && `sha256:${createHash("sha256").update(screenshotBytes).digest("hex")}` !== input.demo.screenshotRef) {
      throw new Error("Screenshot changed after capture. Nothing was queued.");
    }
    await writeFile(selected, screenshotBytes, { flag: "wx", mode: 0o600 });
    const storeRoot = input.mediaRoot === undefined ? mediaRootFor(leafPath) : resolve(input.mediaRoot);
    const scan = await readImages(stage, { store: storeRoot });
    if (!scan.ok) throw new Error(`Screenshot could not be read: ${scan.cause}: ${scan.detail}`);
    const failed = scan.notRead.filter(isReadFailure);
    if (failed.length > 0 || scan.images.length !== 1 || scan.nonImageFiles !== 0 ||
        scan.emptyFiles.length !== 0 || scan.images[0]?.format !== "png") {
      throw new Error("Selected file was not one readable PNG screenshot; nothing was queued.");
    }
    const image = scan.images[0]!;
    if (!image.stored?.ok || image.published === null) {
      const cause = image.stored === null ? "no media store was used" :
        image.stored.ok ? "no publishable media was produced" : `${image.stored.cause}: ${image.stored.detail}`;
      throw new Error(`Screenshot media could not be stored: ${cause}. Nothing was queued.`);
    }
    const drafted = photosToCandidates({
      images: [{ ...image, description: null }],
      observedAt: input.observedAt ?? new Date().toISOString(),
    });
    if (!drafted.ok || drafted.candidates.length !== 1) {
      const detail = drafted.ok ? "the image did not create one candidate" :
        drafted.issues.map(issue => `${issue.at}: ${issue.message}`).join("; ");
      throw new Error(`Screenshot could not enter review: ${detail}`);
    }
    const imageCandidate = input.title === undefined ? drafted.candidates[0]! :
      { ...drafted.candidates[0]!, title: input.title };
    mediaRef = image.stored.ref;
    if (input.demo) {
      const held = await putCapturedVideo(videoRootFromEnv({ ...process.env, FOLIAGE_LEAF: leafPath }), input.demo.videoBytes, {
        posterRef: mediaRef, durationSeconds: input.demo.durationSeconds,
      });
      if (held.ref !== input.demo.videoRef) throw new Error("Video changed after capture. Nothing was queued.");
      candidate = {
        ...imageCandidate,
        id: harvestCandidateId(input.demo.candidateId),
        extractor: "browser-capture",
        evidence: [...imageCandidate.evidence, {
          source: "capture:video", ref: held.ref, observedAt: input.demo.completedAt,
        }, ...(input.demo.evaluation === undefined ? [] : [{ source: "foliage-eval", ...input.demo.evaluation }])],
        media: [...(imageCandidate.media ?? []), {
          ref: held.ref,
          media: { mediaType: "video/mp4", dimensions: { known: true, width: input.demo.width, height: input.demo.height } },
        }],
      };
    } else candidate = imageCandidate;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }

  return persistImageCandidate({ leafPath, harvestPath, initialLeaf, candidate, mediaRef, ...(input.demo ? { videoRef: input.demo.videoRef } : {}) });
}

async function persistImageCandidate(input: {
  leafPath: string; harvestPath: string; initialLeaf: { id: string; subject: string };
  candidate: HarvestCandidate; mediaRef: string; videoRef?: string; selectedDesign?: boolean;
}): Promise<QueuedScreenshot> {
  const { leafPath, harvestPath, initialLeaf, candidate, mediaRef } = input;
  return withDocumentLocks([leafPath, harvestPath], async () => {
    const leaf = await readIntegrationTarget(leafPath);
    if (leaf.id !== initialLeaf.id || leaf.subject !== initialLeaf.subject) {
      throw new Error("The selected portfolio changed during capture. Review it and try again.");
    }
    const previous = await readHarvest(harvestPath);
    checkBinding(previous, leaf);
    const existing = previous?.candidates.find(item => item.id === candidate.id);
    if (existing !== undefined) {
      if (reviewSubjectDigest(existing) !== reviewSubjectDigest(candidate)) {
        throw new Error(input.selectedDesign
          ? "This design image already has different Review details. Existing review was preserved."
          : "These screenshot bytes already have a different review title or media. Existing review was preserved.");
      }
      return { candidateId: String(existing.id), mediaRef, queued: false, ...(input.videoRef ? { videoRef: input.videoRef } : {}) };
    }
    const merged = withCandidates(
      { subject: leaf.subject, leafId: String(leaf.id), ...(previous?.repo === undefined ? {} : { repo: previous.repo }) },
      [...(previous?.candidates ?? []), candidate],
    );
    const validated = parseHarvestDocument(merged);
    if (!validated.ok) {
      throw new Error("Screenshot queue failed validation; existing review was preserved: " +
        validated.issues.map(issue => `${issue.at}: ${issue.message}`).join("; "));
    }
    const serialized = `${JSON.stringify(validated.harvest, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > IMPORT_DOCUMENT_BYTES) {
      throw new Error("Review queue is full; existing work was preserved.");
    }
    writeDocument(harvestPath, serialized, previous !== null, true);
    return { candidateId: String(candidate.id), mediaRef, queued: true, ...(input.videoRef ? { videoRef: input.videoRef } : {}) };
  });
}
