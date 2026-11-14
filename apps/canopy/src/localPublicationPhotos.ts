/** Explicit choices over current, policy-offered local media. No image is inferred or generated. */
import { MAX_PUBLIC_PHOTOS, publicPhotoIssue, type PublishedPhoto, type PublicationReview } from "@foliage/canopy";
import type { Leaf } from "@foliage/leaf";
import { mediaRootFromEnv, readMedia } from "@foliage/leaf-app/mediaStore";
import { checkPhotoBytes, PublicationPhotoError } from "./publicationPhotos.ts";

export interface PhotoSelection { readonly leaflet: number; readonly element: number; readonly digest: string; readonly alt: string; readonly caption: boolean }
export interface PhotoChoice {
  readonly leaflet: number; readonly element: number; readonly title: string; readonly caption: string | null;
  readonly photo: PublishedPhoto | null; readonly issue: string | null;
}
export async function localPhotoChoices(leaf: Leaf, review: Extract<PublicationReview, { ok: true }>, env: Readonly<Record<string, string | undefined>>): Promise<readonly PhotoChoice[]> {
  const offered = new Set(review.published.leaflets.map(l => l.id)), choices: PhotoChoice[] = [];
  for (const [li, leaflet] of leaf.leaflets.entries()) {
    if (!offered.has(leaflet.id)) continue;
    for (const [bi, element] of (leaflet.body ?? []).entries()) {
      if (!("media" in element) || element.media.mediaType === "video/mp4") continue;
      const base = { leaflet: li, element: bi, title: leaflet.title, caption: element.text?.trim() ? element.text : null };
      const read = await readMedia(mediaRootFromEnv(env), element.provenance.ref);
      if (!read.ok) { choices.push({ ...base, photo: null, issue: read.detail }); continue; }
      const photo: PublishedPhoto = { sourceRef: element.provenance.ref, renditionDigest: read.manifest.publishedDigest, bytes: read.bytes.length, format: read.format, alt: "" };
      try { checkPhotoBytes(photo, Buffer.from(read.bytes)); choices.push({ ...base, photo, issue: null }); }
      catch (cause) { choices.push({ ...base, photo: null, issue: cause instanceof Error ? cause.message : "The local rendition could not be checked." }); }
    }
  }
  return choices;
}
export async function selectLocalPhotos(leaf: Leaf, review: Extract<PublicationReview, { ok: true }>, env: Readonly<Record<string, string | undefined>>, selections: readonly PhotoSelection[]): Promise<{ review: Extract<PublicationReview, { ok: true }>; transfer: string }> {
  if (selections.length > MAX_PUBLIC_PHOTOS) throw new PublicationPhotoError(`Choose at most ${MAX_PUBLIC_PHOTOS} photos per publication.`);
  const offered = new Set(review.published.leaflets.map(l => l.id)), seen = new Set<string>(), images = new Map<string, string>(), selected = new Map<string, PublishedPhoto[]>();
  for (const selection of selections) {
    const original = leaf.leaflets[selection.leaflet], element = original?.body?.[selection.element], key = `${selection.leaflet}:${selection.element}`;
    if (!Number.isSafeInteger(selection.leaflet) || !Number.isSafeInteger(selection.element) || selection.leaflet < 0 || selection.element < 0 || !original || !offered.has(original.id) || !element || !("media" in element) || element.media.mediaType === "video/mp4" || seen.has(key)) throw new PublicationPhotoError("Choose each photo once from a currently offered Leaflet.");
    seen.add(key);
    const read = await readMedia(mediaRootFromEnv(env), element.provenance.ref);
    if (!read.ok) throw new PublicationPhotoError(read.detail);
    if (read.manifest.publishedDigest !== selection.digest) throw new PublicationPhotoError("The image changed since its preview. Review the current rendition before selecting it.");
    const photo: PublishedPhoto = { sourceRef: element.provenance.ref, renditionDigest: read.manifest.publishedDigest, bytes: read.bytes.length, format: read.format, alt: selection.alt, ...(selection.caption ? { caption: element.text ?? "" } : {}) };
    const issue = publicPhotoIssue(photo); if (issue) throw new PublicationPhotoError(issue);
    const bytes = Buffer.from(read.bytes); checkPhotoBytes(photo, bytes);
    const rows = selected.get(original.id) ?? [];
    if (rows.some(p => p.sourceRef === photo.sourceRef)) throw new PublicationPhotoError("The same image was selected twice in this Leaflet.");
    rows.push(photo); selected.set(original.id, rows); images.set(photo.renditionDigest, bytes.toString("base64"));
  }
  return { review: { ...review, published: { ...review.published, leaflets: review.published.leaflets.map(l => selected.has(l.id) ? { ...l, photos: selected.get(l.id)! } : l) } },
    transfer: JSON.stringify([...images].map(([digest, base64]) => ({ digest, base64 }))) };
}
