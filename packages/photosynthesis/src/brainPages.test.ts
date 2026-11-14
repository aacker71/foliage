/**
 * The local brain's pure part: what may enter the brain, the page's address and format, inert
 * structure lines, the refresh plan and the merge of gbrain's order with Foliage's own matches.
 * Every document here is a SYNTHETIC parser input labelled as such. Nothing here starts gbrain; the
 * same decisions are proven against the staged gbrain by the brain offline gate
 * (`scripts/check-brain-offline.mjs`, with its proofs in `tools/brain/offline-proofs.mjs`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLeafDocument, type Leaf } from "@foliage/leaf";
import {
  brainManifestPage, BrainPageRefusal, brainProjection, brainRecords, brainRefreshPlan, brainSearchHits, brainUnfinishedPages, IN_PLACE_PROCESS_LIMIT, inertStructure,
  type BrainManifestPage, type BrainProjection,
} from "./brainPages.ts";
import { BRAIN_THIRD_PARTY_SOURCE } from "./brainIntake.ts";
import { parseHarvestDocument, type HarvestDocument } from "./harvestDocument.ts";
import { searchRecords } from "./searchGarden.ts";

const at = "2026-10-10T00:00:00Z";
const own = { source: "git", ref: "0000000000000000000000000000000000000001", observedAt: at };
const other = { source: BRAIN_THIRD_PARTY_SOURCE, ref: "people/synthetic-person.md", observedAt: at };

/** A SYNTHETIC leaf.json, parsed as the real one is. */
function leafOf(document: Record<string, unknown>): Leaf {
  const parsed = parseLeafDocument({ id: "synthetic-brain-pages", subject: "Synthetic brain pages fixture", ...document });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.leaf;
}

function synthetic(): { leaf: Leaf; harvest: HarvestDocument } {
  const leaf = leafOf({
    headline: "Synthetic headline about parsers",
    leaflets: [
      { id: "kept", title: "Synthetic kept leaflet", tier: "verified", provenance: own, body: [{ provenance: own, text: "Synthetic body about lockfiles." }] },
      { id: "excluded", title: "Synthetic excluded leaflet", tier: "excluded", reason: "Synthetic: not the subject's work.", provenance: own,
        body: [{ provenance: own, text: "EXCLUDED-BODY-MARKER: somebody else's synthetic work." }] },
      { id: "promoted-third-party", title: "Synthetic promoted leaflet about another person", tier: "pending", provenance: other,
        body: [{ provenance: other, text: "THIRD-PARTY-LEAFLET-MARKER" }] },
    ],
    achievements: [
      { id: "a1", title: "Synthetic achievement", claims: [
        { id: "own", kind: "learning", text: "Synthetic claim on the owner's own work.", citations: [{ leaflet: "kept", provenance: own }] },
        { id: "theirs", kind: "learning", text: "THIRD-PARTY-CLAIM-MARKER", citations: [{ leaflet: "promoted-third-party", provenance: other }] },
      ] },
      { id: "empty", title: "Synthetic achievement with no claims yet", claims: [] },
    ],
    journeyHistory: [{ id: "edit-1", at, actor: "manual", achievement: "a1",
      before: { id: "a1", title: "Synthetic achievement", claims: [{ id: "theirs", kind: "learning", text: "THIRD-PARTY-PAST-MARKER", citations: [{ leaflet: "promoted-third-party", provenance: other }] }] },
      after: { id: "a1", title: "Synthetic achievement", claims: [{ id: "own", kind: "learning", text: "Synthetic claim on the owner's own work.", citations: [{ leaflet: "kept", provenance: own }] }] } }],
  });
  const harvest = parseHarvestDocument({ leafId: leaf.id, subject: leaf.subject, candidates: [
    { id: "brain-note:own", title: "Synthetic draft on the owner's note", evidence: [{ source: "brain-note", ref: "notes/own.md", observedAt: at, excerpt: "Synthetic own note." }],
      extractor: "brain-node", draftedAt: at, review: { state: "candidate" } },
    { id: "brain-note:theirs", title: "Synthetic draft on a note about someone else", evidence: [{ ...other, excerpt: "THIRD-PARTY-DRAFT-MARKER" }],
      extractor: "brain-node", draftedAt: at, review: { state: "candidate" } },
  ] });
  assert.ok(harvest.ok, JSON.stringify(harvest));
  return { leaf, harvest: harvest.harvest };
}

const withLeaflets = (input: { leaf: Leaf; harvest?: HarvestDocument | null }, change: (leaflet: Leaf["leaflets"][number]) => unknown) =>
  ({ ...input, leaf: { ...input.leaf, leaflets: input.leaf.leaflets.map(change) as Leaf["leaflets"] } });

test("an excluded leaflet goes in as its title and reason only, without its evidence; anything resting on third-party material stays out", () => {
  const input = synthetic();
  const { pages, records, heldBack } = brainProjection(input);
  const all = pages.map(page => page.markdown).join("\n");
  for (const marker of ["EXCLUDED-BODY-MARKER", "THIRD-PARTY-LEAFLET-MARKER", "THIRD-PARTY-CLAIM-MARKER", "THIRD-PARTY-PAST-MARKER", "THIRD-PARTY-DRAFT-MARKER", "another person", "someone else"]) {
    assert.ok(!all.includes(marker), `${marker} entered the brain`);
  }
  assert.deepEqual(pages.map(page => page.recordId).sort(), [
    "achievement:empty", "claim:a1:own", "draft:brain-note:own", "leaflet:excluded", "leaflet:kept", "profile:headline",
  ]);
  // A promoted leaflet, the claim and the past version that cite it, and the draft on someone else's note.
  assert.deepEqual([...heldBack].sort(), ["claim:a1:theirs", "draft:brain-note:theirs", "history:edit-1", "leaflet:promoted-third-party"]);
  // The narrowing step and the pages agree: one page per record the brain may hold.
  assert.deepEqual(brainRecords(input).map(record => record.id), pages.map(page => page.recordId));
  assert.deepEqual(records.map(record => record.id), pages.map(page => page.recordId));

  const excluded = records.find(record => record.id === "leaflet:excluded")!;
  assert.deepEqual(excluded, { id: "leaflet:excluded", kind: "excluded leaflet", title: "Synthetic excluded leaflet", text: "Synthetic: not the subject's work.",
    citation: "leaf:leaflet%2Fexcluded", reason: "Synthetic: not the subject's work." });
  const page = pages.find(item => item.recordId === "leaflet:excluded")!;
  assert.equal(page.excluded, true);
  assert.ok(page.markdown.includes('foliage_tier: "excluded"\nfoliage_reason: "Synthetic: not the subject\'s work."\n'));
  // Its evidence points at work the owner did not do: no reference to it in the page either.
  assert.ok(page.markdown.includes("\nfoliage_evidence: []\n") && !page.markdown.includes(own.ref));
  assert.ok(page.markdown.endsWith("---\n# Synthetic excluded leaflet\n\nSynthetic: not the subject's work.\n"));
  assert.ok(pages.filter(item => item !== page).every(item => !item.excluded && !item.markdown.includes("foliage_reason")));
});

test("a page carries the full frontmatter, labels stay out of the searchable body, and the slug is the Leaf and record ids alone", () => {
  const input = synthetic();
  const pages = brainProjection(input).pages;
  for (const page of pages) {
    assert.match(page.slug, /^foliage\/[a-f0-9]{64}$/);
    assert.equal(page.file, `${page.slug}.md`);
    assert.match(page.digest, /^[a-f0-9]{64}$/);
    assert.ok(page.markdown.includes(`\nfoliage_digest: "${page.digest}"\n`));
    assert.ok(!/^(?:id|tags|date|effective_date|slug):/m.test(page.markdown), "no key gbrain reads as identity, tags or recency");
    assert.match(page.markdown, /^---\ntype: "foliage-record"\n/, "one type for every page");
  }
  assert.equal(new Set(pages.map(page => page.slug)).size, pages.length);
  const kept = pages.find(page => page.recordId === "leaflet:kept")!;
  assert.equal(kept.markdown, [
    "---", 'type: "foliage-record"', 'title: "Synthetic kept leaflet"', 'foliage_record: "leaflet:kept"', 'foliage_kind: "verified leaflet"',
    'foliage_tier: "verified"', 'foliage_citation: "leaf:leaflet%2Fkept"', "foliage_updated_at: null", 'foliage_leaf: "synthetic-brain-pages"',
    `foliage_digest: "${kept.digest}"`, `foliage_evidence: ${JSON.stringify([own, own])}`,
    "---", "# Synthetic kept leaflet", "", "Synthetic body about lockfiles.", "",
  ].join("\n"));
  const body = kept.markdown.split("\n---\n")[1]!;
  assert.ok(!body.includes("verified") && !body.includes("leaflet:kept"), "a label is never searchable text");
  const draft = pages.find(page => page.recordId === "draft:brain-note:own")!;
  assert.ok(draft.markdown.includes(`foliage_tier: null\nfoliage_citation: "harvest:candidate%2Fbrain-note%3Aown"\nfoliage_updated_at: "${at}"\n`));
  const empty = pages.find(page => page.recordId === "achievement:empty")!;
  assert.ok(empty.markdown.endsWith("---\n# Synthetic achievement with no claims yet\n"), "a record with no text still has a searchable line");

  // Same ids, different title and tier: the address does not move; another Leaf id moves it.
  const retitled = withLeaflets(input, leaflet => leaflet.id === "kept" ? { ...leaflet, title: "Renamed", tier: "pending", provenance: own } : leaflet);
  assert.equal(brainProjection(retitled).pages.find(page => page.recordId === "leaflet:kept")?.slug, kept.slug);
  assert.notEqual(brainProjection({ leaf: { ...input.leaf, id: "another-leaf" as Leaf["id"] }, harvest: null }).pages.find(page => page.recordId === "leaflet:kept")?.slug, kept.slug);
  // The digest covers every field and the body, and nothing else.
  assert.equal(brainProjection(synthetic()).pages.find(page => page.recordId === "leaflet:kept")?.digest, kept.digest);
  assert.notEqual(brainProjection(retitled).pages.find(page => page.recordId === "leaflet:kept")?.digest, kept.digest);
  const tierOnly = withLeaflets(input, leaflet => leaflet.id === "kept" ? { ...leaflet, tier: "pending" } : leaflet);
  assert.notEqual(brainProjection(tierOnly).pages.find(page => page.recordId === "leaflet:kept")?.digest, kept.digest);
});

test("a title, id or reason holding a line break is refused, naming the record and the field to edit; other values are escaped", () => {
  const input = synthetic();
  for (const [field, id, change] of [
    ["title", "leaflet:kept", (leaflet: Leaf["leaflets"][number]) => leaflet.id === "kept" ? { ...leaflet, title: "Synthetic\ntype: injected" } : leaflet],
    ["title", "leaflet:kept", (leaflet: Leaf["leaflets"][number]) => leaflet.id === "kept" ? { ...leaflet, title: "Synthetic\u2028line separator" } : leaflet],
    ["reason", "leaflet:excluded", (leaflet: Leaf["leaflets"][number]) => leaflet.id === "excluded" ? { ...leaflet, reason: "Synthetic\r\nfoliage_tier: \"verified\"" } : leaflet],
  ] as const) {
    assert.throws(() => brainProjection(withLeaflets(input, change)), (error: unknown) => error instanceof BrainPageRefusal
      && error.recordId === id && error.field === field && error.message === `record "${id}" has a line break in its ${field}`);
  }
  // An evidence reference cannot break out of its line either: it is JSON, with YAML's own line breaks escaped.
  const odd = { source: "git", ref: "synthetic\u2029ref\u0085next", observedAt: at };
  const page = brainProjection(withLeaflets(input, leaflet => leaflet.id === "kept" ? { ...leaflet, provenance: odd } : leaflet)).pages.find(item => item.recordId === "leaflet:kept")!;
  const frontmatter = page.markdown.split("\n---\n")[0]!;
  assert.ok(!/[\u0085\u2028\u2029\r]/.test(frontmatter));
  assert.ok(frontmatter.includes('"ref":"synthetic\\u2029ref\\u0085next"'));
  assert.equal(frontmatter.split("\n").length, 11, "the opening line and ten fields, each on one line");
});

/**
 * gbrain's own rules, restated from the pinned source so this test can check the rewrite without
 * running gbrain: the body splits at the first line matching `splits` (`src/core/markdown.ts:380-399`),
 * and a fence is cut out wherever its begin marker appears (`src/core/facts-fence.ts:53`,
 * `src/core/takes-fence.ts:106`, `src/core/chunkers/recursive.ts:92`).
 */
function gbrainWouldRead(body: string): boolean {
  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index]!.trim();
    if (trimmed === "<!-- timeline -->" || trimmed === "<!--timeline-->" || /^---\s+timeline\s+---$/i.test(trimmed)) return true;
    if (trimmed === "---" && lines.slice(0, index).join("\n").trim() !== "") {
      const next = lines.slice(index + 1).find(line => line.trim() !== "");
      if (next !== undefined && /^##\s+(timeline|history)\b/i.test(next.trim())) return true;
    }
  }
  return ["<!--- gbrain:facts:begin -->", "<!--- gbrain:takes:begin -->"].some(marker => body.includes(marker))
    || /<!---?\s*gbrain:takes:begin\s*-->/.test(body);
}

test("each structure marker in a record's text stays inert in its page, and every word stays", () => {
  const markers: Record<string, string> = {
    "timeline comment": "Before words.\n<!-- timeline -->\nAfter words.",
    "timeline comment, no spaces": "Before words.\n  <!--timeline-->  \nAfter words.",
    "decorated separator": "Before words.\n--- timeline ---\nAfter words.",
    "decorated separator, any case": "Before words.\n---   Timeline   ---\nAfter words.",
    "rule then Timeline heading": "Before words.\n---\n\n## Timeline\nAfter words.",
    "rule then History heading": "Before words.\n   ---\n## History of it\nAfter words.",
    "facts fence": "Before words.\n<!--- gbrain:facts:begin -->\n| fenced words |\n<!--- gbrain:facts:end -->\nAfter words.",
    "takes fence": "Before words. <!--- gbrain:takes:begin --> fenced words <!--- gbrain:takes:end --> After words.",
    "takes fence, short opener": "Before words. <!-- gbrain:takes:begin --> fenced words <!-- gbrain:takes:end --> After words.",
    "carriage returns": "Before words.\r\n<!-- timeline -->\r\nAfter words.",
  };
  for (const [name, text] of Object.entries(markers)) {
    assert.ok(gbrainWouldRead(text), `${name}: the restated rule sees the raw marker`);
    const inert = inertStructure(text);
    assert.ok(!gbrainWouldRead(inert), `${name}: still read as structure after the rewrite: ${JSON.stringify(inert)}`);
    const words = (value: string) => value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    assert.deepEqual(words(inert), words(text), `${name}: every word stays searchable`);
    // The same holds inside a whole page, with the marker as its title too.
    const leaf = leafOf({ leaflets: [{ id: "marked", title: (text.split(/\r?\n/)[1] ?? "").trim() || "Synthetic", tier: "verified", provenance: own, body: [{ provenance: own, text }] }] });
    const [page] = brainProjection({ leaf, harvest: null }).pages;
    assert.ok(!gbrainWouldRead(page!.markdown.split("\n---\n").slice(1).join("\n---\n")), `${name}: the page body is inert`);
  }
  // Text without a marker is written as it is; a plain horizontal rule in the middle is left alone by gbrain anyway.
  assert.equal(inertStructure("Plain words, a <b>tag</b> and -- dashes."), "Plain words, a <b>tag</b> and -- dashes.");
});

/** The manifest's pages for a projection, as the app writes them. */
const built = (projection: BrainProjection): Record<string, BrainManifestPage> => Object.fromEntries(projection.pages.map(page =>
  [page.slug, { record: page.recordId, digest: page.digest, ...(page.excluded ? { excluded: true as const } : {}) }]));

test("the refresh plan writes what changed, removes what went, and rebuilds for the removals the law drives", () => {
  const input = synthetic();
  const before = brainProjection(input);
  const manifest = built(before);
  assert.deepEqual(brainRefreshPlan(manifest, before), { kind: "update", write: [], remove: [] });

  const slugOf = (projection: BrainProjection, id: string) => projection.pages.find(page => page.recordId === id)!.slug;
  // An edit and a new record are written; a record that is gone is removed in place.
  const edited = brainProjection({ ...withLeaflets(input, leaflet => leaflet.id === "kept" ? { ...leaflet, body: [{ provenance: own, text: "Edited synthetic body." }] } : leaflet),
    harvest: { ...input.harvest, candidates: input.harvest.candidates.filter(candidate => candidate.id !== "brain-note:own") } });
  const plan = brainRefreshPlan(manifest, edited);
  assert.equal(plan.kind, "update");
  assert.deepEqual(plan.kind === "update" && plan.write.map(page => page.recordId), ["leaflet:kept"]);
  assert.deepEqual(plan.kind === "update" && plan.remove, [slugOf(before, "draft:brain-note:own")]);
  const { headline: _, ...withoutHeadline } = input.leaf;
  const added = brainProjection({ ...input, leaf: { ...withoutHeadline, profile: { bio: "Synthetic new biography." } } });
  const addPlan = brainRefreshPlan(manifest, added);
  assert.deepEqual(addPlan.kind === "update" && addPlan.write.map(page => page.recordId), ["profile:bio"]);
  assert.deepEqual(addPlan.kind === "update" && addPlan.remove, [slugOf(before, "profile:headline")]);

  // A leaflet newly excluded would keep its old body as a past version if updated in place.
  const excluded = brainProjection(withLeaflets(input, leaflet => leaflet.id === "kept" ? { id: leaflet.id, title: leaflet.title, tier: "excluded", reason: "Synthetic: not mine after all.", provenance: own, body: leaflet.body } : leaflet));
  assert.deepEqual(brainRefreshPlan(manifest, excluded), { kind: "rebuild", because: "a leaflet was newly excluded, so its earlier text must leave the brain" });
  // A record that now rests on material about someone else.
  const theirs = brainProjection(withLeaflets(input, leaflet => leaflet.id === "kept" ? { ...leaflet, provenance: other } : leaflet));
  assert.ok(theirs.heldBack.has("leaflet:kept"));
  assert.deepEqual(brainRefreshPlan(manifest, theirs), { kind: "rebuild", because: "a record now rests on material about someone else, so it must leave the brain" });
  // Not the law's: an excluded leaflet's new reason, and an excluded leaflet brought back, are updates in place.
  const reasoned = brainProjection(withLeaflets(input, leaflet => leaflet.id === "excluded" ? { ...leaflet, reason: "Synthetic: a clearer reason." } : leaflet));
  const reasonedPlan = brainRefreshPlan(manifest, reasoned);
  assert.deepEqual(reasonedPlan.kind === "update" && reasonedPlan.write.map(page => page.recordId), ["leaflet:excluded"]);
  const restored = brainProjection(withLeaflets(input, leaflet => leaflet.id === "excluded" ? { id: leaflet.id, title: leaflet.title, tier: "pending", provenance: own, body: leaflet.body } : leaflet));
  const restoredPlan = brainRefreshPlan(manifest, restored);
  assert.deepEqual(restoredPlan.kind === "update" && restoredPlan.write.map(page => page.recordId), ["leaflet:excluded"]);
  // A manifest key named like an Object prototype member is just a slug.
  assert.deepEqual(brainRefreshPlan({ ...manifest, ["__proto__"]: { record: "gone", digest: "0" } } as Record<string, BrainManifestPage>, before).kind, "update");
});

test("an unfinished refresh is planned against what gbrain may hold: a page it imported and the law later removes rebuilds", () => {
  const input = synthetic();
  const before = brainProjection(input);
  const manifest = built(before);
  const slugOf = (projection: BrainProjection, id: string) => projection.pages.find(page => page.recordId === id)!.slug;
  const added = (tier: string, provenance: typeof own, extra: Record<string, unknown> = {}) => ({ ...input, leaf: { ...input.leaf, leaflets: [...input.leaf.leaflets,
    { id: "late", title: "Synthetic late leaflet", tier, provenance, body: [{ provenance, text: "Synthetic late body." }], ...extra }] as Leaf["leaflets"] } });
  const late = brainProjection(added("pending", own));
  const plan = brainRefreshPlan(manifest, late);
  assert.deepEqual(plan.kind === "update" && plan.write.map(page => page.recordId), ["leaflet:late"]);
  // The refresh records what gbrain may hold before its import: the manifest's pages, and the new one as written.
  const unfinished = brainUnfinishedPages(manifest, plan.kind === "update" ? plan.write : []);
  assert.deepEqual(Object.keys(unfinished).sort(), [...Object.keys(manifest), slugOf(late, "leaflet:late")].sort());
  assert.deepEqual(unfinished[slugOf(late, "leaflet:late")], { ...brainManifestPage(late.pages.find(page => page.recordId === "leaflet:late")!), unconfirmed: true });
  assert.deepEqual(brainUnfinishedPages(manifest, []), manifest, "a refresh that writes nothing records the manifest's pages");
  // Killed before its import, nothing changes on the record: the unconfirmed page is written and confirmed again, never skipped.
  assert.deepEqual(brainRefreshPlan(unfinished, late), { kind: "update", write: late.pages.filter(page => page.recordId === "leaflet:late"), remove: [] });
  // Killed after that import, the leaflet is excluded: against the manifest alone it would be an
  // update in place, whose past version keeps the body; against what gbrain may hold, a rebuild.
  const lateExcluded = brainProjection(added("excluded", own, { reason: "Synthetic: not mine after all." }));
  assert.equal(brainRefreshPlan(manifest, lateExcluded).kind, "update", "the gap the unfinished record closes");
  assert.deepEqual(brainRefreshPlan(unfinished, lateExcluded), { kind: "rebuild", because: "a leaflet was newly excluded, so its earlier text must leave the brain" });
  // Or it turns out to rest on a note about someone else: against the manifest it is just absent, against what gbrain may hold a rebuild.
  const lateTheirs = brainProjection(added("pending", other));
  assert.deepEqual(brainRefreshPlan(manifest, lateTheirs), { kind: "update", write: [], remove: [] });
  assert.deepEqual(brainRefreshPlan(unfinished, lateTheirs), { kind: "rebuild", because: "a record now rests on material about someone else, so it must leave the brain" });
  // Or the record goes back to what the manifest was built from, byte for byte: the page gbrain may
  // hold is written back, never taken as current (the app compares record hashes, which the
  // unfinished record never matches).
  const reverted = brainRefreshPlan(unfinished, before);
  assert.deepEqual(reverted.kind === "update" && [reverted.write, reverted.remove], [[], [slugOf(late, "leaflet:late")]]);
  // An excluded leaflet brought back, imported, then excluded again: a rebuild, not an update in place.
  const restored = brainProjection(withLeaflets(input, leaflet => leaflet.id === "excluded" ? { id: leaflet.id, title: leaflet.title, tier: "pending", provenance: own, body: leaflet.body } : leaflet));
  const restoredPlan = brainRefreshPlan(manifest, restored);
  const restoredUnfinished = brainUnfinishedPages(manifest, restoredPlan.kind === "update" ? restoredPlan.write : []);
  assert.equal(restoredUnfinished[slugOf(before, "leaflet:excluded")]?.excluded, undefined);
  assert.deepEqual(brainRefreshPlan(restoredUnfinished, before), { kind: "rebuild", because: "a leaflet was newly excluded, so its earlier text must leave the brain" });
});

test("an update in place larger than a rebuild is planned as a rebuild", () => {
  const leaflet = (index: number, text: string) => ({ id: `n${index}`, title: `Synthetic leaflet ${index}`, tier: "pending", provenance: own, body: [{ provenance: own, text }] });
  const many = (count: number, text: string) => brainProjection({ leaf: leafOf({ leaflets: Array.from({ length: count }, (_, index) => leaflet(index, text)) }), harvest: null });
  const base = many(40, "Synthetic text, first version.");
  const manifest = built(base);
  const edited = (count: number) => brainProjection({ leaf: leafOf({ leaflets: Array.from({ length: 40 }, (_, index) => leaflet(index, index < count ? "Synthetic text, second version." : "Synthetic text, first version.")) }), harvest: null });
  // Each write costs one process, each removal three.
  assert.equal(brainRefreshPlan(manifest, edited(IN_PLACE_PROCESS_LIMIT)).kind, "update");
  assert.deepEqual(brainRefreshPlan(manifest, edited(IN_PLACE_PROCESS_LIMIT + 1)), { kind: "rebuild", because: "a rebuild is quicker than changing this many pages one at a time" });
  const removals = Math.floor(IN_PLACE_PROCESS_LIMIT / 3);
  assert.equal(brainRefreshPlan(manifest, many(40 - removals, "Synthetic text, first version.")).kind, "update");
  assert.equal(brainRefreshPlan(manifest, many(40 - removals - 1, "Synthetic text, first version.")).kind, "rebuild");
});

/** SYNTHETIC: twelve leaflets that all mention one word, a claim and its past version one word apart, and an excluded leaflet. */
function crowded() {
  const leaflets = Array.from({ length: 12 }, (_, index) => ({ id: `l${index}`, title: `Synthetic leaflet ${index}`, tier: index % 2 ? "verified" : "pending",
    provenance: own, body: [{ provenance: own, text: `Synthetic quillwort notes number ${index}.` }] }));
  const leaf = leafOf({
    leaflets: [...leaflets, { id: "outside", title: "Synthetic quillwort survey by someone else", tier: "excluded", reason: "Synthetic: another contributor wrote this.",
      provenance: own, body: [{ provenance: own, text: "Bodyonlyword quillwort, written by someone else." }] }],
    achievements: [{ id: "a1", title: "Synthetic quillwort achievement", claims: [{ id: "c1", kind: "learning", text: "Mapped quillwort beds by kayak." }] }],
    journeyHistory: [{ id: "edit-1", at, actor: "manual", achievement: "a1",
      before: { id: "a1", title: "Synthetic quillwort achievement", claims: [{ id: "c1", kind: "learning", text: "Mapped quillwort beds by canoe." }] },
      after: { id: "a1", title: "Synthetic quillwort achievement", claims: [{ id: "c1", kind: "learning", text: "Mapped quillwort beds by kayak." }] } }],
  });
  return { leaf, harvest: null };
}

test("brain search keeps gbrain's order, then adds today's remaining matches: never fewer than today's search", () => {
  const projection = brainProjection(crowded());
  const manifest = built(projection);
  const slug = (id: string) => projection.pages.find(page => page.recordId === id)!.slug;
  const today = searchRecords(projection.records, "quillwort", { limit: 10 });
  assert.equal(today.length, 10, "at least ten matching records");
  // gbrain deduplicates: it returned 6 of 10 matching pages in the spec's probe, and a claim and its
  // past version one word apart as one. Simulated here: some of today's matches in another order, a
  // repeat, a slug it never built, and a literal match today's top ten leaves out.
  const left = projection.records.find(record => /quillwort/i.test(record.text) && !today.some(hit => hit.id === record.id))!;
  assert.ok(left, "more records match than the limit holds");
  assert.ok(today.some(hit => hit.id === "history:edit-1"));
  const others = today.map(hit => hit.id).filter(id => id !== "history:edit-1");
  const first = [others[3]!, "history:edit-1", others[7]!, others[0]!, others[5]!];
  const ordered = [slug(first[0]!), slug(first[1]!), "foliage/" + "0".repeat(64), slug(first[2]!), slug(first[0]!), slug(left.id), slug(first[3]!), slug(first[4]!)];
  const hits = brainSearchHits({ records: projection.records, built: manifest, ordered, query: "quillwort", limit: 10 });
  assert.equal(hits.length, 10);
  for (const hit of today) assert.ok(hits.some(found => found.id === hit.id), `${hit.id}, which today's search returns, is missing`);
  assert.deepEqual(hits.slice(0, 5).map(hit => hit.id), first, "gbrain's order first, each record once");
  assert.deepEqual(hits.slice(5).map(hit => hit.id), today.map(hit => hit.id).filter(id => !first.includes(id)), "then today's, in today's order");
  assert.ok(!hits.some(hit => hit.id === left.id), "a match beyond today's limit never displaces one of today's");
  // The current claim and its past version are both there, each labelled.
  assert.deepEqual(["claim:a1:c1", "history:edit-1"].map(id => hits.find(hit => hit.id === id)?.kind), ["achievement learning", "past version"]);
  // Built only from Foliage's record: today's shape, no score, no gbrain field.
  for (const hit of hits) {
    assert.deepEqual(Object.keys(hit).filter(key => !["id", "kind", "title", "snippet", "citation", "evidence", "reason"].includes(key)), []);
    assert.ok(!JSON.stringify(hit).toLowerCase().includes("bodyonlyword"));
  }
  // A slug gbrain answers for a record that is gone since is dropped; an empty order is today's search.
  const gone = brainSearchHits({ records: projection.records.filter(record => record.id !== "leaflet:l3"), built: manifest, ordered, query: "quillwort", limit: 10 });
  assert.ok(!gone.some(hit => hit.id === "leaflet:l3"));
  assert.deepEqual(brainSearchHits({ records: projection.records, built: {}, ordered: [], query: "quillwort", limit: 10 }).map(hit => hit.id), today.map(hit => hit.id));
});

test("a match only gbrain finds fills spare room and never displaces one of today's; an excluded hit is its reason", () => {
  const projection = brainProjection(crowded());
  const manifest = built(projection);
  const slug = (id: string) => projection.pages.find(page => page.recordId === id)!.slug;
  // "kayaks": today's search is literal and finds nothing; suppose gbrain's stemming found the claim.
  assert.deepEqual(searchRecords(projection.records, "kayaks", { limit: 10 }), []);
  assert.deepEqual(brainSearchHits({ records: projection.records, built: manifest, ordered: [slug("claim:a1:c1")], query: "kayaks", limit: 3 }).map(hit => hit.id), ["claim:a1:c1"]);
  // With today's search already filling the limit, gbrain-only hits wait; today's hits all stay.
  const today = searchRecords(projection.records, "quillwort", { limit: 3 });
  const full = brainSearchHits({ records: projection.records, built: manifest, ordered: [slug("leaflet:l9"), slug("leaflet:l8"), slug(today[1]!.id)], query: "quillwort", limit: 3 });
  assert.equal(full.length, 3);
  assert.deepEqual(new Set(full.map(hit => hit.id)), new Set(today.map(hit => hit.id)));
  assert.equal(full[0]!.id, today[1]!.id, "gbrain still orders what both found");

  const outside = brainSearchHits({ records: projection.records, built: manifest, ordered: [slug("leaflet:outside")], query: "survey", limit: 5 });
  assert.deepEqual(outside.map(hit => [hit.id, hit.snippet, hit.reason]), [["leaflet:outside", "Synthetic: another contributor wrote this.", "Synthetic: another contributor wrote this."]]);
  assert.equal(brainSearchHits({ records: projection.records, built: manifest, ordered: [slug("leaflet:outside")], query: "bodyonlyword", limit: 5 })
    .some(hit => hit.snippet.toLowerCase().includes("bodyonlyword")), false, "no hit shows a word of the excluded body");
  assert.deepEqual(brainSearchHits({ records: projection.records, built: manifest, ordered: [], query: "bodyonlyword", limit: 5 }), [], "and Foliage's own matches never find one");
  for (const [query, limit, message] of [["", 5, /1–300 query characters/], ["x".repeat(301), 5, /1–300/], ["quillwort", 11, /limit must be 1–10/], ["quillwort", 0, /limit must be 1–10/]] as const) {
    assert.throws(() => brainSearchHits({ records: projection.records, built: manifest, ordered: [], query, limit }), message);
  }
});
