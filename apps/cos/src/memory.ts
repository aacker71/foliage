/**
 * WHAT A TURN REMEMBERS — spec §4 step 6, and the most dangerous file in the chief-of-staff.
 *
 * Tier 3 is stateless by construction: the provider keeps nothing, so every call carries its
 * context again. That is the privacy property, and it is also why the agent feels amnesiac
 * unless something on this side of the boundary holds the thread. This module is that
 * something. It is what lets the product stop making a person repeat themselves without
 * asking a provider to remember them.
 *
 * It is dangerous for exactly one reason: it is a WRITE PATH belonging to an always-on agent.
 * `docs/PRODUCT-ARCHITECTURE-SPEC.md` §11.4 names the failure in one sentence — *an always-on
 * agent with a write path into the portfolio is the product-ending bug wearing a convenience
 * feature*. Every rule below exists to keep this write path from becoming that one.
 *
 * THE FOUR WALLS, and each is structural rather than documented.
 *
 *   1. AGENT STATE, NEVER PORTFOLIO EVIDENCE. Nothing written here becomes a leaflet, carries
 *      a `ProofTier`, or reaches a leaf document. There is no field on `MemoryRecord` that
 *      could hold one — asserted at COMPILE TIME by `_memoryCarriesNoPortfolioField` below, so
 *      adding `tier` or `evidence` to the record breaks the build rather than shipping. The
 *      harvest→leaf seam is untouched: candidates still carry no tier and `promoteApproved`
 *      still writes `pending` unconditionally. The human review gate does not move.
 *
 *   2. A MEMORY'S KIND IS DERIVED, NEVER DECLARED. `MemoryDraft` has NO kind field. A caller
 *      cannot say "this memory is shareable"; the kind is COPIED from the material the memory
 *      was derived from. Material derived from `tier1-local` is `tier1-local`, and there is no
 *      argument a caller can pass to make it otherwise. This is the whole egress rule, and it
 *      would be defeated in one line by a writable kind — a turn that read a private
 *      reflection, wrote "the person is anxious about promotion" as a *shareable* memory, and
 *      shipped it to a provider on the next request, having laundered Tier 1 through a summary.
 *
 *   3. MODEL REASONING NEVER ENTERS MEMORY. Fireworks returns
 *      `choices[0].message.reasoning_content` — the model deliberating about a person's career
 *      — and reasoning-model APIs generally expose the same thing as `thinking`, `analysis`, or
 *      a `chain_of_thought` channel. It is not the answer, it is not a memory, and it is the
 *      single most invasive artifact the pipeline produces. Every one of those names is refused
 *      BY NAME (`REASONING_KEYS`) with its own cause, so the refusal reads as itself rather
 *      than arriving as a generic "unknown key" and getting fixed by adding the key.
 *      The honest limit, stated where the claim is made: this refuses the CARRIER, not prose.
 *      A caller that pastes deliberation into `body` gets it stored, because the alternative is
 *      a classifier guessing at the contents of someone's private material — inference wearing
 *      a scanner's clothes, and this lineage already refuses that (`packages/cos/classify.ts`).
 *
 *   4. SUPERSESSION, NEVER OVERWRITING. `docs/ENGINEERING-PLAN.md` §9.2: *a re-run that
 *      quietly un-rejects something a person rejected is worse than a stale claim.* So an id
 *      already in the store is REFUSED (`id-in-use`) rather than replaced, a new memory links
 *      to what it replaced, and a human decision on the replaced memory is carried FORWARD
 *      onto the replacement automatically. `MemoryDraft` has no decision field either: an
 *      agent write cannot express a human verdict at all, and the only writer of one is
 *      `recordHumanDecision`, which also supersedes rather than mutates.
 *
 * WHY NO ORDERING OVER KINDS, and what happens to mixed derivation. `DeclaredKind` is
 * deliberately unordered (`packages/cos/src/classify.ts`): an ordering invites a threshold, a
 * threshold invites a tunable, and a tunable is a score with a privacy budget attached. A
 * memory derived from BOTH `tier1-local` and `tier3-shareable` material would need a join over
 * that ordering to get a kind — which is the comparator this codebase refuses, rebuilt
 * privately where nobody reviews it. So mixed derivation is REFUSED (`mixed-derivation`), and
 * a turn that drew on two kinds writes TWO memories, one per kind, each carrying only its own
 * sources. That is strictly more honest than one blob: the Tier 1 half stays home and the
 * shareable half stays separately reusable, instead of both being decided by a hidden rank.
 *
 * WHAT THIS FILE DOES NOT DO, said rather than quietly omitted. It cannot stop an agent from
 * writing a NEW memory, under a new id superseding nothing, that says the same thing a person
 * already rejected. Detecting that means judging whether two paragraphs mean the same thing,
 * which is a model's guess about a human's decision — the exact substitution this product
 * refuses everywhere else. What is guaranteed is narrower and checkable: no lineage a person
 * has ruled on ever silently changes its verdict.
 *
 * NO CLOCK, NO NETWORK, NO SUBPROCESS. Every instant is the caller's; this file never invents
 * one. It imports `./localStore.ts` (which is itself network-free by test), `@foliage/cos` for
 * the declared-kind vocabulary, and `@foliage/leaf` for `SCORE_SHAPED` and `isIsoInstant` —
 * both imported BY NAME rather than re-declared, because the second copy of a refusal list is
 * the one that goes stale.
 *
 * TOTAL OVER `unknown`. `validateDraft` and `recordHumanDecision` take `unknown`, not a typed
 * object, and the reason is not defensiveness: the write-back in spec §4 step 6 is frequently a
 * MODEL'S JSON. This is the boundary where that JSON becomes something the store is allowed to
 * hold, so it is the boundary that refuses unknown keys, score-shaped keys, and reasoning
 * channels — the same posture `classify` takes at the other end of the turn.
 *
 * COMPLEXITY. `remember`: one O(log n) store read for the supersession target plus one write
 * (one HMAC + one AES-GCM each). `recall`: one store read. `recallAll`: O(n) rows, one
 * decryption each — the store offers no index over ciphertext, and an index over plaintext ids
 * is the thing blinding exists to prevent. `standingOf` and `activeMemories`: O(n) with one Set.
 * `budgetMemories`: O(n log n) to rank what `activeMemories` already computed by recency, O(n)
 * to filter — no store read of its own.
 */

import { SCORE_SHAPED, isIsoInstant } from "@foliage/leaf";
import type { ContextItemId, DeclaredKind } from "@foliage/cos";
import { contextItemId } from "@foliage/cos";

import type { Tier1FailureCause, Tier1Item, Tier1Store } from "./localStore.ts";

// ---------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------

/**
 * Opaque id for one memory, so it can never be passed where a `LeafletId` or a `ContextItemId`
 * is expected. Two `string` ids in the same function is how the rule in §11.4 gets broken by
 * autocomplete rather than by decision — the same reasoning that brands `ContextItemId`.
 */
export type MemoryId = string & { readonly __brand: "MemoryId" };

export const memoryId = (s: string): MemoryId => s as MemoryId;

/**
 * Namespaces inside the Tier 1 store, which is shared with declared context material.
 *
 * The id prefix keeps a listing able to tell a memory from a stored reflection without
 * decrypting-then-guessing, and the kind prefix means a memory's stored `kind` is never a bare
 * declared kind and never anything a `ProofTier` parser would recognise. A record whose two
 * namespaces disagree with its envelope is reported as malformed rather than trusted.
 */
export const MEMORY_ID_PREFIX = "cos-memory:";
export const MEMORY_KIND_PREFIX = "cos-memory/";

// ---------------------------------------------------------------------------------------
// The public shape
// ---------------------------------------------------------------------------------------

/**
 * One piece of material a memory was derived from: which item, and what that item was
 * DECLARED to be. Both halves are needed — the id so a person can be shown what a memory came
 * from, and the kind so the memory's own kind is a copy rather than a judgement.
 */
export interface MemoryDerivation {
  readonly itemId: ContextItemId;
  readonly kind: DeclaredKind;
}

/**
 * Who produced the material in a memory.
 *
 * Model identity exists ONLY on the two model arms — structurally, not by convention: there is
 * no `model` field to fill in on `deterministic`, so a deterministic turn cannot be recorded as
 * having consulted a model, and a model turn cannot be recorded without saying which.
 *
 * `unknown` is recorded whenever the producer cannot attest, and it carries a `detail` saying
 * why. A falsely-confident `deterministic` is worse than an honest `unknown`: the first is a
 * claim about where a sentence about a person's career came from, and the whole point of
 * carrying provenance in the record rather than beside it is that the claim travels with the
 * sentence.
 */
export type MemoryProvenance =
  | { readonly producer: "deterministic" }
  | { readonly producer: "local-model"; readonly model: string }
  | { readonly producer: "escalated"; readonly model: string }
  | { readonly producer: "unknown"; readonly detail: string };

/** The producer names, for enumeration. Unordered, like every other vocabulary here. */
export const MEMORY_PRODUCERS: readonly MemoryProvenance["producer"][] = Object.freeze([
  "deterministic",
  "local-model",
  "escalated",
  "unknown",
]);

/**
 * What an AGENT may ask to write.
 *
 * Note what is absent, because the absences are the design: no `kind` (it is derived), no
 * `decision` (only a human writes one), no `tier`, no evidence reference, no score-shaped
 * anything. An agent constructing a `MemoryDraft` has no way to express a claim that this
 * material is shareable, approved, or proof.
 */
export interface MemoryDraft {
  readonly id: MemoryId;
  /** The remembered text. Free prose; this file stores it and does not rewrite it. */
  readonly body: string;
  /** The caller's instant, ISO-8601 with an explicit offset. This file has no clock. */
  readonly recordedAt: string;
  readonly provenance: MemoryProvenance;
  /** Non-empty, and all of one declared kind. A memory with no derivation is refused. */
  readonly derivedFrom: readonly MemoryDerivation[];
  /** The memory this one replaces, if any. Never a mutation of it. */
  readonly supersedes?: MemoryId;
}

/** A human's verdict on one memory. Both verdicts carry a mandatory reason. */
export type HumanVerdict = "accepted" | "rejected";

/**
 * A decision a person made, travelling with the memory it was made about.
 *
 * `decidedOn` names the memory the human ACTUALLY looked at, and it is preserved unchanged
 * when the decision is carried forward onto a successor. That distinction is the audit trail:
 * without it, a decision inherited through four re-runs would look like a decision made about
 * text the person never saw.
 */
export interface HumanDecision {
  readonly verdict: HumanVerdict;
  readonly reason: string;
  readonly decidedAt: string;
  readonly decidedOn: MemoryId;
}

/**
 * A memory as it exists in the store.
 *
 * `kind` is present here and absent from the draft, because it is derived. `decision` is
 * present here and absent from the draft, because only a human writes one.
 */
export interface MemoryRecord {
  readonly id: MemoryId;
  /** Copied from the derivation. Never chosen, never widened, never laundered. */
  readonly kind: DeclaredKind;
  readonly body: string;
  readonly recordedAt: string;
  readonly provenance: MemoryProvenance;
  readonly derivedFrom: readonly MemoryDerivation[];
  readonly supersedes?: MemoryId;
  readonly decision?: HumanDecision;
}

/**
 * COMPILE-TIME WALL. If anyone ever adds a portfolio-evidence field to `MemoryRecord`, this
 * stops being assignable and the build fails. A comment saying "do not add a tier here" is a
 * request; this is a gate.
 */
type PortfolioEvidenceKey =
  | "tier"
  | "proofTier"
  | "prooftier"
  | "evidence"
  | "evidenceRef"
  | "leaf"
  | "leaflet"
  | "leafletId"
  | "claim"
  | "verified"
  | "approved"
  | "published";
type CarriesNoPortfolioField<T> = Extract<keyof T, PortfolioEvidenceKey> extends never ? true : never;
const _memoryCarriesNoPortfolioField: CarriesNoPortfolioField<MemoryRecord> = true;
void _memoryCarriesNoPortfolioField;

/**
 * Every named way a memory write or read can fail. None collapses into another, and none is a
 * zero — "you handed me a model's raw response" and "the memory you are replacing is not in
 * this store" ask completely different things of the caller.
 */
export type MemoryFailureCause =
  /** The input is not an object. */
  | "not-a-record"
  /** A key that is not part of this shape. Refused, never ignored — an ignored key is how a typo becomes an unexplained absence. */
  | "unknown-key"
  /** A key from `SCORE_SHAPED` (`confidence` included), refused by name so the refusal is legible. */
  | "score-shaped-key"
  /** A model-reasoning channel: `reasoning_content`, `thinking`, `analysis`, and friends. */
  | "reasoning-content"
  /** `id` is missing or not a non-empty string. */
  | "missing-id"
  /** `body` is absent or not a string. An empty body is allowed; an absent one is not. */
  | "body-not-a-string"
  /** An instant that is not ISO-8601 with an explicit offset. */
  | "invalid-instant"
  /** `provenance` is missing, malformed, or names a producer this build does not know. */
  | "invalid-provenance"
  /** `derivedFrom` is absent, not an array, or an entry is malformed. */
  | "invalid-derivation"
  /** `derivedFrom` is empty. A memory about nothing has no kind to copy. */
  | "empty-derivation"
  /** `derivedFrom` spans more than one declared kind. See the header: no ordering, so no join. */
  | "mixed-derivation"
  /** The id is already in the store. Refused rather than replaced — supersession, never overwriting. */
  | "id-in-use"
  /** `supersedes` names a memory that is not in this store. */
  | "supersedes-absent"
  /** `supersedes` names itself. */
  | "supersedes-self"
  /** `supersedes` names a memory of a different declared kind — laundering by replacement. */
  | "supersedes-different-kind"
  /** A human decision was asked for on a memory that is not in this store. */
  | "decides-absent"
  /** A decision arrived without a reason. Every verdict carries one; that is the label corpus. */
  | "decision-reason-missing"
  /** A stored record decrypted and is not a memory envelope. Reported, never coerced into one. */
  | "memory-malformed"
  /** The Tier 1 store refused or could not answer. Its OWN cause travels alongside. */
  | "store-refused";

/**
 * A store failure, reported with BOTH causes.
 *
 * `cause` is always `store-refused` — this module's account of what happened — and `storeCause`
 * is the store's. Collapsing them is the error-masking bug class this repo keeps paying for:
 * "the memory could not be written" and "the secret is wrong" demand different things of the
 * person holding the machine, and only the second one is fixable by them.
 */
export interface MemoryStoreFailure {
  readonly cause: "store-refused";
  readonly storeCause: Tier1FailureCause;
  readonly detail: string;
}

export type MemoryWriteResult =
  | { readonly state: "remembered"; readonly memory: MemoryRecord }
  | { readonly state: "refused"; readonly cause: MemoryFailureCause; readonly at: string; readonly detail: string }
  | ({ readonly state: "refused"; readonly at: string } & MemoryStoreFailure);

export type MemoryReadResult =
  | { readonly state: "absent"; readonly id: MemoryId }
  | { readonly state: "present"; readonly memory: MemoryRecord }
  | {
      readonly state: "unreadable";
      readonly id: MemoryId;
      readonly cause: MemoryFailureCause;
      readonly detail: string;
    };

/**
 * One stored record a listing could not turn back into a memory.
 *
 * Named by the id the store reported it under, which for an undecryptable row is a blind hex
 * id that means nothing to a human. That is the honest consequence of blinding, and it beats
 * the alternative: a listing that quietly returns 41 memories out of 42.
 */
export interface MemoryRecordFailure {
  readonly storeId: string;
  readonly cause: MemoryFailureCause;
  readonly detail: string;
}

/**
 * The result of listing memories.
 *
 * `empty` is its own state, mirroring `Tier1ListResult`, so the honest empty surface is
 * something a caller RENDERS rather than infers from `memories.length === 0` — and so "you
 * have told me nothing yet" can never be produced by a store where everything failed to
 * decrypt. In that case the state is `present`, `memories` is empty, and `failed` is not.
 */
export type MemoryListResult =
  | { readonly state: "empty" }
  | {
      readonly state: "present";
      readonly memories: readonly MemoryRecord[];
      readonly failed: readonly MemoryRecordFailure[];
    }
  | { readonly state: "unreadable"; readonly cause: MemoryFailureCause; readonly detail: string };

/**
 * Where a memory stands, on TWO orthogonal axes that are never collapsed into one.
 *
 * Succession is about freshness; review is about a human's verdict. A single "status" field
 * would force a choice between reporting "superseded" and reporting "rejected" for a memory
 * that is both, and whichever one lost would be the one that mattered.
 *
 * `superseded.by` is a LIST because two re-runs may both claim to replace the same memory.
 * Reporting the fork is honest; picking a winner would be a guess about which re-run the
 * person meant, made by the code least equipped to know.
 */
export interface MemoryStanding {
  readonly succession:
    | { readonly state: "current" }
    | { readonly state: "superseded"; readonly by: readonly MemoryId[] };
  readonly review:
    | { readonly state: "unreviewed" }
    | {
        readonly state: "accepted" | "rejected";
        readonly reason: string;
        readonly decidedAt: string;
        readonly decidedOn: MemoryId;
      };
}

/**
 * Whether one memory may cross the machine boundary.
 *
 * A membership test, not a ranking: `may-leave` is `kind === "tier3-shareable"` and nothing
 * else. There is no comparator here and no threshold to tune. Everything else is device-only
 * WITH a named reason, because "withheld" without a reason is the same shrug as a zero.
 */
export type MemoryEgress =
  | { readonly state: "may-leave"; readonly id: MemoryId; readonly kind: "tier3-shareable" }
  | {
      readonly state: "device-only";
      readonly id: MemoryId;
      readonly kind: DeclaredKind;
      readonly reason: string;
    };

/**
 * What a turn may inject, after the budget in `budgetMemories` has run.
 *
 * `withheldByBudget` is a COUNT rather than a list of ids on purpose: unlike `MemoryEgress`,
 * which withholds an item from LEAVING THE MACHINE and owes a per-item reason a person could
 * check, a budget withholds an item from ONE PROMPT and the memory itself is untouched and still
 * readable through `recallAll` or `list` — so the honest account here is "how many", not "which
 * ones, forever", and F-007 (.loop/FINDINGS.md) is closed by the count being SAID at all rather
 * than by naming every excluded id.
 */
export interface MemoryBudgetResult {
  readonly included: readonly MemoryRecord[];
  readonly withheldByBudget: number;
}

// ---------------------------------------------------------------------------------------
// Refusal vocabularies — imported or declared once, never copied
// ---------------------------------------------------------------------------------------

/**
 * Model-reasoning channels, refused by name.
 *
 * Fireworks puts it in `reasoning_content`; other providers use `reasoning`, `thinking`, a
 * `thought` array, or an `analysis` channel. All of them are the model deliberating about a
 * person's career, none of them is the answer, and every one of them is prose a person never
 * wrote about themselves. A dedicated cause exists so that the message says WHY rather than
 * "unknown key" — the difference between a rule and a schema oversight someone will fix by
 * widening the schema.
 */
export const REASONING_KEYS: ReadonlySet<string> = new Set([
  "reasoning",
  "reasoning_content",
  "reasoningcontent",
  "reasoning_details",
  "thinking",
  "thought",
  "thoughts",
  "chain_of_thought",
  "chainofthought",
  "cot",
  "deliberation",
  "scratchpad",
  "internal_monologue",
  "analysis",
]);

const DRAFT_KEYS: ReadonlySet<string> = new Set([
  "id",
  "body",
  "recordedAt",
  "provenance",
  "derivedFrom",
  "supersedes",
]);

const DERIVATION_KEYS: ReadonlySet<string> = new Set(["itemId", "kind"]);
const PROVENANCE_KEYS: ReadonlySet<string> = new Set(["producer", "model", "detail"]);
const DECISION_KEYS: ReadonlySet<string> = new Set(["id", "decides", "verdict", "reason", "decidedAt"]);

const ENVELOPE_FORMAT = "foliage-cos-memory";
const ENVELOPE_VERSION = "1";

// ---------------------------------------------------------------------------------------
// Small total helpers
// ---------------------------------------------------------------------------------------

/** `undefined` and `null` describe differently, because absent and present-but-empty differ. */
function describe(v: unknown): string {
  if (v === undefined) return "nothing (the field is absent)";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "string") return v.trim().length === 0 ? "an empty string" : `"${v}"`;
  if (typeof v === "object") return "an object";
  return `a ${typeof v}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isDeclaredKind(v: unknown): v is DeclaredKind {
  return v === "tier1-local" || v === "tier2-confidential" || v === "tier3-shareable";
}

/** A refusal, in the shape every validator here returns. */
export interface MemoryRefusal {
  readonly ok: false;
  readonly cause: MemoryFailureCause;
  readonly at: string;
  readonly detail: string;
}

function refuse(cause: MemoryFailureCause, at: string, detail: string): MemoryRefusal {
  return { ok: false, cause, at, detail };
}

/**
 * Refuse the two vocabularies that must never reach a stored memory, on ONE record's keys.
 *
 * Order matters and is deliberate, exactly as it is in `classify`: the reasoning and
 * score-shaped checks run BEFORE the allow-list, so an input carrying `confidence` is refused
 * as score-shaped rather than as an unknown key. A refusal that reads as itself gets obeyed;
 * a generic one gets worked around.
 */
function screenKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, at: string): MemoryRefusal | undefined {
  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase();
    if (REASONING_KEYS.has(lower)) {
      return refuse(
        "reasoning-content",
        `${at}.${key}`,
        `"${key}" is a model-reasoning channel. A model's deliberation about a person's career ` +
          `is not the answer and is not a memory: it never enters Tier 1 or Tier 2, is never ` +
          `displayed as the answer, and is refused here by name rather than passed through. ` +
          `Store the answer, not the thinking that produced it.`,
      );
    }
    if (SCORE_SHAPED.has(lower)) {
      return refuse(
        "score-shaped-key",
        `${at}.${key}`,
        `"${key}" is a score-shaped key. This product never computes, stores or transmits a ` +
          `rating of a person, so a key that would smuggle one into remembered state is refused ` +
          `by name. The list is @foliage/leaf's SCORE_SHAPED, imported rather than copied, so ` +
          `every gate in the tree refuses the same names.`,
      );
    }
    if (!allowed.has(key)) {
      return refuse(
        "unknown-key",
        `${at}.${key}`,
        `"${key}" is not a field here. Unknown keys are refused rather than ignored: an ignored ` +
          `key is how a model's raw response gets stored whole, reasoning channels included.`,
      );
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------
// Validation — total over `unknown`, because the write-back is often a model's JSON
// ---------------------------------------------------------------------------------------

export type DraftValidation = { readonly ok: true; readonly draft: MemoryDraft } | MemoryRefusal;

function validateProvenance(input: unknown, at: string): { ok: true; value: MemoryProvenance } | MemoryRefusal {
  if (!isRecord(input)) {
    return refuse(
      "invalid-provenance",
      at,
      `expected an object, got ${describe(input)}. Provenance is part of the turn, not metadata ` +
        `beside it — a memory whose producer is unrecorded is a sentence about a person with no ` +
        `account of where it came from.`,
    );
  }
  const screened = screenKeys(input, PROVENANCE_KEYS, at);
  if (screened) return screened;

  const producer: unknown = input["producer"];
  const model: unknown = input["model"];
  const detail: unknown = input["detail"];

  if (producer === "deterministic") {
    if (model !== undefined) {
      return refuse(
        "invalid-provenance",
        `${at}.model`,
        `a deterministic turn consulted no model, so it cannot name one. Model identity exists ` +
          `only on the local-model and escalated arms.`,
      );
    }
    if (detail !== undefined) {
      return refuse("invalid-provenance", `${at}.detail`, `detail belongs only to the unknown producer.`);
    }
    return { ok: true, value: { producer: "deterministic" } };
  }

  if (producer === "local-model" || producer === "escalated") {
    if (!nonEmptyString(model)) {
      return refuse(
        "invalid-provenance",
        `${at}.model`,
        `expected the model's identity as a non-empty string, got ${describe(model)}. A model arm ` +
          `without a model name records that a model was involved while refusing to say which — ` +
          `which is exactly the claim provenance exists to make checkable.`,
      );
    }
    if (detail !== undefined) {
      return refuse("invalid-provenance", `${at}.detail`, `detail belongs only to the unknown producer.`);
    }
    return { ok: true, value: { producer, model } };
  }

  if (producer === "unknown") {
    if (!nonEmptyString(detail)) {
      return refuse(
        "invalid-provenance",
        `${at}.detail`,
        `expected a reason the producer could not attest, got ${describe(detail)}. An unknown ` +
          `producer is honest; an unknown producer with no reason is a shrug.`,
      );
    }
    if (model !== undefined) {
      return refuse(
        "invalid-provenance",
        `${at}.model`,
        `a producer that could not attest cannot name a model either.`,
      );
    }
    return { ok: true, value: { producer: "unknown", detail } };
  }

  return refuse(
    "invalid-provenance",
    `${at}.producer`,
    `expected one of ${MEMORY_PRODUCERS.join(", ")}, got ${describe(producer)}. An unrecognised ` +
      `producer is not treated as the nearest known one — and it is not silently downgraded to ` +
      `"unknown" either, because that would turn a version skew into a fact about this turn.`,
  );
}

function validateDerivation(
  input: unknown,
  at: string,
): { ok: true; value: readonly MemoryDerivation[]; kind: DeclaredKind } | MemoryRefusal {
  if (!Array.isArray(input)) {
    return refuse(
      "invalid-derivation",
      at,
      `expected an array of the context items this memory was derived from, got ${describe(input)}.`,
    );
  }
  if (input.length === 0) {
    return refuse(
      "empty-derivation",
      at,
      `a memory derived from nothing has no kind to copy, and a kind this file chose for itself ` +
        `would be exactly the declaration-not-inference rule broken. If a turn genuinely remembers ` +
        `something about the conversation rather than about stored material, the request itself is ` +
        `a context item with a declared kind — cite that.`,
    );
  }

  const out: MemoryDerivation[] = [];
  const seen = new Set<string>();
  let kind: DeclaredKind | undefined;

  for (const [index, raw] of input.entries()) {
    const where = `${at}[${index}]`;
    if (!isRecord(raw)) {
      return refuse("invalid-derivation", where, `expected an object, got ${describe(raw)}.`);
    }
    const screened = screenKeys(raw, DERIVATION_KEYS, where);
    if (screened) return screened;

    const rawItemId: unknown = raw["itemId"];
    if (!nonEmptyString(rawItemId)) {
      return refuse(
        "invalid-derivation",
        `${where}.itemId`,
        `expected the id of the context item this came from, got ${describe(rawItemId)}. A person ` +
          `has to be able to be shown WHICH material a memory about them was built from.`,
      );
    }
    const rawKind: unknown = raw["kind"];
    if (!isDeclaredKind(rawKind)) {
      return refuse(
        "invalid-derivation",
        `${where}.kind`,
        `expected the kind the source item was DECLARED to be, got ${describe(rawKind)}. It is ` +
          `copied from the declaration, never inferred from the item's shape or content.`,
      );
    }
    if (seen.has(rawItemId)) {
      return refuse(
        "invalid-derivation",
        `${where}.itemId`,
        `"${rawItemId}" already appears in this derivation. Duplicates are refused rather than ` +
          `de-duplicated so that no source is silently listed or dropped under another's name.`,
      );
    }
    seen.add(rawItemId);

    if (kind === undefined) kind = rawKind;
    else if (kind !== rawKind) {
      return refuse(
        "mixed-derivation",
        `${where}.kind`,
        `this memory would be derived from both "${kind}" and "${rawKind}" material. There is no ` +
          `ordering over DeclaredKind and this file will not build one privately — an ordering ` +
          `invites a threshold and a threshold is a score with a privacy budget. Write one memory ` +
          `per kind instead: the tier1-local half then stays home and the shareable half stays ` +
          `separately reusable, rather than both being decided by a hidden rank.`,
      );
    }
    out.push({ itemId: contextItemId(rawItemId), kind: rawKind });
  }

  // `kind` is assigned on the first iteration and the array is non-empty, but the compiler
  // cannot see that; refusing rather than asserting keeps the function total.
  if (kind === undefined) {
    return refuse("empty-derivation", at, `no derivation survived validation.`);
  }
  return { ok: true, value: out, kind };
}

/**
 * Validate an agent's write-back. PURE: no store, no clock, no I/O — so the gate can be
 * exercised without a database, which is the difference between a gate that is tested and a
 * gate that is described.
 */
export function validateDraft(input: unknown, at = "draft"): DraftValidation {
  if (!isRecord(input)) {
    return refuse("not-a-record", at, `expected an object, got ${describe(input)}.`);
  }
  const screened = screenKeys(input, DRAFT_KEYS, at);
  if (screened) return screened;

  const rawId: unknown = input["id"];
  if (!nonEmptyString(rawId)) {
    return refuse(
      "missing-id",
      `${at}.id`,
      `expected a non-empty string, got ${describe(rawId)}. Every memory needs an id because ` +
        `supersession is a link between ids, and a lineage nobody can name is a lineage nobody ` +
        `can show a person.`,
    );
  }
  if (rawId.startsWith(MEMORY_ID_PREFIX)) {
    return refuse(
      "missing-id",
      `${at}.id`,
      `"${rawId}" already carries the store namespace "${MEMORY_ID_PREFIX}". Hand the memory's own ` +
        `id; this file applies the namespace, and a doubled prefix is a memory nobody can recall.`,
    );
  }

  const rawBody: unknown = input["body"];
  if (typeof rawBody !== "string") {
    return refuse(
      "body-not-a-string",
      `${at}.body`,
      `expected a string, got ${describe(rawBody)}. An empty body is allowed — a turn may ` +
        `legitimately remember nothing in words — but an absent one is a schema mistake.`,
    );
  }

  const rawRecordedAt: unknown = input["recordedAt"];
  if (!nonEmptyString(rawRecordedAt) || !isIsoInstant(rawRecordedAt)) {
    return refuse(
      "invalid-instant",
      `${at}.recordedAt`,
      `expected an ISO-8601 instant with an explicit offset, got ${describe(rawRecordedAt)}. This ` +
        `file has no clock and will not invent one: a timestamp the store made up is a claim about ` +
        `when a person said something.`,
    );
  }

  const provenance = validateProvenance(input["provenance"], `${at}.provenance`);
  if (!provenance.ok) return provenance;

  const derivation = validateDerivation(input["derivedFrom"], `${at}.derivedFrom`);
  if (!derivation.ok) return derivation;

  const rawSupersedes: unknown = input["supersedes"];
  let supersedes: MemoryId | undefined;
  if (rawSupersedes !== undefined) {
    if (!nonEmptyString(rawSupersedes)) {
      return refuse(
        "supersedes-absent",
        `${at}.supersedes`,
        `expected the id of the memory this one replaces, got ${describe(rawSupersedes)}.`,
      );
    }
    if (rawSupersedes === rawId) {
      return refuse(
        "supersedes-self",
        `${at}.supersedes`,
        `a memory cannot replace itself. Every id must be new, so a supersession link always ` +
          `points backwards at an id already written — which is also why a cycle is unrepresentable.`,
      );
    }
    supersedes = memoryId(rawSupersedes);
  }

  const draft: MemoryDraft = {
    id: memoryId(rawId),
    body: rawBody,
    recordedAt: rawRecordedAt,
    provenance: provenance.value,
    derivedFrom: derivation.value,
    ...(supersedes !== undefined ? { supersedes } : {}),
  };
  return { ok: true, draft };
}

// ---------------------------------------------------------------------------------------
// The envelope on disk
// ---------------------------------------------------------------------------------------

function encodeMemory(memory: MemoryRecord): Tier1Item {
  return {
    id: `${MEMORY_ID_PREFIX}${memory.id}`,
    kind: `${MEMORY_KIND_PREFIX}${memory.kind}`,
    recordedAt: memory.recordedAt,
    body: JSON.stringify({
      format: ENVELOPE_FORMAT,
      version: ENVELOPE_VERSION,
      id: memory.id,
      kind: memory.kind,
      body: memory.body,
      recordedAt: memory.recordedAt,
      provenance: memory.provenance,
      derivedFrom: memory.derivedFrom,
      ...(memory.supersedes !== undefined ? { supersedes: memory.supersedes } : {}),
      ...(memory.decision !== undefined ? { decision: memory.decision } : {}),
    }),
  };
}

function decodeDecision(input: unknown): { ok: true; value: HumanDecision } | { ok: false; detail: string } {
  if (!isRecord(input)) return { ok: false, detail: `decision is ${describe(input)}` };
  const verdict: unknown = input["verdict"];
  if (verdict !== "accepted" && verdict !== "rejected") {
    return { ok: false, detail: `decision.verdict is ${describe(verdict)}` };
  }
  const reason: unknown = input["reason"];
  if (!nonEmptyString(reason)) return { ok: false, detail: `decision.reason is ${describe(reason)}` };
  const decidedAt: unknown = input["decidedAt"];
  if (!nonEmptyString(decidedAt) || !isIsoInstant(decidedAt)) {
    return { ok: false, detail: `decision.decidedAt is ${describe(decidedAt)}` };
  }
  const decidedOn: unknown = input["decidedOn"];
  if (!nonEmptyString(decidedOn)) return { ok: false, detail: `decision.decidedOn is ${describe(decidedOn)}` };
  return { ok: true, value: { verdict, reason, decidedAt, decidedOn: memoryId(decidedOn) } };
}

/**
 * Turn a stored item back into a memory, or say precisely why it is not one.
 *
 * The two namespaces are cross-checked against the envelope. A record whose stored `kind` says
 * `cos-memory/tier3-shareable` while its envelope says `tier1-local` is REFUSED as malformed
 * rather than resolved in either direction: one of the two is wrong, this file cannot know
 * which, and guessing is how a Tier 1 memory would come back shareable.
 */
function decodeMemory(item: Tier1Item): { ok: true; memory: MemoryRecord } | { ok: false; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.body);
  } catch {
    return { ok: false, detail: "the record decrypted and its body is not valid JSON" };
  }
  if (!isRecord(parsed)) return { ok: false, detail: "the record decrypted and its body is not a JSON object" };

  if (parsed["format"] !== ENVELOPE_FORMAT) {
    return { ok: false, detail: `format is ${describe(parsed["format"])}, expected "${ENVELOPE_FORMAT}"` };
  }
  if (parsed["version"] !== ENVELOPE_VERSION) {
    return {
      ok: false,
      detail:
        `version is ${describe(parsed["version"])}, and this build reads "${ENVELOPE_VERSION}". ` +
        `Refused rather than guessed at — a memory read under the wrong schema is a fabricated memory.`,
    };
  }

  const id: unknown = parsed["id"];
  if (!nonEmptyString(id)) return { ok: false, detail: `id is ${describe(id)}` };
  if (item.id !== `${MEMORY_ID_PREFIX}${id}`) {
    return { ok: false, detail: `the stored id "${item.id}" does not match the envelope id "${id}"` };
  }

  const kind: unknown = parsed["kind"];
  if (!isDeclaredKind(kind)) return { ok: false, detail: `kind is ${describe(kind)}` };
  if (item.kind !== `${MEMORY_KIND_PREFIX}${kind}`) {
    return {
      ok: false,
      detail:
        `the stored kind "${item.kind}" disagrees with the envelope kind "${kind}". One of them is ` +
        `wrong and this file cannot know which, so it refuses rather than resolving — resolving in ` +
        `the wrong direction is how a device-only memory comes back shareable.`,
    };
  }

  const body: unknown = parsed["body"];
  if (typeof body !== "string") return { ok: false, detail: `body is ${describe(body)}` };

  const recordedAt: unknown = parsed["recordedAt"];
  if (!nonEmptyString(recordedAt)) return { ok: false, detail: `recordedAt is ${describe(recordedAt)}` };

  const provenance = validateProvenance(parsed["provenance"], "provenance");
  if (!provenance.ok) return { ok: false, detail: provenance.detail };

  const derivation = validateDerivation(parsed["derivedFrom"], "derivedFrom");
  if (!derivation.ok) return { ok: false, detail: derivation.detail };
  if (derivation.kind !== kind) {
    return {
      ok: false,
      detail:
        `the envelope kind "${kind}" is not the kind of its own derivation ("${derivation.kind}"). ` +
        `A memory's kind is a copy of what it came from; a record where they differ has been edited.`,
    };
  }

  const rawSupersedes: unknown = parsed["supersedes"];
  let supersedes: MemoryId | undefined;
  if (rawSupersedes !== undefined) {
    if (!nonEmptyString(rawSupersedes)) return { ok: false, detail: `supersedes is ${describe(rawSupersedes)}` };
    supersedes = memoryId(rawSupersedes);
  }

  const rawDecision: unknown = parsed["decision"];
  let decision: HumanDecision | undefined;
  if (rawDecision !== undefined) {
    const decoded = decodeDecision(rawDecision);
    if (!decoded.ok) return { ok: false, detail: decoded.detail };
    decision = decoded.value;
  }

  return {
    ok: true,
    memory: {
      id: memoryId(id),
      kind,
      body,
      recordedAt,
      provenance: provenance.value,
      derivedFrom: derivation.value,
      ...(supersedes !== undefined ? { supersedes } : {}),
      ...(decision !== undefined ? { decision } : {}),
    },
  };
}

// ---------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------

/** Read one memory. Four store states map onto three memory states, none of them a zero. */
export async function recall(store: Tier1Store, id: MemoryId): Promise<MemoryReadResult> {
  const result = await store.read(`${MEMORY_ID_PREFIX}${id}`);
  switch (result.state) {
    case "absent":
      return { state: "absent", id };
    case "present": {
      const decoded = decodeMemory(result.item);
      if (!decoded.ok) {
        return { state: "unreadable", id, cause: "memory-malformed", detail: decoded.detail };
      }
      return { state: "present", memory: decoded.memory };
    }
    case "undecryptable":
      return {
        state: "unreadable",
        id,
        cause: "store-refused",
        detail:
          `the Tier 1 store could not open this record (${result.cause}): ${result.detail}. The ` +
          `material is still there — this is not "absent", and reporting it as absent would tell ` +
          `someone their memory is gone when their secret is merely wrong.`,
      };
    case "unreadable":
      return {
        state: "unreadable",
        id,
        cause: "store-refused",
        detail: `the Tier 1 store could not answer (${result.cause}): ${result.detail}`,
      };
  }
}

/**
 * Read every memory in this store.
 *
 * Non-memory items in the same store are skipped by namespace, not by decoding-and-hoping —
 * a person's declared Tier 1 reflections live in the same file and are none of this module's
 * business. A namespaced record that fails to decode is REPORTED in `failed` rather than
 * dropped, for the same reason the store reports its own undecryptable rows: a listing that
 * quietly returns fewer things than exist is the shape of a silent data loss.
 */
export async function recallAll(store: Tier1Store): Promise<MemoryListResult> {
  const listed = await store.list();
  if (listed.state === "unreadable") {
    return {
      state: "unreadable",
      cause: "store-refused",
      detail: `the Tier 1 store could not be listed (${listed.cause}): ${listed.detail}`,
    };
  }
  if (listed.state === "empty") return { state: "empty" };

  const memories: MemoryRecord[] = [];
  const failed: MemoryRecordFailure[] = [];

  for (const item of listed.items) {
    if (!item.id.startsWith(MEMORY_ID_PREFIX)) continue;
    const decoded = decodeMemory(item);
    if (decoded.ok) memories.push(decoded.memory);
    else failed.push({ storeId: item.id, cause: "memory-malformed", detail: decoded.detail });
  }

  // A row the STORE could not decrypt might be a memory or might be someone's reflection —
  // its id is inside the ciphertext. Reported under its blind id rather than assumed away.
  for (const failure of listed.failed) {
    failed.push({
      storeId: failure.blindIdHex,
      cause: "store-refused",
      detail:
        `the Tier 1 store could not open this record (${failure.cause}): ${failure.detail}. ` +
        `Whether it is a memory is unknowable without opening it — the id lives inside the ` +
        `ciphertext — so it is listed here rather than silently excluded from both counts.`,
    });
  }

  if (memories.length === 0 && failed.length === 0) return { state: "empty" };
  return { state: "present", memories, failed };
}

// ---------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------

function storeRefusal(at: string, storeCause: Tier1FailureCause, detail: string): MemoryWriteResult {
  return { state: "refused", at, cause: "store-refused", storeCause, detail };
}

async function put(store: Tier1Store, memory: MemoryRecord, at: string): Promise<MemoryWriteResult> {
  const written = await store.put(encodeMemory(memory));
  if (written.state === "refused") {
    return storeRefusal(at, written.cause, `the Tier 1 store refused the write: ${written.detail}`);
  }
  if (written.replaced) {
    // The existence check above passed and the store still replaced something, which means
    // another writer created this id in between. The prior record IS gone; saying so is the
    // only honest move left, and it is why this reports a refusal despite having written.
    return {
      state: "refused",
      at: `${at}.id`,
      cause: "id-in-use",
      detail:
        `"${memory.id}" did not exist when this write was checked and did by the time it landed, ` +
        `so another writer created it in between and this write REPLACED it. Supersession, never ` +
        `overwriting, is enforced by a check-then-write against a store with no compare-and-set, ` +
        `so this window is real and is reported rather than hidden.`,
    };
  }
  return { state: "remembered", memory };
}

/**
 * Remember something, as the AGENT.
 *
 * Takes `unknown` because the write-back in spec §4 step 6 is frequently a model's JSON, and
 * this is the boundary where that JSON becomes state the product will show a person later.
 *
 * The order of the checks is the design:
 *   1. shape, keys, reasoning channels, score-shaped names — pure, no I/O;
 *   2. the id must be FREE (`id-in-use`), so nothing here can overwrite;
 *   3. the supersession target must exist and share this memory's kind;
 *   4. a human decision on the superseded memory is carried FORWARD, unchanged.
 *
 * Step 4 is the one that matters. An agent write cannot express a verdict — `MemoryDraft` has
 * no decision field — and a re-run that replaces a memory a person rejected produces a
 * replacement that is still rejected, still naming the memory the person actually read. There
 * is no argument, no flag and no order of operations that un-rejects it.
 */
export async function remember(store: Tier1Store, input: unknown, at = "draft"): Promise<MemoryWriteResult> {
  const validated = validateDraft(input, at);
  if (!validated.ok) {
    return { state: "refused", cause: validated.cause, at: validated.at, detail: validated.detail };
  }
  const draft = validated.draft;
  const kind = draft.derivedFrom[0]?.kind;
  if (kind === undefined) {
    return {
      state: "refused",
      at: `${at}.derivedFrom`,
      cause: "empty-derivation",
      detail: "no derivation survived validation.",
    };
  }

  const existing = await recall(store, draft.id);
  if (existing.state === "unreadable" && existing.cause === "store-refused") {
    return storeRefusal(`${at}.id`, "io-error", existing.detail);
  }
  if (existing.state !== "absent") {
    return {
      state: "refused",
      at: `${at}.id`,
      cause: "id-in-use",
      detail:
        `"${draft.id}" is already in this store. Ids are never reused, because a write under an ` +
        `existing id is an OVERWRITE — and an overwrite is how a re-run quietly discards or ` +
        `resurrects a decision a person made. Write a new id carrying supersedes: "${draft.id}".`,
    };
  }

  let decision: HumanDecision | undefined;
  if (draft.supersedes !== undefined) {
    const prior = await recall(store, draft.supersedes);
    if (prior.state === "absent") {
      return {
        state: "refused",
        at: `${at}.supersedes`,
        cause: "supersedes-absent",
        detail:
          `"${draft.supersedes}" is not in this store, so this write would claim to replace ` +
          `something that was never here. A dangling supersession link is a lineage with a hole ` +
          `in it, and a hole is where a human decision goes missing.`,
      };
    }
    if (prior.state === "unreadable") {
      return storeRefusal(
        `${at}.supersedes`,
        "record-malformed",
        `"${draft.supersedes}" is in this store and could not be read (${prior.cause}): ` +
          `${prior.detail}. Superseding a memory this build cannot read would discard a decision ` +
          `it cannot see, so the write is refused rather than completed blind.`,
      );
    }
    if (prior.memory.kind !== kind) {
      return {
        state: "refused",
        at: `${at}.supersedes`,
        cause: "supersedes-different-kind",
        detail:
          `this memory is "${kind}" and would replace a "${prior.memory.kind}" one. Replacement ` +
          `across kinds is laundering with an extra step: the current memory in that lineage would ` +
          `end up more shareable than the material it descends from. Kinds do not change by re-run.`,
      };
    }
    // Carried forward VERBATIM, `decidedOn` included, so an inherited verdict never looks like
    // a verdict made about text the person never saw.
    decision = prior.memory.decision;
  }

  const memory: MemoryRecord = {
    id: draft.id,
    kind,
    body: draft.body,
    recordedAt: draft.recordedAt,
    provenance: draft.provenance,
    derivedFrom: draft.derivedFrom,
    ...(draft.supersedes !== undefined ? { supersedes: draft.supersedes } : {}),
    ...(decision !== undefined ? { decision } : {}),
  };
  return put(store, memory, at);
}

/**
 * Record a HUMAN's verdict on a memory. The only writer of a `HumanDecision` in this file.
 *
 * It supersedes rather than mutates: the memory the person read stays in the store, byte for
 * byte, and a NEW record — same body, same kind, same derivation, same provenance, because
 * none of those changed — carries the verdict and links back. So the store holds both what was
 * said and what was decided about it, and neither was edited to produce the other.
 *
 * Every verdict carries a mandatory reason, `accepted` included. `ENGINEERING-PLAN` §9.3 names
 * why: the review gate is a label factory, and reasons are supervised data accruing as a
 * by-product of the product working normally.
 */
export async function recordHumanDecision(
  store: Tier1Store,
  input: unknown,
  at = "decision",
): Promise<MemoryWriteResult> {
  if (!isRecord(input)) {
    return { state: "refused", at, cause: "not-a-record", detail: `expected an object, got ${describe(input)}.` };
  }
  const screened = screenKeys(input, DECISION_KEYS, at);
  if (screened) return { state: "refused", at: screened.at, cause: screened.cause, detail: screened.detail };

  const rawId: unknown = input["id"];
  if (!nonEmptyString(rawId)) {
    return {
      state: "refused",
      at: `${at}.id`,
      cause: "missing-id",
      detail:
        `expected a new, unused id for the record that will carry this verdict, got ` +
        `${describe(rawId)}. A decision gets its own record because the memory it is about is ` +
        `never edited.`,
    };
  }
  const rawDecides: unknown = input["decides"];
  if (!nonEmptyString(rawDecides)) {
    return {
      state: "refused",
      at: `${at}.decides`,
      cause: "decides-absent",
      detail: `expected the id of the memory being decided, got ${describe(rawDecides)}.`,
    };
  }
  const verdict: unknown = input["verdict"];
  if (verdict !== "accepted" && verdict !== "rejected") {
    return {
      state: "refused",
      at: `${at}.verdict`,
      cause: "not-a-record",
      detail: `expected "accepted" or "rejected", got ${describe(verdict)}. There is no third, ` +
        `softer verdict and no numeric one — a verdict is a decision, not a level.`,
    };
  }
  const reason: unknown = input["reason"];
  if (!nonEmptyString(reason)) {
    return {
      state: "refused",
      at: `${at}.reason`,
      cause: "decision-reason-missing",
      detail:
        `expected the person's reason, got ${describe(reason)}. Both verdicts carry one: the ` +
        `reasons are the only labelled corpus this product ever gets, and they are collected ` +
        `without asking anyone to do extra work.`,
    };
  }
  const decidedAt: unknown = input["decidedAt"];
  if (!nonEmptyString(decidedAt) || !isIsoInstant(decidedAt)) {
    return {
      state: "refused",
      at: `${at}.decidedAt`,
      cause: "invalid-instant",
      detail: `expected an ISO-8601 instant with an explicit offset, got ${describe(decidedAt)}.`,
    };
  }

  const newId = memoryId(rawId);
  const decidedId = memoryId(rawDecides);
  if (newId === decidedId) {
    return {
      state: "refused",
      at: `${at}.id`,
      cause: "supersedes-self",
      detail: `the verdict's record needs its own id; it supersedes the memory it decides.`,
    };
  }

  const existing = await recall(store, newId);
  if (existing.state !== "absent") {
    return {
      state: "refused",
      at: `${at}.id`,
      cause: "id-in-use",
      detail: `"${newId}" is already in this store. A verdict never overwrites; give it a fresh id.`,
    };
  }

  const target = await recall(store, decidedId);
  if (target.state === "absent") {
    return {
      state: "refused",
      at: `${at}.decides`,
      cause: "decides-absent",
      detail: `"${decidedId}" is not in this store, so there is nothing here for this verdict to be about.`,
    };
  }
  if (target.state === "unreadable") {
    return storeRefusal(
      `${at}.decides`,
      "record-malformed",
      `"${decidedId}" could not be read (${target.cause}): ${target.detail}. A verdict is recorded ` +
        `against material a person read; this build cannot confirm what that was.`,
    );
  }

  const decided: MemoryRecord = {
    id: newId,
    kind: target.memory.kind,
    body: target.memory.body,
    recordedAt: target.memory.recordedAt,
    provenance: target.memory.provenance,
    derivedFrom: target.memory.derivedFrom,
    supersedes: decidedId,
    decision: { verdict, reason, decidedAt, decidedOn: decidedId },
  };
  return put(store, decided, at);
}

// ---------------------------------------------------------------------------------------
// Standing and egress — pure functions over what was read
// ---------------------------------------------------------------------------------------

/**
 * Where one memory stands, given every memory in the store.
 *
 * O(n) over `all`. The two axes are independent by construction; see `MemoryStanding`.
 */
export function standingOf(memory: MemoryRecord, all: readonly MemoryRecord[]): MemoryStanding {
  const by: MemoryId[] = [];
  for (const candidate of all) {
    if (candidate.supersedes === memory.id) by.push(candidate.id);
  }
  const succession =
    by.length === 0 ? ({ state: "current" } as const) : ({ state: "superseded", by } as const);

  const decision = memory.decision;
  const review =
    decision === undefined
      ? ({ state: "unreviewed" } as const)
      : ({
          state: decision.verdict,
          reason: decision.reason,
          decidedAt: decision.decidedAt,
          decidedOn: decision.decidedOn,
        } as const);

  return { succession, review };
}

/**
 * The memories a turn may actually build on: not replaced by a later one, and not rejected.
 *
 * This function exists rather than leaving the filter to each caller, because "forgot to check
 * the rejection" is precisely the bug §9.2 forbids, and a bug that lives in every call site is
 * a bug that will be written again. A rejected memory is still in the store and still readable
 * through `recallAll` — it is excluded from USE, never deleted, because deleting a person's
 * decision is its own kind of forgetting.
 *
 * O(n) with one Set.
 */
export function activeMemories(all: readonly MemoryRecord[]): readonly MemoryRecord[] {
  const superseded = new Set<string>();
  for (const memory of all) {
    if (memory.supersedes !== undefined) superseded.add(memory.supersedes);
  }
  return all.filter((m) => !superseded.has(m.id) && m.decision?.verdict !== "rejected");
}

/**
 * F-007 (.loop/FINDINGS.md): every active memory was injected into every later prompt, with no
 * cap. `activeMemories` already refuses to shrink over time — superseded and rejected memories
 * drop out, but a person asking new things forever writes one new LIVE memory per distinct
 * question forever (`cos.mjs`'s `rememberTurn`, keyed by `requestFingerprint`) — so the injected
 * set does not merely fail to shrink, it has no ceiling at all. Measured consequence at
 * `cos.mjs`'s THE LOCAL OPERATING POINT comment: a 12-item store's accumulated memories pushed a
 * re-ask to a 1120-token prompt that burned the entire 2048-token generation budget on
 * `gemma4:12b`'s own deliberation and came back `done_reason: length` with an EMPTY answer, while
 * the same question asked fresh had answered in 548. The product was degrading toward silence
 * with use, and that trend has no natural stopping point without a cap.
 *
 * THE BUDGET IS ON COUNT, and RECENCY IS THE RANKING — chosen by reading what is already on
 * `MemoryRecord` rather than adding anything. This file already refuses to rank a memory by
 * importance, usage or relevance (see the header: an ordering invites a threshold, a threshold
 * is a score with a privacy budget), so recency is not a new judgement call bolted onto that
 * refusal — it is the one fact every memory already carries for a different reason
 * (`recordedAt`, the caller's own instant) and it needs no new field, no model call, and no
 * heuristic about what a person will ask next. It is also the honest proxy for the actual
 * defect: the store grows by one live memory per distinct question, and the most recently
 * recorded ones are the ones a still-ongoing conversation is most likely to be building on.
 * COUNT rather than a token/character estimate for the same reason `screenKeys` refuses a
 * `confidence` field rather than computing one: this file has no tokenizer, and inventing a
 * "roughly N characters per token" constant would be an unowned approximation standing in for a
 * real measurement, in a file whose whole discipline is refusing exactly that kind of shortcut.
 *
 * THE NUMBER, not a round guess: `memoryBody` composes at minimum five fixed lines (the
 * question, the producer, what it rested on, a blank line, and either the floor's fixed refusal
 * sentence or the model's stored answer) before a single word of a person's own material. Eight
 * is enough live memories for a person to keep building on a real, ongoing thread without
 * re-creating an unbounded prompt at a higher ceiling.
 */
export const MEMORY_INJECTION_BUDGET = 8;

/**
 * The active memories one turn may actually inject, and how many were left out by the budget.
 *
 * PURE. No store, no clock — everything it needs is already on the records `activeMemories`
 * handed back. Ranks by `recordedAt` (parsed as an instant, never compared as a string, so a
 * mix of `Z` and an explicit `+HH:MM` offset still orders correctly) and keeps the `budget` most
 * recent; a tie in `recordedAt` keeps the earlier array position, so ordering is deterministic
 * without inventing a second tiebreaker. The INCLUDED set is returned in `active`'s own original
 * order, not recency order — this file does not reorder what a person's memories mean by when
 * they were written, only which of them make it into the prompt.
 *
 * O(n log n) to rank, O(n) to filter — no store read, so calling it costs nothing beyond what
 * `recallAll` already paid.
 */
export function budgetMemories(
  active: readonly MemoryRecord[],
  budget: number = MEMORY_INJECTION_BUDGET,
): MemoryBudgetResult {
  if (active.length <= budget) return { included: active, withheldByBudget: 0 };

  const ranked = active
    .map((memory, index) => ({ memory, index, at: Date.parse(memory.recordedAt) }))
    .sort((a, b) => (b.at !== a.at ? b.at - a.at : a.index - b.index));
  const kept = new Set(ranked.slice(0, budget).map((entry) => entry.index));
  const included = active.filter((_, index) => kept.has(index));
  return { included, withheldByBudget: active.length - included.length };
}

/**
 * Whether one memory may cross the machine boundary — a membership test, never a rank.
 *
 * The reason text is written for a person to read, because the egress plan is something they
 * are shown item by item; "withheld: memory-7" is not an answer.
 */
export function egressOf(memory: MemoryRecord): MemoryEgress {
  if (memory.kind === "tier3-shareable") {
    return { state: "may-leave", id: memory.id, kind: "tier3-shareable" };
  }
  if (memory.kind === "tier1-local") {
    return {
      state: "device-only",
      id: memory.id,
      kind: memory.kind,
      reason:
        `this memory was derived from device-only material, so it is device-only. A summary of a ` +
        `private reflection is still the private reflection — the whole egress rule is defeated in ` +
        `one line if derivation is allowed to change a kind.`,
    };
  }
  return {
    state: "device-only",
    id: memory.id,
    kind: memory.kind,
    reason:
      `this memory was derived from confidential material, which is not device-only but has not ` +
      `been declared shareable either. Only "tier3-shareable" may leave, and only because the ` +
      `person said so about the material it came from.`,
  };
}
