/**
 * The handle promotion keeps on a leaflet, apart from `promote.ts` so the search records
 * (`searchGarden.ts`, the pure `@foliage/photosynthesis/search` export Canopy also loads) can apply
 * the one-evidence rule without promotion's own imports. `promote.ts` re-exports both.
 */
import type { LeafletBody, Provenance } from "@foliage/leaf";

/**
 * `Provenance.source` prefix for promoted leaflets: "photosynthesis:git-cluster",
 * "photosynthesis:local-model:gemma4:12b". A constant for the same reason as `GIT_SOURCE` in
 * intake — the mechanism labels itself, so a caller cannot mislabel what produced the entry.
 */
export const PROMOTED_SOURCE_PREFIX = "photosynthesis:";

/**
 * Is this leaflet's `provenance` promotion's HANDLE on one of its own body elements?
 *
 * `buildPromotedLeaflet` writes the primary ref twice on purpose (see promote.ts's header): once as the
 * leaflet's provenance, labelled with what drafted it ("photosynthesis:git-cluster"), and once as
 * the first body element, under the source that produced it ("git"). Both name the same ref
 * observed at the same instant, so they are ONE piece of evidence. Measured on the 0.3.0 release
 * candidate: every surface that counted a promoted leaflet's evidence counted it twice ("Evidence
 * 2" over one commit), and the exported public page printed the drafter's label under Provenance.
 * A reader that counts or lists evidence asks this and lists the body element alone.
 *
 * Only a `photosynthesis:` provenance qualifies, and only when a body element from another source
 * has the same ref AND the same observedAt: another observation of the same ref is a second fact
 * and stays. Defensive about element shape, because renderers also see bodies they cannot read.
 * Pure and total; O(body).
 */
export function provenanceIsPromotedHandle(leaflet: { readonly provenance?: Provenance; readonly body?: LeafletBody }): boolean {
  const handle = leaflet.provenance;
  if (handle === undefined || typeof handle.source !== "string" || !handle.source.startsWith(PROMOTED_SOURCE_PREFIX)) return false;
  return (Array.isArray(leaflet.body) ? leaflet.body : []).some((element: unknown) => {
    if (typeof element !== "object" || element === null || !("provenance" in element)) return false;
    const p: unknown = element.provenance;
    if (typeof p !== "object" || p === null || !("source" in p) || !("ref" in p) || !("observedAt" in p)) return false;
    return typeof p.source === "string" && !p.source.startsWith(PROMOTED_SOURCE_PREFIX) &&
      p.ref === handle.ref && p.observedAt === handle.observedAt;
  });
}
