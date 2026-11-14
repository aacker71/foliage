/**
 * Tests for the partnership contract.
 *
 * The two most important assertions in this file DO NOT RUN. They are type-level, they are
 * checked by `tsc` during `pnpm check`, and they prove the things a runtime test cannot:
 *
 *   - an uncited claim about the person cannot be CONSTRUCTED, and
 *   - a turn with no moves cannot be constructed either.
 *
 * A runtime test can only ever check that the values this module happens to produce are
 * well-formed. It cannot check that a reviewer sitting down to write a bad one fails, because
 * the bad one would not compile and so could not be in the file to run. `Assert<T extends true>`
 * turns "this must not typecheck" into a constraint violation at build time, which is where the
 * gate is supposed to fire. Deleting these aliases deletes the proof.
 */

import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { SCORE_SHAPED } from "@foliage/leaf";
import * as turnModule from "./turn.ts";
import { contextItemId, type ContextItemId } from "./classify.ts";
import {
  answer,
  ask,
  cite,
  decline,
  deterministicProvenance,
  escalatedProvenance,
  localModelProvenance,
  propose,
  renderMove,
  renderProvenance,
  renderTurn,
  synthesis,
  turn,
  turnOf,
  unknownProvenance,
  type CiteMove,
  type Move,
  type Turn,
  type TurnProvenance,
} from "./turn.ts";

// =======================================================================================
// COMPILE-TIME PROOFS. These fail `pnpm check`, not `node --test`.
// =======================================================================================

type Assert<T extends true> = T;

/**
 * THE CITATION GATE. Every field a reviewer could name is present here — including `source`,
 * so this is not the "they forgot the id" case. It still is not a `CiteMove`, because the
 * attestation key is unnameable outside turn.ts. If someone weakens `CiteMove` to a plain
 * interface, this alias becomes `Assert<false>` and the build stops.
 *
 * Verified 2026-08-19 by removing the guard on a scratch copy: tsc reported
 * `TS2741: Property '[CITED]' is missing ... but required in type 'CiteMove'`.
 */
type UncitedShape = {
  readonly move: "cite";
  readonly attribution: "person";
  readonly source: ContextItemId;
  readonly at: string;
  readonly statement: string;
};
type _NoUncitedCiteByLiteral = Assert<UncitedShape extends CiteMove ? false : true>;

/** And the genuinely citation-free shape, for the same reason, from the other direction. */
type CitationFreeShape = { readonly move: "cite"; readonly statement: string };
type _NoCitationFreeCite = Assert<CitationFreeShape extends CiteMove ? false : true>;

/** NO EMPTY TURN. Neither an empty tuple nor a plain array satisfies `Turn["moves"]`. */
type _NoEmptyMoves = Assert<readonly [] extends Turn["moves"] ? false : true>;
type _NoUncheckedArrayOfMoves = Assert<readonly Move[] extends Turn["moves"] ? false : true>;

/** `turn(provenance)` alone does not compile: the first move is a required parameter. */
type _TurnNeedsAMove = Assert<
  readonly [TurnProvenance] extends Parameters<typeof turn> ? false : true
>;

/** MODEL IDENTITY LIVES ON THE TWO MODEL ARMS AND NOWHERE ELSE. */
type _NoModelOnDeterministic = Assert<
  "model" extends keyof Extract<TurnProvenance, { source: "deterministic" }> ? false : true
>;
type _NoModelOnUnknown = Assert<
  "model" extends keyof Extract<TurnProvenance, { source: "unknown" }> ? false : true
>;
type _ModelOnLocal = Assert<
  "model" extends keyof Extract<TurnProvenance, { source: "local-model" }> ? true : false
>;
type _ModelOnEscalated = Assert<
  "model" extends keyof Extract<TurnProvenance, { source: "escalated" }> ? true : false
>;

/** No move carries a hidden reasoning channel a renderer could show as the answer. */
type _NoReasoningField = Assert<"reasoning_content" extends keyof Move ? false : true>;
type _NoThinkingField = Assert<"thinking" extends keyof Move ? false : true>;

// =======================================================================================
// RUNTIME
// =======================================================================================

const ID = contextItemId("2026-review");

test("cite requires the source id as its first argument, positionally", () => {
  // Not a style check: `cite.length` is the count of parameters before any default, so a future
  // edit giving `source` a default value — the exact shape that would reopen the gate — changes
  // this number and fails here.
  equal(cite.length, 3);
  const m = cite(ID, "items[0]", "On file as \"2026-review\", declared tier1-local.");
  equal(m.move, "cite");
  equal(m.source, ID);
  equal(m.attribution, "person");
});

test("a cite carries an attestation the caller cannot forge, and it survives construction", () => {
  const m = cite(ID, "items[0]", "s");
  const symbols = Object.getOwnPropertySymbols(m);
  equal(symbols.length, 1);
  equal(m[symbols[0] as keyof typeof m] as unknown, true);
  // The brand is a real runtime property, not a phantom type: a debugger and a test can both
  // see it. A `declare`d symbol would typecheck and then be absent here.
});

test("the attestation does not leak into JSON, so a round-tripped cite must go back through cite()", () => {
  const m = cite(ID, "items[0]", "s");
  const round = JSON.parse(JSON.stringify(m)) as Record<string, unknown>;
  deepStrictEqual(Object.getOwnPropertySymbols(round), []);
  deepStrictEqual(Object.keys(round).sort(), ["at", "attribution", "move", "source", "statement"]);
});

test("propose and answer are labelled as the agent's own; ask and decline carry no author", () => {
  equal(propose("do the thing").attribution, "agent");
  equal(answer("here is how these usually work").attribution, "agent");
  ok(!("attribution" in ask("which one did you mean?")));
  ok(!("attribution" in decline("outside-scope", "not something this does")));
});

test("propose and ask carry an explicit null rather than an absent field", () => {
  // `exactOptionalPropertyTypes` is on: an optional field and a null field are different types
  // here, and "there is no rationale" is a fact worth carrying rather than a key to omit.
  deepStrictEqual(propose("t"), { move: "propose", attribution: "agent", text: "t", rationale: null });
  deepStrictEqual(ask("q"), { move: "ask", question: "q", why: null });
});

test("decline always names a cause", () => {
  const m = decline("would-require-guessing", "answering would mean inventing a fact about you");
  equal(m.cause, "would-require-guessing");
  ok(m.detail.length > 0);
});

test("turn preserves narrative order and never reorders moves", () => {
  const a = answer("first");
  const b = ask("second");
  const c = propose("third");
  const t = turn(deterministicProvenance(), a, b, c);
  deepStrictEqual(t.moves, [a, b, c]);
  // Rendering is order-preserving too: nothing anywhere sorts moves, because an ordering over
  // statements about a person is a rating of them under another name.
  const lines = renderTurn(t).join("\n");
  ok(lines.indexOf("first") < lines.indexOf("second"));
  ok(lines.indexOf("second") < lines.indexOf("third"));
});

test("turnOf falls back to the named empty move rather than producing an empty turn", () => {
  const fallback = decline("nothing-on-file", "nothing to say");
  const t = turnOf(deterministicProvenance(), fallback, []);
  deepStrictEqual(t.moves, [fallback]);
  const moves: readonly Move[] = [answer("a"), answer("b")];
  deepStrictEqual(turnOf(deterministicProvenance(), fallback, moves).moves, moves);
});

test("provenance constructors put model identity on the model arms only", () => {
  const det = deterministicProvenance();
  equal(det.source, "deterministic");
  ok(!("model" in det));

  const unattested = unknownProvenance("producer-did-not-attest", "arrived from an MCP client");
  equal(unattested.source, "unknown");
  ok(!("model" in unattested));

  const local = localModelProvenance({ runtime: "ollama", model: "gemma4:12b", endpoint: "127.0.0.1:11434" });
  ok("model" in local);
  const remote = escalatedProvenance({ runtime: "fireworks", model: "kimi-k3", endpoint: null });
  ok("model" in remote);
});

test("the deterministic provenance line says a model was NOT involved, not merely where it ran", () => {
  const line = renderProvenance(deterministicProvenance());
  ok(line.includes("No model was involved"));
  ok(line.includes("nothing below is reasoning"));
  // "assembled on this machine" alone reads to most people as "an AI ran locally". It did not.
  ok(!/^deterministic — assembled on this machine\.?$/.test(line));
});

test("an unattested turn says so in its own line rather than looking deterministic", () => {
  const line = renderProvenance(unknownProvenance("conflicting-producers", "two sources contributed."));
  ok(line.startsWith("unknown — conflicting-producers:"));
  ok(line.includes("unattributed"));
});

test("an escalated turn's line says the material left the machine", () => {
  const line = renderProvenance(escalatedProvenance({ runtime: "fireworks", model: "kimi-k3", endpoint: null }));
  ok(line.includes("left your machine"));
});

test("every move kind renders with a label that names its standing", () => {
  const rendered = (m: Move): string => renderMove(m).join("\n");
  ok(rendered(propose("x")).startsWith("PROPOSAL (mine, not drawn from your material)"));
  ok(rendered(ask("x")).startsWith("QUESTION FOR YOU"));
  ok(rendered(cite(ID, "items[0]", "x")).startsWith(`FROM YOUR MATERIAL — ${ID} (items[0])`));
  ok(rendered(decline("policy-refused", "x")).startsWith("DECLINED — policy-refused"));
  ok(rendered(answer("x")).startsWith("ANSWER (general; makes no claim about you)"));
});

test("a rendered turn leads with provenance, so a reader who stops early has still been told", () => {
  const t = turn(deterministicProvenance(), answer("body"));
  const lines = renderTurn(t);
  ok(lines[0]?.startsWith("PRODUCED BY  "));
});

test("nothing this module renders is score-shaped", () => {
  // The list comes from @foliage/leaf by name. It is not re-declared here, so the day a word is
  // added there this test starts enforcing it without an edit.
  const t = turn(
    deterministicProvenance(),
    answer("a"),
    ask("b"),
    cite(ID, "items[0]", "c"),
    decline("outside-scope", "d"),
    propose("e", "f"),
  );
  const words = renderTurn(t)
    .concat([
      renderProvenance(localModelProvenance({ runtime: "ollama", model: "gemma4:12b", endpoint: "127.0.0.1:11434" })),
      renderProvenance(escalatedProvenance({ runtime: "fireworks", model: "kimi-k3", endpoint: null })),
      renderProvenance(unknownProvenance("provenance-not-recorded", "x")),
    ])
    .join(" ")
    .toLowerCase()
    .split(/[^a-z]+/);
  for (const w of words) ok(!SCORE_SHAPED.has(w), `rendered output contains the score-shaped word "${w}"`);
});

test("the module exports nothing that could order or compare turns", () => {
  // A comparator is the single edit that would turn an unordered set of moves into a ranking of
  // a person. There is no place for one to hide behind an innocuous name.
  const banned = /sort|compar|rank|score|rate|weigh|prior|best|top/i;
  for (const name of Object.keys(turnModule)) ok(!banned.test(name), `suspicious export: ${name}`);
});


// ---------------------------------------------------------------------------------------
// F-003 (.loop/FINDINGS.md) — the guard the fix was shipped without.
//
// The defect: a model's synthesis over a person's private material was returned as `AnswerMove`,
// whose heading reads "ANSWER (general; makes no claim about you)". Reproduced live against
// gemma4:12b, which returned an evaluative claim about the person's competence under that exact
// heading, carrying a citation it had invented. The label was a guarantee and the guarantee was
// false.
//
// These assert the LABEL, because the label is the whole defect. Nothing here can constrain what a
// model writes — that is the point of the move existing — so what is guarded is that model prose
// can never again be rendered under a heading that certifies it makes no claim.
// ---------------------------------------------------------------------------------------

test("F-003: a synthesis never renders under the answer heading that certifies no claim", () => {
  const s = renderMove(
    synthesis("gemma4:12b", "ollama at http://127.0.0.1:11434", "You are hesitant in exec meetings.", [
      contextItemId("career-notes"),
    ]),
  ).join("\n");

  ok(!s.includes("makes no claim about you"), `synthesis rendered the answer guarantee:\n${s}`);
  ok(s.includes("NOT CITED"), `synthesis must say it is not cited:\n${s}`);
  ok(s.includes("may contain claims about you"), `synthesis must say it may claim:\n${s}`);
  // The heading, not a footer: a reader who reads only headings must get the true impression.
  ok(s.split("\n")[0]?.includes("NOT CITED"), `the weakness belongs in the heading:\n${s}`);
});

test("F-003: a synthesis is attributed to the model, never to the agent or the person", () => {
  const m = synthesis("m", "w", "text", []);
  equal(m.attribution, "model");
  // `answer`/`propose` are the agent speaking; `cite` is the person's record speaking. A model's
  // paragraph is neither, and collapsing it into either is how the mislabel happened.
  equal(answer("x").attribution, "agent");
  equal(cite(contextItemId("i"), "items[0]", "s").attribution, "person");
});

test("F-003: what a model was SHOWN is not a claim that any sentence traces to it", () => {
  // `restsOn` must never be rendered with the vocabulary of `cite`. If a reader can mistake the
  // shown-set for a per-sentence citation, the move has recreated the defect in softer words.
  const s = renderMove(
    synthesis("m", "w", "t", [contextItemId("a"), contextItemId("b")]),
  ).join("\n");
  ok(s.includes("checkable only against"), s);
  ok(!s.includes("FROM YOUR MATERIAL"), `synthesis must not borrow the citation heading:\n${s}`);
});
