import { testRepository } from "../../../tools/development/testRepository.mjs";
/** Real repository intake is the source for these tests. Calendar/absence mutations are
 * isolated ordering protocol inputs, never stored or presented as actual work dates. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseLeafDocument, type Leaf, type Leaflet } from "@foliage/leaf";
import { loadLeafDocument } from "./leafDocument.ts";
import { revisionDigest } from "./leafletRevision.ts";
import { applyLeafletStory } from "./leafletStory.ts";
import { portfolioTimeline, type GitWorkDate, type PortfolioOrder } from "./portfolioTimeline.ts";
import { renderLeafPage } from "./render.ts";

const exec = promisify(execFile);
let directory: string;
let leaf: Leaf;
let pending: readonly Leaflet[];
const ids = (document: Leaf, mode: PortfolioOrder = "notable", dates?: ReadonlyMap<string, GitWorkDate>) => portfolioTimeline(document, mode, dates).entries.map(entry => entry.record.id);
const validated = (value: unknown) => {
  const parsed = parseLeafDocument(value);
  assert.ok(parsed.ok, parsed.ok ? undefined : JSON.stringify(parsed.issues));
  return parsed.leaf;
};

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "foliage-portfolio-timeline-"));
  const repo = testRepository();
  const { stdout } = await exec("git", ["-C", repo, "log", "-1", "--format=%ae%n%an"]);
  const [identity, subject] = stdout.trim().split("\n");
  assert.ok(identity && subject);
  const path = join(directory, "leaf.json");
  await exec(process.execPath, [fileURLToPath(new URL("../intake.mjs", import.meta.url)), "--repo", repo, "--identity", identity, "--subject", subject, "--out", path]);
  const result = await loadLeafDocument({ FOLIAGE_LEAF: path });
  assert.ok(result.ok);
  leaf = result.leaf;
  pending = leaf.leaflets.filter(record => record.tier === "pending" && record.provenance);
  assert.ok(pending.length >= 4, "actual intake must supply records for ordering protocol probes");
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("real intake produces observation chronology with original records and honest excluded accounting", () => {
  const before = JSON.stringify(leaf);
  const view = portfolioTimeline(leaf);
  const own = leaf.leaflets.filter(record => record.tier !== "excluded");
  assert.deepEqual(view.entries.map(entry => entry.record), own);
  assert.deepEqual(view.excluded, leaf.leaflets.filter(record => record.tier === "excluded"));
  assert.equal(view.entries.length + view.excluded.length, leaf.leaflets.length);
  assert.equal(view.undatedCount, own.length, "observation dates alone cannot supply a work chronology");
  assert.deepEqual(view.unavailableChoices, []);
  for (const entry of view.entries) {
    assert.equal(entry.record, leaf.leaflets[entry.documentIndex]);
    assert.equal(entry.observedAt, entry.record.provenance!.observedAt);
    assert.equal(entry.dateBasis, "observed");
    assert.equal(entry.observedDay, new Date(entry.observedAt!).toISOString().slice(0, 10));
    assert.equal(entry.featured, false);
    assert.equal(entry.leading, false);
  }
  assert.equal(JSON.stringify(leaf), before, "view construction must not mutate the saved document");
});

test("raw Git observations remain reachable in bounded source pages without becoming portfolio stories", async () => {
  const load = await loadLeafDocument({ FOLIAGE_LEAF: join(directory, "leaf.json") });
  assert.ok(load.ok);
  const expected = portfolioTimeline(load.leaf).entries.map(entry => String(entry.record.id));
  assert.ok(expected.length > 24, "the repository's actual history must exercise several reading pages");
  const render = (page: number) => renderLeafPage(load, { rules: [] }, "private", { records: "source", page });
  const recordIds = (html: string) => [...html.matchAll(/data-record-id="([^"]+)"/g)].map(match => match[1]!);
  const work = renderLeafPage(load, { rules: [] }, "private");
  assert.equal(recordIds(work).length, 0, "unreviewed commits are source records, not portfolio story cards");
  assert.match(work, new RegExp(`Source records <span class="fol-metric">${expected.length}</span>`));
  const first = render(1);
  const pageCount = Math.ceil(expected.length / 12);
  assert.match(first, new RegExp(`data-portfolio-page-count="${pageCount}"`));
  assert.match(first, /data-portfolio-records-mode="source"/);
  assert.match(first, /<option value="newest" selected>Newest<\/option>/);
  assert.doesNotMatch(first, /<option value="notable">Notable<\/option>/,
    "unselected source records have no meaningful notability order");
  assert.equal(recordIds(first).length, 12);
  assert.doesNotMatch(first, /No achievements yet|No context yet/);
  assert.doesNotMatch(first, /class="lp-records"|data-leaf-portfolio/,
    "source records keep their own compact reading surface and do not run the story animation");
  assert.match(first, /rel="next" href="[^"]*page=2#leaf-highlights"/);
  const seen = Array.from({ length: pageCount }, (_, index) => recordIds(render(index + 1))).flat();
  assert.deepEqual(seen, expected, "every retained own-work record remains reachable exactly once in saved order");
  assert.equal(new Set(seen).size, expected.length);
  const last = render(pageCount);
  assert.match(last, /rel="prev"/);
  assert.doesNotMatch(last, /rel="next"/);
  assert.deepEqual(recordIds(render(pageCount + 999)), recordIds(last), "out-of-range pages clamp to the final real page");
  assert.doesNotMatch(renderLeafPage(load, { rules: [] }, "published"), /data-portfolio-paged|lp-pagination/,
    "private reading pages cannot change the public projection");
});

test("selected views and owner highlights keep their exact membership across private reading pages", async () => {
  const load = await loadLeafDocument({ FOLIAGE_LEAF: join(directory, "leaf.json") });
  assert.ok(load.ok);
  const selected = pending.slice(10, 27).map(record => record.id);
  assert.equal(selected.length, 17);
  const highlighted = pending[23]!.id;
  const document = validated({ ...leaf, curation: { featured: [highlighted] }, collections: [{ id: "history-selection", title: "Selected history", kind: "body-of-work", achievements: [], leaflets: selected }] });
  const view = { ...load, leaf: document };
  const recordIds = (page: number) => [...renderLeafPage(view, { rules: [] }, "private", { collection: "history-selection", page }).matchAll(/data-record-id="([^"]+)"/g)].map(match => match[1]!);
  assert.deepEqual([...recordIds(1), ...recordIds(2)], [highlighted, ...selected.filter(id => id !== highlighted)]);
  assert.equal(recordIds(1).length, 12);
  assert.equal(recordIds(2).length, 5);
  assert.match(renderLeafPage(view, { rules: [] }, "private", { collection: "history-selection", page: 2 }), /name="collection" value="history-selection"/);
});

test("Most notable follows owner choices before remaining document order without computing importance", () => {
  const chosen = [pending[2]!.id, pending[0]!.id];
  const document = validated({ ...leaf, curation: { featured: chosen } });
  const view = portfolioTimeline(document, "notable");
  const rest = document.leaflets.filter(record => record.tier !== "excluded" && !chosen.includes(record.id));
  assert.deepEqual(view.entries.map(entry => entry.record.id), [...chosen, ...rest.map(record => record.id)]);
  assert.deepEqual(view.entries.filter(entry => entry.leading).map(entry => entry.record.id), [chosen[0]]);
  assert.deepEqual(view.entries.filter(entry => entry.featured).map(entry => entry.record.id), chosen);
  assert.equal(new Set(view.entries.map(entry => entry.record.id)).size, view.entries.length);
});

test("a missing leading choice stays unavailable and cannot promote another record to the tip", () => {
  const excluded = leaf.leaflets.find(record => record.tier === "excluded");
  const choices = ["missing-timeline-protocol-record", ...(excluded ? [excluded.id] : []), pending[0]!.id];
  const document = validated({ ...leaf, curation: { featured: choices } });
  const view = portfolioTimeline(document);
  assert.deepEqual(view.unavailableChoices, choices.slice(0, -1));
  assert.equal(view.entries[0]!.record.id, pending[0]!.id);
  assert.equal(view.entries.some(entry => entry.leading), false);
  assert.deepEqual(document.curation?.featured, choices);
});

test("observation-only records stay work-undated and keep document order in both chronological directions", () => {
  // An intake run observes its records at one instant; reverse chronology must not reverse
  // equal-time entries or pretend their original document order is an event chronology.
  assert.equal(new Set(pending.map(record => record.provenance!.observedAt)).size, 1);
  const document = validated({ ...leaf, leaflets: pending });
  assert.deepEqual(ids(document, "newest"), pending.map(record => record.id));
  assert.deepEqual(ids(document, "oldest"), pending.map(record => record.id));
});

test("chronology compares instants and groups UTC dates across offset and month boundaries", () => {
  const [older, laterFirst, laterSecond] = pending as readonly [Leaflet, Leaflet, Leaflet, ...Leaflet[]];
  // Controlled calendar metadata probes preserve each underlying actual Git reference.
  const values = ["2026-09-01T00:10:00+02:00", "2026-08-31T17:30:00-06:00", "2026-08-31T23:30:00Z"];
  const dates = new Map([older, laterFirst, laterSecond].map((record, index) => [record.provenance!.ref, { source: "git" as const, ref: record.provenance!.ref, authoredAt: values[index]! }]));
  const document = validated({ ...leaf, leaflets: [older, laterFirst, laterSecond] });
  assert.deepEqual(ids(document, "newest", dates), [laterFirst.id, laterSecond.id, older.id]);
  assert.deepEqual(ids(document, "oldest", dates), [older.id, laterFirst.id, laterSecond.id]);
  const earliest = portfolioTimeline(document, "oldest", dates).entries[0]!;
  assert.equal(earliest.workAt, "2026-09-01T00:10:00+02:00", "exact Git metadata instant remains inspectable");
  assert.equal(earliest.workDay, "2026-08-31");
  assert.equal(earliest.workMonth, "2026-08");
  assert.equal(earliest.dateBasis, "git-authored");
  assert.equal(earliest.observedAt, older.provenance!.observedAt, "observation remains a separate fact");
});

test("undated records form the trailing chronological group without borrowing body dates", () => {
  const withoutPrimary = (record: Leaflet): Leaflet => {
    const { provenance, ...rest } = record;
    return { ...rest, tier: "pending", body: [{ text: "Undated timeline protocol: the body has an observation, but the record has no primary date.", provenance: provenance! }] };
  };
  const firstUnknown = withoutPrimary(pending[0]!);
  const secondUnknown = withoutPrimary(pending[1]!);
  const document = validated({ ...leaf, leaflets: [firstUnknown, pending[2]!, secondUnknown, pending[3]!] });
  const dates = new Map([pending[2]!, pending[3]!].map(record => [record.provenance!.ref,
    { source: "git" as const, ref: record.provenance!.ref, authoredAt: "2026-08-31T23:30:00Z" }]));
  for (const mode of ["newest", "oldest"] as const) {
    const view = portfolioTimeline(document, mode, dates);
    assert.deepEqual(view.entries.slice(-2).map(entry => entry.record.id), [firstUnknown.id, secondUnknown.id]);
    assert.equal(view.undatedCount, 2);
    for (const entry of view.entries.slice(-2)) {
      assert.equal(entry.dateBasis, "undated");
      assert.equal(entry.observedAt, null);
      assert.equal(entry.observedDay, null);
      assert.equal(entry.observedMonth, null);
    }
  }
  const chosenUndated = validated({ ...document, curation: { featured: [firstUnknown.id] } });
  assert.equal(portfolioTimeline(chosenUndated, "notable").entries[0]!.record.id, firstUnknown.id, "owner choice still leads in notable mode even without a recorded date");
});

test("saving a person's account cannot replace evidence observation time with the story recording time", () => {
  const record = pending[0]!;
  const recordedAt = new Date().toISOString();
  const changed = applyLeafletStory(leaf, { leafId: leaf.id, leafletId: record.id, revision: revisionDigest(record) },
    [{ section: "problem", text: "Timeline protocol: a person's recorded explanation must not become an inferred work date.", evidence: 0 }],
    "Timeline protocol", leaf.subject, recordedAt);
  const entry = portfolioTimeline(changed, "newest").entries.find(value => value.record.id === record.id)!;
  assert.equal(entry.record.body![0]!.provenance.observedAt, recordedAt);
  assert.equal(entry.observedAt, record.provenance!.observedAt);
  assert.equal(entry.dateBasis, "observed");
  assert.equal(entry.workAt, null, "the new account's own timestamp cannot become a work date");
});

test("source-date bindings require an exact retained Git reference and expose partial grouped coverage", () => {
  const first = pending[0]!, second = pending[1]!, third = pending[2]!;
  const grouped = validated({ ...leaf, leaflets: [{ ...first, body: [
    { provenance: second.provenance!, text: second.title },
    { provenance: third.provenance!, text: third.title },
  ] }] });
  const dates = new Map<string, GitWorkDate>([
    [first.provenance!.ref, { source: "git", ref: second.provenance!.ref, authoredAt: "2026-01-01T00:00:00Z" }],
    [second.provenance!.ref, { source: "git", ref: second.provenance!.ref, authoredAt: "2026-02-01T00:00:00Z" }],
    [third.provenance!.ref, { source: "git", ref: third.provenance!.ref, authoredAt: "2026-03-01T00:00:00Z" }],
  ]);
  const entry = portfolioTimeline(grouped, "newest", dates).entries[0]!;
  assert.equal(entry.workAt, "2026-03-01T00:00:00Z");
  assert.equal(entry.workFromAt, "2026-02-01T00:00:00Z");
  assert.equal(entry.workRefCount, 3);
  assert.deepEqual(entry.workRefs.map(value => value.ref), [second.provenance!.ref, third.provenance!.ref]);
  const nonGit = validated({ ...leaf, leaflets: [{ ...first, provenance: { ...first.provenance!, source: "protocol:other-source" } }] });
  assert.equal(portfolioTimeline(nonGit, "newest", dates).entries[0]!.workAt, null);
});
