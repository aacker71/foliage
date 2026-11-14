/**
 * Read-only state for the Canopy Cloud manager. The POST handlers do not trust this preview:
 * they invoke the publication commands, which read and gate the files again at decision time.
 */

import {
  buildPublishedDocument,
  documentDigest,
  publicPortfolioJson,
  diffPublications,
  reviewForPublication,
  type PublicationDiff,
  type NarrativeSelection,
  type PublicationReview,
  type PublishedLeafDocument,
} from "@foliage/canopy";
import { attributionLedger, type Leaf } from "@foliage/leaf";
import { loadLeafDocument } from "@foliage/leaf-app/leafDocument";
import { loadPublishPolicy } from "@foliage/leaf-app/policyDocument";
import { workflowJevMarks } from "@foliage/leaf-app/workflowJevMarks";
import { join } from "node:path";

import { localPhotoChoices, selectLocalPhotos, type PhotoSelection, type PhotoChoice } from "./localPublicationPhotos.ts";
import { localVideoChoices, selectLocalVideos, type VideoSelection, type VideoChoice } from "./localPublicationVideos.ts";
import { combinedMediaTransferIssue } from "./publicationVideos.ts";
import { loadPublishedLeaf, publishedUrl } from "./publishedLeaf.ts";

type ManageBlockedCause =
  | "leaf-unavailable"
  | "policy-unavailable"
  | "publication-refused"
  | "preview-unavailable";

interface ManageBlockedState {
  readonly kind: "blocked";
  readonly cause: ManageBlockedCause;
  readonly heading: string;
  readonly detail: string;
  readonly issues: readonly string[];
}

type ManagedPublication =
  | { readonly kind: "store-unconfigured"; readonly detail: string }
  | { readonly kind: "not-published"; readonly url: string }
  | { readonly kind: "unreadable"; readonly detail: string }
  | {
      readonly kind: "live" | "update-available";
      readonly url: string;
      readonly document: PublishedLeafDocument;
      /** Digest of the exact public artifact bytes shown during this review. */
      readonly artifactDigest: string;
      readonly diff: PublicationDiff;
      readonly samePolicy: boolean;
    };

export interface ManageReadyState {
  readonly kind: "ready";
  readonly includePortfolio?: boolean;
  readonly photoChoices?: readonly PhotoChoice[];
  readonly photoTransfer?: string;
  readonly videoChoices?: readonly VideoChoice[];
  readonly videoTransfer?: string;
  readonly leaf: Leaf;
  readonly sourcePath: string;
  readonly sourceDigest: string;
  readonly sourceBytes: number;
  readonly policyDigest: string;
  readonly ledger: ReturnType<typeof attributionLedger>;
  readonly policySource: string;
  readonly review: Extract<PublicationReview, { readonly ok: true }>;
  /** Exact serialized content for consent; the publication clock is set on confirmation. */
  readonly preview: PublishedLeafDocument;
  readonly publication: ManagedPublication;
  /**
   * What Jev said about each item while it was a draft, read from the local workflow. Advice for
   * the owner only: never part of the published document, the release binding or any public page.
   */
  readonly jev?: { readonly kind: "marks"; readonly marks: ReadonlyMap<string, "keep" | "pass" | "unresolved"> } | { readonly kind: "unread" };
}

export type ManageState = ManageBlockedState | ManageReadyState;

const issueLines = (value: object): readonly string[] => {
  if (!("issues" in value) || !Array.isArray(value.issues)) return [];
  return value.issues.map((issue: { readonly at: string; readonly message: string }) =>
    `${issue.at}: ${issue.message}`,
  );
};

export async function loadManageState(
  env: Readonly<Record<string, string | undefined>> = process.env,
  narrative?: readonly NarrativeSelection[],
  options: { readonly includePortfolio?: boolean; readonly photos?: readonly PhotoSelection[]; readonly videos?: readonly VideoSelection[] } = {},
): Promise<ManageState> {
  const [leafLoad, policyLoad] = await Promise.all([
    loadLeafDocument(env),
    loadPublishPolicy(env),
  ]);

  if (!leafLoad.ok) {
    return {
      kind: "blocked",
      cause: "leaf-unavailable",
      heading: "No local leaf is ready",
      detail: leafLoad.detail,
      issues: issueLines(leafLoad),
    };
  }
  if (!policyLoad.ok) {
    return {
      kind: "blocked",
      cause: "policy-unavailable",
      heading: "Publication rules unreadable",
      detail: policyLoad.detail,
      issues: issueLines(policyLoad),
    };
  }

  let review = reviewForPublication({
    leaf: leafLoad.leaf,
    declaredExample: leafLoad.source.declaredExample,
    policy: policyLoad.policy,
    ...(narrative ? { narrative } : {}),
    includePortfolio: options.includePortfolio === true,
  });
  if (!review.ok) {
    return {
      kind: "blocked",
      cause: "publication-refused",
      heading: "Leaf not publishable",
      detail: "Gate refused the whole document. Nothing prepared.",
      issues: review.refusals.map((refusal) => `${refusal.at}: ${refusal.reason}`),
    };
  }

  let photoTransfer = "[]";
  if (options.photos?.length) {
    try { const chosen = await selectLocalPhotos(leafLoad.leaf, review, env, options.photos); review = chosen.review; photoTransfer = chosen.transfer; }
    catch (cause) { return { kind: "blocked", cause: "publication-refused", heading: "Photos need your review", detail: cause instanceof Error ? cause.message : "The selected photos could not be read.", issues: [] }; }
  }
  let videoTransfer = "[]";
  if (options.videos?.length) {
    try { const chosen = await selectLocalVideos(leafLoad.leaf, review, env, options.videos); review = chosen.review; videoTransfer = chosen.transfer; }
    catch (cause) { return { kind: "blocked", cause: "publication-refused", heading: "Clips need your review", detail: cause instanceof Error ? cause.message : "The selected clips could not be read.", issues: [] }; }
  }
  const photoChoices = await localPhotoChoices(leafLoad.leaf, review, env);
  const videoChoices = await localVideoChoices(leafLoad.leaf, review, env);
  const sourceDigest = leafLoad.source.documentDigest;
  const current = await loadPublishedLeaf(review.published.id, env);
  const candidate = buildPublishedDocument({
    review,
    // Preserve the stored instant for content comparison; a first preview uses the read time.
    // Publication assigns its own instant after the person confirms the reviewed content.
    publishedAt: current.ok ? current.document.publishedAt : new Date().toISOString(),
    documentDigest: sourceDigest,
    documentBytes: leafLoad.source.bytes,
    policyDigest: policyLoad.policyDigest,
  });
  if (!candidate.ok) {
    return {
      kind: "blocked",
      cause: "preview-unavailable",
      heading: "Preview failed",
      detail: "Failed Canopy's ingest contract. Nothing changed.",
      issues: candidate.issues.map((issue) => `${issue.at}: ${issue.message}`),
    };
  }
  const transferIssue = combinedMediaTransferIssue(candidate.document, photoTransfer, videoTransfer);
  if (transferIssue) return { kind: "blocked", cause: "publication-refused", heading: "Selection too large", detail: transferIssue, issues: [] };
  let publication: ManagedPublication;

  if (!current.ok) {
    if (current.cause === "unconfigured") {
      publication = { kind: "store-unconfigured", detail: current.detail };
    } else if (current.cause === "absent") {
      publication = { kind: "not-published", url: publishedUrl(review.published.id) };
    } else {
      publication = { kind: "unreadable", detail: current.detail };
    }
  } else {
    const diff = diffPublications(current.document, candidate.document);
    const samePolicy = current.document.source.policyDigest === policyLoad.policyDigest;
    publication = {
      kind: diff.identical && diff.sameSourceDocument && samePolicy ? "live" : "update-available",
      url: publishedUrl(review.published.id),
      document: current.document,
      artifactDigest: current.source.artifactDigest,
      diff,
      samePolicy,
    };
  }

  const directory = env["FOLIAGE_WORKFLOW_DIR"];
  let jev: NonNullable<ManageReadyState["jev"]> = { kind: "marks", marks: new Map() };
  if (directory) {
    try { jev = { kind: "marks", marks: await workflowJevMarks(join(directory, "workflow.json"), review.published.leaflets.map((l) => l.id)) }; }
    catch { jev = { kind: "unread" }; }
  }

  return {
    kind: "ready",
    includePortfolio: options.includePortfolio === true,
    leaf: leafLoad.leaf,
    photoChoices, photoTransfer, videoChoices, videoTransfer,
    sourcePath: leafLoad.source.path,
    sourceDigest,
    sourceBytes: leafLoad.source.bytes,
    policyDigest: policyLoad.policyDigest,
    ledger: attributionLedger(leafLoad.leaf),
    policySource: policyLoad.source.kind === "default" ? "Default rules" : policyLoad.source.path,
    review,
    preview: candidate.document,
    publication,
    jev,
  };
}

/** Binds the native review choice and its exact admitted authored content. */
export function portfolioReviewDigest(state: ManageReadyState): string {
  return documentDigest(Buffer.from(JSON.stringify([state.includePortfolio === true, state.preview.leaf.portfolio ? publicPortfolioJson(state.preview.leaf.portfolio) : null])));
}
