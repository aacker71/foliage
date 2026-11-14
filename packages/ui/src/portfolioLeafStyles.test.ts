import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portfolio = readFileSync(new URL("./portfolio-leaf.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(selector: string): string {
  const rule = portfolio.match(/([^{}]+)\{([^{}]*)\}/g)?.find((candidate) =>
    candidate.slice(0, candidate.indexOf("{")).split(",").some((part) => part.trim() === selector));
  assert.ok(rule !== undefined, `missing ${selector}`);
  return rule.slice(rule.indexOf("{") + 1, -1);
}

test("the sticky leaf canvas ends with its journey so the disclosures after it open by mouse", () => {
  const visual = declarations(".lp-visual");
  assert.match(visual, /position\s*:\s*sticky/, "the canvas stays beside the records while they scroll");
  assert.match(visual, /margin-bottom\s*:\s*calc\(-1 \* var\(--lp-viewport\)\)/,
    "the records still start over the canvas, so it keeps its hits between record panels");
  const journey = declarations(".lp-journey");
  assert.match(journey, /overflow-y\s*:\s*clip/,
    "without a clip the viewport-tall canvas overhangs the journey and swallows clicks on What Pending means and Publication");
  assert.doesNotMatch(journey, /overflow(?:-[xy])?\s*:\s*(?:hidden|auto|scroll)/,
    "a scroll container would stop the canvas sticking");
});
