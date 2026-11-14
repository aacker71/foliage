/**
 * CLASSIFICATION — what a piece of assembled context IS, as DECLARED by the caller.
 *
 * This module answers exactly one question and refuses the neighbouring one. It answers "what
 * did the caller state this material is?" It does NOT answer "how sensitive does this look?",
 * and the difference is the whole reason the module exists.
 *
 * WHY DECLARED AND NEVER INFERRED. This codebase already paid for the inferring version once,
 * in a different domain: measured over one real repository (docs/ENGINEERING-PLAN.md §6), the
 * owner alone commits under SEVEN identity strings, and four of that repository's six author
 * emails are one human. An extractor inferring "the people of this branch" from commit
 * authorship reported ~6 people where the truth is ~2. Inference did not fail loudly there; it
 * invented people, confidently, and the product would have asserted their existence.
 *
 * A sensitivity classifier that guesses fails in the same shape and with a worse blast radius.
 * "This paragraph looks like a performance review" is a guess about the most private material a
 * person owns, and the failure mode is not a wrong label — it is a private paragraph crossing to
 * an inference provider because a heuristic scored it low. So the caller DECLARES, in a fixed
 * vocabulary of three kinds, and material the caller declared nothing about gets the most
 * restrictive answer rather than a guess. Declaration is the same control the roster is.
 *
 * SENSITIVITY IS A KIND, NOT A MAGNITUDE. `DeclaredKind` is a set of three names with no
 * ordering, no comparator, no numeric mapping, and no "level" field — for the same reason
 * `ProofTier` has none (@foliage/leaf/leaf.ts). An ordered sensitivity invites a threshold,
 * a threshold invites a tunable, and a tunable is a score with a privacy budget attached.
 * Nothing in this package can be compared, summed, or sorted.
 *
 * NO BOOLEAN AND NO NUMBER CROSSES THE PUBLIC SURFACE. Not one exported function returns
 * `boolean`, and not one exported type carries a `boolean` or `number` field. The internal
 * helpers below are TYPE PREDICATES (`v is Record<string, unknown>`), which is a different
 * thing: a predicate narrows a type at a branch and never becomes a value a caller can read,
 * store, threshold, or aggregate. The rule guards decisions, not control flow.
 *
 * TOTAL and PURE: takes `unknown`, returns a classification or a refusal. No fs, no network,
 * no clock, no throw, no subprocess — the same posture as `parseLeafDocument`, and for the same
 * reason: a privacy gate that can only be exercised with a database is a gate nobody tests.
 *
 * Complexity: O(k) in the keys of one record. `classifyAll` is O(n) over items plus an O(n) Set
 * for duplicate ids.
 */

import { SCORE_SHAPED } from "@foliage/leaf";

/**
 * Opaque id for one piece of assembled context, so it can never be passed where a `LeafletId`
 * is expected. That confusion is not hypothetical: nothing this router touches may become a
 * leaflet (docs/PRODUCT-ARCHITECTURE-SPEC.md §11.4), and two `string` ids in the same function
 * are how that rule gets broken by autocomplete rather than by decision.
 */
export type ContextItemId = string & { readonly __brand: "ContextItemId" };

export const contextItemId = (s: string): ContextItemId => s as ContextItemId;

/**
 * The three kinds a caller may declare, named after the tiers of
 * docs/PRODUCT-ARCHITECTURE-SPEC.md §3 so a reader can hold one vocabulary rather than two.
 *
 *   tier1-local          Device-only material: private reflections, performance-review content,
 *                        unpolished career anxieties. It never leaves the machine. Not "leaves
 *                        only with permission" — the policy that tries to permit it is REFUSED
 *                        (see `route`), because a device-only guarantee with an override is a
 *                        setting, not a guarantee.
 *   tier2-confidential   Structured portfolio content, career history, leaflet drafts. Sensitive,
 *                        and not device-only.
 *   tier3-shareable      Material the person has declared may be re-injected into a stateless
 *                        inference call. `store=false` means the provider keeps nothing, and it
 *                        also means every call must carry its context again — §3, Tier 3.
 *
 * DELIBERATELY UNORDERED. There is no `compareKinds`, no index, no rank. `DECLARED_KINDS` is a
 * frozen array for enumeration and iteration order only; reading position out of it as a
 * severity would be exactly the mapping this type refuses to provide.
 */
export type DeclaredKind = "tier1-local" | "tier2-confidential" | "tier3-shareable";

export const DECLARED_KINDS: readonly DeclaredKind[] = Object.freeze([
  "tier1-local",
  "tier2-confidential",
  "tier3-shareable",
]);

/**
 * One piece of assembled context, as a caller constructs it in TypeScript.
 *
 * `declaredKind` is REQUIRED. A caller that genuinely does not know must say so by handing
 * `route` a record without it — at which point the answer is `undeclared` with a cause, not a
 * default. Making the field optional here would let "I forgot" and "I don't know" compile to
 * the same thing, and only one of those is a statement.
 */
export interface ContextItem {
  readonly id: string;
  readonly declaredKind: DeclaredKind;
}

/** Keys an assembled context item may carry. Anything else is refused, never ignored. */
const ITEM_KEYS: ReadonlySet<string> = new Set(["id", "declaredKind"]);

/**
 * Why an item carries no usable declaration. Two distinct facts, kept apart on purpose: a
 * missing field is a caller that never declared, and an unrecognised value is a caller that
 * declared something this vocabulary does not have — probably a typo, possibly a newer version
 * of the vocabulary. Collapsing them would hide a version skew as an oversight.
 */
export type UndeclaredCause = "no-declaration" | "unrecognized-kind";

/**
 * Why an item is refused outright rather than merely undeclared. These are malformed INPUT,
 * not uncertain sensitivity, so they stop the whole request the way `parseLeafDocument` stops
 * on a malformed leaflet — a partially-understood context is not a context.
 */
export type ItemRefusalCause =
  | "not-a-record"
  | "missing-id"
  | "duplicate-id"
  | "unknown-key"
  | "score-shaped-key";

/**
 * What one item resolved to.
 *
 * Three arms, and the middle one is the point: `undeclared` is a WELL-FORMED item about which
 * nothing was stated. It keeps its id, it appears in the egress plan, and the person gets shown
 * why it stayed home. It is not an error and it is not dropped — the same posture `excluded`
 * has in @foliage/leaf.
 */
export type ItemClassification =
  | {
      readonly state: "declared";
      /** Where the item is, in a path a person can find: `items[3]`. */
      readonly at: string;
      readonly id: ContextItemId;
      readonly kind: DeclaredKind;
    }
  | {
      readonly state: "undeclared";
      readonly at: string;
      readonly id: ContextItemId;
      readonly cause: UndeclaredCause;
      /** What was actually there, for a message that does not make the reader guess. */
      readonly detail: string;
    }
  | {
      readonly state: "refused";
      readonly at: string;
      readonly cause: ItemRefusalCause;
      readonly detail: string;
    };

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

function isDeclaredKind(v: unknown): v is DeclaredKind {
  return v === "tier1-local" || v === "tier2-confidential" || v === "tier3-shareable";
}

/**
 * Classify ONE item. Total over `unknown`: this is the boundary where a JSON blob from a local
 * store, an MCP client, or a config file becomes something the policy is allowed to reason about.
 *
 * The score-shaped check runs BEFORE the declaration check on purpose. An item carrying
 * `confidence` is refused whether or not it also declared a kind — the list is refused by name
 * (@foliage/leaf `SCORE_SHAPED`, imported rather than copied) so the refusal reads as itself in
 * the output, instead of arriving as the generic "unknown key" and being fixed by adding the key.
 */
export function classify(input: unknown, at: string): ItemClassification {
  if (!isRecord(input)) {
    return { state: "refused", at, cause: "not-a-record", detail: `expected an object, got ${describe(input)}` };
  }

  for (const key of Object.keys(input)) {
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      return {
        state: "refused",
        at: `${at}.${key}`,
        cause: "score-shaped-key",
        detail:
          `"${key}" is a score-shaped key. This product never computes, stores or transmits a ` +
          `rating of a person, so a key that would smuggle one into assembled context is refused ` +
          `by name rather than passed through to a model.`,
      };
    }
    if (!ITEM_KEYS.has(key)) {
      return {
        state: "refused",
        at: `${at}.${key}`,
        cause: "unknown-key",
        detail:
          `"${key}" is not a field of an assembled context item. Unknown keys are refused rather ` +
          `than ignored: an ignored key is how a typo becomes an unexplained absence, and how a ` +
          `field nobody reviewed reaches an inference provider.`,
      };
    }
  }

  const rawId: unknown = input["id"];
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    return {
      state: "refused",
      at: `${at}.id`,
      cause: "missing-id",
      detail:
        `expected a non-empty string, got ${describe(rawId)}. Every item needs an id because the ` +
        `egress plan must be enumerable item by item — a person has to be shown WHICH thing did ` +
        `not leave their machine, and "one of them" is not an answer.`,
    };
  }
  const id = contextItemId(rawId);

  const rawKind: unknown = input["declaredKind"];
  if (rawKind === undefined) {
    return {
      state: "undeclared",
      at,
      id,
      cause: "no-declaration",
      detail:
        `no declaredKind. Nothing is inferred from the item's shape or content: undeclared ` +
        `material gets the most restrictive answer, and this is the reason recorded for it.`,
    };
  }
  if (!isDeclaredKind(rawKind)) {
    return {
      state: "undeclared",
      at: `${at}.declaredKind`,
      id,
      cause: "unrecognized-kind",
      detail:
        `declaredKind is ${describe(rawKind)}; expected one of ${DECLARED_KINDS.join(", ")}. ` +
        `An unrecognised kind is not treated as the nearest known one — that would be inference ` +
        `wearing a fallback's clothes.`,
    };
  }

  return { state: "declared", at, id, kind: rawKind };
}

/**
 * Classify a whole assembled context, in order, and refuse duplicate ids.
 *
 * DUPLICATE IDS ARE REFUSED, not de-duplicated. The egress plan is keyed by id for a person to
 * read; two rows sharing an id means "withheld: item-7" is ambiguous about which item stayed
 * home, and silently dropping one of them would withhold or admit a thing the caller never saw
 * reported. Complexity: O(n) with one Set.
 */
export function classifyAll(items: readonly unknown[], at = "items"): readonly ItemClassification[] {
  const seen = new Set<string>();
  const out: ItemClassification[] = [];
  for (const [index, raw] of items.entries()) {
    const where = `${at}[${index}]`;
    const c = classify(raw, where);
    if (c.state !== "refused" && seen.has(c.id)) {
      out.push({
        state: "refused",
        at: `${where}.id`,
        cause: "duplicate-id",
        detail:
          `"${c.id}" already appeared in this context. Ids are refused rather than de-duplicated ` +
          `so that no item is silently admitted or withheld under another item's name.`,
      });
      continue;
    }
    if (c.state !== "refused") seen.add(c.id);
    out.push(c);
  }
  return out;
}
