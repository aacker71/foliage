/** Renderer contracts use real repository intake. Mutated records below are isolated parser/UI
 * probes, never persisted as work or presented as portfolio evidence. */
import assert from "node:assert/strict";
import { testRepository } from "../../../tools/development/testRepository.mjs";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Leaflet } from "@foliage/leaf";
import { ui } from "@foliage/ui";
import { renderCompoundPage } from "./compoundPage.ts";
import { loadLeafDocument, type LeafLoad } from "./leafDocument.ts";
import { esc, ownerLeafletHref } from "./render.ts";
import { applyLeafletStory } from "./leafletStory.ts";
import { revisionDigest } from "./leafletRevision.ts";
import { compoundLayout } from "./compoundLayout.ts";

const exec = promisify(execFile);
const repo = testRepository();
let directory: string;
let loaded: Extract<LeafLoad, { ok: true }>;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "foliage-compound-renderer-"));
  const { stdout } = await exec("git", ["-C", repo, "log", "-1", "--format=%ae%n%an"]);
  const [identity, subject] = stdout.trim().split("\n");
  assert.ok(identity && subject, "the renderer test requires real repository history");
  const path = join(directory, "leaf.json");
  await exec(process.execPath, [fileURLToPath(new URL("../intake.mjs", import.meta.url)), "--repo", repo, "--identity", identity, "--subject", subject, "--out", path]);
  const result = await loadLeafDocument({ FOLIAGE_LEAF: path });
  assert.ok(result.ok);
  loaded = result;
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

/** The record list is rendered through @foliage/ui (React escaping, `'` → `&#x27;`), not render.ts esc()
 * (`'` → `&#39;`). Expected attributes go through the same escaper, so real titles with any punctuation match. */
function uiAttribute(name: `data-${string}`, value: string): string {
  return ui.button("", { [name]: value }).match(new RegExp(` ${name}="[^"]*"`))![0];
}

/** Cherry-picked commits legitimately share titles. Text-presence/order probes need distinct
 * actual words so an unrelated record cannot match the selected record's own heading. */
function distinctTextRecords(): Leaflet[] {
  const titles = new Set<string>();
  return loaded.leaf.leaflets.filter(record => {
    if (!record.provenance || titles.has(record.title)) return false;
    titles.add(record.title);
    return true;
  });
}

test("compound observation controls and hover preserve real dates, sources, and categorical status", () => {
  const html = renderCompoundPage(loaded);
  const months = new Map<string, number>();
  for (const record of loaded.leaf.leaflets) {
    const date = record.provenance?.observedAt.slice(0, 10) ?? "";
    const month = date.slice(0, 7) || "undated";
    months.set(month, (months.get(month) ?? 0) + 1);
    assert.ok(html.includes(`data-observed="${date}"`));
    assert.ok(html.includes(`data-month="${month}"`));
    assert.ok(html.includes(uiAttribute("data-source", record.provenance?.source ?? "Not recorded")));
  }
  assert.equal((html.match(/<template id="cx-tooltip-/g) ?? []).length, loaded.leaf.leaflets.length);
  assert.equal((html.match(/<template id="cx-record-/g) ?? []).length, loaded.leaf.leaflets.length);
  for (const [month, count] of months) {
    assert.ok(html.includes(`data-period="${month}"`));
    assert.ok(html.includes(`· ${count}</button>`));
  }
  assert.match(html, /id="cx-color-by" disabled><option value="source">Source<\/option>/);
  assert.match(html, /id="cx-tier-legend"[^>]*hidden/);
  assert.match(html, /<h2>Observed<\/h2>/);
});

test("compound connects only identical source-reference pairs and carries actual excerpts into hover", () => {
  const [first, second, third] = loaded.leaf.leaflets.filter(record => record.provenance);
  assert.ok(first?.provenance && second?.provenance && third?.provenance);
  // A controlled relationship probe using a real reference and real recorded words.
  const records: Leaflet[] = [first,
    { ...second, body: [{ provenance: first.provenance, text: first.title }] },
    { ...third, provenance: { ...first.provenance, source: "probe:distinct-source" } },
  ];
  const html = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: records } });
  const related = [...html.matchAll(/data-related="([^"]+)"/g)].map(match => JSON.parse(match[1]!));
  assert.deepEqual(related, [[1], [0], []]);
  assert.ok(html.includes(uiAttribute("data-excerpt", `${first.title.slice(0, 180)}${first.title.length > 180 ? "…" : ""}`)));
  assert.ok(html.includes(`data-related-index="1"`));
});

test("each connection explains its exact shared references and shows only the matching recorded context", () => {
  const [first, second, third] = distinctTextRecords();
  assert.ok(first?.provenance && second?.provenance && third?.provenance);
  // Controlled association of real recorded references/text; never saved as portfolio evidence.
  const records: Leaflet[] = [
    { ...first, body: [{ provenance: first.provenance, text: first.title }] },
    { ...second, body: [{ provenance: first.provenance, text: second.title }, { provenance: third.provenance, text: third.title }] },
  ];
  const html = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: records } });
  const selected = html.match(/<template id="cx-record-0">([\s\S]*?)<\/template>/)?.[1];
  assert.ok(selected);
  const connection = selected.match(/<details class="cx-evidence cx-shared-connection"[^>]*>([\s\S]*?)<\/details>/)?.[1];
  assert.ok(connection);
  assert.match(connection, /<summary><span class="fol-metric">1<\/span> shared reference<\/summary>/);
  assert.equal((connection.match(/class="cx-shared-reference"/g) ?? []).length, 1, "matching top-level and body evidence must not duplicate the same shared reference");
  assert.ok(connection.includes(`data-shared-source="${esc(first.provenance.source)}" data-shared-ref="${esc(first.provenance.ref)}"`));
  assert.ok(connection.includes(`<code>${esc(first.provenance.ref)}</code>`));
  assert.ok(connection.includes(`<p class="cx-excerpt" data-verbatim="body-element">${esc(first.title)}</p>`));
  assert.ok(connection.includes(`<p class="cx-excerpt" data-verbatim="body-element">${esc(second.title)}</p>`));
  assert.ok(!connection.includes(esc(third.title)), "unrelated body text must not be presented as support for this connection");
  for (const record of records) assert.ok(connection.includes(`href="${ownerLeafletHref(record.id)}"`));

  const fallback = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: records } }, { bundle: {
    ok: false, cause: "bundle-missing", reason: "Renderer unavailable.", remedy: "Reload after rebuilding.",
  } });
  assert.match(fallback, new RegExp(`<section class="cx-connections">[\\s\\S]*?<li><a href="${ownerLeafletHref(second.id)}" data-related-index="1"`));
  assert.doesNotMatch(fallback, /href="\/leaf\/explore\?leaflet=/);

  const refOnly = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: [first, { ...second, body: [{ provenance: first.provenance }] }] } });
  assert.match(refOnly, /<p class="cx-note">No text<\/p>/);
});

test("every connected Leaflet has an accessible evidence explanation, including connections beyond six", () => {
  const records = loaded.leaf.leaflets.filter(record => record.provenance).slice(0, 8);
  assert.equal(records.length, 8);
  const shared = records[0]!.provenance!;
  const linked = records.map(record => ({ ...record, body: [{ provenance: shared, text: record.title }] }));
  const html = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: linked } });
  const first = html.match(/<template id="cx-record-0">([\s\S]*?)<\/template>/)?.[1];
  assert.ok(first);
  assert.equal((first.match(/class="cx-evidence cx-shared-connection"/g) ?? []).length, 7);
  assert.match(first, /data-related-index="7"/);
  assert.doesNotMatch(first, /more connected Leaflets are highlighted/);
});

test("only pending private Leaflets offer story authoring and the record link names a Leaflet", () => {
  const actual = loaded.leaf.leaflets.find(record => record.provenance)!;
  assert.ok(actual?.provenance);
  const renderOne = (record: Leaflet) => renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: [record] } });
  const pending: Leaflet = { id: actual.id, title: actual.title, provenance: actual.provenance, tier: "pending" };
  assert.ok(renderOne(pending).includes(`href="/leaf/story?leaflet=${encodeURIComponent(pending.id)}"`));
  assert.match(renderOne({ ...pending, visibility: "private" }), />Tell the story<\/a>/);
  for (const record of [{ ...pending, visibility: "public" as const }, { ...pending, visibility: "unlisted" as const },
    { ...pending, tier: "verified" as const, provenance: actual.provenance },
    { ...pending, tier: "excluded" as const, reason: "Isolated attribution-state probe; no work is claimed." }]) {
    assert.doesNotMatch(renderOne(record), /\/leaf\/story\?/);
  }
  assert.match(renderOne(pending), />Open Leaflet<\/a>/);
  assert.doesNotMatch(renderOne(pending), /Open full artifact/);
});

test("recognized personal context leads the inspector after evidence refresh without exposing receipt JSON in the excerpt", () => {
  const [first, second, third] = distinctTextRecords();
  assert.ok(first?.provenance && second && third?.provenance);
  const pending: Leaflet = { id: first.id, title: first.title, tier: "pending", provenance: first.provenance,
    body: [{ provenance: third.provenance, text: third.title }] };
  const leaf = { ...loaded.leaf, leaflets: [pending] };
  // Real recorded words are submitted as isolated rendering input, not as a claimed career story.
  const written = applyLeafletStory(leaf, { leafId: leaf.id, leafletId: pending.id, revision: revisionDigest(pending) },
    [{ section: "problem", text: second.title, evidence: 0 }], leaf.subject, leaf.subject, first.provenance.observedAt);
  const saved = written.leaflets[0]!;
  const afterRefresh = { ...saved, body: [...pending.body!, ...saved.body!.filter(element => element.provenance.source.startsWith("subject:story/"))] };
  const html = renderCompoundPage({ ...loaded, leaf: { ...written, leaflets: [afterRefresh] } });
  const tooltip = html.match(/<template id="cx-tooltip-0">([\s\S]*?)<\/template>/)?.[1];
  assert.ok(tooltip);
  assert.ok(tooltip.includes(esc(`The problem: ${second.title}`.slice(0, 180))));
  assert.doesNotMatch(tooltip, /Supporting evidence:|Account recorded by:|&quot;source&quot;/);
  const selected = html.match(/<template id="cx-record-0">([\s\S]*?)<\/template>/)?.[1];
  assert.ok(selected);
  assert.match(selected, /<h4>The problem<\/h4>/);
  assert.ok(selected.indexOf(esc(second.title)) < selected.indexOf(esc(third.title)), "the personal account stays ahead of refreshed Git excerpts");
  assert.match(selected, /<summary>Source<\/summary>/);
  assert.ok(selected.includes(`<code>${esc(first.provenance.ref)}</code>`));
  assert.doesNotMatch(selected, /Supporting evidence: \{|&quot;source&quot;/);
});

test("undated and unavailable observations remain distinct instead of becoming an invented date or zero", () => {
  const first = loaded.leaf.leaflets[0]!;
  const undated: Leaflet = { id: first.id, title: first.title, tier: "pending" };
  const html = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: [undated] } });
  assert.match(html, /data-month="undated"/);
  assert.match(html, /value="undated">No observed date \(1\)/);
  assert.match(html, /role="status">No dates<\/p>/);
  assert.match(html, /<p class="cx-note">No context<\/p>/);
  const unavailable = renderCompoundPage({ ok: false, cause: "absent", path: "/missing", detail: "File missing" });
  assert.match(unavailable, /Dates unavailable/);
  assert.doesNotMatch(unavailable, /All · 0/);
});

test("a stale renderer presents linked records and detail without a blank stage or dead controls", () => {
  const html = renderCompoundPage(loaded, { bundle: {
    ok: false, cause: "bundle-stale", reason: 'Contract mismatch <script>alert("probe")</script>',
    remedy: "Rebuild the renderer and reload.",
  } });
  assert.match(html, /data-bundle-ready="false"/);
  assert.match(html, /href="\/compound-leaf.css"/);
  assert.doesNotMatch(html, /src="\/compound-leaf.bundle.js"/);
  assert.match(html, /Contract mismatch &lt;script&gt;/);
  assert.match(html, /Rebuild the renderer and reload/);
  assert.match(html, /<section class="cx-fallback" role="status" aria-labelledby="cx-fallback-heading">/);
  assert.match(html, /<section class="cx-inspector" aria-label="Retained records">/);
  assert.doesNotMatch(html, /class="cx-garden"|aria-label="Interactive compound leaf"/);
  for (const id of ["cx-stage", "cx-canvas", "cx-motion", "cx-reset", "cx-search", "cx-period", "cx-color-by"]) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /<template id="cx-record-|<template id="cx-tooltip-/);
  const list = html.match(/id="cx-list"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(list);
  for (const record of loaded.leaf.leaflets) assert.ok(list.includes(`href="${ownerLeafletHref(record.id)}"`));
  assert.doesNotMatch(list, /<button/);
  const first = loaded.leaf.leaflets[0]!;
  assert.ok(html.includes(`<h2>${esc(first.title)}</h2>`));
  assert.ok(html.includes(`href="${ownerLeafletHref(first.id)}"`));
  const ready = renderCompoundPage(loaded);
  assert.match(ready, /src="\/compound-leaf.bundle.js"/);
  assert.match(ready, /<aside class="cx-inspector" aria-label="Artifact explorer">/);
  assert.match(ready, /<canvas id="cx-canvas"/);
});

test("private assistance state reaches the selected detail and every refresh template", () => {
  const html = renderCompoundPage(loaded, { assistance: {
    localModelConfigured: false,
    ladybug: { connected: false, ready: false, model: null, detail: "Connection state probe: unavailable." },
  } });
  assert.equal((html.match(/<p>Connection state probe: unavailable\.<\/p>/g) ?? []).length, loaded.leaf.leaflets.length + 1);
  assert.equal((html.match(/<p>No local model<\/p>/g) ?? []).length, loaded.leaf.leaflets.length + 1);
  assert.match(html, /Scarlet <span>Cloud assessment/);
  assert.doesNotMatch(html, /Manual packet handoff/);
});

function placementAttributes(html: string) {
  return [...html.matchAll(/<(?:button|a)\b[^>]*data-index="\d+"[^>]*>/g)].map(([tag]) => {
    const attribute = (name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
    return { index: Number(attribute("data-index")), id: attribute("data-id"), highlight: attribute("data-highlight"),
      featuredOrder: Number(attribute("data-featured-order")), selected: attribute("aria-pressed") === "true" };
  });
}

test("the owner's leading record occupies the only terminal slot while later highlights use upper lateral slots", () => {
  const chosen = loaded.leaf.leaflets.filter(record => record.tier !== "excluded").slice(0, 12).reverse();
  assert.equal(chosen.length, 12, "real intake must provide records for the maximum owner selection");
  const html = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, curation: { featured: chosen.map(record => record.id) } } });
  const attributes = placementAttributes(html);
  assert.equal(attributes.length, loaded.leaf.leaflets.length);
  attributes.forEach((item, index) => {
    assert.equal(item.index, index);
    assert.equal(item.id, esc(loaded.leaf.leaflets[index]!.id), "curation must not reorder or duplicate document/relationship indices");
  });
  const leading = attributes.find(item => item.highlight === "leading")!;
  assert.equal(leading.id, esc(chosen[0]!.id));
  assert.equal(attributes.filter(item => item.selected).length, 1);
  assert.equal(leading.selected, true, "the initial inspector starts at the chosen leading record");
  const featured = attributes.filter(item => item.featuredOrder >= 0).sort((a, b) => a.featuredOrder - b.featuredOrder);
  assert.deepEqual(featured.map(item => item.id), chosen.map(record => esc(record.id)));
  const layout = compoundLayout(attributes.length, leading.index, featured.map(item => item.index));
  assert.equal(layout.terminal, leading.index);
  const lateral = layout.pinnae.flatMap(pinna => pinna.blades.map(blade => ({ index: blade.index, along: pinna.along })));
  assert.deepEqual([layout.terminal, ...lateral.map(blade => blade.index)].sort((a, b) => a - b), attributes.map(item => item.index), "every actual record has exactly one geometric blade");
  const highlighted = new Set(featured.map(item => item.index));
  const highlights = lateral.filter(blade => highlighted.has(blade.index));
  const other = lateral.filter(blade => !highlighted.has(blade.index));
  assert.equal(highlights.length, 11);
  assert.ok(Math.min(...highlights.map(blade => blade.along)) >= Math.max(...other.map(blade => blade.along)), "chosen lateral highlights are adjacent to the upper rachis, never scattered into lower groups");
  const tooltip = html.match(new RegExp(`<template id="cx-tooltip-${leading.index}">([\\s\\S]*?)<\\/template>`))?.[1];
  assert.match(tooltip!, /<p class="cx-highlight-label">Leading tip<\/p>/);
  assert.match(html, /<span class="cx-highlight-key" aria-hidden="true">◇<\/span> Highlight/);
  assert.match(html, /href="\/leaf\/curate"/);
  const notChosen = loaded.leaf.leaflets.find(record => record.tier !== "excluded" && !chosen.includes(record))!;
  assert.ok(notChosen);
  assert.ok(html.includes(`href="/leaf/curate?leaflet=${encodeURIComponent(notChosen.id)}"`));
});

test("an unavailable or excluded saved first choice never promotes another highlight into the tip", () => {
  const [first, second] = loaded.leaf.leaflets.filter(record => record.tier !== "excluded");
  assert.ok(first && second);
  const excluded: Leaflet = { ...first, tier: "excluded", reason: "Isolated state probe: attribution withdrawn." };
  for (const records of [loaded.leaf.leaflets.filter(record => record.id !== first.id),
    loaded.leaf.leaflets.map(record => record.id === first.id ? excluded : record)]) {
    const html = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: records, curation: { featured: [first.id, second.id] } } });
    const attributes = placementAttributes(html);
    assert.equal(attributes.filter(item => item.highlight === "leading").length, 0);
    assert.equal(attributes.find(item => item.id === esc(second.id))?.highlight, "featured");
    assert.match(html, /Leading tip unavailable/);
    assert.match(html, /Some saved choices are unavailable/);
    const selected = attributes.filter(item => item.featuredOrder >= 0).map(item => item.index);
    const layout = compoundLayout(records.length, -1, selected);
    assert.equal(layout.terminal, -1);
    assert.equal(layout.pinnae.flatMap(pinna => pinna.blades).length, records.length);
  }
});

test("no choices creates no implied terminal highlight and a single chosen record is never duplicated", () => {
  const plain = renderCompoundPage(loaded);
  assert.match(plain, /No leading highlight chosen/);
  assert.equal(placementAttributes(plain).filter(item => item.highlight).length, 0);
  const ordinary = compoundLayout(loaded.leaf.leaflets.length, -1, []);
  assert.equal(ordinary.terminal, -1);
  assert.deepEqual(ordinary.pinnae.flatMap(pinna => pinna.blades.map(blade => blade.index)), loaded.leaf.leaflets.map((_, index) => index));
  const actual = loaded.leaf.leaflets.find(record => record.tier !== "excluded")!;
  const one = renderCompoundPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: [actual], curation: { featured: [actual.id] } } });
  assert.equal(placementAttributes(one).length, 1);
  assert.deepEqual(compoundLayout(1, 0, [0]), { terminal: 0, pinnae: [] });
  assert.deepEqual(compoundLayout(0, -1, []), { terminal: -1, pinnae: [] });
});
