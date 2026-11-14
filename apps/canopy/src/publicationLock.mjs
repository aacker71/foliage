/** Cross-process serialization for one published id. Stale locks fail closed for manual recovery. */

import { randomUUID } from "node:crypto";
import { link, readFile, unlink, writeFile } from "node:fs/promises";

/** @param {unknown} error */
const codeOf = (error) => error !== null && typeof error === "object" && "code" in error
  ? String(error.code)
  : "UNKNOWN";

/** @param {unknown} pid */
function ownerIsAlive(pid) {
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) !== "ESRCH";
  }
}

/** @param {string} target @returns {Promise<() => Promise<void>>} */
export async function acquirePublicationLock(target) {
  const lockPath = `${target}.lock`;
  const token = randomUUID();
  const ownerPath = `${lockPath}.owner.${token}`;

  await writeFile(ownerPath, `${JSON.stringify({ pid: process.pid, token })}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    // Publish a complete owner record in one filesystem operation. A crash can leave the
    // unique owner file behind, but never an empty final lock that wedges future operations.
    await link(ownerPath, lockPath);
    await unlink(ownerPath).catch(() => {});
    return async () => {
      try {
        const owner = JSON.parse(await readFile(lockPath, "utf8"));
        if (owner.token === token) await unlink(lockPath);
      } catch (error) {
        if (codeOf(error) !== "ENOENT") throw error;
      }
    };
  } catch (error) {
    await unlink(ownerPath).catch(() => {});
    if (codeOf(error) !== "EEXIST") throw error;
    let owner;
    try {
      owner = JSON.parse(await readFile(lockPath, "utf8"));
    } catch {
      throw new Error(`publication lock ${lockPath} is unreadable; refusing to mutate`);
    }
    if (ownerIsAlive(owner.pid)) {
      throw new Error(`publication ${target} is already being changed by process ${String(owner.pid)}`);
    }
    // There is no portable compare-and-delete filesystem primitive. Automatically renaming a
    // stale-looking path can remove a new owner's lock between the read and rename. Fail closed;
    // an operator can inspect the recorded pid and remove this exact file deliberately.
    throw new Error(
      `publication lock ${lockPath} belongs to exited process ${String(owner.pid)}; ` +
      `inspect and remove that stale lock before retrying`,
    );
  }
}
