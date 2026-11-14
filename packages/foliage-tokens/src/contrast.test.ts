/**
 * THE MEASUREMENT. Every contrast figure this package records is recomputed here from the
 * shipped `tokens.css` and `roles.css`, at the px size the pairing actually renders at.
 *
 * WHY IT IS BUILT THIS WAY. Three things have gone wrong in this lineage, and each one has a
 * test below rather than a note:
 *
 *   1. A ratio was judged against the 3:1 LARGE-TEXT threshold when the text was an 11px mono
 *      label. So the threshold is derived from a size token read out of the same stylesheet,
 *      never from a number typed here.
 *   2. A value was checked against ONE of the three grounds it sits on and passed. So every
 *      pairing is run against every ground, and the failure message names the ground.
 *   3. A comment kept a ratio that belonged to the PREVIOUS revision of its own token — the
 *      "3.57:1 on paper" figure repeated in three files is the superseded #728579; the shipped
 *      value measures 3.05. So `RECORDED` below pins what the comments claim, and a value edit
 *      that does not come with a comment edit fails here.
 *
 * THE FACE IS NOT A SECOND TABLE. `PAIRINGS` names ground tokens (`--fol-canvas`,
 * `--fol-surface`, `--fol-surface-raised`) and is run TWICE, once per face. Under the day face
 * those three rebind to paper / paper-sunk / paper-raised, so the same table proves the day
 * ramp is complete: if any day surface were still resolving to a night-only value, its ratio
 * would collapse here rather than on someone's screen.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { NON_TEXT_MINIMUM, type Rgb, parseHex, ratio, toHex, wcagMinimum } from "./color.ts";
import { type Face, TokenSheet, readSource } from "./stylesheet.ts";

const sheet = new TokenSheet(readSource("tokens.css"), readSource("roles.css"));

/**
 * Ratios are computed from the 8-BIT hex, because that is what a screen paints. It matters for
 * the color-mix() tokens: the unquantised mix for `--fol-accent-lift` measures 11.15 and the
 * colour actually rasterised, #A9D55F, measures 11.17.
 */
function measure(fg: Rgb, bg: Rgb): number {
  return ratio(parseHex(toHex(fg)), parseHex(toHex(bg)));
}

function pair(fgToken: string, bgToken: string, face: Face): number {
  return measure(sheet.resolve(fgToken, face), sheet.resolve(bgToken, face));
}

/** The three grounds of whichever face is in play. Named once so no test can check only one. */
const GROUNDS = ["--fol-canvas", "--fol-surface", "--fol-surface-raised"] as const;

interface Pairing {
  /** What on a page this is, so a failure names something findable. */
  readonly role: string;
  readonly fg: string;
  /** Size token, resolved to px from the stylesheet. */
  readonly size: string;
  readonly bold: boolean;
  /** Grounds this actually sits on. Defaults to all three. */
  readonly grounds?: readonly string[];
}

/**
 * Every text pairing the component layer puts on screen. An unlisted pairing is an unchecked
 * pairing, so a new coloured text rule in foliage.css belongs here in the same commit.
 */
const PAIRINGS: readonly Pairing[] = Object.freeze([
  { role: "body copy / .field value", fg: "--fol-text", size: "--fol-t-16", bold: false },
  { role: ".plate-t title", fg: "--fol-text", size: "--fol-t-14", bold: true },
  { role: ".metric b figure", fg: "--fol-text", size: "--fol-t-25", bold: false },
  { role: "inline code", fg: "--fol-text", size: "--fol-t-14", bold: false },
  { role: ".aside / .plate-b prose", fg: "--fol-text-muted", size: "--fol-t-13", bold: false },
  { role: ".btn-ghost hover border label", fg: "--fol-text-muted", size: "--fol-t-14", bold: false },
  { role: ".fol-label / .note mono label", fg: "--fol-text-faint", size: "--fol-t-11", bold: false },
  { role: ".field placeholder", fg: "--fol-text-faint", size: "--fol-t-14", bold: false },
  { role: ".proof verified", fg: "--fol-verified", size: "--fol-t-11", bold: false },
  { role: ".proof pending", fg: "--fol-pending", size: "--fol-t-11", bold: false },
  { role: ".proof excluded", fg: "--fol-excluded", size: "--fol-t-11", bold: false },
  {
    role: ".err validation message",
    fg: "--fol-invalid",
    size: "--fol-t-13",
    bold: false,
    // --fol-surface-raised is deliberately absent. Under the day face --fol-invalid resolves to
    // --fol-invalid-day, which measures 4.25 on --fol-paper-raised and misses 4.5. That hole is
    // asserted explicitly below rather than hidden by omitting the ground silently.
    grounds: ["--fol-canvas", "--fol-surface"],
  },
]);

/**
 * Runs the whole table against one face and returns every failure, so a run reports ALL of them
 * rather than stopping at the first — a one-at-a-time contrast fix is how the "checked one
 * ground and shipped it" defect happened twice.
 *
 * The two callers below are written out rather than generated in a loop, deliberately: this
 * repo's ledger derives the suite total by STATIC COUNT, and a `test()` inside a `for` makes
 * that count a guess. `tools/ledger/parse.test.mjs` refuses the whole sum when any file does
 * that, and it is right to.
 */
function auditFace(face: Face): string[] {
  const failures: string[] = [];
  for (const pairing of PAIRINGS) {
    const px = sheet.px(pairing.size);
    const floor = wcagMinimum(px, pairing.bold);
    for (const ground of pairing.grounds ?? GROUNDS) {
      const measured = pair(pairing.fg, ground, face);
      if (measured < floor) {
        failures.push(
          `${pairing.role}: ${pairing.fg} (${toHex(sheet.resolve(pairing.fg, face))}) on ` +
            `${ground} (${toHex(sheet.resolve(ground, face))}) at ${px}px ` +
            `measured ${measured}, needs ${floor}`,
        );
      }
    }
  }
  return failures;
}

test("every text pairing clears AA on every ground — NIGHT face", () => {
  const failures = auditFace("night");
  assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
});

test("every text pairing clears AA on every ground — DAY face", () => {
  const failures = auditFace("day");
  assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
});

test("the day face is COMPLETE — no day surface resolves to a night-only value", () => {
  // The face rebinds primitives; a token that a day surface reads but the face forgot to rebind
  // would still resolve, to its night value, and would look like a design choice rather than a
  // bug. So: every token any pairing above touches must differ between the faces unless it is
  // deliberately face-invariant.
  const faceInvariant = new Set(["--fol-accent", "--fol-verified" /* resolves via the face */]);
  const touched = new Set<string>([...PAIRINGS.map((p) => p.fg), ...GROUNDS]);

  for (const token of touched) {
    if (faceInvariant.has(token)) continue;
    const night = toHex(sheet.resolve(token, "night"));
    const day = toHex(sheet.resolve(token, "day"));
    assert.notEqual(night, day, `${token} is identical on both faces — the face does not rebind it`);
  }
  // --fol-verified is the interesting one: the NAME is face-invariant but the VALUE must not be.
  assert.notEqual(
    toHex(sheet.resolve("--fol-verified", "night")),
    toHex(sheet.resolve("--fol-verified", "day")),
    "--fol-verified must resolve to a different colour on paper; the accent is 1.68:1 there",
  );
});

test("the night semantics genuinely FAIL on paper — which is why the day ramp exists", () => {
  // The justification for eight extra tokens, measured rather than asserted. If a future change
  // made these pass, the day ramp would be dead weight and this test would say so.
  const px = sheet.px("--fol-t-11");
  const floor = wcagMinimum(px, false);
  const paper = sheet.resolve("--fol-paper");
  for (const token of ["--fol-verified", "--fol-pending", "--fol-excluded", "--fol-invalid"]) {
    const measured = measure(sheet.resolve(token, "night"), paper);
    assert.ok(
      measured < floor,
      `${token} measures ${measured} on paper at ${px}px — it no longer needs a day value`,
    );
  }
});

test("each day proof tier is separated from BODY INK, not just from its ground", () => {
  // Ground contrast is not the only requirement. A tier colour that measures beautifully
  // against paper but sits 1.33:1 from --fol-ink reads as ordinary text and stops signalling
  // anything. This is the test that chose #1A6344 (2.37) over this repo's own #0E3927 (1.33)
  // for --fol-verified-day despite #0E3927 measuring far higher against paper.
  const SEPARATION_FLOOR = 2;
  const ink = sheet.resolve("--fol-ink");
  for (const token of ["--fol-verified", "--fol-pending", "--fol-excluded"]) {
    const measured = measure(sheet.resolve(token, "day"), ink);
    assert.ok(
      measured >= SEPARATION_FLOOR,
      `${token} on the day face measures ${measured} against --fol-ink — too close to body text`,
    );
  }
  // The rejected candidate, kept as evidence of what this test is for.
  assert.ok(measure(parseHex("#0E3927"), ink) < SEPARATION_FLOOR);
});

test("interactive boundaries clear WCAG 1.4.11 on every ground of both faces", () => {
  // --fol-role-edge-control is the alias that replaced --fol-border on .field and .btn-ghost.
  const failures: string[] = [];
  for (const face of ["night", "day"] as const) {
    for (const ground of GROUNDS) {
      const measured = pair("--fol-role-edge-control", ground, face);
      if (measured < NON_TEXT_MINIMUM) {
        failures.push(`edge-control on ${ground} (${face}) measured ${measured}`);
      }
    }
    // The focus ring. Night takes the accent; day must NOT, and takes --fol-text instead.
    const nightRing = pair("--fol-role-focus", "--fol-canvas", "night");
    assert.ok(nightRing >= NON_TEXT_MINIMUM, `night focus ring measured ${nightRing}`);
    const dayRing = pair("--fol-text", "--fol-canvas", "day");
    assert.ok(dayRing >= NON_TEXT_MINIMUM, `day focus ring measured ${dayRing}`);
  }
  assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
  // And the reason the override exists: the accent as a ring on paper fails outright.
  assert.ok(pair("--fol-role-focus", "--fol-canvas", "day") < NON_TEXT_MINIMUM);
});

test("the decorative edges are BELOW 3:1 — so the ban on using them for controls is real", () => {
  // Asserting these stay weak is not pedantry: if someone darkened --fol-border to 3:1 the ban
  // in roles.css would become false, and the comment explaining it would start lying.
  for (const face of ["night", "day"] as const) {
    for (const ground of GROUNDS) {
      for (const edge of ["--fol-border", "--fol-hairline"]) {
        const measured = pair(edge, ground, face);
        assert.ok(
          measured < NON_TEXT_MINIMUM,
          `${edge} on ${ground} (${face}) measured ${measured} — it now clears 1.4.11, so ` +
            "update the decorative-only rule in roles.css instead of leaving it stale",
        );
      }
    }
  }
});

test("the button state ladder never LOWERS contrast on hover", () => {
  // default -> hover must rise; :active may dip, and is the one permitted dip because it lasts
  // exactly as long as the finger is down.
  //
  // THIS TEST FOUND A REAL DEFECT. As inherited, --fol-accent-lift mixed toward --fol-text,
  // which the face rebinds to --fol-ink — so on paper the hover ground DARKENED and the label
  // fell 9.24 -> 6.70. The day face now rebinds the lift to mix toward --fol-paper. Without
  // running both faces through this loop the bug is invisible: the night figures are perfect.
  for (const [face, label] of [["night", "--fol-canvas"], ["day", "--fol-ink"]] as const) {
    const base = pair(label, "--fol-accent", face);
    const hover = pair(label, "--fol-accent-lift", face);
    const press = pair(label, "--fol-accent-press", face);
    const px = sheet.px("--fol-t-14");
    const floor = wcagMinimum(px, true);
    assert.ok(hover > base, `${face}: hover ${hover} does not rise above default ${base}`);
    assert.ok(base >= floor, `${face}: default button label measured ${base}`);
    assert.ok(hover >= floor, `${face}: hover button label measured ${hover}`);
    assert.ok(press >= floor, `${face}: pressed button label measured ${press}`);
  }
});

test("--fol-invalid-day fails on --fol-paper-raised, exactly as recorded", () => {
  // The one measured hole left open on purpose. It is asserted as a FAILURE so the constraint
  // written in tokens.css and foliage.css cannot silently stop being true — if someone darkens
  // the token, this test fails and forces both comments to be corrected in the same change.
  const px = sheet.px("--fol-t-13");
  const measured = pair("--fol-invalid", "--fol-surface-raised", "day");
  assert.ok(
    measured < wcagMinimum(px, false),
    `--fol-invalid-day now measures ${measured} on --fol-paper-raised at ${px}px. It passes. ` +
      "Remove the binding constraint from tokens.css and foliage.css, and delete this test.",
  );
  assert.equal(measured, 4.25);
});

/**
 * WHAT THE COMMENTS CLAIM. Each row is a figure written in tokens.css or roles.css. The test
 * recomputes it from the declaration and fails on any disagreement — which is what makes the
 * comments in those files evidence rather than decoration.
 */
const RECORDED: readonly [string, string, Face, number][] = Object.freeze([
  // token, ground, face, recorded ratio
  ["--fol-text", "--fol-canvas", "night", 16.36],
  ["--fol-text-muted", "--fol-canvas", "night", 7.73],
  ["--fol-text-faint", "--fol-canvas", "night", 5.65],
  ["--fol-text-faint", "--fol-surface", "night", 5.3],
  ["--fol-text-faint", "--fol-surface-raised", "night", 4.8],
  ["--fol-pending", "--fol-canvas", "night", 5.68],
  ["--fol-pending", "--fol-surface", "night", 5.33],
  ["--fol-pending", "--fol-surface-raised", "night", 4.83],
  ["--fol-excluded", "--fol-canvas", "night", 5.42],
  ["--fol-excluded", "--fol-surface", "night", 5.09],
  ["--fol-excluded", "--fol-surface-raised", "night", 4.61],
  ["--fol-invalid", "--fol-canvas", "night", 5.52],
  ["--fol-invalid", "--fol-surface", "night", 5.18],
  ["--fol-invalid", "--fol-surface-raised", "night", 4.69],
  ["--fol-accent", "--fol-canvas", "night", 10.24],
  ["--fol-accent-press", "--fol-canvas", "night", 8.01],
  ["--fol-accent-lift", "--fol-canvas", "night", 11.17],
  ["--fol-evergreen-500", "--fol-canvas", "night", 2.63],
  ["--fol-evergreen-300", "--fol-canvas", "night", 6.33],
  ["--fol-border", "--fol-canvas", "night", 1.68],
  ["--fol-border", "--fol-surface", "night", 1.57],
  ["--fol-border", "--fol-surface-raised", "night", 1.42],
  ["--fol-hairline", "--fol-canvas", "night", 1.39],
  // Day face. The ground tokens rebind, so these read as paper / sunk / paper-raised.
  ["--fol-text", "--fol-canvas", "day", 15.56],
  ["--fol-text-muted", "--fol-canvas", "day", 6.65],
  ["--fol-text-muted", "--fol-surface", "day", 6.08],
  ["--fol-text-muted", "--fol-surface-raised", "day", 5.57],
  ["--fol-text-faint", "--fol-canvas", "day", 5.54],
  ["--fol-text-faint", "--fol-surface", "day", 5.07],
  ["--fol-text-faint", "--fol-surface-raised", "day", 4.64],
  ["--fol-verified", "--fol-canvas", "day", 6.55],
  ["--fol-verified", "--fol-surface", "day", 5.99],
  ["--fol-verified", "--fol-surface-raised", "day", 5.49],
  ["--fol-pending", "--fol-canvas", "day", 6.06],
  ["--fol-pending", "--fol-surface", "day", 5.54],
  ["--fol-pending", "--fol-surface-raised", "day", 5.08],
  ["--fol-excluded", "--fol-canvas", "day", 6.54],
  ["--fol-excluded", "--fol-surface", "day", 5.98],
  ["--fol-excluded", "--fol-surface-raised", "day", 5.48],
  ["--fol-invalid", "--fol-canvas", "day", 5.07],
  ["--fol-invalid", "--fol-surface", "day", 4.63],
  ["--fol-invalid", "--fol-surface-raised", "day", 4.25],
  ["--fol-evergreen-700", "--fol-canvas", "day", 11.68],
  ["--fol-border", "--fol-canvas", "day", 1.66],
  ["--fol-border", "--fol-surface", "day", 1.51],
  ["--fol-border", "--fol-surface-raised", "day", 1.39],
  ["--fol-hairline", "--fol-canvas", "day", 1.33],
  ["--fol-accent", "--fol-canvas", "day", 1.68],
]);

test("every ratio written in the stylesheets matches the value written beside it", () => {
  const failures: string[] = [];
  for (const [token, ground, face, recorded] of RECORDED) {
    const measured = pair(token, ground, face);
    if (measured !== recorded) {
      failures.push(
        `${token} on ${ground} (${face} face): comment records ${recorded}, ` +
          `${toHex(sheet.resolve(token, face))} on ${toHex(sheet.resolve(ground, face))} ` +
          `measures ${measured}`,
      );
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
});

test("the superseded values are recorded correctly, so nobody re-litigates them", () => {
  // These are the hexes the token comments name as rejected. Their figures are checked too:
  // the whole reason --fol-text-faint took three revisions is that a rejected value's number
  // was quoted without its ground.
  const canvas = sheet.resolve("--fol-canvas");
  const surface = sheet.resolve("--fol-surface");
  const raised = sheet.resolve("--fol-surface-raised");
  assert.deepEqual(
    ["#67796E", "#728579"].map((hex) => [
      measure(parseHex(hex), canvas),
      measure(parseHex(hex), surface),
      measure(parseHex(hex), raised),
    ]),
    [
      [4.1, 3.85, 3.48], // failed on all three — the wrong-threshold revision
      [4.83, 4.53, 4.1], // failed only on surface-raised — the one-ground revision
    ],
  );
  // And the figure three files in this repo recorded as "3.57:1 on paper" for the CURRENT
  // token. 3.57 is #728579. The shipped value measures 3.05.
  const paper = sheet.resolve("--fol-paper");
  assert.equal(measure(parseHex("#728579"), paper), 3.57);
  assert.equal(measure(sheet.resolve("--fol-text-faint", "night"), paper), 3.05);
});

test("the Open Design alternatives this file overruled are recorded with their numbers", () => {
  // Keeping the rejected values measurable is what makes "the repo wins" a finding rather than
  // a preference. Each of these is a colour Open Design ships that misses 4.5 at 11px on
  // --fol-paper-raised — the ground its own day face binds and never measured.
  const raised = sheet.resolve("--fol-surface-raised", "day");
  const floor = wcagMinimum(sheet.px("--fol-t-11"), false);
  const odDayRamp = {
    "--fol-ink-faint": "#5B6D62",
    "--fol-pending-day": "#5A6D64",
    "--fol-excluded-day": "#746559",
  };
  for (const [token, odHex] of Object.entries(odDayRamp)) {
    const od = measure(parseHex(odHex), raised);
    const ours = measure(sheet.resolve(token), raised);
    assert.ok(od < floor, `Open Design's ${token} ${odHex} now measures ${od} — it passes`);
    assert.ok(ours >= floor, `our ${token} measures ${ours} on --fol-paper-raised`);
  }
  // And --fol-text-faint, where both projects passed and the margin decided it.
  assert.equal(measure(parseHex("#7C8F83"), sheet.resolve("--fol-surface-raised")), 4.69);
  assert.equal(measure(sheet.resolve("--fol-text-faint"), sheet.resolve("--fol-surface-raised")), 4.8);
});

test("every color-mix token stays inside sRGB on both faces", () => {
  for (const face of ["night", "day"] as const) {
    for (const name of sheet.names()) {
      if (!sheet.raw(name, face).startsWith("color-mix")) continue;
      assert.ok(sheet.mixIsInGamut(name, face), `${name} leaves sRGB on the ${face} face`);
    }
  }
});
