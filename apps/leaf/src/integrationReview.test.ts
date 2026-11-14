/** Adversarial renderer inputs only; these are not provider records or portfolio results. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { leafId } from "@foliage/leaf";
import { importObservationBatch, parseObservationBatch } from "./integrationImport.ts";
import { renderReviewPage } from "./render.ts";

function importedReview() {
  const subject = { id: leafId("adversarial-render-target"), subject: "Renderer input", leaflets: [] };
  const batch = parseObservationBatch({
    format: "foliage-observations", version: 1,
    subject: { leafId: subject.id, name: subject.subject },
    source: { provider: "adversarial-input", tenantId: "test-tenant", accountId: "test-account" },
    completion: "complete", deletedRecordIds: [],
    observations: [{
      recordId: "test-record", revision: "test-revision", title: "Adversarial disclosure input",
      excerpt: `First line & <img src=x onerror="throw 'unsafe'">\n${"Long input. ".repeat(1000)}End of supplied excerpt.`,
      observedAt: "2026-09-08T00:00:00Z",
    }],
  });
  return importObservationBatch(batch, subject, null).document;
}

test("browser review discloses full imported text and declared identities before approval, escaping markup", () => {
  const harvest = importedReview();
  const candidate = harvest.candidates[0]!;
  const html = renderReviewPage({ ok: true, harvest, path: "/private/adversarial-harvest.json" });
  const card = html.slice(html.indexOf('data-review-state="candidate"'));
  assert.ok(card.includes('data-import-disclosure'));
  assert.match(card, /identities declared and unverified/);
  assert.match(card, /provider and source permission not checked/);
  assert.match(card, /approval does not publish/);
  assert.ok(card.indexOf('data-import-disclosure') < card.indexOf("<form"), "notice precedes the decision controls");
  assert.equal((html.match(/<form class="review-form" method="post" action="\/review">/g) ?? []).length, 1,
    "an imported draft has one decision form after its complete disclosure");
  assert.doesNotMatch(card, /class="btn btn-ghost review-jump"/, "imported text is read in full before any decision shortcut");
  assert.match(card, /integration:adversarial-input/);
  assert.match(card, /&quot;test-tenant&quot;,&quot;test-account&quot;,&quot;test-record&quot;,&quot;test-revision&quot;/);
  // The visible Ref is words; the exact key stays one click away, not a raw JSON array on the card.
  assert.match(card, /<span title="integration-record:[^"]*">Imported record<\/span><details class="review-full-ref"><summary>Full reference<\/summary><code class="fol-metric">integration-record:\[&quot;adversarial-input&quot;/);
  assert.match(card, /2026-09-08T00:00:00Z/);
  assert.ok(card.includes('First line &amp; &lt;img src=x onerror=&quot;throw &#39;unsafe&#39;&quot;&gt;'));
  assert.ok(!card.includes("<img src=x"), "source markup must not create an element");
  const excerpt = /<dd data-verbatim="evidence-excerpt">([\s\S]*?)<\/dd>/.exec(card)?.[1];
  assert.ok(excerpt, "the body text that promotion consumes must be visible");
  assert.ok(excerpt.endsWith("End of supplied excerpt."), "long excerpts must not be truncated");
  assert.equal((excerpt.match(/Long input\. /g) ?? []).length, 1000);
  assert.ok(card.indexOf("End of supplied excerpt.") < card.indexOf("<form"));
  assert.equal(candidate.review.state, "candidate");
});

test("retitling an imported observation cannot remove its declaration notice or excerpt", () => {
  const original = importedReview();
  const candidate = original.candidates[0]!;
  const harvest = { ...original, candidates: [{ ...candidate,
    title: "Reviewer-chosen title", extractor: "reviewer:Adversarial reviewer",
    review: { state: "approved" as const, by: "Adversarial reviewer", at: "2026-09-08T00:01:00Z" },
  }] };
  const html = renderReviewPage({ ok: true, harvest, path: "/private/adversarial-harvest.json" });
  assert.match(html, /Reviewer-chosen title/);
  assert.match(html, /data-import-disclosure/);
  assert.match(html, /declared and unverified/);
  assert.match(html, /data-verbatim="evidence-excerpt"/);
  assert.match(html, /End of supplied excerpt\./);
  assert.ok(!html.includes("<img src=x"));
});
