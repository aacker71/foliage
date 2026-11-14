/**
 * THE MARK, CHECKED AS GEOMETRY.
 *
 * The mark is a BIPINNATE COMPOUND LEAF — a leaf built out of leaves — and that is a claim about
 * the path data, not about the file name. This project has already shipped a stale simplified
 * copy of a mark and not noticed for weeks, because every check it had was "the file exists" or
 * "the symbol id is present". Both are true of a wrong drawing.
 *
 * So these tests parse the SVG and measure the structure:
 *
 *   EVEN-PINNATE       every leaflet attaches at a point shared by EXACTLY TWO leaflets. That
 *                      is what "opposite pairs on a rachis" means as an assertion. A frond that
 *                      ended in a lone terminal leaflet on a bare stem would leave one
 *                      attachment with a count of one, and fails here.
 *   NOT A DUPLICATE    the two leaflets of a pair must have equal arm length and diverge in
 *                      direction. A "pair" made by pasting one path twice would pass a naive
 *                      count and fails this.
 *   NOT SIMPLIFIED     each tier has a known leaflet population. The stale copy that shipped
 *                      before was a 3-lobe simplification; any collapse of the compound
 *                      structure moves these numbers.
 *   NO COIL            the superseded mark was a single stroked spiral. A tier whose fill path
 *                      has one subpath and no pairs is that drawing, and would fail on every
 *                      count above.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { must, readSource, shippedSvgs } from "./stylesheet.ts";

const sprite = readSource("foliage-sprite.svg");

/** The nine symbols, in the order the sprite declares them. Three mark tiers, one blade, five icons. */
const SYMBOLS = [
  "fol-mark-x", // expressive — 5 pinna pairs
  "fol-mark", // primary — 4 pinna pairs
  "fol-mark-sm", // icon — 3 leaflet pairs straight on the rachis
  "fol-leaflet", // a single blade — one leaflet rendered AS a leaflet, tier-coloured per row
  "i-check",
  "i-partial",
  "i-exclude",
  "i-folder",
  "i-alert",
] as const;

/**
 * The three mark tiers and the population each is expected to carry.
 * `leaflets` are filled obovate blades; `spines` are the stroked pinna axes; `rachis` is the
 * single stroked stem that enters as a check.
 */
const TIERS = {
  "fol-mark-x": { leaflets: 160, spineSubpaths: 10, standalone: "mark-expressive.svg" },
  "fol-mark": { leaflets: 96, spineSubpaths: 8, standalone: "mark-primary.svg" },
  // The icon tier collapses each plume to one solid leaf: no pinna spines at all, six leaflets
  // straight onto the rachis in three pairs. Below ~20px no leaflet survives, so the canopy
  // silhouette is the whole message and this is the CORRECT asset, not a degraded one.
  "fol-mark-sm": { leaflets: 6, spineSubpaths: 0, standalone: "mark-icon.svg" },
} as const;

interface Symbol {
  readonly id: string;
  readonly viewBox: string;
  readonly body: string;
}

function symbols(svg: string): Symbol[] {
  return [...svg.matchAll(/<symbol id="([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)].map(
    (m) => ({
      id: must(m[1], "a symbol id"),
      viewBox: must(m[2], "a symbol viewBox"),
      body: must(m[3], "a symbol body"),
    }),
  );
}

/** Split a `d` attribute into its subpaths — one per `M` move-to. */
function subpaths(d: string): string[] {
  return d.split(/(?=M)/).filter((part) => part.startsWith("M"));
}

function numbers(text: string): number[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number.parseFloat(m[0]));
}

/** Every coordinate pair in a subpath. SVG path data here is all absolute M/C/Q/L. */
function points(subpath: string): { x: number; y: number }[] {
  const flat = numbers(subpath);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push({ x: must(flat[i], "an x coordinate"), y: must(flat[i + 1], "a y coordinate") });
  }
  return out;
}

function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

/** The filled path of a mark symbol — the leaflets. */
function leafletPath(body: string): string {
  const match = /<path fill="currentColor" d="([^"]*)"/.exec(body);
  return must(match?.[1], "a filled leaflet path on a mark symbol");
}

test("the sprite declares exactly the eight expected symbols, once each", () => {
  const found = symbols(sprite).map((s) => s.id);
  assert.deepEqual(found, [...SYMBOLS]);
  assert.equal(new Set(found).size, found.length, "a symbol id appears twice in the sprite");
  // Inlined once per document and referenced by id. Two copies of a symbol drift, and this
  // project shipped that bug once.
  assert.match(sprite, /width="0" height="0" style="position:absolute" aria-hidden="true"/);
});

test("every symbol has an intact viewBox", () => {
  for (const symbol of symbols(sprite)) {
    const box = numbers(symbol.viewBox);
    assert.equal(box.length, 4, `${symbol.id} viewBox is not four numbers: ${symbol.viewBox}`);
    const width = must(box[2], `${symbol.id} viewBox width`);
    const height = must(box[3], `${symbol.id} viewBox height`);
    assert.ok(width > 0 && height > 0, `${symbol.id} has a zero or negative extent`);
  }
  // The five icons share one 24px box, which is what makes the .ico stroke ladder coherent:
  // stroke-width is compensated at small sizes against a constant coordinate system.
  for (const id of ["i-check", "i-partial", "i-exclude", "i-folder", "i-alert"]) {
    const symbol = symbols(sprite).find((s) => s.id === id);
    assert.equal(symbol?.viewBox, "0 0 24 24", `${id} is not on the 24px icon grid`);
  }
});

test("EVERY leaflet is one of an opposite PAIR — the even-pinnate invariant", () => {
  // The core structural claim. If any attachment point carried one leaflet, the frond would end
  // in a lone leaflet on a bare stem; if it carried three, it would not be a compound leaf.
  for (const [id, expected] of Object.entries(TIERS)) {
    const symbol = symbols(sprite).find((s) => s.id === id);
    assert.ok(symbol !== undefined, `${id} is missing from the sprite`);

    const blades = subpaths(leafletPath(symbol.body));
    assert.equal(blades.length, expected.leaflets, `${id} has ${blades.length} leaflets`);
    assert.equal(blades.length % 2, 0, `${id} has an odd number of leaflets`);

    const byAttachment = new Map<string, string[]>();
    for (const blade of blades) {
      const start = must(points(blade)[0], "a leaflet start point");
      const key = `${start.x},${start.y}`;
      byAttachment.set(key, [...(byAttachment.get(key) ?? []), blade]);
    }
    const populations = [...new Set([...byAttachment.values()].map((v) => v.length))];
    assert.deepEqual(
      populations,
      [2],
      `${id}: every attachment must carry exactly two leaflets, found populations ${populations}`,
    );
    assert.equal(byAttachment.size, expected.leaflets / 2);
  }
});

test("the two leaflets of a pair are equal and DIVERGENT — not one path pasted twice", () => {
  // The check that a "pair" is really opposite blades rather than a duplicated subpath. Equal
  // arm length says they are the same leaflet; a divergent direction says they are two of them.
  for (const id of Object.keys(TIERS)) {
    const symbol = must(symbols(sprite).find((s) => s.id === id), `sprite symbol #${id}`);
    const byAttachment = new Map<string, { x: number; y: number }[][]>();
    for (const blade of subpaths(leafletPath(symbol.body))) {
      const pts = points(blade);
      const first = must(pts[0], "a leaflet start point");
      const key = `${first.x},${first.y}`;
      byAttachment.set(key, [...(byAttachment.get(key) ?? []), pts]);
    }

    for (const [key, pair] of byAttachment) {
      const a = must(pair[0], "the first blade of a pair");
      const b = must(pair[1], "the second blade of a pair");
      const base = must(a[0], "a pair attachment point");
      const arm = (pts: { x: number; y: number }[]) => {
        const c = centroid(pts);
        return { dx: c.x - base.x, dy: c.y - base.y };
      };
      const first = arm(a);
      const second = arm(b);
      const lengthA = Math.hypot(first.dx, first.dy);
      const lengthB = Math.hypot(second.dx, second.dy);

      assert.ok(
        Math.abs(lengthA - lengthB) / Math.max(lengthA, lengthB) < 0.06,
        `${id} at ${key}: the two arms differ in length (${lengthA} vs ${lengthB})`,
      );

      const cosine =
        (first.dx * second.dx + first.dy * second.dy) / (lengthA * lengthB);
      const degrees = (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
      assert.ok(
        degrees > 20,
        `${id} at ${key}: the pair diverges by only ${degrees.toFixed(1)}deg — ` +
          "these are the same blade drawn twice, not an opposite pair",
      );
    }
  }
});

test("each tier carries its pinna spines and exactly ONE rachis", () => {
  // The rachis is the career and enters as a check; there is one of it. The pinna spines are
  // what makes the leaf BIpinnate — leaflets on pinnae on a rachis, rather than leaflets
  // straight onto the stem.
  for (const [id, expected] of Object.entries(TIERS)) {
    const symbol = must(symbols(sprite).find((s) => s.id === id), `sprite symbol #${id}`);
    const strokes = [...symbol.body.matchAll(/<path fill="none"[^>]*stroke-width="([\d.]+)"[^>]*d="([^"]*)"/g)]
      .map((m) => ({
        width: Number.parseFloat(must(m[1], "a stroke width")),
        subpaths: subpaths(must(m[2], "a stroke path")).length,
      }));
    assert.ok(strokes.length > 0, `${id} has no stroked path at all`);

    // The widest stroke is the rachis, and it is a single subpath.
    const rachis = strokes.reduce((a, b) => (b.width > a.width ? b : a));
    assert.equal(rachis.subpaths, 1, `${id} does not have exactly one rachis`);

    const spines = strokes.filter((s) => s !== rachis).reduce((sum, s) => sum + s.subpaths, 0);
    assert.equal(spines, expected.spineSubpaths, `${id} has ${spines} pinna spines`);
  }
});

test("the expressive tier sheds pinnae toward the icon — it never simplifies the curve", () => {
  // Tier reduction is a population change, not a redraw. If a tier ever got "simplified" into
  // fewer, cruder blades, the leaflets-per-pinna figure would move and this would catch it.
  assert.ok(TIERS["fol-mark-x"].leaflets > TIERS["fol-mark"].leaflets);
  assert.ok(TIERS["fol-mark"].leaflets > TIERS["fol-mark-sm"].leaflets);
  // Expressive: 10 pinnae x 16 leaflets (8 pairs). Primary: 8 pinnae x 12 (6 pairs).
  assert.equal(TIERS["fol-mark-x"].leaflets / TIERS["fol-mark-x"].spineSubpaths, 16);
  assert.equal(TIERS["fol-mark"].leaflets / TIERS["fol-mark"].spineSubpaths, 12);
  // The icon has no pinnae at all: each plume collapses to one solid leaf, three pairs.
  assert.equal(TIERS["fol-mark-sm"].spineSubpaths, 0);
  assert.equal(TIERS["fol-mark-sm"].leaflets / 2, 3);
});

test("the standalone mark files are byte-identical in geometry to their sprite symbols", () => {
  // The standalone files exist because a CSS mask cannot reference a sprite symbol. That is a
  // real delivery reason for a duplicate, so the duplicate is PINNED rather than tolerated:
  // two copies drift, and this project has already paid for that once.
  for (const [id, expected] of Object.entries(TIERS)) {
    const symbol = must(symbols(sprite).find((s) => s.id === id), `sprite symbol #${id}`);
    const standalone = readSource(expected.standalone);
    assert.equal(
      leafletPath(standalone),
      leafletPath(symbol.body),
      `${expected.standalone} has drifted from sprite symbol #${id}`,
    );
    const box = /viewBox="([^"]+)"/.exec(standalone);
    assert.equal(box?.[1], symbol.viewBox, `${expected.standalone} viewBox differs from #${id}`);
  }
});

test("every mark asset is accessible and inherits its colour", () => {
  for (const { name, svg } of shippedSvgs()) {
    if (name === "foliage-sprite.svg") {
      // A sprite is not an image; it is a definitions block and must be hidden from the tree.
      assert.match(svg, /aria-hidden="true"/, `${name} must be hidden from assistive tech`);
      continue;
    }
    assert.match(svg, /role="img"/, `${name} has no img role`);
    assert.match(svg, /aria-label="Foliage"/, `${name} has no accessible name`);
    // currentColor, never a literal: the mark takes the foreground of its ground — cream on
    // night, evergreen on paper — and never the accent.
    assert.match(svg, /currentColor/, `${name} does not inherit its colour`);
    assert.doesNotMatch(svg, /(?:fill|stroke)="#[0-9a-f]{3,8}"/i, `${name} hard-codes a colour`);
  }
});

test("no MARK uses an elliptical arc — the superseded drawing was a stroked spiral", () => {
  // Not a proof that nothing could ever be spiral-shaped, but it does close the obvious
  // alternative construction: the old mark was a single stroked path swept as an arc, and the
  // structural tests above already reject a single-subpath fill.
  //
  // SCOPED TO THE MARK TIERS ON PURPOSE. `i-partial` is a 24px icon built from a circle
  // segment (`A7.5 7.5 0 1 1 ...`), which is a perfectly ordinary way to draw a half-filled
  // status glyph and has nothing to do with the coil. A ban that swept it up would be a ban
  // that gets deleted the first time someone needs a rounded icon.
  const markSymbols = symbols(sprite).filter((s) => s.id in TIERS);
  assert.equal(markSymbols.length, 3);

  const marks: { name: string; svg: string }[] = [
    ...markSymbols.map((s) => ({ name: `#${s.id}`, svg: s.body })),
    ...shippedSvgs().filter((f) => f.name.startsWith("mark-")),
  ];
  for (const { name, svg } of marks) {
    for (const match of svg.matchAll(/\sd="([^"]*)"/g)) {
      assert.doesNotMatch(
        must(match[1], "a path d attribute"),
        /[Aa]\s*[\d.-]/,
        `${name} draws an elliptical arc`,
      );
    }
  }
});
