/** Protocol-only publication inputs. These are not a person's achievements or demo results. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { leafId, leafletId, ACHIEVEMENT_CLAIM_KINDS, ACHIEVEMENT_CLAIM_LABELS, type AchievementClaimKind, type Leaf } from "@foliage/leaf";
import { reviewForPublication } from "./publish.ts";
import { buildPublishedDocument } from "./publishedDocument.ts";
import { distributionProjection, distributionMarkdown } from "./distribution.ts";
const provenance = { source: "git", ref: "protocol-ref", observedAt: "2026-09-23T00:00:00.000Z" };
function document(kind: AchievementClaimKind = "contribution") {
  const leaf: Leaf = { id: leafId("protocol-resume"), subject: "Publication protocol input", headline: "Declared headline",
    achievements: [{ id: "achievement", title: "Protocol <title>", claims: [{ id: "claim", kind, text: "Protocol [claim] text", citations: [{ leaflet: leafletId("evidence"), provenance }] }] }],
    leaflets: [{ id: leafletId("evidence"), title: "Citation protocol input", tier: "pending", visibility: "public", body: [{ text: "Citation input", provenance }] }] };
  const review = reviewForPublication({ leaf, declaredExample: false, includePortfolio: true }); assert.ok(review.ok);
  const built = buildPublishedDocument({ review, publishedAt: provenance.observedAt, documentDigest: `sha256:${"a".repeat(64)}`, policyDigest: `sha256:${"b".repeat(64)}`, documentBytes: 1 }); assert.ok(built.ok); return built.document;
}
test("distribution reuses admitted claim/citation anchors and omits source digests, private extras and style", () => {
  const source = document();
  const view = distributionProjection({ ...source, privateNote: "SECRET" } as typeof source, "https://portfolio.example");
  assert.equal(view.achievements.length, 1);
  assert.match(view.achievements[0]!.claims[0]!.url, /#claim-/);
  assert.match(view.achievements[0]!.claims[0]!.citations[0]!.url, /#citation-/);
  assert.doesNotMatch(JSON.stringify(view), /SECRET|documentDigest|policyDigest|withheld/);
  const markdown = distributionMarkdown(view);
  assert.match(markdown, /Protocol \\\[claim\\\] text/); assert.match(markdown, /Evidence 1/);
  assert.match(markdown, /do not independently verify/); assert.match(markdown, /snapshot/);
  assert.throws(() => distributionProjection(source, "http://portfolio.example"));
});
test("unpublished achievements have an honest empty state without inventing work", () => {
  const source = document();
  const view = distributionProjection({ ...source, leaf: { ...source.leaf, portfolio: {} } }, "https://portfolio.example");
  assert.equal(view.achievements.length, 0);
  assert.match(distributionMarkdown(view), /No achievement statements/);
});
test("every journey category survives publication admission and the evidence-linked resume projection", () => {
  for (const kind of ACHIEVEMENT_CLAIM_KINDS) {
    const view = distributionProjection(document(kind), "https://portfolio.example");
    assert.equal(view.achievements[0]!.claims[0]!.kind, kind);
    assert.equal(view.achievements[0]!.claims[0]!.citations.length, 1);
    assert.ok(distributionMarkdown(view).includes(ACHIEVEMENT_CLAIM_LABELS[kind]));
  }
});
