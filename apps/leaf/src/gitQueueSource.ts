/**
 * Reading one subject's commits for the review queue: every local branch, attributed by the
 * domain's own rule, each joined to its author date. The pure merge that turns them into drafts is
 * `mergeGitQueue` in `@foliage/photosynthesis`; everything here is git I/O.
 *
 * ATTRIBUTION IS DELEGATED, never re-derived. "Which commits are this person's" is a claim about
 * what evidence means, so it lives in `@foliage/leaf`, and `commitsToLeaflets` is the one
 * implementation of it — the same call `intake.mjs` makes to build the leaf. A commit the leaf
 * marks `excluded` is exactly a commit this read returns in `theirs`, by construction.
 *
 * A partial answer is never a smaller whole one: a narrowed walk comes back `complete: false`, and
 * dates git could not give come back as null with the reason, never as an invented instant.
 */

import { execFile } from "node:child_process";

import { commitsToLeaflets, type IntakeIssue, type ObservedCommit } from "@foliage/leaf";
import {
  gitSourceScope,
  readCommits,
  readGitMetadata,
  readGitRefs,
  type GitIntakeResult,
} from "@foliage/leaf/git-source";
import type { QueueCommit } from "@foliage/photosynthesis";

export type QueueRead =
  | {
      readonly ok: true;
      /** This subject's commits, each with its author date or null. */
      readonly commits: readonly QueueCommit[];
      /** Commits the domain attributes to somebody else. Counted, never drafted from. */
      readonly theirs: readonly ObservedCommit[];
      /** Every commit read, both halves. */
      readonly read: number;
      readonly repoRoot: string;
      /** The commit HEAD points at, or null when the history is empty. */
      readonly head: string | null;
      /** False when the walk narrowed to HEAD; `narrowedBecause` says why. */
      readonly complete: boolean;
      readonly narrowedBecause: string | null;
      /** Why no author dates could be read, or null when the date read succeeded. */
      readonly datesUnreadBecause: string | null;
    }
  | { readonly ok: false; readonly cause: "read-failed"; readonly failure: Extract<GitIntakeResult, { readonly ok: false }> }
  | { readonly ok: false; readonly cause: "attribution-refused"; readonly issues: readonly IntakeIssue[] };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Author dates by sha, over the same refs the history read walked. */
async function authoredDates(
  repo: string,
): Promise<{ readonly dates: ReadonlyMap<string, string>; readonly failure: string | null }> {
  try {
    const { refs } = await readGitRefs(repo);
    const metadata = await readGitMetadata(repo, undefined, refs);
    return { dates: new Map(metadata.map((m) => [m.sha, m.authoredAt] as const)), failure: null };
  } catch (error) {
    return { dates: new Map(), failure: message(error) };
  }
}

/** Read, attribute and date one repository's history for `identities`. */
export async function readQueueCommits(repo: string, identities: readonly string[]): Promise<QueueRead> {
  const read = await readCommits(repo);
  if (!read.ok) return { ok: false, cause: "read-failed", failure: read };

  const attributed = commitsToLeaflets({ commits: read.commits, identities, observedAt: new Date().toISOString() });
  if (!attributed.ok) return { ok: false, cause: "attribution-refused", issues: attributed.issues };
  /** Every sha the DOMAIN says is not this subject's, in the domain's own normalized form. */
  const excluded: ReadonlySet<string> = new Set(
    attributed.leaflets.flatMap((l) => (l.tier === "excluded" && l.provenance !== undefined ? [l.provenance.ref] : [])),
  );
  const isTheirs = (c: ObservedCommit): boolean => excluded.has(c.sha.trim().toLowerCase());
  const mine = read.commits.filter((c) => !isTheirs(c));

  const { dates, failure } = mine.length === 0 ? { dates: new Map<string, string>(), failure: null } : await authoredDates(repo);
  return {
    ok: true,
    commits: mine.map((c) => ({ sha: c.sha, subject: c.subject, authoredAt: dates.get(c.sha) ?? null })),
    theirs: read.commits.filter(isTheirs),
    read: read.commits.length,
    repoRoot: read.repoRoot,
    head: read.head,
    complete: read.narrowedBecause === null,
    narrowedBecause: read.narrowedBecause,
    datesUnreadBecause: failure,
  };
}

export type RepositoryMatch =
  | { readonly kind: "same"; readonly by: "git-dir" | "root-commit" }
  | { readonly kind: "different" }
  | { readonly kind: "unreadable"; readonly detail: string };

/** The parentless commits reachable from the local branches and HEAD. */
async function rootCommits(repo: string): Promise<readonly string[]> {
  const { refs } = await readGitRefs(repo);
  const stdout = await new Promise<string>((resolveRun, reject) => {
    execFile(
      "git",
      ["-C", repo, "rev-list", "--max-parents=0", ...refs, "--"],
      { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
      (error, out) => (error ? reject(error) : resolveRun(out)),
    );
  });
  return stdout.split("\n").map((line) => line.trim()).filter((line) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(line));
}

/**
 * Whether two paths hold the same repository: one git directory (a worktree of it, or the same
 * checkout by another spelling), or separate clones sharing a root commit.
 */
export async function sameRepository(a: string, b: string): Promise<RepositoryMatch> {
  try {
    const [scopeA, scopeB] = await Promise.all([gitSourceScope(a), gitSourceScope(b)]);
    if (scopeA === scopeB) return { kind: "same", by: "git-dir" };
    const [rootsA, rootsB] = await Promise.all([rootCommits(a), rootCommits(b)]);
    return rootsA.some((root) => rootsB.includes(root)) ? { kind: "same", by: "root-commit" } : { kind: "different" };
  } catch (error) {
    return { kind: "unreadable", detail: message(error) };
  }
}

/**
 * Which of `refs` the repository at `repo` holds as commits, asked of git in one read-only
 * `cat-file --batch-check`, one answer line per ref in order; null when git does not answer. A ref
 * that is not a hex object name is not held. A held commit need not be reachable: one a rewrite
 * left behind is still shown by `git show`.
 *
 * NOTHING IS FETCHED. These refs are often another repository's, by design, and a partial clone
 * asked for an object it lacks fetches it from its promisor remote: measured with GIT_TRACE on a
 * `--filter=blob:none` clone, a foreign sha started `git fetch origin`. GIT_NO_LAZY_FETCH keeps the
 * question on this computer, so a missing object is simply not held, and the timeout bounds a git
 * that stalls anyway.
 */
export async function commitsHeld(repo: string, refs: readonly string[]): Promise<ReadonlySet<string> | null> {
  const asked = [...new Set(refs.filter((ref) => /^[0-9a-f]{4,64}$/.test(ref)))];
  if (asked.length === 0) return new Set();
  const stdout = await new Promise<string | null>((resolveRun) => {
    const child = execFile(
      "git",
      ["-c", "core.fsmonitor=false", "-C", repo, "cat-file", "--batch-check=%(objectname) %(objecttype)"],
      {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, out) => resolveRun(error ? null : out),
    );
    // git can exit before it reads the question (a path that is not a repository); its exit answers.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(`${asked.join("\n")}\n`);
  });
  if (stdout === null) return null;
  const lines = stdout.split("\n");
  return new Set(
    asked.filter((ref, i) => {
      const [name = "", type] = (lines[i] ?? "").trim().split(" ");
      return type === "commit" && name.startsWith(ref);
    }),
  );
}

/** `RepositoryMatch`, plus the one answer only a queue can give: by its own commits. */
export type QueueRepositoryMatch = RepositoryMatch | { readonly kind: "same"; readonly by: "queue-commits" };

/**
 * `sameRepository` for a review queue, which can also answer from the queue's own commits. A queue
 * recorded from a folder that was since moved, renamed or re-cloned cannot be compared by path, and
 * that is the ordinary state right after a first grow, before anything is decided. So when `from`
 * cannot be read and the queue holds no decision, `repo` holding every commit its waiting drafts
 * name (`queue.refs`) holds that queue's work, and it answers `same`. Anything less, or no answer
 * from git, stays `unreadable`: never a guess either way.
 *
 * A QUEUE HOLDING A DECISION IS NOT JUDGED THIS WAY. The RC refuses to carry a decision to a
 * repository it cannot check (oneQueue.seam.test.ts pins it), and that stays as it is: such a queue
 * answers `unreadable`, and the refusal names the way back.
 */
export async function queueRepositoryMatch(
  from: string,
  repo: string,
  queue: { readonly decided: number; readonly refs: readonly string[] },
): Promise<QueueRepositoryMatch> {
  const match = await sameRepository(from, repo);
  if (match.kind !== "unreadable" || queue.decided > 0 || queue.refs.length === 0) return match;
  const held = await commitsHeld(repo, queue.refs);
  if (held === null) return match;
  return queue.refs.every((ref) => held.has(ref))
    ? { kind: "same", by: "queue-commits" }
    : { kind: "unreadable", detail: `${match.detail}; and ${repo} does not hold every commit in the queue` };
}

/**
 * Whether a checkout nobody read this pass may still hold commits of `repo`. Only a checkout
 * proven to be another repository cannot: the same repository, or one that cannot be checked
 * (a path that is gone included), leaves what it holds unproven either way.
 */
export async function mayHoldRepository(path: string, repo: string): Promise<boolean> {
  const match = await sameRepository(path, repo);
  switch (match.kind) {
    case "same":
    case "unreadable":
      return true;
    case "different":
      return false;
    default: {
      const impossible: never = match;
      throw new Error(`unhandled repository match: ${JSON.stringify(impossible)}`);
    }
  }
}

/** One checkout the workflow collector reads, as its saved settings name it. */
export interface WorkflowCheckout {
  readonly path: string;
  readonly enabled: boolean;
}

/** What the collector's checkouts of one repository still hold, and whether that is all of it. */
export interface CheckoutPresence {
  /** Every sha read in a checkout of the repository, whoever it is attributed to. */
  readonly present: readonly string[];
  /** False when a checkout of the repository, or one that cannot be checked, was not fully read. */
  readonly complete: boolean;
}

const HOLDS_NOTHING: CheckoutPresence = { present: [], complete: true };
const UNPROVEN: CheckoutPresence = { present: [], complete: false };

/**
 * Every sha one checkout holds, whoever made it, and whether that is all of it. A read that fails
 * proves nothing gone; a narrowed walk says so.
 */
export async function checkoutHolds(path: string): Promise<CheckoutPresence> {
  const read = await readCommits(path);
  return read.ok ? { present: read.commits.map((c) => c.sha), complete: read.narrowedBecause === null } : UNPROVEN;
}

async function presenceOf(repo: string, checkout: WorkflowCheckout): Promise<CheckoutPresence> {
  // A paused checkout is not read, exactly as the collector does not read it.
  if (!checkout.enabled) return (await mayHoldRepository(checkout.path, repo)) ? UNPROVEN : HOLDS_NOTHING;
  const match = await sameRepository(checkout.path, repo);
  switch (match.kind) {
    case "different":
      return HOLDS_NOTHING;
    case "unreadable":
      return UNPROVEN;
    case "same":
      return checkoutHolds(checkout.path);
    default: {
      const impossible: never = match;
      throw new Error(`unhandled repository match: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * THE COLLECTOR'S PRESENCE RULE, for a writer that reads one checkout. A draft the collector made
 * from another checkout of `repo` (a clone's own commit) is still in the repository while that
 * checkout holds it, and a checkout that is paused or cannot be read proves nothing gone.
 */
export async function checkoutPresence(repo: string, checkouts: readonly WorkflowCheckout[]): Promise<CheckoutPresence> {
  const each = await Promise.all(checkouts.map((checkout) => presenceOf(repo, checkout)));
  return {
    present: each.flatMap((p) => p.present),
    complete: each.every((p) => p.complete),
  };
}
