/**
 * The grounding is counted twice and compared, and its prose is held to the no-score rule the
 * rest of this product is held to: nothing Photosynthesis is told may look like a rating.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { RATING_SHAPED, attributionLedger, parseLeafDocument, type Leaf } from "@foliage/leaf";

import type { LeafSource } from "./leafDocument.ts";
import {
  GROUNDING_TITLE_LIMIT,
  SCARLET_SYSTEM_PROMPT,
  chatMessagesFor,
  groundingFor,
  renderGrounding,
  type Grounding,
} from "./scarletPrompt.ts";

function leafFrom(doc: unknown): Leaf {
  const parsed = parseLeafDocument(doc);
  assert.equal(parsed.ok, true, `test input must be a valid leaf document: ${JSON.stringify(parsed)}`);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.leaf;
}

const source = (declaredExample: boolean, bundledExample = false): LeafSource => ({
  path: "/tmp/scarlet-prompt-leaf.json",
  bytes: 1,
  documentDigest: `sha256:${"0".repeat(64)}`,
  readAt: "2026-09-02T00:00:00Z",
  declaredExample,
  bundledExample,
});

const mixed = leafFrom({
  id: "prompt-leaf",
  subject: "Prompt Fixture Subject",
  leaflets: [
    { id: "v1", title: "first verified", tier: "verified", provenance: { source: "git", ref: "aaa1111", observedAt: "2026-08-01T00:00:00Z" } },
    { id: "p1", title: "waiting on proof", tier: "pending" },
    { id: "p2", title: "also waiting", tier: "pending" },
    { id: "x1", title: "not attributable", tier: "excluded", reason: "different author identity" },
    { id: "x2", title: "no evidence at all", tier: "excluded", reason: "no provenance was recorded" },
  ],
});

test("the counts in the grounding equal an independent ledger recomputation, and the reasons are verbatim", () => {
  const g = groundingFor(mixed, source(false));
  const ledger = attributionLedger(mixed);
  assert.equal(g.verified, ledger.verified);
  assert.equal(g.pending, ledger.pending);
  assert.equal(g.excluded, ledger.excluded);
  assert.deepEqual(g.exclusionReasons, ledger.exclusionReasons);
  assert.equal(g.subject, "Prompt Fixture Subject");
  assert.deepEqual(
    g.titles.map((t) => t.tier),
    ["verified", "pending", "pending", "excluded", "excluded"],
    "document order, with the tier beside each title",
  );

  const text = renderGrounding(g);
  assert.match(text, /verified: 1; pending: 2; excluded: 2/);
  assert.match(text, /a grouping, not an order/);
  assert.match(text, /- different author identity\n- no provenance was recorded/);
  assert.match(text, /^- "waiting on proof" \(pending\)$/m, "the title first and quoted, the tier after — a small model read a leading tier as the title");
  assert.doesNotMatch(text, /more leaflets are not listed/, "no remainder line when nothing was left out");
});

test("nothing Photosynthesis is told is rating-shaped: no RATING_SHAPED match, no digit/digit, no percent", () => {
  for (const [leaf, src] of [
    [mixed, source(false)],
    [mixed, source(true)],
    [leafFrom({ id: "empty", subject: "Nobody Yet", leaflets: [] }), source(false)],
  ] as const) {
    const g = groundingFor(leaf, src);
    for (const text of [renderGrounding(g), SCARLET_SYSTEM_PROMPT, chatMessagesFor(g, [])[0]?.content ?? ""]) {
      assert.doesNotMatch(text, RATING_SHAPED, text);
      assert.doesNotMatch(text, /\d\s*\/\s*\d/, text);
      assert.doesNotMatch(text, /%/, text);
    }
  }
});

test("the title ceiling is said out loud: 125 leaflets list 120 and name the 5 left out; 3 list 3", () => {
  const many = leafFrom({
    id: "many",
    subject: "Many Leaflets",
    leaflets: Array.from({ length: GROUNDING_TITLE_LIMIT + 5 }, (_, i) => ({ id: `p${i}`, title: `pending leaflet ${i}`, tier: "pending" })),
  });
  const g = groundingFor(many, source(false));
  assert.equal(g.titles.length, GROUNDING_TITLE_LIMIT);
  assert.equal(g.notListed, 5);
  assert.equal(g.titles[0]?.title, "pending leaflet 0", "the first title listed is the first in the document");
  assert.equal(g.titles.at(-1)?.title, `pending leaflet ${GROUNDING_TITLE_LIMIT - 1}`);
  const text = renderGrounding(g);
  assert.match(text, /^5 more leaflets are not listed\.$/m);
  assert.doesNotMatch(text, new RegExp(`pending leaflet ${GROUNDING_TITLE_LIMIT}\\b`), "the 121st title is not listed");

  const few = groundingFor(mixed, source(false));
  assert.equal(few.notListed, 0);
});

test("a fabricated document earns the example sentence; a real one does not — the band's own differential", () => {
  const real = renderGrounding(groundingFor(mixed, source(false)));
  const declared = renderGrounding(groundingFor(mixed, source(true)));
  const bundled = renderGrounding(groundingFor(mixed, source(false, true)));
  assert.doesNotMatch(real, /fabricated/);
  assert.match(declared, /example document: its contents are fabricated/);
  assert.match(bundled, /example document: its contents are fabricated/);
});

test("chatMessagesFor: our system message is first and carries the role and the grounding; the history keeps its order", () => {
  const g: Grounding = groundingFor(mixed, source(false));
  const messages = chatMessagesFor(g, [
    { id: "u1", role: "user", content: "first question" },
    { id: "a1", role: "assistant", content: "first answer" },
    { id: "u2", role: "user", content: "second question" },
  ]);
  assert.equal(messages.length, 4);
  assert.equal(messages[0]?.role, "system");
  assert.ok(messages[0]?.content.startsWith(SCARLET_SYSTEM_PROMPT), "the role comes first");
  assert.ok(messages[0]?.content.endsWith(renderGrounding(g)), "then the grounding");
  assert.match(messages[0]?.content ?? "", /You propose\. You cannot approve, reject, promote, publish, share or change policy/);
  assert.deepEqual(messages.slice(1), [
    { role: "user", content: "first question" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "second question" },
  ]);
});
