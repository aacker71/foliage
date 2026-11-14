import { publicPortfolioJson } from "./publicPortfolio.ts";
/**
 * RE-PUBLISH — what changes when a leaf is published a second time.
 *
 * WHY THIS EXISTS AS A FUNCTION RATHER THAN A PARAGRAPH IN THE COMMAND. Publishing is egress, and
 * the second publication is the one nobody reviews: the first time, a person reads the whole
 * withheld report and thinks about it; the second time they have "already decided". That is
 * exactly when a claim quietly appears or disappears on a page other people read. So a re-publish
 * is required to state, before it happens, the difference between what is on the canopy now and
 * what is about to replace it — and the statement has to be computed, not written from memory.
 *
 * THIS IS THE PAYOFF OF PUBLISHING A DOCUMENT INSTEAD OF A RENDERED PAGE. Two documents diff field
 * by field: this leaflet appeared, that one is gone, this title changed, the source document is
 * the same file it was. Two rendered pages diff chrome — a changed timestamp in a footer moves
 * every line after it, and the one claim that actually changed is somewhere in the noise.
 *
 * PURE, TOTAL, DETERMINISTIC. No clock, no fs, no throw. Both inputs are already-parsed artifacts,
 * so this cannot be handed anything the ingest gate would refuse.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not decide. It reports. The command prints this and
 * still requires the same explicit confirmation the first publication needed, plus an explicit
 * `--republish`, because "I consented to publish X" is not consent to publish a different X.
 *
 * COMPLEXITY: O(n + m) over the two leaflet lists, with two hash maps keyed by leaflet id. Ids are
 * unique within a publication — the parse gate enforces it — so a map is exactly the right
 * structure and no sort is needed.
 */

import type { PublishedLeaflet } from "./publish.ts";
import type { PublishedLeafDocument } from "./publishedDocument.ts";

/** One leaflet whose text or tier changed between two publications of the same id. */
export interface ChangedLeaflet {
  readonly id: string;
  readonly before: string;
  readonly after: string;
  /** The redaction claim changed as well: text that was verbatim no longer is, or the reverse. */
  readonly redactionChanged: boolean;
  /**
   * The tier changed — `pending` became `verified`, or the reverse. Since 2026-09-06 both tiers
   * cross and the tier is printed on the page, so this is a claim change even when the title is
   * not touched: "authorship is not cryptographically established" becoming "git accepted a
   * signature" is exactly the kind of difference a re-publish exists to surface, not bury inside
   * an `identical: true`.
   */
  readonly tierChanged: boolean;
  /** The evidence source/ref/observation instant shown to readers changed. */
  readonly provenanceChanged: boolean;
  readonly narrativeChanged: boolean;
  readonly photosChanged: boolean;
  readonly videosChanged: boolean;
}

export interface PublicationDiff {
  /** True when nothing a reader could see would change. `publishedAt` alone is not a change. */
  readonly identical: boolean;
  /** The instant recorded on the publication being replaced. */
  readonly previouslyPublishedAt: string;
  /**
   * True when both artifacts were built from byte-identical leaf documents. Re-publishing an
   * unchanged document is legitimate — a better redaction gate, a fixed subject line — and it is
   * worth naming, because it means every difference below came from this product, not from the
   * subject's evidence changing.
   */
  readonly sameSourceDocument: boolean;
  /** The artifact format or public leaf id changed. */
  readonly artifactMetadataChanged: boolean;
  /** The public source digest or byte count changed. */
  readonly sourceRecordChanged: boolean;
  /** The private publication-rule digest changed. */
  readonly policyChanged: boolean;
  /** The reader-visible per-kind withholding breakdown changed. */
  readonly withholdingKindsChanged: boolean;
  /** The order of leaflets on the public page changed. */
  readonly leafletOrderChanged: boolean;
  readonly subjectChanged: boolean;
  readonly portfolioChanged?: boolean;
  /** Leaflet ids on the new artifact and not the old: claims this page is about to start making. */
  readonly added: readonly string[];
  /** Leaflet ids on the old artifact and not the new: claims this page is about to stop making. */
  readonly removed: readonly string[];
  readonly changed: readonly ChangedLeaflet[];
  /** Review entries withheld, before and after. Entries, never leaflets — see publishedDocument.ts. */
  readonly withheldBefore: number;
  readonly withheldAfter: number;
}

function byId(leaflets: readonly PublishedLeaflet[]): Map<string, PublishedLeaflet> {
  const map = new Map<string, PublishedLeaflet>();
  for (const l of leaflets) map.set(l.id, l);
  return map;
}

function sameProvenance(a: PublishedLeaflet, b: PublishedLeaflet): boolean {
  if (a.provenance === undefined || b.provenance === undefined) return a.provenance === b.provenance;
  return a.provenance.source === b.provenance.source &&
    a.provenance.ref === b.provenance.ref &&
    a.provenance.observedAt === b.provenance.observedAt;
}

function sameWithholdingKinds(
  a: PublishedLeafDocument["withheld"]["kinds"],
  b: PublishedLeafDocument["withheld"]["kinds"],
): boolean {
  return a.length === b.length && a.every((entry, index) => {
    const other = b[index];
    return other !== undefined && entry.kind === other.kind && entry.count === other.count;
  });
}

/**
 * What changes if `next` replaces `previous`.
 *
 * Leaflet and withholding-kind order ARE compared because the public renderer preserves document
 * order. This does not rank evidence: it reports that replacing the artifact would visibly reorder
 * the page instead of labeling two different renderings identical.
 */
export function diffPublications(
  previous: PublishedLeafDocument,
  next: PublishedLeafDocument,
): PublicationDiff {
  const before = byId(previous.leaf.leaflets);
  const after = byId(next.leaf.leaflets);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: ChangedLeaflet[] = [];

  for (const [id, leaflet] of after) {
    const was = before.get(id);
    if (was === undefined) {
      added.push(id);
      continue;
    }
    const provenanceChanged = !sameProvenance(was, leaflet);
    const narrativeChanged = JSON.stringify(was.narrative ?? []) !== JSON.stringify(leaflet.narrative ?? []);
    const photosChanged = JSON.stringify(was.photos ?? []) !== JSON.stringify(leaflet.photos ?? []);
    const videosChanged = JSON.stringify(was.videos ?? []) !== JSON.stringify(leaflet.videos ?? []);
    if (videosChanged || photosChanged || narrativeChanged || was.title !== leaflet.title || was.titleRedacted !== leaflet.titleRedacted || was.tier !== leaflet.tier || provenanceChanged) {
      changed.push({
        id,
        before: was.title,
        after: leaflet.title,
        redactionChanged: was.titleRedacted !== leaflet.titleRedacted,
        tierChanged: was.tier !== leaflet.tier,
        provenanceChanged,
        narrativeChanged, photosChanged, videosChanged,
      });
    }
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed.push(id);
  }

  const portfolioChanged = JSON.stringify(previous.leaf.portfolio ? publicPortfolioJson(previous.leaf.portfolio) : null) !== JSON.stringify(next.leaf.portfolio ? publicPortfolioJson(next.leaf.portfolio) : null);
  const subjectChanged =
    previous.leaf.subject !== next.leaf.subject ||
    previous.leaf.subjectRedacted !== next.leaf.subjectRedacted;
  const artifactMetadataChanged =
    previous.artifactVersion !== next.artifactVersion || previous.leaf.id !== next.leaf.id;
  const sourceRecordChanged =
    previous.source.documentDigest !== next.source.documentDigest ||
    previous.source.documentBytes !== next.source.documentBytes;
  const policyChanged = previous.source.policyDigest !== next.source.policyDigest;
  const withholdingKindsChanged = !sameWithholdingKinds(previous.withheld.kinds, next.withheld.kinds);
  const sharedIds = new Set(previous.leaf.leaflets.filter((leaflet) => after.has(leaflet.id)).map((leaflet) => leaflet.id));
  const beforeSharedOrder = previous.leaf.leaflets.filter((leaflet) => sharedIds.has(leaflet.id)).map((leaflet) => leaflet.id);
  const afterSharedOrder = next.leaf.leaflets.filter((leaflet) => sharedIds.has(leaflet.id)).map((leaflet) => leaflet.id);
  const leafletOrderChanged = beforeSharedOrder.some((id, index) => afterSharedOrder[index] !== id);

  return Object.freeze({
    // `publishedAt` is excluded from this equality ON PURPOSE: a re-publish of an unchanged leaf
    // always carries a new instant, and calling that "changed" would make the flag useless
    // precisely when it is most informative — when a person wants to know whether re-running the
    // command would alter what anyone can see.
    identical:
      added.length === 0 &&
      removed.length === 0 &&
      changed.length === 0 &&
      !subjectChanged &&
      !portfolioChanged &&
      !artifactMetadataChanged &&
      !sourceRecordChanged &&
      !leafletOrderChanged &&
      previous.withheld.count === next.withheld.count &&
      !withholdingKindsChanged,
    previouslyPublishedAt: previous.publishedAt,
    sameSourceDocument:
      previous.source.documentDigest === next.source.documentDigest &&
      previous.source.documentBytes === next.source.documentBytes,
    artifactMetadataChanged,
    sourceRecordChanged,
    policyChanged,
    withholdingKindsChanged,
    leafletOrderChanged,
    subjectChanged,
    portfolioChanged,
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    changed: Object.freeze(changed),
    withheldBefore: previous.withheld.count,
    withheldAfter: next.withheld.count,
  });
}
