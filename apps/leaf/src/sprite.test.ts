/**
 * THE SPRITE SEAM: what the pages reference, and what the documents actually carry.
 *
 * WHY THIS NEEDS A TEST AT ALL. Every failure mode here is completely silent:
 *
 *   - `<use href="#id">` with no matching symbol renders NOTHING. Not a broken-image glyph, not
 *     a console warning, not a layout shift — an element of the right size containing nothing.
 *     A masthead with no mark and a proof badge with no glyph both look like design choices.
 *   - An EXTERNAL reference — `<use href="/foliage-sprite.svg#id">` — is not supported by Blink
 *     at all. It works in Gecko and WebKit, so the bug ships to most readers and is invisible to
 *     whoever is looking at Safari.
 *   - A symbol inlined twice is two copies of the same path data that drift the first time one is
 *     edited. This project has shipped that once already.
 *   - A symbol inlined and never referenced is weight that grows every time a page changes and
 *     nothing ever removes.
 *
 * None of it is visible in a screenshot of a working page, and all of it is mechanical.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { leafId, leafletId, type Leaf, type PublishPolicy } from "@foliage/leaf";
import { parseHarvestDocument } from "@foliage/photosynthesis";

import { inlineSpriteFor, spriteSymbolIds, symbolsFor } from "./sprite.ts";
import {
  findLeaflet as findLeafletUnderPolicy,
  renderLeafPage as renderLeafPageUnderPolicy,
  renderLeafletPage,
  renderReviewPage,
  type LeafletLoad,
} from "./render.ts";

/*
 * THE POLICY THESE ASSERTIONS RUN UNDER, made explicit rather than defaulted.
 *
 * `renderLeafPage` and `findLeaflet` now take the publish policy, because a deny rule is
 * evaluated at publish time and beats the subject's own share. Every test below was written
 * about the visibility gate alone, so it runs under the EMPTY policy — no rails fire, no
 * proposals are made, and each assertion still measures exactly what it was written to measure.
 * That is a real state of the domain (a subject who has written no rules yet), not a hole: the
 * rail's own behaviour is asserted in `policy.test.ts` and, on the running server, in
 * `policySeam.test.ts`.
 */
const NO_RULES: PublishPolicy = { rules: [] };
const renderLeafPage = (load: LeafLoad): string => renderLeafPageUnderPolicy(load, NO_RULES);
const findLeaflet = (leaf: Leaf, id: string): LeafletLoad =>
  findLeafletUnderPolicy(leaf, id, NO_RULES);

import type { LeafLoad, LeafSource } from "./leafDocument.ts";

const spriteSource = await readFile(
  fileURLToPath(import.meta.resolve("@foliage/tokens/foliage-sprite.svg")),
  "utf8",
);

const source: LeafSource = {
  path: "/srv/leaf.json",
  bytes: 256,
  documentDigest: `sha256:${"0".repeat(64)}`,
  readAt: "2026-08-19T00:00:00.000Z",
  declaredExample: false,
  bundledExample: false,
};

/**
 * A leaf holding one leaflet of EACH tier, so every badge glyph is exercised. Real shape, real
 * fields, no invented evidence: the refs below are not presented as commits anywhere, and this
 * document never leaves the test.
 */
const allTiers: Leaf = {
  id: leafId("sprite-leaf"),
  subject: "Sprite Under Test",
  leaflets: [
    {
      id: leafletId("v"),
      title: "a verified leaflet",
      tier: "verified",
      visibility: "unlisted",
      provenance: { source: "git", ref: "abc1234", observedAt: "2026-08-19T00:00:00.000Z" },
    },
    { id: leafletId("p"), title: "a pending leaflet", tier: "pending" },
    { id: leafletId("x"), title: "an excluded leaflet", tier: "excluded", reason: "a stated reason" },
  ],
};
const okLoad: LeafLoad = { ok: true, leaf: allTiers, source };

const emptyHarvest = parseHarvestDocument({ candidates: [] });
assert.equal(emptyHarvest.ok, true, "the empty harvest fixture must itself be valid");

/** Every document this app can produce, so no surface is checked by proxy for another. */
const pages = (): readonly { what: string; html: string }[] => [
  { what: "/ populated", html: renderLeafPage(okLoad) },
  {
    what: "/ empty",
    html: renderLeafPage({
      ok: true,
      leaf: { id: leafId("e"), subject: "Nobody Yet", leaflets: [] },
      source,
    }),
  },
  {
    what: "/ failed to load",
    html: renderLeafPage({ ok: false, cause: "absent", detail: "no file", path: "/nowhere" }),
  },
  {
    what: "/leaflet/<id>",
    html: renderLeafletPage(findLeaflet(allTiers, "v"), source),
  },
  {
    what: "/leaflet/<id> refusal",
    html: renderLeafletPage(findLeaflet(allTiers, "no-such-id"), source),
  },
  {
    what: "/review empty",
    html: renderReviewPage(
      emptyHarvest.ok
        ? { ok: true, harvest: emptyHarvest.harvest, path: "/srv/harvest.json" }
        : (() => {
            throw new Error("unreachable");
          })(),
    ),
  },
  {
    what: "/review with no document",
    html: renderReviewPage({ ok: false, cause: "absent", detail: "no file", path: "/nowhere" }),
  },
];

test("EVERY <use> on EVERY surface resolves to a symbol in that same document", () => {
  for (const { what, html } of pages()) {
    const used = [...html.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1]!);
    assert.ok(used.length > 0, `${what}: no <use> at all — even the masthead mark is missing`);
    for (const id of used) {
      assert.match(
        html,
        new RegExp(`<symbol id="${id}"`),
        `${what}: <use href="#${id}"> has no symbol in this document. It renders an invisible ` +
          `nothing in every browser and reports the failure nowhere.`,
      );
    }
  }
});

test("NO SYMBOL IS INLINED TWICE, and none is inlined without a consumer", () => {
  for (const { what, html } of pages()) {
    const inlined = [...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]!);
    assert.deepEqual(
      inlined.filter((id, i) => inlined.indexOf(id) !== i),
      [],
      `${what}: a symbol is defined twice in one document. Two copies of a path drift the first ` +
        `time one is edited, and this project has shipped that bug once already.`,
    );
    for (const id of inlined) {
      assert.match(
        html,
        new RegExp(`<use href="#${id}"`),
        `${what}: #${id} is inlined but referenced nowhere — dead weight on every page view`,
      );
    }
    // ONE CARRIER. A second <svg> of symbols would be a second place for the first two rules to
    // be broken, and each carrier looks correct on its own.
    assert.equal(
      [...html.matchAll(/<svg class="leaf-sprite"/g)].length,
      1,
      `${what}: there must be exactly one inline sprite carrier per document`,
    );
  }
});

test("NO EXTERNAL <use>, EVER — Blink does not support it and fails silently", () => {
  for (const { what, html } of pages()) {
    // Anything other than a bare fragment: a path, a full URL, or the deprecated xlink form.
    assert.doesNotMatch(
      html,
      /<use[^>]*href="[^#][^"]*"/,
      `${what}: an external <use> reference renders nothing in Chrome and works in Safari, so ` +
        `the bug ships to most readers and is invisible to whoever tested it`,
    );
    assert.doesNotMatch(html, /xlink:href/, `${what}: xlink:href is deprecated; use href`);
  }
});

test("the subset is cut from the SHIPPED sprite, byte for byte — nothing is retyped here", () => {
  // The point of subsetting is page weight, and the risk of subsetting is a second copy of the
  // geometry. This is the assertion that the risk was not taken: every symbol a page carries is
  // a byte-identical substring of the file @foliage/tokens ships.
  for (const { what, html } of pages()) {
    for (const m of html.matchAll(/<symbol id="[^"]+"[\s\S]*?<\/symbol>/g)) {
      assert.ok(
        spriteSource.includes(m[0]),
        `${what}: a symbol in this document is not verbatim from @foliage/tokens' sprite. It is ` +
          `either edited or pasted, and either way it is now a second source of the artwork.`,
      );
    }
  }
});

test("the marks the LARGE tiers draw are never shipped to a leaf surface", () => {
  // Not a size micro-optimisation — a correctness rule with a size consequence. Every mark on
  // these three surfaces is 28px or smaller, and below roughly 20px neither the primary tier
  // (4 pinna pairs, 96 leaflets) nor the expressive tier (5 pairs, 160 leaflets) survives: the
  // leaflets close into a blur. The icon tier is the CORRECT drawing at this size, not a
  // fallback. That it also saves 32,688 bytes of path data per page view is the dividend.
  for (const { what, html } of pages()) {
    for (const big of ["fol-mark-x", "fol-mark"]) {
      assert.doesNotMatch(
        html,
        new RegExp(`<use href="#${big}"`),
        `${what}: #${big} is drawn for display sizes; at 28px its leaflets do not survive`,
      );
    }
  }
});

test("an unknown symbol id THROWS rather than emitting a reference to nothing", () => {
  // The alternative — emit the <use> and skip the symbol — is the invisible failure this module
  // exists to make visible, and this is the only place that can still see it.
  assert.throws(
    () => inlineSpriteFor('<use href="#not-a-symbol">'),
    /no symbol "not-a-symbol"/,
    "a dangling reference must be loud at render time, because it is silent at read time",
  );
  // And the error names what IS available, so the fix does not require reading the sprite.
  assert.throws(() => inlineSpriteFor('<use href="#nope">'), /fol-mark-sm/);
});

test("the reference scanner reads the same attribute a browser reads", () => {
  assert.deepEqual(symbolsFor('<use href="#a"><use href="#b"><use href="#a">'), ["a", "b"]);
  assert.deepEqual(symbolsFor("<p>nothing here</p>"), []);
  assert.equal(inlineSpriteFor("<p>nothing here</p>"), "", "no references means no carrier");
  // A document that references nothing must not carry an empty <svg><defs></defs></svg> either:
  // an element that exists for no reason is one a later reader has to reason about.
  assert.doesNotMatch(inlineSpriteFor("<p>x</p>"), /svg/);
});

test("the sprite this app reads is the one @foliage/tokens ships, with all eight symbols", () => {
  // Resolved through the package export map, so this cannot quietly become a second copy of the
  // file. If the package renames a symbol, this fails here rather than rendering blank glyphs.
  assert.deepEqual(spriteSymbolIds(), [
    "fol-mark-x",
    "fol-mark",
    "fol-mark-sm",
    "fol-leaflet",
    "i-check",
    "i-partial",
    "i-exclude",
    "i-folder",
    "i-alert",
  ]);
});
