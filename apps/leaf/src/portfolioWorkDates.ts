/** Private read-only enrichment from one explicitly configured local repository. This never
 * writes dates into a Leaf or a public artifact, and never reads an inferred repository path. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { isSubjectsOwnWork, type Leaf } from "@foliage/leaf";
import { readGitMetadata } from "@foliage/leaf/git-source";
import { gitEvidenceRefs, type GitWorkDate } from "./portfolioTimeline.ts";

export interface PortfolioWorkDates {
  readonly dates: ReadonlyMap<string, GitWorkDate>;
  readonly revision: string;
  readonly status: "ready" | "partial" | "unavailable" | "unconfigured" | "no-git-evidence";
  readonly reason: string | null;
  readonly requested: number;
  readonly resolved: number;
}
interface Retry { readonly after: number; readonly reason: string }
interface RepositoryCache {
  readonly dates: Map<string, GitWorkDate>;
  readonly retry: Map<string, Retry>;
  pending: Promise<void> | null;
  notice: { readonly refs: ReadonlySet<string>; readonly reason: string } | null;
}
const repositories = new Map<string, RepositoryCache>();
const RETRY_MS = 15_000;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function result(refs: readonly string[], dates: ReadonlyMap<string, GitWorkDate>, status: PortfolioWorkDates["status"], reason: string | null): PortfolioWorkDates {
  const contents = [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([ref, date]) => [ref, date.authoredAt]);
  const revision = `sha256:${createHash("sha256").update(JSON.stringify({ refs: [...refs].sort(), contents, status, reason })).digest("hex")}`;
  return { dates, revision, status, reason, requested: refs.length, resolved: dates.size };
}

async function observe(repo: string, refs: readonly string[], cache: RepositoryCache): Promise<void> {
  let metadata: Awaited<ReturnType<typeof readGitMetadata>> = [];
  let failure: string | null = null;
  try {
    metadata = await readGitMetadata(repo, undefined, refs);
    cache.notice = null;
  } catch (error) {
    failure = `Git read failed: ${message(error)}.`;
    try {
      // One absent object can reject the whole exact-ref batch. A bounded HEAD read recovers
      // only requested matches; its other history never enters the cache or returned map.
      metadata = await readGitMetadata(repo);
      failure += " Read HEAD history instead; exact matches only.";
    } catch (fallbackError) {
      failure += ` HEAD history read failed: ${message(fallbackError)}`;
    }
    cache.notice = { refs: new Set(refs), reason: failure };
  }
  const requested = new Set(refs);
  for (const item of metadata) {
    if (!requested.has(item.sha)) continue;
    cache.dates.set(item.sha, Object.freeze({ source: "git", ref: item.sha, authoredAt: item.authoredAt }));
    cache.retry.delete(item.sha);
  }
  for (const ref of refs) {
    if (!cache.dates.has(ref)) cache.retry.set(ref, { after: Date.now() + RETRY_MS,
      reason: failure ?? "No author date for a retained commit." });
  }
}

/** Successful metadata is immutable by repository path + exact commit SHA. Missing objects
 * and failed reads retry after a short TTL, so five-second portfolio refreshes do not spawn
 * Git repeatedly. Concurrent readers share the in-flight batch. Existing Git read limits apply. */
export async function loadPortfolioWorkDates(leaf: Leaf, env: Readonly<Record<string, string | undefined>> = process.env): Promise<PortfolioWorkDates> {
  const refs = [...new Set(leaf.leaflets.filter(isSubjectsOwnWork).flatMap(gitEvidenceRefs))];
  if (!refs.length) return result(refs, new Map(), "no-git-evidence", "No retained Git commits.");
  const configured = env["FOLIAGE_SOURCE_REPO"]?.trim();
  if (!configured) return result(refs, new Map(), "unconfigured", "No repository configured.");
  const repo = resolve(configured);
  let cache = repositories.get(repo);
  if (!cache) {
    cache = { dates: new Map(), retry: new Map(), pending: null, notice: null };
    repositories.set(repo, cache);
  }
  if (cache.pending) await cache.pending;
  const now = Date.now();
  const missing = refs.filter(ref => !cache!.dates.has(ref) && (cache!.retry.get(ref)?.after ?? 0) <= now);
  if (missing.length) {
    const pending = observe(repo, missing, cache);
    cache.pending = pending;
    try { await pending; } finally { if (cache.pending === pending) cache.pending = null; }
  }
  const dates = new Map(refs.flatMap(ref => cache!.dates.has(ref) ? [[ref, cache!.dates.get(ref)!] as const] : []));
  const reasons = new Set(refs.flatMap(ref => cache!.retry.has(ref) ? [cache!.retry.get(ref)!.reason] : []));
  if (cache.notice && refs.some(ref => cache!.notice!.refs.has(ref))) reasons.add(cache.notice.reason);
  const reason = reasons.size ? [...reasons].join(" ") : null;
  return result(refs, dates, dates.size === refs.length ? "ready" : dates.size ? "partial" : "unavailable", reason);
}
