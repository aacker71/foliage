/**
 * Renderer protocol tests read actual commits from this repository instead of inventing text.
 *
 * A commit subject is whatever its author typed, so HEAD on its own is not a safe choice: a
 * subject naming a home-folder path is rightly refused by the publication gate, and a renderer
 * test would then fail for a reason that has nothing to do with the renderer. This walks back
 * from HEAD and keeps the newest commits whose subjects pass the same paragraph check the
 * published reader applies (`publicNarrativeIssue`, imported rather than restated). Test support
 * only: it lives outside `src/` so the Canopy runtime packager, which copies `src/`, `public/`
 * and top-level files, never ships it.
 */
import { execFileSync } from "node:child_process";
import { testRepository } from "../../../tools/development/testRepository.mjs";
import { publicNarrativeIssue } from "@foliage/canopy";

export interface ProtocolCommit { readonly ref: string; readonly text: string }
type ProtocolCommitPick =
  | { readonly ok: true; readonly commits: readonly ProtocolCommit[] }
  | { readonly ok: false; readonly reason: string };

/** How far back from HEAD the walk looks before giving up. */
export const PROTOCOL_COMMIT_WINDOW = 50;
const REPOSITORY = testRepository();
const SHOWN_REFUSALS = 5;

/** Pure. `log` is `git log -n <window> --format=%H%x1f%s`, newest first. Never quotes a refused subject. */
export function pickProtocolCommits(log: string, need: number, observedAt: string, shallow: boolean): ProtocolCommitPick {
  const rows = log.split("\n").filter(line => line.length > 0).map(line => {
    const split = line.indexOf("\x1f");
    return split < 0 ? { ref: line, text: "" } : { ref: line.slice(0, split), text: line.slice(split + 1) };
  });
  const commits: ProtocolCommit[] = [], refused: string[] = [];
  for (const row of rows) {
    if (commits.length === need) break;
    const issue = publicNarrativeIssue({ text: row.text, provenance: { source: "git", ref: row.ref, observedAt } });
    if (issue) refused.push(`${row.ref.slice(0, 12)} (${issue})`);
    else commits.push(Object.freeze(row));
  }
  if (commits.length === need) return { ok: true, commits: Object.freeze(commits) };
  if (rows.length === 0) return { ok: false, reason: `No commits can be read here, and these renderer protocol tests read ${need}.` };
  const missing = rows.length === 1 ? "HEAD^" : `HEAD~${rows.length}`;
  if (rows.length < need) {
    return { ok: false, reason: shallow
      ? `This checkout is shallow: ${missing} does not exist, so only ${rows.length} commit(s) can be read and these renderer protocol tests read ${need}. Fetch more history (git fetch --deepen=${PROTOCOL_COMMIT_WINDOW}) or check out with full depth.`
      : `${missing} does not exist: this repository has only ${rows.length} commit(s) and these renderer protocol tests read ${need}.` };
  }
  const deeper = shallow && rows.length < PROTOCOL_COMMIT_WINDOW
    ? ` This checkout is shallow; fetching more history (git fetch --deepen=${PROTOCOL_COMMIT_WINDOW}) gives the walk more commits to choose from.`
    : "";
  const shown = refused.slice(0, SHOWN_REFUSALS).join("; ") + (refused.length > SHOWN_REFUSALS ? `; and ${refused.length - SHOWN_REFUSALS} more` : "");
  return { ok: false, reason: `Only ${commits.length} of the last ${rows.length} commits have subjects the publication disclosure check admits, and these renderer protocol tests read ${need}.${deeper} Refused, newest first (git show -s <ref> to read one): ${shown}.` };
}

/** Reads the walk from `repository` (this one by default) and throws the plain reason when it falls short. */
export function recentProtocolCommits(need: number, observedAt: string, repository: string | URL = REPOSITORY): readonly ProtocolCommit[] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" });
  const shallow = git("rev-parse", "--is-shallow-repository").trim() === "true";
  const picked = pickProtocolCommits(git("log", `-n${PROTOCOL_COMMIT_WINDOW}`, "--format=%H%x1f%s"), need, observedAt, shallow);
  if (!picked.ok) throw new Error(picked.reason);
  return picked.commits;
}
