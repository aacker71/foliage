import { canopySize, type Tree } from "@foliage/canopy";

import { blurFade } from "./magicUi.ts";
import { documentName } from "./publicPath.ts";
import { esc, fabricationBand, glyph, shell } from "./renderTree.ts";
import { type TreeLoad, type TreeSource } from "./treeDocument.ts";

function treeRow(tree: Tree, source: TreeSource): string {
  const size = canopySize({ trees: [tree] });
  return `<li class="tree-person" data-tree-row="true">
<div class="tree-person-id">
<h3 class="tree-person-name"><a href="/tree">${esc(tree.company)}</a></h3>
<p class="tree-person-src"><span class="fol-label">Manifest</span>
<span class="fol-metric">${esc(documentName(source.path))}</span></p>
</div>
<div class="tree-counts">
<div class="metric" data-count="leaves"><span class="fol-label">Leaves loaded</span><b class="fol-metric">${size.leaves}</b></div>
</div>
</li>`;
}

function loadedTreeSection(load: Extract<TreeLoad, { ok: true }>): string {
  return `${fabricationBand(load.manifest, load.leafSources)}
<section class="launch-section" aria-labelledby="canopy-live-h">
<div class="launch-section-head">
<h2 id="canopy-live-h">Live tree</h2>
</div>
<ul class="tree-list">
${treeRow(load.tree, load.source)}
</ul>
</section>`;
}

function treeFailureCopy(load: Extract<TreeLoad, { ok: false }>): { heading: string; next: string } {
  switch (load.cause) {
    case "unconfigured": return { heading: "No tree published yet", next: "" };
    case "absent": return { heading: "Tree manifest not found", next: "Check the configured path." };
    case "unreadable": return { heading: "Tree manifest unreadable", next: "Check file permissions." };
    case "malformed": return { heading: "Tree manifest is not valid JSON", next: "Correct the file and reload." };
    case "invalid": return { heading: "Not a tree manifest", next: "Check the manifest format." };
    default: { const impossible: never = load; throw new Error(`Unhandled tree load: ${JSON.stringify(impossible)}`); }
  }
}

function treeFailureSection(load: Extract<TreeLoad, { ok: false }>): string {
  const copy = treeFailureCopy(load);
  if (load.cause === "unconfigured") {
    return `<section class="launch-section" aria-labelledby="canopy-empty-h">
<h2 id="canopy-empty-h">${esc(copy.heading)}</h2>
</section>`;
  }
  return `<section class="launch-section" aria-labelledby="canopy-empty-h">
<div class="cell launch-empty">
${glyph("i-alert", 20)}
<div>
<h2 id="canopy-empty-h">${esc(copy.heading)}</h2>
${copy.next ? `<p class="aside">${copy.next}</p>` : ""}
</div>
</div>
</section>`;
}

export function renderCanopyPage(load: TreeLoad): string {
  return shell({
    title: "Foliage — public proof portfolios",
    surface: "canopy",
    state: load.ok ? "ok" : load.cause,
    body: `${blurFade(`<section class="launch-hero">
<div class="launch-hero-copy">
<h1>Explore work people chose to share.</h1>
<div class="launch-actions">
<a class="btn btn-primary" href="/demo">${glyph("i-check", 16)}Try the demo</a>
${load.ok ? '<a class="btn btn-ghost" href="/tree">View tree</a>' : ""}
</div>
</div>
<div class="launch-figure" aria-hidden="true">
<svg class="m" width="180" height="205"><use href="#fol-mark-x"></use></svg>
</div>
</section>`)}
${load.ok ? loadedTreeSection(load) : treeFailureSection(load)}`,
  });
}

export function renderIndividualsPage(): string {
  return shell({
    title: "Foliage — for individuals",
    surface: "individuals",
    state: "ok",
    body: `${blurFade(`<section class="launch-hero">
<div class="launch-hero-copy">
<span class="fol-label">For individuals</span>
<h1>Your Leaf is a live portfolio.</h1>
<div class="launch-actions">
<a class="btn btn-primary" href="/demo">${glyph("i-check", 16)}Try your own text</a>
<a class="btn btn-ghost" href="/">Canopy</a>
</div>
</div>
<div class="launch-figure" aria-hidden="true">
<svg class="m" width="180" height="205"><use href="#fol-mark-x"></use></svg>
</div>
</section>`)}
${blurFade(`<section class="launch-section launch-strip" aria-label="Individual workflow">
<div class="cell"><span class="fol-label">Live portfolio</span></div>
<div class="cell"><span class="fol-label">Real artifacts</span></div>
<div class="cell"><span class="fol-label">Controlled visibility</span></div>
</section>`, 2)}`,
  });
}

export function renderOrganizationsPage(): string {
  return shell({
    title: "Foliage — for organizations",
    surface: "organizations",
    state: "ok",
    body: `${blurFade(`<section class="launch-hero">
<div class="launch-hero-copy">
<span class="fol-label">For organizations</span>
<h1>A Tree publishes people.</h1>
<div class="launch-actions">
<a class="btn btn-primary" href="/tree">${glyph("i-check", 16)}View tree</a>
<a class="btn btn-ghost" href="/demo">Try the demo</a>
</div>
</div>
<div class="launch-figure" aria-hidden="true">
<svg class="m" width="180" height="205"><use href="#fol-mark-x"></use></svg>
</div>
</section>`)}
${blurFade(`<section class="launch-section launch-strip" aria-label="Organization guarantees">
<div class="cell"><span class="fol-label">Opt-in roster</span></div>
<div class="cell"><span class="fol-label">Visible failures</span></div>
<div class="cell"><span class="fol-label">No summary tally</span></div>
</section>`, 2)}`,
  });
}
