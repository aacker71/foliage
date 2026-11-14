/** A real local Git record, submitted with observedAt set relative to the import clock. No provider results or customer claims. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { persistIntegrationObservations } from "./integrationStore.ts";

const execute = promisify(execFile);
const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));
const entry = fileURLToPath(new URL("../assistant-mcp.mjs", import.meta.url));
const MINUTE = 60_000;
const IMPORTED_AT = new Date("2026-10-03T12:00:00.000Z");
const at = (offset: number) => new Date(IMPORTED_AT.getTime() + offset).toISOString();
const FUTURE = /^observations\[(\d+)\]\.observedAt is in the future .*no observations were imported/;

async function bytes(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as { code?: string }).code === "ENOENT") return null; throw error; }
}

async function garden(t: { after: (fn: () => Promise<unknown>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "foliage-observed-at-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, "repository"), root = join(dir, "garden");
  const git = (args: string[]) => execute("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", ...args], { timeout: 10_000 });
  await execute("git", ["init", "--quiet", "--initial-branch=main", repo]);
  await git(["config", "user.name", "Observation clock regression"]);
  await git(["config", "user.email", "observation-clock@foliage.invalid"]);
  const excerpt = "Regression input for the observation clock.\n";
  await writeFile(join(repo, "observed.txt"), excerpt);
  await git(["add", "observed.txt"]);
  await git(["commit", "--no-gpg-sign", "-qm", "chore: record an observation for the clock check"]);
  const sha = (await git(["rev-parse", "HEAD"])).stdout.trim();
  await execute(process.execPath, [launcher, "grow", "--repo", repo, "--subject", "Observation clock regression",
    "--identity", "observation-clock@foliage.invalid", "--garden", root], { timeout: 15_000 });
  const into = join(root, "leaf.json"), out = join(root, "harvest.json");
  const leaf = JSON.parse(await readFile(into, "utf8"));
  const batch = (...records: readonly (readonly [revision: string, observedAt: string])[]) => ({
    format: "foliage-observations", version: 1, subject: { leafId: leaf.id, name: leaf.subject },
    source: { provider: "local-git-export", tenantId: null, accountId: "observation-clock" },
    completion: "complete", deletedRecordIds: [] as string[],
    observations: records.map(([revision, observedAt]) => ({ recordId: sha, revision, title: "Observation clock regression", excerpt, observedAt })),
  });
  return { dir, into, out, batch };
}

test("the assistant MCP refuses a future observedAt by name and writes nothing", { timeout: 30_000 }, async t => {
  const f = await garden(t);
  const before = await bytes(f.out);
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, "--into", f.into, "--out", f.out],
    cwd: tmpdir(), stderr: "pipe", env: { FOLIAGE_GARDEN: join(f.dir, "ambient"), FOLIAGE_LEAF: join(f.dir, "ambient-leaf") } });
  const client = new Client({ name: "foliage-observation-clock-regression", version: "1.0.0" });
  client.onerror = () => {};
  await client.connect(transport);
  try {
    // A year past the real clock: the QA repro (2031-01-01) without a date that expires.
    const nextYear = new Date(Date.now() + 366 * 24 * 60 * MINUTE).toISOString();
    const refused = await client.callTool({ name: "foliage_submit_observations", arguments: { batch: f.batch(["next-year", nextYear]) } });
    assert.equal(refused.isError, true, JSON.stringify(refused));
    assert.match(String((refused.structuredContent as { error?: unknown }).error), FUTURE);
    assert.equal(await bytes(f.out), before, "nothing was written to the review queue");
  } finally { await client.close(); }
});

test("an observedAt more than ten minutes after the import refuses the whole batch before any write", { timeout: 30_000 }, async t => {
  const f = await garden(t);
  const before = await bytes(f.out);
  for (const [batch, index] of [
    [f.batch(["just-over", at(10 * MINUTE + 1)]), "0"],
    [f.batch(["years-ahead", "2031-01-01T00:00:00Z"]), "0"],
    [f.batch(["earlier", at(-MINUTE)], ["offset-ahead", "2026-10-03T23:00:00+10:00"]), "1"],
  ] as const) {
    await assert.rejects(persistIntegrationObservations(batch, f.into, f.out, IMPORTED_AT), (error: Error) => {
      assert.equal(error.message.match(FUTURE)?.[1], index, error.message);
      return true;
    });
    assert.equal(await bytes(f.out), before, "nothing was written to the review queue");
  }
});

test("an observedAt up to ten minutes after the import is accepted and kept verbatim", { timeout: 30_000 }, async t => {
  const f = await garden(t);
  for (const [revision, observedAt] of [["same-instant", at(0)], ["clock-ahead", at(9 * MINUTE)], ["at-limit", at(10 * MINUTE)]] as const) {
    const receipt = await persistIntegrationObservations(f.batch([revision, observedAt]), f.into, f.out, IMPORTED_AT);
    assert.equal(receipt.persisted.length, 1);
    const saved = JSON.parse(await readFile(f.out, "utf8")) as { candidates: { id: string; draftedAt: string; evidence: { observedAt: string }[] }[] };
    const candidate = saved.candidates.find(c => c.id === receipt.persisted[0]);
    assert.equal(candidate?.draftedAt, observedAt);
    assert.equal(candidate?.evidence[0]?.observedAt, observedAt);
  }
});

test("past observedAt values import exactly as before, with or without an injected clock", { timeout: 30_000 }, async t => {
  const f = await garden(t);
  const past = [["last-month", "2026-09-08T00:00:00Z"], ["long-ago", "2001-01-01T09:30:00+05:30"]] as const;
  const injected = await persistIntegrationObservations(f.batch(...past), f.into, f.out, IMPORTED_AT);
  assert.equal(injected.persisted.length, 2);
  const real = await persistIntegrationObservations(f.batch(["a-minute-ago", new Date(Date.now() - MINUTE).toISOString()]), f.into, f.out);
  assert.equal(real.persisted.length, 1);
  const saved = JSON.parse(await readFile(f.out, "utf8")) as { candidates: { id: string; draftedAt: string }[] };
  for (const [i, [, observedAt]] of past.entries()) assert.equal(saved.candidates.find(c => c.id === injected.persisted[i])?.draftedAt, observedAt);
  const replay = await persistIntegrationObservations(f.batch(...past), f.into, f.out, IMPORTED_AT);
  assert.deepEqual(replay.unchanged, injected.persisted);
});
