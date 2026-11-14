/** The private reading surface over real intake; controlled media/context probes below are
 * never written into a person's document or reported as real achievements. */
import assert from "node:assert/strict";
import { testRepository } from "../../../tools/development/testRepository.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Leaflet } from "@foliage/leaf";
import { loadLeafDocument, type LeafLoad } from "./leafDocument.ts";
import { revisionDigest } from "./leafletRevision.ts";
import { applyLeafletStory, storyEvidence } from "./leafletStory.ts";
import { esc, findLeaflet, ownerLeafletHref, renderLeafletPage, renderLeafPage } from "./render.ts";
import { renderPresentation } from "./portfolioPresentation.ts";
import { loadPortfolioWorkDates } from "./portfolioWorkDates.ts";
import { canTellStory } from "./leafletStory.ts";
import { renderWorkWorkspace } from "./workWorkspace.ts";

const exec = promisify(execFile);
const policy = { rules: [] };
const repo = testRepository();
let directory: string;
let loaded: Extract<LeafLoad, { ok: true }>;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "foliage-private-reading-"));
  const { stdout } = await exec("git", ["-C", repo, "log", "-1", "--format=%ae%n%an"]);
  const [identity, subject] = stdout.trim().split("\n");
  assert.ok(identity && subject);
  const path = join(directory, "leaf.json");
  await exec(process.execPath, [fileURLToPath(new URL("../intake.mjs", import.meta.url)), "--repo", repo, "--identity", identity, "--subject", subject, "--out", path]);
  const result = await loadLeafDocument({ FOLIAGE_LEAF: path });
  assert.ok(result.ok);
  loaded = result;
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("private reading separates raw Git evidence from portfolio stories and keeps exclusions in accounting", () => {
  const html = renderLeafPage(loaded, policy, "private");
  const source = renderLeafPage(loaded, policy, "private", { records: "source" });
  const expected = loaded.leaf.leaflets.filter(record => record.tier !== "excluded");
  const cards = [...html.matchAll(/data-record-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(cards, [], "intake titles alone cannot become portfolio stories");
  const sourceRows = [...source.matchAll(/data-record-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(sourceRows, expected.slice(0, 12).map(record => esc(record.id)));
  for (const record of expected.slice(0, 12)) {
    assert.ok(source.includes(`href="${ownerLeafletHref(record.id)}"`));
  }
  assert.match(source, /rel="next" href="[^"]*page=2#leaf-highlights"/);
  for (const record of loaded.leaf.leaflets.filter(record => record.tier === "excluded")) {
    assert.ok(!source.includes(`data-record-id="${esc(record.id)}"`));
    assert.ok(html.includes(esc(record.reason)));
  }
  assert.match(html, /id="source-preview-heading">No selected work yet</);
  assert.match(html, /Browse source records/);
  assert.doesNotMatch(html, /class="lp-source-record"/, "source rows belong under Source records, not Selected work");
  assert.match(html, /data-source-only="true"/);
  assert.match(html, /aria-current="page">Selected work <span class="fol-metric">0<\/span>/,
    "zero describes selected stories, not the owner's total work");
  assert.doesNotMatch(html, /No Leaflets|No work stories yet/);
  assert.match(source, /class="lp-source-archive"/);
  assert.doesNotMatch(html, /class="lp-person-(?:headline|bio)"/);
  assert.ok(!html.includes(esc(loaded.source.path)), "the reading surface must not expose local document diagnostics");
  assert.doesNotMatch(html, /class="leaf-source personal-source"/);
  assert.match(html, /href="\/review"[^>]*>Review<\/a>/, "the workspace keeps Review available");
});

test("owner-authored context and link-shared Git work stay in Work", () => {
  const [publicRecord, unlistedRecord, writtenRecord] = loaded.leaf.leaflets.filter(record => record.tier !== "excluded" && record.provenance?.source === "git");
  assert.ok(publicRecord?.provenance && unlistedRecord?.provenance && writtenRecord?.provenance);
  const leaf = { ...loaded.leaf, leaflets: loaded.leaf.leaflets.map(record =>
    record.id === publicRecord.id ? { ...record, visibility: "public" as const }
      : record.id === unlistedRecord.id ? { ...record, visibility: "unlisted" as const }
        : record.id === writtenRecord.id ? { ...record, body: [{ text: record.title, provenance: writtenRecord.provenance! }] }
          : record) };
  const view = { ...loaded, leaf };
  const work = renderLeafPage(view, policy, "private");
  const source = renderLeafPage(view, policy, "private", { records: "source" });
  for (const record of [publicRecord, unlistedRecord, writtenRecord]) {
    assert.ok(work.includes(`data-record-id="${esc(record.id)}"`));
    assert.ok(!source.includes(`data-record-id="${esc(record.id)}"`));
  }
  assert.equal(renderLeafPage(view, policy, "published", { records: "source" }), renderLeafPage(view, policy, "published"));
});

test("a person's story is shown as their account and never counted as its own Evidence", () => {
  const record = loaded.leaf.leaflets.find(item => item.tier === "pending" && item.provenance?.source === "git" && !item.body?.length);
  assert.ok(record?.provenance);
  // Two sections of protocol input over one real retained reference; no achievement is claimed.
  const at = new Date().toISOString();
  const written = applyLeafletStory(loaded.leaf, { leafId: loaded.leaf.id, leafletId: record.id, revision: revisionDigest(record) }, [
    { section: "problem", text: "Evidence-count protocol probe: why the retained reference mattered.", evidence: 0 },
    { section: "contribution", text: "Evidence-count protocol probe: this account adds no evidence of its own.", evidence: 0 },
  ], "Evidence-count protocol", loaded.leaf.subject, at);
  const saved = written.leaflets.find(item => item.id === record.id)!;
  assert.equal(saved.body?.length, 2);
  assert.deepEqual(storyEvidence(saved), [record.provenance]);
  const html = renderLeafPage({ ...loaded, leaf: written }, policy, "private");
  const start = html.indexOf(`data-record-id="${esc(record.id)}"`);
  assert.ok(start >= 0, "a record with a story is selected work");
  const card = html.slice(start, html.indexOf("</article></li>", start));
  assert.match(card, /lp-story-label">The problem</);
  assert.match(card, /lp-story-label">My contribution</);
  const evidence = card.slice(card.indexOf("data-portfolio-evidence"), card.indexOf('<div class="lp-actions">'));
  assert.match(evidence, /<span>Evidence <span class="fol-metric">1<\/span><\/span>/, "the card counts the Git reference, not the two story paragraphs");
  assert.equal(evidence.match(/<dl class="leaf-prov">/g)?.length, 1);
  assert.doesNotMatch(evidence, /subject:story\//);

  const shared = { ...written, leaflets: written.leaflets.map(item => item.id === record.id ? { ...item, visibility: "public" as const } : item) };
  const row = renderLeafPage({ ...loaded, leaf: shared }, policy, "published");
  const rowEvidence = row.match(/<details class="leaf-row-evidence">[\s\S]*?<\/summary>/)?.[0];
  assert.ok(rowEvidence);
  assert.ok(rowEvidence.includes(`>${esc(record.provenance.ref.slice(0, 7))}</span>`), "one supporting reference, named by its short ref");
  assert.doesNotMatch(row, /subject:story\//);
  const leafletPage = renderLeafletPage(findLeaflet(shared, record.id, policy), loaded.source);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(at));
  assert.equal(leafletPage.split(`Recorded by <span data-verbatim="body-element">Evidence-count protocol</span> on <time class="fol-metric" datetime="${at}">${day}</time>.`).length, 3,
    "each public section names its recorder with a readable day");
  assert.ok(!leafletPage.includes(`>${at}<`), "the recorded instant stays machine-readable only");
});

test("saved context and real image references become previews without remote embeds", async () => {
  const record = loaded.leaf.leaflets.find(item => item.tier !== "excluded" && item.provenance)!;
  assert.ok(record?.provenance);
  const image = new URL("../../canopy/public/specimen-sheet-day.jpg", import.meta.url);
  const digest = `sha256:${createHash("sha256").update(await readFile(image)).digest("hex")}`;
  const probe: Leaflet = { ...record, body: [
    { text: record.title, provenance: record.provenance },
    { text: 'Caption probe <script>alert("probe")</script>', provenance: { source: "renderer-media-probe", ref: digest, observedAt: (await stat(image)).mtime.toISOString() }, media: { mediaType: "image/jpeg", dimensions: { known: false, why: "Dimensions were not measured for this renderer probe." } } },
  ] };
  const html = renderLeafPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: [probe] } }, policy, "private");
  assert.match(html, /data-verbatim="body-element"/);
  assert.ok(html.includes(`src="/my/media/${digest}"`));
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.ok(html.includes("Caption probe &lt;script&gt;"));
  assert.doesNotMatch(html, /<img[^>]+src="https?:/);
  const withMedia = { ...loaded, leaf: { ...loaded.leaf, leaflets: [record, { ...probe, id: "media-probe" as Leaflet["id"] }], collections: [{ id: "no-media", title: "Text only", kind: "body-of-work" as const, achievements: [], leaflets: [record.id] }] } };
  const preview = renderPresentation(withMedia, new URLSearchParams("edit=style"));
  assert.ok(preview.includes(`src="/my/media/${digest}"`));
  assert.match(preview, /alt="Caption probe &lt;script&gt;/);
  assert.match(preview, /data-media-unavailable hidden role="status"/);
  const scoped = renderPresentation(withMedia, new URLSearchParams("edit=style&collection=no-media"));
  assert.ok(!scoped.includes(`src="/my/media/${digest}"`));
  assert.match(scoped, /<p class="lp-empty-context">No image<\/p>/);

});

test("freshness and polling opt in only on the private reading route and preserve the replacement boundary", () => {
  const options = { freshnessHtml: '<p data-server-freshness="true">Server status probe</p>', freshnessRevision: 'revision"probe', enhancePortfolio: true };
  const html = renderLeafPage(loaded, policy, "private", options);
  assert.match(html, /id="personal-portfolio"[^>]+data-portfolio-revision="sha256:/);
  assert.match(html, /id="portfolio-freshness"[^>]+data-revision="revision&quot;probe"/);
  assert.match(html, /src="\/portfolio-reader.mjs"/);
  assert.ok(html.includes('</div><p id="portfolio-sync"'));
  assert.doesNotMatch(renderLeafPage(loaded, policy, "private"), /src="\/portfolio-reader.mjs"/);
  const published = renderLeafPage(loaded, policy, "published", options);
  assert.equal(published, renderLeafPage(loaded, policy, "published"));
  assert.doesNotMatch(published, /Server status probe|personal-portfolio|portfolio-reader.mjs|\/my\/media\//);
});

test("source labels remain literal text when a source contains markup", () => {
  const record = loaded.leaf.leaflets.find(item => item.tier !== "excluded" && item.provenance);
  assert.ok(record?.provenance);
  // This untrusted source-label probe is in memory only; it makes no claim about real work.
  const source = "<a source-label-escaping-probe";
  const probe = { ...record, provenance: { ...record.provenance, source } };
  const html = renderLeafPage({ ...loaded, leaf: { ...loaded.leaf, leaflets: [probe] } }, policy, "private");
  assert.match(html, /class="lp-source"[^>]*>[\s\S]*?&lt;a source-label-escaping-probe<\/span>/);
  assert.ok(html.includes(esc(source)), "the original source label must remain readable");
  assert.doesNotMatch(html, /<A<\/span>|<a source-label-escaping-probe/);
});

test("notable mode retains the real reason that local work dates are unavailable", async () => {
  const workDates = await loadPortfolioWorkDates(loaded.leaf, {});
  assert.equal(workDates.status, "unconfigured");
  assert.ok(workDates.reason);
  const html = renderLeafPage(loaded, policy, "private", { order: "notable", workDates, records: "source" });
  const disclosure = html.match(/<details\b[^>]*id="portfolio-date-context"[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(disclosure, "switching to a timeline without navigation must still expose the lookup failure");
  assert.ok(disclosure.includes(esc(workDates.reason)));
  assert.doesNotMatch(disclosure.slice(0, disclosure.indexOf(">")), /\bhidden\b/);
  assert.match(html, /data-date="" data-date-kind="observed"/);
});

test("partial actual Git coverage says latest known and keeps source dates distinct from observations", async () => {
  const [record, supporting] = loaded.leaf.leaflets.filter(item => item.tier !== "excluded" && item.provenance?.source === "git");
  assert.ok(record?.provenance && supporting?.provenance);
  assert.notEqual(record.provenance.ref, supporting.provenance.ref);
  // Group two real retained references only for the renderer protocol. A shallow clone contains
  // one of those objects, so the missing date and the fallback reason come from a real Git read.
  const grouped = { ...loaded.leaf, leaflets: [{ ...record, body: [
    ...(record.body ?? []), { text: supporting.title, provenance: supporting.provenance },
  ] }] };
  const shallow = join(directory, "partial-date-source");
  await mkdir(shallow);
  await exec("git", ["-C", shallow, "init", "--initial-branch=main"]);
  await exec("git", ["-C", shallow, "fetch", "--no-tags", "--depth=1", repo, record.provenance.ref]);
  await exec("git", ["-C", shallow, "checkout", "--detach", "FETCH_HEAD"]);
  const workDates = await loadPortfolioWorkDates(grouped, { FOLIAGE_SOURCE_REPO: shallow });
  assert.equal(workDates.status, "partial");
  assert.equal(workDates.resolved, 1);
  const known = workDates.dates.get(record.provenance.ref);
  assert.ok(known);
  assert.equal(workDates.dates.has(supporting.provenance.ref), false);
  const html = renderLeafPage({ ...loaded, leaf: grouped }, policy, "private", { order: "newest", workDates });
  assert.match(html, /<span>Latest known<\/span><time class="fol-metric" aria-label="Latest known Git author date"/);
  assert.doesNotMatch(html, /aria-label="Git author date"/);
  assert.match(html, /Some Git dates unreadable/);
  assert.ok(html.includes(`data-date="${esc(known.authoredAt)}"`));
  assert.ok(html.includes(`datetime="${esc(record.provenance.observedAt)}"`));
  assert.ok(html.includes(esc(workDates.reason!)));
});

test("keyboard focus targets stay unique and stable when real work is reordered", async () => {
  const workDates = await loadPortfolioWorkDates(loaded.leaf, { FOLIAGE_SOURCE_REPO: repo });
  const selected = loaded.leaf.leaflets.filter(record => record.tier !== "excluded").slice(0, 25);
  const view = { ...loaded, leaf: { ...loaded.leaf, collections: [{ id: "focus-work", title: "Focus work", kind: "body-of-work" as const, achievements: [], leaflets: selected.map(record => record.id) }] } };
  const expected = selected;
  const targets = (html: string) => [...html.matchAll(/<button\b[^>]*data-focus-leaflet="true"[^>]*>/g)].map(match => {
    const id = match[0].match(/\bid="([^"]+)"/)?.[1];
    assert.ok(id, "a focused Locate button needs an identity to survive the reader's replacement boundary");
    return id;
  });
  const pages = Math.ceil(expected.length / 12);
  const allTargets = (order: "notable" | "oldest") => Array.from({ length: pages }, (_, index) =>
    targets(renderLeafPage(view, policy, "private", { order, collection: "focus-work", workDates, page: index + 1 }))).flat();
  const first = allTargets("notable"), second = allTargets("oldest");
  assert.equal(first.length, expected.length);
  assert.equal(new Set(first).size, expected.length);
  assert.deepEqual([...first].sort(), [...second].sort());
  for (const record of expected) assert.ok(first.includes(`portfolio-focus-${esc(encodeURIComponent(record.id))}`));
  for (const html of [renderLeafPage(view, policy, "private", { order: "notable", collection: "focus-work", workDates }), renderLeafPage(view, policy, "private", { order: "oldest", collection: "focus-work", workDates })]) {
    assert.equal([...html.matchAll(/\bid="portfolio-apply"/g)].length, 1);
    assert.match(html, /<button\b[^>]*id="portfolio-apply"[^>]*>Apply<\/button>/);
  }
});

test("empty Selected work says a told story adds work, and source rows offer Tell story exactly where Work does", () => {
  const [first, second] = loaded.leaf.leaflets.filter(record => record.tier !== "excluded");
  assert.ok(first && second && canTellStory(first));
  // A verified row is an in-memory gate probe, not an attribution: it stays a source record
  // that no story form will accept, so neither page offers one for it.
  const view = { ...loaded, leaf: { ...loaded.leaf, leaflets: loaded.leaf.leaflets.map(record => record.id === second.id ? { ...record, tier: "verified" } as Leaflet : record) } };
  const prompt = renderLeafPage(view, policy, "private").match(/<section class="lp-source-preview"[\s\S]*?<\/section>/)?.[0];
  assert.ok(prompt);
  assert.match(prompt, /No selected work yet<\/h2><p>Tell a record's story to add it here\.<\/p>/);
  assert.match(prompt, /<a href="\/leaf\/photosynthesis\?view=records">Choose a record to tell its story<\/a>/, "named for what it does: it opens Work's records, where each row has its own Tell story");
  assert.match(prompt, /Browse source records/);

  const source = renderLeafPage(view, policy, "private", { records: "source" });
  const work = renderWorkWorkspace(view, { ok: false, cause: "absent", detail: "No review queue", path: join(directory, "absent-harvest.json") },
    { marks: new Map(), retry: new Set<string>(), paused: false }, new URLSearchParams("view=records"));
  const rows = [...source.matchAll(/<li class="lp-source-record"[\s\S]*?<\/li>/g)].map(match => match[0]);
  assert.equal(rows.length, 12);
  for (const row of rows) {
    const record = view.leaf.leaflets.find(item => row.includes(`data-record-id="${esc(item.id)}"`));
    assert.ok(record);
    const story = `href="/leaf/story?leaflet=${encodeURIComponent(record.id)}"`;
    assert.equal(row.includes(story), canTellStory(record), `${record.id}: the story rule decides`);
    if (row.includes(story)) assert.ok(row.includes(`${story} aria-label="Tell story: ${esc(record.title)}">Tell story</a>`));
    assert.ok(work.includes(`href="${ownerLeafletHref(record.id)}"`), "Work lists the same record");
    assert.equal(work.includes(story), row.includes(story), `${record.id}: Work and Portfolio agree`);
  }
  assert.ok(rows.some(row => row.includes(`data-record-id="${esc(second.id)}"`) && !row.includes("Tell story")));
});

test("with no source record that can take a story, the empty prompt offers none", () => {
  // In-memory gate probe over real intake: every row verified, so no story form would accept one.
  const view = { ...loaded, leaf: { ...loaded.leaf, leaflets: loaded.leaf.leaflets.map(record => record.tier === "pending" ? { ...record, tier: "verified" } as Leaflet : record) } };
  const html = renderLeafPage(view, policy, "private");
  assert.match(html, /id="source-preview-heading">No selected work yet</);
  assert.match(html, /Browse source records/);
  assert.doesNotMatch(html, /Choose a record|Tell a record|\/leaf\/story\?/);
  assert.doesNotMatch(renderLeafPage(view, policy, "private", { records: "source" }), /\/leaf\/story\?/);
});
