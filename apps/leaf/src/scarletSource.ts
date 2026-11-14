/** Explicit reads of recorded git references from one operator-configured repository. */
import { execFile } from "node:child_process";
import type { ScarletContext } from "./scarletTools.ts";

type SourceRead = NonNullable<ScarletContext["sourceReads"]>[number];
export async function readScarletSource(repo: string | undefined, ref: string, signal: AbortSignal): Promise<SourceRead> {
  const unavailable = (detail: string): SourceRead => ({ ref, state: "unavailable", detail });
  if (!repo?.trim()) return unavailable("No source repository configured. Set FOLIAGE_SOURCE_REPO to the repository that holds this evidence.");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref)) return unavailable("Only complete recorded git commit identifiers can be read.");
  return new Promise((resolve) => {
    // No shell, hooks, signature programs, external diff, text conversion, replacements or lazy
    // remote fetches. The caller chooses a recorded ref; it cannot choose a path or a command.
    execFile("git", ["--no-pager", "-c", "core.fsmonitor=false", "-C", repo,
      "show", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-show-signature",
      "--format=fuller", "--date=iso-strict", "--patch", "--unified=3", `${ref}^{commit}`, "--"], {
      encoding: "utf8", timeout: 5000, maxBuffer: 256 * 1024, signal,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "0" },
    }, (error, stdout) => {
      if (error && "code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && stdout.trim() && !signal.aborted) {
        resolve({ ref, state: "read", text: stdout.slice(0, 12_000),
          detail: "Commit metadata and patch excerpt; output exceeded the bounded read limit. Remaining changes were not supplied." });
        return;
      }
      if (error) {
        const code = "code" in error ? String(error.code) : "unknown";
        resolve(unavailable(signal.aborted ? "Source read cancelled." : error.killed ? "Source read timed out." :
          code === "ENOENT" ? "Git is unavailable." : code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "Source output exceeded the read limit." :
          `Git could not read this commit in the configured repository (exit ${code}). No source text was supplied.`));
        return;
      }
      resolve({ ref, state: "read", text: stdout.slice(0, 12_000), detail: stdout.length > 12_000
        ? "Commit metadata and patch excerpt; shortened after 12,000 characters. Remaining changes were not supplied."
        : "Commit metadata and patch read from the configured repository. This does not verify authorship." });
    });
  });
}
