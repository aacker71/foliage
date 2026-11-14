/**
 * THE BRIDGE RESOLVES — every `--fol-*` the shadcn theme names is a token that actually exists.
 *
 * WHY THIS IS A TEST AND NOT A REVIEW HABIT. A `var(--fol-does-not-exist)` is not an error. CSS
 * resolves it to nothing, the property falls back to its initial value, and the page paints a
 * browser default with no warning in any console, any build log, or any type checker. It looks
 * like a design decision.
 *
 * MEASURED WHILE WRITING THE BRIDGE: the first draft named `--fol-line` and `--fol-font-serif`.
 * NEITHER EXISTS — the design system calls them `--fol-border` and `--fol-font-display` — so every
 * border on the marketing site and its display face would have silently been the browser default,
 * on a page whose entire job is to look like the product. This file is the only thing standing
 * between that and a shipped landing page.
 *
 * It also enforces the standing rule the bridge exists to honour: IMPORT, NEVER COPY. A literal
 * colour in the theme layer is a second source of truth that stops tracking the design system the
 * first time either changes.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const THEME = fileURLToPath(new URL("../app/foliage-theme.css", import.meta.url));
const TOKENS = fileURLToPath(new URL("../../../packages/foliage-tokens/src/tokens.css", import.meta.url));

const theme = (): string => readFileSync(THEME, "utf8");
const tokens = (): string => readFileSync(TOKENS, "utf8");

test("public proof copy separates attribution from cryptographic verification", () => {
  const explanation = readFileSync(new URL("../app/(site)/why-foliage/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(explanation, /not yet attributed/i,
    "pending work is already attributed to a declared identity");
  assert.match(explanation, /cryptographically established/i);
  assert.match(explanation, /bound the signer to a/i,
    "verified requires the accepted signature's signer to match a declared identity");
});

/** Every custom property the design system DEFINES. */
function definedTokens(): ReadonlySet<string> {
  return new Set([...tokens().matchAll(/(--fol-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

/** Every design-system token the bridge READS. */
function referencedTokens(): readonly string[] {
  return [...new Set([...theme().matchAll(/var\((--fol-[a-z0-9-]+)\)/g)].map((m) => m[1]!))].sort();
}

test("every --fol-* the theme references is defined by @foliage/tokens", () => {
  const defined = definedTokens();
  const referenced = referencedTokens();
  assert.ok(referenced.length > 0, "the bridge references no tokens at all — it is not bridging anything");
  const missing = referenced.filter((t) => !defined.has(t));
  assert.deepEqual(
    missing,
    [],
    `the theme names ${missing.length} token(s) the design system does not define, which CSS resolves ` +
      `to nothing and paints as a browser default with no error anywhere: ${missing.join(", ")}`,
  );
});

test("the theme IMPORTS the tokens rather than copying them", () => {
  // The import is what makes a change in the design system reach this surface with no second edit.
  assert.match(theme(), /@import\s+["']@foliage\/tokens\/tokens\.css["']/);
});

test("no literal colour appears in the theme — a hex is a second source of truth", () => {
  // Every colour must arrive through a token. A `#hex` here would stop tracking the design system
  // the first time either changed, which is the drift `roles.css` and the canopy's own stylesheet
  // history both record as having actually happened.
  const withoutComments = theme().replace(/\/\*[\s\S]*?\*\//g, "");
  const hexes = [...withoutComments.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(hexes, [], `literal colour(s) in the theme layer: ${hexes.join(", ")}`);
  for (const fn of ["rgb(", "rgba(", "hsl(", "hsla(", "oklch("]) {
    assert.ok(!withoutComments.includes(fn), `literal ${fn}…) in the theme layer — use a token`);
  }
});

test("the shadcn contract is covered — a component pasted in unmodified finds its variables", () => {
  /*
   * shadcn components read a fixed set of names. A missing one is not a crash: the component
   * renders with an unset colour, which on a dark surface is routinely invisible text. These are
   * the names its default components actually consume.
   */
  const required = [
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--secondary-foreground",
    "--muted",
    "--muted-foreground",
    "--accent",
    "--accent-foreground",
    "--destructive",
    "--border",
    "--input",
    "--ring",
  ];
  const declared = new Set([...theme().matchAll(/^\s*(--[a-z-]+)\s*:/gm)].map((m) => m[1]!));
  const absent = required.filter((n) => !declared.has(n));
  assert.deepEqual(absent, [], `shadcn reads these and the theme does not declare them: ${absent.join(", ")}`);
});

test("the @theme block is `inline`, or the day face silently does nothing", () => {
  /*
   * Tailwind 4 snapshots a non-inline `@theme` at build time. The Foliage faces work by REBINDING
   * the primitives under `[data-face="day"]` at runtime, so a snapshot would freeze the night
   * values and the published face would change nothing — with no error, which is the same silent
   * class as a missing token.
   */
  assert.match(theme(), /@theme\s+inline\s*\{/);
});

/* ------------------------------------------------- the gap these tests had ---------------- */

/*
 * WHY THESE EXIST, and it is not a flattering reason. The five tests above passed while THREE
 * token-layer defects sat in `globals.css` and shipped: a literal self-reference
 * (`--font-sans: var(--font-sans)`), a second radius scale derived with `calc()` alongside the
 * design system's own, and a `dark` variant bound to a `.dark` class that never appears in the
 * markup. A reviewer found all three.
 *
 * The tests were too narrow rather than wrong: they checked that every `--fol-*` REFERENCE resolves
 * and that no literal colour appears. None of the three defects is either of those things. Each is
 * a variable that resolves to nothing, or a second source of truth that resolves to the wrong
 * thing — the exact failure class the bridge exists to prevent, one level up from where I was
 * looking.
 */

const globals = (): string =>
  readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

test("no custom property is defined as a reference to ITSELF", () => {
  // `--font-sans: var(--font-sans)` is not a no-op, it is undefined: the property has no value to
  // fall back to, so the browser paints its default. Silent, exactly like a missing token.
  const selfRefs = [...globals().matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*var\(\1\)/gm)].map((m) => m[1]!);
  assert.deepEqual(selfRefs, [], `self-referencing custom propert(ies): ${selfRefs.join(", ")}`);
});

test("the radius scale comes from the design system, not from calc() on a base", () => {
  // shadcn derives its ramp as calc(var(--radius) * 0.6) and up. Foliage ships --fol-r-1..4 as
  // measured values. Keeping both means two radius scales that drift the first time either moves —
  // the same second-source-of-truth defect as two palettes, which this bridge already removed once.
  const derived = [...globals().matchAll(/^\s*(--radius-[a-z0-9]+)\s*:\s*calc\(/gm)].map((m) => m[1]!);
  assert.deepEqual(derived, [], `radius token(s) derived by calc() instead of a --fol-r-* token: ${derived.join(", ")}`);
});

test("the dark variant binds to the product's face, not to a class nothing sets", () => {
  // `@custom-variant dark (&:is(.dark *))` waits for a `.dark` ancestor that no Foliage surface ever
  // renders, so every `dark:` utility silently does nothing. Foliage's mechanism is `data-face`, and
  // night IS the product's private face rather than an operating-system preference.
  const css = globals();
  if (!css.includes("@custom-variant dark")) return; // the variant may legitimately be removed
  assert.doesNotMatch(css, /@custom-variant\s+dark\s*\(&:is\(\.dark/, "dark variant bound to an unused .dark class");
  assert.match(css, /@custom-variant\s+dark[\s\S]{0,80}data-face/, "dark variant should bind to data-face");
});
