/**
 * THE SHAPE OF THE SYSTEM, and the promises the shipped files make about themselves.
 *
 * Contrast lives in contrast.test.ts and geometry in sprite.test.ts. This file checks the
 * claims that are STRUCTURAL — the ones a reader would otherwise have to take on trust:
 *
 *   - the token set is the size it says it is, and the one deprecated name is a pure alias;
 *   - the face rebinds every ground and every semantic, and invents nothing;
 *   - not one byte of this package reaches a non-loopback origin;
 *   - nothing here renders a score, a fourth proof tier, or a comparator;
 *   - the superseded mark idea appears exactly once, in the note that explains it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TokenSheet, must, readSource, shippedStylesheets, shippedSvgs, stripComments, topLevelRules } from "./stylesheet.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const tokensCss = readSource("tokens.css");
const sheet = new TokenSheet(tokensCss, readSource("roles.css"));
/** tokens.css ALONE. `sheet` merges the role layer in, the way the cascade does, so it is the
 *  wrong thing to count primitives with. */
const primitives = new TokenSheet(tokensCss);

/** The name that was renamed, kept alive only for consumers that have not migrated. */
const DEPRECATED = "--fol-ease-unfurl";

/**
 * The font-CDN hosts, ASSEMBLED FROM PARTS so this detector does not match itself.
 *
 * The repo's integration gate greps `apps` and `packages` for these host names and expects zero
 * hits. Spelling them out here would make this file — the very thing that PROVES they are
 * absent — the only hit, and a gate that reports a known false positive is a gate that gets
 * switched off. This repo already reasons about the same problem for test-shaped code quoted
 * inside a string (tools/ledger/parse.test.mjs).
 */
const FONT_CDN = new RegExp(["google" + "apis", "g" + "static", "fonts\\.google"].join("|"), "i");

test("the token set includes deliberate leaf shape and record source colors, plus one documented deprecation", () => {
  const names = primitives.names();
  assert.equal(new Set(names).size, names.length, "a token is declared twice in :root");
  assert.ok(names.includes(DEPRECATED), `${DEPRECATED} was dropped while referrers still exist`);
  assert.equal(
    names.filter((n) => n !== DEPRECATED).length,
    80,
    "71 original primitives, four leaf-shape primitives, three categorical record source colors, and two workspace dimensions",
  );
  for (const source of ["git", "photosynthesis", "other"]) assert.ok(names.includes(`--fol-record-${source}`));
});

test("the deprecated ease name is a PURE ALIAS and can never drift in value", () => {
  // It is kept, and only kept, because live declarations in apps/leaf and apps/canopy still
  // reference it — an unresolved var() drops the whole declaration, so deleting it would
  // silently strip their transition timing rather than fail loudly. Aliasing (not copying the
  // cubic-bezier) is what makes that safe: the two cannot diverge.
  assert.equal(sheet.raw(DEPRECATED), "var(--fol-ease-grow)");
  assert.match(tokensCss, /DEPRECATED ALIAS/, "the deprecation must stay explained in the file");
});

test("the face rebinds every ground, every text level and every semantic — and invents nothing", () => {
  // "Both faces complete" stated as a set equality rather than a spot check. A missing entry
  // means a day surface silently inherits a night value; an extra entry means the face is
  // inventing a token that :root never declared, which no consumer could discover.
  const required = [
    "--fol-canvas", "--fol-surface", "--fol-surface-raised", "--fol-hairline", "--fol-border",
    "--fol-text", "--fol-text-muted", "--fol-text-faint",
    "--fol-verified", "--fol-pending", "--fol-excluded", "--fol-invalid",
    // Not a ground or a semantic, but it MUST be rebound: it is derived from --fol-text, which
    // the face flips, and without this the hover state darkens on paper.
    "--fol-accent-lift",
  ];
  assert.deepEqual([...sheet.day.keys()].sort(), [...required].sort());

  for (const name of sheet.day.keys()) {
    assert.ok(sheet.root.has(name), `the face declares ${name}, which :root never declares`);
  }
});

test("the face uses BOTH selector spellings, on neither of which is `html` a prefix", () => {
  const preludes = topLevelRules(tokensCss).map((rule) => rule.prelude);
  assert.ok(preludes.includes('[data-face="day"], .face-day'));
  assert.ok(preludes.includes('[data-face="night"], .face-night'));
  // The `html` prefix is a specificity trap: html[data-face="day"] .fol-label is (0,2,1) and
  // silently outranks an ordinary .some-band .fol-label at (0,2,0). Dropping it makes the two
  // interchangeable, which is the point.
  assert.doesNotMatch(stripComments(tokensCss), /html\s*\[data-face/);
  // color-scheme must be declared on BOTH faces. Without it the UA paints dark-mode form
  // controls and scrollbars on a day document — the one place CSS variables cannot reach.
  assert.match(stripComments(tokensCss), /\[data-face="day"\], \.face-day \{\s*color-scheme: light;/);
  assert.match(stripComments(tokensCss), /\[data-face="night"\], \.face-night \{ color-scheme: dark;/);
});

test("NOTHING in this package reaches a non-loopback origin", () => {
  // The product's privacy claim is that it makes zero network calls. The Open Design pages these
  // tokens came from carry two preconnects and a stylesheet link to Google's font CDN; under
  // `default-src 'none'` those would not even error loudly, they would fall back to Georgia and
  // ship a different design quietly. (Host names deliberately unwritten — see FONT_CDN.)
  const files = [
    ...shippedStylesheets().map((f) => ({ name: f.name, text: f.css })),
    ...shippedSvgs().map((f) => ({ name: f.name, text: f.svg })),
    { name: "package.json", text: readFileSync(join(HERE, "..", "package.json"), "utf8") },
  ];
  for (const { name, text } of files) {
    // Comments are stripped first. tokens.css NAMES the two CDN hosts in prose, to record that
    // they were stripped and why; a check that could not tell a warning from a link would force
    // that explanation out of the file, which is the wrong trade.
    const code = name.endsWith(".css") ? stripComments(text) : text;
    for (const [url] of code.matchAll(/\b(?:https?:)?\/\/[^\s"')]+/g)) {
      // The SVG namespace is an IDENTIFIER, not a fetch: it is never dereferenced by any
      // renderer, and an SVG without it does not parse. It is the only permitted match.
      assert.equal(
        url,
        "http://www.w3.org/2000/svg",
        `${name} references an external origin: ${url}`,
      );
    }
    assert.doesNotMatch(code, FONT_CDN, `${name} links a font CDN`);
    assert.doesNotMatch(code, /@import/, `${name} uses @import, which can fetch`);
    assert.doesNotMatch(code, /url\(\s*["']?(?:https?:)?\/\//i, `${name} has a remote url()`);
  }
});

test("every font this package names is served from its own directory", () => {
  const sources = [...tokensCss.matchAll(/src:\s*url\("([^"]+)"\)/g)].map((m) =>
    must(m[1], "a @font-face src url"),
  );
  assert.equal(sources.length, 4, "four self-hosted faces, all SIL OFL");
  for (const src of sources) {
    assert.match(src, /^fonts\/[a-z0-9-]+\.woff2$/, `${src} is not a bare relative path`);
    assert.ok(readFileSync(join(HERE, src)).byteLength > 0, `${src} does not exist on disk`);
  }
});

test("no stylesheet renders a score, a rank, a meter or a fourth proof tier", () => {
  // Constraint: three proof tiers, deliberately unordered. Counts by tier are facts; a
  // composite figure over a person's work is a rating of that person, and it has been shipped
  // before wearing a percentage, a bar and a commits column. This checks the SELECTORS, so a
  // component cannot arrive under a name that presumes a comparator exists.
  const banned =
    /\b(score|ranking|rank|percent|pct|meter|gauge|rating|grade|leaderboard|completeness|unattributed|overall|composite)\b/i;
  for (const { name, css } of shippedStylesheets()) {
    for (const rule of topLevelRules(css)) {
      assert.doesNotMatch(rule.prelude, banned, `${name} declares a score-shaped selector: ${rule.prelude}`);
    }
    // A fourth tier in any spelling. ProofTier has exactly three members and no ordering.
    assert.doesNotMatch(stripComments(css), /data-tier="(?!verified|pending|excluded)[a-z-]+"/);
    assert.doesNotMatch(stripComments(css), /\.proof-(?!verified|pending|excluded)[a-z-]+/);
  }
});

test("the three proof tiers each get a rule, and all three are the same component", () => {
  const foliage = stripComments(readSource("foliage.css"));
  for (const tier of ["verified", "pending", "excluded"]) {
    assert.match(foliage, new RegExp(`\\.proof-${tier},\\.proof\\[data-tier="${tier}"\\]`),
      `the ${tier} tier must answer to both the class and the data-attribute spelling`);
  }
  // .proof--verified is the third spelling, from a file that is being retired. It must not be
  // resurrected here: three spellings of one component is how a badge renders untinted.
  assert.doesNotMatch(foliage, /\.proof--/);
});

test("the superseded coil is named exactly once, in the note that explains it", () => {
  const occurrences = (text: string, word: RegExp) => (text.match(word) ?? []).length;
  for (const { name, css } of shippedStylesheets()) {
    const expected = name === "tokens.css" ? 1 : 0;
    assert.equal(occurrences(css, /circinate/gi), expected, `${name} mentions circinate`);
  }
  // And it may only appear in a comment — never as a class, a token or an animation name.
  assert.doesNotMatch(stripComments(tokensCss), /circinate|fiddlehead|spiral|coil/i);
  // The current mark, stated where a reader will find it.
  assert.match(tokensCss, /BIPINNATE COMPOUND LEAF/);
});

test("the component layer carries no raw colour literal and no JavaScript", () => {
  // A literal is a colour the face cannot flip, so it is a day-face bug waiting for a day
  // surface. Comments are stripped first because the token file quotes superseded hexes on
  // purpose, and a check that cried wolf about those would be turned off.
  for (const { name, css } of shippedStylesheets()) {
    const code = stripComments(css);
    const literals = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    if (name === "tokens.css") {
      // tokens.css is the ONE file allowed to hold literals — it is where they are defined.
      assert.ok(literals.length > 0);
    } else {
      assert.deepEqual(literals, [], `${name} carries raw colour literals: ${literals.join(", ")}`);
    }
    assert.doesNotMatch(code, /\b(javascript:|expression\(|<script)/i, `${name} contains script`);
  }
});

test("the reduced-motion block zeroes every duration token", () => {
  // Not a nice-to-have: the sprout animation on a verified badge is driven by --fol-dur-4, so
  // an incomplete list here means motion a user asked to stop keeps running.
  const media = topLevelRules(tokensCss).find((r) => r.prelude.startsWith("@media"));
  assert.ok(media !== undefined && /prefers-reduced-motion/.test(media.prelude));
  const durations = sheet.names().filter((n) => /^--fol-dur-\d+$/.test(n));
  assert.equal(durations.length, 4);
  for (const name of durations) {
    assert.match(media.body, new RegExp(`${name}\\s*:\\s*0ms`), `${name} is not zeroed`);
  }
});

test("package.json exports every file this package ships, and depends on nothing", () => {
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  // No dependency, no build. Node 22.18+ runs the tests by type-stripping; a bundler or a
  // dist/ step would put a generated artifact between the source and what the apps serve.
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.scripts?.build, undefined);

  const expected = [
    "./tokens.css", "./roles.css", "./foliage.css", "./foliage-sprite.svg",
    "./mark-expressive.svg", "./mark-primary.svg", "./mark-icon.svg", "./fonts/*",
  ];
  assert.deepEqual([...Object.keys(pkg.exports)].sort(), [...expected].sort());
  // Every export must resolve to a file that is really there — an apps lane resolving this
  // through import.meta.resolve gets a runtime error otherwise, on the server, at boot.
  for (const [subpath, target] of Object.entries(pkg.exports) as [string, string][]) {
    if (subpath.includes("*")) continue;
    assert.ok(readFileSync(join(HERE, "..", target)).byteLength > 0, `${target} is empty or missing`);
  }
});
