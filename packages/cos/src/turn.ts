/**
 * THE PARTNERSHIP CONTRACT, AS A TYPE — what a chief-of-staff turn is allowed to BE.
 *
 * A turn is not a string. It is a list of MOVES and a statement of who produced them. The
 * difference is the whole reason this file exists, and it is worth stating plainly before any
 * type appears: a string can say "based on your 2023 performance review you should ask for the
 * platform role" and there is no place in a string where the review has to be named, no place
 * where "should" has to be marked as the agent's opinion rather than the person's record, and
 * no place where "an AI wrote this" has to be recorded. Every one of those three failures is a
 * missing FIELD, not a missing sentence — so they are fixed with fields.
 *
 * Five moves, and each one exists because collapsing it into another would let a specific
 * dishonesty through:
 *
 *   propose   A suggestion. It is THE AGENT'S OWN and it is labelled `attribution: "agent"`.
 *             Merging it into `cite` is how "you should" starts reading like something the
 *             person's own material said.
 *   ask       A question back to the person. This is the move an executor model has no room
 *             for, and its absence is why assistants guess: with nowhere to put "I do not know
 *             which of these you meant", the only remaining output is a confident answer.
 *   cite      A statement ABOUT THE PERSON. It CANNOT BE CONSTRUCTED without the
 *             `ContextItemId` it rests on — see THE CITATION GATE below.
 *   decline   A refusal, carrying a NAMED cause. Never an empty answer, never a shrug, and
 *             never a zero: this repository's recurring bug class is four distinct failures
 *             collapsed into one valueless value.
 *   answer    General help that makes NO claim about the person. "Here is how a promotion
 *             packet is usually structured" is an `answer`; "here is what YOUR packet should
 *             say" is not, and the type is where that line gets drawn.
 *
 * ============================================================================
 * THE CITATION GATE — why `cite` is a factory and not an object literal
 * ============================================================================
 *
 * `CiteMove` carries a property keyed by a `unique symbol` that this module declares and does
 * not export. Outside this file the key cannot be named, so an object literal can never satisfy
 * the interface, so `cite(source, at, statement)` — whose FIRST parameter is the branded
 * `ContextItemId` — is the only way to obtain one. A reviewer who sits down to construct an
 * uncited claim about the person does not get a warning, a failing lint rule or a runtime
 * throw. They get a type error, from `pnpm check`, before anything runs.
 *
 * This is deliberately stronger than the alternatives that were considered and rejected:
 *   - a required `source: ContextItemId` field alone — an object literal still satisfies it,
 *     so the gate is "remember to fill this in", which is a convention;
 *   - a runtime assertion in a validator — skippable by not calling the validator, and it
 *     fails in production rather than in review;
 *   - a lint rule — lives in a config someone can turn off, in a different repository layer
 *     from the thing it protects.
 *
 * WHAT IT DOES NOT STOP, said rather than implied: `x as CiteMove` compiles, and so does
 * `JSON.parse`. No type system stops a cast. What the gate buys is that the uncited claim can
 * never be written by ACCIDENT, and that writing one deliberately leaves a cast in the diff
 * with nothing to blame it on.
 *
 * ============================================================================
 * PROVENANCE IS PART OF THE TURN, NOT METADATA BESIDE IT
 * ============================================================================
 *
 * `Turn.provenance` is a required field of the turn itself, not a sidecar a logger might carry
 * and a renderer might drop. Four sources, and the fourth is the one that matters:
 *
 *   deterministic  Assembled on this machine by rule. No model, local or remote.
 *   local-model    A model process on this machine produced it. Carries the model identity.
 *   escalated      A third-party inference provider produced it. Carries the model identity.
 *   unknown        THE PRODUCER COULD NOT ATTEST. Recorded with a named cause.
 *
 * A FALSELY-CONFIDENT `deterministic` IS THE FAILURE TO AVOID. It is worse than `unknown` by a
 * clear margin: `unknown` makes a reader check, `deterministic` makes them stop checking. So
 * the union has no default and no fallback value — a producer that does not know which arm it
 * is must say `unknown` and say why, because there is no other arm it can spell.
 *
 * MODEL IDENTITY EXISTS ON THE TWO MODEL ARMS AND NOWHERE ELSE. Not optional-and-usually-absent
 * on the others: absent from their types. A `deterministic` turn that could carry a model name
 * is a turn someone will eventually populate.
 *
 * THERE IS NO FIELD HERE FOR HIDDEN REASONING. No `thinking`, no `reasoning_content`, no
 * `scratchpad`. Fireworks and other providers return a reasoning channel beside the completion;
 * it is not a field of a `Turn`, so it cannot be carried in one, cannot be rendered by
 * `renderTurn`, and cannot be handed to whatever writes memory. That is structural rather than
 * documented, which is the point.
 *
 * ============================================================================
 * WHAT THIS FILE HAS NO CONCEPT OF
 * ============================================================================
 *
 * NO SCORE, NO ORDERING, NO COMPARATOR. Moves are not ranked, not weighted, and carry no
 * certainty. `Turn.moves` is in NARRATIVE order — the order a producer chose to say things in —
 * and there is no function anywhere that reorders it, because "most important first" is a rank
 * over statements about a person and this product does not compute one. `SCORE_SHAPED` is
 * imported by name from @foliage/leaf in the tests rather than re-declared here.
 *
 * NO EMPTY TURN. `Turn.moves` is a non-empty tuple type, `readonly [Move, ...Move[]]`, and
 * `turn()` takes its first move as a separate REQUIRED parameter. A code path that reaches a
 * decision and produces no answer cannot be spelled: it fails to typecheck. That is contract
 * item 1 of this slice made mechanical rather than reviewed.
 *
 * PURE AND TOTAL. No fs, no network, no clock, no subprocess, no throw. Every function here is
 * a constructor or a formatter over data it was handed.
 *
 * Complexity: every function is O(1) in its own work; `renderTurn` is O(n) in moves.
 */

import type { ContextItemId } from "./classify.ts";

// ---------------------------------------------------------------------------------------
// The citation gate
// ---------------------------------------------------------------------------------------

/**
 * The attestation key. Declared here, exported nowhere, and therefore unnameable outside this
 * module — which is precisely what makes `CiteMove` unconstructible by literal. It is a real
 * runtime `Symbol` rather than a phantom type so that the property genuinely exists on the
 * value; a `declare`d symbol would typecheck and then be absent at runtime, and a brand you can
 * see in a debugger is worth more than one you cannot.
 */
const CITED: unique symbol = Symbol("foliage.cos.turn.cited");

// ---------------------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------------------

/**
 * Whose statement this is. Only assertion-shaped moves carry it: `ask` is a question and
 * `decline` is a refusal, and giving either an author would invite reading them as claims.
 */
export type Attribution = "agent" | "person";

/** A suggestion. The agent's own, and labelled so on the value rather than in a doc comment. */
export interface ProposeMove {
  readonly move: "propose";
  readonly attribution: "agent";
  /** What to do next, concretely. */
  readonly text: string;
  /** Why the agent is suggesting it, or `null` when there is nothing beyond the suggestion. */
  readonly rationale: string | null;
}

/**
 * A question back to the person.
 *
 * The partner move. Its existence is what lets a producer stop instead of guessing, which is
 * why `deterministic.ts` reaches for it every time it would otherwise have to assert something
 * about material it has not read.
 */
export interface AskMove {
  readonly move: "ask";
  readonly question: string;
  /** Why the answer is needed, or `null`. Never a justification the question does not need. */
  readonly why: string | null;
}

/**
 * A statement about the person, resting on one named piece of their own material.
 *
 * Constructible only through `cite()`. See THE CITATION GATE in the header.
 */
export interface CiteMove {
  readonly move: "cite";
  readonly [CITED]: true;
  readonly attribution: "person";
  /** The item this statement rests on. Required by the constructor; there is no other way in. */
  readonly source: ContextItemId;
  /** Where that item sat in the assembled context — `items[3]` — so it can be found again. */
  readonly at: string;
  readonly statement: string;
}

/**
 * Why this turn will not do the thing. A NAMED cause, never a bare apology.
 *
 *   nothing-on-file          The person has declared nothing that bears on the request.
 *   material-unreadable      Their material exists and could not be read. NOT the same fact as
 *                            "you have nothing" — collapsing those two tells someone their
 *                            reflections were never written down.
 *   material-malformed       Something in the assembled context is not a context item at all.
 *   policy-refused           The routing policy refused the request outright. A policy refusal,
 *                            never a transport failure — see route.ts's header on why those two
 *                            must stay visibly distinct.
 *   would-require-guessing   Answering would mean inferring a fact about the person that they
 *                            never declared. This is the cause that keeps the product honest,
 *                            and the reason a chief of staff says "I don't know" out loud.
 *   outside-scope            The request is not something this agent does.
 */
export type DeclineCause =
  | "nothing-on-file"
  | "material-unreadable"
  | "material-malformed"
  | "policy-refused"
  | "would-require-guessing"
  | "outside-scope";

export interface DeclineMove {
  readonly move: "decline";
  readonly cause: DeclineCause;
  /** A sentence naming the fact, addressed to the person and not to whoever wrote the caller. */
  readonly detail: string;
}

/**
 * General help that makes NO claim about the person.
 *
 * The escape valve that keeps `cite` honest: without it, a producer with something useful to say
 * that is not about the person's record has only `cite` to say it in, and would reach for a
 * citation that does not support the sentence.
 */
export interface AnswerMove {
  readonly move: "answer";
  readonly attribution: "agent";
  readonly text: string;
}

/**
 * A model's freeform paragraph over the person's material — the ONE thing this type system
 * cannot check, given its own label.
 *
 * WHY THIS EXISTS, and it was found by a review rather than by design. A model's synthesis was
 * being returned as `AnswerMove`, which renders "ANSWER (general; makes no claim about you)".
 * That label is a guarantee, and for a paragraph written by a model over someone's private
 * record it is false. Reproduced live against `gemma4:12b` on 2026-08-19: given notes about
 * being passed over for promotion, the model returned *"What is holding you back is identified
 * by your manager as your communication in executive meetings being 'too hesitant'
 * ([career-notes])"* — a specific evaluative claim about the person, under the label that
 * certifies the opposite, with a bracketed citation the model INVENTED and that no `CiteMove`
 * backs.
 *
 * The honest fix is not to constrain the model — nothing here can — but to stop the label from
 * lying. A synthesis says what it is: written by a model, possibly making claims, none of them
 * structurally cited, and checkable only against the items listed beside it. `attribution` is
 * `"model"` — its own value, not `"agent"` and not `"person"`, because it is neither this code
 * speaking nor the person's record speaking.
 *
 * `restsOn` is what was in front of the model, not what any sentence traces to. That distinction
 * is the whole point: a `CiteMove` binds ONE statement to ONE item; this binds a paragraph to the
 * set it was shown, which is weaker, and says so.
 */
export interface SynthesisMove {
  readonly move: "synthesis";
  readonly attribution: "model";
  /** The runtime's own model string, so a reader can reproduce the run. */
  readonly model: string;
  /** Where it ran — a loopback URL, or a provider name. The person is owed both facts. */
  readonly where: string;
  readonly text: string;
  /** Everything the model was shown. NOT a claim that any sentence traces to any of them. */
  readonly restsOn: readonly ContextItemId[];
}

export type Move = ProposeMove | AskMove | CiteMove | DeclineMove | AnswerMove | SynthesisMove;

/** Every move kind, for exhaustive iteration. Frozen, and deliberately not an ordering. */
export const MOVE_KINDS: readonly Move["move"][] = Object.freeze([
  "propose",
  "ask",
  "cite",
  "decline",
  "answer",
  "synthesis",
] as const);

// ---------------------------------------------------------------------------------------
// Move constructors
// ---------------------------------------------------------------------------------------

export function propose(text: string, rationale: string | null = null): ProposeMove {
  return { move: "propose", attribution: "agent", text, rationale };
}

export function ask(question: string, why: string | null = null): AskMove {
  return { move: "ask", question, why };
}

/**
 * A statement about the person, and its citation, in one indivisible act.
 *
 * `source` is FIRST and REQUIRED. There is no overload without it, no default, and no
 * `cite(statement)` convenience — the convenience is exactly what would get used.
 */
export function cite(source: ContextItemId, at: string, statement: string): CiteMove {
  return { move: "cite", [CITED]: true, attribution: "person", source, at, statement };
}

export function decline(cause: DeclineCause, detail: string): DeclineMove {
  return { move: "decline", cause, detail };
}

export function answer(text: string): AnswerMove {
  return { move: "answer", attribution: "agent", text };
}

/**
 * A model's paragraph. `model` and `where` are REQUIRED and first, for the same reason `cite`
 * takes its source first: the facts a reader needs to judge it must be impossible to omit.
 */
export function synthesis(
  model: string,
  where: string,
  text: string,
  restsOn: readonly ContextItemId[],
): SynthesisMove {
  return { move: "synthesis", attribution: "model", model, where, text, restsOn };
}

// ---------------------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------------------

/**
 * Which model produced a turn, as the runtime that ran it names it.
 *
 * `model` is the runtime's own string — `gemma4:12b` — never a friendly alias this code
 * invented, because a renamed model is a model nobody can reproduce the run against.
 */
export interface ModelIdentity {
  /** The runtime, named: `ollama`, `fireworks`. */
  readonly runtime: string;
  /** The model as that runtime names it. */
  readonly model: string;
  /**
   * For a local runtime, the host and port actually connected to, so a reader can check it is
   * loopback. `null` for a remote provider: naming an endpoint this process never parsed would
   * imply a check that did not happen.
   */
  readonly endpoint: string | null;
}

/**
 * Why a producer could not attest to what made a turn. Three different facts, kept apart:
 *
 *   producer-did-not-attest   The turn arrived from something that reports no provenance.
 *   provenance-not-recorded   It was produced here and the recording step was not reached —
 *                             a crash, an early return, a path added without one.
 *   conflicting-producers     Two sources contributed and no single arm is true of the whole.
 */
export type UnattestedCause =
  | "producer-did-not-attest"
  | "provenance-not-recorded"
  | "conflicting-producers";

export type TurnProvenance =
  | { readonly source: "deterministic" }
  | { readonly source: "local-model"; readonly model: ModelIdentity }
  | { readonly source: "escalated"; readonly model: ModelIdentity }
  | {
      readonly source: "unknown";
      readonly cause: UnattestedCause;
      readonly detail: string;
    };

export const deterministicProvenance = (): Extract<TurnProvenance, { source: "deterministic" }> => ({
  source: "deterministic",
});

export const localModelProvenance = (
  model: ModelIdentity,
): Extract<TurnProvenance, { source: "local-model" }> => ({
  source: "local-model",
  model,
});

export const escalatedProvenance = (
  model: ModelIdentity,
): Extract<TurnProvenance, { source: "escalated" }> => ({
  source: "escalated",
  model,
});

export const unknownProvenance = (
  cause: UnattestedCause,
  detail: string,
): Extract<TurnProvenance, { source: "unknown" }> => ({
  source: "unknown",
  cause,
  detail,
});

// ---------------------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------------------

/**
 * At least one move, always.
 *
 * A tuple rather than an array, because `readonly Move[]` admits `[]` and `[]` is the shape of
 * "the CLI reported a routing decision and then said nothing". That state is unspellable here.
 */
export type Moves = readonly [Move, ...(readonly Move[])];

export interface Turn {
  readonly provenance: TurnProvenance;
  /** Narrative order — the order the producer chose to speak in. Never a ranking. */
  readonly moves: Moves;
}

/**
 * Build a turn. The first move is a separate required parameter, so `turn(provenance)` does not
 * compile and there is no empty turn to accidentally return.
 */
export function turn(provenance: TurnProvenance, first: Move, ...rest: readonly Move[]): Turn {
  return { provenance, moves: [first, ...rest] };
}

/**
 * Build a turn from a list computed at runtime, naming the move that stands in when the list
 * comes back empty.
 *
 * Total: there is no argument for which this returns nothing, and the caller is forced to have
 * decided what an empty result MEANS rather than discovering it at render time. A producer that
 * genuinely has nothing to say should pass a `decline` with its cause.
 */
export function turnOf(
  provenance: TurnProvenance,
  whenEmpty: Move,
  moves: readonly Move[],
): Turn {
  const [first, ...rest] = moves;
  return first === undefined ? turn(provenance, whenEmpty) : turn(provenance, first, ...rest);
}

// ---------------------------------------------------------------------------------------
// Rendering — the labels are part of the contract, not decoration
// ---------------------------------------------------------------------------------------

/**
 * One line naming what produced this turn.
 *
 * The `deterministic` wording says what it is AND what it is not, because "assembled on this
 * machine" alone reads to most people as "an AI ran locally". It did not, and the sentence that
 * lets someone believe it did is the same category of failure as a falsely-confident
 * provenance arm.
 */
export function renderProvenance(p: TurnProvenance): string {
  switch (p.source) {
    case "deterministic":
      return "deterministic — assembled on this machine by rule. No model was involved, here or anywhere else; nothing below is reasoning.";
    case "local-model":
      return `local-model — ${p.model.runtime} ${p.model.model}${p.model.endpoint === null ? "" : ` at ${p.model.endpoint}`}`;
    case "escalated":
      return `escalated — ${p.model.runtime} ${p.model.model}. This left your machine.`;
    case "unknown":
      return `unknown — ${p.cause}: ${p.detail} Treat everything below as unattributed: the producer could not say what made it.`;
  }
}

/** The lines for one move. Labels name the move's standing, so a reader never has to infer it. */
export function renderMove(m: Move): readonly string[] {
  switch (m.move) {
    case "propose":
      return m.rationale === null
        ? [`PROPOSAL (mine, not drawn from your material)`, `  ${m.text}`]
        : [`PROPOSAL (mine, not drawn from your material)`, `  ${m.text}`, `  why: ${m.rationale}`];
    case "ask":
      return m.why === null
        ? [`QUESTION FOR YOU`, `  ${m.question}`]
        : [`QUESTION FOR YOU`, `  ${m.question}`, `  why: ${m.why}`];
    case "cite":
      return [`FROM YOUR MATERIAL — ${m.source} (${m.at})`, `  ${m.statement}`];
    case "decline":
      return [`DECLINED — ${m.cause}`, `  ${m.detail}`];
    case "answer":
      return [`ANSWER (general; makes no claim about you)`, `  ${m.text}`];
    case "synthesis":
      /* The label states the weakness first, because a reader who reads only the heading must
         come away with the true impression rather than the flattering one. "may contain claims"
         is deliberately not softened to "may reference": the measured failure was an evaluative
         claim about a person's competence, and a heading that undersells it is the defect. */
      return [
        /* `where` is rendered alone because callers already compose it as
           "ollama llama3.2:3b at http://…" — printing `model` beside it produced
           "written by llama3.2:3b at ollama llama3.2:3b at http://…". `model` stays on the type
           for programmatic use; the heading is for a person to read. */
        `MODEL SYNTHESIS — written by ${m.where}. NOT CITED.`,
        `  It may contain claims about you. None of them is structurally traced to anything:` +
          ` this is the one thing in this transcript the type system cannot vouch for.` +
          (m.restsOn.length === 0
            ? ` It was shown none of your material.`
            : ` It was shown ${m.restsOn.length} item(s) — ${m.restsOn.join(", ")} — and any` +
              ` sentence below is checkable only against those.`),
        `  ${m.text}`,
      ];
  }
}

/**
 * The whole turn as lines, provenance first.
 *
 * Provenance leads rather than trails because a reader who stops after the first screen has
 * still been told what produced what they read. A footer is a disclosure people do not reach.
 */
export function renderTurn(t: Turn): readonly string[] {
  const lines: string[] = [`PRODUCED BY  ${renderProvenance(t.provenance)}`, ""];
  for (const [index, m] of t.moves.entries()) {
    if (index > 0) lines.push("");
    lines.push(...renderMove(m));
  }
  return lines;
}
