/**
 * A garden document lock the command line could not take, said as ONE line — which file, what
 * happened, what to do — instead of a stack trace (QA #23).
 *
 * Two refusals come out of `withDocumentLocks` (packages/leaf/src/localFiles.ts):
 *   - busy (`ELOCALBUSY`): another Foliage process holds the lock. Only the lock module knows
 *     who, so its own sentence is passed through, with any folder cut down to the file's name.
 *   - `cannot lock <document>: <errno>`: the lock file could not be created. A folder this
 *     process may not write and a read-only disk are named, with their remedy.
 *
 * Anything else is null, and the caller rethrows it untouched: this explains those situations
 * and must never swallow a different one.
 */
import { basename } from "node:path";

const CANNOT_CREATE: ReadonlyMap<string, string> = new Map([
  ["EACCES", "the garden folder is read-only · fix its permissions"],
  ["EPERM", "the garden folder is read-only · fix its permissions"],
  ["EROFS", "the garden folder is on a read-only disk · move the garden to a writable disk"],
]);

/**
 * The busy sentence with its lock file named, never the folder: person-facing copy names a file.
 * The lock module says `local document busy: <absolute lock path>. <what to do>`, and that path
 * may hold spaces (iCloud Drive, "My Drive"), so it is matched by that known shape rather than
 * guessed at by whitespace. A busy sentence of another shape names no folder and passes as is.
 */
function busyLine(message: string): string {
  const busy = /^local document busy: (\/.+?\.local-lock)\. (.*)$/s.exec(message);
  if (busy === null) return message;
  const [, lock = "", rest = ""] = busy;
  return `local document busy: ${basename(lock)}. ${rest}`;
}

/** The one line for a lock refusal, or null when `error` is not one. */
export function lockRefusal(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if ((error as { readonly code?: unknown }).code === "ELOCALBUSY") return busyLine(error.message);
  const cannot = /^cannot lock (.+?): (E[A-Z]+): /.exec(error.message);
  if (cannot === null) return null;
  const [, document = "", errno = ""] = cannot;
  const cause = CANNOT_CREATE.get(errno);
  return cause === undefined ? null : `cannot write ${basename(document)} · ${cause}`;
}
