/**
 * THE ROLE-LAYER GUARD. `roles.css` is pure aliasing: every `--fol-role-*` resolves to a
 * primitive in `tokens.css`. That is only safe while the primitive still exists.
 *
 * CSS FAILS SILENTLY, and that is the whole reason this runs. A role pointing at a token that
 * was renamed does not throw and does not warn — the declaration is dropped and the element
 * inherits whatever its parent had. The page still renders. It renders WRONG, and it looks
 * deliberate. There is no runtime signal at all, so the signal has to be here.
 *
 * Ported from the Open Design project's `tools/roles-check.mjs` as a TEST, not a build step:
 * this package has no build, no bundler and no dependencies, and adding one to check a
 * stylesheet would cost more than the check is worth.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { TokenSheet, customProperties, must, readSource, rootProperties, topLevelRules } from "./stylesheet.ts";

const tokensCss = readSource("tokens.css");
const rolesCss = readSource("roles.css");

const declared = new Set(rootProperties(tokensCss).keys());
const roles = rootProperties(rolesCss);

test("every primitive a role names actually exists in tokens.css", () => {
  const dangling: string[] = [];
  for (const [name, value] of roles) {
    for (const match of value.matchAll(/var\(\s*(--fol-[a-z0-9-]+)\s*\)/g)) {
      const referenced = must(match[1], "a token name inside var()");
      if (!referenced.startsWith("--fol-role-") && !declared.has(referenced)) {
        dangling.push(`${name} -> ${referenced}`);
      }
    }
  }
  assert.deepEqual(dangling, [], `roles.css references tokens that do not exist: ${dangling.join(", ")}`);
});

test("a role ALIASES — it never carries a value of its own", () => {
  // Tested on the trimmed value rather than with a lookahead after \s*: the whitespace can
  // backtrack to zero length and the lookahead then passes on every declaration, which is a
  // guard that reports success without checking anything.
  const literals: string[] = [];
  for (const [name, value] of roles) {
    if (!value.startsWith("var(")) literals.push(`${name}: ${value}`);
  }
  assert.deepEqual(literals, [], `roles.css must alias, not declare: ${literals.join(" · ")}`);
});

test("no role hides a colour literal anywhere inside its value", () => {
  // Stronger than the rule above and the reason it exists: `var()` at the start is not enough
  // if a fallback smuggles a hex in, as in `var(--fol-x, #A8CC29)`.
  for (const [name, value] of roles) {
    assert.doesNotMatch(value, /#[0-9a-f]{3,8}\b/i, `${name} carries a hex literal: ${value}`);
    assert.doesNotMatch(value, /\b(rgba?|hsla?|oklch|oklab|lab|lch)\s*\(/i, `${name} carries a colour function: ${value}`);
  }
});

test("roles.css declares one role system at root and explicit face boundaries", () => {
  // Shared aliases must resolve again when a private control surrounds a public document.
  // The values remain one system, with no component-specific palette.
  const rules = topLevelRules(rolesCss);
  assert.deepEqual(
    rules.map((r) => r.prelude),
    [':root, [data-face], .face-night, .face-day'],
    "roles.css must contain one shared rule at surface boundaries",
  );
  for (const name of roles.keys()) {
    assert.match(name, /^--fol-role-[a-z0-9-]+$/, `${name} is not a role`);
  }
});

test("every role resolves to a real colour, on both faces", () => {
  // The end-to-end version: not just "the name exists" but "the alias chain terminates in a
  // colour a browser can paint". Roles that alias a length or a duration are skipped by shape.
  const sheet = new TokenSheet(tokensCss, rolesCss);
  const colourRoles = [...roles.keys()].filter(
    (name) => !/--fol-role-(radius|gap|pad|speed|ease|height|width)-/.test(name),
  );
  assert.ok(colourRoles.length > 0);

  // One role is deliberately translucent: --fol-role-action-wash is a 12% GROUND, and the
  // resolver refuses to hand back a measurable colour for it precisely so nobody quotes a
  // contrast ratio for a wash without naming what it was composited over. Asserting it is the
  // ONLY one keeps that exemption from spreading.
  const translucent: string[] = [];
  for (const name of colourRoles) {
    for (const face of ["night", "day"] as const) {
      try {
        sheet.resolve(name, face);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        assert.match(message, /carries alpha/, `${name} does not resolve on ${face}: ${message}`);
        if (!translucent.includes(name)) translucent.push(name);
      }
    }
  }
  assert.deepEqual(translucent, ["--fol-role-action-wash"]);
});

test("--fol-role-edge-control is the ONLY edge role that clears 1.4.11", () => {
  // Encodes the rule the comment states, so the three edges cannot quietly become
  // interchangeable. `line` and `edge` are decorative by design; `edge-control` is the one a
  // control may use. contrast.test.ts measures the actual ratios; this fixes the vocabulary.
  assert.equal(roles.get("--fol-role-line"), "var(--fol-hairline)");
  assert.equal(roles.get("--fol-role-edge"), "var(--fol-border)");
  assert.equal(roles.get("--fol-role-edge-control"), "var(--fol-text-faint)");
});

test("the component layer never reaches past a role to a raw primitive for a control edge", () => {
  // The specific regression this guards: .field and .btn-ghost taking --fol-border as their
  // only boundary, which is how the system arrived with a 1.68:1 edge on an interactive
  // control. If either rule names --fol-border again, this fails.
  const foliageCss = readSource("foliage.css");
  for (const selector of [".btn-ghost", ".field"]) {
    const rule = topLevelRules(foliageCss).find((r) => r.prelude.split(",")[0]?.trim() === selector);
    assert.ok(rule !== undefined, `${selector} is missing from foliage.css`);
    assert.doesNotMatch(
      rule.body,
      /border(-color)?\s*:[^;]*--fol-border/,
      `${selector} uses --fol-border (1.68:1) as a control boundary; use --fol-role-edge-control`,
    );
    assert.match(rule.body, /--fol-role-edge-control/, `${selector} should take the control edge`);
  }
});

test("the load order the files declare is the order they depend on", () => {
  // foliage.css consumes roles; roles consume tokens; tokens consume nothing. A cycle here
  // would mean the documented load order is a fiction.
  //
  // Comments are stripped first: tokens.css NAMES --fol-role-edge-control in prose, to point a
  // reader at the rule about control boundaries. Mentioning a role is not depending on one, and
  // a check that could not tell those apart would push that explanation out of the file.
  for (const rule of topLevelRules(tokensCss)) {
    assert.doesNotMatch(
      rule.body,
      /--fol-role-/,
      `tokens.css declares or uses a role in "${rule.prelude}" — the role layer loads after it`,
    );
  }
  const rolesDeclared = new Set(roles.keys());
  const rolesRoot = must(topLevelRules(rolesCss)[0], "the :root rule of roles.css");
  for (const [, value] of customProperties(rolesRoot.body)) {
    for (const match of value.matchAll(/var\(\s*(--fol-role-[a-z0-9-]+)\s*\)/g)) {
      const ref = must(match[1], "a role name inside var()");
      assert.ok(rolesDeclared.has(ref), `roles.css references an undeclared role ${ref}`);
    }
  }
});
