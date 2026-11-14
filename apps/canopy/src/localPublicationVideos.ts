/** Owner-selected clips from currently offered, reviewed Leaflet body media. */
import { MAX_PUBLIC_VIDEOS, publicVideoIssue, type PublishedVideo, type PublicationReview } from "@foliage/canopy";
import type { Leaf } from "@foliage/leaf";
import { readVideo, videoRootFromEnv } from "@foliage/leaf-app/videoStore";
import { checkVideoBytes, PublicationVideoError } from "./publicationVideos.ts";

export interface VideoSelection { readonly leaflet: number; readonly element: number; readonly digest: string; readonly caption: boolean }
export interface VideoChoice {
  readonly leaflet: number;
  readonly element: number;
  readonly title: string;
  readonly caption: string | null;
  readonly video: PublishedVideo | null;
  readonly issue: string | null;
}

export async function localVideoChoices(leaf: Leaf, review: Extract<PublicationReview, { ok: true }>, env: Readonly<Record<string, string | undefined>>): Promise<readonly VideoChoice[]> {
  const offered = new Set(review.published.leaflets.map(l => l.id)), choices: VideoChoice[] = [];
  for (const [li, leaflet] of leaf.leaflets.entries()) {
    if (!offered.has(leaflet.id)) continue;
    for (const [bi, element] of (leaflet.body ?? []).entries()) {
      if (!("media" in element) || element.media.mediaType !== "video/mp4") continue;
      const base = { leaflet: li, element: bi, title: leaflet.title, caption: element.text?.trim() ? element.text : null };
      const read = await readVideo(videoRootFromEnv(env), element.provenance.ref);
      if (!read.ok) { choices.push({ ...base, video: null, issue: read.detail }); continue; }
      const poster = (leaflet.body ?? []).some(candidate => "media" in candidate &&
        candidate.media.mediaType.startsWith("image/") && candidate.provenance.ref === read.metadata.posterRef);
      const video: PublishedVideo = { sourceRef: read.ref, bytes: read.bytes.length,
        durationSeconds: read.metadata.durationSeconds, posterRef: read.metadata.posterRef };
      const issue = !poster ? "The reviewed still from this capture is missing from this Leaflet." : publicVideoIssue(video);
      if (issue) choices.push({ ...base, video: null, issue });
      else choices.push({ ...base, video, issue: null });
    }
  }
  return choices;
}

export async function selectLocalVideos(leaf: Leaf, review: Extract<PublicationReview, { ok: true }>, env: Readonly<Record<string, string | undefined>>, selections: readonly VideoSelection[]): Promise<{ review: Extract<PublicationReview, { ok: true }>; transfer: string }> {
  if (selections.length > MAX_PUBLIC_VIDEOS) throw new PublicationVideoError(`Choose at most ${MAX_PUBLIC_VIDEOS} clips per publication.`);
  const offered = new Map(review.published.leaflets.map(l => [l.id, l] as const)), seen = new Set<string>();
  const chosen = new Map<string, PublishedVideo[]>(), transfers = new Map<string, string>();
  for (const selection of selections) {
    const leaflet = leaf.leaflets[selection.leaflet], element = leaflet?.body?.[selection.element];
    const key = `${selection.leaflet}:${selection.element}`;
    const published = leaflet ? offered.get(leaflet.id) : undefined;
    if (!Number.isSafeInteger(selection.leaflet) || !Number.isSafeInteger(selection.element) ||
        selection.leaflet < 0 || selection.element < 0 || !leaflet || !published || !element ||
        !("media" in element) || element.media.mediaType !== "video/mp4" || seen.has(key)) {
      throw new PublicationVideoError("Choose each clip once from a currently offered Leaflet.");
    }
    seen.add(key);
    const read = await readVideo(videoRootFromEnv(env), element.provenance.ref);
    if (!read.ok) throw new PublicationVideoError(read.detail);
    if (read.ref !== selection.digest) throw new PublicationVideoError("The clip changed since preview. Review the current bytes again.");
    if (!published.photos?.some(photo => photo.sourceRef === read.metadata.posterRef)) {
      throw new PublicationVideoError("Select this capture's reviewed still as a photo before sharing its clip.");
    }
    const video: PublishedVideo = { sourceRef: read.ref, bytes: read.bytes.length,
      durationSeconds: read.metadata.durationSeconds, posterRef: read.metadata.posterRef,
      ...(selection.caption ? { caption: element.text ?? "" } : {}) };
    const issue = publicVideoIssue(video); if (issue) throw new PublicationVideoError(issue);
    checkVideoBytes(video, read.bytes);
    const rows = chosen.get(leaflet.id) ?? [];
    if (rows.some(item => item.sourceRef === video.sourceRef) || transfers.has(video.sourceRef)) {
      throw new PublicationVideoError("The same clip was selected twice.");
    }
    rows.push(video); chosen.set(leaflet.id, rows); transfers.set(video.sourceRef, read.bytes.toString("base64"));
  }
  return { review: { ...review, published: { ...review.published, leaflets: review.published.leaflets.map(l =>
    chosen.has(l.id) ? { ...l, videos: chosen.get(l.id)! } : l) } },
    transfer: JSON.stringify([...transfers].map(([digest, base64]) => ({ digest, base64 }))) };
}
