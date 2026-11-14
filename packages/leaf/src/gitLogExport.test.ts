import assert from "node:assert/strict";
import test from "node:test";

import { commitsToLeaflets, parseGitLogExport } from "./index.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);

test("an exported N is unchecked, never unsigned: the export cannot see the object", () => {
  const parsed = parseGitLogExport(`${A}\tme@example.com\tN\t\tShip the thing\n`);
  assert.ok(parsed.ok);
  const intake = commitsToLeaflets({ commits: parsed.commits, identities: ["me@example.com"], observedAt: "2026-10-07T00:00:00Z" });
  assert.ok(intake.ok);
  assert.equal(intake.leaflets[0]?.tier, "pending");
  assert.equal(intake.uncheckedSignatures.length, 1);
});

test("a subject containing tabs is kept whole", () => {
  const parsed = parseGitLogExport(`${A}\tme@example.com\tN\t\tone\ttwo`);
  assert.ok(parsed.ok);
  assert.equal(parsed.commits[0]?.subject, "one\ttwo");
});

test("one unreadable line fails the whole export rather than shrinking the history", () => {
  const parsed = parseGitLogExport(`${A}\tme@example.com\tN\t\tok\nnot a commit line\n${B}\tme@example.com\tN\t\tok`);
  assert.equal(parsed.ok, false);
  assert.ok(!parsed.ok && parsed.issues[0]?.at === "line 2");
});

test("an empty file is refused, not read as an empty history", () => {
  assert.equal(parseGitLogExport("\n\n").ok, false);
});
