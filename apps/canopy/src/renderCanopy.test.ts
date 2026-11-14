/**
 * `GET /` — THE FRONT DOOR THAT USED TO 404.
 *
 * A first-run public page keeps its launch content and a calm unpublished state. A loaded
 * tree names the company, links into `/tree`, and counts only leaves the loader read.
 *
 * No git, no signing: this page counts leaves loaded, not leaflets or tiers, so a minimal but
 * genuinely valid leaf document (the same shape `treeDocument.test.ts` uses) is enough.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";

import { renderCanopyPage, renderIndividualsPage, renderOrganizationsPage } from "./renderCanopy.ts";
import { TREE_ENV, loadTreeDocument } from "./treeDocument.ts";

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-canopy-front-door-"));
  tmpRoots.push(dir);
  return dir;
}

/** A minimal but genuinely valid leaf document — same shape `treeDocument.test.ts` builds. */
function leafDoc(id: string, subject: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ id, subject, leaflets: [], ...extra }, null, 2);
}

/** Write a manifest plus its leaves, and return the manifest path. */
async function fixture(
  files: Readonly<Record<string, string>>,
  manifest: unknown,
): Promise<string> {
  const dir = await tempDir();
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  const path = join(dir, "tree.json");
  await writeFile(path, typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2));
  return path;
}

/* ==========================================================================================
   1. LOAD FAILURES STILL GET A LANDING PAGE.
   ========================================================================================== */

test("theUnconfiguredFrontDoorStillRendersTheLaunchPage", async () => {
  for (const env of [{}, { [TREE_ENV]: "   " }] as const) {
    const load = await loadTreeDocument(env);
    assert.equal(load.ok, false);
    assert.equal(load.ok === false && load.cause, "unconfigured");
    const html = renderCanopyPage(load);
    assert.match(html, /data-canopy-surface="canopy"/);
    assert.match(html, /data-canopy-state="unconfigured"/);
    assert.match(html, /Explore work people chose to share\./);
    assert.match(html, /No tree published yet/);
    assert.doesNotMatch(html, /FOLIAGE_TREE|launch-empty|i-alert/);
    assert.match(html, /Try the demo/);
    assert.doesNotMatch(html, /href="\/tree">View tree<\/a>/);
  }
});

test("everyOtherLoadFailureIsNamedOnTheLaunchPage", async () => {
  // absent: a path nothing is at.
  const dir = await tempDir();
  const absent = await loadTreeDocument({ [TREE_ENV]: join(dir, "nowhere.json") });
  assert.equal(absent.ok, false);
  assert.equal(absent.ok === false && absent.cause, "absent");
  assert.match(renderCanopyPage(absent), /data-canopy-state="absent"/);
  assert.match(renderCanopyPage(absent), /Tree manifest not found/);

  // malformed: not JSON at all.
  const badPath = join(dir, "not-json.txt");
  await writeFile(badPath, "{ this is not json");
  const malformed = await loadTreeDocument({ [TREE_ENV]: badPath });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.ok === false && malformed.cause, "malformed");
  assert.match(renderCanopyPage(malformed), /data-canopy-state="malformed"/);
  assert.match(renderCanopyPage(malformed), /Tree manifest is not valid JSON/);

  // invalid: valid JSON, not a tree manifest.
  const invalidPath = join(dir, "invalid.json");
  await writeFile(invalidPath, JSON.stringify({ nope: true }));
  const invalid = await loadTreeDocument({ [TREE_ENV]: invalidPath });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.ok === false && invalid.cause, "invalid");
  assert.match(renderCanopyPage(invalid), /data-canopy-state="invalid"/);
  assert.match(renderCanopyPage(invalid), /Not a tree manifest/);
});

/* ==========================================================================================
   2. A LOADED TREE — the front door's own content.
   ========================================================================================== */

test("theFrontDoorNamesTheRealCompanyAndLinksToItWithTheDomainsOwnCount", async () => {
  const manifestPath = await fixture(
    {
      "a.leaf.json": leafDoc("a", "Ada Example"),
      "b.leaf.json": leafDoc("b", "Rey Example"),
    },
    { id: "northwind", company: "Northwind Instruments", leaves: ["a.leaf.json", "b.leaf.json"] },
  );
  const load = await loadTreeDocument({ [TREE_ENV]: manifestPath });
  assert.equal(load.ok, true);

  const html = renderCanopyPage(load);

  // day face, the surface hook, and NOT the tree page's own state attribute.
  assert.match(html, /<html lang="en" data-face="day">/);
  assert.match(html, /data-canopy-surface="canopy"/);
  assert.match(html, /data-canopy-state="ok"/);
  assert.doesNotMatch(html, /data-tree-state=/, "the front door must not wear /tree's own hook");

  // the company is named, and the ONLY link to it is the real, working /tree address.
  assert.match(html, new RegExp(`<a href="/tree">Northwind Instruments</a>`));
  assert.match(html, /href="\/tree">View tree<\/a>/);

  // the ONE figure this page may print about the tree: canopySize's own leaves-loaded count.
  assert.match(html, /data-count="leaves"[^>]*><span class="fol-label">Leaves loaded<\/span><b class="fol-metric">2<\/b>/);

  /*
   * The manifest is NAMED — same idiom as every other source footer on this app, which is what
   * this assertion has always been for: the page says where its bytes came from.
   *
   * IT USED TO ASSERT THE WHOLE PATH, and that is the half F-031 changed. The front door is the
   * first page a stranger reaches, and on a real install `manifestPath` reads `/Users/<name>/…` —
   * the operator's username and home layout, published to every visitor. The provenance this
   * assertion protects belongs to the DOCUMENT, and a document is identified by its name; the
   * directories above it are the machine's business. So the assertion is STRENGTHENED rather than
   * relaxed: the name must be present AND the path must be absent, which is a claim the old form
   * never made.
   */
  assert.ok(html.includes(basename(manifestPath)), "the manifest this page read from is not named");
  assert.equal(
    html.includes(dirname(manifestPath)),
    false,
    "the front door publishes the operator's filesystem layout to every visitor",
  );
});

test("aTreeConfiguredWithNoLeavesYetRendersARealZeroNotAFabricatedOne", async () => {
  const manifestPath = await fixture({}, { id: "new-co", company: "Newly Incorporated", leaves: [] });
  const load = await loadTreeDocument({ [TREE_ENV]: manifestPath });
  assert.equal(load.ok, true);

  const html = renderCanopyPage(load);
  assert.match(html, /<a href="\/tree">Newly Incorporated<\/a>/);
  assert.match(html, /data-count="leaves"[^>]*><span class="fol-label">Leaves loaded<\/span><b class="fol-metric">0<\/b>/);
});

test("theFabricationBandCarriesOverFromTheManifestsOwnDeclaration", async () => {
  const manifestPath = await fixture(
    { "x.leaf.json": leafDoc("x", "Illustration") },
    { id: "t", company: "Example Co", leaves: ["x.leaf.json"], example: true },
  );
  const load = await loadTreeDocument({ [TREE_ENV]: manifestPath });
  assert.equal(load.ok, true);

  const html = renderCanopyPage(load);
  assert.match(html, /data-fabricated="true"/);
  assert.match(html, /Example tree — not a real company/);
});

test("theLandingPageStatesTheProductAndNothingAboutWhereItRuns", async () => {
  const manifestPath = await fixture(
    { "a.leaf.json": leafDoc("a", "Ada Example") },
    { id: "t", company: "T", leaves: ["a.leaf.json"] },
  );
  const load = await loadTreeDocument({ [TREE_ENV]: manifestPath });
  assert.equal(load.ok, true);
  const html = renderCanopyPage(load);

  assert.match(html, /Explore work people chose to share\./);

  /*
   * AND IT SAYS NOTHING ABOUT WHERE IT RUNS. This page shipped for months opening with "This
   * canopy is running loopback/local today … on this machine" — two claims about deployment
   * topology, true only while nothing was deployed, in the served bytes of the first page a
   * stranger reaches. Found by booting the real server and grepping `/`.
   *
   * Asserted as an ABSENCE over the whole document, not as a match on the replacement sentence,
   * because the defect is a category: any future copy that tells a reader which machine, port or
   * host this is running on is the same mistake wearing different words. The page may say what a
   * canopy DOES; where it runs is not its to know, and on a deployment it would be wrong.
   */
  for (const topology of [/running loopback/i, /on this machine/i, /localhost/i, /127\.0\.0\.1/]) {
    assert.doesNotMatch(
      html,
      topology,
      `the front door tells its readers where it is running (${topology}) — true on a laptop, ` +
        `false the moment this is served from anywhere else, and this is the page strangers land on`,
    );
  }
});

test("theAudienceLandingPagesRenderFromTheSamePublicShell", () => {
  const individuals = renderIndividualsPage();
  assert.match(individuals, /data-canopy-surface="individuals"/);
  assert.match(individuals, /class="magic-blur-fade"/);
  assert.match(individuals, /For individuals/);
  assert.match(individuals, /Your Leaf is a live portfolio/);

  const organizations = renderOrganizationsPage();
  assert.match(organizations, /data-canopy-surface="organizations"/);
  assert.match(organizations, /class="magic-blur-fade"/);
  assert.match(organizations, /For organizations/);
  assert.match(organizations, /A Tree publishes people/);
});

test("noScoreShapedWordAppearsAnywhereOnTheFrontDoor", async () => {
  const manifestPath = await fixture(
    { "a.leaf.json": leafDoc("a", "Ada Example") },
    { id: "t", company: "T", leaves: ["a.leaf.json"] },
  );
  const load = await loadTreeDocument({ [TREE_ENV]: manifestPath });
  assert.equal(load.ok, true);
  const html = renderCanopyPage(load).toLowerCase();

  for (const word of ["score", "rating", "rank", "grade", "percentile", "out of"]) {
    assert.ok(!html.includes(word), `the front door contains "${word}"`);
  }
});
