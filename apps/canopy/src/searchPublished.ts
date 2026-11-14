import { projectPublishedSearchRecords, type PublishedLeafDocument } from "@foliage/canopy";
import { searchRecords } from "@foliage/photosynthesis/search";
import type { SearchPublished } from "./hostedPublicSearch.ts";

/** One published document per request. The shared local search selects spans from only the
 * admitted projection; the hosted transport rebinds them before any result leaves Canopy. */
export const searchPublished: SearchPublished = (document: PublishedLeafDocument, query, limit) =>
  searchRecords(projectPublishedSearchRecords(document), query, { limit })
    .map(({ id, snippet }) => ({ id, snippet }));
