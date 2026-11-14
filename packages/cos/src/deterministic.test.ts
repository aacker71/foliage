/**
 * Tests for the deterministic floor.
 *
 * ADVERSARIAL POSTURE. These do not check that the floor produces text. They check the four
 * things it would be dishonest without:
 *
 *   1. it produces a USEFUL turn against an EMPTY store, and cites nothing there — because
 *      there is nothing to cite, and anything it cited would be invented;
 *   2. every statement it makes about the person carries an id that came from the INPUT, so a
 *      citation cannot be to something that was never handed to it;
 *   3. an unreadable store and an empty store never produce the same sentence; and
 *   4. nothing it emits is score-shaped, ordered, or a claim it has read anything.
 *
 * Classifications are built by running the real `classifyAll` over real records rather than
 * hand-writing `ItemClassification` values, so these exercise the actual seam the router uses.
 */

import { deepStrictEqual, equal, notEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { SCORE_SHAPED } from "@foliage/leaf";
import { classifyAll } from "./classify.ts";
import * as floorModule from "./deterministic.ts";
import { deterministicTurn, type FloorEntry, type FloorRequest } from "./deterministic.ts";
import { renderMove, renderTurn, type CiteMove, type Move, type Turn } from "./turn.ts";

const FLOOR_ONLY: FloorEntry = { by: "floor-only" };

function req(over: Partial<FloorRequest> = {}): FloorRequest {
  return {
    request: "what should I do about the platform review",
    requestKind: null,
    material: { state: "empty" },
    entry: FLOOR_ONLY,
    ...over,
  };
}

const kinds = (t: Turn): readonly Move["move"][] => t.moves.map((m) => m.move);
const cites = (t: Turn): readonly CiteMove[] => t.moves.filter((m): m is CiteMove => m.move === "cite");
const text = (t: Turn): string => renderTurn(t).join("\n");
const renderMoveText = (m: Move): string => renderMove(m).join("\n");

// =======================================================================================
// The honest empty state — contract item 3
// =======================================================================================

test("an empty store gets a useful answer, not an error", () => {
  const t = deterministicTurn(req({ material: { state: "empty" } }));
  equal(t.provenance.source, "deterministic");
  ok(t.moves.length >= 4);
  ok(kinds(t).includes("propose"), "the floor must propose a concrete next move");
  ok(!kinds(t).includes("decline"), "an empty store is not a refusal");
});

test("an empty store produces ZERO citations, because there is nothing on file to cite", () => {
  // This is the mechanical form of "no seeded row, no demo, no fixture". A `cite` cannot exist
  // without a ContextItemId, so if this list is empty then the turn structurally contains no
  // example item — there is no wording to review and no prose test to keep up to date.
  const t = deterministicTurn(req({ material: { state: "empty" } }));
  deepStrictEqual(cites(t), []);
});

test("the empty answer says what filing costs and what would then be possible", () => {
  const t = deterministicTurn(req({ material: { state: "empty" } }));
  const s = text(t);
  ok(s.includes("Nothing is on file"));
  ok(s.includes("tier1-local") && s.includes("tier2-confidential") && s.includes("tier3-shareable"));
  ok(s.includes("does not seed a store"));
});

// =======================================================================================
// The floor never claims to be reasoning — contract item 2
// =======================================================================================

test("every turn opens by saying no model produced it", () => {
  for (const material of [
    { state: "empty" } as const,
    { state: "present", items: classifyAll([{ id: "a", declaredKind: "tier2-confidential" }]) } as const,
    { state: "unavailable", cause: "store-unreadable", detail: "d" } as const,
  ]) {
    const t = deterministicTurn(req({ material }));
    const first = t.moves[0];
    equal(first.move, "answer");
    ok(first.text.includes("not by reasoning"));
    ok(first.text.includes("No model produced any of it"));
  }
});

test("a store with material says out loud that nothing was read", () => {
  const t = deterministicTurn(
    req({ material: { state: "present", items: classifyAll([{ id: "platform-review", declaredKind: "tier1-local" }]) } }),
  );
  ok(text(t).includes("it did not open any of your material"));
});

// =======================================================================================
// Citations — contract item 4
// =======================================================================================

test("every item is enumerated as a citation, in the order it was assembled, declared or not", () => {
  const items = classifyAll([
    { id: "platform-review", declaredKind: "tier1-local" },
    { id: "promo-packet" },
    { id: "salary-band", declaredKind: "tier3-shareable" },
  ]);
  const t = deterministicTurn(req({ request: "", material: { state: "present", items } }));
  // Request is blank, so no match pass runs and the citations are exactly the inventory.
  deepStrictEqual(
    cites(t).map((c) => c.source),
    ["platform-review", "promo-packet", "salary-band"],
  );
  // Order is the caller's assembly order. Nothing sorts, and nothing is promoted.
  const s = text(t);
  ok(s.includes('On file as "platform-review", declared tier1-local.'));
  ok(s.includes("no usable declaration (`no-declaration`)"));
});

test("no citation is ever to an id that was not handed in", () => {
  const ids = ["platform-review", "promo-packet"];
  const items = classifyAll(ids.map((id) => ({ id, declaredKind: "tier2-confidential" })));
  const t = deterministicTurn(req({ request: "review the promo packet and the platform", material: { state: "present", items } }));
  for (const c of cites(t)) ok(ids.includes(c.source), `invented citation: ${c.source}`);
  ok(cites(t).length > ids.length, "the match pass adds citations beyond the inventory");
});

test("every citation carries where the item sat, so it can be found again", () => {
  const items = classifyAll([{ id: "a", declaredKind: "tier2-confidential" }, { id: "b" }]);
  const t = deterministicTurn(req({ request: "", material: { state: "present", items } }));
  deepStrictEqual(cites(t).map((c) => c.at), ["items[0]", "items[1]"]);
});

// =======================================================================================
// Matching is by name, is not a substring, and is not a ranking
// =======================================================================================

test("a name match is reported as a match on the NAME, never on the contents", () => {
  const items = classifyAll([{ id: "platform-review-2026", declaredKind: "tier2-confidential" }]);
  const t = deterministicTurn(req({ request: "what should I do about the platform review", material: { state: "present", items } }));
  const match = cites(t).find((c) => c.statement.includes("shares"));
  ok(match !== undefined);
  ok(match.statement.includes("match on the NAME you gave it"));
  ok(match.statement.includes("not that they are about the same thing"));
  ok(match.statement.includes('"platform"') && match.statement.includes('"review"'));
});

test("matching is whole-word, not substring — 'art' does not match 'startup'", () => {
  // `includes()` here would produce a real citation attached to a relationship that does not
  // exist: a false claim wearing a true id, which is the worst available shape.
  const items = classifyAll([{ id: "startup-notes", declaredKind: "tier2-confidential" }]);
  const t = deterministicTurn(req({ request: "art", material: { state: "present", items } }));
  ok(!cites(t).some((c) => c.statement.includes("shares")));
  ok(kinds(t).includes("ask"), "an unmatched word becomes a question, not a claim");
});

test("an unmatched word becomes a QUESTION, grounded in the enumeration that precedes it", () => {
  const items = classifyAll([{ id: "platform-review", declaredKind: "tier2-confidential" }]);
  const t = deterministicTurn(req({ request: "platform review and board seat", material: { state: "present", items } }));
  const question = t.moves.find((m) => m.move === "ask");
  ok(question !== undefined && question.move === "ask");
  ok(question.question.includes("Every item on file is named above"));
  ok(question.question.includes('"board"') && question.question.includes('"seat"'));
  ok(question.why?.includes("not a gap in your career"));
  // And the absence is never stated as a finding about the person.
  ok(!text(t).includes("You have nothing"));
});

test("nothing in the module can order, compare or rate", () => {
  const banned = /sort|compar|rank|score|rate|weigh|prior|best|top/i;
  for (const name of Object.keys(floorModule)) ok(!banned.test(name), `suspicious export: ${name}`);
  const source = renderTurn(
    deterministicTurn(
      req({
        request: "platform review promotion",
        material: {
          state: "present",
          items: classifyAll([
            { id: "platform-review", declaredKind: "tier2-confidential" },
            { id: "promotion-notes", declaredKind: "tier1-local" },
          ]),
        },
      }),
    ),
  ).join(" ");
  // No total, no fraction, no "N of M": a count of how much of someone's material matched is a
  // measure of them, and a measure invites a threshold.
  ok(!/\b\d+\s+of\s+\d+\b/.test(source));
  ok(!/\b\d+%/.test(source));
});

// =======================================================================================
// Unreadable is never empty — the collapse this repo keeps paying for
// =======================================================================================

test("an unreadable store declines with its own cause and never reports an empty one", () => {
  const t = deterministicTurn(
    req({ material: { state: "unavailable", cause: "store-unreadable", detail: "the tag did not verify." } }),
  );
  const refusal = t.moves.find((m) => m.move === "decline");
  ok(refusal !== undefined && refusal.move === "decline");
  equal(refusal.cause, "material-unreadable");
  ok(refusal.detail.includes("NOT the same fact as an empty store"));
  ok(!text(t).includes("Nothing is on file"));
  deepStrictEqual(cites(t), [], "an unreadable store entitles this to say nothing about what you hold");
});

test("a locked store proposes unlocking; an unread store is not reported as a failure at all", () => {
  const locked = deterministicTurn(req({ material: { state: "unavailable", cause: "store-locked", detail: "d" } }));
  ok(text(locked).includes("Unlock the store"));

  const unread = deterministicTurn(req({ material: { state: "unavailable", cause: "not-consulted", detail: "d" } }));
  ok(!kinds(unread).includes("decline"), "not looking is not a failure");
  ok(text(unread).includes("An unread store is not an empty one"));
});

test("a malformed entry is named, never skipped, and never becomes a citation", () => {
  const items = classifyAll([
    { id: "ok-item", declaredKind: "tier2-confidential" },
    { id: "bad", declaredKind: "tier2-confidential", confidence: 0.9 },
    "not a record",
  ]);
  const t = deterministicTurn(req({ request: "", material: { state: "present", items } }));
  const refusals = t.moves.filter((m) => m.move === "decline");
  equal(refusals.length, 2);
  for (const r of refusals) equal(r.cause, "material-malformed");
  ok(text(t).includes("score-shaped-key"), "the score-shaped refusal reads as itself, not as a schema mismatch");
  deepStrictEqual(cites(t).map((c) => c.source), ["ok-item"]);
});

test("a context where NOTHING is a valid item states no absence, because it enumerated nothing", () => {
  const t = deterministicTurn(req({ material: { state: "present", items: classifyAll([42, "x"]) } }));
  const refusal = t.moves.find((m) => m.move === "decline" && m.cause === "nothing-on-file");
  ok(refusal !== undefined);
  ok(text(t).includes("not the same as an empty store"));
  ok(!text(t).includes("Every item on file is named above"));
});

// =======================================================================================
// How the request arrived — contract item 7
// =======================================================================================

test("a policy-kept request says the boundary worked, and is not filed as a failure", () => {
  const t = deterministicTurn(
    req({ entry: { by: "policy", decision: "local-only", detail: "tier1-material-present." } }),
  );
  const s = text(t);
  ok(s.includes("the router decided `local-only`"));
  ok(s.includes("privacy boundary working, not a failure"));
  ok(!kinds(t).includes("decline"));
});

test("a policy REFUSAL declines with its own cause and is never mistaken for a transport failure", () => {
  const t = deterministicTurn(req({ entry: { by: "policy", decision: "refused", detail: "malformed policy." } }));
  const refusal = t.moves.find((m) => m.move === "decline");
  ok(refusal !== undefined && refusal.move === "decline");
  equal(refusal.cause, "policy-refused");
  ok(refusal.detail.includes("POLICY refusal and not a transport failure"));
  // An answer still exists on this path. That is the whole of contract item 1.
  ok(t.moves.length >= 3);
});

test("each named local-model failure reaches the floor and says which cause sent it there", () => {
  for (const cause of ["no-runtime", "model-absent", "timeout", "malformed-response"] as const) {
    const t = deterministicTurn(req({ entry: { by: "local-model-failed", cause, detail: "d" } }));
    ok(text(t).includes(`\`${cause}\``), `${cause} is not named in the answer`);
    ok(text(t).includes("upgrade here and never a dependency"));
    ok(t.moves.length >= 3, `${cause} produced no answer`);
  }
});

test("each named escalation failure reaches the floor and says which cause sent it there", () => {
  for (const cause of [
    "no-credential",
    "no-model",
    "timeout",
    "network-unreachable",
    "provider-refused",
    "malformed-response",
  ] as const) {
    const t = deterministicTurn(req({ entry: { by: "escalation-failed", cause, detail: "d" } }));
    ok(text(t).includes(`\`${cause}\``), `${cause} is not named in the answer`);
    ok(t.moves.length >= 3, `${cause} produced no answer`);
  }
});

test("the four local causes never produce the same sentence as each other", () => {
  const said = new Set<string>();
  for (const cause of ["no-runtime", "model-absent", "timeout", "malformed-response"] as const) {
    said.add(text(deterministicTurn(req({ entry: { by: "local-model-failed", cause, detail: "d" } }))));
  }
  equal(said.size, 4);
});

// =======================================================================================
// The request itself
// =======================================================================================

test("the request is read back verbatim and its declaration is stated, never guessed", () => {
  const t = deterministicTurn(req({ request: "  should I take the staff role?  ", requestKind: "tier1-local" }));
  const s = text(t);
  ok(s.includes('"should I take the staff role?"'));
  ok(s.includes("You declared the request itself tier1-local."));

  const undeclared = deterministicTurn(req({ requestKind: null }));
  ok(text(undeclared).includes("most restrictive kind rather than guessed at"));
});

test("a blank request asks what is needed instead of answering something that was not asked", () => {
  const t = deterministicTurn(req({ request: "   " }));
  const question = t.moves.find((m) => m.move === "ask");
  ok(question !== undefined && question.move === "ask");
  ok(question.question.startsWith("What do you need?"));
  ok(!text(t).includes("verbatim and unaltered"));
});

// =======================================================================================
// Totality, purity, and the standing invariants
// =======================================================================================

test("the floor is total over hostile input and never throws", () => {
  const nasty = [
    "",
    "  ",
    '"quotes" and `backticks` and ${injection}',
    "resume - naive - Beijing",
    "a".repeat(20000),
    "\n\n\n",
  ];
  for (const request of nasty) {
    const t = deterministicTurn(
      req({
        request,
        material: { state: "present", items: classifyAll([{ id: "a", declaredKind: "tier2-confidential" }]) },
      }),
    );
    ok(t.moves.length >= 1, `no answer for ${JSON.stringify(request.slice(0, 20))}`);
  }
});

test("the floor is deterministic: same input, same turn", () => {
  const input = req({
    request: "platform review",
    material: {
      state: "present",
      items: classifyAll([{ id: "platform-review", declaredKind: "tier2-confidential" }, { id: "loose" }]),
    },
    entry: { by: "local-model-failed", cause: "timeout", detail: "after 45000ms." },
  });
  deepStrictEqual(deterministicTurn(input), deterministicTurn(input));
});

test("a turn is never empty, on any combination of entry and material", () => {
  const entries: readonly FloorEntry[] = [
    FLOOR_ONLY,
    { by: "policy", decision: "local-only", detail: "d" },
    { by: "policy", decision: "tier2-eligible", detail: "d" },
    { by: "policy", decision: "refused", detail: "d" },
    { by: "local-model-failed", cause: "no-runtime", detail: "d" },
    { by: "escalation-failed", cause: "no-credential", detail: "d" },
  ];
  const materials = [
    { state: "empty" } as const,
    { state: "present", items: classifyAll([{ id: "a", declaredKind: "tier1-local" }]) } as const,
    { state: "present", items: [] } as const,
    { state: "unavailable", cause: "store-unreadable", detail: "d" } as const,
    { state: "unavailable", cause: "not-consulted", detail: "d" } as const,
  ];
  for (const entry of entries) {
    for (const material of materials) {
      for (const request of ["", "platform review"]) {
        const t = deterministicTurn(req({ entry, material, request }));
        ok(t.moves.length >= 1);
        equal(t.provenance.source, "deterministic");
      }
    }
  }
});

test("nothing the floor emits of its own is score-shaped", () => {
  // The list comes from @foliage/leaf by name rather than being re-declared, so the day a word
  // is added there this test starts enforcing it without an edit here.
  const t = deterministicTurn(
    req({
      request: "platform review promotion board",
      material: {
        state: "present",
        items: classifyAll([
          { id: "platform-review", declaredKind: "tier2-confidential" },
          { id: "loose-notes" },
          { id: "not-a-record-below" },
          42,
        ]),
      },
      entry: { by: "escalation-failed", cause: "provider-refused", detail: "status 429." },
    }),
  );
  for (const w of text(t).toLowerCase().split(/[^a-z]+/)) {
    // `score-shaped-key` is the classifier's own refusal CAUSE, quoted back so the person can
    // see which rule fired. That is the one legitimate appearance of the word, and it is the
    // only exemption in this file.
    if (w === "score") continue;
    ok(!SCORE_SHAPED.has(w), `the floor emitted the score-shaped word "${w}"`);
  }
});

test("a score-shaped key in the INPUT is quoted back verbatim, and only inside the refusal", () => {
  /* Measured, not assumed: the floor passes `classify`'s refusal detail straight through, and
     that detail names the offending key by name — so a context carrying `confidence` puts the
     word "confidence" into the answer. That is correct and is deliberately not sanitized. This
     product never silently rewrites evidence; a redactor that quietly altered what it found
     would be the failure, and a refusal that will not say WHICH key it refused sends the person
     to add the field to a schema. What must hold is narrower: the word appears only as a
     QUOTATION inside a `material-malformed` decline, never in a statement the floor authored. */
  const t = deterministicTurn(
    req({
      request: "",
      material: {
        state: "present",
        items: classifyAll([
          { id: "ok-item", declaredKind: "tier2-confidential" },
          { id: "bad", declaredKind: "tier2-confidential", confidence: 0.9 },
        ]),
      },
    }),
  );
  const quoted = t.moves.filter((m) => m.move === "decline" && m.cause === "material-malformed");
  equal(quoted.length, 1);
  ok(quoted[0]?.move === "decline" && quoted[0].detail.includes('"confidence" is a score-shaped key'));

  // Every OTHER move is clean. A quotation inside a refusal is evidence; a score-shaped word
  // anywhere the floor speaks for itself would be the product computing one.
  const authored = t.moves.filter((m) => !(m.move === "decline" && m.cause === "material-malformed"));
  for (const m of authored) {
    for (const w of renderMoveText(m).toLowerCase().split(/[^a-z]+/)) {
      if (w === "score") continue;
      ok(!SCORE_SHAPED.has(w), `an authored move emitted the score-shaped word "${w}"`);
    }
  }
});

test("nothing the floor returns is evidence: no tier, no leaflet, no approval", () => {
  const t = deterministicTurn(
    req({ material: { state: "present", items: classifyAll([{ id: "a", declaredKind: "tier1-local" }]) } }),
  );
  const serialized = JSON.stringify(t);
  for (const forbidden of ["proofTier", "leaflet", "approved", "pending", "evidence"]) {
    ok(!serialized.includes(forbidden), `a turn carried "${forbidden}"`);
  }
});

test("a tier1-local item is enumerated by the floor — the floor runs on the device", () => {
  // Worth pinning: the egress rule keeps tier1 material away from a MODEL, not away from the
  // person's own machine. A floor that hid the person's own material from them would be
  // enforcing the wrong boundary.
  const t = deterministicTurn(
    req({ request: "", material: { state: "present", items: classifyAll([{ id: "review-notes", declaredKind: "tier1-local" }]) } }),
  );
  deepStrictEqual(cites(t).map((c) => c.source), ["review-notes"]);
  notEqual(text(t).indexOf("declared tier1-local"), -1);
});
