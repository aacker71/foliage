/** Admitted wire-format probes retain actual Git references and text. No private file is read. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PUBLISHED_ARTIFACT, parsePublishedDocument, type PublishedNarrative } from "@foliage/canopy";
import { readStoryElement, STORY_SECTIONS } from "@foliage/leaf-app/render";
import { recentProtocolCommits } from "../test-support/protocolCommits.ts";
import { esc, renderPublishedPage } from "./renderPublished.ts";

const at = new Date().toISOString();
const commits = recentProtocolCommits(2, at);
const ref = commits[0]!.ref, title = commits[0]!.text, otherText = commits[1]!.text;
const supporting = { source: "git", ref, observedAt: at };
const reviewer = "Publication renderer protocol";
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function story(section: typeof STORY_SECTIONS[number]["key"], text: string): PublishedNarrative {
  const label = STORY_SECTIONS.find(entry => entry.key === section)!.label;
  const paragraph = `${label}\n${text}\n\nSupporting evidence: ${JSON.stringify(supporting)}\nAccount recorded by: ${JSON.stringify(reviewer)}\nAccount recorded at: ${at}\nThis is the person's recorded account. Its supporting reference does not independently verify the account or authorship.`;
  return { text: paragraph, provenance: { source: `subject:story/${section}`, ref: digest(paragraph), observedAt: at } };
}
const chosen = story("problem", title);
const notChosen = story("contribution", otherText);
const privateBytes = JSON.stringify({ id: "published-story-contract", subject: reviewer, leaflets: [{ id: `git:${ref}`, tier: "pending", title, body: [chosen, notChosen] }] });
const source = { documentDigest: digest(privateBytes), documentBytes: Buffer.byteLength(privateBytes), policyDigest: digest("publication renderer policy protocol") };

function render(narrative?: readonly PublishedNarrative[]): string {
  const parsed = parsePublishedDocument({ artifact: PUBLISHED_ARTIFACT, artifactVersion: 4, publishedAt: at, source,
    leaf: { id: "published-story-contract", subject: reviewer, subjectRedacted: false,
      leaflets: [{ id: `git:${ref}`, title, titleRedacted: false, tier: "pending", provenance: supporting, ...(narrative ? { narrative } : {}) }] },
    withheld: { count: 0, kinds: [] } });
  assert.ok(parsed.ok, parsed.ok ? undefined : JSON.stringify(parsed.issues));
  return renderPublishedPage({ ok: true, id: "published-story-contract", document: parsed.document,
    source: { path: "private-source-must-never-be-opened", bytes: source.documentBytes, artifactDigest: source.documentDigest, readAt: at } });
}

test("a published story shows exact chosen account text and keeps its admitted receipt inspectable", () => {
  assert.ok(readStoryElement(chosen), "the independently constructed admitted paragraph must match the story convention");
  const html = render([chosen]);
  assert.match(html, /<h3 class="pub-story-label">The problem<\/h3>/);
  const paragraph = html.match(/<p class="pub-paragraph-text">([\s\S]*?)<\/p>/)?.[1];
  assert.equal(paragraph, esc(title));
  assert.doesNotMatch(paragraph!, /Supporting evidence:|Account recorded by:|&quot;source&quot;/);
  const receipt = html.match(/<details class="pub-paragraph-reference">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(receipt);
  assert.match(receipt, /<summary>Evidence<\/summary>/);
  for (const value of [supporting.source, supporting.ref, supporting.observedAt, reviewer, chosen.provenance.source, chosen.provenance.ref]) {
    assert.ok(receipt.includes(esc(value)), `receipt lost admitted field ${value}`);
  }
  assert.doesNotMatch(html, /data-story-section="contribution"|private-source-must-never-be-opened/);
  assert.doesNotMatch(html, /<script|<iframe|<form|\/my\/leaflet\/|\/leaf\/story/);
  assert.match(html, /data-pill-tier="pending"/);
});

test("ordinary and damaged convention paragraphs remain literal; absent selection stays absent", () => {
  const ordinary = { text: otherText, provenance: supporting };
  const damaged = { ...chosen, provenance: { ...chosen.provenance, ref: digest("different paragraph bytes") } };
  assert.equal(readStoryElement(damaged), null);
  const html = render([ordinary, damaged]);
  const paragraphs = [...html.matchAll(/<p class="pub-paragraph-text">([\s\S]*?)<\/p>/g)].map(match => match[1]);
  assert.deepEqual(paragraphs, [esc(ordinary.text), esc(damaged.text)]);
  assert.doesNotMatch(html, /class="pub-story-label"|data-story-section=/);
  assert.doesNotMatch(render(), /class="pub-narrative"|class="pub-story-label"/);
});

test("story text remains literal HTML-escaped content rather than markup", () => {
  const text = `${title}\n<em>Literal markup protocol input</em>`;
  const html = render([story("decisions", text)]);
  assert.ok(html.includes(`<p class="pub-paragraph-text">${esc(text)}</p>`));
  assert.doesNotMatch(html, /<em>Literal markup protocol input<\/em>/);
});
