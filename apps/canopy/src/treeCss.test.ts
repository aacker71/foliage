/**
 * Gates on `tree.css` and on the two pieces of markup that can rot without anyone noticing.
 *
 * WHY A TEST AND NOT A REVIEW NOTE. Every failure below is invisible in a screenshot:
 *
 *   - A `var()` naming a token that does not exist does not throw and does not warn. The whole
 *     declaration is dropped at computed-value time, so the page still renders — just without
 *     the rule you wrote. This is not hypothetical: `--fol-ease-unfurl` was renamed to
 *     `--fol-ease-grow` in the system's v0.2 pass, and every rule still naming the old name
 *     would silently have no transition, with nothing anywhere saying so.
 *   - A raw hex in an app stylesheet is how a design system stops being the source of truth. It
 *     looks identical on the day it is written and drifts silently forever after. This file used
 *     to carry three `color-mix` derivations that leaf.css also carried, with the comment above
 *     them admitting they were a second copy.
 *   - A second copy of the mark is how this repository shipped a stale identity figure for
 *     weeks: `canopy-crown.js` carried its own `#fol-mark-sm` path data, its own comment
 *     recorded that it matched no shipped asset, and nothing failed.
 *
 * The pattern is `apps/leaf/src/dayFaceCss.test.ts`'s, deliberately: one gate shape for both
 * apps rather than two that drift.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderTreePage } from "./renderTree.ts";
import { TREE_ENV, loadTreeDocument } from "./treeDocument.ts";

const treeCss = await readFile(new URL("../public/tree.css", import.meta.url), "utf8");
const pkg = async (name: string) =>
  readFile(fileURLToPath(import.meta.resolve(`@foliage/tokens/${name}`)), "utf8");
const tokensCss = await pkg("tokens.css");
const rolesCss = await pkg("roles.css");
const foliageCss = await pkg("foliage.css");
const sprite = await pkg("foliage-sprite.svg");


/** CSS with comments removed, so a token named only in prose is never mistaken for a use. */
function code(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const treeCode = code(treeCss);

test("EVERY custom property tree.css reads is actually defined in the design system", async () => {
  // The silent-failure gate. An unresolved var() drops its declaration without a word.
  const defined = new Set<string>();
  for (const css of [tokensCss, rolesCss, foliageCss, treeCss]) {
    for (const m of code(css).matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1] as string);
  }

  const referenced = new Set<string>();
  for (const m of treeCode.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) referenced.add(m[1] as string);
  assert.ok(referenced.size > 15, "sanity: this stylesheet should read many tokens");

  const missing = [...referenced].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(
    missing,
    [],
    `these custom properties are read by tree.css but defined nowhere, so every declaration ` +
      `using them is silently discarded: ${missing.join(", ")}`,
  );
});

test("NO raw colour literal — every colour is a token or a mix of tokens", () => {
  const literals = [
    ...treeCode.matchAll(/#[0-9a-f]{3,8}\b/gi),
    ...treeCode.matchAll(/\b(?:rgba?|hsla?|oklch|lab)\(/gi),
  ].map((m) => m[0]);
  assert.deepEqual(
    literals,
    [],
    `tree.css must not introduce colour values of its own; found: ${literals.join(", ")}`,
  );
});

test("no shadows, and no face block — the face lives in the package, once", () => {
  // "Bordered cells over floating cards" is a system rule; a 0-blur box-shadow used as a ring is
  // still a shadow to anyone reading the file, so the rule is enforced literally.
  assert.doesNotMatch(treeCode, /box-shadow|text-shadow|filter:\s*drop-shadow/i);

  // The face used to be declared here AND, character for character, in leaf.css. It is now in
  // tokens.css. An app that re-declares it has re-created the drift surface.
  assert.doesNotMatch(
    treeCode,
    /\[data-face\s*=\s*"?day"?\]\s*\{|\.face-day\s*\{/,
    "tree.css re-declares the day face. The face block belongs to @foliage/tokens; two copies " +
      "of a colour derivation is the exact defect this pass removed",
  );

  // And the `html` prefix stays off: `html[data-face="day"] .fol-label` scores (0,2,1) and
  // silently outranks an ordinary `.some-band .fol-label` at (0,2,0), which this surface had
  // already shipped once and had to work around by repeating the face selector.
  assert.doesNotMatch(
    treeCode,
    /html\[data-face/,
    "an html-prefixed face selector is one specificity step above every ordinary class rule, " +
      "which is how a band's label silently paints muted",
  );
});

test("the focus ring is a REAL measured colour, never the UA's auto ring", () => {
  const ring = treeCode.match(/:focus-visible\s*\{[^}]*\}/);
  assert.ok(ring !== null, "this surface declares no :focus-visible ring at all");
  assert.match(
    ring[0],
    /outline:\s*2px solid var\(--fol-[a-z-]+\)/,
    `the focus ring must be a named 2px token colour. --fol-accent measures 1.68:1 on paper and ` +
      `fails WCAG 1.4.11's 3:1 for a non-text indicator, so the geometry is Open Design's and ` +
      `the colour is --fol-text (15.56:1 on paper). Found: ${ring[0]}`,
  );
  assert.doesNotMatch(treeCode, /outline:\s*auto/);
});

test("every display heading pins SOFT and WONK — and none of them pins opsz", () => {
  // THE DEFECT THIS CATCHES, AND WHY A SCREENSHOT DOES NOT.
  //
  // `fraunces-var.woff2` — read straight out of the shipped binary's fvar table — declares
  // opsz 9/9/144, wght 100/900/900, SOFT 0/0/100, WONK 0/**1**/1. WONK's DEFAULT IS ITS
  // MAXIMUM. A display heading that sets no `font-variation-settings` therefore renders the
  // wonky alternates switched on, and no author asked for that: it is the font's default
  // leaking through the gap where a declaration should be. `/tree` shipped that way while the
  // identical headings on `/leaf` set "SOFT" 28, "WONK" 0 — two cuts of one typeface across two
  // surfaces of one product, with a 0.2% advance-width difference that no screenshot review will
  // ever flag.
  //
  // The `font:` shorthand RESETS font-variation-settings to `normal`, so the declaration is
  // also asserted to come after it. Written above the shorthand it is silently erased, which
  // looks correct in a diff and does nothing on the page.
  //
  // The negative half is as deliberate as the positive one. Open Design hardcodes an opsz
  // ladder (100 at 40/50px, 72 at 25px, 60 at 20px); this surface instead leaves opsz to
  // `font-optical-sizing: auto`, which resolves it to the rendered px size across the whole
  // responsive matrix. Pinning OD's 100 here forces the 100px cut onto a 25px h2 and the 32px
  // error h1 — measured, that narrows a 32px heading by 16.7%. This assertion exists so the
  // finding that produced this comment cannot be "fixed" a second time in the wrong direction.
  const blocks = [...treeCode.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: (m[1] as string).trim(), body: m[2] as string }))
    .filter((b) => /var\(--fol-font-display\)/.test(b.body));

  assert.ok(blocks.length >= 3, `sanity: expected display headings in tree.css, found ${blocks.length}`);

  for (const { selector, body } of blocks) {
    const fvs = body.match(/font-variation-settings\s*:\s*([^;]+);/);
    assert.ok(
      fvs !== null,
      `${selector} sets the display face and no font-variation-settings, so it inherits this ` +
        `font's own defaults — SOFT 0 and WONK 1, the wonky alternates, on a heading nobody ` +
        `chose them for`,
    );
    const value = (fvs[1] as string).trim();
    assert.equal(
      value,
      '"SOFT" 28, "WONK" 0',
      `${selector} must carry the same axis settings as the sibling real-data surface ` +
        `(apps/leaf/public/leaf.css). Found: ${value}`,
    );
    assert.doesNotMatch(
      value,
      /opsz/,
      `${selector} pins opsz. This surface leaves optical size to font-optical-sizing: auto, ` +
        `which resolves it to the rendered px size; a pinned value applies one breakpoint's cut ` +
        `at every breakpoint`,
    );

    const shorthand = body.indexOf("font:");
    if (shorthand !== -1) {
      assert.ok(
        body.indexOf("font-variation-settings") > shorthand,
        `${selector} declares font-variation-settings BEFORE the \`font:\` shorthand, which ` +
          `resets it to normal. The declaration is present in the file and absent from the page`,
      );
    }
  }
});

test("the max-width media blocks DESCEND, so the narrowest viewport gets the block meant for it", () => {
  // At 360px EVERY max-width block matches, so the LAST one in source order wins. Ordering them
  // narrowest-first silently disables all but the last — this project has shipped that twice,
  // once crushing two control rows to ~60px at 360px. It is invisible at any other width, which
  // is why it survives review, and it is trivially mechanical, which is why it is a test.
  const widths = [...treeCode.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) =>
    Number(m[1]),
  );
  assert.ok(widths.length >= 2, "sanity: this stylesheet should have a responsive ladder");
  const descending = [...widths].sort((a, b) => b - a);
  assert.deepEqual(
    widths,
    descending,
    `the max-width blocks are in source order ${widths.join(" → ")}. Every one of them matches ` +
      `at 360px, so the last wins; ordering them ascending disables all but the last`,
  );
});

test("no layout in an inline style attribute, on any state of this page", async () => {
  // Inline specificity beats every selector without !important, so a media query silently does
  // nothing against it. Open Design's own prototypes put `style="margin:0 0 var(--fol-s-2)"` on
  // their counts cells; that margin came into tree.css instead.
  for (const env of [{}, { [TREE_ENV]: "" }] as const) {
    const html = renderTreePage(await loadTreeDocument(env));
    const inline = [...html.matchAll(/\sstyle="[^"]*"/g)].map((m) => m[0]);
    assert.deepEqual(inline, [], `this page emits inline style attributes: ${inline.join(", ")}`);
  }
});

/* ==========================================================================================
   THE MARK — one copy in the repository, referenced everywhere, inlined once per document.
   ========================================================================================== */

test("the mark is a <use> into the package sprite, at the tier that survives 20px", async () => {
  const html = renderTreePage(await loadTreeDocument({ [TREE_ENV]: "" }));

  // No CSS-mask, no <img>, no inline path data. The mask technique needed a second URL pointing
  // at the mark, which is a second place for it to go stale.
  assert.doesNotMatch(treeCss + html, /mask(-image)?:\s*url\(/i);
  assert.doesNotMatch(html, /<path\b/i, "the page inlines path data instead of referencing it");

  const uses = [...html.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1] as string);
  assert.ok(uses.length > 0, "nothing on this page references the sprite");

  const symbols = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1] as string));
  const dangling = uses.filter((id) => !symbols.has(id));
  assert.deepEqual(
    dangling,
    [],
    `these ids are referenced but are not symbols in @foliage/tokens/foliage-sprite.svg, so ` +
      `they render nothing at all: ${dangling.join(", ")}`,
  );

  // Below ~20px the paired leaflets of the display tiers close up, so the icon tier is the
  // correct asset for a masthead mark. Constraint 7.
  const markSvg = html.match(/<svg class="m"[^>]*>/);
  assert.ok(markSvg !== null, "the masthead carries no mark");
  const height = Number(markSvg[0].match(/height="([\d.]+)"/)?.[1] ?? NaN);
  assert.ok(height <= 20, `the mark renders at ${height}px`);

  /*
   * `aria-hidden`, NOT `role="img" aria-label="Foliage"`. The mark sits inside `.fol-nav-brand`
   * paired with the visible word "Foliage" right next to it in the same link — see `navBar` in
   * renderTree.ts — so a screen reader announcing the icon a second time would be announcing the
   * same word twice. `role="img" aria-label`, the OLDER pattern this replaced, was correct only
   * while the mark stood alone with no adjoining text naming it.
   */
  assert.match(
    html,
    /<a class="fol-nav-brand" href="\/"><svg class="m"[^>]*aria-hidden="true"><use href="#fol-mark-sm"><\/use><\/svg>Foliage<\/a>/,
    "at masthead size the mark must be the icon tier (#fol-mark-sm), inside the nav brand, " +
      "hidden from assistive tech because the adjoining word already names it",
  );
});

test("the superseded mark idea is named nowhere on a served canopy surface", async () => {
  // Constraint 7: the mark is the bipinnate compound leaf. The coil may be mentioned in exactly
  // one place — the historical note in the package's tokens.css explaining what it superseded.
  for (const name of ["tree.css", "published.css", "manage.css", "canopy-base.css", "canopy-tokens.css"] as const) {
    const text = await readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      text,
      /circinate|coiled frond|unfurling in the bud/i,
      `${name} still describes the mark as the superseded coil. The shipped mark assets are a ` +
        `bipinnate compound leaf; a page that says otherwise is documenting a product that does ` +
        `not exist`,
    );
  }
});
