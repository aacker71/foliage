/** Node-only local document transactions. Deliberately separate from the pure domain export. */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync, linkSync, fsyncSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const code = (error: unknown) => error && typeof error === "object" && "code" in error ? error.code : undefined;

/** Parent aliases share a lock. File symlinks/hardlinks are refused, never silently replaced. */
function canonical(path: string): string {
  const absolute = resolve(path);
  let parent = dirname(absolute);
  const missing: string[] = [];
  while (!existsSync(parent)) { missing.unshift(basename(parent)); parent = dirname(parent); }
  const target = join(realpathSync(parent), ...missing, basename(absolute));
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || stat.nlink > 1 && stat.isFile()) {
      throw new Error(`local document ${target} is a file alias; use one regular document path before retrying`);
    }
  } catch (error) { if (code(error) !== "ENOENT") throw error; }
  return target;
}

/** Who a lock this process could not take says holds it. Judged only to say so: nothing here removes a lock. */
type LockHolder =
  | { readonly kind: "running"; readonly pid: number }
  /** The recorded pid is not running on this computer. */
  | { readonly kind: "stopped"; readonly pid: number }
  | { readonly kind: "elsewhere"; readonly host: string }
  /** Gone, empty, cut short or damaged: no owner on record. */
  | { readonly kind: "unrecorded" };

/** Signal 0 delivers nothing. Only ESRCH proves the process is gone; EPERM means it runs as someone else. */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return code(error) !== "ESRCH"; }
}

function holderAt(path: string): LockHolder {
  let record: { readonly pid?: unknown; readonly host?: unknown } = {};
  try { const parsed: unknown = JSON.parse(readFileSync(path, "utf8")); if (parsed !== null && typeof parsed === "object") record = parsed; }
  catch { /* no owner on record */ }
  const { pid, host } = record;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) return { kind: "unrecorded" };
  // An older Foliage recorded no host; its pid is judged on this computer, where the person is.
  if (typeof host === "string" && host !== "" && host !== hostname()) return { kind: "elsewhere", host };
  return alive(pid) ? { kind: "running", pid } : { kind: "stopped", pid };
}

/** Busy, said as what is happening and what to do. Names files, never the folder they sit in. */
function busy(target: string, lock: string): Error {
  const name = basename(target);
  const file = basename(lock);
  const holder = holderAt(lock);
  const detail = (() => {
    switch (holder.kind) {
      case "running": return `another Foliage process (pid ${holder.pid}) is writing ${name}. Try again when it finishes.`;
      case "stopped": return `${file} was left by a Foliage process that is not running on this computer (pid ${holder.pid}). If nothing else is writing ${name}, delete ${file} and try again.`;
      case "elsewhere": return `${file} belongs to Foliage on ${holder.host}. Try again when it finishes there; if it is not running, delete ${file} and try again.`;
      case "unrecorded": return `another Foliage process may be writing ${name}. Try again; if this keeps happening and no Foliage process is running, delete ${file}.`;
      default: { const impossible: never = holder; throw new Error(`unhandled lock holder: ${JSON.stringify(impossible)}`); }
    }
  })();
  return Object.assign(new Error(`local document busy: ${detail}`), { code: "ELOCALBUSY" });
}

/** Fail fast on contention; never steal a lock, even a stopped owner's. Callers retry the complete operation. */
export async function withDocumentLocks<T>(paths: readonly string[], work: () => Promise<T>): Promise<T> {
  const owned: { path: string; token: string }[] = [];
  const createdDirectories: string[] = [];
  const release = () => {
    const failures: string[] = [];
    for (const lock of owned.splice(0).reverse()) {
      try {
        if (JSON.parse(readFileSync(lock.path, "utf8")).token !== lock.token) throw new Error("ownership changed; left untouched");
        unlinkSync(lock.path);
      } catch (error) { failures.push(`${lock.path}: ${message(error)}`); }
    }
    for (const directory of createdDirectories.splice(0).reverse()) {
      try { rmdirSync(directory); }
      catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(code(error)))) failures.push(`${directory}: ${message(error)}`); }
    }
    return failures;
  };
  // Legacy CLIs use process.exit for named refusals. SIGKILL/power loss leaves a lock for inspection.
  const onExit = () => { const failures = release(); if (failures.length) process.stderr.write(`local lock cleanup failed: ${failures.join("; ")}\n`); };
  process.once("exit", onExit);
  let failed = false;
  let failure: unknown;
  let result: T | undefined;
  try {
    for (const target of [...new Set(paths.map(canonical))].sort()) {
      const firstCreated = mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      if (firstCreated !== undefined) {
        const created: string[] = [];
        for (let directory = dirname(target); ; directory = dirname(directory)) {
          created.unshift(directory);
          if (directory === firstCreated) break;
        }
        createdDirectories.push(...created);
      }
      const path = `${target}.local-lock`;
      const token = randomUUID();
      let fd;
      try { fd = openSync(path, "wx", 0o600); }
      catch (error) {
        if (code(error) !== "EEXIST") throw new Error(`cannot lock ${target}: ${message(error)}`);
        throw busy(target, path);
      }
      owned.push({ path, token });
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token, host: hostname(), createdAt: new Date().toISOString() }) + "\n"); }
      finally { closeSync(fd); }
    }
    result = await work();
  } catch (error) { failed = true; failure = error; }
  const cleanup = release();
  process.removeListener("exit", onExit);
  if (cleanup.length) throw new Error(`${failed ? `Operation failed: ${message(failure)}` : "Operation completed"}; lock cleanup also failed: ${cleanup.join("; ")}. Inspect before retrying.`);
  if (failed) throw failure;
  return result as T;
}

/** Caller holds the document lock. Fully written bytes become visible in one filesystem operation. */
export function writeDocument(path: string, text: string, replace = true, durable = false): void {
  const target = canonical(path);
  const temp = `${target}.write-${process.pid}-${randomUUID()}.tmp`;
  let failure: unknown;
  let failed = false;
  try {
    if (durable) {
      const fd = openSync(temp, "wx", 0o600);
      try { writeFileSync(fd, text); fsyncSync(fd); }
      finally { closeSync(fd); }
    } else writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    if (replace) renameSync(temp, target);
    else linkSync(temp, target); // exclusive publication, without exposing a partially written new file
  } catch (error) { failed = true; failure = error; }
  try { unlinkSync(temp); }
  catch (error) {
    if (code(error) !== "ENOENT") throw new Error(`${failed ? `Write failed: ${message(failure)}` : "Write completed"}; temporary cleanup also failed at ${temp}: ${message(error)}`);
  }
  if (failed) throw failure;
  if (durable) {
    // The rename/link may already be visible. Never call a sync failure a rollback.
    try {
      const fd = openSync(dirname(target), "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
    } catch (error) { throw new Error(`Write is visible but directory sync failed; durability is uncertain. Inspect before retrying: ${message(error)}`); }
  }
}
