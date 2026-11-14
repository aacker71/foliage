/**
 * F-004 — the declared privacy kind may never reach a model's prompt.
 *
 * The corpse: `llama3.2:3b`, in a real run, answered that it *"considered 'tier1-local,' which
 * suggests that you have some level of seniority or influence"*. A privacy classification became a
 * claim about the person's rank, and then became advice. These tests pin the rule at the one place
 * that now decides it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { itemAsPromptContent, promptMessages } from "./prompt.ts";
import { DECLARED_KINDS } from "./classify.ts";

test("F-004: no declared kind appears in what a model is shown", () => {
  // Every kind the product can declare, checked by name rather than one representative — a new
  // kind added to DECLARED_KINDS is covered by this test the day it is added.
  for (const kind of DECLARED_KINDS) {
    const content = itemAsPromptContent({ id: "note-1", body: `I shipped the router. Kind is ${kind}.` });
    // The kind is absent from the FRAMING. The body is the person's own words and is carried
    // verbatim — this test must not claim the product censors what somebody wrote.
    assert.equal(content, `[note-1]\nI shipped the router. Kind is ${kind}.`);
    assert.ok(!content.startsWith(`[note-1 — declared`), `the framing re-introduced the kind for ${kind}`);
  }
});

test("F-004: the item's own id survives, because citations are matched by it", () => {
  // Deleting the label wholesale would have broken attribution, which is the opposite of the goal.
  const content = itemAsPromptContent({ id: "reflection-2026-08", body: "a private note" });
  assert.match(content, /^\[reflection-2026-08\]\n/);
  assert.ok(content.endsWith("a private note"));
});

test("the message list is instruction, then material, then the request — in that order", () => {
  const messages = promptMessages({
    system: "You are a chief of staff.",
    items: [
      { id: "a", body: "first" },
      { id: "b", body: "second" },
    ],
    request: "what should I do?",
  });
  assert.deepEqual(
    messages.map((m) => m.role),
    ["system", "user", "user", "user"],
  );
  assert.equal(messages[0]!.content, "You are a chief of staff.");
  assert.equal(messages[1]!.content, "[a]\nfirst");
  assert.equal(messages[2]!.content, "[b]\nsecond");
  // The request is LAST, so the person's question is the most recent thing the model read.
  assert.equal(messages[3]!.content, "what should I do?");
});

test("no filed material is an ordinary turn, not an error", () => {
  const messages = promptMessages({ system: "S", items: [], request: "R" });
  assert.equal(messages.length, 2);
  assert.deepEqual(
    messages.map((m) => m.content),
    ["S", "R"],
  );
});

test("the returned list is frozen — a caller cannot append to what was already decided", () => {
  const messages = promptMessages({ system: "S", items: [], request: "R" });
  assert.throws(() => (messages as PromptMessageMutable[]).push({ role: "user", content: "extra" }));
});

interface PromptMessageMutable {
  role: "system" | "user";
  content: string;
}
