import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyEvent,
  availableEvents,
  isPublic,
  NON_PUBLIC_STATES,
  TRANSITIONS,
  type ReleaseState,
} from "./release.ts";

test("internal is the default and only the subject may propose", () => {
  const bySubject = applyEvent("internal", "propose", "subject");
  assert.ok(bySubject.ok);
  assert.equal(bySubject.state, "proposed");

  const byOwner = applyEvent("internal", "propose", "policy_owner");
  assert.ok(!byOwner.ok);
  assert.match(byOwner.reason, /not permitted for actor/);
});

test("approved is NOT public — approval and egress are separate events", () => {
  assert.equal(isPublic("approved"), false);
  assert.equal(isPublic("live"), true);
  for (const s of NON_PUBLIC_STATES) assert.equal(isPublic(s), false);
});

test("exactly one state is public", () => {
  const all: ReleaseState[] = [
    "internal",
    "proposed",
    "in_review",
    "approved",
    "live",
    "withdrawn",
  ];
  assert.equal(all.filter(isPublic).length, 1);
});

test("the happy path reaches live only through review, approval, then publish", () => {
  let state: ReleaseState = "internal";
  for (const [event, actor] of [
    ["propose", "subject"],
    ["open_review", "policy_owner"],
    ["approve", "policy_owner"],
    ["publish", "subject"],
  ] as const) {
    const r = applyEvent(state, event, actor);
    assert.ok(r.ok, `${event} should be legal from ${state}: ${r.ok ? "" : r.reason}`);
    state = r.state;
  }
  assert.equal(state, "live");
  assert.ok(isPublic(state));
});

test("you cannot publish straight from internal", () => {
  const r = applyEvent("internal", "publish", "policy_owner");
  assert.ok(!r.ok);
  assert.match(r.reason, /not a legal transition/);
});

test("approval cannot be self-served by the subject", () => {
  const r = applyEvent("in_review", "approve", "subject");
  assert.ok(!r.ok);
  assert.match(r.reason, /not permitted/);
});

test("a failed transition never returns a state", () => {
  const r = applyEvent("live", "approve", "policy_owner");
  assert.ok(!r.ok);
  assert.ok(!("state" in r), "failure must not carry a state a caller could use");
});

test("illegal-transition and wrong-actor are distinguishable, not collapsed", () => {
  const illegal = applyEvent("internal", "publish", "policy_owner");
  const wrongActor = applyEvent("internal", "propose", "policy_owner");
  assert.ok(!illegal.ok && !wrongActor.ok);
  assert.notEqual(illegal.reason, wrongActor.reason);
});

test("withdrawn is distinct from internal — it keeps an exposure history", () => {
  const r = applyEvent("live", "withdraw", "subject");
  assert.ok(r.ok);
  assert.equal(r.state, "withdrawn");
  assert.notEqual(r.state, "internal");
  // and may be re-proposed, which forces fresh review
  const again = applyEvent("withdrawn", "propose", "subject");
  assert.ok(again.ok);
  assert.equal(again.state, "proposed");
});

test("availableEvents matches what applyEvent will actually accept", () => {
  const states: ReleaseState[] = [
    "internal",
    "proposed",
    "in_review",
    "approved",
    "live",
    "withdrawn",
  ];
  for (const s of states) {
    for (const actor of ["subject", "policy_owner", "system"] as const) {
      for (const e of availableEvents(s, actor)) {
        assert.ok(applyEvent(s, e, actor).ok, `${actor} ${e} from ${s} advertised but rejected`);
      }
    }
  }
});

test("no transition leads to live except publish", () => {
  const toLive = TRANSITIONS.filter((t) => t.to === "live");
  assert.equal(toLive.length, 1);
  assert.equal(toLive[0]!.event, "publish");
  assert.equal(toLive[0]!.from, "approved");
});

test("the transition table is frozen", () => {
  assert.ok(Object.isFrozen(TRANSITIONS));
});
