/**
 * Colour arithmetic for the token tests. No dependencies, no build step: this file is
 * type-stripped by Node and imported only by `*.test.ts` in this package.
 *
 * WHY THIS EXISTS. Every contrast figure recorded in `tokens.css` is a CLAIM, and a claim in a
 * comment rots silently — the value beside it changes and the number stays. Two token
 * revisions in this lineage shipped a comment whose ratio belonged to the PREVIOUS hex. So the
 * numbers are not asserted here, they are RECOMPUTED from the shipped stylesheet on every test
 * run, and the test fails if the file's own comment disagrees with its own value.
 *
 * Two independent pieces of arithmetic live here:
 *
 *   1. WCAG 2.x relative luminance and contrast ratio. Self-checkable: #FFF on #000 must be
 *      exactly 21, and the spec's own worked example #767676 on #FFF must be 4.54.
 *
 *   2. sRGB <-> OKLab <-> OKLCh, so `color-mix(in oklch, ...)` — which the stylesheet ships
 *      verbatim, because it is Baseline 2023 and costs no build step — can be resolved to the
 *      hex a browser will actually paint. This matters: the Open Design project pins
 *      `--fol-accent-lift` as #B2D258 in three documents while its CSS says `in oklch`. Those
 *      are different colours. Rectangular OKLab and polar OKLCh interpolate hue differently,
 *      and only one of them is what the engine does.
 */

/** An sRGB colour, 0-255 per channel. Alpha is deliberately absent: no measured pairing here
 *  involves a translucent foreground, and pretending otherwise would hide a compositing step. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** OKLab: perceptual lightness plus two opponent axes. */
export interface Oklab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/** OKLCh: the same space in polar form. `h` is degrees, 0-360. */
export interface Oklch {
  readonly L: number;
  readonly C: number;
  readonly h: number;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Parse `#rgb`, `#rrggbb` or `#rrggbbaa`. The 8-digit form appears in the token file
 * (`--fol-accent-wash` is `#A8CC291F`), and its alpha is DROPPED rather than silently
 * composited — a wash is a ground, never a text colour, so no measured pairing may name it.
 * Callers that hand a wash to `contrast()` are making a category error and should get the
 * opaque colour's number so the mistake is visible rather than plausible.
 */
export function parseHex(input: string): Rgb {
  const match = HEX_RE.exec(input.trim());
  const captured = match?.[1];
  if (captured === undefined) throw new Error(`not a hex colour: ${JSON.stringify(input)}`);
  // `#rgb` expands by doubling each digit. Written as a map rather than by index so it stays
  // correct without reaching for a non-null assertion.
  const hex =
    captured.length === 3 ? [...captured].map((digit) => digit + digit).join("") : captured;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0").toUpperCase();
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** sRGB transfer function, per WCAG 2.x / IEC 61966-2-1. */
function toLinear(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(linear: number): number {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return c * 255;
}

/** WCAG relative luminance. */
export function luminance(colour: Rgb): number {
  return (
    0.2126 * toLinear(colour.r) + 0.7152 * toLinear(colour.g) + 0.0722 * toLinear(colour.b)
  );
}

/**
 * WCAG 2.x contrast ratio, 1..21. Symmetric — the lighter colour is found rather than assumed,
 * so a caller cannot get a ratio below 1 by passing the arguments in the "wrong" order.
 */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Rounded the way a review reads it. Two decimals, because 0.01 is the margin that has
 *  already decided one of these tokens. */
export function ratio(a: Rgb, b: Rgb): number {
  return Math.round(contrast(a, b) * 100) / 100;
}

/**
 * The AA threshold for a given rendered size. THIS IS THE FUNCTION THE PROJECT GOT WRONG TWICE:
 * WCAG "large text" is >=18pt (24px) regular or >=14pt (18.66px) bold, and an 11px mono label is
 * NEITHER — it needs 4.5:1. A ratio quoted without the px size it is judged at is not a result.
 */
export function wcagMinimum(px: number, bold: boolean): number {
  const isLarge = bold ? px >= 18.66 : px >= 24;
  return isLarge ? 3 : 4.5;
}

/** WCAG 1.4.11: non-text contrast for a user-interface component boundary or a meaningful
 *  graphic. Flat 3:1, no size term — a 1px border has no font size. */
export const NON_TEXT_MINIMUM = 3;

// --- OKLab / OKLCh (Björn Ottosson, 2020) ----------------------------------------------------

export function rgbToOklab(colour: Rgb): Oklab {
  const r = toLinear(colour.r);
  const g = toLinear(colour.g);
  const b = toLinear(colour.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb(colour: Oklab): Rgb {
  const l_ = colour.L + 0.3963377774 * colour.a + 0.2158037573 * colour.b;
  const m_ = colour.L - 0.1055613458 * colour.a - 0.0638541728 * colour.b;
  const s_ = colour.L - 0.0894841775 * colour.a - 1.291485548 * colour.b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function oklabToOklch({ L, a, b }: Oklab): Oklch {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

export function oklchToOklab({ L, C, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

/**
 * `color-mix(in oklch, <first> <percent>%, <second>)`.
 *
 * Hue takes the SHORTER arc, which is the CSS default for a polar space and the whole reason
 * this differs from the rectangular OKLab mix. Both endpoints here are opaque, so there is no
 * premultiplication step to model; if one is ever translucent this function must grow one
 * rather than quietly ignore it.
 *
 * The result is clamped into sRGB per channel. That is NOT the CSS gamut-mapping algorithm
 * (which reduces chroma in OKLCh), so a mix that leaves the gamut would be reported slightly
 * wrong here. `colorMixInOklchIsInGamut` exists so a test can prove that never happens for the
 * mixes this system actually ships, instead of assuming it.
 */
export function colorMixInOklch(first: Rgb, percentFirst: number, second: Rgb): Rgb {
  const p = percentFirst / 100;
  const a = oklabToOklch(rgbToOklab(first));
  const b = oklabToOklch(rgbToOklab(second));

  // Shorter hue arc. An achromatic endpoint has an undefined hue; CSS carries the other
  // endpoint's hue through, which keeps a mix toward white or black from swinging in hue.
  const ha = a.C < 1e-6 ? b.h : a.h;
  const hb = b.C < 1e-6 ? a.h : b.h;
  let delta = hb - ha;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;

  return oklabToRgb(
    oklchToOklab({
      L: a.L * p + b.L * (1 - p),
      C: a.C * p + b.C * (1 - p),
      h: ha + delta * (1 - p),
    }),
  );
}

/** True when the mix lands inside sRGB, so the per-channel clamp above changed nothing. */
export function colorMixInOklchIsInGamut(first: Rgb, percentFirst: number, second: Rgb): boolean {
  const p = percentFirst / 100;
  const a = oklabToOklch(rgbToOklab(first));
  const b = oklabToOklch(rgbToOklab(second));
  const ha = a.C < 1e-6 ? b.h : a.h;
  const hb = b.C < 1e-6 ? a.h : b.h;
  let delta = hb - ha;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;

  const lab = oklchToOklab({
    L: a.L * p + b.L * (1 - p),
    C: a.C * p + b.C * (1 - p),
    h: ha + delta * (1 - p),
  });
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  // A hair of tolerance: the endpoints themselves round-trip to within ~1e-9, and a mix that
  // sits exactly on the gamut boundary should not be called out of it by floating-point dust.
  return linear.every((c) => c >= -1e-6 && c <= 1 + 1e-6);
}

/** `color-mix(in oklab, ...)` — rectangular. Present ONLY so a test can demonstrate that it
 *  gives a different answer from the polar form, which is the defect this system nearly
 *  inherited. Nothing in the shipped CSS uses it. */
export function colorMixInOklab(first: Rgb, percentFirst: number, second: Rgb): Rgb {
  const p = percentFirst / 100;
  const a = rgbToOklab(first);
  const b = rgbToOklab(second);
  return oklabToRgb({
    L: a.L * p + b.L * (1 - p),
    a: a.a * p + b.a * (1 - p),
    b: a.b * p + b.b * (1 - p),
  });
}
