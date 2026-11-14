/** Shared publication mutation transaction helpers. */

import { acquirePublicationLock } from "./publicationLock.mjs";

/**
 * Keep mutation failure and lock-cleanup failure separate. A cleanup problem after a successful
 * write or removal must never be reported as though the public artifact did not change.
 *
 * @template T
 * @param {string} target
 * @param {() => Promise<T>} mutate
 * @param {(target: string) => Promise<() => Promise<void>>} [acquireLock]
 * @returns {Promise<{value: T | null, mutationError: unknown | null, releaseWarning: unknown | null}>}
 */
export async function withPublicationLock(target, mutate, acquireLock = acquirePublicationLock) {
  /** @type {(() => Promise<void>) | null} */
  let releaseLock = null;
  /** @type {T | null} */
  let value = null;
  /** @type {unknown | null} */
  let mutationError = null;
  /** @type {unknown | null} */
  let releaseWarning = null;

  try {
    releaseLock = await acquireLock(target);
    value = await mutate();
  } catch (error) {
    mutationError = error;
  } finally {
    if (releaseLock !== null) {
      try {
        await releaseLock();
      } catch (error) {
        releaseWarning = error;
      }
    }
  }

  return { value, mutationError, releaseWarning };
}

/**
 * @param {{state: "none"} | {state: "unparsable", detail: string, artifactDigest: string | null} | {state: "present", artifactDigest: string}} existing
 */
function publicationFingerprint(existing) {
  if (existing.state === "none") return "none";
  if (existing.state === "present" || existing.artifactDigest !== null) return existing.artifactDigest;
  return `unreadable:${existing.detail}`;
}

/**
 * @param {{state: "none"} | {state: "unparsable", detail: string, artifactDigest: string | null} | {state: "present", artifactDigest: string}} reviewed
 * @param {{state: "none"} | {state: "unparsable", detail: string, artifactDigest: string | null} | {state: "present", artifactDigest: string}} current
 * @param {string} target
 */
export function assertPublicationUnchanged(reviewed, current, target) {
  if (publicationFingerprint(current) === publicationFingerprint(reviewed)) return;
  throw Object.assign(
    new Error(`${target} changed after the review. Re-run to inspect the current public artifact.`),
    { code: "ESTALEPUBLIC" },
  );
}
