/**
 * THE DETERMINISTIC FLOOR — what this product answers with when there is no model at all.
 *
 * No model process, no credential, no network, no clock: `deterministicTurn` still returns a
 * turn that does real work. That is the whole claim of this file, and it is a load-bearing one,
 * because everything above it is an UPGRADE and not a dependency. Kill the local runtime, pull
 * the network cable, run this on a laptop that has never had an API key — the answer gets worse
 * and it never disappears.
 *
 * WHAT "REAL WORK" MEANS HERE, since "deterministic fallback" is usually a euphemism for a
 * paragraph of apology. Picture a superb chief of staff standing at a filing cabinet with no
 * computer. They cannot read your mind and they have not read every folder. What they can do,
 * and do in under a minute, is:
 *
 *   1. tell you exactly what is in the cabinet, folder by folder, by the name on the tab;
 *   2. read your request back to you and say which folders it touches by name;
 *   3. tell you what they DID NOT do — they did not open any folder — so you know what the
 *      answer rests on;
 *   4. name what is missing: what you asked about that has no folder at all;
 *   5. propose the next concrete thing to do about that.
 *
 * That is not nothing, and it is not a placeholder. Every one of those five is a fact this
 * function actually holds, and none of them requires a model. What a model adds is (6): reading
 * the contents. This file is honest about being on the near side of that line, in the output
 * and not only in this comment — see the LIMIT move.
 *
 * IT NEVER CLAIMS TO BE REASONING. `renderProvenance` for the `deterministic` arm says "no model
 * was involved; nothing below is reasoning", and the floor's opening move says the same thing in
 * the person's own answer. A deterministic answer that reads like a model's is the exact failure
 * a false `deterministic` provenance would be, moved from the metadata into the prose.
 *
 * ============================================================================
 * THE ONE CLAIM MADE WITHOUT A CITATION, AND WHY
 * ============================================================================
 *
 * Every statement this function makes about the person's material is a `cite` carrying that
 * item's `ContextItemId` — every one, including the statement that an item carries no
 * declaration. There is exactly one exception and it is deliberate: when the store is EMPTY,
 * "nothing is on file" is an `answer`, because there is no item to name. Refusing to say it
 * would leave the person staring at a turn that mentions their material not at all, which is
 * worse and is also less honest. The exception is safe precisely because it is the empty case:
 * a claim that the set is empty cannot be a claim about any member of it.
 *
 * Absences within a NON-empty store are handled differently and on purpose. "You have nothing
 * about your promotion" is stated as an `ask` — "no item on file is named for it; have you not
 * filed it, or is it here under another name?" — because the complete enumeration that names
 * every item precedes it in the same turn, so the reader can check the negative themselves, AND
 * because a gap in a filing cabinet is not a gap in a career. The store is not the world, and a
 * chief of staff who confuses the two starts telling people what they have not done.
 *
 * ============================================================================
 * HOW THE REQUEST IS MATCHED AGAINST THE MATERIAL, AND WHAT THAT IS NOT
 * ============================================================================
 *
 * Exact token equality between the words of the request and the words of an item's ID. Both
 * sides are lowercased and split on runs of non-alphanumerics; tokens shorter than three
 * characters and a small closed list of function words are dropped.
 *
 *   IT MATCHES THE NAME YOU GAVE THE ITEM, NOT ITS CONTENTS. This function never receives item
 *   bodies and never asks for them. Every match is reported in exactly those terms, because
 *   "your review mentions the platform role" and "you named a file `platform-review`" are
 *   different facts and only the second one is known here.
 *
 *   TOKEN EQUALITY, NOT SUBSTRING. `includes()` would match "art" inside "startup" and
 *   "ai" inside "email", and the resulting citation would be a real id attached to a
 *   relationship that does not exist — a false claim wearing a true citation, which is the
 *   worst shape available.
 *
 *   IT IS NOT A RANKING AND THERE IS NO SIMILARITY VALUE. Matching is set membership: an item
 *   either shares a word with the request or it does not. Nothing is sorted by how many words
 *   it shares, no total is reported, and there is no comparator in this file. An ordering over
 *   statements about a person is a rating of them by another name, and the enumeration stays in
 *   the order the caller assembled it.
 *
 *   HONEST LIMITS OF THE TOKENIZER: it is ASCII-alphanumeric, so `résumé` splits into `r`,
 *   `sum` and nothing useful, and it does no stemming, so `review` does not match `reviews`.
 *   Both are real misses. They fail as "no match found", which produces a QUESTION rather than
 *   a wrong claim — the direction a matcher should fail in.
 *
 * ============================================================================
 * INVARIANTS
 * ============================================================================
 *
 * PURE AND TOTAL: no fs, no network, no clock, no subprocess, no throw. Called twice with the
 * same input it returns the same turn, which is what makes it testable and what makes
 * "deterministic" a description rather than a name.
 *
 * NO SCORE, NO ORDERING, NO CONFIDENCE, anywhere in what it returns or how it decides.
 *
 * NOTHING IT RETURNS IS EVIDENCE. A `Turn` is not a leaflet, carries no `ProofTier`, and cannot
 * be written into a leaf document. The human review gate between synthesis and proof is on the
 * far side of this file and does not move.
 *
 * MOVE ORDER IS NARRATIVE, NOT PRIORITY: how it got here → what you asked → what you hold →
 * what that touches → what is missing → what I did not do → what to do next. A reader follows
 * it top to bottom; nothing in it says one move matters more than another.
 *
 * Complexity: O(r + sum over items of |id tokens|) for tokenization, then O(n·r) worst case for
 * the match pass with r the number of distinct request terms — both linear in real input, with
 * one Set per item and no sort anywhere.
 */

import type { ContextItemId, DeclaredKind, ItemClassification } from "./classify.ts";
import {
  answer,
  ask,
  cite,
  decline,
  deterministicProvenance,
  propose,
  turn,
  type Move,
  type Turn,
} from "./turn.ts";

// ---------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------

/**
 * Why the person's material is not available to reason over.
 *
 *   store-unreadable   The store exists and could not be read — a corrupt file, a wrong
 *                      secret, a permission error. Their material is still there.
 *   store-locked       The store was never opened this run because it is locked.
 *   not-consulted      Nothing tried to read it. Not a failure at all, and it must not be
 *                      reported as one; it is the state of a request that was answered before
 *                      the cabinet was opened.
 *
 * Three facts, never one. `apps/cos`'s `Tier1ListResult` already refuses to collapse `absent`,
 * `unreadable` and `undecryptable`; this is the same refusal one layer up.
 */
export type MaterialUnavailableCause = "store-unreadable" | "store-locked" | "not-consulted";

/**
 * What the floor was given to work with.
 *
 * `empty` IS ITS OWN STATE, mirroring `Tier1ListResult.state === "empty"` deliberately rather
 * than arriving as `items: []`. An empty array reads at the call site like a failure that was
 * swallowed; a named state reads like the fact it is, and it is the fact the floor gives its
 * best answer about.
 */
export type FloorMaterial =
  | { readonly state: "empty" }
  | { readonly state: "present"; readonly items: readonly ItemClassification[] }
  | {
      readonly state: "unavailable";
      readonly cause: MaterialUnavailableCause;
      readonly detail: string;
    };

/**
 * The named causes a LOCAL model runtime can fail with. Four, and they never collapse:
 *
 *   no-runtime         Nothing is listening where the runtime should be. No model is installed
 *                      or none is running.
 *   model-absent       The runtime answered and does not have the model that was asked for.
 *                      A completely different remedy from `no-runtime`, and reporting either as
 *                      the other sends someone to reinstall software they already have.
 *   timeout            Our own deadline expired. Ours, not the runtime's — a cold model load
 *                      measured 32.8s on the machine this was built against, so a deadline
 *                      chosen by habit rather than by measurement reports a working system as
 *                      broken.
 *   malformed-response The runtime answered and the answer is not a completion this code reads.
 */
export type LocalModelFailureCause = "no-runtime" | "model-absent" | "timeout" | "malformed-response";

/**
 * The named causes the escalated (third-party) path can fail with. These are the inference
 * client's vocabulary, matching `apps/cos/src/fireworks.ts`, and they are carried here so a
 * degraded answer can say which one sent it to the floor.
 *
 * None of them is a policy refusal, and route.ts's header says why that separation matters: on
 * a machine with no key configured, "policy would not let this leave" and "there was nobody to
 * send it to" happen in the same second and mean opposite things.
 */
export type EscalatedFailureCause =
  | "no-credential"
  | "no-model"
  | "timeout"
  | "network-unreachable"
  | "provider-refused"
  | "malformed-response";

/**
 * How the request arrived at the floor.
 *
 * `policy` is NOT a failure arm and is spelled separately for that reason. The router keeping a
 * request on the device is the product working exactly as promised; filing it under the same
 * name as "the model timed out" would teach a reader that privacy enforcement is an error
 * condition.
 */
export type FloorEntry =
  | {
      readonly by: "policy";
      readonly decision: "local-only" | "tier2-eligible" | "refused";
      readonly detail: string;
    }
  | { readonly by: "local-model-failed"; readonly cause: LocalModelFailureCause; readonly detail: string }
  | { readonly by: "escalation-failed"; readonly cause: EscalatedFailureCause; readonly detail: string }
  /** Nothing else was attempted. The floor is the whole of this turn by design. */
  | { readonly by: "floor-only" };

export interface FloorRequest {
  /** The person's words, verbatim. Never parsed to decide what kind of material they are. */
  readonly request: string;
  /**
   * What the person DECLARED the request itself to be, or `null` if they declared nothing.
   * Nothing here reads the words to guess — see classify.ts for the measured reason.
   */
  readonly requestKind: DeclaredKind | null;
  readonly material: FloorMaterial;
  readonly entry: FloorEntry;
}

// ---------------------------------------------------------------------------------------
// Tokenizing — small, closed, and documented rather than clever
// ---------------------------------------------------------------------------------------

/**
 * Function words dropped from a request before matching.
 *
 * A CLOSED LIST, not a frequency cutoff. A cutoff is a threshold, a threshold is tunable, and a
 * tunable over someone's words is the beginning of the thing this package refuses to be.
 *
 * IT HOLDS GRAMMAR AND LIGHT VERBS ONLY. No noun is in it — not `quarter`, not `board`, not
 * `year`, not `month` — because a noun someone might have named a file for is exactly the word
 * whose removal produces a SILENT miss, while an over-general word left in produces a visible,
 * answerable question. The two failures are not symmetric and the list is biased toward the
 * visible one deliberately.
 *
 * It was widened once, from real output rather than from taste: "should I put the platform
 * migration in front of the board next month" was asking the person about `"put"`, `"front"`,
 * `"next"` and `"month"` alongside `"board"`, which is a question nobody can answer. `put`,
 * `front` and `next` went in; `month` and `board` stayed out, and stay out.
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  // determiners, pronouns, prepositions, conjunctions
  "the", "and", "for", "with", "that", "this", "these", "those", "from", "into", "onto",
  "upon", "over", "under", "about", "than", "then", "there", "here", "such", "same", "its",
  "you", "your", "yours", "our", "ours", "their", "theirs", "them", "they", "she", "her",
  "hers", "him", "his", "who", "whom", "whose", "what", "when", "where", "which", "why",
  "how", "any", "all", "some", "more", "most", "other", "not", "but", "out", "off", "own",
  "via", "one", "two", "next", "last", "back", "front", "put",
  // auxiliaries and light verbs that carry no subject matter
  "have", "has", "had", "was", "were", "been", "being", "are", "can", "could", "should",
  "would", "will", "shall", "may", "might", "must", "does", "did", "doing", "done", "goes",
  "going", "get", "got", "let", "make", "made", "give", "take", "taken", "help", "please",
  "tell", "show", "need", "want", "like", "say", "said", "see", "seen", "think", "know",
  // intensifiers and discourse particles
  "just", "only", "also", "still", "even", "ever", "much", "many", "very", "too", "now",
  "yet",
]);

const SPLIT = /[^a-z0-9]+/;

function tokens(s: string): readonly string[] {
  const out: string[] = [];
  for (const t of s.toLowerCase().split(SPLIT)) {
    if (t.length > 0) out.push(t);
  }
  return out;
}

/** The distinct, meaningful words of a request, in the order they were typed. Never sorted. */
function requestTerms(request: string): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens(request)) {
    if (t.length < 3) continue;
    if (FUNCTION_WORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Join a list into readable prose without a count. `["a","b","c"]` → `"a", "b" and "c"`. */
function andList(xs: readonly string[]): string {
  const quoted = xs.map((x) => `"${x}"`);
  const last = quoted[quoted.length - 1];
  if (last === undefined) return "";
  if (quoted.length === 1) return last;
  return `${quoted.slice(0, -1).join(", ")} and ${last}`;
}

// ---------------------------------------------------------------------------------------
// The floor
// ---------------------------------------------------------------------------------------

const OPENING =
  "This was assembled on your machine by rule, not by reasoning. No model produced any of it — " +
  "not a local one and not a remote one — so nothing below is an inference about you. What a rule " +
  "can do is read back exactly what you have declared, say what your request touches by name, name " +
  "what it did not do, and propose the next concrete move.";

const LIMIT =
  "What this did NOT do: it did not open any of your material. Everything above rests on the names " +
  "you gave your items and the kinds you declared them to be — nothing has read a single body. " +
  "Anything that depends on what is INSIDE those items is missing from this answer, and saying so " +
  "is more useful than filling the space.";

/**
 * THE ENTRY POINT. Total: every `FloorRequest` produces a `Turn`, and `Turn` cannot be empty, so
 * there is no input for which this returns a decision with no answer attached.
 */
export function deterministicTurn(input: FloorRequest): Turn {
  const rest: Move[] = [];

  const entry = renderEntry(input.entry);
  if (entry !== null) rest.push(entry);

  const request = input.request.trim();
  const blank = request.length === 0;

  if (blank) {
    rest.push(
      ask(
        "What do you need? Nothing was typed as a request, so there is nothing for me to read back or match against your material.",
        "An empty request is not a question I can guess at, and guessing at it is how an assistant answers something you did not ask.",
      ),
    );
  } else {
    rest.push(
      answer(
        `Your request, verbatim and unaltered: "${request}". ` +
          (input.requestKind === null
            ? "You declared nothing about the request itself, so it is treated as the most restrictive kind rather than guessed at — its words are never read to decide what they are."
            : `You declared the request itself ${input.requestKind}.`),
      ),
    );
  }

  rest.push(...material(input.material, blank ? [] : requestTerms(request)));

  return turn(deterministicProvenance(), answer(OPENING), ...rest);
}

/** How the request got here, said in the person's own answer rather than only in a log. */
function renderEntry(entry: FloorEntry): Move | null {
  switch (entry.by) {
    case "floor-only":
      return null;
    case "policy":
      if (entry.decision === "refused") {
        return decline(
          "policy-refused",
          `The routing policy refused this request outright, so no model was asked — neither on this machine nor off it. ${entry.detail} ` +
            "This is a POLICY refusal and not a transport failure: nothing was unreachable and nothing was missing a credential. " +
            "What follows is what a rule can still tell you.",
        );
      }
      return answer(
        `How you got here: the router decided \`${entry.decision}\`, so nothing left this machine. ${entry.detail} ` +
          "That is the privacy boundary working, not a failure — and it is the reason a rule, rather than a model, is answering.",
      );
    case "local-model-failed":
      return answer(
        `How you got here: the local model was asked and did not answer — \`${entry.cause}\`. ${entry.detail} ` +
          "A model is an upgrade here and never a dependency, so this is the floor it degraded to. " +
          "The cause is named so you can fix the right thing: a runtime that is not running, a model that is not installed, " +
          "a deadline that expired, and a reply this code could not read are four different problems.",
      );
    case "escalation-failed":
      return answer(
        `How you got here: the escalated provider was asked and did not answer — \`${entry.cause}\`. ${entry.detail} ` +
          "Nothing about your material changed and nothing was lost; the answer degraded to what this machine can do alone.",
      );
  }
}

/** The inventory, the match, the gap, the limit and the next move. */
function material(m: FloorMaterial, terms: readonly string[]): readonly Move[] {
  switch (m.state) {
    case "unavailable":
      return unavailable(m.cause, m.detail);
    case "empty":
      return empty();
    case "present":
      return present(m.items, terms);
  }
}

function unavailable(cause: MaterialUnavailableCause, detail: string): readonly Move[] {
  if (cause === "not-consulted") {
    return [
      answer(
        "Your material was not read for this answer, so nothing here is a statement about what you hold. " +
          `${detail} An unread store is not an empty one, and this answer will not report it as one.`,
      ),
      propose(
        "Ask again against your store if you wanted this answered from your own material.",
        "There is a real difference between 'I looked and there is nothing' and 'I did not look', and only you can say which one you wanted.",
      ),
    ];
  }
  return [
    decline(
      "material-unreadable",
      `Your material could not be read — \`${cause}\`. ${detail} ` +
        "This is NOT the same fact as an empty store, and it is reported separately for that reason: your material is still there. " +
        "Nothing below is an inventory, because there is nothing this answer is entitled to say about what you hold.",
    ),
    propose(
      cause === "store-locked"
        ? "Unlock the store with the secret you chose, then ask again. Nothing else in this answer depends on it."
        : "Check the store file before asking again — the cause above names what went wrong with reading it, not with what is in it.",
      "A read failure that gets retried blindly becomes a read failure someone stops noticing.",
    ),
  ];
}

function empty(): readonly Move[] {
  return [
    answer(
      "Nothing is on file. That is a complete and honest state — an empty store, not an error and not something still loading. " +
        "There are no example items here and there never will be: this product does not seed a store to look useful, " +
        "so an empty answer is what an empty store gets.",
    ),
    answer(
      "What filing costs you: a name you choose, and one declared kind. `tier1-local` is device-only and never leaves this machine " +
        "under any policy; `tier2-confidential` is sensitive and not device-only; `tier3-shareable` may be re-sent to an inference " +
        "provider. Nothing is inferred from what an item contains — you say what it is, and that declaration is the control.",
    ),
    propose(
      "File the material this request bears on, and declare its kind. From then on this same rule — with no model, no network and " +
        "no account — can tell you by name what you hold that touches a request, what stayed on this machine and why, and what you " +
        "have asked about that is not filed anywhere.",
      "With nothing on file there is nothing to enumerate, and inventing an example to fill the space is the one failure this product refuses outright.",
    ),
  ];
}

function present(items: readonly ItemClassification[], terms: readonly string[]): readonly Move[] {
  const out: Move[] = [];

  /* Pass 1: the complete enumeration, in the order the caller assembled it. Every item, declared
     or not, becomes a citation carrying its own id — including the ones nothing was declared
     about, because "you have an item here I know nothing about" is still a statement about you. */
  const citable: {
    readonly id: ContextItemId;
    readonly at: string;
    readonly words: ReadonlySet<string>;
  }[] = [];
  let anyEnumerated = false;

  for (const c of items) {
    if (c.state === "refused") {
      out.push(
        decline(
          "material-malformed",
          `Something at ${c.at} is not a context item at all — \`${c.cause}\`: ${c.detail} ` +
            "It is named rather than skipped: an item quietly dropped from an inventory is an item you believe was counted.",
        ),
      );
      continue;
    }
    anyEnumerated = true;
    const words = new Set(tokens(c.id));
    citable.push({ id: c.id, at: c.at, words });
    out.push(
      c.state === "declared"
        ? cite(c.id, c.at, `On file as "${c.id}", declared ${c.kind}.`)
        : cite(
            c.id,
            c.at,
            `On file as "${c.id}", with no usable declaration (\`${c.cause}\`). Nothing is assumed about what it is; ` +
              "undeclared material gets the most restrictive answer rather than a guess.",
          ),
    );
  }

  if (!anyEnumerated) {
    /* Every item was malformed, so there is no enumeration and therefore no ground for stating
       any absence. The store is not empty and this answer must not imply that it is. */
    out.push(
      decline(
        "nothing-on-file",
        "Nothing in what was assembled is a context item, so there is no inventory to read back to you. " +
          "That is not the same as an empty store, and it is not reported as one.",
      ),
      propose(
        "Fix the malformed entries named above, then ask again.",
        "Each one carries where it sat and what was wrong with it, so none of them needs to be hunted for.",
      ),
    );
    return out;
  }

  /* Pass 2: which of those the request touches BY NAME. Set membership, in enumeration order,
     with no sort and no total — an ordering over statements about a person is a rating of them. */
  const matchedTerms = new Set<string>();
  if (terms.length > 0) {
    for (const item of citable) {
      const shared = terms.filter((t) => item.words.has(t));
      if (shared.length === 0) continue;
      for (const t of shared) matchedTerms.add(t);
      out.push(
        cite(
          item.id,
          item.at,
          `Its name shares ${andList(shared)} with your request. That is a match on the NAME you gave it — ` +
            "nothing here has read what is inside it, so this says your request and this item are about the same word, not that they are about the same thing.",
        ),
      );
    }

    const gaps = terms.filter((t) => !matchedTerms.has(t));
    if (gaps.length > 0) {
      out.push(
        ask(
          `Every item on file is named above, and none of their names matches ${andList(gaps)}. ` +
            "Is there material about that which you have not filed, or is it here under a different name?",
          "A gap in your filing is not a gap in your career, so this is a question rather than a finding. " +
            "The matcher is also literal — it compares whole words and does no stemming, so a differently-worded name misses.",
        ),
      );
    }
  }

  out.push(answer(LIMIT));

  /* Pass 3: one concrete next move. Chosen by which fact is actually true, and phrased so it
     refers back to what was cited instead of asserting anything new. */
  const anyUndeclared = items.some((c) => c.state === "undeclared");
  if (anyUndeclared) {
    out.push(
      propose(
        "Declare a kind for each item named above as carrying no declaration, then ask again.",
        "Until a kind is declared, an item is withheld from every model — including a local one — because undeclared material gets the most restrictive answer rather than a guess about what it contains.",
      ),
    );
  } else if (terms.length > 0 && matchedTerms.size === 0) {
    out.push(
      propose(
        "File material whose name carries the words you just used, declare its kind, and ask again — or rename what you have so its name says what it is.",
        "The name on the tab is the whole of what a rule can see. Naming an item for what it is about is what makes this answer better without any model at all.",
      ),
    );
  } else {
    out.push(
      propose(
        "Say what you want done with the items named above. A rule can tell you what you hold and what may leave this machine; reading what is inside them is the part that needs a model.",
        "Naming the specific thing is what turns an inventory into an answer, and it is the one piece only you have.",
      ),
    );
  }

  return out;
}
