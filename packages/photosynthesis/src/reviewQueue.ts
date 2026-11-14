/**
 * THE ORDER OF THE ONE REVIEW QUEUE — a private working order for the owner, never a rating.
 *
 * Open candidates are grouped by Jev's private mark: keep, then everything unmarked or unsure,
 * then pass. Inside a group the newest author date comes first, undated work goes last, and ties
 * break by id, so the same queue always reads the same way. Decided candidates leave the list and
 * are ordered by when they were decided.
 *
 * A mark only places a row. It never approves, rejects or removes anything, and nothing here
 * produces a number: the groups are labels and the dates are the author's own.
 *
 * PURE and TOTAL: no fs, no clock, no network.
 */

import { gitLineage } from "./gitQueue.ts";
import type { HarvestCandidate } from "./harvestDocument.ts";

/** Jev's private outcome for one candidate. Absent means unchecked. */
export type JevMark = "keep" | "pass" | "unresolved";

/** Where an open candidate sits. `open` holds the unchecked and the unsure alike. */
export type QueueGroup = "keep" | "open" | "pass";

export interface QueueEntry {
  readonly candidate: HarvestCandidate;
  readonly group: QueueGroup;
  /** The newest author date among the candidate's evidence, or null when none is recorded. */
  readonly workedAt: string | null;
}

export interface OrderedQueue {
  readonly open: readonly QueueEntry[];
  readonly decided: readonly HarvestCandidate[];
}

function groupOf(mark: JevMark | undefined): QueueGroup {
  if (mark === undefined) return "open";
  switch (mark) {
    case "keep":
      return "keep";
    case "unresolved":
      return "open";
    case "pass":
      return "pass";
    default: {
      const impossible: never = mark;
      throw new Error(`unhandled Jev mark: ${JSON.stringify(impossible)}`);
    }
  }
}

function groupRank(group: QueueGroup): 0 | 1 | 2 {
  switch (group) {
    case "keep":
      return 0;
    case "open":
      return 1;
    case "pass":
      return 2;
    default: {
      const impossible: never = group;
      throw new Error(`unhandled queue group: ${JSON.stringify(impossible)}`);
    }
  }
}

const instant = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
};

/** The newest dated evidence entry's own `authoredAt` string, verbatim. */
function workedAtOf(candidate: HarvestCandidate): string | null {
  return candidate.evidence.reduce<{ readonly at: string; readonly t: number } | null>((newest, e) => {
    const t = instant(e.authoredAt);
    return t === null || e.authoredAt === undefined || (newest !== null && newest.t >= t) ? newest : { at: e.authoredAt, t };
  }, null)?.at ?? null;
}

const byId = (a: HarvestCandidate, b: HarvestCandidate): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Newer first, null last. Zero when both are null or equal. */
const newestFirst = (a: number | null, b: number | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
};

function decidedAt(candidate: HarvestCandidate): number | null {
  const review = candidate.review;
  switch (review.state) {
    case "candidate":
      return null;
    case "approved":
    case "rejected":
      return instant(review.at);
    default: {
      const impossible: never = review;
      throw new Error(`unhandled review state: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * Split and order the queue. Marks on decided or missing ids are ignored: a mark never follows a
 * candidate out of the open list.
 */
export function orderReviewQueue(
  candidates: readonly HarvestCandidate[],
  marks: ReadonlyMap<string, JevMark>,
): OrderedQueue {
  const open = candidates
    .filter((c) => c.review.state === "candidate")
    .map((candidate): QueueEntry => ({ candidate, group: groupOf(marks.get(candidate.id)), workedAt: workedAtOf(candidate) }))
    .sort(
      (a, b) =>
        groupRank(a.group) - groupRank(b.group) ||
        newestFirst(instant(a.workedAt ?? undefined), instant(b.workedAt ?? undefined)) ||
        byId(a.candidate, b.candidate),
    );
  const decided = candidates
    .filter((c) => c.review.state !== "candidate")
    .sort((a, b) => newestFirst(decidedAt(a), decidedAt(b)) || byId(a, b));
  return Object.freeze({ open: Object.freeze(open), decided: Object.freeze(decided) });
}

/** Every collection source is paused (and there is at least one). No sources is not a pause. */
export function queuePaused(sources: readonly { readonly enabled: boolean }[]): boolean {
  return sources.length > 0 && sources.every((source) => !source.enabled);
}

const isOpenGitDraft = (c: HarvestCandidate): boolean => c.review.state === "candidate" && gitLineage(c.id) !== null;

/**
 * What the queue shows. While collection is paused its undecided git drafts wait out of sight,
 * counted; decided work and drafts from other sources always show. Every surface that counts
 * the queue counts this, so /review, the workflow link and `foliage status` agree.
 */
export function shownQueue(
  candidates: readonly HarvestCandidate[],
  paused: boolean,
): { readonly shown: readonly HarvestCandidate[]; readonly open: number; readonly hidden: number } {
  const shown = paused ? candidates.filter((c) => !isOpenGitDraft(c)) : candidates;
  return Object.freeze({
    shown,
    open: shown.filter((c) => c.review.state === "candidate").length,
    hidden: candidates.length - shown.length,
  });
}
