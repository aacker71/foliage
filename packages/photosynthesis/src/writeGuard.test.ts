/**
 * `writeGuard` — the ONE rule for "may this write proceed, or is it about to guess a path"
 * (ledger F-025). Unit tests of the pure function itself; the two real callers
 * (`apps/leaf/server.mjs`'s `refuseIfUnconfigured` and `apps/photosynthesis/review-server.mjs`)
 * are proven at the real HTTP seam in their own seam test files.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { writeGuard } from "./writeGuard.ts";

test("every value present and non-blank: ok, nothing missing", () => {
  const verdict = writeGuard({ FOLIAGE_LEAF: "/tmp/leaf.json", FOLIAGE_HARVEST: "/tmp/harvest.json" });
  assert.deepEqual(verdict, { ok: true, missing: [] });
});

test("one value genuinely undefined (never set): refused, naming exactly that one", () => {
  const verdict = writeGuard({ FOLIAGE_LEAF: "/tmp/leaf.json", FOLIAGE_HARVEST: undefined });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ["FOLIAGE_HARVEST"]);
});

test("one value set but blank: refused the SAME way as unset — a typed-then-cleared flag is not configured either", () => {
  const verdict = writeGuard({ FOLIAGE_LEAF: "   ", FOLIAGE_HARVEST: "/tmp/harvest.json" });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ["FOLIAGE_LEAF"]);
});

test("both missing: BOTH named, in the order given — never collapsed to one, never reordered", () => {
  const verdict = writeGuard({ FOLIAGE_HARVEST: undefined, FOLIAGE_LEAF: "" });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ["FOLIAGE_HARVEST", "FOLIAGE_LEAF"]);
});

test("an empty map is vacuously ok — a caller checking zero variables has nothing to be missing", () => {
  assert.deepEqual(writeGuard({}), { ok: true, missing: [] });
});

test("a real (non-empty, non-whitespace) path with surrounding whitespace still counts as configured", () => {
  const verdict = writeGuard({ FOLIAGE_LEAF: "  /tmp/leaf.json  " });
  assert.equal(verdict.ok, true);
});

test("the result is frozen — a caller cannot accidentally mutate a shared verdict", () => {
  const verdict = writeGuard({ FOLIAGE_HARVEST: undefined });
  assert.ok(Object.isFrozen(verdict));
  assert.ok(Object.isFrozen(verdict.missing));
});
