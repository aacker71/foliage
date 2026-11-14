import type { PublishedLeafDocument } from "./publishedDocument.ts";
import { projectPublishedSearchRecords, type PublicSearchRecord } from "./publicSearch.ts";

/**
 * THE COLLABORATOR DIRECTORY FILTER — the pure core of unit 20 (context/specs/20-public-discovery.md)
 * and portfolio-distribution §10. A reader types words; every person who chose to be listed and
 * whose published page contains those words appears once, in an order the reader chose.
 *
 * WHAT CAN ENTER. Only a `PublishedLeafDocument` — the artifact the publication gate produced — and
 * its text is read through `projectPublishedSearchRecords`, the same projection the per-page search
 * uses. There is no parameter through which private Leaf text, a harvest or a reviewer note could
 * reach a match. The person's name is the page's own published subject, not a second
 * caller-supplied name the publication gate never saw.
 *
 * WHO CAN APPEAR. A person whose listing says `listed` for THIS page's id. Listing is a consent
 * separate from publishing (unit 20 step 1); recording it is the hosted service's job, not this
 * function's. A listing for another page is no listing at all.
 *
 * WHAT EACH GROUP CARRIES. The same four fields for everyone: the person, ONE cited hit, the link
 * to their page, and when that page was published. No relevance weight, count, "+N more", tier
 * tally or score exists in the type, so none can reach a reader.
 *
 * WHICH RECORD IS THE HIT. The earliest matching record in the person's OWN published order,
 * taking their work (achievements, claims, evidence) before their own description of themselves
 * (profile, collection names). Published order is the person's own: their achievements as
 * authored, their featured evidence first (`orderAdmittedLeaflets`). The rule needs no date (most
 * records carry none) and never looks at anyone else. Work comes first because the
 * directory exists to find people through work they have done; a self-description is still
 * an honest answer, and `basis` says which one the reader is looking at (spec step 3: declared
 * interests are distinguished from cited work).
 *
 * WHAT A MATCH IS. Every word the reader typed appears as a whole word in that one record.
 * Case and Unicode compatibility forms are folded; nothing is weighted, stemmed or dropped. That
 * is a rule a reader can be told in one sentence.
 *
 * ORDER. The reader picks alphabetical by name or most recently published (spec step 3: "chosen
 * date/alphabetical order"). Ties fall back to name, then page link, so the output never depends
 * on input order.
 *
 * Pure and total: no fs, env, clock or network, and no throw for any input of these types. Not
 * wired to a route, page or tool yet; consent records, paging and serving belong to apps/canopy.
 */

type DiscoveryListing =
  | { readonly kind: "listed"; readonly leafId: string }
  | { readonly kind: "not-listed" };

export interface DiscoveryCandidate {
  readonly listing: DiscoveryListing;
  /** True when the source document declared itself an example or is the bundled example. A hosted
   * publication passes `false`: publication refuses an example whole, so no artifact exists for one. */
  readonly declaredExample: boolean;
  readonly document: PublishedLeafDocument;
}

export type DiscoveryOrder = "name" | "recently-published";

export interface DiscoveryRequest {
  readonly terms: string;
  readonly order: DiscoveryOrder;
}

/** `self-described`: the person's profile or collection wording. `work`: a cited achievement,
 * claim or piece of evidence. */
type DiscoveryBasis = "work" | "self-described";

interface DiscoveryHit {
  readonly title: string;
  readonly basis: DiscoveryBasis;
  readonly citation: string;
}

interface DiscoveryGroup {
  readonly person: { readonly name: string; readonly nameRedacted: boolean };
  readonly hit: DiscoveryHit;
  /** The person's published page. */
  readonly portfolio: string;
  /** When that page was last published. The only date, and the one the reader may order by. */
  readonly publishedAt: string;
}

export type DiscoveryResult =
  | { readonly kind: "groups"; readonly groups: readonly DiscoveryGroup[] }
  | { readonly kind: "empty-terms" }
  | { readonly kind: "terms-too-long" }
  | { readonly kind: "unknown-order" }
  /** A fabricated illustration must never sit in a list of real people. Refused whole, like the
   * static export's search index (apps/canopy/export.mjs), because its presence means the
   * directory was assembled from the wrong source. */
  | { readonly kind: "example-refused" }
  /** Two entries for one page cannot be ordered without looking at input order. */
  | { readonly kind: "duplicate-person" };

/** The per-page search's bound (hostedPublicSearch, searchRecords). */
const MAX_TERMS = 300;

/** Every kind `projectPublishedSearchRecords` emits, classified on purpose. A kind not listed here
 * is never cited until someone decides which it is. */
const BASIS: ReadonlyMap<string, DiscoveryBasis> = new Map([
  ["profile", "self-described"],
  ["collection", "self-described"],
  ["achievement", "work"],
  ["claim", "work"],
  ["leaflet", "work"],
]);

const words = (text: string): ReadonlySet<string> =>
  new Set(text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean));

function isListed({ listing, document }: DiscoveryCandidate): boolean {
  switch (listing.kind) {
    case "listed": return listing.leafId === String(document.leaf.id);
    case "not-listed": return false;
  }
}

function citedHit(records: readonly PublicSearchRecord[], terms: ReadonlySet<string>): DiscoveryHit | null {
  let description: DiscoveryHit | null = null;
  for (const record of records) {
    const basis = BASIS.get(record.kind);
    if (basis === undefined) continue;
    const present = words(`${record.title}\n${record.text}`);
    if (![...terms].every(term => present.has(term))) continue;
    const hit: DiscoveryHit = Object.freeze({ title: record.title, basis, citation: record.citation });
    switch (basis) {
      case "work": return hit;
      case "self-described": description ??= hit; break;
    }
  }
  return description;
}

const NAMES = new Intl.Collator("en", { usage: "sort", sensitivity: "variant" });
const codePoints = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const instant = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

function byName(a: DiscoveryGroup, b: DiscoveryGroup): number {
  return NAMES.compare(a.person.name, b.person.name) || codePoints(a.person.name, b.person.name) ||
    codePoints(a.portfolio, b.portfolio);
}

function comparator(order: DiscoveryOrder): ((a: DiscoveryGroup, b: DiscoveryGroup) => number) | null {
  switch (order) {
    case "name": return byName;
    case "recently-published": return (a, b) => {
      const at = instant(a.publishedAt), bt = instant(b.publishedAt);
      return at === bt ? byName(a, b) : at > bt ? -1 : 1;
    };
    default: return null;
  }
}

export function filterDiscoveryDirectory(
  candidates: readonly DiscoveryCandidate[], request: DiscoveryRequest,
): DiscoveryResult {
  const typed = typeof request.terms === "string" ? request.terms.trim() : "";
  if (typed.length > MAX_TERMS) return { kind: "terms-too-long" };
  const terms = words(typed);
  if (terms.size === 0) return { kind: "empty-terms" };
  const compare = comparator(request.order);
  if (compare === null) return { kind: "unknown-order" };
  if (candidates.some(candidate => candidate.declaredExample !== false)) return { kind: "example-refused" };
  const pages = candidates.map(candidate => String(candidate.document.leaf.id));
  if (new Set(pages).size !== pages.length) return { kind: "duplicate-person" };

  const groups = candidates.flatMap((candidate): DiscoveryGroup[] => {
    if (!isListed(candidate)) return [];
    const { leaf, publishedAt } = candidate.document;
    const portfolio = `/leaf/${leaf.id}`;
    const hit = citedHit(projectPublishedSearchRecords(candidate.document, portfolio), terms);
    if (hit === null) return [];
    return [Object.freeze({
      person: Object.freeze({ name: leaf.subject, nameRedacted: leaf.subjectRedacted }),
      hit, portfolio, publishedAt,
    })];
  });
  return { kind: "groups", groups: Object.freeze(groups.sort(compare)) };
}
