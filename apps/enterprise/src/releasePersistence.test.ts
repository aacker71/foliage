/**
 * Persistence harness only. The synthetic subjects and release operations below are test
 * inputs, never customer records, portfolio evidence, or claims about completed work.
 *
 * The process tests cross the actual file boundary:
 *   process A owns lock -> process B refuses -> A commits -> B retries from fresh state
 *   process crashes at rename -> restart reads old pair OR new state + pending event
 */
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import {
  approvedContents,
  commitRelease,
  loadStore,
  readReleaseStorage,
  saveStore,
  stateOf,
  historyOf,
  type ReleaseStore,
} from "./releaseStore.ts";

const exec = promisify(execFile);
const storageUrl = new URL("./releaseStore.ts", import.meta.url).href;
const locksUrl = new URL("../../../packages/leaf/src/localFiles.ts", import.meta.url).href;
const roots: string[] = [];
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

async function storePath(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "foliage-release-persistence-test-")));
  roots.push(root);
  return join(root, "release.json");
}

const operation = (operationId = "test-operation-1", leaf = "test-subject-a") => ({
  operationId,
  leaf,
  event: "propose" as const,
  actor: "subject" as const,
  at: "2026-09-07T00:00:00.000Z",
  expectedHistoryLength: 0,
});

const legacy: ReleaseStore = {
  "test-subject-a": {
    state: "proposed",
    history: [{
      event: "propose", actor: "subject", from: "internal", to: "proposed",
      at: "2026-09-06T12:30:00Z",
    }],
  },
};

async function rejectedWithoutChangingBytes(path: string, input: Parameters<typeof commitRelease>[1]): Promise<void> {
  const before = await readFile(path, "utf8");
  let refused = false;
  try { refused = !(await commitRelease(path, input)).ok; }
  catch { refused = true; }
  assert.ok(refused, "invalid operation must be refused");
  assert.equal(await readFile(path, "utf8"), before, "refusal must preserve exact prior bytes");
}

const childCommit = `
  const {commitRelease} = await import(${JSON.stringify(storageUrl)});
  const result = await commitRelease(process.argv[1], JSON.parse(process.argv[2]));
  process.stdout.write(JSON.stringify(result));
`;

async function commitInAnotherProcess(path: string, input: Parameters<typeof commitRelease>[1]) {
  const result = await exec(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", childCommit, path, JSON.stringify(input)],
    { timeout: 10_000, maxBuffer: 256 * 1024 });
  return JSON.parse(result.stdout) as Awaited<ReturnType<typeof commitRelease>>;
}

function startChild(script: string, args: string[]) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script, ...args],
    { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const closed = new Promise<number | null>((resolve) => {
    child.once("error", (error) => { stderr += error.message; resolve(-1); });
    child.once("close", (code) => resolve(code));
  });
  return { child, closed, stdout: () => stdout, stderr: () => stderr };
}

async function waitForMarker(run: ReturnType<typeof startChild>, marker: string): Promise<void> {
  if (run.stdout().includes(marker)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      run.child.stdout.off("data", onData);
      run.child.off("close", onClose);
    };
    const onData = () => { if (run.stdout().includes(marker)) { cleanup(); resolve(); } };
    const onClose = () => { cleanup(); reject(new Error(`child closed before ${marker}: ${run.stderr()}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`child never reported ${marker}: ${run.stderr()}`)); }, 8_000);
    run.child.stdout.on("data", onData);
    run.child.once("close", onClose);
    if (run.child.exitCode !== null || run.child.signalCode !== null) onClose();
  });
}

test("missing storage is an empty envelope without creating a file; initialization cannot overwrite", async () => {
  const path = await storePath();
  const empty = await readReleaseStorage(path);
  assert.equal(empty.format, "foliage-release-store");
  assert.equal(empty.version, 1);
  assert.deepEqual(empty.releases, {});
  assert.deepEqual(empty.outbox, []);
  assert.equal(existsSync(path), false);

  await saveStore(path, legacy);
  assert.deepEqual(await loadStore(path), legacy);
  const before = await readFile(path, "utf8");
  await assert.rejects(saveStore(path, {}));
  assert.equal(await readFile(path, "utf8"), before);
});

test("legacy read and refused mutation preserve bytes; successful migration adds only the new event", async () => {
  const path = await storePath();
  const bytes = JSON.stringify(legacy, null, 4) + "\n\n";
  await writeFile(path, bytes);
  const loaded = await readReleaseStorage(path);
  assert.deepEqual(loaded.releases, legacy);
  assert.deepEqual(loaded.outbox, [], "migration cannot backfill historical notifications");
  assert.equal(await readFile(path, "utf8"), bytes);
  await assert.rejects(saveStore(path, {}));
  await rejectedWithoutChangingBytes(path, { ...operation(), event: "approve", actor: "subject", expectedHistoryLength: 1 });

  const result = await commitRelease(path, {
    ...operation("test-open-review"), event: "open_review", actor: "policy_owner", expectedHistoryLength: 1,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.replayed, false);
  const migrated = await readReleaseStorage(path);
  assert.equal(migrated.releases["test-subject-a"]?.state, "in_review");
  assert.deepEqual(migrated.releases["test-subject-a"]?.history[0], legacy["test-subject-a"]?.history[0]);
  assert.equal(migrated.outbox.length, 1);
  assert.deepEqual(migrated.outbox[0], result.event);
  assert.equal(result.event.kind, "enterprise.release.changed");
  assert.equal(result.event.historyIndex, 1);
  assert.equal(result.event.status, "pending");
});

test("corrupt documents, unsupported versions and invalid history never become an empty store", async () => {
  const path = await storePath();
  const corrupt = [
    "{broken JSON", "null", "[]", '"not a document"',
    JSON.stringify({ format: "foliage-release-store", version: 2, releases: {}, outbox: [] }),
    JSON.stringify({ format: "foliage-release-store", version: 1, releases: {} }),
    JSON.stringify({ ...legacy, extra: "not a release record" }),
    JSON.stringify({ "test-subject-a": { state: "live", history: [] } }),
    JSON.stringify({ "test-subject-a": { ...legacy["test-subject-a"], state: "in_review" } }),
    JSON.stringify({ "test-subject-a": { state: "proposed", history: "not an array" } }),
    JSON.stringify({ "test-subject-a": { state: "proposed", history: [{ ...legacy["test-subject-a"]?.history[0], at: "yesterday" }] } }),
    JSON.stringify({ "test-subject-a": { state: "proposed", history: [{ ...legacy["test-subject-a"]?.history[0], actor: "system" }] } }),
  ];
  for (const bytes of corrupt) {
    await writeFile(path, bytes);
    await assert.rejects(readReleaseStorage(path), `bad storage was accepted: ${bytes}`);
    await assert.rejects(loadStore(path));
    await assert.rejects(commitRelease(path, operation()));
    assert.equal(await readFile(path, "utf8"), bytes);
  }
});

test("unknown structural fields are refused at every stored object boundary", async () => {
  const path = await storePath();
  const empty = { format: "foliage-release-store", version: 1, releases: {}, outbox: [] };
  const record = legacy["test-subject-a"];
  assert.ok(record);
  const invalid = [
    { ...empty, unexpected: true },
    { ...empty, releases: { "test-subject-a": { ...record, unexpected: true } } },
    { ...empty, releases: { "test-subject-a": { ...record, history: [{ ...record.history[0], unexpected: true }] } } },
    { ...empty, ["__proto__"]: record },
    { ...empty, releases: { "test-subject-a": { ...record, ["constructor"]: true } } },
  ];
  for (const value of invalid) {
    const bytes = JSON.stringify(value);
    await writeFile(path, bytes);
    await assert.rejects(readReleaseStorage(path));
    await assert.rejects(commitRelease(path, operation()));
    assert.equal(await readFile(path, "utf8"), bytes);
  }
});

test("explicit prototype-shaped and envelope-shaped leaf IDs remain usable without inherited records", async () => {
  const path = await storePath();
  const ids = ["__proto__", "constructor", "prototype", "format", "version", "releases", "outbox"];
  for (const id of ids) {
    assert.equal(stateOf({}, id), "internal");
    assert.deepEqual(historyOf({}, id), []);
  }
  const explicit = Object.fromEntries(ids.map((id) => [id, legacy["test-subject-a"]]));
  await writeFile(path, JSON.stringify(explicit));
  assert.deepEqual(await loadStore(path), explicit);
  for (const [index, id] of ids.entries()) {
    const changed = await commitRelease(path, {
      ...operation(`test-explicit-id-${index}`, id), event: "open_review", actor: "policy_owner", expectedHistoryLength: 1,
    });
    assert.equal(changed.ok, true);
  }
  const saved = await loadStore(path);
  for (const id of ids) {
    assert.equal(Object.hasOwn(saved, id), true);
    assert.equal(stateOf(saved, id), "in_review");
    assert.equal(historyOf(saved, id).length, 2);
  }
  assert.equal(Object.getPrototypeOf(saved), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, "state"), false);
  assert.equal(Object.hasOwn(Object.prototype, "history"), false);
});

test("storage I/O failure is distinguished from absence and preserves its cause", async () => {
  const path = await storePath();
  await mkdir(path);
  await assert.rejects(readReleaseStorage(path), /EISDIR|directory|read/i);
  await assert.rejects(commitRelease(path, operation()), /EISDIR|directory|read/i);
  assert.deepEqual(await readdir(path), []);
});

test("one operation is durable and replayable after later changes; different logical input conflicts first", async () => {
  const path = await storePath();
  const request = operation();
  const first = await commitRelease(path, request);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.replayed, false);
  const second = await commitRelease(path, {
    ...operation("test-operation-2"), event: "open_review", actor: "system", expectedHistoryLength: 1,
  });
  assert.equal(second.ok, true);
  const before = await readFile(path, "utf8");
  const replay = await commitRelease(path, { ...request, at: "2026-09-07T12:00:00.000Z" });
  assert.equal(replay.ok, true);
  if (replay.ok) {
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.event, first.event, "server retry time must not rewrite the committed event");
  }
  assert.equal(await readFile(path, "utf8"), before);

  for (const change of [
    { leaf: "test-subject-b" }, { event: "approve" as const },
    { actor: "system" as const }, { expectedHistoryLength: 99 },
  ]) {
    const conflict = await commitRelease(path, { ...request, ...change });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.match(conflict.reason, /operation|conflict|different|reuse/i);
    assert.equal(await readFile(path, "utf8"), before);
  }
  const current = await readReleaseStorage(path);
  assert.equal(current.releases[request.leaf]?.history.length, 2);
  assert.equal(current.outbox.length, 2);
});

test("stale review and invalid operation fields leave both state and outbox untouched", async () => {
  const path = await storePath();
  assert.equal((await commitRelease(path, operation())).ok, true);
  await rejectedWithoutChangingBytes(path, {
    ...operation("test-stale"), event: "open_review", actor: "policy_owner", expectedHistoryLength: 0,
  });
  for (const leaf of ["", "   "]) {
    await rejectedWithoutChangingBytes(path, { ...operation("test-invalid-leaf", leaf) });
  }
  for (const change of [
    { operationId: "" }, { at: "not a timestamp" }, { expectedHistoryLength: -1 },
    { expectedHistoryLength: 0.5 }, { expectedHistoryLength: Number.MAX_SAFE_INTEGER + 1 },
  ]) await rejectedWithoutChangingBytes(path, { ...operation("test-invalid"), ...change });
});

test("approve and publish commit only when the contents the review showed are still current, and record them", async () => {
  const path = await storePath();
  const shown = `sha256:${"a".repeat(64)}`;
  const changed = `sha256:${"b".repeat(64)}`;
  // A propose that is handed a digest still records none: only approve and publish are about contents.
  assert.equal((await commitRelease(path, { ...operation(), contents: { reviewed: shown, current: shown } })).ok, true);
  assert.equal((await commitRelease(path, {
    ...operation("test-open"), event: "open_review", actor: "policy_owner", expectedHistoryLength: 1,
  })).ok, true);
  assert.equal(Object.hasOwn(historyOf(await loadStore(path), "test-subject-a")[0]!, "contents"), false);

  const approve = { ...operation("test-approve"), event: "approve" as const, actor: "policy_owner" as const, expectedHistoryLength: 2 };
  await rejectedWithoutChangingBytes(path, approve);
  for (const contents of [
    { reviewed: shown, current: changed },
    { reviewed: shown, current: null },
    { reviewed: "sha256:not-a-digest", current: "sha256:not-a-digest" },
  ]) await rejectedWithoutChangingBytes(path, { ...approve, contents });
  const stale = await commitRelease(path, { ...approve, contents: { reviewed: shown, current: changed } });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.reason, /changed after this page was reviewed.*Reload the review/);

  const approved = await commitRelease(path, { ...approve, contents: { reviewed: shown, current: shown } });
  assert.equal(approved.ok, true);
  assert.equal(historyOf(await loadStore(path), "test-subject-a")[2]?.contents, shown);
  if (approved.ok) assert.equal(Object.hasOwn(approved.event, "contents"), false, "the pending event carries no contents");

  // A retry of the same operation replays; the same operation about other contents conflicts.
  const before = await readFile(path, "utf8");
  const replay = await commitRelease(path, { ...approve, contents: { reviewed: shown, current: changed } });
  assert.equal(replay.ok && replay.replayed, true);
  const reused = await commitRelease(path, { ...approve, contents: { reviewed: changed, current: changed } });
  assert.equal(reused.ok, false);
  assert.equal(await readFile(path, "utf8"), before);

  const publish = { ...operation("test-publish"), event: "publish" as const, actor: "policy_owner" as const, expectedHistoryLength: 3 };
  await rejectedWithoutChangingBytes(path, { ...publish, contents: { reviewed: shown, current: changed } });
  assert.equal(stateOf(await loadStore(path), "test-subject-a"), "approved");
  assert.equal(approvedContents(await loadStore(path), "test-subject-a"), shown);
  assert.equal((await commitRelease(path, { ...publish, contents: { reviewed: shown, current: shown } })).ok, true);
  const history = historyOf(await loadStore(path), "test-subject-a");
  assert.deepEqual(history.map((h) => h.contents), [undefined, undefined, shown, shown]);
  assert.equal(stateOf(await loadStore(path), "test-subject-a"), "live");
  assert.equal(approvedContents(await loadStore(path), "test-subject-a"), undefined);
});

test("publish releases only the records the policy owner approved, whoever publishes", async () => {
  const path = await storePath();
  const approvedDigest = `sha256:${"a".repeat(64)}`;
  const changed = `sha256:${"b".repeat(64)}`;
  assert.equal((await commitRelease(path, operation())).ok, true);
  assert.equal((await commitRelease(path, {
    ...operation("test-open"), event: "open_review", actor: "policy_owner", expectedHistoryLength: 1,
  })).ok, true);
  assert.equal((await commitRelease(path, {
    ...operation("test-approve"), event: "approve", actor: "policy_owner", expectedHistoryLength: 2,
    contents: { reviewed: approvedDigest, current: approvedDigest },
  })).ok, true);

  // The leaf changed after approval and the publisher reloaded: their page and the leaf agree,
  // but neither is what was approved.
  for (const actor of ["subject", "policy_owner"] as const) {
    const publish = {
      ...operation(`test-publish-${actor}`), event: "publish" as const, actor, expectedHistoryLength: 3,
      contents: { reviewed: changed, current: changed },
    };
    await rejectedWithoutChangingBytes(path, publish);
    const refused = await commitRelease(path, publish);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.reason, "The records changed after approval. Retract and review again. Nothing was changed.");
  }
  const storage = await readReleaseStorage(path);
  assert.equal(stateOf(storage.releases, "test-subject-a"), "approved");
  assert.equal(storage.outbox.length, 3);

  // Retract still works, so the records can be reviewed again.
  assert.equal((await commitRelease(path, {
    ...operation("test-retract"), event: "retract", actor: "subject", expectedHistoryLength: 3,
  })).ok, true);
  assert.equal(stateOf(await loadStore(path), "test-subject-a"), "internal");
});

test("a recorded contents digest must be well formed and belong to approve or publish", async () => {
  const path = await storePath();
  const digest = `sha256:${"c".repeat(64)}`;
  const propose = { event: "propose", actor: "subject", from: "internal", to: "proposed", at: "2026-09-06T12:30:00Z" };
  const review = { event: "open_review", actor: "policy_owner", from: "proposed", to: "in_review", at: "2026-09-06T12:31:00Z" };
  const approve = { event: "approve", actor: "policy_owner", from: "in_review", to: "approved", at: "2026-09-06T12:32:00Z" };
  const store = (history: readonly object[]) => JSON.stringify({ "test-subject-a": { state: "approved", history } });
  await writeFile(path, store([propose, review, { ...approve, contents: digest }]));
  assert.equal(historyOf(await loadStore(path), "test-subject-a")[2]?.contents, digest);
  for (const bytes of [
    store([{ ...propose, contents: digest }, review, approve]),
    store([propose, review, { ...approve, contents: "sha256:ABC" }]),
    store([propose, review, { ...approve, contents: null }]),
  ]) {
    await writeFile(path, bytes);
    await assert.rejects(readReleaseStorage(path), /contents digest/);
    assert.equal(await readFile(path, "utf8"), bytes);
  }

  // An approval recorded before decisions were bound has no digest to hold Publish to.
  await writeFile(path, store([propose, review, approve]));
  assert.equal(approvedContents(await loadStore(path), "test-subject-a"), undefined);
  assert.equal((await commitRelease(path, {
    ...operation("test-legacy-publish"), event: "publish", actor: "subject", expectedHistoryLength: 3,
    contents: { reviewed: digest, current: digest },
  })).ok, true);
});

test("outbox events must have unique identities and describe a real matching history entry", async () => {
  const path = await storePath();
  assert.equal((await commitRelease(path, operation())).ok, true);
  const validBytes = await readFile(path, "utf8");
  type MutableEnvelope = { outbox: Array<Record<string, unknown>> };
  const corruptions: Array<(value: MutableEnvelope) => void> = [
    (value) => { value.outbox.push({ ...value.outbox[0] }); },
    (value) => { value.outbox.push({ ...value.outbox[0], id: "test-duplicate-operation" }); },
    (value) => { value.outbox[0]!["leaf"] = "test-absent-subject"; },
    (value) => { value.outbox[0]!["historyIndex"] = 8; },
    (value) => { value.outbox[0]!["historyIndex"] = -1; },
    (value) => { value.outbox[0]!["from"] = "approved"; },
    (value) => { value.outbox[0]!["at"] = "2026-09-07T01:00:00.000Z"; },
    (value) => { value.outbox[0]!["status"] = "delivered"; },
    (value) => { value.outbox[0]!["unexpected"] = "private payload"; },
  ];
  for (const corrupt of corruptions) {
    const value = JSON.parse(validBytes) as MutableEnvelope;
    corrupt(value);
    const bytes = JSON.stringify(value);
    await writeFile(path, bytes);
    await assert.rejects(readReleaseStorage(path));
    await assert.rejects(commitRelease(path, operation("test-next", "test-subject-b")));
    assert.equal(await readFile(path, "utf8"), bytes);
  }
});

test("two actual processes serialize release changes and retry against the committed state", { timeout: 20_000 }, async () => {
  const path = await storePath();
  await saveStore(path, {});
  const first = operation("test-process-a", "test-subject-a");
  const second = operation("test-process-b", "test-subject-b");
  const holder = startChild(`
    const {withDocumentLocks} = await import(${JSON.stringify(locksUrl)});
    await withDocumentLocks([process.argv[1]], async () => {
      process.stdout.write('LOCKED\\n');
      await new Promise((resolve) => process.stdin.once('data', resolve));
    });
    ${childCommit}
  `, [path, JSON.stringify(first)]);
  try {
    await waitForMarker(holder, "LOCKED");
    const before = await readFile(path, "utf8");
    await assert.rejects(commitInAnotherProcess(path, second), /busy|ELOCALBUSY/);
    assert.equal(await readFile(path, "utf8"), before);
    holder.child.stdin.end("continue\n");
    assert.equal(await holder.closed, 0, holder.stderr());
    const firstResult = JSON.parse(holder.stdout().slice(holder.stdout().indexOf("\n") + 1)) as { ok: boolean };
    assert.equal(firstResult.ok, true);
    assert.equal((await commitInAnotherProcess(path, second)).ok, true);
    const combined = await readReleaseStorage(path);
    assert.equal(combined.releases[first.leaf]?.state, "proposed");
    assert.equal(combined.releases[second.leaf]?.state, "proposed");
    assert.deepEqual(combined.outbox.map((event) => event.operationId).sort(), [first.operationId, second.operationId]);
  } finally {
    if (holder.child.exitCode === null && holder.child.signalCode === null) holder.child.kill("SIGKILL");
    await holder.closed;
  }
});

test("failed atomic replacement preserves both prior state and prior outbox", { timeout: 15_000 }, async () => {
  const path = await storePath();
  await saveStore(path, {});
  const before = await readFile(path, "utf8");
  const script = `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    fs.promises.rename = async () => { throw new Error('test-only atomic replacement failure'); };
    syncBuiltinESMExports();
    ${childCommit}
  `;
  await assert.rejects(exec(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script, path, JSON.stringify(operation())],
    { timeout: 10_000 }), /test-only atomic replacement failure/);
  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual((await readReleaseStorage(path)).outbox, []);
  assert.deepEqual(await readdir(join(path, "..")), ["release.json"]);
});

test("process death before or after rename leaves one complete state/event pair; restart never steals its lock", { timeout: 25_000 }, async () => {
  for (const crashAfterRename of [false, true]) {
    const path = await storePath();
    await saveStore(path, {});
    const before = await readFile(path, "utf8");
    const request = operation(crashAfterRename ? "test-crash-after" : "test-crash-before");
    const script = `
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      const rename = fs.promises.rename;
      fs.promises.rename = async (...args) => {
        if (${JSON.stringify(crashAfterRename)}) await rename(...args);
        process.kill(process.pid, 'SIGKILL');
        await new Promise(() => {});
      };
      syncBuiltinESMExports();
      ${childCommit}
    `;
    await assert.rejects(exec(process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script, path, JSON.stringify(request)],
      { timeout: 10_000 }), (error: unknown) =>
      typeof error === "object" && error !== null && "signal" in error && error.signal === "SIGKILL");
    const recovered = await readReleaseStorage(path);
    assert.equal(recovered.outbox.length, crashAfterRename ? 1 : 0);
    assert.equal(recovered.releases[request.leaf]?.history.length ?? 0, crashAfterRename ? 1 : 0);
    if (!crashAfterRename) assert.equal(await readFile(path, "utf8"), before);
    assert.equal(existsSync(`${path}.local-lock`), true);
    await assert.rejects(commitInAnotherProcess(path, request), /busy|inspect.*lock/i);

    // Explicit operator recovery of this test's dead owner, never automatic lock stealing.
    await unlink(`${path}.local-lock`);
    const retry = await commitInAnotherProcess(path, { ...request, at: "2026-09-07T02:00:00.000Z" });
    assert.equal(retry.ok, true);
    if (retry.ok) assert.equal(retry.replayed, crashAfterRename);
    const final = await readReleaseStorage(path);
    assert.equal(final.outbox.length, 1);
    assert.equal(final.releases[request.leaf]?.history.length, 1);
  }
});

test("directory sync failure after replacement reports uncertainty; restart replays the committed event", { timeout: 15_000 }, async () => {
  const path = await storePath();
  await saveStore(path, {});
  const request = operation("test-directory-sync-failure");
  const script = `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    const open = fs.promises.open;
    const rename = fs.promises.rename;
    let renamed = false;
    fs.promises.rename = async (...args) => { await rename(...args); renamed = true; };
    fs.promises.open = async (...args) => {
      const handle = await open(...args);
      if ((await handle.stat()).isDirectory()) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (renamed) throw new Error('test-only directory sync failure');
          await sync();
        };
      }
      return handle;
    };
    syncBuiltinESMExports();
    ${childCommit}
  `;
  await assert.rejects(exec(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script, path, JSON.stringify(request)],
    { timeout: 10_000 }), /replaced.*uncertain.*test-only directory sync failure/s);
  const afterFailure = await readReleaseStorage(path);
  assert.equal(afterFailure.releases[request.leaf]?.state, "proposed");
  assert.equal(afterFailure.releases[request.leaf]?.history.length, 1);
  assert.equal(afterFailure.outbox.length, 1);
  const beforeRetry = await readFile(path, "utf8");
  const replay = await commitInAnotherProcess(path, { ...request, at: "2026-09-07T05:00:00.000Z" });
  assert.equal(replay.ok, true);
  if (replay.ok) {
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.event, afterFailure.outbox[0]);
  }
  assert.equal(await readFile(path, "utf8"), beforeRetry);
});

test("an unreadable ancestor refuses storage before creating directories or changing an existing store", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root bypasses the directory permissions this case needs to exercise");
    return;
  }
  const root = dirname(await storePath());
  const ancestor = join(root, "traverse-only");
  const writable = join(ancestor, "writable");
  await mkdir(writable, { recursive: true, mode: 0o700 });
  const existing = join(writable, "release.json");
  const bytes = JSON.stringify(legacy) + "\n";
  await writeFile(existing, bytes);
  await chmod(ancestor, 0o300);
  try {
    // Traversal works, but the new explicit storage contract also requires ancestor sync.
    await assert.rejects(open(ancestor, "r"), /EACCES|EPERM/);
    const request = operation("test-traversable-ancestor");
    await assert.rejects(commitRelease(existing, {
      ...request, event: "open_review", actor: "policy_owner", expectedHistoryLength: 1,
    }), /EACCES|EPERM|directory|ancestor/i);
    assert.equal(await readFile(existing, "utf8"), bytes);
    assert.equal(existsSync(`${existing}.local-lock`), false);

    const missing = join(writable, "new", "nested", "release.json");
    await assert.rejects(commitRelease(missing, request), /EACCES|EPERM|directory|ancestor/i);
    assert.equal(existsSync(join(writable, "new")), false);
    assert.deepEqual(await readdir(writable), ["release.json"]);
  } finally {
    await chmod(ancestor, 0o700);
  }
});

test("ancestor sync failure after creation and rename is retried before replay acknowledges durability", { timeout: 20_000 }, async () => {
  const root = dirname(await storePath());
  const ancestor = join(root, "created");
  const containing = join(ancestor, "nested");
  const path = join(containing, "release.json");
  const request = operation("test-created-ancestor-replay");
  const script = `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    const open = fs.promises.open;
    const rename = fs.promises.rename;
    let renamed = false;
    const synced = [];
    fs.promises.rename = async (...args) => { await rename(...args); renamed = true; };
    fs.promises.open = async (...args) => {
      const handle = await open(...args);
      if ((await handle.stat()).isDirectory()) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (renamed && String(args[0]) === process.argv[3]) {
            throw new Error('test-only created ancestor sync failure');
          }
          await sync();
          synced.push(String(args[0]));
        };
      }
      return handle;
    };
    syncBuiltinESMExports();
    const {commitRelease} = await import(${JSON.stringify(storageUrl)});
    try {
      const result = await commitRelease(process.argv[1], JSON.parse(process.argv[2]));
      process.stdout.write(JSON.stringify({result, synced}));
    } catch (error) {
      process.stdout.write(JSON.stringify({error: error.message, synced}));
    }
  `;
  const first = await exec(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script, path, JSON.stringify(request), ancestor],
    { timeout: 10_000 });
  const failed = JSON.parse(first.stdout) as { error?: string; synced: string[] };
  assert.match(failed.error ?? "", /replaced.*uncertain.*test-only created ancestor sync failure/s);
  const beforeReplay = await readFile(path, "utf8");
  assert.equal((await readReleaseStorage(path)).outbox.length, 1);

  const second = await exec(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script, path, JSON.stringify(request), ""],
    { timeout: 10_000 });
  const replayed = JSON.parse(second.stdout) as { result?: Awaited<ReturnType<typeof commitRelease>>; error?: string; synced: string[] };
  assert.equal(replayed.result?.ok, true, replayed.error);
  if (replayed.result?.ok) assert.equal(replayed.result.replayed, true);
  for (const required of [containing, ancestor, root]) {
    assert.ok(replayed.synced.includes(required), `replay acknowledged without syncing directory ${required}`);
  }
  assert.equal(await readFile(path, "utf8"), beforeReplay);
  assert.equal((await readReleaseStorage(path)).outbox.length, 1);
});

test("a crash before rename leaves directories without an envelope; retry syncs their ancestry", { timeout: 20_000 }, async () => {
  const root = dirname(await storePath());
  const ancestor = join(root, "created");
  const containing = join(ancestor, "nested");
  const path = join(containing, "release.json");
  const request = operation("test-created-ancestor-before-rename");
  const crash = `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    fs.promises.rename = async () => {
      process.kill(process.pid, 'SIGKILL');
      await new Promise(() => {});
    };
    syncBuiltinESMExports();
    ${childCommit}
  `;
  await assert.rejects(exec(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", crash, path, JSON.stringify(request)],
    { timeout: 10_000 }), (error: unknown) =>
    typeof error === "object" && error !== null && "signal" in error && error.signal === "SIGKILL");
  assert.equal(existsSync(containing), true);
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(`${path}.local-lock`), true);
  await assert.rejects(commitInAnotherProcess(path, request), /busy|inspect.*lock/i);
  await unlink(`${path}.local-lock`); // The harness explicitly clears only its dead process's lock.
  const retry = `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    const open = fs.promises.open;
    const synced = [];
    fs.promises.open = async (...args) => {
      const handle = await open(...args);
      if ((await handle.stat()).isDirectory()) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => { await sync(); synced.push(String(args[0])); };
      }
      return handle;
    };
    syncBuiltinESMExports();
    const {commitRelease} = await import(${JSON.stringify(storageUrl)});
    const result = await commitRelease(process.argv[1], JSON.parse(process.argv[2]));
    process.stdout.write(JSON.stringify({result, synced}));
  `;
  const recovered = await exec(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", retry, path, JSON.stringify(request)],
    { timeout: 10_000 });
  const parsed = JSON.parse(recovered.stdout) as { result: Awaited<ReturnType<typeof commitRelease>>; synced: string[] };
  assert.equal(parsed.result.ok, true);
  if (parsed.result.ok) assert.equal(parsed.result.replayed, false);
  for (const required of [containing, ancestor, root]) {
    assert.ok(parsed.synced.includes(required), `retry acknowledged without syncing directory ${required}`);
  }
  const storage = await readReleaseStorage(path);
  assert.equal(storage.outbox.length, 1);
  assert.equal(storage.releases[request.leaf]?.history.length, 1);
});

test("a temporary file write or sync failure followed by close failure preserves both causes and old bytes", { timeout: 20_000 }, async () => {
  for (const stage of ["write", "sync"] as const) {
    const path = await storePath();
    await saveStore(path, legacy);
    const before = await readFile(path, "utf8");
    const request = { ...operation(`test-${stage}-and-close`), event: "open_review" as const, actor: "policy_owner" as const, expectedHistoryLength: 1 };
    const script = `
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      const open = fs.promises.open;
      fs.promises.open = async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx' && String(args[0]).includes('.write-')) {
          handle[${JSON.stringify(stage === "write" ? "writeFile" : "sync")}] = async () => {
            throw new Error(${JSON.stringify(`test-only primary ${stage} failure`)});
          };
          const close = handle.close.bind(handle);
          handle.close = async () => {
            await close();
            throw new Error('test-only secondary close failure');
          };
        }
        return handle;
      };
      syncBuiltinESMExports();
      ${childCommit}
    `;
    await assert.rejects(exec(process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script, path, JSON.stringify(request)],
      { timeout: 10_000 }), new RegExp(`not replaced.*test-only primary ${stage} failure.*test-only secondary close failure`, "s"));
    assert.equal(await readFile(path, "utf8"), before);
    assert.deepEqual(await loadStore(path), legacy);
    assert.deepEqual((await readReleaseStorage(path)).outbox, []);
    assert.deepEqual(await readdir(dirname(path)), ["release.json"]);
  }
});
