import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controls = readFileSync(new URL("./controls.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.css", import.meta.url), "utf8");
const radixTabs = readFileSync(new URL("./tabs.tsx", import.meta.url), "utf8");
const radixLabel = readFileSync(new URL("./label.tsx", import.meta.url), "utf8");
const tokenStyles = readFileSync(new URL("../../foliage-tokens/src/foliage.css", import.meta.url), "utf8");
const tokenPrimitives = readFileSync(new URL("../../foliage-tokens/src/tokens.css", import.meta.url), "utf8");

function declarations(css: string, selector: string): string {
  const rule = css.match(/([^{}]+)\{([^{}]*)\}/g)?.find((candidate) =>
    candidate.slice(0, candidate.indexOf("{")).split(",").some((part) => part.trim() === selector));
  assert.ok(rule !== undefined, `missing ${selector}`);
  return rule.slice(rule.indexOf("{") + 1, -1);
}

test("selected controls and keyboard options use the measured control edge", () => {
  for (const selector of [
    ".fol-button.fol-button-outline",
    ".fol-button.fol-button-secondary",
    ".fol-tabs-trigger[data-state=active]",
    ".fol-toggle-item[data-state=on]",
  ]) {
    assert.match(declarations(controls, selector), /border-color\s*:\s*var\(--fol-role-edge-control\)/,
      `${selector} needs the control edge rather than a decorative border`);
  }
  assert.match(declarations(controls, ".fol-select-item[data-highlighted]"),
    /outline\s*:\s*2px solid var\(--fol-role-edge-control\)/,
    "keyboard highlight needs more than the near-identical canvas and raised surfaces");
});

test("day-face focus rings reverse from accent to text on controls and workspace", () => {
  for (const [name, css] of [["controls", controls], ["workspace", workspace]] as const) {
    assert.match(css, /:is\(\[data-face=day\],\.face-day\)[^{]*:focus-visible\s*\{\s*outline-color\s*:\s*var\(--fol-text\)/,
      `${name} needs the measured day-face focus reversal`);
  }
});

test("the personal desktop rail keeps More and its footer reachable on short screens", () => {
  const css = workspace.replace(/\/\*[\s\S]*?\*\//g, "");
  const rail = declarations(css, ".fol-app .fol-workspace[data-plane=studio][data-layout=rail]");
  assert.match(rail, /overflow\s*:\s*hidden auto/, "a rail that cannot fit scrolls instead of clipping");
  assert.doesNotMatch(rail, /minmax\(0,/, "the tools row must not collapse below its own minimum");
  assert.match(declarations(css, ".fol-app .fol-workspace[data-plane=studio] .fol-workspace-tools"),
    /min-height\s*:\s*calc\(var\(--fol-role-height-control\)/, "the closed More row keeps its trigger");
  assert.match(declarations(css, ".fol-app .fol-workspace[data-plane=studio] .fol-workspace-tools[open]"),
    /min-height\s*:\s*calc\(3 \* var\(--fol-role-height-control\)/, "an open More shows its trigger and two tools");
  const short = css.match(/@media\(min-width:801px\) and \(max-height:720px\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(short, "short desktop screens need their own rail spacing");
  assert.match(short, /\[data-plane=studio\]\[data-layout=rail\]\s*\{\s*gap\s*:\s*var\(--fol-s-3\)/);
  const phone = css.match(/@media\(max-width:800px\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.match(phone ?? "", /\.fol-workspace-tools\[open\]\s*\{\s*min-height\s*:\s*0/, "the phone disclosure sizes to its list");
});

test("the five personal tabs share one row on a 320px phone instead of scrolling", () => {
  const css = workspace.replace(/\/\*[\s\S]*?\*\//g, "");
  const narrow = css.match(/@media\(max-width:374px\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(narrow, "narrow phones need their own primary-tab spacing");
  assert.match(declarations(narrow, ".fol-app .fol-workspace[data-plane=studio] .fol-workspace-nav"), /gap\s*:\s*0/);
  const tab = declarations(narrow, ".fol-app .fol-workspace[data-plane=studio] .fol-workspace-nav>a");
  assert.match(tab, /flex\s*:\s*1 1 auto/, "tabs share the leftover width, so short labels stay wide enough to tap");
  assert.match(tab, /padding-inline\s*:\s*var\(--fol-s-1\)/, "only the inline padding tightens");
  assert.doesNotMatch(tab, /min-height|font-size/, "targets and type stay at their phone size");
});

test("Radix Tabs root does not inherit the legacy token tablist border", () => {
  assert.match(tokenStyles, /\.fol-tabs\s*\{/);
  assert.match(radixTabs, /className=\{cn\("fol-tabset", className\)\}/);
  assert.doesNotMatch(controls, /\.fol-tabs\[/);
  assert.match(controls, /\.fol-tabset\[data-orientation=vertical\]/);
});

test("form labels do not override token metadata labels", () => {
  assert.match(tokenPrimitives, /\.fol-label\s*\{/);
  assert.match(radixLabel, /className=\{cn\("fol-form-label", className\)\}/);
  assert.match(controls, /\.fol-form-label\s*\{/);
  assert.doesNotMatch(controls, /\.fol-label\s*\{/);
});

test("shared controls do not reclaim token component classes", () => {
  const classes = (css: string) => new Set(
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.fol-[a-z][a-z0-9-]*/g)].map(match => match[0]),
  );
  const tokens = classes(tokenPrimitives + tokenStyles);
  const collisions = [...classes(controls)].filter(name => tokens.has(name));
  assert.deepEqual(collisions, [], `shared controls must not override token classes: ${collisions.join(", ")}`);
});
