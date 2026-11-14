/** Synthetic gate protocol answers, never a user's evidence or a real gbrain result. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { brainPaths } from "../../apps/leaf/src/localBrain.ts";
import { KEYWORD_MODE, refreshedBrainSearch } from "./offline-proofs.mjs";

const leaf = '{"id":"synthetic-search-proof"}\n';
const hits = [{ id: "leaflet:one", kind: "pending", title: "Synthetic current record",
  snippet: "Synthetic quillwort edit", citation: "leaflet:one" }];
const current = { subject: { leafId: "synthetic-search-proof", name: "Synthetic fixture" }, retrieval: "brain keyword", hits };
const refreshing = { ...current, retrieval: "foliage keyword", because: "Brain: behind your record, refreshing" };
const own = { ...refreshing, because: KEYWORD_MODE };
const ran = (/** @type {unknown} */ answer) => ({ code: 0, signal: null, stdout: JSON.stringify(answer), stderr: "" });

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const garden = await mkdtemp(join(tmpdir(), "foliage-search-proof-"));
  t.after(() => rm(garden, { recursive: true, force: true }));
  const paths = brainPaths(garden);
  await mkdir(paths.home, { recursive: true });
  await mkdir(dirname(paths.database), { recursive: true });
  await writeFile(paths.database, "Synthetic database identity fixture");
  await writeFile(join(garden, "leaf.json"), leaf);
  const markCurrent = () => writeFile(paths.manifest, JSON.stringify({
    leafSha256: createHash("sha256").update(leaf).digest("hex"), harvestSha256: null,
  }));
  await markCurrent();
  /** @type {string[]} */
  const calls = [];
  const g = { garden, paths,
    async brain(/** @type {string} */ step, /** @type {readonly string[]} */ args) {
      assert.equal(args[0], "search", "the proof must never repair a refresh itself");
      calls.push(args[0]);
      return ran(calls.length === 1 ? refreshing : current);
    },
    async foliage(/** @type {string} */ step, /** @type {readonly string[]} */ args) {
      assert.equal(args[0], "search");
      return ran(own);
    },
  };
  return { g, calls, markCurrent };
}

test("a bounded search fallback is accepted only after the same refresh completes and the next search reads the brain", async t => {
  const { g, calls, markCurrent } = await fixture(t);
  await writeFile(g.paths.manifest, JSON.stringify({ leafSha256: "old", harvestSha256: null }));
  await writeFile(g.paths.lock, "synthetic refresh lock");
  let completed = false;
  const search = g.brain;
  g.brain = async (step, args) => {
    if (calls.length > 0) assert.equal(completed, true, "a follow-up cannot repair an unfinished refresh");
    return search(step, args);
  };
  // The simulated original writer alone advances the manifest and releases the lock.
  // If the proof removes its completion wait, the second search fails above.
  const completion = new Promise((resolve, reject) => setTimeout(() => {
    void (async () => {
      await markCurrent();
      await rm(g.paths.lock);
      completed = true;
      resolve(undefined);
    })().catch(reject);
  }, 100));
  t.after(() => completion);
  const result = await refreshedBrainSearch(g, "synthetic delayed refresh", "quillwort");
  assert.equal(result.answer.retrieval, "brain keyword");
  assert.deepEqual(calls, ["search", "search"]);
});

test("a search that already read the refreshed brain needs no second search", async t => {
  const { g } = await fixture(t);
  let calls = 0;
  g.brain = async () => { calls++; return ran(current); };
  await refreshedBrainSearch(g, "synthetic fast refresh", "quillwort");
  assert.equal(calls, 1);
});

test("unrelated fallback causes, empty answers and stale fallback content fail the refresh proof", async t => {
  for (const first of [{ ...refreshing, because: "Brain: broken" }, { ...refreshing, hits: [] },
    { ...refreshing, hits: [{ ...hits[0], snippet: "Synthetic old text" }] }, { ...current, because: "unexpected cause" }]) {
    const { g } = await fixture(t);
    g.brain = async () => ran(first);
    await assert.rejects(refreshedBrainSearch(g, "synthetic invalid answer", "quillwort"));
  }
});

test("a refresh failure is not hidden by a truthful initial fallback", async t => {
  const { g } = await fixture(t);
  await writeFile(g.paths.manifest, JSON.stringify({ leafSha256: "old", harvestSha256: null }));
  await writeFile(g.paths.refreshFailure, JSON.stringify({ cause: "Synthetic stopped refresh" }));
  await assert.rejects(refreshedBrainSearch(g, "synthetic stopped refresh", "quillwort"), /refresh stopped/);
});

test("a second fallback cannot stand in for a completed brain search", async t => {
  const { g } = await fixture(t);
  g.brain = async () => ran(refreshing);
  await assert.rejects(refreshedBrainSearch(g, "synthetic fallback forever", "quillwort"), /follow-up did not read the current brain/);
});

test("a refresh that changes the source record fails even if it reports a current brain", async t => {
  const { g } = await fixture(t);
  g.brain = async () => {
    await writeFile(join(g.garden, "leaf.json"), `${leaf} `);
    return ran(current);
  };
  await assert.rejects(refreshedBrainSearch(g, "synthetic changed record", "quillwort"), /record byte changed/);
});

test("a not-behind result from a refused brain cannot authorize a repairing follow-up", async t => {
  const { g, calls } = await fixture(t);
  await writeFile(g.paths.manifest, JSON.stringify({ leafSha256: "old", harvestSha256: null }));
  await writeFile(g.paths.refused, "Synthetic refused brain");
  await assert.rejects(refreshedBrainSearch(g, "synthetic false completion", "quillwort"), /manifest does not match/);
  assert.equal(calls.length, 1, "no follow-up may repair the original refresh");
});

test("a leftover failure note fails even when the brain already looks current", async t => {
  const { g } = await fixture(t);
  g.brain = async () => ran(current);
  await writeFile(g.paths.refreshFailure, JSON.stringify({ cause: "Synthetic stopped refresh" }));
  await assert.rejects(refreshedBrainSearch(g, "synthetic leftover failure", "quillwort"), /refresh stopped/);
});

test("a follow-up that writes the manifest cannot count as a read-only confirmation", async t => {
  const { g, calls } = await fixture(t);
  const search = g.brain;
  g.brain = async (step, args) => {
    if (calls.length > 0) await writeFile(g.paths.manifest, `${await readFile(g.paths.manifest, "utf8")} `);
    return search(step, args);
  };
  await assert.rejects(refreshedBrainSearch(g, "synthetic repair by follow-up", "quillwort"), /follow-up changed the manifest/);
});

test("replacing the database during either search cannot prove an in-place refresh", async t => {
  for (const replaceAt of [1, 2]) {
    const { g, calls } = await fixture(t);
    const search = g.brain;
    g.brain = async (step, args) => {
      const answer = await search(step, args);
      if (calls.length === replaceAt) {
        const replacement = `${g.paths.database}.replacement`;
        await writeFile(replacement, "Synthetic replacement database");
        await rename(replacement, g.paths.database);
      }
      return answer;
    };
    await assert.rejects(refreshedBrainSearch(g, "synthetic database rebuild", "quillwort"), /rebuilt the brain/);
  }
});

test("a follow-up that leaves a refresh lock cannot count as completed", async t => {
  const { g, calls } = await fixture(t);
  const search = g.brain;
  g.brain = async (step, args) => {
    if (calls.length > 0) await writeFile(g.paths.lock, "Synthetic follow-up lock");
    return search(step, args);
  };
  await assert.rejects(refreshedBrainSearch(g, "synthetic follow-up lock", "quillwort"), /let go of the lock/);
});
