/**
 * Reading the SHIPPED stylesheets back, so the tests measure the real file.
 *
 * Nothing in the test suite may hard-code a token value. The point of these tests is that a
 * ratio recorded in a comment is checked against the declaration sitting next to it — if the
 * test carried its own copy of the hex, it would agree with itself forever while the stylesheet
 * drifted. So every value comes from `src/*.css` at run time.
 *
 * COMMENTS ARE STRIPPED BEFORE ANYTHING ELSE, and that is not a detail. The token file
 * deliberately quotes superseded hexes in prose ("#67796E failed on all three", "#728579, the
 * superseded value"). A scanner that looked for colour literals without removing comments would
 * find those and report the file as full of raw literals — which is how a hygiene check gets
 * disabled for crying wolf.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type Rgb,
  colorMixInOklab,
  colorMixInOklch,
  colorMixInOklchIsInGamut,
  parseHex,
} from "./color.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Narrow away an `undefined` that only exists because the type system cannot see that a regex
 * with a mandatory capture group produced one. This THROWS rather than substituting a default:
 * a missing group means the parser and the stylesheet disagree about the file's shape, and
 * carrying on with `""` would turn that into a plausible measurement instead of an error.
 */
export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`expected ${what}`);
  return value;
}

/** Read one of this package's own source files. */
export function readSource(relativePath: string): string {
  return readFileSync(join(HERE, relativePath), "utf8");
}

/** `/* ... *\/` removed. CSS has no nestable comments, so a non-greedy pass is exact. */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** One top-level rule: everything before the brace, and everything inside it. */
export interface Rule {
  readonly prelude: string;
  readonly body: string;
}

/**
 * Split a stylesheet into its TOP-LEVEL rules by tracking brace depth, so an `@media` block
 * comes back whole rather than being confused with the rules inside it. A regex cannot do this
 * correctly, and the file has a `:root` inside `@media (prefers-reduced-motion)` that a naive
 * `:root\s*\{` match would happily return instead of the real one.
 */
export function topLevelRules(css: string): Rule[] {
  const source = stripComments(css);
  const rules: Rule[] = [];
  let depth = 0;
  let start = 0;
  let bodyStart = -1;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) bodyStart = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        rules.push({
          prelude: source.slice(start, bodyStart).trim(),
          body: source.slice(bodyStart + 1, i),
        });
        start = i + 1;
      }
    }
  }
  return rules;
}

/** The custom-property declarations in one rule body, in source order. */
export function customProperties(body: string): Map<string, string> {
  const out = new Map<string, string>();
  // Values may contain ':' (a ratio in a comment is gone by now, but `url(...)` and
  // `color-mix(...)` still contain commas and parens), so split on the FIRST colon only and
  // terminate on a semicolon that is not inside parentheses.
  let depth = 0;
  let buffer = "";
  const flush = () => {
    const text = buffer.trim();
    buffer = "";
    if (!text.startsWith("--")) return;
    const colon = text.indexOf(":");
    if (colon === -1) return;
    out.set(text.slice(0, colon).trim(), text.slice(colon + 1).trim());
  };
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === ";" && depth === 0) {
      flush();
      continue;
    }
    buffer += ch;
  }
  flush();
  return out;
}

/** The one real `:root` block — the largest, which is unambiguous here and stays correct if
 *  another at-rule ever adds a second. */
export function rootProperties(css: string): Map<string, string> {
  const roots = topLevelRules(css).filter((rule) => rule.prelude.split(",").some(selector => selector.trim() === ":root"));
  if (roots.length === 0) throw new Error("no top-level :root block");
  const biggest = roots.reduce((a, b) => (b.body.length > a.body.length ? b : a));
  return customProperties(biggest.body);
}

/** The declarations of the rule whose prelude is exactly `selector`. */
function ruleProperties(css: string, selector: string): Map<string, string> {
  const rule = topLevelRules(css).find((r) => r.prelude === selector);
  if (rule === undefined) throw new Error(`no rule with prelude ${JSON.stringify(selector)}`);
  return customProperties(rule.body);
}

// --- token resolution ------------------------------------------------------------------------

export type Face = "night" | "day";

const COLOR_MIX_RE =
  /^color-mix\(\s*in\s+(oklch|oklab)\s*,\s*var\((--[a-z0-9-]+)\)\s+([\d.]+)%\s*,\s*var\((--[a-z0-9-]+)\)\s*\)$/i;
const VAR_RE = /^var\(\s*(--[a-z0-9-]+)\s*\)$/;

/**
 * Resolves a token to the sRGB colour a browser paints, honouring the face.
 *
 * A face is not a second palette — it REBINDS primitives, so `--fol-verified` resolves through
 * `--fol-verified-day` on paper without the token being renamed. Modelling that here rather
 * than keeping two tables is the only way the day figures describe the same stylesheet the
 * night figures do.
 *
 * Anything that is not a hex, a `var()` or a supported `color-mix()` THROWS. A resolver that
 * quietly returned black for a form it did not understand would turn a broken token into a
 * plausible-looking measurement, which is the failure mode this whole file exists to prevent.
 */
export class TokenSheet {
  readonly root: Map<string, string>;
  readonly day: Map<string, string>;

  /**
   * `extraRootCss` lets the role layer be resolved through the same machinery as the
   * primitives, which is the only way to prove a role actually reaches a real colour. Roles are
   * merged into `root` rather than kept beside it because that is exactly what the cascade
   * does: both files declare on `:root`, and roles.css loads second.
   */
  constructor(tokensCss: string, ...extraRootCss: string[]) {
    this.root = rootProperties(tokensCss);
    this.day = ruleProperties(tokensCss, '[data-face="day"], .face-day');
    for (const css of extraRootCss) {
      for (const [name, value] of rootProperties(css)) this.root.set(name, value);
    }
  }

  /** Every token name declared in `:root`. */
  names(): string[] {
    return [...this.root.keys()];
  }

  raw(name: string, face: Face = "night"): string {
    const value = (face === "day" ? this.day.get(name) : undefined) ?? this.root.get(name);
    if (value === undefined) throw new Error(`token ${name} is not declared`);
    return value;
  }

  resolve(name: string, face: Face = "night", seen: Set<string> = new Set()): Rgb {
    if (seen.has(name)) throw new Error(`token cycle at ${name}`);
    seen.add(name);
    return this.resolveValue(this.raw(name, face), face, seen);
  }

  private resolveValue(value: string, face: Face, seen: Set<string>): Rgb {
    if (value.startsWith("#")) {
      if (value.length === 9) {
        throw new Error(
          `${value} carries alpha; it is a ground, not a measurable text colour — ` +
            "measure the composited result against a named ground instead",
        );
      }
      return parseHex(value);
    }
    const asVar = VAR_RE.exec(value);
    if (asVar !== null) return this.resolve(must(asVar[1], `a token name in ${value}`), face, seen);

    const mix = COLOR_MIX_RE.exec(value);
    if (mix !== null) {
      const [, space, first, percent, second] = mix;
      const a = this.resolve(must(first, "the first colour of a color-mix"), face, new Set(seen));
      const b = this.resolve(must(second, "the second colour of a color-mix"), face, new Set(seen));
      const p = Number.parseFloat(must(percent, "the percentage of a color-mix"));
      return must(space, "the color-mix space").toLowerCase() === "oklch"
        ? colorMixInOklch(a, p, b)
        : colorMixInOklab(a, p, b);
    }
    throw new Error(`cannot resolve value ${JSON.stringify(value)} to a colour`);
  }

  /** True when a `color-mix()` token stays inside sRGB, so no gamut mapping is being modelled
   *  incorrectly. Non-mix tokens are trivially in gamut. */
  mixIsInGamut(name: string, face: Face = "night"): boolean {
    const mix = COLOR_MIX_RE.exec(this.raw(name, face));
    if (mix === null) return true;
    const [, , first, percent, second] = mix;
    return colorMixInOklchIsInGamut(
      this.resolve(must(first, "a color-mix first colour"), face),
      Number.parseFloat(must(percent, "a color-mix percentage")),
      this.resolve(must(second, "a color-mix second colour"), face),
    );
  }

  /**
   * A size token in px. The scale is in rem and the root font size is not overridden anywhere
   * in this system, so 1rem is 16px. Resolving the SIZE from the same file as the colour is the
   * link that broke twice: a threshold picked from a remembered size rather than the rendered
   * one is how an 11px label got judged against the 24px rule.
   */
  px(name: string): number {
    let value = this.raw(name);
    const asVar = VAR_RE.exec(value);
    if (asVar !== null) value = this.raw(must(asVar[1], `a token name in ${value}`));
    const rem = /^([\d.]+)rem$/.exec(value);
    if (rem !== null) return Number.parseFloat(must(rem[1], "a rem length")) * 16;
    const px = /^([\d.]+)px$/.exec(value);
    if (px !== null) return Number.parseFloat(must(px[1], "a px length"));
    throw new Error(`${name} is not a length: ${value}`);
  }
}

/** The three stylesheets this package ships, read fresh. */
export function shippedStylesheets(): { name: string; css: string }[] {
  return ["tokens.css", "roles.css", "foliage.css"].map((name) => ({
    name,
    css: readSource(name),
  }));
}

/** The four SVG assets this package ships, read fresh. */
export function shippedSvgs(): { name: string; svg: string }[] {
  return [
    "foliage-sprite.svg",
    "mark-primary.svg",
    "mark-expressive.svg",
    "mark-icon.svg",
  ].map((name) => ({ name, svg: readSource(name) }));
}
