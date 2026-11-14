/**
 * The DAY-face text pairings this app uses, plus the arithmetic to check them.
 *
 * WHY THIS EXISTS. The public plane renders on paper, but every contrast ratio recorded in
 * `@foliage/tokens` was measured against the NIGHT canvas. Inverting the luminance of a
 * surface invalidates every ratio measured on it — a colour that reads comfortably on
 * near-black can be almost invisible on warm white. So a DAY-face surface cannot inherit the
 * night palette's clearances; it has to declare its own pairings and have them checked.
 *
 * The check is MECHANICAL rather than a review note because the failure it guards against has
 * already happened twice in this lineage, both times as correct arithmetic against the wrong
 * reference: `--fol-text-faint` passed once at 4.10:1 because the 3:1 large-text threshold was
 * applied to an 11px label, and its replacement passed a second review because only one of the
 * three night backgrounds it sits on was checked. Both are fixed in the token file now. A ratio
 * quoted without the background and the px size it is judged at is not a result, so
 * `wcagMinimum` takes the px size and the weight, and the test prints both alongside the ratio.
 *
 * Token VALUES are never copied here. The pairings name tokens; the test reads the real hexes
 * out of `@foliage/tokens` at run time, so this file cannot go stale the way a documented
 * palette does.
 */

/** A text colour, the background it sits on, and the size it is rendered at. */
export interface TextPairing {
  /** What on the page this is, so a failure names something findable. */
  readonly role: string;
  /** Token name of the text colour, e.g. `--fol-ink`. */
  readonly fg: string;
  /** Token name of the background, e.g. `--fol-paper`. */
  readonly bg: string;
  /**
   * Token name of the font size, resolved to px by the test. Naming the token rather than the
   * number means the threshold is chosen from the size the page ACTUALLY renders — the exact
   * link that broke last time.
   */
  readonly sizeToken: string;
  readonly bold: boolean;
}

/**
 * Every text pairing this app puts on screen. If the renderer introduces another one, it
 * belongs here — an unlisted pairing is an unchecked pairing.
 */
export const DAY_FACE_PAIRINGS: readonly TextPairing[] = Object.freeze([
  { role: "leaf subject (display)", fg: "--fol-ink", bg: "--fol-paper", sizeToken: "--fol-t-40", bold: false },
  { role: "leaf subject (display, <=26rem)", fg: "--fol-ink", bg: "--fol-paper", sizeToken: "--fol-t-32", bold: false },
  { role: "section heading", fg: "--fol-ink", bg: "--fol-paper", sizeToken: "--fol-t-25", bold: false },
  { role: "body copy", fg: "--fol-ink", bg: "--fol-paper", sizeToken: "--fol-t-16", bold: false },
  { role: "leaflet title", fg: "--fol-ink", bg: "--fol-paper", sizeToken: "--fol-t-16", bold: false },
  { role: "ledger metric", fg: "--fol-ink", bg: "--fol-paper", sizeToken: "--fol-t-25", bold: false },
  { role: "mono label", fg: "--fol-ink-muted", bg: "--fol-paper", sizeToken: "--fol-t-11", bold: false },
  { role: "mono label on sunk surface", fg: "--fol-ink-muted", bg: "--fol-paper-sunk", sizeToken: "--fol-t-11", bold: false },
  { role: "secondary copy", fg: "--fol-ink-muted", bg: "--fol-paper", sizeToken: "--fol-t-13", bold: false },
  // The tier legend's definitions. Same pairing as secondary copy, listed under its own role so
  // a failure names the surface it broke rather than sending a reader hunting for which 13px
  // muted text on paper was meant.
  { role: "tier legend definition", fg: "--fol-ink-muted", bg: "--fol-paper", sizeToken: "--fol-t-13", bold: false },
  // The disclosure that the density pass introduced. Same triple as secondary copy, listed under
  // its own role for the same reason the legend's is: the summary is the ONLY thing a reader sees
  // of a closed drawer, so a failure here has to name the affordance rather than send someone
  // hunting for which 13px muted text on paper broke. Duplication of an already-passing pairing is
  // the point — an unlisted pairing is an unchecked one, and this file is the list.
  { role: "disclosure summary", fg: "--fol-ink-muted", bg: "--fol-paper", sizeToken: "--fol-t-13", bold: false },
  { role: "publish rule reason", fg: "--fol-ink-muted", bg: "--fol-paper", sizeToken: "--fol-t-13", bold: false },
  { role: "document footer", fg: "--fol-ink-muted", bg: "--fol-paper", sizeToken: "--fol-t-11", bold: false },
  { role: "exclusion reason", fg: "--fol-ink", bg: "--fol-paper-sunk", sizeToken: "--fol-t-13", bold: false },
  { role: "provenance detail", fg: "--fol-ink", bg: "--fol-paper", sizeToken: "--fol-t-13", bold: false },
  { role: "proof pill label", fg: "--fol-ink", bg: "--fol-paper", sizeToken: "--fol-t-11", bold: false },
  { role: "example band", fg: "--fol-ink", bg: "--fol-paper-sunk", sizeToken: "--fol-t-13", bold: false },
  { role: "failure detail (mono block)", fg: "--fol-ink", bg: "--fol-paper-sunk", sizeToken: "--fol-t-13", bold: false },
]);

/**
 * The semantic proof tokens. They carry tier MEANING and are used here as fills and rules
 * only — never as a text colour on the DAY face, where all three fail AA at label size.
 * Measured against `--fol-paper` at 11px, where the requirement is 4.5:1:
 *
 *   --fol-verified (= --fol-accent)  1.68:1
 *   --fol-pending                    3.03:1
 *   --fol-excluded                   3.18:1
 *
 * Those numbers are why `DAY_FACE_PAIRINGS` contains none of them. A structural test enforces
 * the exclusion, so this cannot be undone by editing a comment.
 *
 * The DAY-face counterparts these were waiting on now exist in `@foliage/tokens`:
 * `--fol-verified-day`, `--fol-pending-day`, `--fol-excluded-day`. They are NOT listed here
 * yet, and that is not an oversight — this array is an inventory of what THIS app actually
 * renders, and it does not render a day-face proof pill today. The surface that first paints
 * one adds its row here, with the size token it renders at. Note the constraint recorded
 * beside those tokens: they are measured clear on `--fol-paper` and `--fol-paper-sunk`, and
 * NOT on `--fol-paper-raised`.
 */
export const SEMANTIC_PROOF_TOKENS: readonly string[] = Object.freeze([
  "--fol-verified",
  "--fol-pending",
  "--fol-excluded",
]);

/** WCAG 2.1 AA contrast minimum for normal text. */
export const AA_NORMAL = 4.5;
/** WCAG 2.1 AA contrast minimum for large text — 14pt bold or 18pt regular, and no smaller. */
const AA_LARGE = 3;

/**
 * The threshold a pairing must meet, chosen from its rendered size.
 *
 * This function is the fix for a specific recorded error: 4.10:1 was accepted for an 11px
 * label because the large-text threshold was applied to it. Large text means >= 18.66px bold
 * or >= 24px regular. Anything else is normal text and needs 4.5:1.
 */
export function wcagMinimum(px: number, bold: boolean): number {
  if (bold && px >= 18.66) return AA_LARGE;
  if (!bold && px >= 24) return AA_LARGE;
  return AA_NORMAL;
}

/** Parse `#rgb` or `#rrggbb` into 0–255 channels. Returns null rather than throwing. */
export function parseHex(hex: string): readonly [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const body = m[1]!;
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function relativeLuminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two hex colours, or null if either colour cannot be parsed.
 *
 * Null rather than a default: a pairing whose colour could not be read has an UNKNOWN ratio,
 * and returning 21 or 1 would be inventing a result. The caller reports the parse failure as
 * a parse failure.
 */
export function contrastRatio(fgHex: string, bgHex: string): number | null {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  if (fg === null || bg === null) return null;
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Read a custom property out of a CSS source, following one level of `var()` indirection —
 * `--fol-verified: var(--fol-accent)` has to resolve to a hex or the check is vacuous.
 * Returns null when the property is absent or does not bottom out in a literal.
 */
export function resolveTokenValue(css: string, name: string, depth = 0): string | null {
  if (depth > 4) return null;
  const re = new RegExp(`${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`);
  const m = re.exec(css);
  if (!m) return null;
  const raw = m[1]!.trim();
  const indirect = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw);
  if (indirect) return resolveTokenValue(css, indirect[1]!, depth + 1);
  return raw;
}

/**
 * Resolve a `rem` size token to px. Returns null for anything that is not a plain rem value,
 * because guessing is how a threshold gets applied to the wrong size.
 */
export function remTokenToPx(value: string, rootPx = 16): number | null {
  const m = /^(\d*\.?\d+)rem$/.exec(value.trim());
  if (!m) return null;
  return Number.parseFloat(m[1]!) * rootPx;
}
