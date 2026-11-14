/**
 * THE GARDEN'S LOCAL BRAIN, THE PURE PART (unit 38, build order items 2 and 3; spec PR #201): which
 * records become pages, each page's address and text, what a refresh has to do, and how a search's
 * hits are put together. No file access, no process: `apps/leaf/src/localBrain.ts` writes, imports
 * and reads what this returns.
 *
 * WHAT GOES IN (owner decision 1, 2026-10-12): everything private, labelled, minus excluded bodies
 * and records resting on material about someone else. `brainRecords` narrows the records `foliage
 * search` covers:
 *   - an excluded leaflet keeps its title and its reason, and nothing else: not its body, which is
 *     work the owner did not do, and not its evidence references, which point at that work.
 *   - every record whose evidence or provenance carries a `third-party` source segment is held
 *     back, by the test the `deny-third-party-evidence` publish rule uses (`sourceHasSegment`):
 *     drafts on notes about someone else, and leaflets, claims and past versions that carry the
 *     same provenance after promotion.
 * The brain is derived data, so changing this rule later means one rebuild and nothing else.
 *
 * LABELS NEVER ENTER THE SEARCHABLE BODY. Every page has one type; its labels live in frontmatter,
 * which gbrain's keyword search does not read; the body is the title as a heading plus the record's
 * text with gbrain's structure lines made inert. So a tier or kind can never move a page in
 * gbrain's order.
 *
 * GBRAIN'S ORDER IS NOT THE RESULT SET. Its search always deduplicates: no page type may fill more
 * than ceil(0.6 × results), and every Foliage page has one type; and a chunk close to one already
 * kept is dropped, so a claim and its past version one word apart come back as one. With 10
 * matching pages, gbrain returned 6 (measured in the spec's review probe). `brainSearchHits` keeps
 * gbrain's order for what it found and adds Foliage's own matches over the same records, so the
 * result always holds every hit today's search returns.
 */
import { createHash } from "node:crypto";
import { sourceHasSegment, THIRD_PARTY_SEGMENT, type Leaf } from "@foliage/leaf";
import type { HarvestDocument } from "./harvestDocument.ts";
import { gardenSearchRecords, searchExcerpt, searchRecords, type SearchHit, type SearchRecord } from "./searchGarden.ts";

type BrainInput = { readonly leaf: Leaf; readonly harvest?: HarvestDocument | null };

/** A record the brain may hold. */
export interface BrainRecord extends SearchRecord {
  /** Set only on an excluded leaflet, whose text is then this reason and nothing else. */
  readonly reason?: string;
}

/** A hit Foliage builds itself: today's shape, plus the reason on an excluded record. Nothing in it comes from gbrain. */
export interface BrainHit extends SearchHit {
  readonly reason?: string;
}

export interface BrainPage {
  /** gbrain's slug: `foliage/<sha256 hex>`, from the Leaf id and record id only. */
  readonly slug: string;
  /** The page's path under the brain's pages directory, which decides the slug. */
  readonly file: string;
  readonly recordId: string;
  /** sha256 of the page's fields and body; also written into the page as `foliage_digest`. */
  readonly digest: string;
  /** An excluded leaflet's page: its title and reason only. */
  readonly excluded: boolean;
  readonly markdown: string;
}

export interface BrainProjection {
  readonly records: readonly BrainRecord[];
  readonly pages: readonly BrainPage[];
  /** Ids of the records `foliage search` covers that the brain holds back (third-party material). */
  readonly heldBack: ReadonlySet<string>;
}

/** What the manifest keeps for each page it built. */
export interface BrainManifestPage {
  readonly record: string;
  readonly digest: string;
  readonly excluded?: true;
  /** Written by a refresh that did not finish: gbrain may hold this text, or the page's earlier one. */
  readonly unconfirmed?: true;
}

/** No tier, kind or title in the path, and never under a directory gbrain boosts or demotes. */
function brainSlug(leafId: string, recordId: string): string {
  return `foliage/${createHash("sha256").update(JSON.stringify([leafId, recordId])).digest("hex")}`;
}

const restsOnThirdParty = (record: SearchRecord) => (record.evidence ?? []).some(item => sourceHasSegment(item.source, THIRD_PARTY_SEGMENT));

const EXCLUDED = "excluded leaflet";
const TIER_OF_KIND: ReadonlyMap<string, string> = new Map([["verified leaflet", "verified"], ["pending leaflet", "pending"], [EXCLUDED, "excluded"]]);

/** The records the brain may hold, and the ids of those it holds back. */
function narrow(input: BrainInput): { records: BrainRecord[]; heldBack: Set<string> } {
  const reasons = new Map<string, string>(input.leaf.leaflets.flatMap(leaflet => leaflet.tier === "excluded" ? [[`leaflet:${leaflet.id}`, leaflet.reason] as const] : []));
  const records: BrainRecord[] = [], heldBack = new Set<string>();
  for (const record of gardenSearchRecords(input)) {
    if (restsOnThirdParty(record)) { heldBack.add(record.id); continue; }
    if (record.kind !== EXCLUDED) { records.push(record); continue; }
    // An excluded leaflet: its title and its reason, nothing else. The Leaf parser requires the
    // reason; without one, nothing of the leaflet goes in.
    const reason = reasons.get(record.id);
    if (reason === undefined) { heldBack.add(record.id); continue; }
    records.push({ id: record.id, kind: record.kind, title: record.title, text: reason, citation: record.citation, reason });
  }
  return { records, heldBack };
}

/** The records the brain may hold: the records `foliage search` covers, narrowed as above. */
export function brainRecords(input: BrainInput): BrainRecord[] {
  return narrow(input).records;
}

/**
 * gbrain reads structure out of a page body. It splits the body at a line that is
 * `<!-- timeline -->` or `<!--timeline-->`, a `--- timeline ---` line, or a `---` line followed by a
 * `## Timeline` or `## History` heading (src/core/markdown.ts:380-399), and before chunking it cuts
 * out whatever lies between `<!--- gbrain:facts:begin -->` or `<!--- gbrain:takes:begin -->` and its
 * end marker (src/core/chunkers/recursive.ts:92). A record's text is the owner's words, never gbrain
 * structure, so its page carries an inert form: every `<!--` gains a backslash (`<\!--`), and so does
 * every line whose first non-blank characters are `---` (`\---`). The words stay searchable, and
 * snippets come from the live record, so nobody sees the rewrite.
 */
export function inertStructure(text: string): string {
  return text.replaceAll("<!--", "<\\!--").split("\n").map(line => /^\s*---/.test(line) ? line.replace("---", "\\---") : line).join("\n");
}

const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/;

/** A value as JSON, which is valid YAML, on one line: the line breaks YAML also reads (NEL, LS, PS) are escaped. */
const yaml = (value: unknown) => JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

/**
 * A record the page format refuses: a title, id, reason or label holding a line break, which would
 * end its frontmatter line. It names the record and the field, so the owner knows what to edit.
 */
export class BrainPageRefusal extends Error {
  readonly recordId: string;
  readonly field: string;
  constructor(recordId: string, field: string) {
    const id = recordId.split(LINE_BREAK).join(" ");
    super(`record ${yaml(id)} has a line break in its ${field}`);
    this.recordId = id;
    this.field = field;
  }
}

/** A frontmatter string that may not hold a line break: a title, an id, a reason, a label. */
function oneLine(key: string, value: string, recordId: string): string {
  if (LINE_BREAK.test(value)) throw new BrainPageRefusal(recordId, key);
  return value;
}

/**
 * The page format. Every frontmatter value is JSON. No `id`, `tags`, `date` or `effective_date`
 * key, which gbrain reads as identity, tags or recency; one type for every page.
 */
function brainPage(leafId: string, record: BrainRecord): BrainPage {
  const slug = brainSlug(leafId, record.id);
  const fields: (readonly [string, unknown])[] = [
    ["type", "foliage-record"],
    ["title", oneLine("title", record.title, record.id)],
    ["foliage_record", oneLine("id", record.id, record.id)],
    ["foliage_kind", oneLine("kind", record.kind, record.id)],
    ["foliage_tier", TIER_OF_KIND.get(record.kind) ?? null],
    ...(record.reason === undefined ? [] : [["foliage_reason", oneLine("reason", record.reason, record.id)] as const]),
    ["foliage_citation", oneLine("citation", record.citation, record.id)],
    ["foliage_updated_at", record.updatedAt === undefined ? null : oneLine("date", record.updatedAt, record.id)],
    ["foliage_leaf", oneLine("Leaf id", leafId, record.id)],
  ];
  const evidence = (record.evidence ?? []).map(({ source, ref, observedAt }) => ({ source, ref, observedAt }));
  // The title is repeated as the first body line: gbrain searches only the body's chunks, and a
  // record with empty text, such as an achievement with no claims yet, still gets one.
  const text = inertStructure(record.text);
  const body = `# ${inertStructure(record.title)}\n${text.trim() === "" ? "" : `\n${text}\n`}`;
  const digest = createHash("sha256").update(JSON.stringify([fields, evidence, body])).digest("hex");
  const markdown = ["---", ...fields.map(([key, value]) => `${key}: ${yaml(value)}`),
    `foliage_digest: ${yaml(digest)}`, `foliage_evidence: ${yaml(evidence)}`, "---", body].join("\n");
  return { slug, file: `${slug}.md`, recordId: record.id, digest, excluded: record.kind === EXCLUDED, markdown };
}

/** Every page the brain should hold for this record, and what it holds back. */
export function brainProjection(input: BrainInput): BrainProjection {
  const { records, heldBack } = narrow(input);
  return { records, pages: records.map(record => brainPage(input.leaf.id, record)), heldBack };
}

/** What the manifest keeps for one page. */
export function brainManifestPage(page: BrainPage): BrainManifestPage {
  return { record: page.recordId, digest: page.digest, ...(page.excluded ? { excluded: true as const } : {}) };
}

/**
 * The pages an unfinished refresh may have left in gbrain: every page the brain was built with, and
 * every page this refresh is about to write, as written and unconfirmed. A refresh records this
 * before its first change, with record hashes that match nothing, so a refresh killed or failed
 * after its import is never taken for current, and the next plan sees each page gbrain may hold:
 * one later excluded or resting on material about someone else rebuilds the brain, as it would had
 * the refresh finished, and one it may not have imported yet is written and confirmed again.
 */
export function brainUnfinishedPages(built: Readonly<Record<string, BrainManifestPage>>, written: Iterable<BrainPage>): Record<string, BrainManifestPage> {
  const pages: Record<string, BrainManifestPage> = {};
  for (const [slug, page] of Object.entries(built)) pages[slug] = page;
  for (const page of written) pages[page.slug] = { ...brainManifestPage(page), unconfirmed: true };
  return pages;
}

/**
 * A gbrain process costs about 0.66 s, and a rebuild about 19 s plus 13 ms a page, of which the
 * per-page part an update's `--fresh` import pays as well (both measured, macOS arm64, sandboxed).
 * An update in place starts one process for each page it writes (its digest is read back) and three
 * for each it removes (delete, then `get_page` and `get_versions` to prove it gone). Past this many,
 * a rebuild is quicker and holds the brain's lock for less time.
 */
export const IN_PLACE_PROCESS_LIMIT = 28;

export type BrainRefreshPlan =
  /** A removal the law drives, or a rebuild that is quicker: rebuild beside the brain and swap. */
  | { readonly kind: "rebuild"; readonly because: string }
  | { readonly kind: "update"; readonly write: readonly BrainPage[]; readonly remove: readonly string[] };

/**
 * What a refresh does to a brain built as `built` (the manifest's pages, or an unfinished refresh's,
 * see `brainUnfinishedPages`) so that it holds exactly `projection`. Changed and new pages are
 * written and imported; pages of records that are gone are deleted and purged in place. Two
 * removals are the law's, not the owner's edits, and rebuild the brain instead, because overwritten
 * and deleted rows stay in the database's files: a leaflet newly excluded (an update in place would
 * keep its old body as a past version) and a record newly resting on material about someone else.
 * So does an update too large to be quicker than a rebuild.
 */
export function brainRefreshPlan(built: Readonly<Record<string, BrainManifestPage>>, projection: BrainProjection): BrainRefreshPlan {
  const write: BrainPage[] = [], remove: string[] = [];
  const wanted = new Set(projection.pages.map(page => page.slug));
  for (const page of projection.pages) {
    const before = Object.hasOwn(built, page.slug) ? built[page.slug] : undefined;
    if (before?.digest === page.digest && before.unconfirmed !== true) continue;
    if (before !== undefined && page.excluded && before.excluded !== true) {
      return { kind: "rebuild", because: "a leaflet was newly excluded, so its earlier text must leave the brain" };
    }
    write.push(page);
  }
  for (const [slug, before] of Object.entries(built)) {
    if (wanted.has(slug)) continue;
    if (projection.heldBack.has(before.record)) {
      return { kind: "rebuild", because: "a record now rests on material about someone else, so it must leave the brain" };
    }
    remove.push(slug);
  }
  if (write.length + 3 * remove.length > IN_PLACE_PROCESS_LIMIT) {
    return { kind: "rebuild", because: "a rebuild is quicker than changing this many pages one at a time" };
  }
  return { kind: "update", write, remove };
}

/** Foliage's own hit for one record: its labels, Foliage's excerpt, and the reason on an excluded record. */
function brainHit(record: BrainRecord, query: string): BrainHit {
  return { id: record.id, kind: record.kind, title: record.title, snippet: searchExcerpt(record.text, query), citation: record.citation,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    ...(record.evidence?.length ? { evidence: record.evidence.slice(0, 3) } : {}),
  };
}

/**
 * THE MERGE (spec, Reading step 4). `ordered` is gbrain's slugs in its order; `built` maps a slug to
 * its record id (the manifest). Each slug is kept once, mapped to its record and looked up in the
 * live `records`; a slug that maps to no live record is dropped. Then Foliage's own matches over the
 * same records (`searchRecords`, today's ranking) that are not yet listed follow, in their order.
 *
 * Recall is never below today's: every hit today's search returns is in the result. gbrain's
 * stemming can find a record today's search does not; such a hit is kept only while room remains
 * beside today's hits, so it never displaces one. Query and limit are checked by `searchRecords`.
 * Nothing from gbrain's result reaches a hit: no score, boost, match label, page or chunk id.
 */
export function brainSearchHits(input: {
  readonly records: readonly BrainRecord[];
  readonly built: Readonly<Record<string, { readonly record: string }>>;
  readonly ordered: readonly string[];
  readonly query: string;
  readonly limit: number;
}): BrainHit[] {
  const own = searchRecords(input.records, input.query, { limit: input.limit });
  const byId = new Map(input.records.map(record => [record.id, record]));
  const ownIds = new Set(own.map(hit => hit.id));
  let room = input.limit - own.length;
  const ids: string[] = [], listed = new Set<string>();
  for (const slug of input.ordered) {
    const id = Object.hasOwn(input.built, slug) ? input.built[slug]?.record : undefined;
    if (id === undefined || listed.has(id) || !byId.has(id)) continue;
    if (!ownIds.has(id)) {
      if (room <= 0) continue;
      room -= 1;
    }
    listed.add(id);
    ids.push(id);
  }
  for (const hit of own) if (!listed.has(hit.id)) { listed.add(hit.id); ids.push(hit.id); }
  return ids.map(id => brainHit(byId.get(id)!, input.query));
}
