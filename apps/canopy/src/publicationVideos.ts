/** Exact-byte admission for explicitly selected captured MP4s. */
import { documentDigest, MAX_PUBLIC_VIDEOS, MAX_PUBLIC_VIDEO_BYTES, toArtifactJson, type PublishedLeafDocument, type PublishedVideo } from "@foliage/canopy";
import { isCapturedMp4 } from "@foliage/leaf-app/videoStore";

export interface VideoBytes { readonly digest: string; readonly bytes: Buffer }
export class PublicationVideoError extends Error { readonly code = "invalid-videos"; }

// The hosted function accepts at most 4 MiB, and two base64-encoded clips plus four
// base64-encoded photos can exceed that despite every file satisfying its own limit.
// Reserve 32 KiB for consent, evidence and multipart fields so every admitted media
// selection can reach the actual hosted review instead of dying as an opaque 413.
export const MAX_HOSTED_REVIEW_FIELDS_BYTES = 3_900_000;
export function combinedMediaTransferIssue(document: PublishedLeafDocument, photos: string, videos: string): string | null {
  const bytes = Buffer.byteLength(JSON.stringify(toArtifactJson(document))) + Buffer.byteLength(photos) +
    Buffer.byteLength(videos) + 32 * 1024;
  return bytes > MAX_HOSTED_REVIEW_FIELDS_BYTES
    ? "This image and demo selection exceeds the hosted upload limit. Choose fewer items and preview again."
    : null;
}

export function videoReferences(document: PublishedLeafDocument): readonly PublishedVideo[] {
  return document.leaf.leaflets.flatMap(leaflet => leaflet.videos ?? []);
}

export function checkVideoBytes(video: PublishedVideo, bytes: Buffer): void {
  if (bytes.length !== video.bytes || bytes.length > MAX_PUBLIC_VIDEO_BYTES ||
      documentDigest(bytes) !== video.sourceRef || !isCapturedMp4(bytes)) {
    throw new PublicationVideoError("Selected clip bytes differ from their reviewed size, H.264 MP4 container or evidence digest.");
  }
}

/** Canonical base64 is a bounded device transport only; no video bytes enter the artifact. */
export function decodeVideoTransfer(document: PublishedLeafDocument, text = "[]"): readonly VideoBytes[] {
  if (Buffer.byteLength(text) > Math.ceil(MAX_PUBLIC_VIDEO_BYTES * MAX_PUBLIC_VIDEOS / 3) * 4 + 1024) {
    throw new PublicationVideoError("Selected clip transfer exceeds its limit.");
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new PublicationVideoError("Selected clip transfer is not readable JSON."); }
  const refs = videoReferences(document), expected = new Map(refs.map(video => [video.sourceRef, video]));
  if (!Array.isArray(raw) || raw.length !== expected.size || raw.length > MAX_PUBLIC_VIDEOS) {
    throw new PublicationVideoError("Supply exactly the selected clips, with no missing or extra bytes.");
  }
  const seen = new Set<string>();
  return raw.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 ||
        !("digest" in value) || !("base64" in value) || typeof value.digest !== "string" ||
        typeof value.base64 !== "string") throw new PublicationVideoError("Each clip transfer needs only a digest and encoded MP4.");
    const video = expected.get(value.digest);
    if (!video || seen.has(value.digest) || value.base64.length > Math.ceil(MAX_PUBLIC_VIDEO_BYTES / 3) * 4 + 4) {
      throw new PublicationVideoError("A clip was repeated, unselected or exceeds its limit.");
    }
    const bytes = Buffer.from(value.base64, "base64");
    if (bytes.toString("base64") !== value.base64) throw new PublicationVideoError("Clip encoding is not canonical base64.");
    for (const ref of refs.filter(item => item.sourceRef === value.digest)) checkVideoBytes(ref, bytes);
    seen.add(value.digest);
    return { digest: value.digest, bytes };
  });
}
