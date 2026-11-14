/**
 * Tests for CLASSIFICATION — the declared-kind layer.
 *
 * The adversarial direction is the one that matters here, so most of these hand the classifier
 * material a caller would plausibly get wrong: a kind spelled slightly wrong, a record with no
 * declaration at all, a `confidence` field riding along beside a perfectly good declaration.
 * A classifier that only ever sees well-formed input has been tested for the case that never
 * causes an incident.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { SCORE_SHAPED } from "@foliage/leaf";

import { DECLARED_KINDS, classify, classifyAll, contextItemId } from "./classify.ts";

test("a declared item keeps its id and its kind, and nothing else is invented", () => {
  const c = classify({ id: "note-1", declaredKind: "tier2-confidential" }, "items[0]");
  assert.equal(c.state, "declared");
  if (c.state !== "declared") return;
  assert.equal(c.id, contextItemId("note-1"));
  assert.equal(c.kind, "tier2-confidential");
  assert.equal(c.at, "items[0]");
});

test("all three declared kinds round-trip, and there are exactly three", () => {
  assert.deepEqual([...DECLARED_KINDS], ["tier1-local", "tier2-confidential", "tier3-shareable"]);
  for (const kind of DECLARED_KINDS) {
    const c = classify({ id: `x-${kind}`, declaredKind: kind }, "items[0]");
    assert.equal(c.state, "declared");
    if (c.state === "declared") assert.equal(c.kind, kind);
  }
});

test("an item with no declaration is undeclared WITH a cause — never a guessed kind", () => {
  const c = classify({ id: "mystery" }, "items[0]");
  assert.equal(c.state, "undeclared");
  if (c.state !== "undeclared") return;
  assert.equal(c.cause, "no-declaration");
  assert.equal(c.id, contextItemId("mystery"));
  // The point of the arm: there is no `kind` field to read, so no caller can accidentally
  // treat undeclared material as if a kind had been supplied.
  assert.equal(Object.hasOwn(c, "kind"), false);
});

test("a misspelled kind is `unrecognized-kind`, not silently mapped to the nearest one", () => {
  const c = classify({ id: "typo", declaredKind: "tier3_shareable" }, "items[4]");
  assert.equal(c.state, "undeclared");
  if (c.state !== "undeclared") return;
  assert.equal(c.cause, "unrecognized-kind");
  assert.match(c.detail, /tier3_shareable/);
});

test("`no-declaration` and `unrecognized-kind` do not collapse into one another", () => {
  const absent = classify({ id: "a" }, "items[0]");
  const wrong = classify({ id: "b", declaredKind: "secret" }, "items[1]");
  assert.equal(absent.state, "undeclared");
  assert.equal(wrong.state, "undeclared");
  if (absent.state !== "undeclared" || wrong.state !== "undeclared") return;
  assert.notEqual(absent.cause, wrong.cause);
});

test("EVERY score-shaped key is refused by name, from the one list in @foliage/leaf", () => {
  // Driven off the imported list rather than a copy: if a name is added there and this package
  // stopped importing it, this test fails on the new name — which is the drift it exists to catch.
  assert.ok(SCORE_SHAPED.size > 0);
  for (const key of SCORE_SHAPED) {
    const c = classify({ id: "n", declaredKind: "tier3-shareable", [key]: 1 }, "items[0]");
    assert.equal(c.state, "refused", `"${key}" was not refused`);
    if (c.state !== "refused") continue;
    assert.equal(c.cause, "score-shaped-key");
    assert.equal(c.at, `items[0].${key}`);
  }
});

test("`confidence` specifically is refused, even beside a valid declaration", () => {
  assert.ok(SCORE_SHAPED.has("confidence"));
  const c = classify({ id: "n", declaredKind: "tier3-shareable", confidence: 0.99 }, "items[0]");
  assert.equal(c.state, "refused");
  if (c.state === "refused") assert.equal(c.cause, "score-shaped-key");
});

test("a score-shaped key is refused whatever its case", () => {
  const c = classify({ id: "n", declaredKind: "tier3-shareable", Confidence: 1 }, "items[0]");
  assert.equal(c.state, "refused");
  if (c.state === "refused") assert.equal(c.cause, "score-shaped-key");
});

test("an unknown key is refused, not ignored", () => {
  const c = classify({ id: "n", declaredKind: "tier3-shareable", body: "..." }, "items[0]");
  assert.equal(c.state, "refused");
  if (c.state !== "refused") return;
  assert.equal(c.cause, "unknown-key");
  assert.equal(c.at, "items[0].body");
});

test("a non-record and a missing id are refused with DIFFERENT causes", () => {
  for (const input of [null, "note", 7, ["a"]]) {
    const c = classify(input, "items[0]");
    assert.equal(c.state, "refused");
    if (c.state === "refused") assert.equal(c.cause, "not-a-record");
  }
  for (const bad of [undefined, "", "   ", 3]) {
    const c = classify({ id: bad, declaredKind: "tier3-shareable" }, "items[0]");
    assert.equal(c.state, "refused");
    if (c.state === "refused") assert.equal(c.cause, "missing-id");
  }
});

test("classifyAll numbers every item by index so a person can find it", () => {
  const all = classifyAll([
    { id: "a", declaredKind: "tier1-local" },
    { id: "b" },
    { id: "c", declaredKind: "tier3-shareable" },
  ]);
  assert.deepEqual(
    all.map((c) => c.at),
    ["items[0]", "items[1]", "items[2]"],
  );
});

test("a duplicate id is refused, never de-duplicated", () => {
  const all = classifyAll([
    { id: "same", declaredKind: "tier3-shareable" },
    { id: "same", declaredKind: "tier1-local" },
  ]);
  assert.equal(all.length, 2, "both rows are reported; neither is dropped");
  assert.equal(all[0]?.state, "declared");
  const second = all[1];
  assert.equal(second?.state, "refused");
  if (second?.state === "refused") assert.equal(second.cause, "duplicate-id");
});

test("classification is pure: the same input classifies the same way twice", () => {
  const input = { id: "n", declaredKind: "tier2-confidential" };
  assert.deepEqual(classify(input, "items[0]"), classify(input, "items[0]"));
});
