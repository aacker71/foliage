import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  AA_NORMAL,
  DAY_FACE_PAIRINGS,
  SEMANTIC_PROOF_TOKENS,
  contrastRatio,
  parseHex,
  remTokenToPx,
  resolveTokenValue,
  wcagMinimum,
} from "./dayFace.ts";

/**
 * The real token file, resolved through the package export rather than a relative path — so
 * this reads the ONE source of truth and cannot drift from it, and so a copied token file
 * elsewhere in the repo can never be what gets checked.
 */
const tokensCss = await readFile(
  fileURLToPath(import.meta.resolve("@foliage/tokens/tokens.css")),
  "utf8",
);

function hexOf(token: string): string {
  const value = resolveTokenValue(tokensCss, token);
  assert.ok(value !== null, `token ${token} is not defined in @foliage/tokens`);
  assert.ok(parseHex(value) !== null, `token ${token} resolved to "${value}", not a hex colour`);
  return value;
}

test("EVERY text pairing this app renders meets AA at the size it is rendered at", () => {
  // The gate. A failure here names the role, both tokens, the px size, the measured ratio and
  // the threshold — everything needed to fix it, and nothing that has to be taken on trust.
  const report: string[] = [];

  for (const p of DAY_FACE_PAIRINGS) {
    const sizeValue = resolveTokenValue(tokensCss, p.sizeToken);
    assert.ok(sizeValue !== null, `size token ${p.sizeToken} is not defined`);
    const px = remTokenToPx(sizeValue);
    assert.ok(px !== null, `size token ${p.sizeToken} is "${sizeValue}", not a rem value`);

    const ratio = contrastRatio(hexOf(p.fg), hexOf(p.bg));
    assert.ok(ratio !== null, `could not compute a ratio for ${p.role}`);

    const minimum = wcagMinimum(px, p.bold);
    report.push(
      `${p.role}: ${p.fg} on ${p.bg} at ${px}px${p.bold ? " bold" : ""} = ` +
        `${ratio.toFixed(2)}:1 (needs ${minimum}:1)`,
    );
    assert.ok(
      ratio >= minimum,
      `CONTRAST FAILURE — ${p.role}: ${p.fg} on ${p.bg} is ${ratio.toFixed(2)}:1 at ${px}px, ` +
        `which needs ${minimum}:1. Do not raise the threshold; change the colour.`,
    );
  }

  // Printed so the numbers are in the run output as evidence, not just asserted away.
  console.log("  DAY-face contrast, measured from @foliage/tokens:\n    " + report.join("\n    "));
  assert.equal(report.length, DAY_FACE_PAIRINGS.length);
});

test("the threshold is chosen by SIZE — 11px never gets the large-text allowance", () => {
  // The exact recorded error: 4.10:1 accepted for an 11px label because 3:1 was applied to it.
  assert.equal(wcagMinimum(11, false), AA_NORMAL);
  assert.equal(wcagMinimum(11, true), AA_NORMAL);
  assert.equal(wcagMinimum(18, true), AA_NORMAL, "18px bold is still under 14pt");
  assert.equal(wcagMinimum(18.66, true), 3);
  assert.equal(wcagMinimum(23, false), AA_NORMAL, "23px regular is still under 18pt");
  assert.equal(wcagMinimum(24, false), 3);
});

test("NO semantic proof token is used as DAY-face text — all three fail at label size", () => {
  // Structural, so it cannot be undone by editing a comment. The measured ratios against
  // --fol-paper at 11px are 1.68:1 (verified/accent), 3.03:1 (pending) and 3.18:1 (excluded);
  // all three need 4.5:1. They carry tier meaning as fills and rules until @foliage/tokens
  // grows DAY-face semantic values.
  const paper = hexOf("--fol-paper");
  for (const token of SEMANTIC_PROOF_TOKENS) {
    const ratio = contrastRatio(hexOf(token), paper);
    assert.ok(ratio !== null);
    const used = DAY_FACE_PAIRINGS.some((p) => p.fg === token);
    if (ratio < AA_NORMAL) {
      assert.equal(
        used,
        false,
        `${token} is ${ratio.toFixed(2)}:1 on --fol-paper and must not be a text colour here`,
      );
    }
  }
});

test("the contrast arithmetic is right, checked against the two ends of the scale", () => {
  // Black on white is exactly 21:1 and a colour on itself is exactly 1:1. If these drift the
  // whole gate above is measuring the wrong thing.
  assert.equal(contrastRatio("#000000", "#ffffff")?.toFixed(2), "21.00");
  assert.equal(contrastRatio("#ffffff", "#000000")?.toFixed(2), "21.00", "order must not matter");
  assert.equal(contrastRatio("#A8CC29", "#A8CC29")?.toFixed(2), "1.00");
  assert.equal(contrastRatio("#abc", "#aabbcc")?.toFixed(2), "1.00", "shorthand expands");
});

test("an unreadable colour yields null, not a made-up ratio", () => {
  // Returning 21 or 1 for an unparseable colour would let a broken token pass the gate.
  assert.equal(contrastRatio("not-a-colour", "#ffffff"), null);
  assert.equal(contrastRatio("#ffffff", "var(--nope)"), null);
  assert.equal(remTokenToPx("11px"), null, "px is not rem; guessing is how sizes get confused");
  assert.equal(resolveTokenValue(tokensCss, "--fol-does-not-exist"), null);
});

test("var() indirection resolves, or the semantic tokens would go unchecked", () => {
  // --fol-verified is declared as var(--fol-accent). Without following it, every check
  // involving it would silently pass on an unparseable value.
  assert.equal(resolveTokenValue(tokensCss, "--fol-verified"), hexOf("--fol-accent"));
});
