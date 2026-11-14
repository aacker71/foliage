import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readLocalSearchRecords, searchLocalGarden } from "./localSearch.ts";

const execute = promisify(execFile);
const launcher = fileURLToPath(new URL("../../../foliage.mjs", import.meta.url));

test("first-run private search reports no record without creating one or hiding broken documents", async t => {
  const garden = await mkdtemp(join(tmpdir(), "foliage-search-empty-"));
  t.after(() => rm(garden, { recursive: true, force: true }));
  const into = join(garden, "leaf.json"), out = join(garden, "harvest.json");

  const empty = await execute(process.execPath, [launcher, "search", "work", "--garden", garden], { timeout: 10_000 });
  assert.deepEqual(JSON.parse(empty.stdout), { state: "no-record", hits: [] });
  assert.equal(empty.stderr, "");
  assert.ok(!empty.stdout.includes(garden));
  assert.deepEqual(await readdir(garden), []);

  await assert.rejects(searchLocalGarden(into, out, "work", 8, { leafId: "bound", name: "bound" }),
    error => error instanceof Error && error.message === "Selected Leaf is unavailable. Restart the connection.");
  await assert.rejects(searchLocalGarden(into, out, "work", 0), /Search limit must be 1–10/);

  await writeFile(out, "{}");
  await assert.rejects(searchLocalGarden(into, out, "work"), /Leaf is missing while review data remains/);
  await rm(out);
  await writeFile(into, "{broken");
  await assert.rejects(execute(process.execPath, [launcher, "search", "work", "--garden", garden], { timeout: 10_000 }),
    /Selected leaf is not valid JSON/);
  assert.equal(await readFile(into, "utf8"), "{broken");
});

/** SYNTHETIC record for the brain-beside tests: provenance, a note about someone else, an excluded leaflet with evidence. */
const AT = "2026-10-10T00:00:00Z";
const OWN = { source: "git", ref: "0000000000000000000000000000000000000001", observedAt: AT };
const OTHER = { source: "brain-note:third-party", ref: "people/synthetic-person.md", observedAt: AT };
async function brainBesideGarden(t: { after: (fn: () => Promise<unknown>) => void }) {
  const garden = await mkdtemp(join(tmpdir(), "foliage-search-beside-"));
  t.after(() => rm(garden, { recursive: true, force: true }));
  const leaf = { id: "synthetic-beside", subject: "Synthetic beside subject", leaflets: [
    { id: "own", title: "Synthetic lichen leaflet", tier: "verified", provenance: OWN, body: [{ provenance: OWN, text: "Synthetic lichen notes." }] },
    { id: "outside", title: "Synthetic lichen survey", tier: "excluded", reason: "Synthetic: another contributor wrote this.", provenance: OWN,
      body: [{ provenance: OWN, text: "Bodyonlyword, somebody else's synthetic lichen work." }] },
    { id: "promoted", title: "Synthetic promoted lichen leaflet", tier: "pending", provenance: OTHER, body: [{ provenance: OTHER, text: "Promotedmarker lichen notes." }] },
  ] };
  const harvest = { leafId: leaf.id, subject: leaf.subject, candidates: [
    { id: "brain-note:own", title: "Synthetic lichen draft", extractor: "brain-node", draftedAt: AT, review: { state: "candidate" },
      evidence: [{ source: "brain-note", ref: "notes/own.md", observedAt: AT, excerpt: "Synthetic draft about lichen." }] },
    { id: "brain-note:theirs", title: "Synthetic lichen draft on a note about someone else", extractor: "brain-node", draftedAt: AT, review: { state: "candidate" },
      evidence: [{ ...OTHER, excerpt: "Theirdraftmarker lichen words." }] },
  ] };
  const into = join(garden, "leaf.json"), out = join(garden, "harvest.json");
  await writeFile(into, `${JSON.stringify(leaf, null, 2)}\n`);
  await writeFile(out, `${JSON.stringify(harvest, null, 2)}\n`);
  const { parseHarvestDocument } = await import("@foliage/photosynthesis");
  const { parseLeafDocument } = await import("@foliage/leaf");
  const leafParsed = parseLeafDocument(leaf), harvestParsed = parseHarvestDocument(harvest);
  assert.ok(leafParsed.ok && harvestParsed.ok, "the synthetic record parses");
  return { garden, into, out, harvest, record: { leaf: leafParsed.leaf, harvest: harvestParsed.harvest } };
}

/** Why a garden's `foliage search` and `foliage_search` answered without the brain (owner decision 3). */
const KEYWORD_MODE = "Keyword mode: Foliage's own keyword search answers here; foliage brain search searches the local brain";

test("foliage search and foliage_search answer from Foliage's own search over brainRecords, and say keyword mode is why the brain did not", async t => {
  const g = await brainBesideGarden(t);
  const before = await Promise.all([readFile(g.into, "utf8"), readFile(g.out, "utf8")]);
  const { brainRecords, searchRecords } = await import("@foliage/photosynthesis");
  const answer = await searchLocalGarden(g.into, g.out, "lichen", 8);
  assert.ok(!("state" in answer));
  assert.deepEqual([answer.subject, answer.retrieval, answer.because], [{ leafId: "synthetic-beside", name: "Synthetic beside subject" }, "foliage keyword", KEYWORD_MODE]);
  // Over brainRecords: the excluded leaflet is its title and reason, without evidence; nothing resting on a note about someone else.
  assert.deepEqual(answer.hits, searchRecords(brainRecords(g.record), "lichen", { limit: 8 }));
  assert.deepEqual(answer.hits.map(hit => hit.id).sort(), ["draft:brain-note:own", "leaflet:outside", "leaflet:own"]);
  const excluded = answer.hits.find(hit => hit.id === "leaflet:outside")!;
  assert.deepEqual([excluded.snippet, excluded.reason, excluded.evidence], ["Synthetic: another contributor wrote this.", "Synthetic: another contributor wrote this.", undefined]);
  const text = JSON.stringify(answer);
  assert.doesNotMatch(text, /bodyonlyword|promotedmarker|theirdraftmarker|"score"/i);
  assert.ok(!text.includes(g.garden));
  // The command answers the same, through the launcher.
  const cli = await execute(process.execPath, [launcher, "search", "lichen", "--garden", g.garden], { timeout: 10_000 });
  assert.deepEqual(JSON.parse(cli.stdout), answer);
  // A connection's bound identity is checked on the bytes read.
  await assert.rejects(searchLocalGarden(g.into, g.out, "lichen", 8, { leafId: "synthetic-beside", name: "Another subject" }),
    /Selected Leaf identity changed. Restart the connection./);
  await writeFile(g.out, JSON.stringify({ ...g.harvest, subject: "Different subject" }));
  await assert.rejects(searchLocalGarden(g.into, g.out, "lichen", 8), /Harvest binding is absent or differs/);
  await writeFile(g.out, before[1]!);
  // Two documents that are not a garden's leaf.json and harvest.json have no brain at all.
  const elsewhere = join(g.garden, "elsewhere");
  await mkdir(elsewhere);
  await writeFile(join(elsewhere, "selected-leaf.json"), before[0]!);
  await writeFile(join(elsewhere, "selected-harvest.json"), before[1]!);
  const unpaired = await searchLocalGarden(join(elsewhere, "selected-leaf.json"), join(elsewhere, "selected-harvest.json"), "lichen", 8);
  assert.ok(!("state" in unpaired));
  assert.deepEqual([unpaired.retrieval, unpaired.because, unpaired.hits], ["foliage keyword", "Brain: off", answer.hits]);
  // A search writes nothing: not the record, and no brain.
  assert.deepEqual(await Promise.all([readFile(g.into, "utf8"), readFile(g.out, "utf8")]), before);
  assert.deepEqual((await readdir(g.garden)).sort(), ["elsewhere", "harvest.json", "leaf.json"]);
});

test("with no brain installed, foliage search and foliage_search say so — not that local embeddings are off", async t => {
  const g = await brainBesideGarden(t);
  const { brainRecords, searchRecords } = await import("@foliage/photosynthesis");
  // An installed copy without the brain archive has no vendor/ at all; a vendor/ with no staging record is no brain either.
  for (const vendor of [join(g.garden, "no-vendor-here"), g.garden]) {
    const answer = await searchLocalGarden(g.into, g.out, "lichen", 8, undefined, { vendor });
    assert.ok(!("state" in answer));
    assert.deepEqual([answer.retrieval, answer.because], ["foliage keyword", "No brain is installed: Foliage's own search answers here"]);
    assert.doesNotMatch(answer.because ?? "", /embeddings/);
    assert.deepEqual(answer.hits, searchRecords(brainRecords(g.record), "lichen", { limit: 8 }));
    assert.ok(!JSON.stringify(answer).includes(g.garden), "no path reaches an agent");
  }
  assert.deepEqual((await readdir(g.garden)).sort(), ["harvest.json", "leaf.json"], "nothing was made");
});

test("the private-brain session still reads the whole record, as before the brain", async t => {
  const g = await brainBesideGarden(t);
  const { gardenSearchRecords } = await import("@foliage/photosynthesis");
  const read = await readLocalSearchRecords(g.into, g.out, { leafId: "synthetic-beside", name: "Synthetic beside subject" });
  assert.deepEqual(read.records, gardenSearchRecords(g.record));
  assert.ok(read.records.some(record => record.id === "draft:brain-note:theirs"), "its grants name exact records, third-party ones included");
});
