/** Byte admission shared by local review, hosted staging and every image read. */
import { documentDigest, MAX_PUBLIC_PHOTOS, MAX_PUBLIC_PHOTO_BYTES, type PublishedLeafDocument, type PublishedPhoto } from "@foliage/canopy";
import { publishedFormatOf, stripKnownContainer } from "@foliage/leaf-app/mediaStore";

const MAX_PHOTO_TRANSFER_BYTES = 3 * 1024 * 1024;
export interface PhotoBytes { readonly digest: string; readonly bytes: Buffer }
export class PublicationPhotoError extends Error {
  readonly code = "invalid-photos";
}
export function photoReferences(document: PublishedLeafDocument): readonly PublishedPhoto[] {
  return document.leaf.leaflets.flatMap(l => l.photos ?? []);
}
export function checkPhotoBytes(photo: PublishedPhoto, bytes: Buffer): void {
  if (bytes.length !== photo.bytes || bytes.length > MAX_PUBLIC_PHOTO_BYTES || documentDigest(bytes) !== photo.renditionDigest || publishedFormatOf(bytes) !== photo.format) throw new PublicationPhotoError("The selected photo bytes differ from their reviewed size, container or digest.");
  const stripped = stripKnownContainer(bytes);
  if (!stripped?.ok || stripped.report.removed.length || !Buffer.from(stripped.bytes).equals(bytes)) throw new PublicationPhotoError("The photo contains metadata or an unsupported container structure. Strip and review it locally again.");
}
/** Canonical base64 is a bounded device transport only; it never enters the public artifact. */
export function decodePhotoTransfer(document: PublishedLeafDocument, text = "[]"): readonly PhotoBytes[] {
  if (Buffer.byteLength(text) > MAX_PHOTO_TRANSFER_BYTES) throw new PublicationPhotoError("The selected photo transfer exceeds its limit.");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new PublicationPhotoError("The selected photo transfer is not readable JSON."); }
  const refs = photoReferences(document), expected = new Map(refs.map(p => [p.renditionDigest, p]));
  if (!Array.isArray(raw) || raw.length !== expected.size || raw.length > MAX_PUBLIC_PHOTOS) throw new PublicationPhotoError("Supply exactly the selected photos, with no missing or extra images.");
  const seen = new Set<string>();
  return raw.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 || !("digest" in value) || !("base64" in value) || typeof value.digest !== "string" || typeof value.base64 !== "string") throw new PublicationPhotoError("Each image transfer must contain only its digest and encoded rendition.");
    const photo = expected.get(value.digest);
    if (!photo || seen.has(value.digest) || value.base64.length > Math.ceil(MAX_PUBLIC_PHOTO_BYTES / 3) * 4) throw new PublicationPhotoError("An image was repeated, unselected or exceeds its limit.");
    const bytes = Buffer.from(value.base64, "base64");
    if (bytes.toString("base64") !== value.base64) throw new PublicationPhotoError("Image encoding is not canonical base64.");
    for (const ref of refs.filter(p => p.renditionDigest === value.digest)) checkPhotoBytes(ref, bytes);
    seen.add(value.digest);
    return { digest: value.digest, bytes };
  });
}
