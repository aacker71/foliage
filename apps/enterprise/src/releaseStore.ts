/**
 * Where release state lives, and the ONLY way it changes.
 *
 * Every mutation goes through `applyEvent` from `@foliage/enterprise-policy`. This module
 * does I/O and history; it makes no policy decision of its own and contains no state
 * table. If a transition is illegal, or the actor may not fire it, the store refuses with
 * the machine's own reason — it never writes a state the machine would not have produced.
 *
 * DEFAULT IS `internal`, and it is the only safe default: a leaf nobody has decided about
 * is not public. An absent store file therefore means "everything internal", which is a
 * true statement about a company that has made no release decisions yet — not an error.
 *
 * EVERY TRANSITION IS APPENDED, never overwritten. The current state is derivable from
 * the history, but it is also stored, because a release decision is exactly the kind of
 * thing someone will ask "who approved this, and when" about — and an audit trail that
 * has to be recomputed to be read is one nobody reads.
 */

import { randomUUID } from "node:crypto";
import { lstat, open, realpath, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { isIsoInstant } from "@foliage/leaf";
import { withDocumentLocks } from "@foliage/leaf/local-files";

import {
  applyEvent,
  isContentsBound,
  isReleaseContentsDigest,
  type Actor,
  type ReleaseEvent,
  type ReleaseState,
} from "@foliage/enterprise-policy";

export interface ReleaseRecord {
  readonly state: ReleaseState;
  readonly history: readonly {
    readonly event: ReleaseEvent;
    readonly actor: Actor;
    readonly from: ReleaseState;
    readonly to: ReleaseState;
    readonly at: string;
    /**
     * Approve and publish only: `releaseContentsDigest` of the records the deciding person was
     * shown. Absent on entries recorded before decisions were bound to their contents.
     */
    readonly contents?: string;
  }[];
}

export type ReleaseStore = Readonly<Record<string, ReleaseRecord>>;

/** The default every leaf starts in. Internal until somebody decides otherwise. */
export const DEFAULT_STATE: ReleaseState = "internal";

/** Only an absent file is empty. Corrupt or unreadable history is never discarded. */
export async function loadStore(path: string): Promise<ReleaseStore> {
  return (await readReleaseStorage(path)).releases;
}

export function stateOf(store: ReleaseStore, leaf: string): ReleaseState {
  return Object.hasOwn(store, leaf) ? store[leaf]!.state : DEFAULT_STATE;
}

export function historyOf(store: ReleaseStore, leaf: string): ReleaseRecord["history"] {
  return Object.hasOwn(store, leaf) ? store[leaf]!.history : [];
}

/**
 * While a leaf is `approved`, the contents digest the policy owner approved: the only records
 * Publish may release. `undefined` in any other state, or when the approval was recorded before
 * decisions were bound to their contents.
 */
export function approvedContents(store: ReleaseStore, leaf: string): string | undefined {
  if (stateOf(store, leaf) !== "approved") return undefined;
  return historyOf(store, leaf).findLast((h) => h.event === "approve")?.contents;
}

/** Why Publish is refused, and what the approved card says, once the records differ from the approved ones. */
export const CHANGED_SINCE_APPROVAL = "The records changed after approval. Retract and review again.";

/** One row of the whole-store audit trail: a leaf's history entry, with the leaf named. */
export interface ReleaseHistoryRow {
  readonly leaf: string;
  readonly event: ReleaseEvent;
  readonly actor: Actor;
  readonly from: ReleaseState;
  readonly to: ReleaseState;
  readonly at: string;
  readonly contents?: string;
}

/**
 * Every transition ever recorded, across every leaf, most recent first.
 *
 * ONLY APPLIED TRANSITIONS EVER REACH THIS. `fire` returns a new store only when the machine
 * accepted the event, and the transaction only persists that success — a refused
 * transition never gets written, so there is nothing here for it to be missing FROM. That is
 * not a gap in the audit trail; it is what "the machine decides, this records" means: a
 * refusal changed no state, so there is no state change to log.
 *
 * Sorted by `at` as a STRING, which is safe here and only here: every writer of this field
 * (the server, this module's own tests) uses `Date.prototype.toISOString()`, whose format is
 * fixed-width and zero-padded, so lexical order and chronological order agree. A store that
 * somehow held a non-canonical instant would sort wrong silently — the same trap
 * `isIsoInstant` exists to catch one layer up, in @foliage/leaf's document parser, which this
 * format does not go through.
 */
export function allHistory(store: ReleaseStore): readonly ReleaseHistoryRow[] {
  const rows: ReleaseHistoryRow[] = [];
  for (const [leaf, record] of Object.entries(store)) {
    for (const h of record.history) rows.push({ leaf, ...h });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export type FireResult =
  | { readonly ok: true; readonly store: ReleaseStore; readonly from: ReleaseState; readonly to: ReleaseState; readonly note: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Fire one event against one leaf. The machine decides; this records.
 *
 * Returns a new store rather than mutating, so a refused transition cannot leave a
 * half-applied change behind — the caller writes only on success.
 */
export function fire(
  store: ReleaseStore,
  leaf: string,
  event: ReleaseEvent,
  actor: Actor,
  at: string,
  contents?: string,
): FireResult {
  const from = stateOf(store, leaf);
  const result = applyEvent(from, event, actor);
  if (!result.ok) return { ok: false, reason: result.reason };

  const entry = { event, actor, from, to: result.state, at };
  const record: ReleaseRecord = {
    state: result.state,
    history: [...historyOf(store, leaf), contents === undefined ? entry : { ...entry, contents }],
  };
  return { ok: true, store: { ...store, [leaf]: record }, from, to: result.state, note: result.note };
}

/** A policy-state change, never a claim that a public artifact was published or delivered. */
export interface ReleaseOutboxEvent extends ReleaseHistoryRow {
  readonly id: string;
  readonly operationId: string;
  readonly kind: "enterprise.release.changed";
  readonly historyIndex: number;
  readonly status: "pending";
}

export interface ReleaseStorage {
  readonly format: "foliage-release-store";
  readonly version: 1;
  readonly releases: ReleaseStore;
  readonly outbox: readonly ReleaseOutboxEvent[];
}

export interface ReleaseOperation {
  readonly operationId: string;
  readonly leaf: string;
  readonly event: ReleaseEvent;
  readonly actor: Actor;
  readonly at: string;
  readonly expectedHistoryLength: number;
  /**
   * Required for approve and publish (`isContentsBound`): the contents digest the review showed,
   * posted with its form, and the one the caller recomputed from the leaf as it is now — `null`
   * when that could not be established (the leaf is gone, unreadable or ambiguous). A decision
   * is refused unless the two are equal, and the reviewed digest is recorded with it. Publish is
   * also refused unless it equals the digest its approval recorded (`approvedContents`).
   */
  readonly contents?: { readonly reviewed: string; readonly current: string | null };
}

export type ReleaseCommit =
  | { readonly ok: true; readonly event: ReleaseOutboxEvent; readonly replayed: boolean; readonly warning?: string }
  | { readonly ok: false; readonly reason: string };

const MAX_BYTES = 32 * 1024 * 1024;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? error.code : undefined;
const emptyStorage = (): ReleaseStorage => ({ format: "foliage-release-store", version: 1, releases: {}, outbox: [] });

function invalid(reason: string): never {
  throw new Error(`Invalid release storage: ${reason}. Existing bytes were not replaced.`);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    invalid(`${label} has missing or unexpected fields`);
  }
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}
function operationId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
function actor(value: unknown): value is Actor {
  return value === "subject" || value === "policy_owner" || value === "system";
}
function releaseEvent(value: unknown): value is ReleaseEvent {
  return ["propose", "open_review", "approve", "reject", "publish", "withdraw", "retract"].includes(String(value));
}
function instant(value: unknown): value is string {
  return typeof value === "string" && isIsoInstant(value);
}

function validateReleases(value: unknown): asserts value is ReleaseStore {
  const store = object(value, "releases");
  for (const [leaf, raw] of Object.entries(store)) {
    if (!identifier(leaf)) invalid("a leaf identifier is empty or too long");
    const record = object(raw, "release record");
    keys(record, ["state", "history"], "release record");
    if (!Array.isArray(record["history"])) invalid("history must be an array");
    let state: ReleaseState = "internal";
    for (const entry of record["history"]) {
      const row = object(entry, "history entry");
      const bound = Object.hasOwn(row, "contents");
      keys(row, bound ? ["event", "actor", "from", "to", "at", "contents"] : ["event", "actor", "from", "to", "at"], "history entry");
      if (!actor(row["actor"]) || !releaseEvent(row["event"]) || !instant(row["at"])) invalid("history actor, event or timestamp is invalid");
      if (bound && (!isContentsBound(row["event"]) || !isReleaseContentsDigest(row["contents"]))) invalid("history contents digest is invalid");
      const result = applyEvent(state, row["event"], row["actor"]);
      if (!result.ok || row["from"] !== state || row["to"] !== result.state) invalid("history transition does not match its chain");
      state = result.state;
    }
    if (record["state"] !== state) invalid("stored state disagrees with history");
  }
}

function validateStorage(value: unknown): ReleaseStorage {
  const root = object(value, "document");
  // A legacy leaf called 'format' is an object, so it is not an envelope marker.
  if (typeof root["format"] !== "string") {
    validateReleases(root);
    return { ...emptyStorage(), releases: root };
  }
  keys(root, ["format", "version", "releases", "outbox"], "document");
  if (root["format"] !== "foliage-release-store" || root["version"] !== 1) invalid("unsupported format or version");
  validateReleases(root["releases"]);
  const releases = root["releases"];
  if (!Array.isArray(root["outbox"])) invalid("outbox must be an array");
  const ids = new Set<string>();
  const operations = new Set<string>();
  const transitions = new Set<string>();
  for (const raw of root["outbox"]) {
    const entry = object(raw, "outbox event");
    keys(entry, ["id", "operationId", "kind", "leaf", "event", "actor", "from", "to", "at", "historyIndex", "status"], "outbox event");
    if (!operationId(entry["id"]) || !operationId(entry["operationId"]) || !identifier(entry["leaf"]) ||
        entry["kind"] !== "enterprise.release.changed" || entry["status"] !== "pending" ||
        !Number.isSafeInteger(entry["historyIndex"]) || Number(entry["historyIndex"]) < 0) invalid("outbox metadata is invalid");
    const index = entry["historyIndex"] as number;
    const row = historyOf(releases, entry["leaf"])[index];
    if (!row || ["event", "actor", "from", "to", "at"].some(key => entry[key] !== row[key as keyof typeof row])) invalid("outbox event does not match its history entry");
    const ref = JSON.stringify([entry["leaf"], index]);
    if (ids.has(entry["id"]) || operations.has(entry["operationId"]) || transitions.has(ref)) invalid("duplicate outbox event, operation or transition");
    ids.add(entry["id"]); operations.add(entry["operationId"]); transitions.add(ref);
  }
  return root as unknown as ReleaseStorage;
}

/** Preserve the operation error when closing its handle also fails. */
async function closeAfter<T>(file: FileHandle, work: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  let failed = false;
  let failure: unknown;
  try { result = await work(); } catch (error) { failed = true; failure = error; }
  try { await file.close(); }
  catch (error) {
    if (failed) throw new AggregateError([failure, error], `${errorMessage(failure)}; handle close also failed: ${errorMessage(error)}`);
    throw error;
  }
  if (failed) throw failure;
  return result as T;
}

/** Resolve directory aliases and test sync capability before the lock creates any parents. */
async function prepareTarget(path: string): Promise<string> {
  const absolute = resolve(path);
  let parent = dirname(absolute);
  for (;;) {
    try { await lstat(parent); break; }
    catch (error) {
      if (errorCode(error) !== "ENOENT" || dirname(parent) === parent) throw error;
      parent = dirname(parent);
    }
  }
  const canonicalParent = await realpath(parent);
  try { await syncDirectories(canonicalParent); }
  catch (error) {
    throw new Error(`Release storage location cannot sync its canonical directory ancestry; no release mutation was attempted: ${errorMessage(error)}`);
  }
  return join(canonicalParent, relative(parent, absolute));
}

/** Legacy reads do not migrate or backfill notifications. No recipient or content payload is stored. */
export async function readReleaseStorage(path: string): Promise<ReleaseStorage> {
  let file;
  try { file = await open(path, "r"); }
  catch (error) { if (errorCode(error) === "ENOENT") return emptyStorage(); throw error; }
  return closeAfter(file, async () => {
    if ((await file.stat()).size > MAX_BYTES) invalid("document exceeds the 32 MiB local-store limit");
    const text = await file.readFile("utf8");
    if (Buffer.byteLength(text) > MAX_BYTES) invalid("document exceeds the 32 MiB local-store limit");
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { invalid("document is not valid JSON"); }
    return validateStorage(value);
  });
}

/** Retry the full chain, including directories left by interrupted earlier attempts. */
async function syncDirectories(start: string): Promise<void> {
  for (let parent = start; ; parent = dirname(parent)) {
    const directory = await open(parent, "r");
    await closeAfter(directory, () => directory.sync());
    if (dirname(parent) === parent) break;
  }
}

/** Caller owns the document lock. Sync bytes before rename and its directory before ACK. */
async function persist(path: string, storage: ReleaseStorage): Promise<void> {
  validateStorage(storage);
  const bytes = JSON.stringify(storage) + "\n";
  if (Buffer.byteLength(bytes) > MAX_BYTES) invalid("document exceeds the 32 MiB local-store limit");
  const temp = `${path}.write-${randomUUID()}.tmp`;
  let renamed = false;
  let failure: unknown;
  try {
    const file = await open(temp, "wx", 0o600);
    await closeAfter(file, async () => { await file.writeFile(bytes, "utf8"); await file.sync(); });
    await rename(temp, path);
    renamed = true;
    await syncDirectories(dirname(path));
  } catch (error) { failure = error; }
  let cleanup: unknown;
  try { await unlink(temp); } catch (error) { if (errorCode(error) !== "ENOENT") cleanup = error; }
  if (failure !== undefined || cleanup !== undefined) {
    throw new Error(`${renamed ? "Release file was replaced; durability acknowledgement is uncertain. Check the existing operation before retrying" : "Release file was not replaced"}: ${failure === undefined ? "temporary cleanup failed" : errorMessage(failure)}${cleanup === undefined ? "" : `; cleanup also failed: ${errorMessage(cleanup)}`}`);
  }
}

/** Initialization/import only. Never overwrite live history or pending notification work. */
export async function saveStore(path: string, store: ReleaseStore): Promise<void> {
  validateReleases(store);
  const target = await prepareTarget(path);
  await withDocumentLocks([target], async () => {
    let exists = true;
    try { const file = await open(target, "r"); await file.close(); }
    catch (error) { if (errorCode(error) === "ENOENT") exists = false; else throw error; }
    if (exists) throw new Error("Release store already exists; initialization cannot replace history or pending events.");
    await persist(target, { ...emptyStorage(), releases: store });
  });
}

/** State, receipt and pending event become visible together; retries never repeat the transition. */
export async function commitRelease(path: string, operation: ReleaseOperation): Promise<ReleaseCommit> {
  const { leaf, event, at, expectedHistoryLength, contents } = operation;
  if (!operationId(operation.operationId) || !identifier(leaf) || !actor(operation.actor) || !releaseEvent(event) ||
      !instant(at) || !Number.isSafeInteger(expectedHistoryLength) || expectedHistoryLength < 0 ||
      (contents !== undefined && (!isReleaseContentsDigest(contents.reviewed) ||
        (contents.current !== null && !isReleaseContentsDigest(contents.current))))) {
    return { ok: false, reason: "A release decision needs a valid operation, actor, event, timestamp and reviewed history version." };
  }
  const reviewed = isContentsBound(event) ? contents?.reviewed : undefined;
  const target = await prepareTarget(path);
  let committed: Extract<ReleaseCommit, { ok: true }> | undefined;
  try {
    return await withDocumentLocks([target], async (): Promise<ReleaseCommit> => {
      const storage = await readReleaseStorage(target);
      const previous = storage.outbox.find(row => row.operationId === operation.operationId);
      if (previous) {
        if (previous.leaf !== leaf || previous.event !== event || previous.actor !== operation.actor || previous.historyIndex !== expectedHistoryLength ||
            historyOf(storage.releases, leaf)[previous.historyIndex]?.contents !== reviewed) {
          return { ok: false, reason: "This operation identifier already records a different release request. Nothing was changed." };
        }
        // A previous response may have been lost after rename but before directory sync.
        await syncDirectories(dirname(target));
        committed = { ok: true, event: previous, replayed: true };
        return committed;
      }
      if (historyOf(storage.releases, leaf).length !== expectedHistoryLength) {
        return { ok: false, reason: "The release history changed after this page was reviewed. Reload the current decision. Nothing was changed." };
      }
      const result = fire(storage.releases, leaf, event, operation.actor, at, reviewed);
      if (!result.ok) return result;
      // The machine allows it; the records must also be the ones the deciding person was shown.
      if (isContentsBound(event)) {
        if (reviewed === undefined) {
          return { ok: false, reason: "Reload the review to see what this decision would release. Nothing was changed." };
        }
        if (contents?.current !== reviewed) {
          return { ok: false, reason: "The records in this release changed after this page was reviewed. Reload the review to see what would be released now. Nothing was changed." };
        }
        // Publish releases what the policy owner approved, not whatever the leaf holds now.
        const approved = approvedContents(storage.releases, leaf);
        if (event === "publish" && approved !== undefined && approved !== reviewed) {
          return { ok: false, reason: `${CHANGED_SINCE_APPROVAL} Nothing was changed.` };
        }
      }
      const pending: ReleaseOutboxEvent = {
        id: randomUUID(), operationId: operation.operationId, kind: "enterprise.release.changed",
        leaf, event, actor: operation.actor, from: result.from, to: result.to, at,
        historyIndex: expectedHistoryLength, status: "pending",
      };
      await persist(target, { ...storage, releases: result.store, outbox: [...storage.outbox, pending] });
      committed = { ok: true, event: pending, replayed: false };
      return committed;
    });
  } catch (error) {
    // The shared lock helper reports cleanup failure after returning from our committed write.
    if (committed) return { ...committed, warning: errorMessage(error) };
    throw error;
  }
}
