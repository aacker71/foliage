import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildPublishedDocument, diffPublications, reviewForPublication, toArtifactJson } from "@foliage/canopy";
import { attributionLedger, parseLeafDocument } from "@foliage/leaf";

import type { ManageReadyState } from "./manageState.ts";
import { manageHeader, renderManagePage } from "./renderManage.ts";

const parsed = parseLeafDocument({ id: "test-leaf", subject: "Test subject", leaflets: [] });
assert.equal(parsed.ok, true);
if (!parsed.ok) throw new Error("test leaf must parse");
const review = reviewForPublication({ leaf: parsed.leaf, declaredExample: false });
assert.equal(review.ok, true);
if (!review.ok) throw new Error("test leaf must be publishable");
const built = buildPublishedDocument({
  review,
  publishedAt: "2026-09-04T00:00:00.000Z",
  documentDigest: `sha256:${"a".repeat(64)}`,
  documentBytes: 42,
  policyDigest: `sha256:${"b".repeat(64)}`,
});
assert.equal(built.ok, true);
if (!built.ok) throw new Error("test publication must build");

function previewOf(value: ManageReadyState["review"]): ManageReadyState["preview"] {
  const result = buildPublishedDocument({ review: value, publishedAt: "2026-09-04T00:00:00.000Z",
    documentDigest: `sha256:${"a".repeat(64)}`, documentBytes: 42, policyDigest: `sha256:${"b".repeat(64)}` });
  assert.ok(result.ok);
  return result.document;
}

const emptyReadyState: ManageReadyState = {
  kind: "ready",
  leaf: parsed.leaf,
  sourcePath: "/tmp/test-leaf.json",
  sourceDigest: "a".repeat(64),
  sourceBytes: 42,
  policyDigest: `sha256:${"b".repeat(64)}`,
  ledger: attributionLedger(parsed.leaf),
  policySource: "default policy",
  review,
  preview: built.document,
  publication: { kind: "not-published", url: "/leaf/test-leaf" },
};

test("an unpublished leaf has no dead public link and names an honest empty release", () => {
  const html = renderManagePage(emptyReadyState, "csrf-test", undefined, "https://portfolio.example");

  assert.doesNotMatch(html, /Open public leaf/);
  assert.match(html, /Nothing ready for publication/);
  assert.match(html, /href="#manage-include">Include portfolio sections<\/a>/);
  assert.match(html, /<details class="manage-review-options" id="manage-include" open>/);
  assert.match(html, /<button class="btn btn-ghost" type="submit">Publish empty leaf<\/button>/);
  assert.match(html, />Publish empty leaf</);
  assert.match(html, /<h3>Leaflets to publish<\/h3><span class="num">0<\/span>/);
  assert.match(html, /No leaflets in this release/);
  assert.ok(html.indexOf('id="review-h"') < html.indexOf('id="manage-include"'));
});

test("an empty opted-in portfolio stays an empty release, while admitted authored context is publishable", () => {
  const noContent = reviewForPublication({ leaf: parsed.leaf, declaredExample: false, includePortfolio: true });
  assert.ok(noContent.ok);
  const noContentPage = renderManagePage({ ...emptyReadyState, includePortfolio: true,
    review: noContent, preview: previewOf(noContent) }, "csrf-test");
  assert.match(noContentPage, /Nothing ready for publication/);
  assert.match(noContentPage, /<button class="btn btn-ghost" type="submit">Publish empty leaf<\/button>/);

  const authored = parseLeafDocument({ id: "authored-input", subject: "Authored input", headline: "Work account input", leaflets: [] });
  assert.ok(authored.ok);
  const selected = reviewForPublication({ leaf: authored.leaf, declaredExample: false, includePortfolio: true });
  assert.ok(selected.ok);
  const preview = previewOf(selected);
  assert.equal(preview.leaf.portfolio?.headline, "Work account input");
  const page = renderManagePage({ ...emptyReadyState, leaf: authored.leaf, includePortfolio: true,
    review: selected, preview }, "csrf-test");
  assert.doesNotMatch(page, /Nothing ready for publication|Publish empty leaf/);
  assert.match(page, /<button class="btn manage-primary" type="submit">Publish leaf<\/button>/);
  assert.match(page, /<h3 id="manage-portfolio-context-h">Portfolio in this release<\/h3>/);
  assert.match(page, /<dt>Headline<\/dt><dd>Work account input<\/dd>/);
  assert.match(page, /<h3>Leaflets to publish<\/h3><span class="num">0<\/span>/);
  assert.match(page, /No leaflets in this release/);
  assert.doesNotMatch(page, /Nothing passes review/);
});

test("a live public link uses the separate public origin", () => {
  const state: ManageReadyState = {
    ...emptyReadyState,
    publication: {
      kind: "live",
      url: "/leaf/test-leaf",
      document: built.document,
      artifactDigest: `sha256:${"c".repeat(64)}`,
      diff: diffPublications(built.document, built.document),
      samePolicy: true,
    },
  };

  const html = renderManagePage(state, "csrf-test", undefined, "https://portfolio.example/base/");

  assert.match(html, /href="https:\/\/portfolio\.example\/leaf\/test-leaf"/);
  assert.match(html, /<h1>Empty leaf is live<\/h1>/);
  assert.match(html, /<h3>Published leaflets<\/h3><span class="num">0<\/span>/);
  assert.doesNotMatch(html, /class="manage-decision"|href="#publication-decision"/);
  assert.match(readFileSync(join(import.meta.dirname, "../public/manage.css"), "utf8"), /data-manage-state="live"\] \.manage-reading-layout \{ grid-template-columns:minmax\(0,1fr\);/);
});

test("a live release with admitted portfolio content is headed as published work", () => {
  const source = parseLeafDocument({ id: "authored-live", subject: "Authored live", headline: "Work account input", leaflets: [] });
  assert.ok(source.ok);
  const selected = reviewForPublication({ leaf: source.leaf, declaredExample: false, includePortfolio: true });
  assert.ok(selected.ok);
  const document = previewOf(selected);
  const html = renderManagePage({ ...emptyReadyState, leaf: source.leaf, includePortfolio: true,
    review: selected, preview: document, publication: { kind: "live", url: "/leaf/authored-live",
      document, artifactDigest: `sha256:${"c".repeat(64)}`,
      diff: diffPublications(document, document), samePolicy: true } }, "csrf-test");

  assert.match(html, /<h1>Published work<\/h1>/);
  assert.match(html, /<dt>Headline<\/dt><dd>Work account input<\/dd>/);
  assert.match(html, /<h3>Published leaflets<\/h3><span class="num">0<\/span>/);
});

test("a live or replaceable leaf links to the exact withdrawal confirmation", () => {
  const artifactDigest = `sha256:${"c".repeat(64)}`;
  const inventory = { kind: "ready" as const, items: [{ id: "test-leaf", artifactDigest,
    url: "/leaf/test-leaf", kind: "valid" as const, subject: "Test subject",
    publishedAt: built.document.publishedAt, detail: null }] };
  const live = { ...emptyReadyState, publication: { kind: "live" as const,
    url: "/leaf/test-leaf", document: built.document, artifactDigest,
    diff: diffPublications(built.document, built.document), samePolicy: true } };
  const replacement = { ...live, publication: { ...live.publication,
    kind: "update-available" as const } };

  for (const state of [live, replacement]) {
    const html = renderManagePage(state, "csrf-test", undefined, "https://portfolio.example", inventory);
    assert.match(html, /href="#manage-withdraw-0">Withdraw this leaf<\/a>/);
    assert.match(html, /id="manage-withdraw-0" tabindex="-1" action="\/withdraw"/);
    assert.match(html, /To confirm withdrawal, type <strong class="manage-id num">test-leaf<\/strong>/);
  }
  assert.match(renderManagePage(replacement, "csrf-test", undefined, "https://portfolio.example", inventory),
    /href="#publication-decision">Publish decision<\/a>/);

  const staleInventory = { ...inventory, items: [{ ...inventory.items[0]!, artifactDigest: "sha256:stale" }] };
  const stale = renderManagePage(replacement, "csrf-test", undefined, "https://portfolio.example", staleInventory);
  assert.doesNotMatch(stale, /href="#manage-withdraw-0"/);
});

test("publication inventory keeps digest in details and names the exact confirmation text", () => {
  const html = renderManagePage(emptyReadyState, "csrf-test", undefined, "https://portfolio.example", {
    kind: "ready", items: [{ id: "test-leaf", artifactDigest: `sha256:${"c".repeat(64)}`,
      url: "/leaf/test-leaf", kind: "valid", subject: "Test subject",
      publishedAt: built.document.publishedAt, detail: null }],
  });
  assert.match(html, /To confirm publication, type <strong class="manage-id num">test-leaf<\/strong>/);
  assert.match(html, /To confirm withdrawal, type <strong class="manage-id num">test-leaf<\/strong>/);
  assert.match(html, /Published <time class="num" datetime="2026-09-04T00:00:00\.000Z"[^>]*>4 Sep(?:t)? 2026, 00:00<\/time> UTC/);
  assert.match(html, /<details class="manage-publication-details"><summary>Publication details<\/summary><code>sha256:c{64}<\/code><\/details>/);
  assert.match(readFileSync(join(import.meta.dirname, "../public/manage.css"), "utf8"), /\.manage-list li>div>code \{ display:block;/);
});

test("replacement review always names subject and policy drift", () => {
  const changedSubject = {
    ...built.document,
    leaf: { ...built.document.leaf, subject: "Different public subject" },
  };
  const state: ManageReadyState = {
    ...emptyReadyState,
    publication: {
      kind: "update-available",
      url: "/leaf/test-leaf",
      document: changedSubject,
      artifactDigest: `sha256:${"c".repeat(64)}`,
      diff: diffPublications(changedSubject, built.document),
      samePolicy: false,
    },
  };

  const html = renderManagePage(state, "csrf-test");
  assert.match(html, /Public subject name will change/);
  assert.match(html, /Publication rules differ from the live release/);
  assert.doesNotMatch(html, /reader-visible leaf is unchanged/);
  assert.match(html, /name="publicDigest" value="sha256:c{64}"/);
});

test("the manager shows the exact redacted subject that will cross beside the private source", () => {
  const redactedLeaf = parseLeafDocument({
    id: "redacted-subject",
    subject: "Wren Halloway <wren@example.invalid>",
    leaflets: [],
  });
  assert.equal(redactedLeaf.ok, true);
  if (!redactedLeaf.ok) return;
  const redactedReview = reviewForPublication({ leaf: redactedLeaf.leaf, declaredExample: false });
  assert.equal(redactedReview.ok, true);
  if (!redactedReview.ok) return;

  const html = renderManagePage({
    ...emptyReadyState,
    leaf: redactedLeaf.leaf,
    review: redactedReview,
    preview: previewOf(redactedReview),
    publication: { kind: "not-published", url: "/leaf/redacted-subject" },
  }, "csrf-test");

  assert.match(html, /Local subject<\/span><strong>Wren Halloway &lt;wren@example\.invalid&gt;/);
  assert.match(html, /Public subject<\/span><strong>Wren Halloway &lt;\[withheld: email address\]&gt;/);
  assert.match(html, /Public subject<\/span><strong>[^<]*<\/strong><small>Redacted<\/small>/);
});

test("repeated proof rows stay neutral and every composition metric is tabular", () => {
  const populated = parseLeafDocument({
    id: "proof-density",
    subject: "Proof density",
    leaflets: ["one", "two", "three"].map((id) => ({
      id,
      title: `Verified ${id}`,
      visibility: "public",
      tier: "verified",
      provenance: { source: "git", ref: id, observedAt: "2026-09-04T00:00:00.000Z" },
    })),
  });
  assert.equal(populated.ok, true);
  if (!populated.ok) return;
  const populatedReview = reviewForPublication({ leaf: populated.leaf, declaredExample: false });
  assert.equal(populatedReview.ok, true);
  if (!populatedReview.ok) return;

  const html = renderManagePage({
    ...emptyReadyState,
    leaf: populated.leaf,
    ledger: attributionLedger(populated.leaf),
    review: populatedReview,
    preview: previewOf(populatedReview),
    publication: { kind: "not-published", url: "/leaf/proof-density" },
  }, "csrf-test");

  assert.equal((html.match(/class="proof-dot"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /proof--verified/);
  assert.match(html, /<span class="num">3<\/span> verified · <span class="num">0<\/span> pending · <span class="num">0<\/span> excluded/);
});

test("the private publication preview and replacement name the actual pending tier", () => {
  const source = parseLeafDocument({ id: "test-leaf", subject: "Test subject", leaflets: [
    { id: "draft", title: "Pending publication input", tier: "pending", visibility: "public" },
  ] });
  assert.ok(source.ok);
  const pending = reviewForPublication({ leaf: source.leaf, declaredExample: false, policy: { rules: [] } });
  assert.ok(pending.ok);
  const html = renderManagePage({ ...emptyReadyState, leaf: source.leaf,
    ledger: attributionLedger(source.leaf), review: pending, preview: previewOf(pending) }, "csrf-test");
  assert.match(html, /<span class="t">Pending<\/span>/);
  assert.doesNotMatch(html, /<span class="t">Verified<\/span>/);

  const previous = buildPublishedDocument({ review: pending, publishedAt: built.document.publishedAt,
    documentDigest: built.document.source.documentDigest, documentBytes: 42, policyDigest: emptyReadyState.policyDigest });
  assert.ok(previous.ok);
  const provenSource = parseLeafDocument({ id: "test-leaf", subject: "Test subject", leaflets: [
    { id: "draft", title: "Pending publication input", tier: "verified", visibility: "public",
      provenance: { source: "git", ref: "ref-under-test", observedAt: built.document.publishedAt } },
  ] });
  assert.ok(provenSource.ok);
  const proven = reviewForPublication({ leaf: provenSource.leaf, declaredExample: false });
  assert.ok(proven.ok);
  const next = buildPublishedDocument({ review: proven, publishedAt: built.document.publishedAt,
    documentDigest: built.document.source.documentDigest, documentBytes: 42, policyDigest: emptyReadyState.policyDigest });
  assert.ok(next.ok);
  const replacement = renderManagePage({ ...emptyReadyState, leaf: provenSource.leaf,
    ledger: attributionLedger(provenSource.leaf), review: proven, preview: next.document,
    publication: { kind: "update-available", url: "/leaf/test-leaf", document: previous.document,
      artifactDigest: "digest-under-test", samePolicy: true, diff: diffPublications(previous.document, next.document) },
  }, "csrf-test");
  assert.match(replacement, /Proof tier: pending → verified/);
  assert.match(replacement, /Public provenance will change/);
});

test("long preview references stay inspectable without dominating the work row", () => {
  const id = `git:${"a".repeat(40)}`;
  const source = parseLeafDocument({ id: "test-leaf", subject: "Test subject", leaflets: [
    { id, title: "A recorded change", tier: "pending", visibility: "public" },
  ] });
  assert.ok(source.ok);
  const reviewed = reviewForPublication({ leaf: source.leaf, declaredExample: false, policy: { rules: [] } });
  assert.ok(reviewed.ok);
  const html = renderManagePage({ ...emptyReadyState, leaf: source.leaf,
    ledger: attributionLedger(source.leaf), review: reviewed, preview: previewOf(reviewed) }, "csrf-test");

  assert.match(html, new RegExp(`<code class="manage-short-ref" title="${id}" aria-label="Full reference: ${id}">git:aaaaaaa<\\/code>`));
  assert.doesNotMatch(html, new RegExp(`<code class="manage-short-ref"[^>]*>${id}<\\/code>`));
  assert.match(readFileSync(join(import.meta.dirname, "../public/manage.css"), "utf8"), /\.manage-main \.manage-short-ref \{[^}]*white-space:nowrap;/);
});

test("consent preview exposes the complete serialized content with safe escaping before confirmation", () => {
  const source = parseLeafDocument({ id: "consent-input", subject: "Consent test input", leaflets: [
    { id: "evidence-input", title: "Quoted <input>", tier: "pending", visibility: "public",
      provenance: { source: "git", ref: 'ref</code><script>alert("input")</script>&', observedAt: built.document.publishedAt } },
    { id: "no-provenance-input", title: "Pending without provenance", tier: "pending", visibility: "public" },
    { id: "private-input", title: "Private input title", tier: "pending", visibility: "private" },
  ] });
  assert.ok(source.ok);
  const reviewed = reviewForPublication({ leaf: source.leaf, declaredExample: false, policy: { rules: [] } });
  assert.ok(reviewed.ok);
  const preview = previewOf(reviewed);
  assert.equal(preview.leaf.leaflets.length, 2);
  const html = renderManagePage({ ...emptyReadyState, leaf: source.leaf, review: reviewed, preview }, "csrf-test");
  const encoded = /<pre data-publication-payload><code>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1];
  assert.ok(encoded, "every outgoing field must be inspectable before the publish form");
  assert.doesNotMatch(encoded, /<script>|Private input title|private-input/);
  assert.match(encoded, /&lt;script&gt;/);
  const decoded = encoded.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) =>
    ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]!);
  assert.deepEqual(JSON.parse(decoded), toArtifactJson(preview));
  assert.ok(html.indexOf("data-publication-payload") < html.indexOf('action="/publish"'));
  assert.match(html, /is set on publish/);
});

test("publication notices use the shared live surface without spending an accent", () => {
  const css = readFileSync(join(import.meta.dirname, "../../../packages/ui/src/controls.css"), "utf8");
  assert.match(css, /\.fol-feedback-notice\s*\{[^}]*border:1px solid var\(--fol-role-edge-control\)/);
  assert.doesNotMatch(css, /\.fol-feedback-notice(?:\[data-tone=status\])?\s*\{[^}]*var\(--fol-accent\)/);
  const html = renderManagePage(emptyReadyState, "csrf-test", { tone:"error", heading:"Operation failed", detail:"Check the record" });
  const alert = /<div\b[^>]*data-slot="feedback-notice"[^>]*>/.exec(html)?.[0];
  assert.ok(alert);
  for (const attribute of ['data-tone="error"', 'tabindex="-1"', 'autofocus=""', 'role="alert"']) assert.ok(alert.includes(attribute));
  assert.match(html, /<strong>Operation failed<\/strong><span>Check the record<\/span>/);
  const localCss = readFileSync(join(import.meta.dirname, "../public/manage.css"), "utf8");
  assert.match(localCss, /\.manage-notice:not\(\.fol-feedback-notice\)\s*\{[^}]*border:1px solid var\(--can-control\)/);
});

test("Jev's draft-time mark sits beside an item to publish as advice, never in the published document", () => {
  const source = parseLeafDocument({ id: "draft-marks", subject: "Draft marks", leaflets: ["kept", "unmarked"].map((id) => ({
    id, title: `Work ${id}`, visibility: "public", tier: "verified",
    provenance: { source: "git", ref: id, observedAt: "2026-09-04T00:00:00.000Z" },
  })) });
  assert.ok(source.ok);
  const marked = reviewForPublication({ leaf: source.leaf, declaredExample: false });
  assert.ok(marked.ok);
  const base = { ...emptyReadyState, leaf: source.leaf, ledger: attributionLedger(source.leaf), review: marked, preview: previewOf(marked) };
  const html = renderManagePage({ ...base, jev: { kind: "marks", marks: new Map([["kept", "keep"]]) } }, "csrf-test");
  assert.equal((html.match(/data-jev-mark=/g) ?? []).length, 1);
  assert.match(html, /<small data-jev-mark="keep">Jev: keep<\/small>/);
  assert.ok(!JSON.stringify(toArtifactJson(base.preview)).includes("Jev:"));
  assert.doesNotMatch(html, /\b\d+\s*%|score/i);
  assert.match(renderManagePage({ ...base, jev: { kind: "unread" } }, "csrf-test"), /data-jev-unread/);
  assert.doesNotMatch(renderManagePage(base, "csrf-test"), /data-jev/);
});

test("the assessment nav item names the cloud assessment it opens, not the Scarlet assistant", () => {
  // `/ladybug` sends the reviewed packet to Fireworks on the owner's authorization and can release
  // findings to a public page, so "Private" overstated it. It carries the "(cloud)" marking used
  // beside Scarlet and TypeSafe, in the server-rendered nav and the Hosting workspace alike.
  const header = manageHeader("assessment");
  assert.match(header, /<a href="\/ladybug" aria-current="page">Assessment \(cloud\)<\/a>/);
  assert.doesNotMatch(header, /Scarlet|Private assessment/);
  assert.match(manageHeader("publication"), /<a href="\/ladybug">Assessment \(cloud\)<\/a>/);
  const hosting = readFileSync(join(import.meta.dirname, "../workspace-ui/app.tsx"), "utf8");
  assert.match(hosting, /\{label:"Assessment \(cloud\)",href:"\/ladybug"\}/);
  assert.doesNotMatch(hosting, /Private assessment/);
});
