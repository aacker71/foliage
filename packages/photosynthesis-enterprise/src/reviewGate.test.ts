import { test } from "node:test";
import assert from "node:assert/strict";

import { TRANSITIONS, applyEvent } from "@foliage/enterprise-policy";

import { OUTWARD_EVENTS, UNREVIEWED_RELEASE_STATES } from "./reviewGate.ts";

/**
 * These tests check the DERIVATION, not a remembered answer. Asserting `{internal}` and nothing
 * else would pass just as well over a hardcoded set, which is the thing this module exists to
 * avoid — so the properties below are stated against @foliage/enterprise-policy's own table and
 * would fail if the closure stopped matching it.
 */

test("the unreviewed set is CLOSED: no ungated transition leaves it", () => {
  for (const t of TRANSITIONS) {
    if (OUTWARD_EVENTS.has(t.event) || !UNREVIEWED_RELEASE_STATES.has(t.from)) continue;
    assert.ok(
      UNREVIEWED_RELEASE_STATES.has(t.to),
      `"${t.event}" leads from "${t.from}" to "${t.to}" without passing the review gate, so an ` +
        `unreviewed draft can reach "${t.to}" and the set does not say so`,
    );
  }
});

test("...and TIGHT: every state outside it is reachable only through the gate", () => {
  const outside = [...new Set(TRANSITIONS.flatMap((t) => [t.from, t.to]))].filter(
    (s) => !UNREVIEWED_RELEASE_STATES.has(s),
  );
  assert.ok(outside.length > 0, "a set containing every state would gate nothing");
  for (const state of outside) {
    const ungatedWaysIn = TRANSITIONS.filter(
      (t) => t.to === state && !OUTWARD_EVENTS.has(t.event) && UNREVIEWED_RELEASE_STATES.has(t.from),
    );
    assert.deepEqual(ungatedWaysIn, [], `"${state}" has an ungated way in and is not really outside`);
  }
});

test("the drafted state is in the set — a new artifact has to be able to exist", () => {
  assert.ok(UNREVIEWED_RELEASE_STATES.has("internal"));
});

test("every outward event is an event the policy machine actually has", () => {
  // A typo here would silently gate nothing, and both doors would open.
  const declared = new Set(TRANSITIONS.map((t) => t.event));
  for (const event of OUTWARD_EVENTS) {
    assert.ok(declared.has(event), `"${event}" is gated here but is not in the transition table`);
  }
});

test("the gated events are the ones that actually increase exposure", () => {
  // Named rather than derived in the source, so the judgement is checked here instead: firing
  // each outward event from a state where it is legal must move the artifact to a state the
  // unreviewed set does not contain.
  for (const event of OUTWARD_EVENTS) {
    const rows = TRANSITIONS.filter((t) => t.event === event);
    assert.ok(rows.length > 0, `"${event}" appears in no transition`);
    for (const row of rows) {
      const result = applyEvent(row.from, row.event, row.actors[0]!);
      assert.ok(result.ok, `"${event}" from "${row.from}" should be legal for its own actor`);
      if (!result.ok) continue;
      assert.equal(
        UNREVIEWED_RELEASE_STATES.has(result.state),
        false,
        `"${event}" lands in "${result.state}", which an unreviewed draft may already hold — ` +
          `gating it would then be gating nothing`,
      );
    }
  }
});
