/**
 * The Node floor's verdict, pinned at its edges — because the whole point of the floor is the
 * versions where `pnpm check` is green and the product then crashes raw (22.6–22.17), and an
 * off-by-one here recreates exactly the trap it closes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { NODE_FLOOR, nodeFloorVerdict } from "./nodeFloor.mjs";

test("the floor is 22.18.0 and the verdict is exact at the boundary", () => {
  assert.equal(NODE_FLOOR, "22.18.0");
  assert.equal(nodeFloorVerdict("22.18.0").ok, true);
  assert.equal(nodeFloorVerdict("22.17.9").ok, false);
  // The green-check-then-raw-crash band, by name.
  assert.equal(nodeFloorVerdict("22.6.0").ok, false);
  assert.equal(nodeFloorVerdict("22.17.1").ok, false);
});

test("above the floor is above the floor — majors, minors, patches", () => {
  for (const v of ["22.18.1", "22.19.0", "23.0.0", "24.5.1"]) {
    assert.equal(nodeFloorVerdict(v).ok, true, v);
  }
  for (const v of ["20.11.0", "21.99.0", "0.10.0"]) {
    assert.equal(nodeFloorVerdict(v).ok, false, v);
  }
});

test("a failing verdict carries the remedy, not just the refusal", () => {
  const verdict = nodeFloorVerdict("22.14.0");
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.match(verdict.detail, /22\.18/);
  assert.match(verdict.detail, /22\.14\.0/);
  assert.match(verdict.detail, /nvm install|Upgrade/i);
});

test("the running process itself clears the floor — or this suite could not be trusted", () => {
  assert.equal(nodeFloorVerdict(process.versions.node).ok, true);
});
