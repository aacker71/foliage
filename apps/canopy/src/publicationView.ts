/** One fully assembled reader document for both hosted reads and private previews. */
import type { PublishedLeafDocument } from "@foliage/canopy";
import { publicationBytes } from "./hostedAdmission.ts";
import { renderPublishedLeafletPage, renderPublishedPage, type PrivatePreviewMode } from "./renderPublished.ts";
import { inlineSprite, readSprite } from "./sprite.mjs";
import { checkPortfolioLeafBundle } from "@foliage/ui/portfolio-leaf-bundle";

export async function publicationView(document: PublishedLeafDocument, digest: string, photoPrefix = `/leaf/${document.leaf.id}/media/${digest.slice(7)}`, preview?: PrivatePreviewMode, videoPrefix = `/leaf/${document.leaf.id}/video/${digest.slice(7)}`): Promise<string> {
  const bundle = document.leaf.leaflets.length ? await checkPortfolioLeafBundle() : null;
  const html = renderPublishedPage({ ok: true, id: String(document.leaf.id), document,
    source: { path: "hosted-authority", bytes: publicationBytes(document).length, artifactDigest: digest, readAt: new Date().toISOString() } }, { enhancePortfolio: bundle?.ok === true, photoUrl: photo => `${photoPrefix}/${photo.renditionDigest.slice(7)}`, videoUrl: video => `${videoPrefix}/${video.sourceRef.slice(7)}`, ...(preview ? { preview } : {}) });
  return withSprite(html);
}

/** One admitted leaflet, resolved from the same current artifact as the hosted portfolio. */
export async function publicationLeafletView(document: PublishedLeafDocument, digest: string, leafletId: string): Promise<string | null> {
  const photoPrefix = `/leaf/${document.leaf.id}/media/${digest.slice(7)}`;
  const videoPrefix = `/leaf/${document.leaf.id}/video/${digest.slice(7)}`;
  const html = renderPublishedLeafletPage(document, leafletId, photo => `${photoPrefix}/${photo.renditionDigest.slice(7)}`, video => `${videoPrefix}/${video.sourceRef.slice(7)}`);
  return html === null ? null : withSprite(html);
}

async function withSprite(html: string): Promise<string> {
  // Proof badges use fragment references and need symbols in this document.
  const output = inlineSprite(await readSprite(), html);
  if (!output.injected) throw new Error("The publication renderer did not supply a document body.");
  return output.html;
}
