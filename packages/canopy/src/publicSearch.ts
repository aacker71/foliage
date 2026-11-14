import { publicClaimAnchor } from "./publicPortfolio.ts";
import type { PublishedLeafDocument } from "./publishedDocument.ts";
import type { PublicLeaf } from "./publicProjection.ts";

/** Text and destinations taken only from a public page's admitted projection. A caller may
 * rank these records, but must not enrich them from a private Leaf or harvest. */
export interface PublicSearchRecord {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly citation: string;
  readonly updatedAt?: string;
}

const joined = (...parts: readonly (string | undefined)[]): string => parts.filter(Boolean).join("\n");
const recordAnchor = (id: string): string => `portfolio-record-${id}`;

/** The frozen artifact is the page whenever it exists. Its published portfolio context and
 * pending-tier Leaflets are searchable; withheld/private material has no input path here. */
export function projectPublishedSearchRecords(
  document: PublishedLeafDocument, baseHref = `/leaf/${document.leaf.id}`,
): readonly PublicSearchRecord[] {
  const records: PublicSearchRecord[] = [];
  const portfolio = document.leaf.portfolio;
  const profile = portfolio?.profile;
  records.push({ id: "profile", kind: "profile", title: document.leaf.subject,
    text: joined(document.leaf.subject, portfolio?.headline, profile?.bio, profile?.direction,
      profile?.passions?.join("\n")), citation: `${baseHref}${portfolio || document.leaf.leaflets.length ? "#personal-subject-h" : ""}` });
  for (const achievement of portfolio?.achievements ?? []) {
    records.push({ id: `achievement:${achievement.id}`, kind: "achievement", title: achievement.title,
      text: joined(achievement.title, ...achievement.claims.map(claim => claim.text)),
      citation: `${baseHref}#achievement-${achievement.id}` });
    for (const claim of achievement.claims) records.push({
      id: `claim:${publicClaimAnchor(achievement.id, claim.id)}`, kind: "claim", title: achievement.title,
      text: claim.text, citation: `${baseHref}#${publicClaimAnchor(achievement.id, claim.id)}`,
    });
  }
  for (const collection of portfolio?.collections ?? []) records.push({
    id: `collection:${collection.id}`, kind: "collection", title: collection.title,
    text: joined(collection.title, collection.description),
    // The portfolio reads this query parameter on mount, selects the exact named view,
    // and reveals its description beside the control. A generic anchor loses that context.
    citation: `${baseHref}?collection=${encodeURIComponent(collection.id)}#portfolio-collection`,
  });
  for (const leaflet of document.leaf.leaflets) records.push({
    id: `leaflet:${leaflet.id}`, kind: "leaflet", title: leaflet.title,
    text: joined(leaflet.title, ...(leaflet.narrative?.map(paragraph => paragraph.text) ?? []),
      leaflet.provenance?.source, leaflet.provenance?.ref),
    citation: `${baseHref}#${recordAnchor(leaflet.id)}`,
    ...(leaflet.provenance ? { updatedAt: leaflet.provenance.observedAt } : {}),
  });
  return records;
}

/** The older tree page has a narrower projection: only listed work is shown. The caller must
 * refuse example trees before exporting this index, just as it refuses their release. */
export function projectLiveSearchRecords(
  person: PublicLeaf, baseHref = `/leaf/${person.id}`,
): readonly PublicSearchRecord[] {
  if (person.state !== "listed") return [];
  return [
    { id: "profile", kind: "profile", title: person.subject,
      text: person.subject, citation: `${baseHref}#portfolio-top` },
    ...person.listed.map(leaflet => ({
      id: `leaflet:${leaflet.id}`, kind: "leaflet", title: leaflet.title,
      text: joined(leaflet.title, leaflet.provenance?.source, leaflet.provenance?.ref),
      citation: `${baseHref}#${recordAnchor(leaflet.id)}`,
      ...(leaflet.provenance ? { updatedAt: leaflet.provenance.observedAt } : {}),
    })),
  ];
}
