/**
 * Tests for THE ROUTING POLICY.
 *
 * Two of these are the reason the file exists, and they are written in the adversarial
 * direction — not "does tier 1 material stay home when we ask nicely" but "is there ANY request
 * that gets tier 1 material to `escalate`":
 *
 *   `tier 1 material cannot reach escalate, under any policy` enumerates every declared kind as
 *   a policy and every co-occurring companion item, and asserts the decision is never `escalate`
 *   and the admitted set never names the tier 1 item. It is exhaustive over the vocabulary
 *   rather than illustrative, so adding a fourth kind to `DeclaredKind` without thinking about
 *   egress makes this test fail rather than quietly pass.
 *
 *   `an undeclared item defaults closed` asserts the same for material nobody declared.
 *
 * Nothing here is a fixture standing in for a real result: `route` is total over `unknown`, so
 * the inputs ARE the real inputs — the same records an app hands it after reading a store.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DECLARED_KINDS, classifyAll, contextItemId, type DeclaredKind } from "./classify.ts";
import {
  admittedForEgress,
  decide,
  route,
  type EgressPolicy,
  type RoutingDecision,
} from "./route.ts";

const policy = (...mayCross: DeclaredKind[]): EgressPolicy => ({ mayCross });
const ALL_SHAREABLE = policy("tier2-confidential", "tier3-shareable");

function ids(decision: RoutingDecision): readonly string[] {
  return admittedForEgress(decision).map((a) => a.id);
}

function withheldFor(decision: RoutingDecision, id: string): { reason: string } | undefined {
  if (decision.decision === "refused") return undefined;
  return decision.egress.withheld.find((w) => w.id === contextItemId(id));
}

/* ------------------------------------------------------------------ the load-bearing pair */

test("tier 1 material cannot reach escalate, under ANY policy or companion", () => {
  const tier1 = { id: "review-notes", declaredKind: "tier1-local" as const };

  // Every subset of the vocabulary that a policy is even allowed to name, including the empty
  // one, crossed with every kind of companion item and with no companion at all.
  const permittable = DECLARED_KINDS.filter((k) => k !== "tier1-local");
  const policies: DeclaredKind[][] = [[], ...permittable.map((k) => [k]), [...permittable]];
  const companions: (readonly unknown[])[] = [
    [],
    ...DECLARED_KINDS.map((k) => [{ id: `co-${k}`, declaredKind: k }]),
    [{ id: "co-undeclared" }],
  ];

  let cases = 0;
  for (const mayCross of policies) {
    for (const companion of companions) {
      for (const items of [[tier1, ...companion], [...companion, tier1]]) {
        const decision = route({ policy: { mayCross }, items });
        cases += 1;
        assert.notEqual(
          decision.decision,
          "escalate",
          `escalated with policy ${JSON.stringify(mayCross)} and items ${JSON.stringify(items)}`,
        );
        assert.equal(decision.decision, "local-only");
        if (decision.decision !== "local-only") continue;
        assert.ok(decision.causes.includes("tier1-material-present"));
        assert.deepEqual(admittedForEgress(decision), [], "nothing may cross");
        assert.equal(withheldFor(decision, "review-notes")?.reason, "device-only");
      }
    }
  }
  assert.ok(cases >= 30, `expected the sweep to be exhaustive, ran ${cases} cases`);
});

test("an undeclared item defaults closed — it cannot reach escalate either", () => {
  const undeclared = { id: "unknown-thing" };
  for (const mayCross of [[], ["tier3-shareable"], ["tier2-confidential", "tier3-shareable"]]) {
    for (const items of [
      [undeclared],
      [undeclared, { id: "ok", declaredKind: "tier3-shareable" }],
      [{ id: "ok", declaredKind: "tier3-shareable" }, undeclared],
    ]) {
      const decision = route({ policy: { mayCross }, items });
      assert.equal(decision.decision, "local-only", JSON.stringify({ mayCross, items }));
      if (decision.decision !== "local-only") continue;
      assert.ok(decision.causes.includes("undeclared-material-present"));
      assert.deepEqual(admittedForEgress(decision), []);
      assert.equal(withheldFor(decision, "unknown-thing")?.reason, "undeclared");
    }
  }
});

/* --------------------------------------------------- the policy that tries to unlock tier 1 */

test("a policy naming tier1-local as exportable is REFUSED, not honoured", () => {
  const decision = route({
    policy: { mayCross: ["tier1-local", "tier3-shareable"] },
    items: [{ id: "n", declaredKind: "tier3-shareable" }],
  });
  assert.equal(decision.decision, "refused");
  if (decision.decision !== "refused") return;
  assert.equal(decision.cause, "tier1-egress-declared");
  assert.equal(decision.issues[0]?.at, "policy.mayCross[0]");
  assert.deepEqual(admittedForEgress(decision), []);
});

test("the tier1 policy refusal fires even when no tier 1 material is present", () => {
  // A broken setting must be reported when it is written, not on the day it first matters.
  const decision = route({ policy: { mayCross: ["tier1-local"] }, items: [] });
  assert.equal(decision.decision, "refused");
  if (decision.decision === "refused") assert.equal(decision.cause, "tier1-egress-declared");
});

/* ------------------------------------------------------------------- the ordinary decisions */

test("a fully permitted context escalates, and the admitted set is exactly that context", () => {
  const decision = route({
    policy: ALL_SHAREABLE,
    items: [
      { id: "a", declaredKind: "tier3-shareable" },
      { id: "b", declaredKind: "tier2-confidential" },
    ],
  });
  assert.equal(decision.decision, "escalate");
  assert.deepEqual(ids(decision), ["a", "b"]);
  if (decision.decision === "escalate") assert.deepEqual(decision.egress.withheld, []);
});

test("one item the policy does not permit stops the WHOLE request escalating", () => {
  const decision = route({
    policy: policy("tier3-shareable"),
    items: [
      { id: "a", declaredKind: "tier3-shareable" },
      { id: "b", declaredKind: "tier2-confidential" },
    ],
  });
  assert.equal(decision.decision, "tier2-eligible");
  assert.deepEqual(admittedForEgress(decision), [], "a partial context never crosses");
  assert.equal(withheldFor(decision, "b")?.reason, "not-permitted-by-policy");
  assert.equal(withheldFor(decision, "a")?.reason, "request-not-escalated");
});

test("an empty mayCross is the device-only posture and says so by name", () => {
  const decision = route({
    policy: policy(),
    items: [{ id: "a", declaredKind: "tier3-shareable" }],
  });
  assert.equal(decision.decision, "local-only");
  if (decision.decision !== "local-only") return;
  assert.deepEqual([...decision.causes], ["policy-permits-no-egress"]);
});

test("an EMPTY context is a real result, not a refusal — this is the fresh-store state", () => {
  // The honest empty state the demo path depends on: with nothing assembled, the router still
  // runs and still produces a decision. It must NOT refuse, or a machine with an empty Tier 1
  // store would report a policy refusal where the real fact is "there is nothing here yet".
  const decision = route({ policy: ALL_SHAREABLE, items: [] });
  assert.equal(decision.decision, "escalate");
  assert.deepEqual(admittedForEgress(decision), []);
  if (decision.decision === "escalate") assert.deepEqual(decision.egress.withheld, []);
});

/* ------------------------------------------------------------------ causes are never merged */

test("local-only reports EVERY cause that applies, not the first one", () => {
  const decision = route({
    policy: policy(),
    items: [{ id: "t1", declaredKind: "tier1-local" }, { id: "u" }],
  });
  assert.equal(decision.decision, "local-only");
  if (decision.decision !== "local-only") return;
  assert.deepEqual(
    [...decision.causes].sort(),
    ["policy-permits-no-egress", "tier1-material-present", "undeclared-material-present"].sort(),
  );
});

test("the specific withheld reason survives the general one", () => {
  const decision = route({
    policy: policy("tier3-shareable"),
    items: [
      { id: "t1", declaredKind: "tier1-local" },
      { id: "u" },
      { id: "conf", declaredKind: "tier2-confidential" },
      { id: "share", declaredKind: "tier3-shareable" },
    ],
  });
  assert.equal(decision.decision, "local-only");
  assert.equal(withheldFor(decision, "t1")?.reason, "device-only");
  assert.equal(withheldFor(decision, "u")?.reason, "undeclared");
  assert.equal(withheldFor(decision, "conf")?.reason, "not-permitted-by-policy");
  assert.equal(withheldFor(decision, "share")?.reason, "request-is-local-only");
});

/* --------------------------------------------------------- the enumerability of the withheld */

test("admitted and withheld partition every item exactly once, in every decision", () => {
  const items = [
    { id: "t1", declaredKind: "tier1-local" },
    { id: "conf", declaredKind: "tier2-confidential" },
    { id: "share", declaredKind: "tier3-shareable" },
    { id: "u" },
  ];
  const seen: string[] = [];
  for (const mayCross of [[], ["tier3-shareable"], ["tier2-confidential", "tier3-shareable"]]) {
    for (const subset of [items, items.slice(1), items.slice(1, 3), [], items.slice(2, 3)]) {
      const decision = route({ policy: { mayCross }, items: subset });
      assert.notEqual(decision.decision, "refused");
      if (decision.decision === "refused") continue;
      const accounted = [
        ...decision.egress.admitted.map((a) => String(a.id)),
        ...decision.egress.withheld.map((w) => String(w.id)),
      ];
      assert.deepEqual(
        [...accounted].sort(),
        subset.map((i) => i.id).sort(),
        "every item is accounted for exactly once",
      );
      assert.equal(new Set(accounted).size, accounted.length, "no item is in both lists");
      seen.push(decision.decision);
    }
  }
  assert.ok(seen.includes("local-only") && seen.includes("escalate"));
});

test("escalate happens if and ONLY if nothing was withheld", () => {
  const kinds: readonly (DeclaredKind | "undeclared")[] = [...DECLARED_KINDS, "undeclared"];
  for (const mayCross of [[], ["tier3-shareable"], ["tier2-confidential", "tier3-shareable"]]) {
    for (const a of kinds) {
      for (const b of kinds) {
        const item = (id: string, k: DeclaredKind | "undeclared") =>
          k === "undeclared" ? { id } : { id, declaredKind: k };
        const decision = route({ policy: { mayCross }, items: [item("a", a), item("b", b)] });
        if (decision.decision === "refused") continue;
        const nothingWithheld = decision.egress.withheld.length === 0;
        assert.equal(
          decision.decision === "escalate",
          nothingWithheld,
          `${decision.decision} with withheld=${decision.egress.withheld.length}`,
        );
      }
    }
  }
});

/* ------------------------------------------------------------- refusals, and what they are not */

test("a score-shaped key anywhere refuses the request BY NAME", () => {
  const inItem = route({
    policy: ALL_SHAREABLE,
    items: [{ id: "a", declaredKind: "tier3-shareable", confidence: 0.9 }],
  });
  assert.equal(inItem.decision, "refused");
  if (inItem.decision === "refused") assert.equal(inItem.cause, "score-shaped-key");

  const inRequest = route({ policy: ALL_SHAREABLE, items: [], score: 3 });
  assert.equal(inRequest.decision, "refused");
  if (inRequest.decision === "refused") assert.equal(inRequest.cause, "score-shaped-key");

  const inPolicy = route({ policy: { mayCross: [], threshold: 1 }, items: [] });
  assert.equal(inPolicy.decision, "refused");
});

test("a score-shaped key wins the headline cause over a co-occurring malformation", () => {
  const decision = route({
    policy: ALL_SHAREABLE,
    items: [{ id: "a", declaredKind: "tier3-shareable" }, { id: "b", weight: 2 }],
  });
  assert.equal(decision.decision, "refused");
  if (decision.decision === "refused") assert.equal(decision.cause, "score-shaped-key");
});

test("policy refusals are never named like transport failures", () => {
  // The demo path this slice exists to show runs on a machine with no API key. "policy would not
  // let this leave" and "there was nobody to send it to" occur in the same second, and a person
  // must be able to tell them apart. No cause this package can emit is a transport cause.
  const TRANSPORT = ["no-credential", "network-unreachable", "timeout", "provider-refused", "malformed-response"];
  const refusals: string[] = [];
  for (const bad of [null, "x", 7, {}, { policy: {}, items: [] }, { policy: { mayCross: ["nope"] }, items: [] }]) {
    const decision = route(bad);
    assert.equal(decision.decision, "refused", JSON.stringify(bad));
    if (decision.decision === "refused") refusals.push(decision.cause);
  }
  for (const cause of refusals) assert.equal(TRANSPORT.includes(cause), false, cause);
  assert.ok(refusals.includes("malformed-request") || refusals.includes("malformed-policy"));
  assert.ok(refusals.includes("unrecognized-egress-kind"));
});

test("a missing or malformed policy is refused — there is no default egress policy", () => {
  for (const bad of [{ items: [] }, { policy: null, items: [] }, { policy: { mayCross: "all" }, items: [] }]) {
    const decision = route(bad);
    assert.equal(decision.decision, "refused");
    if (decision.decision === "refused") assert.equal(decision.cause, "malformed-policy");
  }
});

test("a malformed item refuses the request rather than routing the rest of the context", () => {
  const decision = route({
    policy: ALL_SHAREABLE,
    items: [{ id: "a", declaredKind: "tier3-shareable" }, "not-a-record"],
  });
  assert.equal(decision.decision, "refused");
  if (decision.decision !== "refused") return;
  assert.equal(decision.cause, "malformed-context");
  assert.equal(decision.issues[0]?.at, "items[1]");
});

test("a refused decision has no egress plan to misread, and admits nothing", () => {
  const decision = route("nonsense");
  assert.equal(decision.decision, "refused");
  assert.equal(Object.hasOwn(decision, "egress"), false);
  assert.deepEqual(admittedForEgress(decision), []);
});

/* ---------------------------------------------------------------------- purity and the shape */

test("route does not mutate its input", () => {
  const input = {
    policy: { mayCross: ["tier3-shareable"] },
    items: [{ id: "a", declaredKind: "tier3-shareable" }],
  };
  const before = JSON.stringify(input);
  route(input);
  assert.equal(JSON.stringify(input), before);
});

test("route is deterministic — no clock, no randomness", () => {
  const input = { policy: ALL_SHAREABLE, items: [{ id: "a", declaredKind: "tier1-local" }] };
  assert.deepEqual(route(input), route(input));
});

test("decide is usable on its own, over already-classified context", () => {
  const classified = classifyAll([{ id: "a", declaredKind: "tier3-shareable" }]);
  const decision = decide(classified, new Set(["tier3-shareable"]));
  assert.equal(decision.decision, "escalate");
  assert.deepEqual(ids(decision), ["a"]);
});

test("no decision carries a number, a boolean or an ordering a caller could read as a score", () => {
  // Walks the whole decision object. Arrays are containers, not magnitudes, so their contents
  // are walked and their length is not the thing under test; any scalar number or boolean
  // reachable on a decision would be a value someone could threshold on.
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((e, i) => walk(e, `${path}[${i}]`));
      return;
    }
    if (typeof v === "object" && v !== null) {
      for (const [k, e] of Object.entries(v)) walk(e, `${path}.${k}`);
      return;
    }
    assert.equal(typeof v === "number", false, `number at ${path}`);
    assert.equal(typeof v === "boolean", false, `boolean at ${path}`);
  };
  for (const mayCross of [[], ["tier3-shareable"], ["tier2-confidential", "tier3-shareable"]]) {
    for (const items of [
      [],
      [{ id: "a", declaredKind: "tier1-local" }],
      [{ id: "a", declaredKind: "tier3-shareable" }, { id: "b" }],
      [{ id: "a", declaredKind: "tier2-confidential" }],
    ]) {
      walk(route({ policy: { mayCross }, items }), "decision");
    }
  }
  walk(route("nonsense"), "refused");
});
