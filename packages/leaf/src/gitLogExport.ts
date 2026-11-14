/**
 * Reading a git history the person exported themselves — the browser's way in.
 *
 * The local app runs `git` and reads the commit objects (see gitSource.ts). A web page cannot,
 * so the person runs one command and hands the page its output:
 *
 *     git log --no-merges --format='%H%x09%ae%x09%G?%x09%GS%x09%s' > history.tsv
 *
 * Every field is git's own output, copied as given. What the export CANNOT carry is the raw
 * object, so whether an `N` verdict is truly unsigned is unknown here. The armor is therefore
 * reported as `other` ("carries something unobserved"), which `signatureFinding` reads as
 * `unchecked` — the safe direction: an unread signature can cost a warning, never a false
 * "unsigned". Nothing here can make a commit `verified` that git did not accept and bind.
 *
 * Pure and total: text in, commits or every reason out. A line it cannot read fails the whole
 * export, because returning the rest would state a smaller history than the person has.
 */
import type { IntakeIssue, ObservedCommit } from "./intake.ts";

export const GIT_LOG_EXPORT_COMMAND = "git log --no-merges --format='%H%x09%ae%x09%G?%x09%GS%x09%s' > history.tsv";

export type GitLogExport =
  | { readonly ok: true; readonly commits: readonly ObservedCommit[] }
  | { readonly ok: false; readonly issues: readonly IntakeIssue[] };

const FIELDS_BEFORE_SUBJECT = 4;

export function parseGitLogExport(text: string): GitLogExport {
  const issues: IntakeIssue[] = [];
  const commits: ObservedCommit[] = [];
  const lines = text.split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    const parts = line.split("\t");
    if (parts.length <= FIELDS_BEFORE_SUBJECT) {
      issues.push({
        at: `line ${i + 1}`,
        message: `expected 5 tab-separated fields (sha, author email, %G?, %GS, subject); found ${parts.length}. Export with: ${GIT_LOG_EXPORT_COMMAND}`,
      });
      continue;
    }
    const [sha, authorEmail, signature, signer] = parts as [string, string, string, string];
    commits.push(Object.freeze({
      sha,
      authorEmail,
      signature,
      signer,
      // A subject may itself contain tabs; everything after the fourth one is the subject.
      subject: parts.slice(FIELDS_BEFORE_SUBJECT).join("\t"),
      signatureArmor: "other" as const,
    }));
  }
  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  if (commits.length === 0) {
    return { ok: false, issues: [{ at: "file", message: `no commits found. An empty file is not an empty history — export with: ${GIT_LOG_EXPORT_COMMAND}` }] };
  }
  return { ok: true, commits: Object.freeze(commits) };
}
