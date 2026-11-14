/** Read-only retrieval over the owner's record. No file access, model call, or publication. */
import type { Leaf, Provenance } from "@foliage/leaf";
import type { HarvestDocument } from "./harvestDocument.ts";
import { PROMOTED_SOURCE_PREFIX, provenanceIsPromotedHandle } from "./promotedHandle.ts";
import { buildIndex, score, tokenize, type RankNode } from "./searchRank.mjs";

export interface SearchRecord {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  /** An exact location in the admitted source record, never a generated assertion. */
  readonly citation: string;
  readonly updatedAt?: string;
  readonly source?: string;
  readonly evidence?: readonly Provenance[];
  /** Set only on an excluded record. Its hit shows this reason, never an excerpt of `text`. */
  readonly reason?: string;
}

export interface SearchHit {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly snippet: string;
  readonly citation: string;
  /** Present only for an excluded record; the snippet is then drawn only from this reason
   * (bounded like any excerpt), never from the record's text. */
  readonly reason?: string;
  readonly evidence?: readonly Provenance[];
}

export interface SearchOptions { readonly limit?: number }
const MAX_QUERY = 300;
const MAX_RECORDS = 10_000;
const MAX_HITS = 10;
const SNIPPET = 240;

function excerpt(text: string, terms: readonly string[]): string {
  const clean = text.trim();
  if (clean.length <= SNIPPET) return clean;
  const lower = clean.toLowerCase();
  const at = terms.reduce((first, term) => {
    const found = lower.indexOf(term);
    return found < 0 ? first : Math.min(first, found);
  }, Number.POSITIVE_INFINITY);
  const start = Number.isFinite(at) ? Math.max(0, at - 64) : 0;
  const end = Math.min(clean.length, start + SNIPPET);
  return clean.slice(start, end);
}

/** Shared with the published-only projection. Internal relevance is never returned as a person rating. */
export function searchRecords(records: readonly SearchRecord[], query: string, options: SearchOptions = {}): SearchHit[] {
  if (typeof query !== "string" || query.trim().length === 0 || query.length > MAX_QUERY) throw new Error("Search needs 1–300 query characters.");
  if (records.length > MAX_RECORDS) throw new Error("Search record limit exceeded; narrow the source before searching.");
  const limit = options.limit ?? 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HITS) throw new Error("Search limit must be 1–10.");
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const eligible = records.filter(record => record.id && record.kind && record.title && record.citation);
  if (new Set(eligible.map(record => record.id)).size !== eligible.length) throw new Error("Search record IDs must be unique.");
  const nodes: RankNode[] = eligible.map(record => ({
    id: record.id, title: record.title, tags: [record.kind], summary: record.text.slice(0, 10_000),
    source: record.source ?? record.kind, updated: 0,
  }));
  const byId = new Map(eligible.map(record => [record.id, record]));
  return score(buildIndex(nodes), nodes, query, { now: 0 }).slice(0, limit).flatMap(match => {
    const record = byId.get(match.id);
    if (!record) return [];
    // An excluded record's text is work the owner did not do; its hit shows only why.
    return [{ id: record.id, kind: record.kind, title: record.title,
      snippet: excerpt(record.reason ?? record.text, terms), citation: record.citation,
      ...(record.reason === undefined ? {} : { reason: record.reason }),
      ...(record.evidence?.length ? { evidence: record.evidence.slice(0, 3) } : {}),
    }];
  });
}

const leafRef = (part: string) => `leaf:${encodeURIComponent(part)}`;
const harvestRef = (part: string) => `harvest:${encodeURIComponent(part)}`;
const evidenceFor = (items: readonly { readonly provenance: Provenance }[]): Provenance[] =>
  items.map(item => item.provenance);

/** Extract private, explicitly labeled record entries. Unbound or wrong-subject drafts are refused. */
export function gardenSearchRecords(input: { readonly leaf: Leaf; readonly harvest?: HarvestDocument | null }): SearchRecord[] {
  const { leaf, harvest } = input;
  if (harvest && (harvest.leafId !== leaf.id || harvest.subject !== leaf.subject)) {
    throw new Error("Harvest binding is absent or differs from the selected Leaf; private search refused.");
  }
  const records: SearchRecord[] = [];
  if (leaf.headline) records.push({ id: "profile:headline", kind: "owner profile", title: "Headline", text: leaf.headline, citation: leafRef("profile/headline") });
  if (leaf.profile?.bio) records.push({ id: "profile:bio", kind: "owner profile", title: "About", text: leaf.profile.bio, citation: leafRef("profile/bio") });
  if (leaf.profile?.direction) records.push({ id: "profile:direction", kind: "owner profile", title: "Direction", text: leaf.profile.direction, citation: leafRef("profile/direction") });
  for (const [index, passion] of (leaf.profile?.passions ?? []).entries()) {
    records.push({ id: `profile:passion:${index}`, kind: "owner profile", title: "Interest", text: passion, citation: leafRef(`profile/passions/${index}`) });
  }
  for (const achievement of leaf.achievements ?? []) {
    if (achievement.claims.length === 0) {
      records.push({ id: `achievement:${achievement.id}`, kind: "achievement", title: achievement.title, text: "", citation: leafRef(`achievement/${achievement.id}`) });
    }
    for (const claim of achievement.claims) {
      records.push({ id: `claim:${achievement.id}:${claim.id}`, kind: `achievement ${claim.kind}`,
        title: achievement.title, text: claim.text,
        citation: leafRef(`achievement/${achievement.id}/claim/${claim.id}`),
        ...(claim.citations?.length ? { evidence: claim.citations.map(citation => citation.provenance) } : {}),
      });
    }
  }
  for (const leaflet of leaf.leaflets) {
    // ONE PIECE OF EVIDENCE PER COMMIT, as /leaf and the export list it: a promoted leaflet's
    // provenance is promotion's handle on its first body element (same ref, same instant, the
    // drafter's "photosynthesis:git-cluster" label), so only the body element is listed.
    const provenance = provenanceIsPromotedHandle(leaflet) ? undefined : leaflet.provenance;
    records.push({ id: `leaflet:${leaflet.id}`, kind: leaflet.tier === "excluded" ? "excluded leaflet" : `${leaflet.tier} leaflet`,
      title: leaflet.title,
      // An excluded body is work the owner did not do. It is neither shown nor matched, so a query
      // cannot test which words it holds: only the title and the owner's reason are searched.
      text: leaflet.tier === "excluded" ? leaflet.reason
        : (leaflet.body ?? []).flatMap(item => item.text ? [item.text] : []).join(" "),
      citation: leafRef(`leaflet/${leaflet.id}`),
      ...(leaflet.tier === "excluded" ? { reason: leaflet.reason } : {}),
      ...(leaflet.body?.length || provenance ? { evidence: [
        ...(provenance ? [provenance] : []), ...evidenceFor(leaflet.body ?? []),
      ] } : {}),
    });
  }
  for (const edit of leaf.journeyHistory ?? []) {
    if (!edit.before) continue;
    records.push({ id: `history:${edit.id}`, kind: "past version", title: edit.before.title,
      text: edit.before.claims.map(claim => claim.text).join(" "), citation: leafRef(`history/${edit.id}`),
      updatedAt: edit.at,
      evidence: edit.before.claims.flatMap(claim => claim.citations?.map(citation => citation.provenance) ?? []),
    });
  }
  // ONE RECORD PER PIECE OF WORK. An approved draft that promotion has written into the Leaf is
  // that leaflet now, with the same evidence: the leaflet is its record, and the draft is not
  // listed beside it (measured on the 0.3.0 candidate: every promoted cluster came back twice).
  // Promotion keeps the candidate's id and labels its leaflet's provenance with what drafted it
  // ("photosynthesis:…"), which a leaflet of the same id made any other way does not carry; that
  // draft, an unreviewed one and a rejected one are listed as before.
  const promoted = new Set(leaf.leaflets.flatMap(leaflet => leaflet.provenance?.source.startsWith(PROMOTED_SOURCE_PREFIX) ? [String(leaflet.id)] : []));
  for (const candidate of harvest?.candidates ?? []) {
    if (candidate.review.state === "approved" && promoted.has(candidate.id)) continue;
    records.push({ id: `draft:${candidate.id}`, kind: `${candidate.review.state} draft`, title: candidate.title,
      text: candidate.evidence.flatMap(item => item.excerpt ? [item.excerpt] : []).join(" "),
      citation: harvestRef(`candidate/${candidate.id}`), updatedAt: candidate.draftedAt,
      evidence: candidate.evidence.map(({ source, ref, observedAt }) => ({ source, ref, observedAt })),
    });
  }
  return records;
}

export function searchGarden(input: { readonly leaf: Leaf; readonly harvest?: HarvestDocument | null }, query: string, options: SearchOptions = {}): SearchHit[] {
  return searchRecords(gardenSearchRecords(input), query, options);
}

/** The excerpt `searchRecords` shows for `text` and this query, for a hit another engine ordered (the local brain). */
export function searchExcerpt(text: string, query: string): string {
  return excerpt(text, tokenize(query));
}
