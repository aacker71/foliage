/**
 * The review page's design invariants, pinned as tests because "remembered" is how each
 * of them was broken once already.
 *
 * These are NOT a substitute for measuring the running page — contrast, fonts and layout
 * are checked in a real browser by `tools/verify` — but they are the parts that can be
 * decided from the markup alone, and a unit test catches them before a browser is open.
 *
 * The input below is a test fixture built through the REAL parser, so a shape the product
 * would refuse cannot silently become the thing these tests assert about. It is an input,
 * never presented as a result.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseHarvestDocument, HARVEST_SCHEMA_VERSION } from "./harvestDocument.ts";
import { LEGACY_NOTICE_TEXT, renderReviewPage, renderErrorPage, type PageAssets } from "./renderReview.ts";

/** Stand-ins for the two package files the server inlines, distinctive enough to find. */
const ASSETS: PageAssets = {
  sprite: '<svg class="fol-sprite" aria-hidden="true"><defs><symbol id="i-check"/></defs></svg>',
};

function harvest(candidates: readonly unknown[]) {
  const parsed = parseHarvestDocument({
    schemaVersion: HARVEST_SCHEMA_VERSION,
    subject: "A Subject",
    identity: "subject@example.com",
    sources: ["/tmp/repo"],
    gatheredAt: "2026-08-16T12:00:00Z",
    candidates,
  });
  assert.equal(parsed.ok, true, "fixture must be a harvest the product would accept");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.harvest;
}

function candidate(id: string, patch: Record<string, unknown> = {}): unknown {
  return {
    id,
    drafted: { title: `Candidate ${id}`, summary: "One drafted sentence about the work." },
    evidence: [{ source: "git", ref: `${id}0123456789abcdef`, excerpt: "feat: the commit subject" }],
    provenance: { method: "local_llm", model: "gemma4:12b", ranLocally: true },
    status: "proposed",
    ...patch,
  };
}

/** Everything the page renders, in every review state at once. */
function fullPage(): string {
  return renderReviewPage(
    harvest([
      candidate("ps-1"),
      candidate("ps-2"),
      candidate("ps-3"),
      candidate("ps-4", { status: "approved", reviewedAt: "2026-08-16T13:00:00Z" }),
      candidate("ps-5", {
        status: "approved",
        reviewedAt: "2026-08-16T13:00:00Z",
        promotedAt: "2026-08-16T13:05:00Z",
      }),
      candidate("ps-6", { status: "rejected", reviewedAt: "2026-08-16T13:01:00Z" }),
    ]),
    "csrf-token",
    ASSETS,
  );
}

test("theIdentityMarkIsOnThePage", () => {
  // THE DEFECT THIS PINS: the review surface rendered no Foliage mark at all. A browser
  // check found it, not a test, because nothing asserted the lockup existed.
  const html = fullPage();
  assert.match(html, /class="fol-workspace-mark"/);
  assert.ok(html.includes(ASSETS.sprite), "the icon sprite must be inlined, not linked");
  // The refusal page is a surface too, and it was the one most likely to be forgotten.
  assert.match(renderErrorPage("Refused", "why", ASSETS), /class="fol-workspace-mark"/);
});

test("nothingOnThePageIsFetchedFromAnotherHost", () => {
  // ZERO RUNTIME NETWORK CALLS is a product claim. The Open Design prototype this screen
  // follows links fonts.googleapis.com; that must never cross into a served page. The
  // injected assets are removed first so this measures THIS module's own output.
  const html = fullPage().split(ASSETS.sprite).join("");
  assert.equal(html.match(/https?:\/\//g), null);
  assert.equal(html.match(/(?:src|href)\s*=\s*"\/\//g), null);
  assert.equal(html.match(/@import/g), null);
  // Every stylesheet is same-origin and comes from the package export map or public/.
  assert.deepEqual(
    [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]),
    ["/tokens.css", "/roles.css", "/foliage.css", "/controls.css", "/workspace-shell.css", "/review.css"],
  );
});

test("theAccentBudgetHoldsWhateverTheQueueLength", () => {
  // A DEFECT WHEN BROKEN: --fol-accent appears at most twice per screen. Three ways an
  // element can carry it — the solid button, the verified proof badge, and .acc — counted
  // on a page with three open candidates, which is exactly where a per-card accent CTA
  // would blow the budget.
  const html = fullPage();
  const accent = (html.match(/\bbtn-primary\b|\bproof-verified\b|class="acc"/g) ?? []).length;
  assert.ok(accent <= 2, `accent-bearing elements: ${accent}`);
  // ...and the one that is there is the promotion CTA, not a per-candidate control.
  assert.match(html, /<button class="btn btn-primary" type="submit">[^<]*<svg[\s\S]*?to leaf<\/button>/);
  assert.equal((html.match(/rv-approve/g) ?? []).length, 3, "one ghost Approve per open candidate");
});

test("a reviewer opens the cited evidence before the decision controls", () => {
  const proposed = fullPage().match(/<article[^>]*data-status="proposed"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(proposed, /<summary class="rv-evidence-label">Review draft<\/summary>/);
  assert.ok(proposed.indexOf("rv-ev__text") < proposed.indexOf('action="/decide"'));
  assert.ok(proposed.indexOf('action="/decide"') < proposed.indexOf("</details>"));
});

test("theTwoColourAxesStayApart", () => {
  // Review state (chip) and proof tier (.proof) are different claims. A proof class must
  // never stand in for a verdict: `excluded` means "could not be attributed", not
  // "rejected", and `verified` is signature-only — nothing in a harvest can earn it.
  const html = fullPage();
  assert.equal(html.match(/proof-verified|proof-excluded/g), null);
  // The only proof badge is on the promoted candidate, and it says what promotion wrote.
  assert.equal((html.match(/proof proof-pending/g) ?? []).length, 1);
  assert.match(html, /data-in-leaf="true"[\s\S]*?proof proof-pending/);
});

test("everyCountIsMonoTabular", () => {
  // A metric not set in mono tabular-nums is a defect. Every number this page renders is
  // a count, and each one is wrapped: the readout rows, the section totals, and the
  // number inside the promote button.
  const html = fullPage();
  const counts = [...html.matchAll(/>(\d+)</g)].map((m) => m[0]);
  assert.ok(counts.length > 0);
  for (const [, value] of html.matchAll(/>(\d+)</g)) {
    const at = html.indexOf(`>${value}<`);
    const before = html.slice(Math.max(0, at - 120), at);
    assert.match(before, /fol-metric/, `a bare number "${value}" is rendered outside .fol-metric`);
  }
});

test("noScoreRatingOrPercentageAnywhere", () => {
  // FCRA posture, and it is load-bearing: no score is ever computed or displayed, in a
  // field or in prose. Same shapes the browser probe looks for.
  const html = fullPage();
  assert.equal(html.match(/\b(rated|ranked|scored|graded|percentile|confidence)\b/gi), null);
  assert.equal(html.match(/\d+\s*%/g), null);
  assert.equal(html.match(/\b\d+\s*\/\s*\d+\b/g), null);
});

test("anEmptyHarvestSaysSoInsteadOfLookingBroken", () => {
  const html = renderReviewPage(harvest([]), "csrf-token", ASSETS);
  assert.match(html, /No candidates for/);
  assert.equal(html.match(/rv-cell/g), null);
  // Still branded, still says where it runs.
  assert.match(html, /class="fol-workspace-mark"/);
  assert.match(html, /Local · loopback only/);
});

test("thePromoteControlSaysItLandsPendingAndDoesNotPublish", () => {
  // Promotion writes `pending` into the leaf and publishes nothing. The page must say so
  // BEFORE the click, beside the button — the same fact /review carries on the other surface.
  const html = fullPage();
  const form = html.match(/<form method="post" action="\/promote">[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.match(form, /to leaf<\/button>/);
  assert.match(form, /Lands as pending · not published/);
  const nothingToPromote = renderReviewPage(harvest([candidate("ps-1")]), "csrf-token", ASSETS);
  assert.doesNotMatch(nothingToPromote, /action="\/promote"/);
});

test("aPromotedCandidateIsAddedAndPendingNeverLive", () => {
  // Promotion writes a `pending` leaflet and publishes nothing, so "Live" was a false claim.
  const html = fullPage();
  assert.doesNotMatch(html, /\bLive\b/);
  const promoted = html.match(/<article[^>]*data-in-leaf="true"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(promoted, /<span class="chip chip--added" data-chip="added">Added<\/span>/);
  assert.match(promoted, /pending in the leaf/);
  // Each date says what it is, readably; the exact instant stays machine-readable.
  assert.match(
    promoted,
    /Approved <time datetime="2026-08-16T13:00:00Z">16 Aug 2026<\/time> · added to the leaf <time datetime="2026-08-16T13:05:00Z">16 Aug 2026<\/time>/,
  );
  assert.doesNotMatch(html.replace(/datetime="[^"]*"/g, ""), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});

test("everyPageSaysItIsALegacyViewAndWhereTheCurrentAppIs", () => {
  const notice = /<aside class="fol-feedback-notice legacy-notice" data-legacy-notice aria-label="Legacy view">[\s\S]*?<code>foliage up<\/code>[\s\S]*?<code>\/review<\/code>[\s\S]*?<\/aside>/;
  for (const html of [fullPage(), renderReviewPage(harvest([]), "csrf-token", ASSETS), renderErrorPage("Refused", "why", ASSETS)]) {
    assert.match(html, notice);
    // At the top of the content, before the page's own heading.
    assert.ok(html.indexOf("data-legacy-notice") < html.indexOf("<h1"), "the notice leads the content");
  }
  assert.match(LEGACY_NOTICE_TEXT, /^Legacy view\. The current app is foliage up \(node foliage\.mjs up\); review drafts there at \/review\.$/);
});

test("aRefusalOfTheQueueItselfPointsToTheCurrentAppInsteadOfBackToItself", () => {
  // Back goes to "/", the queue page; when the queue page is the refusal, Back is a loop.
  const back = renderErrorPage("Refused", "why", ASSETS);
  assert.match(back, /<a class="btn btn-ghost" href="\/">Back<\/a>/);
  const current = renderErrorPage("Review this queue in foliage up", "This review queue is in the current format.", ASSETS, "current-app");
  assert.doesNotMatch(current, />Back</);
  assert.match(current, /<p class="rv-next">Review it in the current app: run <code>node foliage\.mjs up<\/code>, then open <code>\/review<\/code>\.<\/p>/);
});
