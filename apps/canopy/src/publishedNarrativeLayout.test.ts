/** Renderer protocol inputs carry actual repository commit text, never a fabricated portfolio. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PUBLISHED_ARTIFACT, parsePublishedDocument } from "@foliage/canopy";
import { recentProtocolCommits } from "../test-support/protocolCommits.ts";
import { renderPublishedPage } from "./renderPublished.ts";

const observedAt = new Date().toISOString();
const commits = recentProtocolCommits(3, observedAt);
const first = commits[0]!, second = commits[1]!, third = commits[2]!;
const provenance = (ref: string) => ({ source: "git", ref, observedAt });
const paragraphs = [first, second, third].map(entry => ({ text: entry.text, provenance: provenance(entry.ref) }));
const privateLeaf = { id: "reader-contract", subject: "Reader contract", leaflets: [{ id: `git:${first.ref}`, tier: "pending", title: first.text, body: paragraphs }] };
const bytes = Buffer.from(JSON.stringify(privateLeaf));
const source = { documentDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, documentBytes: bytes.length, policyDigest: `sha256:${createHash("sha256").update("renderer contract policy input").digest("hex")}` };

function render(includeNarrative: boolean, paragraphCount = 2): string {
  const parsed = parsePublishedDocument({ artifact: PUBLISHED_ARTIFACT, artifactVersion: 4,
    publishedAt: "2026-09-10T01:30:00+02:00", source,
    leaf: { id: "reader-contract", subject: "Reader contract", subjectRedacted: false,
      leaflets: [{ id: `git:${first.ref}`, title: first.text, titleRedacted: false, tier: "pending", provenance: provenance(first.ref),
        ...(includeNarrative ? { narrative: paragraphs.slice(0, paragraphCount) } : {}) }] },
    withheld: { count: 0, kinds: [] } });
  assert.ok(parsed.ok, parsed.ok ? undefined : JSON.stringify(parsed.issues));
  return renderPublishedPage({ ok: true, id: "reader-contract", document: parsed.document,
    source: { path: "unused-renderer-contract", bytes: bytes.length, artifactDigest: source.documentDigest, readAt: observedAt } });
}

test("published narrative leads evidence while exact paragraphs, provenance and visible tier survive", () => {
  const html = render(true);
  const row = /<li class="pub-leaflet lp-record"[\s\S]*?<\/li>/.exec(html)?.[0]; assert.ok(row);
  assert.match(row, /data-published-content="context"/);
  assert.ok(row.indexOf('class="pub-narrative"') < row.indexOf('class="pub-evidence"'));
  assert.ok(row.indexOf('class="pub-evidence"') < row.indexOf('Read leaflet'));
  assert.match(row, /<details class="pub-evidence" data-portfolio-evidence><summary>[\s\S]*?data-pill-tier="pending"[\s\S]*?<\/summary>/);
  assert.doesNotMatch(row, /<details class="pub-evidence" open/);
  assert.equal((row.match(/class="pub-paragraph-text"/g) ?? []).length, 2);
  const paragraphs = [...row.matchAll(/<p class="pub-paragraph-text">([\s\S]*?)<\/p>/g)].map(match => match[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  assert.deepEqual(paragraphs, [first.text, second.text]);
  assert.ok(row.includes(first.ref)); assert.ok(row.includes(second.ref));
  assert.match(row, /Context chosen by the person/);
  assert.match(row, /<h2 class="pub-title" data-verbatim="title">/);
  assert.doesNotMatch(html, /class="pub-assistance"/, "an absent interpretation has no panel");
  assert.doesNotMatch(html, /<script|<iframe|<video|<audio|<form/);
});

test("the shared leaf follows the person-first identity header and longer context remains fully readable", () => {
  const html = render(true, 3);
  assert.match(html, /class="lp-person-hero"/);
  assert.doesNotMatch(html, /pub-specimen|specimen-sheet-day|class="pub-explore"/);
  assert.ok(html.indexOf('class="lp-person-hero"') < html.indexOf('class="lp-records"'));
  assert.match(html, /class="lp-portfolio lp-fallback"/);
  assert.doesNotMatch(html, /class="lp-toolbar"|data-portfolio-canvas/);
  const beforeMore = html.slice(0, html.indexOf('<details class="lp-detail pub-more-context">'));
  assert.equal((beforeMore.match(/class="pub-paragraph-text"/g) ?? []).length, 2);
  assert.equal((html.match(/class="pub-paragraph-text"/g) ?? []).length, 3);
  const retained = [...html.matchAll(/<p class="pub-paragraph-text">([\s\S]*?)<\/p>/g)].map(match => match[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  assert.deepEqual(retained, [first.text, second.text, third.text]);
  const more = html.slice(html.indexOf('<details class="lp-detail pub-more-context">'));
  assert.ok(more.includes(third.ref));
  assert.match(more, /<summary>More<\/summary>/);
  assert.doesNotMatch(more, /pub-more-context" open/);
});

test("calendar publication date retains the exact instant and absent narrative gains no substitute", () => {
  const html = render(false);
  assert.match(html, /data-fact="publishedAt" datetime="2026-09-10T01:30:00\+02:00">September 9, 2026<\/time>/);
  assert.doesNotMatch(html, /class="pub-narrative"|In their words/);
  assert.match(html, /data-published-content="title-only"/);
  assert.ok(html.indexOf('Read leaflet') < html.indexOf('class="pub-evidence"'));
  assert.match(html, /class="pub-evidence"/);
  assert.match(html, /data-pill-tier="pending"/);
});
