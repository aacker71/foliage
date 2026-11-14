/** Public presentation accepts the already-admitted artifact, never a private Leaf. */
import { publicClaimAnchor, publicCitationAnchor, type PublishedLeafDocument, type PublishedPortfolio } from "@foliage/canopy";
import { renderPersonHero, renderKeystones } from "@foliage/ui/person-portfolio";
import { ACHIEVEMENT_CLAIM_LABELS as LABEL, type ClaimCitation } from "@foliage/leaf";
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const publicCollectionIds = (portfolio: PublishedPortfolio | undefined, id: string, kind: "leaflets" | "achievements"): readonly string[] => (portfolio?.collections ?? []).filter(c => c[kind].some(member => member === id)).map(c => c.id);

export function renderAuthoredHero(document: PublishedLeafDocument, composition: "split" | "stacked" = "split"): string {
  const p = document.leaf.portfolio?.profile;
  const html = renderPersonHero({ subject: document.leaf.subject, ...(document.leaf.portfolio?.headline ? { headline: document.leaf.portfolio.headline } : {}), ...(p?.bio ? { biography: p.bio } : {}), ...(p?.direction ? { direction: p.direction } : {}), ...(p?.passions ? { passions: p.passions } : {}), composition });
  return document.leaf.subjectRedacted ? html.replace('id="personal-subject-h" data-authored="subject"', 'id="personal-subject-h"') : html;
}
export function renderAuthoredKeystones(portfolio: PublishedPortfolio | undefined): string {
  return renderKeystones({ items: (portfolio?.achievements ?? []).map(a => ({ id: a.id, title: a.title, ...(a.claims.find(c => c.kind === "summary") ? { summary: a.claims.find(c => c.kind === "summary")!.text } : {}), href: `#achievement-${a.id}`, collectionIds: publicCollectionIds(portfolio, a.id, "achievements") })) });
}
export function renderPublicCollections(portfolio: PublishedPortfolio | undefined, preview = false): string {
  const collections = portfolio?.collections;
  if (!collections?.length) return "";
  return `<div class="lp-order"><label for="portfolio-collection">Leaf view</label><select id="portfolio-collection" data-portfolio-collection disabled><option value="">${preview ? "All selected work" : "All shared work"}</option>${collections.map(c => `<option value="${esc(c.id)}" data-description="${esc(c.description ?? "")}">${esc(c.title)}</option>`).join("")}</select><p data-portfolio-collection-note hidden></p></div>`;
}
/** Readable when the collection control cannot mount; the enhanced control replaces this list. */
export function renderPublicCollectionFallback(portfolio: PublishedPortfolio | undefined, anchor = false): string {
  const collections = portfolio?.collections;
  if (!collections?.length) return "";
  return `<section class="lp-collection-fallback"${anchor ? ' id="portfolio-collection"' : ""} aria-label="Leaf views"><ul>${collections.map(c => `<li><h2>${esc(c.title)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ""}</li>`).join("")}</ul></section>`;
}
export function renderPublicAchievements(portfolio: PublishedPortfolio | undefined): string {
  if (!portfolio?.achievements?.length) return "";
  return `<section class="portfolio-achievements" aria-label="Achievement accounts"><p class="pub-context-note">Authored claims · selected evidence, not independent verification</p>${portfolio.achievements.map(a => `<article class="portfolio-achievement" id="achievement-${esc(a.id)}" tabindex="-1" data-achievement-id="${esc(a.id)}" data-collection-ids="${esc(JSON.stringify(publicCollectionIds(portfolio, a.id, "achievements")))}"><h2 data-authored="subject">${esc(a.title)}</h2>${a.claims.map(c => `<section class="portfolio-claim" id="${esc(publicClaimAnchor(a.id, c.id))}" tabindex="-1"><h3>${LABEL[c.kind]}</h3><p data-authored="subject">${esc(c.text)}</p><ul class="portfolio-claim-citations">${(c.citations ?? []).map((citation, index) => `<li><a data-evidence-citation href="#${publicCitationAnchor(citation)}">Supporting evidence ${index + 1}</a></li>`).join("")}</ul><a class="link" data-evidence-citation href="#${esc(publicClaimAnchor(a.id, c.id))}">Link to this claim</a></section>`).join("")}</article>`).join("")}</section>`;
}
export function renderPublicCitationReceipts(portfolio: PublishedPortfolio | undefined, leaflet: string): string {
  const unique = new Map<string, ClaimCitation>();
  for (const achievement of portfolio?.achievements ?? []) for (const claim of achievement.claims) for (const citation of claim.citations ?? []) if (citation.leaflet === leaflet) unique.set(publicCitationAnchor(citation), citation);
  return [...unique].map(([id, c]) => `<section id="${id}" tabindex="-1" class="pub-claim-support"><h3>Evidence selected for an authored claim</h3><dl class="pub-prov"><div><dt>Source</dt><dd>${esc(c.provenance.source)}</dd></div><div><dt>Ref</dt><dd class="fol-metric">${esc(c.provenance.ref)}</dd></div><div><dt>Observed</dt><dd class="fol-metric"><time datetime="${esc(c.provenance.observedAt)}">${esc(c.provenance.observedAt)}</time></dd></div></dl><p class="pub-context-note">Retained reference · not independent verification</p></section>`).join("");
}
