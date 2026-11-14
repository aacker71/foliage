/**
 * GATHER — deterministic facts about the subject's own work. No model. No network.
 *
 * This is the "light capture" half of photosynthesis: raw material comes in exactly as
 * it exists on the subject's machine — git history, the README, optionally a directory
 * of photos/screenshots — and nothing here interprets it. Interpretation (drafting) is
 * a separate, policy-gated step, so the privacy claim about THIS step can be absolute:
 * gathering makes zero network calls and runs no model.
 *
 * The honesty rule ported from the Coeadapt line's most instructive bug: a git failure
 * is NEVER collapsed into empty results. `repo-analyzer` once flattened git-missing /
 * not-a-repo / timeout into `commitCount: 0`, and the product then asserted "0 commits"
 * about work it had never read. Here every gather source either succeeds with data or
 * FAILS WITH ITS CAUSE carried on the result — the drafter and the review page render
 * the cause, never a fabricated zero.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { readGitMetadata, readGitRefs } from "@foliage/leaf/git-source";

/** One raw commit attributed to the identity. Subject line is VERBATIM evidence. */
interface GatheredCommit {
  readonly sha: string;
  readonly subject: string;
  readonly authoredAt: string;
}

/**
 * A cluster of related commits — the unit a candidate is drafted about. Clustering is
 * deterministic and dumb on purpose: the conventional-commit prefix before the first
 * colon ("feat(x)", "C1(BE)", "gitignore"), or "(no prefix)". A model may DESCRIBE a
 * cluster; it never decides what belongs together, so the same repo always gathers
 * into the same clusters and a re-run is comparable to the last one.
 */
export interface CommitCluster {
  readonly key: string;
  readonly commits: readonly GatheredCommit[];
}

export interface GatheredPhoto {
  readonly path: string;
  /** sha256 of the bytes — the stable evidence ref for an image. */
  readonly digest: string;
  readonly bytes: number;
}

export type SourceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly cause: string };

export interface GatheredGit {
  readonly clusters: readonly CommitCluster[];
  readonly total: number;
  /** Every author email seen in the repo, with counts — makes a wrong --identity diagnosable. */
  readonly observedAuthors: readonly { readonly email: string; readonly count: number }[];
  /**
   * Why the walk had to narrow to HEAD, or null when it read every local branch. On the SUCCESS
   * arm on purpose: a partial read is not a failure, and the caller must be able to say so.
   */
  readonly narrowedBecause: string | null;
}

export interface GatherResult {
  readonly repo: string;
  readonly identity: string;
  readonly git: SourceResult<GatheredGit>;
  readonly readme: SourceResult<{ readonly path: string; readonly headings: readonly string[]; readonly excerpt: string }>;
  /** Absent entirely when no --photos dir was given — "not asked" is not "empty". */
  readonly photos?: SourceResult<readonly GatheredPhoto[]>;
}

const PHOTO_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
/** Enough README to draft from without shipping the whole file to the model. */
const README_EXCERPT_CHARS = 4_000;

function clusterKey(subject: string): string {
  const colon = subject.indexOf(":");
  if (colon <= 0 || colon > 40) return "(no prefix)";
  return subject.slice(0, colon).trim();
}

/**
 * Attribution is a LITERAL comparison done here, never `git log --author=`.
 *
 * WHY, and this was found by an adversarial review reproducing it live: git treats
 * `--author` as a REGEX matched against "Name <email>", not as a literal string. So
 * `--author=alex.example.com` also matches `Alex Faux <alexXexample.com>` — a different
 * human — because the dots are wildcards. Virtually every real email contains a dot, so
 * over-matching was the COMMON case, not an edge case, and the failure mode is the worst
 * one this product has: another person's commit sha and subject line entering the
 * subject's harvest as "verbatim evidence", reviewable and promotable as their own work.
 * That is precisely the "provenance must not lie" invariant, broken silently.
 *
 * Escaping the regex would fix the over-match, but literal filtering is strictly better:
 * it also cannot abort on an unbalanced bracket (`--author='alex['` exits 128 with a
 * git-internal error), and it gives us the OBSERVED author emails for free — which is
 * what makes a mismatched --identity diagnosable instead of an unexplained empty result.
 */
export async function gatherGit(repo: string, identity: string): Promise<SourceResult<GatheredGit>> {
  const wanted = identity.trim().toLowerCase();
  try {
    /*
     * `--branches HEAD`, not a bare `git log` — WORK IN FLIGHT IS STILL WORK.
     *
     * A bare `git log` walks HEAD alone, so a candidate is never drafted from anything the person
     * has not merged yet. MEASURED on this repository: 253 commits from HEAD, 355 from
     * `--branches` — 102 of the subject's own commits invisible, every one carrying their own
     * address. Drafting only from merged history means the review queue is always weeks behind
     * what somebody is actually doing.
     *
     * `HEAD` is named alongside `--branches` for the detached case, where no branch tip points at
     * the commits the person is standing on. Local branches only: `--all` would pull in
     * remote-tracking refs and tags — a whole team's history — read only to be discarded by the
     * identity filter below. Which of the two are actually readable is the shared source reader's question.
     */
    const { refs, narrowedBecause } = await readGitRefs(repo);
    if (refs.length === 0) {
      return { ok: false, cause: `neither a local branch nor HEAD could be read: ${narrowedBecause}` };
    }
    const records = await readGitMetadata(repo, undefined, refs);
    const observed = new Map<string, number>();
    const commits: GatheredCommit[] = records
      .map(c => ({ ...c, email: c.email.trim() }))
      .filter((c) => {
        if (c.sha === "") return false;
        observed.set(c.email, (observed.get(c.email) ?? 0) + 1);
        return c.email.toLowerCase() === wanted; // LITERAL. No pattern semantics.
      })
      .map(({ sha, subject, authoredAt }) => ({ sha, subject, authoredAt }));

    const observedAuthors = [...observed.entries()]
      .map(([email, count]) => ({ email, count }))
      .sort((a, b) => b.count - a.count);

    const byKey = new Map<string, GatheredCommit[]>();
    for (const c of commits) {
      const key = clusterKey(c.subject);
      const list = byKey.get(key);
      if (list === undefined) byKey.set(key, [c]);
      else list.push(c);
    }
    const clusters = [...byKey.entries()]
      .map(([key, cs]) => ({ key, commits: Object.freeze(cs) }))
      .sort((a, b) => b.commits.length - a.commits.length);
    return {
      ok: true,
      data: { clusters: Object.freeze(clusters), total: commits.length, observedAuthors: Object.freeze(observedAuthors), narrowedBecause },
    };
  } catch (err) {
    // The cause travels. "git is not installed", "not a repository", and "timed out"
    // are three different next steps for the operator.
    return { ok: false, cause: err instanceof Error ? err.message : String(err) };
  }
}

async function gatherReadme(
  repo: string,
): Promise<SourceResult<{ path: string; headings: readonly string[]; excerpt: string }>> {
  const path = join(repo, "README.md");
  try {
    const text = await readFile(path, "utf8");
    const headings = [...text.matchAll(/^#{1,3} +(.+)$/gm)].map((m) => (m[1] ?? "").trim());
    return {
      ok: true,
      data: { path, headings: Object.freeze(headings), excerpt: text.slice(0, README_EXCERPT_CHARS) },
    };
  } catch (err) {
    return { ok: false, cause: err instanceof Error ? err.message : String(err) };
  }
}

async function gatherPhotos(dir: string): Promise<SourceResult<readonly GatheredPhoto[]>> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const photos: GatheredPhoto[] = [];
    for (const e of entries) {
      if (!e.isFile() || !PHOTO_EXTENSIONS.has(extname(e.name).toLowerCase())) continue;
      const path = join(dir, e.name);
      const bytes = await readFile(path);
      photos.push({
        path,
        digest: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      });
    }
    return { ok: true, data: Object.freeze(photos) };
  } catch (err) {
    return { ok: false, cause: err instanceof Error ? err.message : String(err) };
  }
}

export async function gather(opts: {
  readonly repo: string;
  readonly identity: string;
  readonly photosDir?: string;
}): Promise<GatherResult> {
  const [git, readme, photos] = await Promise.all([
    gatherGit(opts.repo, opts.identity),
    gatherReadme(opts.repo),
    opts.photosDir === undefined ? Promise.resolve(undefined) : gatherPhotos(opts.photosDir),
  ]);
  const result: GatherResult = {
    repo: opts.repo,
    identity: opts.identity,
    git,
    readme,
    ...(photos === undefined ? {} : { photos }),
  };
  return result;
}
