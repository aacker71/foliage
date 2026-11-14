/** Presentation order over the saved Leaf and exact source metadata. Observation time is
 * never substituted for a work date. Git author metadata is self-reported, not attribution. */
import { featuredLeaflets, isIsoInstant, isSubjectsOwnWork, type Leaf, type Leaflet, type LeafletId, type SubjectsOwnLeaflet } from "@foliage/leaf";

export type PortfolioOrder = "notable" | "newest" | "oldest";
export interface GitWorkDate {
  readonly source: "git";
  readonly ref: string;
  readonly authoredAt: string;
}
/** Only literal retained Git provenance can be enriched from a Git repository. */
export function gitEvidenceRefs(record: Leaflet): readonly string[] {
  return [...new Set([record.provenance, ...(record.body ?? []).map(element => element.provenance)]
    .filter(reference => reference?.source === "git" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(reference.ref))
    .map(reference => reference!.ref))];
}
export interface PortfolioTimelineEntry {
  readonly record: SubjectsOwnLeaflet;
  /** Original position, preserved for source selection and equal-date ties. */
  readonly documentIndex: number;
  /** Exact saved observation instant; never populated from prose, a story receipt or a clock. */
  readonly observedAt: string | null;
  /** UTC calendar coordinates, so date groups and chronological order use the same timezone. */
  readonly observedDay: string | null;
  readonly observedMonth: string | null;
  /** Latest known Git author date; a grouped record's earlier date stays available as a range. */
  readonly workAt: string | null;
  readonly workFromAt: string | null;
  readonly workDay: string | null;
  readonly workMonth: string | null;
  readonly workRefs: readonly GitWorkDate[];
  /** Compare with workRefs.length to disclose incomplete source-date coverage. */
  readonly workRefCount: number;
  readonly dateBasis: "git-authored" | "observed" | "undated";
  readonly featured: boolean;
  /** Only the owner's literal first choice, never a replacement for a missing leading tip. */
  readonly leading: boolean;
}
export interface PortfolioTimeline {
  readonly order: PortfolioOrder;
  readonly entries: readonly PortfolioTimelineEntry[];
  /** Kept separately and in document order, with their original exclusion reasons intact. */
  readonly excluded: readonly Leaflet[];
  readonly unavailableChoices: readonly LeafletId[];
  readonly undatedCount: number;
}

/** Newest/oldest use work dates only. Dates missing from the authorized metadata map remain
 * work-undated; their retained observations are secondary context, never a sorting fallback. */
export function portfolioTimeline(leaf: Leaf, order: PortfolioOrder = "notable", workDates?: ReadonlyMap<string, GitWorkDate>): PortfolioTimeline {
  const highlights = featuredLeaflets(leaf);
  const highlighted = new Set(highlights.map(record => record.id));
  const leadingId = leaf.curation?.featured[0];
  const entries: PortfolioTimelineEntry[] = leaf.leaflets.flatMap((record, documentIndex) => {
    if (!isSubjectsOwnWork(record)) return [];
    const saved = record.provenance?.observedAt;
    const observedAt = saved && isIsoInstant(saved) ? saved : null;
    const day = observedAt === null ? null : new Date(observedAt).toISOString().slice(0, 10);
    const references = gitEvidenceRefs(record);
    const workRefs = references.flatMap(ref => {
      const date = workDates?.get(ref);
      return date?.source === "git" && date.ref === ref && isIsoInstant(date.authoredAt) ? [date] : [];
    });
    const instants = [...workRefs].sort((a, b) => Date.parse(a.authoredAt) - Date.parse(b.authoredAt));
    const workAt = instants.at(-1)?.authoredAt ?? null;
    const workFromAt = instants[0]?.authoredAt ?? null;
    const workDay = workAt === null ? null : new Date(workAt).toISOString().slice(0, 10);
    return [{ record, documentIndex, observedAt, observedDay: day, observedMonth: day?.slice(0, 7) ?? null,
      workAt, workFromAt, workDay, workMonth: workDay?.slice(0, 7) ?? null, workRefs, workRefCount: references.length,
      dateBasis: workAt !== null ? "git-authored" as const : observedAt === null ? "undated" as const : "observed" as const,
      featured: highlighted.has(record.id), leading: record.id === leadingId }];
  });
  let ordered: readonly PortfolioTimelineEntry[];
  if (order === "notable") {
    const byId = new Map(entries.map(entry => [entry.record.id, entry]));
    ordered = [...highlights.map(record => byId.get(record.id)!), ...entries.filter(entry => !entry.featured)];
  } else {
    ordered = [...entries].sort((a, b) => {
      if (a.workAt === null || b.workAt === null) {
        if (a.workAt !== b.workAt) return a.workAt === null ? 1 : -1;
      } else {
        const time = Date.parse(a.workAt) - Date.parse(b.workAt);
        if (time !== 0) return order === "oldest" ? time : -time;
      }
      return a.documentIndex - b.documentIndex;
    });
  }
  return {
    order, entries: ordered, excluded: leaf.leaflets.filter(record => !isSubjectsOwnWork(record)),
    unavailableChoices: (leaf.curation?.featured ?? []).filter(id => !highlighted.has(id)),
    undatedCount: entries.filter(entry => entry.workAt === null).length,
  };
}
