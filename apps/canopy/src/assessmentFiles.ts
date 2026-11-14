/** Small local-file transactions. Locks serialize writers; rename publishes one complete record. */
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { acquirePublicationLock } from "./publicationLock.mjs";
import { digest } from "./ladybugAssessment.ts";

export async function readAssessmentFile(path: string): Promise<unknown | null> {
  let file;
  try { file = await open(path, "r"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    if ((await file.stat()).size > 256 * 1024) throw new Error("Assessment store exceeds its size limit.");
    // One extra byte catches a concurrent growth after stat without unbounded readFile allocation.
    const buffer = Buffer.alloc(256 * 1024 + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 256 * 1024) throw new Error("Assessment store exceeds its size limit.");
    try {
      const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value;
    } catch { throw new Error("Assessment storage is malformed. No stored content was accepted."); }
  } finally { await file.close(); }
}
export async function changeAssessmentFile(path: string, expected: string, change: (current: unknown | null) => unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const unlock = await acquirePublicationLock(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const current = await readAssessmentFile(path);
    if (digest(current) !== expected) throw new Error("This review changed. Reload and review the current version before trying again.");
    const bytes = JSON.stringify(change(current));
    if (Buffer.byteLength(bytes) > 256 * 1024) throw new Error("Assessment record exceeds its size limit.");
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    try { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
    finally { await unlock(); }
  }
}
