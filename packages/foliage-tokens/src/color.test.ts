/**
 * CALIBRATION. Every other test in this package trusts `color.ts`, so `color.ts` is checked
 * first against figures that come from outside this project — the WCAG spec's own anchors and
 * the round-trip identities of the colour spaces. An uncalibrated instrument that reports
 * confident numbers is worse than no instrument: it produces evidence-shaped output.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  colorMixInOklab,
  colorMixInOklch,
  colorMixInOklchIsInGamut,
  contrast,
  luminance,
  oklabToOklch,
  oklabToRgb,
  oklchToOklab,
  parseHex,
  ratio,
  rgbToOklab,
  toHex,
  wcagMinimum,
} from "./color.ts";

test("contrast matches the WCAG spec's own anchors", () => {
  // The two figures every implementation is expected to reproduce exactly.
  assert.equal(ratio(parseHex("#FFFFFF"), parseHex("#000000")), 21);
  // The spec's worked example for a mid grey that just clears AA on white.
  assert.equal(ratio(parseHex("#767676"), parseHex("#FFFFFF")), 4.54);
  // A colour against itself is 1:1, and the function is symmetric.
  assert.equal(ratio(parseHex("#A8CC29"), parseHex("#A8CC29")), 1);
  assert.equal(
    contrast(parseHex("#0B120E"), parseHex("#E9F0EA")),
    contrast(parseHex("#E9F0EA"), parseHex("#0B120E")),
  );
});

test("luminance is 0 for black and 1 for white", () => {
  assert.equal(luminance(parseHex("#000000")), 0);
  assert.equal(luminance(parseHex("#FFFFFF")), 1);
});

test("wcagMinimum applies the LARGE-TEXT rule only to genuinely large text", () => {
  // This function is the one that was got wrong twice in this lineage.
  assert.equal(wcagMinimum(11, false), 4.5, "an 11px mono label is normal text");
  assert.equal(wcagMinimum(13, false), 4.5);
  assert.equal(wcagMinimum(14, true), 4.5, "14px bold is still under the 18.66px bold rule");
  assert.equal(wcagMinimum(18.66, true), 3, "18.66px bold is the bold large-text boundary");
  assert.equal(wcagMinimum(23.9, false), 4.5, "just under 24px regular is still normal text");
  assert.equal(wcagMinimum(24, false), 3, "24px regular is the regular large-text boundary");
});

test("hex parsing handles the three shipped forms and refuses anything else", () => {
  assert.deepEqual(parseHex("#FFF"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex("#A8CC29"), { r: 168, g: 204, b: 41 });
  // The 8-digit form appears in the token file as --fol-accent-wash. Alpha is dropped, not
  // silently composited against a guess.
  assert.deepEqual(parseHex("#A8CC291F"), { r: 168, g: 204, b: 41 });
  assert.throws(() => parseHex("chartreuse"), /not a hex colour/);
  assert.throws(() => parseHex("#12345"), /not a hex colour/);
});

test("sRGB survives a round trip through OKLab unchanged", () => {
  // If this drifts, every color-mix() figure in the token comments is wrong by the drift.
  const samples = [
    "#000000", "#FFFFFF", "#A8CC29", "#0B120E", "#E9F0EA", "#F6F4ED",
    "#0E1F16", "#7D9184", "#C1794C", "#1A6344", "#55665C", "#6E5142",
  ];
  for (const hex of samples) {
    assert.equal(toHex(oklabToRgb(rgbToOklab(parseHex(hex)))), hex.toUpperCase(), hex);
  }
});

test("OKLab survives a round trip through polar OKLCh", () => {
  for (const hex of ["#A8CC29", "#0B120E", "#C1794C", "#E9F0EA"]) {
    const lab = rgbToOklab(parseHex(hex));
    const back = oklchToOklab(oklabToOklch(lab));
    assert.ok(Math.abs(back.L - lab.L) < 1e-12, hex);
    assert.ok(Math.abs(back.a - lab.a) < 1e-12, hex);
    assert.ok(Math.abs(back.b - lab.b) < 1e-12, hex);
  }
});

test("a color-mix at 0% and 100% is the identity on each endpoint", () => {
  const a = parseHex("#A8CC29");
  const b = parseHex("#E9F0EA");
  assert.equal(toHex(colorMixInOklch(a, 100, b)), "#A8CC29");
  assert.equal(toHex(colorMixInOklch(a, 0, b)), "#E9F0EA");
  assert.equal(toHex(colorMixInOklab(a, 100, b)), "#A8CC29");
  assert.equal(toHex(colorMixInOklab(a, 0, b)), "#E9F0EA");
});

test("OKLCh and OKLab give DIFFERENT answers — the defect this system nearly inherited", () => {
  // Open Design's CSS mixes `in oklch` while three of its documents pin the OKLab result as the
  // value to use on non-CSS targets. They are not the same colour, so a consumer pinning the
  // documented hex renders something the browser never paints. This test exists so that fact
  // cannot quietly stop being true.
  const accent = parseHex("#A8CC29");
  const text = parseHex("#E9F0EA");
  const polar = toHex(colorMixInOklch(accent, 84, text));
  const rectangular = toHex(colorMixInOklab(accent, 84, text));

  assert.equal(rectangular, "#B2D258", "the OKLab mix is the hex Open Design pins");
  assert.equal(polar, "#A9D55F", "the OKLCh mix is what a browser actually paints");
  assert.notEqual(polar, rectangular);
});

test("every color-mix this system ships stays inside sRGB", () => {
  // The per-channel clamp in colorMixInOklch is NOT the CSS gamut-mapping algorithm, so a mix
  // that left the gamut would be reported slightly wrong. Rather than assume that never
  // happens, prove it for the mixes that actually ship.
  const cases: [string, number, string][] = [
    ["#A8CC29", 84, "#E9F0EA"], // --fol-accent-lift
    ["#A8CC29", 45, "#0B120E"], // .proof verified border, night
    ["#A8CC29", 45, "#F6F4ED"], // .proof verified border, day
    ["#A08376", 40, "#0B120E"], // .proof excluded border, night
    ["#6E5142", 40, "#F6F4ED"], // .proof excluded border, day
    ["#E9F0EA", 45, "#101A14"], // .sk skeleton, night
    ["#0E1F16", 45, "#EDEAE0"], // .sk skeleton, day
  ];
  for (const [a, p, b] of cases) {
    assert.ok(
      colorMixInOklchIsInGamut(parseHex(a), p, parseHex(b)),
      `color-mix(in oklch, ${a} ${p}%, ${b}) left sRGB`,
    );
  }
});
