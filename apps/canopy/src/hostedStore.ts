import { createDistributionStore } from "./distributionStore.ts";
/** Closed-plane persistence. Actor/admission arguments come from verified server code, never request claims. */
import { decodePhotoTransfer, photoReferences, checkPhotoBytes } from "./publicationPhotos.ts";
import { decodeVideoTransfer, videoReferences, checkVideoBytes } from "./publicationVideos.ts";
import { randomUUID } from "node:crypto";
import {
  DOCUMENT_DIGEST, PUBLISHED_ID, documentDigest, parsePublishedDocument, toArtifactJson,
  type PublishedLeafDocument,
} from "@foliage/canopy";

export const PUBLICATION_BUCKET = "foliage-publications";
const MAX_PUBLICATION_BYTES = 2 * 1024 * 1024;
import type { HostedActor } from "./hostedIdentity.ts";
import type { VerifiedPublicationAdmission } from "./hostedAdmission.ts";
export interface PublicationOperation {
  readonly operationId: string;
  readonly subjectId: string;
  readonly expectedRevisionId: string | null;
  readonly expectedGeneration: number;
}
export interface PublishOperation extends PublicationOperation {
  readonly document: unknown;
  readonly photos?: string;
  readonly videos?: string;
  readonly admission: VerifiedPublicationAdmission;
}
export interface PublicationState {
  readonly subjectId: string;
  readonly revisionId: string | null;
  readonly generation: number;
  readonly visible: boolean;
}
export interface PublicationReceipt {
  readonly operationId: string;
  readonly subjectId: string;
  readonly kind: "publish" | "withdraw";
  readonly revisionId: string | null;
  readonly generation: number;
  readonly committedAt: string;
}
export interface PublicationResult {
  readonly receipt: PublicationReceipt;
  readonly replayed: boolean;
  readonly current: PublicationState;
}
export interface OwnedPublication extends PublicationState { readonly actorId: string }
export interface HostedPublicRead {
  readonly document: PublishedLeafDocument;
  readonly revisionId: string;
  readonly generation: number;
  readonly artifactDigest: string;
}
export type HostedStoreErrorCode = "invalid" | "forbidden" | "conflict" | "unavailable" | "corrupt" | "outcome_unknown" | "address-limit";
export class HostedStoreError extends Error {
  readonly code: HostedStoreErrorCode;
  constructor(code: HostedStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options); this.name = "HostedStoreError"; this.code = code;
  }
}
/**
 * Addresses one account may reserve. They are permanent, so three leave room for a second
 * portfolio and one mistaken name while scripted squatting costs an account per three names.
 * foliage_reserve_subject (202610090001_address_cap.sql) enforces the same number.
 */
export const MAX_ADDRESSES_PER_ACCOUNT = 3;
export function addressLimitError(): HostedStoreError {
  return new HostedStoreError("address-limit", `This account already has ${MAX_ADDRESSES_PER_ACCOUNT} portfolio addresses, the most one account can reserve. Addresses are permanent, so ones taken offline still count. Contact support to raise the limit.`);
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const operationId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const generation = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function fail(code: HostedStoreErrorCode, message: string): never { throw new HostedStoreError(code, message); }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("corrupt", "Invalid authority response.");
  return value as Record<string, unknown>;
}
function actorId(actor: HostedActor): string {
  if (!uuid(actor?.id)) fail("invalid", "A verified server actor UUID is required.");
  return actor.id.toLowerCase();
}
function subjectId(value: string): string {
  if (typeof value !== "string" || !PUBLISHED_ID.test(value)) fail("invalid", "Invalid publication identifier.");
  return value;
}
function validateOperation(input: PublicationOperation): void {
  subjectId(input.subjectId);
  if (!operationId(input.operationId) || !generation(input.expectedGeneration) ||
      input.expectedRevisionId !== null && !uuid(input.expectedRevisionId)) fail("invalid", "Invalid operation or reviewed authority version.");
}
function state(value: unknown, expectedSubject?: string): PublicationState {
  const row = record(value);
  if (typeof row["subjectId"] !== "string" || !PUBLISHED_ID.test(row["subjectId"]) ||
      expectedSubject !== undefined && row["subjectId"] !== expectedSubject ||
      row["revisionId"] !== null && !uuid(row["revisionId"]) || !generation(row["generation"]) ||
      row["visible"] !== (row["revisionId"] !== null)) fail("corrupt", "Invalid publication authority state.");
  return { subjectId: row["subjectId"], revisionId: row["revisionId"] as string | null,
    generation: row["generation"] as number, visible: row["visible"] as boolean };
}
function result(value: unknown): { result: PublicationResult; requestHash: string } {
  const row = record(value), receipt = record(row["receipt"]);
  if (!operationId(receipt["operationId"]) || typeof receipt["subjectId"] !== "string" ||
      !PUBLISHED_ID.test(receipt["subjectId"]) || !["publish", "withdraw"].includes(String(receipt["kind"])) ||
      !generation(receipt["generation"]) || typeof receipt["committedAt"] !== "string" ||
      !Number.isFinite(Date.parse(receipt["committedAt"])) || typeof row["replayed"] !== "boolean" ||
      typeof row["requestHash"] !== "string" || !DOCUMENT_DIGEST.test(row["requestHash"]) ||
      (receipt["kind"] === "publish" ? !uuid(receipt["revisionId"]) : receipt["revisionId"] !== null)) {
    fail("corrupt", "Invalid publication operation receipt.");
  }
  return { requestHash: row["requestHash"], result: {
    receipt: receipt as unknown as PublicationReceipt, replayed: row["replayed"],
    current: state(row["current"], receipt["subjectId"]),
  } };
}
async function responseBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > limit) { await reader.cancel(); fail("corrupt", "Storage response exceeds its byte limit."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function createHostedStore(options: {
  supabaseUrl: string; serviceRoleKey: string; bucket?: string; fetch?: typeof fetch; timeoutMs?: number;
}) {
  const base = new URL(options.supabaseUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if ((base.protocol !== "https:" && !(loopback && base.protocol === "http:")) ||
      base.username || base.password || base.search || base.hash || base.pathname !== "/" ||
      !options.serviceRoleKey || options.bucket !== undefined && options.bucket !== PUBLICATION_BUCKET) {
    fail("invalid", "Use a server-configured Supabase origin, service credential and private publication bucket.");
  }
  const runFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail("invalid", "Invalid storage request timeout.");
  async function request(path: string, method: string, body?: string | Buffer, contentType = "application/json"): Promise<Response> {
    try {
      const init: RequestInit & { cache: "no-store" } = { method, redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs), headers: {
          apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}`,
          "content-type": contentType, "cache-control": "no-store", "x-upsert": "false",
        }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : Uint8Array.from(body).buffer }) };
      return await runFetch(new URL(path, base), init);
    } catch (cause) { throw new HostedStoreError("unavailable", "Storage service did not acknowledge the request.", { cause }); }
  }
  async function rpc(name: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await request(`/rest/v1/rpc/${name}`, "POST", JSON.stringify(params));
    const bytes = await responseBytes(response, MAX_PUBLICATION_BYTES);
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { fail("unavailable", "Authority service returned an unreadable response."); }
    if (!response.ok) {
      const message = typeof value === "object" && value !== null && "message" in value ? value.message : undefined;
      if (message === "foliage_forbidden") fail("forbidden", "The verified actor does not own this publication.");
      if (message === "foliage_conflict") fail("conflict", "Operation or review changed. Reload.");
      if (message === "foliage_invalid") fail("invalid", "The authority service refused invalid publication input.");
      if (message === "foliage_address_limit") throw addressLimitError();
      fail("unavailable", `Authority service failed (${response.status}).`);
    }
    return value;
  }
  async function lookup(actor: string, id: string) {
    const value = await rpc("foliage_get_operation", { p_actor: actor, p_operation_id: id });
    if (value === null) return null;
    const saved = result(value);
    if (saved.result.receipt.operationId !== id) fail("corrupt", "Authority returned a different operation.");
    return saved;
  }
  async function privateBucket(): Promise<void> {
    const response = await request(`/storage/v1/bucket/${PUBLICATION_BUCKET}`, "GET");
    if (!response.ok) fail("unavailable", "Publication bucket configuration could not be checked.");
    let bucket: Record<string, unknown>;
    try { bucket = record(JSON.parse((await responseBytes(response, 16_384)).toString("utf8"))); }
    catch { fail("corrupt", "Publication bucket configuration is invalid."); }
    if (bucket["id"] !== PUBLICATION_BUCKET || bucket["public"] !== false) fail("forbidden", "Publication storage must remain private.");
  }
  async function commit(params: Record<string, unknown>, input: PublicationOperation): Promise<PublicationResult> {
    try {
      const saved = result(await rpc("foliage_commit_publication", params));
      if (saved.result.receipt.operationId !== input.operationId || saved.result.receipt.subjectId !== input.subjectId ||
          saved.requestHash !== params["p_request_hash"]) fail("corrupt", "Authority returned a mismatched operation receipt.");
      return saved.result;
    } catch (cause) {
      if (cause instanceof HostedStoreError && ["invalid", "forbidden", "conflict"].includes(cause.code)) throw cause;
      throw new HostedStoreError("outcome_unknown", `Publication outcome is unknown. Check operation ${input.operationId} before retrying.`, { cause });
    }
  }
  async function head(id: string) {
    const value = await rpc("foliage_publication_head", { p_subject: id });
    if (value === null) return null;
    const row = record(value), current = state(row, id);
    if (!current.visible || typeof row["objectKey"] !== "string" ||
        !/^[0-9a-f-]{36}\/[a-z0-9-]{1,64}\/[0-9a-f-]{36}\.json$/.test(row["objectKey"]) ||
        typeof row["artifactDigest"] !== "string" || !DOCUMENT_DIGEST.test(row["artifactDigest"]) ||
        !Number.isSafeInteger(row["artifactBytes"]) || Number(row["artifactBytes"]) < 1 ||
        Number(row["artifactBytes"]) > MAX_PUBLICATION_BYTES) fail("corrupt", "Invalid publication object reference.");
    if (row["objectKey"].split("/")[1] !== id || !uuid(row["objectKey"].split("/")[0]) || row["objectKey"].split("/")[2] !== `${current.revisionId}.json`) fail("corrupt", "Publication object scope differs from its current authority.");
    return { ...current, revisionId: current.revisionId!, objectKey: row["objectKey"],
      artifactDigest: row["artifactDigest"], artifactBytes: row["artifactBytes"] as number };
  }
  async function readPublic(id: string): Promise<HostedPublicRead | null> {
      subjectId(id);
      const current = await head(id); if (!current) return null;
      await privateBucket();
      const response = await request(`/storage/v1/object/authenticated/${PUBLICATION_BUCKET}/${current.objectKey}`, "GET");
      if (!response.ok) fail("unavailable", "Committed publication bytes are unavailable; its authority and receipt remain intact.");
      const bytes = await responseBytes(response, MAX_PUBLICATION_BYTES);
      if (bytes.length !== current.artifactBytes || documentDigest(bytes) !== current.artifactDigest) fail("corrupt", "Committed publication bytes failed integrity checking.");
      let value: unknown;
      try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("corrupt", "Committed publication bytes are not JSON."); }
      const parsed = parsePublishedDocument(value);
      if (!parsed.ok || parsed.document.leaf.id !== id) fail("corrupt", "Committed publication failed its public document contract.");
      const latest = await head(id);
      if (!latest || latest.revisionId !== current.revisionId || latest.generation !== current.generation) return null;
      return { document: parsed.document, revisionId: current.revisionId,
        generation: current.generation, artifactDigest: current.artifactDigest };
  }
  return {
    distribution: createDistributionStore(rpc),
    /** Health only: one read-only head lookup for an address no subject can have. Nothing is returned. */
    async ping(): Promise<void> { await rpc("foliage_publication_head", { p_subject: "" }); },
    async reserveSubject(actor: HostedActor, id: string): Promise<OwnedPublication> {
      const owner = actorId(actor);
      const value = record(await rpc("foliage_reserve_subject", { p_actor: owner, p_subject: subjectId(id) }));
      if (value["actorId"] !== owner) fail("corrupt", "Authority returned a different owner.");
      return { ...state(value, id), actorId: owner };
    },
    async operation(actor: HostedActor, id: string): Promise<PublicationResult | null> {
      if (!operationId(id)) fail("invalid", "Invalid operation identifier.");
      return (await lookup(actorId(actor), id))?.result ?? null;
    },
    async publish(actor: HostedActor, input: PublishOperation): Promise<PublicationResult> {
      const owner = actorId(actor); validateOperation(input);
      const parsed = parsePublishedDocument(input.document);
      if (!parsed.ok || ![3, 4, 5, 6, 7].includes(parsed.document.artifactVersion) || parsed.document.leaf.id !== input.subjectId) {
        fail("invalid", "A valid current-format publication for this subject is required.");
      }
      const bytes = JSON.stringify(toArtifactJson(parsed.document));
      if (Buffer.byteLength(bytes) > MAX_PUBLICATION_BYTES) fail("invalid", "Publication exceeds its byte limit.");
      const digest = documentDigest(Buffer.from(bytes));
      const requestHash = documentDigest(Buffer.from(JSON.stringify(["foliage-publication-operation", 1,
        owner, input.operationId, input.subjectId, "publish", input.expectedRevisionId,
        input.expectedGeneration, digest])));
      const previous = await lookup(owner, input.operationId);
      if (previous) {
        if (previous.requestHash !== requestHash) fail("conflict", "This operation already records different publication input.");
        return previous.result;
      }
      const proof = input.admission;
      if (!proof || typeof proof.actorId !== "string" || proof.actorId.toLowerCase() !== owner || proof.subjectId !== input.subjectId ||
          proof.operationId !== input.operationId || proof.artifactDigest !== digest ||
          proof.policyDigest !== parsed.document.source.policyDigest || !DOCUMENT_DIGEST.test(proof.policyDigest) ||
          proof.expectedRevisionId !== input.expectedRevisionId || proof.expectedGeneration !== input.expectedGeneration ||
          !DOCUMENT_DIGEST.test(proof.admissionId) || !DOCUMENT_DIGEST.test(proof.consentId)) {
        fail("forbidden", "Consent doesn't match this operation. Review again.");
      }
      const photos = decodePhotoTransfer(parsed.document, input.photos ?? "[]");
      const videos = decodeVideoTransfer(parsed.document, input.videos ?? "[]");
      await privateBucket();
      const revisionId = randomUUID();
      const objectKey = `${owner}/${input.subjectId}/${revisionId}.json`;
      // The canonical artifact contains the complete selected image manifest, so its digest
      // also binds the image set to admission, operation identity and the existing SQL commit.
      // Stage every rendition before committing that artifact; derived keys stay revision-scoped.
      for (const photo of photos) {
        const ref = photoReferences(parsed.document).find(p => p.renditionDigest === photo.digest)!;
        const key = `${owner}/${input.subjectId}/${revisionId}/${photo.digest.slice(7)}.${ref.format}`;
        const staged = await request(`/storage/v1/object/${PUBLICATION_BUCKET}/${key}`, "POST", photo.bytes, `image/${ref.format}`);
        if (!staged.ok) fail("unavailable", `Private image staging failed (${staged.status}); no publication commit was attempted.`);
      }
      for (const video of videos) {
        const key = `${owner}/${input.subjectId}/${revisionId}/${video.digest.slice(7)}.mp4`;
        const staged = await request(`/storage/v1/object/${PUBLICATION_BUCKET}/${key}`, "POST", video.bytes, "video/mp4");
        if (!staged.ok) fail("unavailable", `Private video staging failed (${staged.status}); no publication commit was attempted.`);
      }
      const uploaded = await request(`/storage/v1/object/${PUBLICATION_BUCKET}/${objectKey}`, "POST", bytes);
      if (!uploaded.ok) fail("unavailable", `Upload failed (${uploaded.status}). Retry.`);
      // Never delete staged bytes on an uncertain commit: another attempt may have committed them.
      return commit({ p_actor: owner, p_operation_id: input.operationId, p_subject: input.subjectId,
        p_request_hash: requestHash, p_kind: "publish", p_expected_revision: input.expectedRevisionId,
        p_expected_generation: input.expectedGeneration, p_revision: revisionId, p_object_key: objectKey,
        p_artifact_digest: digest, p_artifact_bytes: Buffer.byteLength(bytes), p_admission: {
          actorId: owner, subjectId: proof.subjectId, operationId: proof.operationId,
          expectedRevisionId: proof.expectedRevisionId, expectedGeneration: proof.expectedGeneration,
          artifactDigest: proof.artifactDigest, policyDigest: proof.policyDigest,
          admissionId: proof.admissionId, consentId: proof.consentId,
          ...(proof.sourceVerification ? { sourceVerification: proof.sourceVerification } : {}),
        } }, input);
    },
    async withdraw(actor: HostedActor, input: PublicationOperation): Promise<PublicationResult> {
      const owner = actorId(actor); validateOperation(input);
      const requestHash = documentDigest(Buffer.from(JSON.stringify(["foliage-publication-operation", 1,
        owner, input.operationId, input.subjectId, "withdraw", input.expectedRevisionId, input.expectedGeneration])));
      const previous = await lookup(owner, input.operationId);
      if (previous) {
        if (previous.requestHash !== requestHash) fail("conflict", "This operation already records different publication input.");
        return previous.result;
      }
      return commit({ p_actor: owner, p_operation_id: input.operationId, p_subject: input.subjectId,
        p_request_hash: requestHash, p_kind: "withdraw", p_expected_revision: input.expectedRevisionId,
        p_expected_generation: input.expectedGeneration, p_revision: null, p_object_key: null,
        p_artifact_digest: null, p_artifact_bytes: null, p_admission: null }, input);
    },
    readPublic,
    async readPhoto(id: string, artifactDigest: string, renditionDigest: string) {
      if (!DOCUMENT_DIGEST.test(artifactDigest) || !DOCUMENT_DIGEST.test(renditionDigest)) return null;
      const publication = await readPublic(id);
      if (!publication || publication.artifactDigest !== artifactDigest) return null;
      const ref = photoReferences(publication.document).find(p => p.renditionDigest === renditionDigest);
      if (!ref) return null;
      const current = await head(id);
      if (!current || current.revisionId !== publication.revisionId || current.generation !== publication.generation) return null;
      const key = `${current.objectKey.slice(0, -5)}/${renditionDigest.slice(7)}.${ref.format}`;
      const response = await request(`/storage/v1/object/authenticated/${PUBLICATION_BUCKET}/${key}`, "GET");
      if (!response.ok) fail("unavailable", "The committed photo is unavailable; publication authority remains intact.");
      const bytes = await responseBytes(response, ref.bytes);
      try { checkPhotoBytes(ref, bytes); } catch { fail("corrupt", "The committed photo failed its byte and metadata checks."); }
      const latest = await head(id);
      if (!latest || latest.revisionId !== current.revisionId || latest.generation !== current.generation) return null;
      return { bytes, contentType: `image/${ref.format}` };
    },
    async readVideo(id: string, artifactDigest: string, videoDigest: string) {
      if (!DOCUMENT_DIGEST.test(artifactDigest) || !DOCUMENT_DIGEST.test(videoDigest)) return null;
      const publication = await readPublic(id);
      if (!publication || publication.artifactDigest !== artifactDigest) return null;
      const ref = videoReferences(publication.document).find(v => v.sourceRef === videoDigest);
      if (!ref) return null;
      const current = await head(id);
      if (!current || current.revisionId !== publication.revisionId || current.generation !== publication.generation) return null;
      const key = `${current.objectKey.slice(0, -5)}/${videoDigest.slice(7)}.mp4`;
      const response = await request(`/storage/v1/object/authenticated/${PUBLICATION_BUCKET}/${key}`, "GET");
      if (!response.ok) fail("unavailable", "The committed clip is unavailable; publication authority remains intact.");
      const bytes = await responseBytes(response, ref.bytes);
      try { checkVideoBytes(ref, bytes); } catch { fail("corrupt", "The committed clip failed its byte and container checks."); }
      const latest = await head(id);
      if (!latest || latest.revisionId !== current.revisionId || latest.generation !== current.generation) return null;
      return { bytes, contentType: "video/mp4" };
    },
    async listOwned(actor: HostedActor, options: { after?: string; limit?: number } = {}): Promise<readonly OwnedPublication[]> {
      const owner = actorId(actor), limit = options.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail("invalid", "Inventory limit must be between 1 and 200.");
      if (options.after !== undefined) subjectId(options.after);
      const value = await rpc("foliage_owned_publications", { p_actor: owner, p_after: options.after ?? null, p_limit: limit });
      if (!Array.isArray(value) || value.length > limit) fail("corrupt", "Invalid owned publication inventory.");
      return value.map(raw => {
        const row = record(raw);
        if (row["actorId"] !== owner) fail("corrupt", "Inventory returned a different owner.");
        return { ...state(row), actorId: owner };
      });
    },
  };
}
export type HostedStore = Omit<ReturnType<typeof createHostedStore>, "distribution">;
