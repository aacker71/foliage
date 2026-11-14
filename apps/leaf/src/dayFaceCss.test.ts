/**
 * Gates on the STYLESHEET itself, and on the one piece of markup that can silently rot.
 *
 * WHY A TEST AND NOT A REVIEW NOTE. Every failure below is invisible in a screenshot:
 *
 *   - A `var()` naming a token that does not exist does not throw and does not warn. The whole
 *     declaration is dropped at computed-value time and the property falls back to its initial
 *     value, so the page still renders — just without the rule you wrote. This is not
 *     hypothetical here: the Open Design source of `foliage-design-system` renamed
 *     `--fol-ease-grow` to `--fol-ease-grow` in tokens v0.2, `@foliage/tokens` still defines
 *     the old name, and copying OD's transition verbatim would have produced a stylesheet with
 *     no transitions at all and nothing anywhere saying so.
 *   - A raw hex in an app stylesheet is how a design system stops being the source of truth.
 *     It looks identical on the day it is written and drifts silently forever after.
 *   - A ledger count that links to an anchor which was never rendered is a dead affordance. It
 *     only misbehaves when a tier is empty, which is exactly the case a populated screenshot
 *     does not show.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { leafId, leafletId, type Leaf } from "@foliage/leaf";

import { renderLeafPage as renderLeafPageUnderPolicy } from "./render.ts";

/*
 * The EMPTY policy: no rails fire and nothing is proposed, so every assertion below measures the
 * same page it was written about. `renderLeafPage` takes the publish policy because a deny rule
 * beats the subject's own share and a row must not offer a link the rail refuses; none of that is
 * what this file is measuring, and the rail's own behaviour is asserted in `policy.test.ts`.
 */
const renderLeafPage = (
  load: Parameters<typeof renderLeafPageUnderPolicy>[0],
  audience?: Parameters<typeof renderLeafPageUnderPolicy>[2],
  options?: Parameters<typeof renderLeafPageUnderPolicy>[3],
): string => renderLeafPageUnderPolicy(load, { rules: [] }, audience, options);
import type { LeafLoad } from "./leafDocument.ts";

const leafCss = await readFile(new URL("../public/leaf.css", import.meta.url), "utf8");

/**
 * THE WHOLE CASCADE THIS APP SERVES, in the order the server emits it. Reading only tokens.css
 * was correct while this app re-implemented the component layer; it is not correct now that the
 * page loads three files from @foliage/tokens, and a check that knows about one of them would
 * report a role defined in roles.css as missing.
 */
const packageCss = Object.fromEntries(
  await Promise.all(
    (["tokens.css", "roles.css", "foliage.css"] as const).map(
      async (name) =>
        [
          name,
          await readFile(fileURLToPath(import.meta.resolve(`@foliage/tokens/${name}`)), "utf8"),
        ] as const,
    ),
  ),
) as Record<"tokens.css" | "roles.css" | "foliage.css", string>;
const tokensCss = packageCss["tokens.css"];

/** CSS with comments removed, so a token named only in prose is never mistaken for a use. */
function code(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const leafCode = code(leafCss);

test("EVERY custom property this stylesheet reads is actually defined somewhere", () => {
  // The silent-failure gate. An unresolved var() drops its declaration without a word.
  const defined = new Set<string>();
  for (const css of [tokensCss, packageCss["roles.css"], packageCss["foliage.css"], leafCss]) {
    for (const m of code(css).matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]!);
  }

  const referenced = new Map<string, number>();
  for (const m of leafCode.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    referenced.set(m[1]!, (referenced.get(m[1]!) ?? 0) + 1);
  }
  assert.ok(referenced.size > 20, "sanity: the stylesheet should read many tokens");

  const missing = [...referenced.keys()].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(
    missing,
    [],
    `these custom properties are read by leaf.css but defined nowhere, so every declaration ` +
      `using them is silently discarded: ${missing.join(", ")}`,
  );
  console.log(
    `  leaf.css reads ${referenced.size} distinct custom properties; ` +
      `${defined.size} are defined across tokens.css + roles.css + foliage.css + leaf.css`,
  );
});

test("NO raw colour literal — every colour is a token or a mix of tokens", () => {
  // The fidelity gate. The design system can only stay the source of truth if the app never
  // spells a colour itself. color-mix() of two tokens is allowed; a hex is not.
  const literals = [
    ...leafCode.matchAll(/#[0-9a-f]{3,8}\b/gi),
    ...leafCode.matchAll(/\b(?:rgba?|hsla?|oklch|lab)\(/gi),
  ].map((m) => m[0]);
  assert.deepEqual(
    literals,
    [],
    `leaf.css must not introduce colour values of its own; found: ${literals.join(", ")}`,
  );
});

test("no shadows, and this app never reaches for the accent itself", () => {
  // "Bordered cells over floating cards" is a system rule; a 0-blur box-shadow used as a ring
  // is still a shadow to anyone reading the file, so the rule is enforced literally.
  assert.doesNotMatch(leafCode, /box-shadow|text-shadow|filter:\s*drop-shadow/i);

  // THE ACCENT BUDGET, AND WHY THIS ASSERTION GOT SIMPLER. This file used to be allowed exactly
  // one accent reference — `--leaf-tier-colour: var(--fol-verified)` on a 10px disc drawn with
  // `.leaf-pill::before` — because the badge was re-implemented here and, on paper, all three
  // NIGHT semantic tokens fail as 11px text (--fol-verified 1.68:1, --fol-pending 3.03,
  // --fol-excluded 3.18). That workaround is obsolete: tokens.css now ships a measured DAY ramp
  // (--fol-verified-day 6.55, --fol-pending-day 6.06, --fol-excluded-day 6.54, all at 11px on
  // paper), the face rebinds the semantics to it, and the badge is the system's `.proof`.
  //
  // So the budget is now enforced by ABSENCE: this app spends none of it. Every accent decision —
  // where it appears, how hover lifts it, what it reverses to on paper — belongs to the design
  // system, and an app reaching past the role layer to a raw accent token is how a page quietly
  // grows a third accent moment.
  const accentUses = [...leafCode.matchAll(/var\(\s*--fol-(?:accent[a-z-]*|verified)\s*[,)]/gi)];
  assert.deepEqual(
    accentUses.map((m) => m[0]),
    [],
    "the accent reaches these pages through foliage.css only; this file must not name it",
  );

  // The tier tints ARE still applied here, on the counts — through the ROLE layer, which is the
  // supported way to say "this number is about verified work" without owning the colour.
  for (const tier of ["verified", "pending", "excluded"] as const) {
    assert.match(
      leafCode,
      new RegExp(`data-count="${tier}"\\]\\s*\\{[^}]*var\\(--fol-role-${tier}\\)`),
      `the ${tier} count must take its semantic role, or the tint stopped meaning anything`,
    );
  }
});

test("EVERY DISPLAY HEADING PINS opsz — an omitted axis is a silently different typeface", () => {
  // WHY THIS IS A TEST AND NOT AN EYE. Omitting `opsz` from font-variation-settings does not
  // fail, does not warn, and does not look broken: CSS falls back to `font-optical-sizing: auto`,
  // which resolves the axis to the USED PIXEL SIZE. At --fol-t-40 that silently selects the 40pt
  // TEXT cut of Fraunces instead of the display cut, and the headline of a published document
  // renders measurably wider than the system specifies. Measured on the running page before this
  // was pinned: "Alex A Handgloves" at 40px/400 was 330.41px on `auto` and 281.63px at "opsz" 90
  // — 14.8% of the headline's width, decided by an axis nobody had written down.
  //
  // The rule is scoped to --fol-t-40 DELIBERATELY. `h2` is --fol-t-25 and correctly carries
  // "SOFT" 28,"WONK" 0 with no opsz, which is what Open Design's own `.spec` recipe and canopy's
  // `.drawer .title` use at that size. Pinning a display cut on a 25px subhead would be inventing
  // a value, not restoring one — so this asserts about the display size only.
  //
  // It is also scoped to the DISPLAY FACE. `.leaf-count` is --fol-t-40 too and must NOT appear
  // here: a count is a metric, set in the mono face, and Fraunces' axes mean nothing to it.
  const rules = [...leafCode.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim().replace(/\s+/g, " "),
    body: m[2]!,
  }));
  const headings = rules.filter(
    (r) =>
      /font-size:\s*var\(--fol-t-40\)/.test(r.body) &&
      /font-family:\s*var\(--fol-font-display\)/.test(r.body),
  );
  assert.ok(
    headings.length >= 2,
    `expected the h1 and the plate title to be sized --fol-t-40; found ${headings.length}`,
  );
  for (const rule of headings) {
    // It must declare the axis at all — a rule that inherits it from a lower-specificity `h1`
    // is not safe here: `.plate-t` sets the `font` SHORTHAND, and the shorthand resets
    // font-variation-settings and font-optical-sizing to their initial values.
    assert.match(
      rule.body,
      /font-variation-settings:[^;]*"opsz"\s*90/,
      `${rule.selector} is a --fol-t-40 display heading and does not pin "opsz" 90; without it ` +
        `the browser resolves opsz to 40 and renders the text cut of Fraunces`,
    );
  }
});

// ---------------------------------------------------------------------------------------------

function okLoad(leaf: Leaf): LeafLoad {
  return {
    ok: true,
    leaf,
    source: {
      path: "/srv/leaf.json",
      bytes: 128,
      documentDigest: `sha256:${"0".repeat(64)}`,
      readAt: "2026-08-13T00:00:00.000Z",
      declaredExample: false,
      bundledExample: false,
    },
  };
}

test("a ledger count links only where there is something to land on", () => {
  // Both directions, because each half fails in a different state: a live link needs its target
  // to exist, and a zero count must not offer a link at all.
  const populated: Leaf = {
    id: leafId("l"),
    subject: "Subject",
    leaflets: [
      {
        id: leafletId("a"),
        title: "verified one",
        tier: "verified",
        provenance: { source: "git", ref: "abc1234", observedAt: "2026-08-01T00:00:00.000Z" },
      },
      { id: leafletId("b"), title: "pending one", tier: "pending" },
    ],
  };
  // The ledger STRIP this test is about is private-audience only (verified/pending/excluded for
  // one person, summed, is the score publicProjection.ts refuses on the published face).
  const html = renderLeafPage(okLoad(populated), "private");

  // MIGRATED OFF THE CLASS. The affordance is `data-ledger` plus an href; which component draws
  // the cell is the design system's business and the redesign moved it from `.leaf-cell` to the
  // system's `.cell`. Keying on the attribute means this survives that and still fails the day a
  // count links somewhere the page never rendered.
  const hrefs = [...html.matchAll(/data-ledger="([a-z]+)" href="([^"]+)"/g)];
  assert.equal(hrefs.length, 2, "verified and pending are non-zero, excluded is not");
  for (const [, tier, href] of hrefs) {
    const destination = new URL(href!.replaceAll("&amp;", "&"), "http://localhost/leaf");
    const id = destination.hash.slice(1);
    const page = destination.searchParams.get("records") === "source"
      ? renderLeafPage(okLoad(populated), "private", { records: "source" }) : html;
    assert.match(
      page,
      new RegExp(`id="${id}"`),
      `the ${tier} count links to #${id}, which its destination never renders`,
    );
  }

  // Excluded is 0 here: not a link, and marked so for assistive tech as well as visually.
  assert.match(html, /data-ledger="excluded" data-disabled="true" aria-disabled="true"/);
  assert.doesNotMatch(html, /data-ledger="excluded" href/);

  // An empty leaf: all three are zero, so the page offers no ledger link whatsoever.
  const empty = renderLeafPage(okLoad({ id: leafId("l"), subject: "Nobody Yet", leaflets: [] }), "private");
  assert.equal([...empty.matchAll(/data-ledger="[a-z]+" href/g)].length, 0);
  assert.equal([...empty.matchAll(/data-disabled="true"/g)].length, 3);
  // The zero-count cells are still CELLS — the state is signalled structurally (a dashed rule),
  // never by dimming, because 0 verified is DATA and the one number a reader most needs to trust.
  assert.match(leafCode, /\[data-disabled="true"\]\s*\{[^}]*border-style:\s*dashed/);
  assert.doesNotMatch(
    leafCode,
    /\[data-disabled="true"\]\s*\{[^}]*opacity/,
    "dimming a real count is not a disabled state, it is an unreadable fact",
  );
});

test("THE MARK IS A SPRITE REFERENCE — one copy, the right tier, and it takes its face colour", () => {
  // WHAT THIS REPLACES. The mark used to be delivered as a CSS MASK: a `<span class="leaf-mark">`
  // with `mask: url("/mark-primary.svg")` and a background colour painted behind it. That existed
  // because an <img> is an opaque document — `currentColor` resolves INSIDE it, so the design
  // system's day colour could never reach the strokes. The mask solved the colour problem and
  // kept one copy of the path, and it is now obsolete: a <use> into an inlined symbol inherits
  // `color` like any other element.
  //
  // The invariant is not "a mask" and never was. It is: ONE copy of the geometry, at the tier the
  // size calls for, coloured through a token, with an accessible name.
  const html = renderLeafPage(okLoad({ id: leafId("l"), subject: "S", leaflets: [] }));

  const mark = /<svg class="([^"]*)"[^>]*role="img" aria-label="Foliage"[^>]*>\s*<use href="#([^"]+)"/.exec(
    html,
  );
  assert.ok(mark, "the masthead must render the mark as an accessible <use> into the sprite");
  assert.match(mark[1]!, /\bm\b/, "the mark must carry the system's .m class, which owns its colour");

  // THE ICON TIER, because the masthead mark is 28px. The primary tier draws 96 separate leaflets
  // and the expressive tier 160; below roughly 20px none of them survives, so the icon tier is the
  // CORRECT asset here rather than a degraded one.
  assert.equal(mark[2], "fol-mark-sm", "at 28px the icon tier is the correct drawing");
  assert.match(leafCode, /\.leaf-mark\s*\{[^}]*width:\s*28px/);

  // ONE COPY. The symbol is defined exactly once in the document, and no page inlines a second.
  assert.equal(
    [...html.matchAll(/<symbol id="fol-mark-sm"/g)].length,
    1,
    "two copies of a symbol drift; this project has shipped that bug once already",
  );
  assert.doesNotMatch(html, /<img[^>]*mark/, "an <img> mark cannot take the face colour");
  assert.doesNotMatch(leafCode, /mask:\s*url/, "the mask technique is retired with the mark");

  // The colour is the system's, not this app's: `.m` in foliage.css resolves --fol-role-mark and
  // the face swaps it to evergreen on paper. leaf.css supplies only the box.
  assert.doesNotMatch(
    leafCode,
    /\.leaf-mark\s*\{[^}]*(?:color|background)/,
    "the mark's colour belongs to the design system, not to this stylesheet",
  );

  // EVERY <use> RESOLVES. A dangling reference renders an invisible nothing in every browser and
  // is reported nowhere — the single most silent failure on these pages.
  for (const m of html.matchAll(/<use href="#([^"]+)"/g)) {
    assert.match(
      html,
      new RegExp(`<symbol id="${m[1]}"`),
      `<use href="#${m[1]}"> has no symbol in this document and renders nothing at all`,
    );
  }
  // ...and every symbol is used. An inlined symbol nothing references is dead weight that grows
  // silently every time a page changes.
  for (const m of html.matchAll(/<symbol id="([^"]+)"/g)) {
    assert.match(html, new RegExp(`<use href="#${m[1]}"`), `#${m[1]} is inlined but referenced nowhere`);
  }
});
