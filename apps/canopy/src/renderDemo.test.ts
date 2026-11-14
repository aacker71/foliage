import assert from "node:assert/strict";
import { test } from "node:test";

import { renderDemoPage } from "./renderDemo.ts";

test("theDemoStartsBlankBecauseItDoesNotInventArtifacts", () => {
  const html = renderDemoPage({ work: "" });

  assert.match(html, /data-canopy-surface="demo"/);
  assert.match(html, /data-demo-state="empty"/);
  assert.match(html, /class="magic-blur-fade"/);
  assert.match(html, /Paste work text to create a preview/);
  assert.doesNotMatch(html, /data-demo-leaflet="true"/);
});

test("theDemoRendersOnlySubmittedLinesAsPendingPreviewRows", () => {
  const html = renderDemoPage({
    work: "Shipped publication workflow\n\nReviewed <dangerous> launch text",
  });

  assert.match(html, /data-demo-state="preview"/);
  assert.match(html, /Preview artifacts<\/span><b class="fol-metric">2<\/b>/);
  assert.match(html, /Shipped publication workflow/);
  assert.match(html, /Reviewed &lt;dangerous&gt; launch text/);
  assert.doesNotMatch(html, /Reviewed <dangerous> launch text/);
  assert.equal([...html.matchAll(/data-demo-leaflet="true"/g)].length, 2);
  assert.equal([...html.matchAll(/data-pill-tier="pending"/g)].length, 2);
  assert.match(html, /no cryptographic authorship check/);
});
