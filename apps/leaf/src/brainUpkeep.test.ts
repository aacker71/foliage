/**
 * The triggers that keep a garden's brain current (unit 38, build order item 5), without a staged
 * gbrain: every refresh here is a stand-in function, and nothing starts gbrain or bun. That each
 * real action leaves the real brain matching its record, offline, is item 5 of the brain offline
 * gate (`scripts/check-brain-offline.mjs`, `tools/brain/offline-proofs.mjs`), which `pnpm check` runs.
 * Every record below is SYNTHETIC.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { McpServer } from "@modelcontextprotocol/server";
import { brainBehind, brainGardenOf, brainUpkeep, refreshAfterWrites, refreshWanted, startBrainRefresh, STOPPED_RETRY_MS } from "./brainUpkeep.ts";
import { LocalBrainError, type BrainDrift } from "./localBrain.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const temp = async (t: { after: (fn: () => Promise<unknown>) => void }) => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-brain-upkeep-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

test("a brain is kept only for a garden whose leaf.json and harvest.json sit side by side", () => {
  assert.equal(brainGardenOf("/gardens/a/leaf.json", "/gardens/a/harvest.json"), "/gardens/a");
  assert.equal(brainGardenOf("/gardens/a/leaf.json", "/gardens/b/harvest.json"), null);
  assert.equal(brainGardenOf("/gardens/a/portfolio.json", "/gardens/a/harvest.json"), null);
  assert.equal(brainGardenOf("/gardens/a/leaf.json", "/gardens/a/drafts.json"), null);
});

test("behind means a brain Foliage made whose manifest is not the record's bytes as they are now; anything else is left alone", async t => {
  const garden = await temp(t);
  const leaf = '{"id":"synthetic"}\n', harvest = '{"candidates":[]}\n';
  const brain = join(garden, "brain");
  assert.equal(await brainBehind(garden), false, "no record, no brain");
  await writeFile(join(garden, "leaf.json"), leaf);
  assert.equal(await brainBehind(garden), false, "no brain: nothing to keep current");
  await writeFile(brain, "a file, not a brain\n");
  assert.equal(await brainBehind(garden), false);
  await rm(brain);
  await mkdir(brain);
  assert.equal(await brainBehind(garden), false, "an empty brain/ is no brain yet: foliage brain build makes one");
  await mkdir(join(brain, "home"));
  assert.equal(await brainBehind(garden), true, "Foliage's own brain without a manifest (a rebuild stopped at its swap) is for a refresh to judge");
  await writeFile(join(brain, "manifest.json"), JSON.stringify({ leafSha256: sha(leaf), harvestSha256: null }));
  assert.equal(await brainBehind(garden), false);
  await writeFile(join(garden, "harvest.json"), harvest);
  assert.equal(await brainBehind(garden), true, "a new harvest");
  await writeFile(join(brain, "manifest.json"), JSON.stringify({ leafSha256: sha(leaf), harvestSha256: sha(harvest) }));
  assert.equal(await brainBehind(garden), false);
  await writeFile(join(garden, "leaf.json"), leaf.replace("synthetic", "synthetic-edited"));
  assert.equal(await brainBehind(garden), true, "an edited leaf");
  await writeFile(join(brain, "manifest.json"), "not json");
  assert.equal(await brainBehind(garden), true, "an unreadable manifest is for a refresh to judge");
  // A brain an earlier check refused waits for the owner's rebuild; a brain/ holding anything
  // Foliage did not make may be the owner's own folder. Neither is touched by a trigger.
  await writeFile(join(brain, "refused.json"), '{"cause":"synthetic"}\n');
  assert.equal(await brainBehind(garden), false, "refused: left for foliage brain rebuild");
  await rm(join(brain, "refused.json"));
  await writeFile(join(brain, "notes.md"), "Synthetic note the owner keeps here.\n");
  assert.equal(await brainBehind(garden), false, "a name Foliage did not make");
  await rm(join(brain, "notes.md"));
  await writeFile(join(brain, ".DS_Store"), "synthetic Finder metadata\n");
  assert.equal(await brainBehind(garden), true, "Finder's .DS_Store is nobody's work");
  await rm(join(garden, "leaf.json"));
  assert.equal(await brainBehind(garden), false, "no leaf.json: nothing a refresh could build from");
});

test("a trigger starts a refresh for a brain that is behind, except on bytes whose last refresh failed for the brain's own reasons, until the backoff passes", () => {
  const at = 1_000_000;
  assert.equal(refreshWanted({ behind: false }, at), false);
  assert.equal(refreshWanted({ behind: true }, at), true, "behind, and nothing has failed on these bytes (a busy lock never counts)");
  assert.equal(refreshWanted({ behind: true, stoppedAt: at }, at + STOPPED_RETRY_MS - 1), false);
  assert.equal(refreshWanted({ behind: true, stoppedAt: at }, at + STOPPED_RETRY_MS), true);
});

test("a command's background refresh starts only for a brain that is behind, and never fails the command", async t => {
  const garden = await temp(t);
  await writeFile(join(garden, "leaf.json"), '{"id":"synthetic"}\n');
  // No brain, a brain built from these bytes, and a brain whose refresh just failed on these bytes:
  // nothing starts. (A brain behind its record would start `foliage brain refresh --background`;
  // that runs gbrain, so the offline focus test proves it.)
  assert.equal(await startBrainRefresh(garden), false);
  await mkdir(join(garden, "brain", "home"), { recursive: true });
  await writeFile(join(garden, "brain", "manifest.json"), JSON.stringify({ leafSha256: sha('{"id":"synthetic"}\n'), harvestSha256: null }));
  assert.equal(await startBrainRefresh(garden), false);
  await writeFile(join(garden, "brain", "manifest.json"), JSON.stringify({ leafSha256: "0".repeat(64), harvestSha256: null }));
  await writeFile(join(garden, "brain", "refresh-failure.json"), JSON.stringify({ state: "broken", cause: "gbrain import exited 1",
    leafSha256: sha('{"id":"synthetic"}\n'), harvestSha256: null, at: new Date().toISOString() }));
  assert.equal(await startBrainRefresh(garden), false, "these bytes' refresh just failed for the brain's own reason");
  assert.equal(await startBrainRefresh(join(garden, "missing")), false);
  assert.deepEqual((await readdir(join(garden, "brain"))).sort(), ["home", "manifest.json", "refresh-failure.json"]);
});

/** A refresh stand-in that waits until released, and counts. */
function standIn() {
  let runs = 0, release: (() => void) | null = null;
  return {
    get runs() { return runs; },
    refresh: async () => { runs += 1; await new Promise<void>(resolve => { release = resolve; }); },
    release() { const done = release; release = null; done?.(); },
  };
}

const behind = async (): Promise<BrainDrift> => ({ behind: true });

test("one refresh at a time: requests while one runs are served by exactly one more run, after the answer that asked", async t => {
  const garden = await temp(t);
  const refresher = standIn();
  const upkeep = brainUpkeep(garden, { drift: behind, refresh: refresher.refresh });
  upkeep.request();
  assert.equal(refresher.runs, 0, "a request never runs in the turn that asked; the answer goes first");
  await sleep(10);
  assert.equal(refresher.runs, 1);
  for (let i = 0; i < 5; i += 1) upkeep.request();
  await sleep(10);
  assert.equal(refresher.runs, 1, "never two at once");
  refresher.release();
  await sleep(10);
  assert.equal(refresher.runs, 2, "the requests during the first run are served by one more");
  refresher.release();
  await upkeep.idle();
  assert.equal(refresher.runs, 2);
  // A request after it is all done starts a fresh run.
  upkeep.request();
  await sleep(10);
  assert.equal(refresher.runs, 3);
  refresher.release();
  await upkeep.idle();
});

test("a brain already current starts nothing, and a refresh that fails is logged by its line and never thrown", async t => {
  const garden = await temp(t);
  let refreshed = 0;
  const lines: string[] = [];
  const quiet = brainUpkeep(garden, { drift: async () => ({ behind: false }), refresh: async () => { refreshed += 1; } });
  quiet.request();
  await quiet.idle();
  assert.equal(refreshed, 0);
  const failing = brainUpkeep(garden, { drift: behind, log: line => lines.push(line),
    refresh: async () => { throw new LocalBrainError("broken", "gbrain import exited 1"); } });
  failing.request();
  await failing.idle();
  const unexpected = brainUpkeep(garden, { drift: async () => { throw new Error("SYNTHETIC fault"); }, log: line => lines.push(line), refresh: async () => undefined });
  unexpected.request();
  await unexpected.idle();
  assert.deepEqual(lines, ["Brain: broken: gbrain import exited 1. Run foliage brain rebuild", "Brain: the refresh stopped on an unexpected error"]);
});

test("a refresh that fails the same way every time is not retried by every check: only once the record changes, or the backoff passes; a busy lock is retried", async t => {
  const garden = await temp(t);
  let clock = 5_000_000;
  // The stand-in brain: its record bytes, and the note a failed refresh leaves on the bytes it tried.
  let record = "r1";
  let note: { state: "broken" | "busy"; record: string; at: number } | null = null;
  let failWith: "broken" | "busy" = "broken";
  let attempts = 0;
  const upkeep = brainUpkeep(garden, {
    now: () => clock,
    drift: async () => note !== null && note.state === "broken" && note.record === record ? { behind: true, stoppedAt: note.at } : { behind: true },
    refresh: async () => {
      attempts += 1;
      note = { state: failWith, record, at: clock };
      throw new LocalBrainError(failWith, failWith === "busy" ? "process 1 holds the brain lock" : "gbrain import exited 1");
    },
  });
  const check = async () => { upkeep.request(); await upkeep.idle(); };
  await check();
  assert.equal(attempts, 1, "the first check tries");
  for (let i = 0; i < 5; i += 1) { clock += 30_000; await check(); }
  assert.equal(attempts, 1, "five 30-second checks later, the same bytes are not tried again");
  record = "r2";
  await check();
  assert.equal(attempts, 2, "a changed record is tried at once");
  clock += STOPPED_RETRY_MS - 1;
  await check();
  assert.equal(attempts, 2);
  clock += 1;
  await check();
  assert.equal(attempts, 3, "the same bytes again once the backoff has passed");
  failWith = "busy";
  record = "r3";
  await check();
  await check();
  await check();
  assert.equal(attempts, 6, "a busy lock is not the brain's fault: every check tries again");
});

test("after every MCP tool that is not read-only a refresh is requested, whatever it answered; read-only tools ask nothing", async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const fake = { registerTool(name: string, _config: unknown, handler: (...args: unknown[]) => Promise<unknown>) { handlers.set(name, handler); return {}; } };
  const asked: string[] = [];
  let calling = "";
  refreshAfterWrites(fake as unknown as McpServer, () => asked.push(calling));
  const server = fake as unknown as { registerTool: (name: string, config: object, handler: (...args: unknown[]) => Promise<unknown>) => unknown };
  server.registerTool("synthetic_read", { annotations: { readOnlyHint: true } }, async () => ({ content: [] }));
  server.registerTool("synthetic_write", { annotations: { readOnlyHint: false } }, async (args: unknown) => ({ content: [], args }));
  server.registerTool("synthetic_unannotated", {}, async () => ({ content: [] }));
  server.registerTool("synthetic_refused", { annotations: { readOnlyHint: false } }, async () => ({ content: [], isError: true }));
  server.registerTool("synthetic_throws", { annotations: { destructiveHint: true } }, async () => { throw new Error("SYNTHETIC failure"); });
  for (const name of ["synthetic_read", "synthetic_write", "synthetic_unannotated", "synthetic_refused"]) { calling = name; await handlers.get(name)!({ x: 1 }, {}); }
  calling = "synthetic_throws";
  await assert.rejects(handlers.get("synthetic_throws")!({}, {}), /SYNTHETIC failure/);
  assert.deepEqual(asked, ["synthetic_write", "synthetic_unannotated", "synthetic_refused", "synthetic_throws"]);
  // The arguments and the answer pass through untouched, for tools with and without an input schema.
  calling = "synthetic_write";
  assert.deepEqual(await handlers.get("synthetic_write")!({ x: 2 }, {}), { content: [], args: { x: 2 } });
});
