/** Protocol inputs only: no invented career record or ATS acceptance. */
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { leafId, leafletId, ACHIEVEMENT_CLAIM_KINDS, ACHIEVEMENT_CLAIM_LABELS, type Leaf } from "@foliage/leaf";
import { reviewForPublication, buildPublishedDocument, distributionProjection } from "@foliage/canopy";
import { publicResumeDocx } from "./distributionDocx.ts";

function admitted() {
  const provenance = { source: "git", ref: "protocol-ref", observedAt: "2026-10-05T00:00:00Z" };
  const leaf: Leaf = { id: leafId("word-protocol"), subject: "Word layout input", headline: "Document export test",
    achievements: [{ id: "work", title: "Protocol <title> & 日本語", claims: ACHIEVEMENT_CLAIM_KINDS.map(kind => ({
      id: kind, kind, text: `Protocol ${kind} statement with café and emoji 🌿.`, citations: [{ leaflet: leafletId("citation"), provenance }],
    })) }], leaflets: [{ id: leafletId("citation"), title: "Protocol citation", visibility: "public", tier: "pending", body: [{ text: "Protocol evidence", provenance }] }] };
  const review = reviewForPublication({ leaf, declaredExample: false, includePortfolio: true }); assert.ok(review.ok);
  const result = buildPublishedDocument({ review, publishedAt: provenance.observedAt, documentDigest: `sha256:${"a".repeat(64)}`, policyDigest: `sha256:${"b".repeat(64)}`, documentBytes: 1 });
  assert.ok(result.ok); return result.document;
}

test("Word preserves admitted claim categories, Unicode and actual portfolio/evidence hyperlinks", async () => {
  const document = admitted(), origin = "https://resume.example";
  const zip = await JSZip.loadAsync(await publicResumeDocx(document, origin));
  const xml = await zip.file("word/document.xml")!.async("string");
  const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
  assert.match(xml, /Protocol &lt;title&gt; &amp; 日本語/);
  assert.match(xml, /café and emoji 🌿/);
  assert.match(xml, /w:pStyle w:val="Title"/);
  assert.match(xml, /https:\/\/resume.example\/leaf\/word-protocol/);
  for (const kind of ACHIEVEMENT_CLAIM_KINDS) assert.ok(xml.includes(ACHIEVEMENT_CLAIM_LABELS[kind].replaceAll("&", "&amp;")));
  const view = distributionProjection(document, origin);
  for (const claim of view.achievements[0]!.claims) {
    assert.ok(rels.includes(`Target="${claim.url}"`));
    for (const citation of claim.citations) assert.ok(rels.includes(`Target="${citation.url}"`));
  }
  assert.doesNotMatch(xml, /<w:tbl>|<w:drawing>|<w:txbxContent>|<w:ins |<w:del /);
  for (const file of Object.values(zip.files)) if (!file.dir) {
    assert.doesNotMatch(await file.async("string"), /documentDigest|policyDigest|privateNote|file:\/\//);
  }
  assert.match(xml, /snapshot/); assert.match(xml, /do not independently verify/);
});

test("empty public Word export is honest, and non-HTTPS link origins refuse", async () => {
  const source = admitted(), document = { ...source, leaf: { ...source.leaf, portfolio: {} } };
  const zip = await JSZip.loadAsync(await publicResumeDocx(document, "https://resume.example"));
  assert.match(await zip.file("word/document.xml")!.async("string"), /No achievement statements have been published yet/);
  await assert.rejects(publicResumeDocx(document, "http://resume.example"), /HTTPS/);
  await assert.rejects(publicResumeDocx({ ...document, leaf: { ...document.leaf, subject: "Invalid\u0000text" } }, "https://resume.example"), /cannot be represented/);
});
