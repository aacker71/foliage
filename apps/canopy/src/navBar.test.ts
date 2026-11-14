/**
 * THE `.fol-nav` SHELL, ON EVERY PUBLIC CANOPY SURFACE, AND NOWHERE ELSE.
 *
 * `@foliage/tokens/foliage.css` ships `.fol-nav` as the one app-shell component every real page
 * in this repository draws its nav bar from (`packages/foliage-tokens/src/shell.html` is the
 * reference). This file pins two things about how `apps/canopy` uses it:
 *
 *   1. It appears, unmodified, on every public shell surface this app serves — `/`,
 *      `/individuals`, `/organizations`, `/tree`, `/demo`, `/leaf/<id>`, `/leaflet/<id>` — with
 *      the launch nav in the same order and `aria-current="page"` on whichever item names the
 *      surface actually being viewed (neither, on a leaf or a leaflet page — those are reached BY
 *      NAME, not by a nav item of their own).
 *   2. The plane badge reads the SAME thing everywhere: this whole app is the published, public
 *      plane, and there is no night-faced surface in it.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { renderCanopyPage, renderIndividualsPage, renderOrganizationsPage } from "./renderCanopy.ts";
import { renderDemoPage } from "./renderDemo.ts";
import { renderTreePage } from "./renderTree.ts";
import {
  renderPublicLeafPage,
  renderPublicLeafletPage,
  resolvePublicLeaf,
  resolvePublicLeaflet,
} from "./renderPublic.ts";
import { TREE_ENV, loadTreeDocument } from "./treeDocument.ts";


const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "foliage-canopy-nav-"));
  tmpRoots.push(dir);
  return dir;
}

/** One real, loadable, empty-but-valid tree — every fixture below only needs the tree to load. */
async function emptyTree() {
  const dir = await tempDir();
  const path = join(dir, "tree.json");
  await writeFile(path, JSON.stringify({ id: "t", company: "T", leaves: [] }, null, 2));
  const load = await loadTreeDocument({ [TREE_ENV]: path });
  assert.equal(load.ok, true);
  return load;
}

/** The exact `<header class="fol-nav">…</header>` block, so nothing outside it leaks in. */
function navOf(html: string): string {
  const start = html.indexOf('<header class="fol-nav">');
  assert.ok(start > -1, "no .fol-nav header on this page at all");
  const end = html.indexOf("</header>", start);
  assert.ok(end > -1, ".fol-nav header is never closed");
  return html.slice(start, end);
}

test("allPublicShellSurfacesCarryTheIdenticalNavShapeWithTheRightItemCurrent", async () => {
  const load = await emptyTree();

  const canopy = navOf(renderCanopyPage(load));
  const individuals = navOf(renderIndividualsPage());
  const organizations = navOf(renderOrganizationsPage());
  const tree = navOf(renderTreePage(load));
  const demo = navOf(renderDemoPage({ work: "" }));
  const leaf = navOf(renderPublicLeafPage(resolvePublicLeaf(load, "nobody")));
  const leaflet = navOf(renderPublicLeafletPage(resolvePublicLeaflet(load, "nothing", null)));

  // Exactly the launch nav items, everywhere, in the same order.
  for (const nav of [canopy, individuals, organizations, tree, demo, leaf, leaflet]) {
    const items = [...nav.matchAll(/<li><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/li>/g)].map((m) => [
      m[1],
      m[2],
    ]);
    assert.deepEqual(items, [
      ["/", "Canopy"],
      ["/individuals", "Individuals"],
      ["/organizations", "Organizations"],
      ["/tree", "Tree"],
      ["/demo", "Demo"],
    ]);
  }

  // aria-current lands on exactly the surface being viewed, and on neither item for leaf/leaflet.
  assert.match(canopy, /<a href="\/" aria-current="page">Canopy<\/a>/);
  assert.doesNotMatch(canopy, /<a href="\/tree" aria-current="page">/);

  assert.match(individuals, /<a href="\/individuals" aria-current="page">Individuals<\/a>/);
  assert.match(organizations, /<a href="\/organizations" aria-current="page">Organizations<\/a>/);
  assert.match(tree, /<a href="\/tree" aria-current="page">Tree<\/a>/);
  assert.doesNotMatch(tree, /<a href="\/" aria-current="page">/);
  assert.match(demo, /<a href="\/demo" aria-current="page">Demo<\/a>/);

  for (const nav of [leaf, leaflet]) {
    assert.doesNotMatch(nav, /aria-current="page"/, "a leaf/leaflet page must not claim to be Canopy or Tree");
  }

  // The brand always goes home, and carries the one mark on the page.
  for (const nav of [canopy, individuals, organizations, tree, demo, leaf, leaflet]) {
    assert.match(nav, /<a class="fol-nav-brand" href="\/">/);
  }
});

test("thePlaneBadgeNamesThePublicViewWithoutClaimingAnEmptyRouteIsPublished", async () => {
  const load = await emptyTree();
  for (const html of [
    renderCanopyPage(load),
    renderIndividualsPage(),
    renderOrganizationsPage(),
    renderTreePage(load),
    renderDemoPage({ work: "" }),
    renderPublicLeafPage(resolvePublicLeaf(load, "nobody")),
    renderPublicLeafletPage(resolvePublicLeaflet(load, "nothing", null)),
  ]) {
    assert.match(
      navOf(html),
      /<span class="fol-nav-plane" data-plane="public"><span class="fol-nav-plane-dot" aria-hidden="true"><\/span>Public view<\/span>/,
    );
  }
});
