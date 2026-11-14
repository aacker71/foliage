/**
 * A host that pipelines tool calls — sends the next before the last one answers — gets the
 * answers a host waiting for each reply would get. Driven as raw JSON-RPC over the real stdio
 * server; every message of a pipeline goes out in ONE write. The garden is a temporary Git
 * repository of self-evident fixture notes by "Fixture Person", deleted afterwards.
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const entry = fileURLToPath(new URL("../assistant-mcp.mjs", import.meta.url));
// No ambient garden, Leaf or harvest setting reaches the child processes.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("FOLIAGE_") && key !== "WONDERSEARCH_PUBLIC_API_KEY"));

type Observation = { recordId: string; revision: string; title: string; excerpt: string; observedAt: string };
type Answer = { id: number; result?: { isError?: boolean; structuredContent?: Record<string, unknown> }; error?: unknown };

async function fixtureGarden(t: { after: (fn: () => Promise<unknown>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "foliage-mcp-queue-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo"); const garden = join(dir, "garden");
  const git = (...args: string[]) => execute("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { timeout: 10_000 });
  await execute("git", ["init", "-q", "--initial-branch=main", repo]);
  await git("config", "user.name", "Fixture Person");
  await git("config", "user.email", "fixture-person@foliage.invalid");
  const notes: Observation[] = [];
  for (const name of ["first", "second"]) {
    const excerpt = `Fixture note: the ${name} observation a pipelining host submits.\n`;
    const title = `docs: add the ${name} fixture note`;
    await writeFile(join(repo, `${name}.txt`), excerpt);
    await git("add", `${name}.txt`);
    await git("commit", "-qm", title, "--no-gpg-sign");
    const sha = (await git("rev-parse", "HEAD")).stdout.trim();
    notes.push({ recordId: sha, revision: sha, title, excerpt, observedAt: new Date().toISOString() });
  }
  await execute(process.execPath, [launcher, "grow", "--repo", repo, "--subject", "Fixture Person", "--identity", "fixture-person@foliage.invalid", "--garden", garden], { timeout: 15_000, env });
  const into = join(garden, "leaf.json"); const out = join(garden, "harvest.json");
  const leaf = JSON.parse(await readFile(into, "utf8")) as { id: string; subject: string };
  const batch = (observation: Observation) => ({ format: "foliage-observations", version: 1, subject: { leafId: leaf.id, name: leaf.subject },
    source: { provider: "local-git-export", tenantId: null, accountId: "fixture-person" },
    completion: "complete", deletedRecordIds: [] as string[], observations: [observation] });
  const [first, second] = notes;
  assert.ok(first && second);
  return { into, out, first: batch(first), second: batch(second) };
}

async function serve(f: { into: string; out: string }, flags: readonly string[] = []) {
  const child = spawn(process.execPath, [entry, "--into", f.into, "--out", f.out, ...flags], { stdio: ["pipe", "pipe", "pipe"], cwd: tmpdir(), env });
  child.stderr.on("data", () => {});
  const closed = new Promise(resolve => child.once("close", resolve));
  const order: number[] = []; const answers = new Map<number, Answer>(); const waiting = new Map<number, (answer: Answer) => void>();
  createInterface({ input: child.stdout }).on("line", line => {
    const answer = JSON.parse(line) as Answer;
    order.push(answer.id); answers.set(answer.id, answer); waiting.get(answer.id)?.(answer);
  });
  const answer = (id: number) => new Promise<Answer>(resolve => {
    const known = answers.get(id);
    if (known) resolve(known); else waiting.set(id, resolve);
  });
  // The host does not wait for any reply before sending the next message.
  const pipeline = (...messages: object[]) => { child.stdin.write(messages.map(message => `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`).join("")); };
  pipeline({ id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "pipelining-host-fixture", version: "1" } } });
  await answer(0);
  pipeline({ method: "notifications/initialized" });
  return { pipeline, answer, order, close: async () => { child.stdin.end(); await closed; } };
}

const call = (id: number, name: string, args: Record<string, unknown> = {}) => ({ id, method: "tools/call", params: { name, arguments: args } });
const submit = (id: number, batch: unknown) => call(id, "foliage_submit_observations", { batch });
function ok(answer: Answer) {
  assert.equal(answer.result?.isError, undefined, JSON.stringify(answer));
  assert.ok(answer.result?.structuredContent, JSON.stringify(answer));
  return answer.result.structuredContent;
}
function refusal(answer: Answer) {
  assert.equal(answer.result?.isError, true, JSON.stringify(answer));
  return String(answer.result.structuredContent?.["error"]);
}
const excerpts = async (out: string) => (JSON.parse(await readFile(out, "utf8")) as { candidates: { evidence: { excerpt?: string }[] }[] })
  .candidates.flatMap(candidate => candidate.evidence.map(item => item.excerpt));

test("pipelined calls each get the answer a sequential host would get, in the order sent", { timeout: 30_000 }, async t => {
  const f = await fixtureGarden(t); const s = await serve(f);
  try {
    const portfolio = { title: "Fixture portfolio", source: "fixture-portfolio.md", text: f.first.observations[0]!.excerpt };
    s.pipeline(call(1, "foliage_import_portfolio", portfolio));
    const digest = ok(await s.answer(1))["digest"];
    s.pipeline(
      submit(2, f.first),
      submit(3, f.second),
      call(4, "foliage_import_portfolio", { ...portfolio, confirmDigest: digest }),
      submit(5, f.first),
      call(6, "foliage_import_context"),
    );
    const [first, second, imported, repeat, context] = await Promise.all([2, 3, 4, 5, 6].map(s.answer));
    const firstIds = ok(first!)["persisted"] as string[]; const secondIds = ok(second!)["persisted"] as string[];
    assert.equal(firstIds.length, 1);
    assert.equal(secondIds.length, 1);
    assert.notDeepEqual(firstIds, secondIds);
    assert.equal(ok(imported!)["imported"], 1, "a pipelined portfolio import is not refused as already running");
    assert.deepEqual(ok(repeat!)["unchanged"], firstIds, "the repeat sees the first write, as a sequential host would");
    assert.deepEqual(ok(context!)["subject"], f.first.subject);
    assert.deepEqual(s.order.slice(-5), [2, 3, 4, 5, 6]);
    const saved = await excerpts(f.out);
    for (const note of [f.first, f.second]) assert.equal(saved.filter(text => text === note.observations[0]!.excerpt).length, 1, "each write landed once, whole");
  } finally { await s.close(); }
});

test("a full queue refuses the extra call by name and starts nothing for it", { timeout: 30_000 }, async t => {
  const f = await fixtureGarden(t); const s = await serve(f);
  try {
    // One running call, eight waiting, then one more than the queue holds.
    const waiting = [2, 3, 4, 5, 6, 7, 8, 9];
    s.pipeline(submit(1, f.first), ...waiting.map(id => call(id, "foliage_import_context")), submit(10, f.second));
    assert.equal(refusal(await s.answer(10)), "busy · retry");
    assert.equal((ok(await s.answer(1))["persisted"] as string[]).length, 1);
    for (const id of waiting) assert.deepEqual(ok(await s.answer(id))["subject"], f.first.subject);
    assert.deepEqual(s.order.filter(id => id >= 1 && id <= 9), [1, ...waiting]);
    assert.ok(!(await excerpts(f.out)).includes(f.second.observations[0]!.excerpt), "the refused call wrote nothing");
    s.pipeline(submit(11, f.second));
    assert.equal((ok(await s.answer(11))["persisted"] as string[]).length, 1, "the same call succeeds on retry");
  } finally { await s.close(); }
});

test("a pipelined call's own refusal is reported, never pre-empted by the call ahead of it", { timeout: 30_000 }, async t => {
  const f = await fixtureGarden(t); const s = await serve(f);
  try {
    s.pipeline(
      submit(1, f.first),
      submit(2, { ...f.first, subject: { ...f.first.subject, name: "Fixture Person (different)" } }),
      submit(3, { ...f.first, completion: "partial" }),
      submit(4, { ...f.first, deletedRecordIds: [f.first.observations[0]!.recordId] }),
      submit(5, f.second),
    );
    assert.equal((ok(await s.answer(1))["persisted"] as string[]).length, 1);
    assert.equal(refusal(await s.answer(2)), "Batch subject differs from the owner-selected connection target.");
    assert.match(refusal(await s.answer(3)), /^Partial acquisition is unsupported/);
    assert.match(refusal(await s.answer(4)), /^Deletion-bearing batches are unsupported/);
    assert.equal((ok(await s.answer(5))["persisted"] as string[]).length, 1);
  } finally { await s.close(); }
});

test("a call the host cancels while it waits never starts", { timeout: 30_000 }, async t => {
  const f = await fixtureGarden(t); const s = await serve(f);
  try {
    s.pipeline(
      submit(1, f.first),
      submit(2, f.second),
      { method: "notifications/cancelled", params: { requestId: 2, reason: "fixture host stopped waiting" } },
      call(3, "foliage_import_context"),
    );
    assert.equal((ok(await s.answer(1))["persisted"] as string[]).length, 1);
    ok(await s.answer(3));
    assert.ok(!s.order.includes(2), "a cancelled request gets no reply");
    assert.ok(!(await excerpts(f.out)).includes(f.second.observations[0]!.excerpt), "the cancelled write never started");
  } finally { await s.close(); }
});

// Tools main added after the queue was cut. Each answers without Chrome, Docker or an open browser.
async function waitsBehindAWrite(t: Parameters<typeof fixtureGarden>[0], tool: string, flags: readonly string[], answers: (value: Record<string, unknown>) => void) {
  const f = await fixtureGarden(t); const s = await serve(f, flags);
  try {
    // One running write, eight of this tool waiting, then one more than the queue holds.
    const waiting = [2, 3, 4, 5, 6, 7, 8, 9];
    s.pipeline(submit(1, f.first), ...waiting.map(id => call(id, tool)), call(10, tool));
    assert.equal(refusal(await s.answer(10)), "busy · retry");
    assert.equal((ok(await s.answer(1))["persisted"] as string[]).length, 1);
    for (const id of waiting) answers(ok(await s.answer(id)));
    assert.deepEqual(s.order.filter(id => id >= 1 && id <= 9), [1, ...waiting], "answered in the order sent, after the write ahead of them");
    s.pipeline(call(11, tool));
    answers(ok(await s.answer(11)));
  } finally { await s.close(); }
}

test("foliage_brain_context waits its turn behind a write and takes a place in the queue", { timeout: 30_000 }, t =>
  waitsBehindAWrite(t, "foliage_brain_context", ["--allow-brain"], value => assert.equal(value["audience"], "private")));

test("foliage_close_demo_browser waits its turn behind a write and takes a place in the queue", { timeout: 30_000 }, t =>
  waitsBehindAWrite(t, "foliage_close_demo_browser", ["--capture-origin", "http://127.0.0.1:4210", "--allow-demo-browser"], value => assert.equal(value["closed"], true)));
