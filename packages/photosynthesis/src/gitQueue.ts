/**
 * THE GIT REVIEW QUEUE — how fresh commits become drafts without touching a decision.
 *
 * AN APPROVAL STANDS. A decided candidate (approved or rejected) is a frozen record: it is never
 * recomputed, never reopened, and the commits it holds are never drafted again. Before this file,
 * one new `feat:` commit changed the `git-cluster:feat` digest and reopened the whole cluster, so
 * every approval lasted only until the next commit with the same prefix.
 *
 * Commits no decided candidate holds go into UNDECIDED drafts, one lineage per subject prefix.
 * Generation 1 keeps the id this format always used, `git-cluster:<prefix>`; generation n is
 * `git-cluster:<prefix>:<n>`. A prefix is cut at the first ":" of a subject, so it never contains
 * one, and the two spellings cannot collide. New work on approved `feat` therefore arrives as
 * `git-cluster:feat:2`, a question of its own.
 *
 * Every attributed commit lands in some draft: there is no minimum size and nothing is dropped.
 * Drafts are cut oldest-first into pieces of at most 32 refs and 12,000 bytes of subject text,
 * which is what one Jev check can carry. A single subject over the byte cap is never truncated: it
 * stands alone in its own draft, verbatim.
 *
 * PURE and TOTAL: no fs, no clock, no network. The caller reads git and supplies the instant.
 */

import {
  harvestCandidateId,
  withCandidates,
  type HarvestCandidate,
  type HarvestCandidateId,
  type HarvestDocument,
  type HarvestEvidence,
} from "./harvestDocument.ts";

/** The deterministic extractor's identity, and the id namespace of every git draft. */
export const GIT_CLUSTER_EXTRACTOR = "git-cluster";
/** The cluster key for commit subjects with no "X:" prefix. An id word, never a title word. */
const UNPREFIXED = "unprefixed";
const NAMESPACE = `${GIT_CLUSTER_EXTRACTOR}:`;

/** One draft never holds more refs than one Jev check accepts. */
export const DRAFT_MAX_REFS = 32;
/** Subject bytes per draft, leaving room under Jev's 16,000-character material limit. */
export const DRAFT_MAX_SUBJECT_BYTES = 12_000;

/** One attributed commit as the queue sees it. `authoredAt` is null when git gave no date. */
export interface QueueCommit {
  readonly sha: string;
  readonly subject: string;
  readonly authoredAt: string | null;
}

/** A title drafted elsewhere (a local model) for one exact draft — see `draftKey`. */
export interface DraftTitle {
  readonly title: string;
  readonly extractor: string;
}

export interface GitQueueInput {
  readonly previous: HarvestDocument | undefined;
  /** This subject's attributed commits, as read. */
  readonly commits: readonly QueueCommit[];
  /** Shas that must never be drafted, beyond the ones decided candidates hold. */
  readonly heldExtra: ReadonlySet<string>;
  /** When this read happened; stamped on evidence first observed now. */
  readonly observedAt: string;
  /**
   * Whether `commits` is the whole history. False (a narrowed read) keeps every previously
   * drafted ref this read did not see, instead of treating absence as removal.
   */
  readonly complete: boolean;
  /**
   * Every sha the walk read, whoever it is attributed to. A ref absent from `commits` but present
   * here is still in the repository (another identity drafted it), so even a complete read keeps
   * it queued. Omitted, only `commits` counts as present.
   */
  readonly present?: ReadonlySet<string>;
  /** Titles for exact drafts, keyed by `draftKey`. A draft without one is titled from its subjects. */
  readonly titles?: ReadonlyMap<string, DraftTitle>;
  /** The extractor this run was asked to title with. An unchanged draft another extractor titled is rebuilt. */
  readonly extractor?: string;
}

export interface GitQueueMerge {
  readonly document: HarvestDocument;
  /** Ids of the drafts this merge built or rebuilt. Unchanged drafts are not listed. */
  readonly drafted: readonly HarvestCandidateId[];
  /** Ids of the undecided drafts this merge removed: every ref they held is gone or now decided. */
  readonly withdrawn: readonly HarvestCandidateId[];
  /** How many of the supplied commits a decision (or `heldExtra`) already holds. */
  readonly held: number;
}

/**
 * A subject's conventional-commit prefix — the text before its first ":" — and the words after
 * it. A subject with no such prefix has a null one and keeps every word. This is the one colon
 * rule: clustering and titling both cut here, so a title never repeats its own prefix.
 */
function splitSubjectPrefix(subject: string): { readonly prefix: string | null; readonly rest: string } {
  const trimmed = subject.trim();
  const colon = trimmed.indexOf(":");
  const prefix = colon > 0 ? trimmed.slice(0, colon).trim() : "";
  return prefix.length > 0 ? { prefix, rest: trimmed.slice(colon + 1).trim() } : { prefix: null, rest: trimmed };
}

/**
 * Cluster commits by conventional-commit subject prefix: the text before the first ":". This
 * repository's own history uses them ("intake:", "ledger(F1):", "cleanup: …"), so the
 * clusters are real structure, not an invented taxonomy. A subject with no prefix clusters
 * as "unprefixed" — reported as what it is rather than dropped.
 *
 * The cluster key is the VERBATIM prefix, which also makes candidate ids collision-free by
 * construction (distinct prefixes, distinct ids); a slugged id could collide and would then
 * be refused by this command's own self-check.
 *
 * Moved here from `apps/leaf/harvest.mjs` unchanged, so the queue and the CLI report share one rule.
 */
export function clusterBySubjectPrefix<T extends { readonly subject: string }>(
  commits: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const clusters = new Map<string, T[]>();
  for (const commit of commits) {
    const prefix = splitSubjectPrefix(commit.subject).prefix ?? UNPREFIXED;
    const bucket = clusters.get(prefix);
    if (bucket === undefined) clusters.set(prefix, [commit]);
    else bucket.push(commit);
  }
  // Deterministic output order: same repo state, byte-identical document (minus timestamps).
  return new Map([...clusters.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * A deterministic title composed from the commit subjects themselves — not a count.
 *
 * "${prefix}: N commits" told a reader how MANY things happened and nothing about WHAT. The
 * subjects are right there in the cluster, already this person's own words, so the honest
 * deterministic floor is to reuse them: strip each subject's "prefix:" marker, take its leading
 * clause (up to the first " — " or ","), and join the first few. No model, no network, no
 * invention — every word below was written by the subject in a commit message. Truncation is
 * never silent: subjects left out are counted as "+N more", and a clause clipped at a word
 * boundary ends in "…".
 *
 * The prefix is stripped by the clusterer's own colon rule (`splitSubjectPrefix`). A shorter
 * cut-off once left long prefixes in place, so a draft read "Jev in Scarlet and Canopy: Jev in
 * Scarlet and Canopy: marks beside highlights and".
 */
export function composeDeterministicTitle(prefix: string, cluster: readonly { readonly subject: string }[]): string {
  const clauses: string[] = [];
  const seen = new Set<string>();
  for (const c of cluster) {
    let t = splitSubjectPrefix(c.subject).rest;
    // split() never returns an empty array, but the checker cannot know that; the fallback is t itself.
    t = (t.split(" — ")[0] ?? t).split(", ")[0] ?? t;
    t = t.trim();
    if (t.length > 56) t = `${t.slice(0, 56).replace(/\s+\S*$/, "")}…`;
    const key = t.toLowerCase();
    if (t.length > 0 && !seen.has(key)) { seen.add(key); clauses.push(t); }
    if (clauses.length === 3) break;
  }
  // "unprefixed" is the clusterer's own key for subjects with no "X:", not the person's word.
  const lead = prefix === UNPREFIXED ? "" : `${prefix}: `;
  if (clauses.length === 0) return `${lead}${cluster.length} commits`;
  const more = cluster.length - Math.min(cluster.length, clauses.length);
  return `${lead}${clauses.join("; ")}${more > 0 ? ` (+${more} more)` : ""}`;
}

/** Which lineage and generation a git draft id names, or null outside the namespace. */
export function gitLineage(id: string): { readonly prefix: string; readonly generation: number } | null {
  if (!id.startsWith(NAMESPACE)) return null;
  const rest = id.slice(NAMESPACE.length);
  const cut = rest.lastIndexOf(":");
  const tail = cut > 0 ? rest.slice(cut + 1) : "";
  return /^[1-9]\d*$/.test(tail) && Number(tail) >= 2
    ? { prefix: rest.slice(0, cut), generation: Number(tail) }
    : { prefix: rest, generation: 1 };
}

const lineageId = (prefix: string, generation: number): HarvestCandidateId =>
  harvestCandidateId(generation === 1 ? `${NAMESPACE}${prefix}` : `${NAMESPACE}${prefix}:${generation}`);

/** The key a supplied title is bound to: the draft's id and its exact ref set. */
export function draftKey(id: string, refs: readonly string[]): string {
  return [id, ...[...refs].sort()].join("\n");
}

const isDecided = (c: HarvestCandidate): boolean => c.review.state !== "candidate";
const isUndecidedGitDraft = (c: HarvestCandidate): boolean => gitLineage(c.id) !== null && !isDecided(c);

/** The harvest without its undecided git drafts. Decided work and other sources are untouched. */
export function withoutUndecidedGitDrafts(harvest: HarvestDocument): HarvestDocument {
  return withCandidates(harvest, harvest.candidates.filter((c) => !isUndecidedGitDraft(c)));
}

/** One commit placed in a lineage, with what its evidence entry will say. */
interface Placed {
  readonly sha: string;
  readonly subject: string;
  readonly authoredAt: string | null;
  readonly observedAt: string;
  readonly prefix: string;
}

const authoredTime = (p: Placed): number | null => {
  if (p.authoredAt === null) return null;
  const t = Date.parse(p.authoredAt);
  return Number.isNaN(t) ? null : t;
};

/** Dated before undated, then by author time in `direction`, then by sha — total and stable. */
const byAuthored = (direction: 1 | -1) => (a: Placed, b: Placed): number => {
  const ta = authoredTime(a);
  const tb = authoredTime(b);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return (ta - tb) * direction;
  }
  return a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0;
};

const subjectBytes = (p: Placed): number => new TextEncoder().encode(p.subject).length;

/** Oldest-first pieces of at most DRAFT_MAX_REFS refs and DRAFT_MAX_SUBJECT_BYTES bytes. */
function pieces(oldestFirst: readonly Placed[]): readonly (readonly Placed[])[] {
  return oldestFirst
    .reduce<readonly { readonly items: readonly Placed[]; readonly bytes: number }[]>((acc, placed) => {
      const size = subjectBytes(placed);
      const last = acc.at(-1);
      return last !== undefined && last.items.length < DRAFT_MAX_REFS && last.bytes + size <= DRAFT_MAX_SUBJECT_BYTES
        ? [...acc.slice(0, -1), { items: [...last.items, placed], bytes: last.bytes + size }]
        : [...acc, { items: [placed], bytes: size }];
    }, [])
    .map((piece) => piece.items);
}

/** The `count` lowest generation numbers no decided candidate of the lineage occupies. */
const freeGenerations = (taken: ReadonlySet<number>, count: number): readonly number[] =>
  Array.from({ length: count + taken.size }, (_, i) => i + 1)
    .filter((g) => !taken.has(g))
    .slice(0, count);

const evidenceOf = (p: Placed): HarvestEvidence =>
  Object.freeze({
    source: "git",
    ref: p.sha,
    observedAt: p.observedAt,
    // The subject's own words, verbatim; a subjectless commit ships a bare ref, never a blank line.
    ...(p.subject.trim() === "" ? {} : { excerpt: p.subject }),
    ...(p.authoredAt === null ? {} : { authoredAt: p.authoredAt }),
  });

const sameRefSet = (c: HarvestCandidate, refs: readonly string[]): boolean =>
  c.evidence.length === refs.length && draftKey("", c.evidence.map((e) => e.ref)) === draftKey("", refs);

/**
 * Merge this read into the queue. Decided candidates and candidates outside the `git-cluster:`
 * namespace pass through verbatim; undecided git drafts are recomputed from the commits nothing
 * decided holds, and a recomputed draft whose id and refs did not change is kept exactly as it was
 * — unless the composer titled it and would no longer write that title; that draft is rebuilt once.
 */
export function mergeGitQueue(input: GitQueueInput): GitQueueMerge {
  const previousCandidates = input.previous?.candidates ?? [];
  const decided = previousCandidates.filter(isDecided);
  const previousDrafts = previousCandidates.filter(isUndecidedGitDraft);

  const held: ReadonlySet<string> = new Set([
    ...decided.flatMap((c) => c.evidence.map((e) => e.ref)),
    ...input.heldExtra,
  ]);

  /** What earlier drafts recorded about each sha, and which lineage held it. */
  const earlier = new Map(
    previousDrafts.flatMap((draft) =>
      draft.evidence.map((e) => [e.ref, { evidence: e, prefix: gitLineage(draft.id)?.prefix ?? UNPREFIXED }] as const),
    ),
  );

  const unique = [...new Map(input.commits.map((c) => [c.sha, c] as const)).values()];
  const seen: ReadonlySet<string> = new Set(unique.map((c) => c.sha));
  const fresh = unique.filter((c) => !held.has(c.sha));

  const placedFresh: readonly Placed[] = [...clusterBySubjectPrefix(fresh)].flatMap(([prefix, cluster]) =>
    cluster.map((c) => {
      const before = earlier.get(c.sha)?.evidence;
      return {
        sha: c.sha,
        subject: c.subject,
        authoredAt: c.authoredAt ?? before?.authoredAt ?? null,
        // First observed then, not now: a sha seen by an earlier read keeps that instant.
        observedAt: before?.observedAt ?? input.observedAt,
        prefix,
      };
    }),
  );
  // A narrowed read proves nothing about what it did not see, and a sha the walk read but did not
  // attribute to these identities is not gone from the repository: earlier drafted refs stay queued.
  const stillPresent = (sha: string): boolean => !input.complete || (input.present?.has(sha) ?? false);
  const placedKept: readonly Placed[] = [...earlier]
    .filter(([sha]) => !seen.has(sha) && !held.has(sha) && stillPresent(sha))
    .map(([sha, { evidence, prefix }]) => ({
      sha,
      subject: evidence.excerpt ?? "",
      authoredAt: evidence.authoredAt ?? null,
      observedAt: evidence.observedAt,
      prefix,
    }));

  const placed = [...placedFresh, ...placedKept];
  const lineages = [...new Set(placed.map((p) => p.prefix))].map(
    (prefix) => [prefix, placed.filter((p) => p.prefix === prefix)] as const,
  );
  const previousById = new Map(previousDrafts.map((d) => [String(d.id), d]));

  const drafts = [...lineages]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([prefix, members]) => {
      const taken = new Set(
        decided.flatMap((c) => {
          const lineage = gitLineage(c.id);
          return lineage !== null && lineage.prefix === prefix ? [lineage.generation] : [];
        }),
      );
      const cut = pieces([...members].sort(byAuthored(1)));
      const generations = freeGenerations(taken, cut.length);
      return cut.map((piece, i) => {
        const id = lineageId(prefix, generations[i] ?? i + 1);
        const newestFirst = [...piece].sort(byAuthored(-1));
        const refs = newestFirst.map((p) => p.sha);
        const before = previousById.get(id);
        const composed = composeDeterministicTitle(prefix, newestFirst);
        // A composed title the composer no longer writes is out of date, so the next collect or
        // grow retitles it. A model's title is kept: nothing here could write it again.
        const keep = before !== undefined && sameRefSet(before, refs) &&
          (input.extractor === undefined || before.extractor === input.extractor) &&
          (before.extractor !== GIT_CLUSTER_EXTRACTOR || before.title === composed);
        if (keep) return { candidate: before, rebuilt: false };
        const supplied = input.titles?.get(draftKey(id, refs));
        const candidate: HarvestCandidate = Object.freeze({
          id,
          title: supplied?.title ?? composed,
          evidence: Object.freeze(newestFirst.map(evidenceOf)),
          extractor: supplied?.extractor ?? GIT_CLUSTER_EXTRACTOR,
          draftedAt: input.observedAt,
          review: Object.freeze({ state: "candidate" as const }),
        });
        return { candidate, rebuilt: true };
      });
    });

  const kept = previousCandidates.filter((c) => !isUndecidedGitDraft(c));
  const draftIds: ReadonlySet<string> = new Set(drafts.map((d) => String(d.candidate.id)));
  const document = withCandidates(input.previous ?? {}, [...kept, ...drafts.map((d) => d.candidate)]);
  return {
    document: Object.freeze({ ...document, candidates: Object.freeze([...document.candidates]) }),
    drafted: Object.freeze(drafts.filter((d) => d.rebuilt).map((d) => d.candidate.id)),
    withdrawn: Object.freeze(previousDrafts.filter((d) => !draftIds.has(String(d.id))).map((d) => d.id)),
    held: unique.filter((c) => held.has(c.sha)).length,
  };
}
