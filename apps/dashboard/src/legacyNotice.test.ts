import assert from "node:assert/strict";
import { test } from "node:test";

import { withLegacyNotice } from "./legacyNotice.ts";

const NOTICE = '<aside class="legacy-notice" data-legacy-notice>Legacy view</aside>';
const LINK = '<link rel="stylesheet" href="/dashboard.css">';

test("the notice leads the content column of a composed app page, and its spacing is linked once", () => {
  const page = '<html><head><title>Alex</title></head><body class="fol-app"><nav>rail</nav>' +
    '<main id="leaf-main" class="leaf-main fol-app-main">\n<div class="fol-app-content"><h1>Alex</h1></div></main></body></html>';
  const out = withLegacyNotice(page, NOTICE);
  assert.ok(out.includes(`<div class="fol-app-content">${NOTICE}<h1>`), out);
  assert.ok(out.includes(`${LINK}</head>`), out);
  assert.equal(withLegacyNotice(out, NOTICE), out, "applying it twice changes nothing");
});

test("without a content column it leads <main>, then <body>, then a bare page after its title", () => {
  assert.equal(withLegacyNotice("<body><main><h1>Foliage</h1></main></body>", NOTICE), `<body><main>${NOTICE}<h1>Foliage</h1></main></body>`);
  assert.equal(withLegacyNotice('<body data-x="1"><p>hi</p></body>', NOTICE), `<body data-x="1">${NOTICE}<p>hi</p></body>`);
  // The dashboard's own refusals are one-line documents with no body tag.
  assert.equal(
    withLegacyNotice("<!doctype html><meta charset=utf-8><title>No review queue</title><p>absent</p>", NOTICE),
    `<!doctype html><meta charset=utf-8><title>No review queue</title>${NOTICE}<p>absent</p>`,
  );
  assert.equal(withLegacyNotice("<p>anything</p>", NOTICE), `${NOTICE}<p>anything</p>`);
});

test("a page with no body, main or title gets the notice after its doctype and meta, never before them", () => {
  // The dashboard's forged-request refusal had exactly this shape. A notice ahead of the doctype
  // puts the page in quirks mode.
  const refused = "<!doctype html><meta charset=utf-8><p>That request did not come from this page (origin). Nothing was changed.</p>";
  const out = withLegacyNotice(refused, NOTICE);
  assert.equal(out, `<!doctype html><meta charset=utf-8>${NOTICE}<p>That request did not come from this page (origin). Nothing was changed.</p>`);
  assert.ok(out.startsWith("<!doctype html>"), out);
  assert.equal(
    withLegacyNotice('<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="/i.svg"></head><p>x</p>', NOTICE),
    `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="/i.svg">${LINK}</head>${NOTICE}<p>x</p>`,
  );
});

test("a page that already carries the notice (the composed review page) is left exactly as it is", () => {
  const review = `<html><head></head><body><main><div class="fol-app-content rv-content">${NOTICE}<h1>Review</h1></div></main></body></html>`;
  assert.equal(withLegacyNotice(review, NOTICE), review);
});
