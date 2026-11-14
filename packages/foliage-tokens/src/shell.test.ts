/**
 * THE APP-SHELL VOCABULARY — .fol-nav / .fol-tabs / .fol-table / .fol-page / .fol-crumb —
 * checked the same way the rest of this package checks itself: parse the SHIPPED file, never
 * assert from a copy typed here.
 *
 * Three things this file is responsible for, matching the pattern contrast.test.ts / tokens.test.ts
 * / roles.test.ts already established:
 *
 *   1. Every new class actually has a rule in foliage.css (a selector typo that silently drops a
 *      whole rule is exactly the "CSS fails silently" failure mode roles.test.ts already guards
 *      against for the role layer).
 *   2. The one NEW text/background pairing .fol-table introduces — body-weight --fol-text against
 *      --fol-surface / --fol-surface-raised, which nothing before this used — clears AA on both
 *      faces, recomputed from the shipped hexes with this package's own color.ts, the same way
 *      contrast.test.ts's RECORDED table works.
 *   3. shell.html, the in-repo reference page, actually exists, demonstrates every component on
 *      both faces, and carries none of the things this repo's charter forbids (a score-shaped
 *      selector, a lorem placeholder, an external network origin).
 *
 * The export map is checked CONDITIONALLY: shell.html is a design reference a developer opens
 * directly, not a file
 * any app resolves through `@foliage/tokens`'s import specifier, so package.json does not export
 * it — exporting it would also require rewriting tokens.test.ts's hard-coded export list, which is
 * a file this lane does not own. If a later change decides it SHOULD be exported, this test picks
 * that up on its own rather than needing to be told.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Rgb, parseHex, ratio, toHex, wcagMinimum } from "./color.ts";
import { TokenSheet, readSource, stripComments, topLevelRules } from "./stylesheet.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const foliageCss = readSource("foliage.css");
const strippedFoliageCss = stripComments(foliageCss);
const sheet = new TokenSheet(readSource("tokens.css"), readSource("roles.css"));

/** Same quantisation contrast.test.ts uses: ratios are computed from the 8-bit hex a screen
 *  actually paints, not the unquantised color-mix() result. */
function measure(fg: Rgb, bg: Rgb): number {
  return ratio(parseHex(toHex(fg)), parseHex(toHex(bg)));
}

/**
 * True when at least one top-level rule in `css` has `selector` as one of its comma-separated,
 * whitespace-trimmed parts — so ".fol-nav" matching inside ".fol-nav-wrap" by mere substring
 * cannot pass this check the way a naive `.includes()` would.
 */
function hasSelectorRule(css: string, selector: string): boolean {
  return topLevelRules(css).some((rule) =>
    rule.prelude.split(",").some((part) => {
      const trimmed = part.trim();
      return (
        trimmed === selector ||
        trimmed.startsWith(`${selector} `) ||
        trimmed.startsWith(`${selector}:`) ||
        trimmed.startsWith(`${selector}[`) ||
        trimmed.startsWith(`${selector}.`)
      );
    }),
  );
}

test("foliage.css declares every new app-shell class as its own selector", () => {
  const required = [
    ".fol-nav",
    ".fol-nav-wrap",
    ".fol-nav-brand",
    ".fol-nav-list",
    ".fol-nav-plane",
    ".fol-nav-plane-dot",
    ".fol-tabs",
    ".fol-tab",
    ".fol-table-wrap",
    ".fol-table",
    ".fol-crumb",
    ".fol-page",
    ".fol-page-masthead",
    ".fol-page-body",
  ];
  const missing = required.filter((cls) => !hasSelectorRule(foliageCss, cls));
  assert.deepEqual(missing, [], `foliage.css is missing a rule for: ${missing.join(", ")}`);
});

test("the active/selected cue on nav, tabs and crumbs is never colour-only", () => {
  // Each active state must pair a colour change with a NON-colour cue (a border appearing, or a
  // weight change) — the task's own rule, checked as a shape rather than trusted from the CSS
  // comments above.
  const navActive = topLevelRules(foliageCss).find(
    (r) => r.prelude.trim() === '.fol-nav-list a[aria-current="page"]',
  );
  assert.ok(navActive, ".fol-nav-list a[aria-current=\"page\"] rule is missing");
  assert.match(navActive.body, /font-weight:\s*600/);
  assert.match(navActive.body, /border-bottom-color:/);

  const tabActive = topLevelRules(foliageCss).find(
    (r) => r.prelude.trim() === '.fol-tab[aria-selected="true"]',
  );
  assert.ok(tabActive, '.fol-tab[aria-selected="true"] rule is missing');
  assert.match(tabActive.body, /font-weight:\s*600/);
  assert.match(tabActive.body, /border-bottom-color:/);

  const crumbActive = topLevelRules(foliageCss).find(
    (r) => r.prelude.trim() === '.fol-crumb [aria-current="page"]',
  );
  assert.ok(crumbActive, '.fol-crumb [aria-current="page"] rule is missing');
  assert.match(crumbActive.body, /font-weight:\s*600/);
});

test("the plane badge dot differs by SHAPE, not only by the colour it never uses", () => {
  const studio = topLevelRules(foliageCss).find(
    (r) => r.prelude.trim() === '.fol-nav-plane[data-plane="studio"] .fol-nav-plane-dot',
  );
  assert.ok(studio, "the studio-plane dot override is missing");
  assert.match(studio.body, /border-radius:\s*0/);
  assert.match(studio.body, /rotate\(/);
  // The dot itself carries no --fol-role-* or hex text colour — it is a background fill, and the
  // rule shape is checked, not a literal colour, so a future retint cannot silently break this.
  assert.doesNotMatch(strippedFoliageCss, /\.fol-nav-plane-dot\{[^}]*color:\s*#/);
});

test("none of the new selectors carry a raw colour literal (comments stripped)", () => {
  // Mirrors tokens.test.ts's "the component layer carries no raw colour literal" check, scoped to
  // the new rules only, so this stays true independent of whether that file is ever touched.
  const shellRules = topLevelRules(foliageCss).filter((r) => /\.fol-(nav|tabs?|table|page|crumb)/.test(r.prelude));
  assert.ok(shellRules.length > 0, "no app-shell rules were found to check");
  for (const rule of shellRules) {
    assert.doesNotMatch(rule.body, /#[0-9a-fA-F]{3,8}\b/, `${rule.prelude} carries a raw hex`);
  }
});

test("no app-shell selector is score-shaped", () => {
  // The same banned vocabulary tokens.test.ts enforces for the whole package, applied here so this
  // file does not depend on that one ever running to catch a regression in these rules specifically.
  const banned = /\b(score|ranking|rank|percent|pct|meter|gauge|rating|grade|leaderboard|completeness|overall|composite)\b/i;
  const shellRules = topLevelRules(foliageCss).filter((r) => /\.fol-(nav|tabs?|table|page|crumb)/.test(r.prelude));
  for (const rule of shellRules) {
    assert.doesNotMatch(rule.prelude, banned, `${rule.prelude} is score-shaped`);
  }
});

test("the package export map resolves shell.html IF it is ever exported", () => {
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  const target = pkg.exports?.["./shell.html"];
  if (target === undefined) return; // not exported today — see the file header for why
  assert.ok(
    readFileSync(join(HERE, "..", target)).byteLength > 0,
    `${target} is empty or missing`,
  );
});

test("shell.html exists, demonstrates every new component, and does so on BOTH faces", () => {
  const shell = readSource("shell.html");
  for (const marker of [
    "fol-nav",
    "fol-tabs",
    "fol-tab",
    "fol-table",
    "fol-page",
    "fol-crumb",
  ]) {
    assert.ok(shell.includes(marker), `shell.html never references ${marker}`);
  }
  assert.match(shell, /data-face="night"/);
  assert.match(shell, /data-face="day"/);
  // The ARIA tablist contract, present as real markup rather than only as a CSS comment.
  assert.match(shell, /role="tablist"/);
  assert.match(shell, /role="tab"/);
  assert.match(shell, /aria-selected="true"/);
  assert.match(shell, /aria-current="page"/);
});

/** HTML comments stripped, the same way stylesheet.ts strips CSS comments before scanning — this
 *  page's own explanatory comments NAME the words this test bans ("nothing below is a score, a
 *  rank or a percentage"), and a check that could not tell that prose from a rendered score would
 *  be exactly the "cried wolf" failure mode tokens.test.ts's own comment-stripping avoids. */
function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

test("shell.html carries no fake data: no lorem, and no rendered score-shaped word", () => {
  const shell = stripHtmlComments(readSource("shell.html")).toLowerCase();
  assert.doesNotMatch(shell, /lorem/);
  const banned = /\b(score|ranking?|percent|pct|meter|gauge|rating|grade|leaderboard|completeness|overall|composite)\b/;
  assert.doesNotMatch(shell, banned);
});

test("shell.html makes zero non-loopback network calls", () => {
  // The same check tokens.test.ts runs over the shipped stylesheets and SVGs, run here over the
  // reference page: no font CDN, no @import, no remote url(), no external <link>/<script> host.
  const shell = readSource("shell.html");
  const FONT_CDN = new RegExp(["google" + "apis", "g" + "static", "fonts\\.google"].join("|"), "i");
  assert.doesNotMatch(shell, FONT_CDN, "shell.html links a font CDN");
  assert.doesNotMatch(shell, /<script\b/i, "shell.html contains a <script> tag");
  for (const [url] of shell.matchAll(/\bhttps?:\/\/[^\s"')]+/g)) {
    // The SVG namespace is an IDENTIFIER a browser never dereferences, and the inlined sprite
    // cannot parse without it — the one permitted match, same carve-out tokens.test.ts makes.
    assert.equal(url, "http://www.w3.org/2000/svg", `shell.html references an external origin: ${url}`);
  }
});

/**
 * THE ONE NEW MEASUREMENT. Everything else this system's chrome touches (--fol-text-faint,
 * --fol-text-muted on all three grounds, both faces) is already RECORDED in contrast.test.ts.
 * .fol-table is the first component to put body-weight --fol-text on --fol-surface /
 * --fol-surface-raised, so that pairing is measured fresh here, the same way contrast.test.ts
 * measures everything it records.
 */
const TABLE_TEXT_PAIRINGS: readonly [string, string, "night" | "day", number][] = Object.freeze([
  ["--fol-text", "--fol-surface", "night", 15.35],
  ["--fol-text", "--fol-surface-raised", "night", 13.9],
  ["--fol-text", "--fol-surface", "day", 14.23],
  ["--fol-text", "--fol-surface-raised", "day", 13.03],
]);

test(".fol-table body text clears AA against its bordered-cell ground, on both faces", () => {
  const px = sheet.px("--fol-t-14");
  const floor = wcagMinimum(px, false);
  const failures: string[] = [];
  for (const [fg, bg, face, recorded] of TABLE_TEXT_PAIRINGS) {
    const measured = measure(sheet.resolve(fg, face), sheet.resolve(bg, face));
    if (measured !== recorded) {
      failures.push(`${fg} on ${bg} (${face}): comment records ${recorded}, measured ${measured}`);
    }
    if (measured < floor) {
      failures.push(`${fg} on ${bg} (${face}) measured ${measured}, needs ${floor} at ${px}px`);
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
});

test("the day-face focus-ring reversal covers every new interactive element", () => {
  // .btn / .field already establish that the accent ring fails 3:1 on paper and must become
  // --fol-text under the day face. The same override must extend to the brand link, the nav
  // list links, the tabs and the crumb links — checked as a rule shape, not trusted from a
  // browser screenshot alone.
  const dayOverride = topLevelRules(foliageCss).find((r) =>
    r.prelude.includes(".fol-nav-brand:focus-visible") && r.prelude.includes(".fol-tab:focus-visible"),
  );
  assert.ok(dayOverride, "the day-face focus-ring override does not cover the new components");
  for (const selector of [
    ".fol-nav-brand:focus-visible",
    ".fol-nav-list a:focus-visible",
    ".fol-tab:focus-visible",
    ".fol-crumb a:focus-visible",
  ]) {
    assert.match(dayOverride.prelude, new RegExp(selector.replace(/[.[\]"]/g, "\\$&")));
  }
  assert.match(dayOverride.body, /outline-color:\s*var\(--fol-text\)/);
});

test("every new rule that carries a transition uses a --fol-dur-* token (reduced motion respected)", () => {
  // tokens.css zeroes every --fol-dur-* under prefers-reduced-motion; a rule that hard-coded a ms
  // value here would silently escape that. Checked the same way tokens.test.ts checks the
  // reduced-motion block itself: by pattern over the shipped file.
  const shellRules = topLevelRules(foliageCss).filter((r) => /\.fol-(nav|tabs?)/.test(r.prelude));
  const withTransition = shellRules.filter((r) => /transition\s*:/.test(r.body));
  assert.ok(withTransition.length > 0, "expected at least one transition in the new nav/tabs rules");
  for (const rule of withTransition) {
    const match = must(/transition\s*:([^;]+);?/.exec(rule.body), `a transition declaration in ${rule.prelude}`);
    const transitionDecl = must(match[1], `the transition value in ${rule.prelude}`);
    assert.doesNotMatch(transitionDecl, /\d+m?s\b(?!\s*\))/, `${rule.prelude} hard-codes a duration outside var()`);
    assert.match(transitionDecl, /var\(--fol-dur-\d\)/, `${rule.prelude} does not use a --fol-dur-* token`);
  }
});

function must<T>(value: T | null, what: string): NonNullable<T> {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value as NonNullable<T>;
}
