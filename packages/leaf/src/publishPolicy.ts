/**
 * THE PUBLISH POLICY — the rules a person's leaflets are judged by before anything is offered
 * outward, written as a document they can read, and evaluated with no model anywhere near it.
 *
 * WHY IT LIVES IN @foliage/leaf, THE OPEN PLANE. The person governed by this policy has to be
 * able to read the exact rules they are judged by, run them, and disagree with them. A privacy
 * rule you cannot inspect is only a promise. So the policy is a document in the open core, next
 * to the format it judges, and `evaluatePolicy` is the whole implementation — there is no second
 * one in the hosted service that could be stricter, looser, or merely different.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THE ASYMMETRY THAT MAKES THIS SAFE. It is the core of the design, not a detail of it:
 *
 *   A RULE MAY ALWAYS MAKE SOMETHING MORE PRIVATE WITHOUT ASKING.
 *   A RULE MAY NEVER MAKE SOMETHING MORE PUBLIC WITHOUT A PERSON.
 *
 * Which cashes out as two effects that are NOT mirror images, and must never be refactored into
 * a symmetric pair:
 *
 *   DENY is ABSOLUTE. It is evaluated at publish time, every time, and it blocks — including
 *   something the subject explicitly shared. It is the safety rail, and an allow rule cannot
 *   override it no matter where either sits in the document (see `evaluatePolicy`: deny wins on
 *   MATCH, not on ORDER, so a rule added at the top cannot punch through a rail written at the
 *   bottom).
 *
 *   ALLOW only PROPOSES. A matching allow rule means "surface this to the subject as a
 *   candidate for sharing". It publishes nothing by itself. Nothing in this module returns a
 *   value a caller could mistake for "now it is public".
 *
 * The consequence is the reason to build it this way: a MISTAKEN RULE CAN ONLY EVER COST
 * VISIBILITY, NEVER CAUSE EXPOSURE. A deny that is too broad hides work the subject could have
 * shown, and they will notice and fix it. An allow that is too broad produces a longer list of
 * proposals, each of which still waits for a human. There is no configuration of this file, and
 * no bug in it, that hands somebody's evidence to a reader on its own.
 *
 * FAIL CLOSED, SAID OUT LOUD. A leaflet no rule matches is DENIED, with the cause
 * `no-rule-matched` rather than a silent `false`. An empty policy is therefore a valid, honest
 * state that proposes nothing — which is the correct behaviour for a document nobody has
 * written yet, and the same posture as visibility's absent-means-private default.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * A RULE MAY ONLY MATCH ON WHAT IS OBSERVABLE AND CHECKABLE about a leaflet: its tier, the
 * source or ref of the evidence it carries, its id prefix, whether it carries any evidence at
 * all, and whether its title carries a rating-shaped number. Every one of those is a fact
 * already written in the document, so two people running the policy on the same leaflet get the
 * same answer, today and next year.
 *
 * NO RULE MAY REST ON A MODEL'S OPINION, and the match vocabulary is closed — a fixed set of
 * kinds, refused by the parser if unrecognised — precisely so that "is this sensitive?" can
 * never become a matchable predicate. A policy whose enforcement calls a model is a policy that
 * quietly changes when the weights do, cannot be audited, and cannot be re-run to explain a past
 * decision. The person on the other side of a `deny` is owed a rule they can read.
 *
 * A DECISION NAMES ITS RULE. `evaluatePolicy` never returns a bare boolean: it returns the rule
 * that produced the outcome, its position in the document, and the reason its author wrote. The
 * question a subject actually asks is "why is this one private?", and "false" is not an answer.
 * A denial additionally names every allow rule it overrode, because "I have a rule that says
 * share my photos" deserves the response "yes, and this deny beat it, here it is".
 *
 * THIS MODULE NEVER WRITES VISIBILITY. Visibility is a field on the leaflet and an act by the
 * subject (see `leafletVisibility` in leaf.ts). The policy says what may be PROPOSED and what
 * must be DENIED; a surface handing a leaflet to a reader who is not the subject asks BOTH
 * questions — the person's act, and this rail — exactly as `publishableLeaflets` documents for
 * tier. Merging them here would turn a rules engine into a publish button.
 *
 * MEASURED ON REAL DATA, 2026-08-19, against a fresh intake of this repository (58 non-merge
 * commits, all `pending` because no signature on this machine could be checked): the default
 * policy proposes NOTHING and denies all 58 with cause `no-rule-matched`. That is the correct
 * result rather than a broken one — it is the same fact the README records about this
 * repository's unsigned history, arriving here through a different door, and it is what a
 * fail-closed default looks like on a portfolio nobody has decided to share.
 *
 * ALSO MEASURED, because a rail that fires on ordinary work is a broken product and not a safe
 * one: of those 58 real commit titles, 14 carry a digit and 0 are rating-shaped. Counts survive
 * ("cleanup: 7 commits", "a tree that loads four of five people"). An engineering percentage
 * or HTTP-status pair is likewise a fact about work, not a rating of a person. The rail requires
 * an explicit rating cue or an unambiguous rating form instead of treating every fraction and
 * percentage as a verdict on the builder.
 *
 * TOTAL and PURE, like everything else in this package: no fs, no network, no clock, no throw.
 * Complexity: `parsePublishPolicy` is O(rules) with an O(n) Set for duplicate ids;
 * `evaluatePolicy` is O(rules × evidence refs) — one pass over the rules, and a rule that reads
 * evidence walks the leaflet's provenance plus its body. Both are small and bounded by the
 * document.
 */

import {
  PROOF_TIERS,
  type Leaflet,
  type ProofTier,
  type Provenance,
} from "./leaf.ts";
import { SCORE_SHAPED } from "./document.ts";

/**
 * A NUMBER USED AS A RATING. "rated 4.5/5", "9 out of 10 in the survey", "4 stars".
 *
 * EXPORTED, and this is the canonical home, for the same reason `SCORE_SHAPED` is exported from
 * document.ts: one definition, every gate. The refusal of score-shaped KEYS already lives in
 * @foliage/leaf and @foliage/photosynthesis imports it rather than copying it; the refusal of
 * rating-shaped TEXT is the same rule applied to a value instead of a key, and it belongs beside
 * it in the open core — a policy is judged by the person it governs, so the definition of
 * "rating-shaped" cannot be somewhere they cannot read.
 *
 * Bare fractions and percentages describe ordinary work too: "2/3 checks passed", "HTTP
 * 409/500", "cut p99 by 40%". Treating their syntax alone as a person score hid real work.
 * This fixed pattern requires rating language, a common score scale without a measurement noun,
 * or an explicit top-percentile claim. It remains deterministic and stateless; it does not infer
 * sentiment. A bare "9/10" is ambiguous and refused; "9/10 tests" names the measured unit and
 * survives. An unrecognised noun after a scale may still cost visibility and can be reviewed.
 * All intake paths import this definition, so review and publication cannot silently disagree.
 */
const RATING_NUMBER = String.raw`\b\d+(?:\.\d+)?`;
const RATING_SCALE = String.raw`(?:\/\s*\d+|out of\s+\d+|%|\bpercent\b)`;
const MEASURED_UNITS = String.raw`(?:checks?|tests?|requests?|responses?|cases?|commits?|files?|builds?|jobs?|runs?|retries|tasks?|users?|people|items?|errors?|tickets?|services?|endpoints?|nodes?|pages?|records?|projects?)`;
export const RATING_SHAPED = new RegExp([
  String.raw`${RATING_NUMBER}\s*stars?\b`,
  String.raw`${RATING_NUMBER}\s*(?:\/\s*|out of\s+)(?:5|10)\b(?!(?:\s+\w+){0,2}\s+${MEASURED_UNITS}\b)`,
  String.raw`(?:\b(?:rated?|ratings?|scored|graded|ranked|critique)\b|\b(?:score|grade|rank)\s*(?:[:=]|(?=\d)))[^.!?\n]{0,36}?${RATING_NUMBER}\s*${RATING_SCALE}`,
  String.raw`${RATING_NUMBER}\s*${RATING_SCALE}[^.!?\n]{0,24}?\b(?:ratings?|score|grade|survey)\b`,
  String.raw`\b(?:candidate|applicant|developer|engineer|employee|contributor|person|individual)\s+(?:is|was)\s+${RATING_NUMBER}\s*(?:%|\bpercent\b)`,
  String.raw`\btop\s+\d+(?:\.\d+)?\s*(?:%|\bpercent\b)(?=$|[.!?]|[^.!?\n]{0,24}?\b(?:contributors?|candidates?|developers?|engineers?|employees?|applicants?|people|persons?|performers?)\b)`,
].join("|"), "i");

/**
 * What a rule does when it matches. Two effects, and they are deliberately NOT symmetric — see
 * the header. `deny` blocks absolutely; `allow` only proposes.
 *
 * Unordered and un-numbered, like `ProofTier` and `LeafletVisibility`: there is no "stronger"
 * effect to compute, only a rule that stops something and a rule that suggests it.
 */
export const PUBLISH_EFFECTS: readonly PublishEffect[] = Object.freeze(["deny", "allow"]);
export type PublishEffect = "deny" | "allow";

/**
 * THE CLOSED MATCH VOCABULARY. A rule may test one of these facts and nothing else.
 *
 * The set is closed on purpose and the parser refuses anything outside it. Every kind here is
 * something already written in the leaf document, so a decision is reproducible by anyone
 * holding the same two files. The moment this list can be extended by a free-text predicate,
 * "is this embarrassing?" becomes expressible, and the answer to it comes from a model.
 */
export const PUBLISH_MATCH_KINDS = [
  "tier",
  "evidence-source",
  "evidence-source-segment",
  "evidence-ref",
  "id-prefix",
  "title-rating-shaped",
  "no-evidence",
] as const;
export type PublishMatchKind = (typeof PUBLISH_MATCH_KINDS)[number];

/**
 * One checkable fact about a leaflet.
 *
 * A discriminated union rather than one shape with optional fields, for the same reason
 * `Leaflet` is: a `tier` match carrying a `prefix` would be a rule whose author believed
 * something the evaluator ignores, and silence about that is how a policy stops meaning what
 * its author read.
 *
 * EVIDENCE MEANS EVERY REF THE LEAFLET CARRIES — its own `provenance` AND every element of its
 * `body`. Indexing only the primary would let a leaflet carrying seven refs past a rail that
 * refused one, which is the exact seam where six real refs were dropped once already (see
 * promote.ts). A rule about evidence is about all of it.
 */
export type PublishMatch =
  /** The leaflet's proof tier, exactly. Tiers are unordered; this is equality, not a threshold. */
  | { readonly kind: "tier"; readonly tier: ProofTier }
  /** A `Provenance.source` string, exactly: "git", "photo", "brain-note". */
  | { readonly kind: "evidence-source"; readonly source: string }
  /**
   * One colon-delimited SEGMENT of a source string. `brain-note:third-party` marks material
   * about other people, and the mark is a suffix on the source rather than a field of its own —
   * so matching the whole string would need one rule per light source, and would miss the next
   * one. This matches the mark itself.
   */
  | { readonly kind: "evidence-source-segment"; readonly segment: string }
  /** One `Provenance.ref`, exactly: a specific commit, digest, or file the subject names. */
  | { readonly kind: "evidence-ref"; readonly ref: string }
  /** A prefix of the leaflet's id — "git:", "photo:" — which is how intake namespaces them. */
  | { readonly kind: "id-prefix"; readonly prefix: string }
  /** The title carries a number used as a rating, rather than an engineering measurement. */
  | { readonly kind: "title-rating-shaped" }
  /** The leaflet carries no evidence ref at all: a title with nothing behind it. */
  | { readonly kind: "no-evidence" };

/** The segment that marks material about other, identifiable people: `brain-note:third-party`. */
export const THIRD_PARTY_SEGMENT = "third-party";

/**
 * THE ONE SEGMENT TEST: does a source string carry this colon-delimited segment? The
 * `evidence-source-segment` publish match uses it, and so does the local brain, which holds back
 * any record resting on third-party material (unit 38). One function, so the two cannot drift.
 */
export function sourceHasSegment(source: string, segment: string): boolean {
  return source.split(":").includes(segment);
}

/**
 * ONE RULE. Both `id` and `reason` are REQUIRED, and neither is decoration.
 *
 * `id` is how a person refers to a rule they want changed or removed — "drop
 * deny-third-party-evidence" is a sentence; "drop the second one" is a hazard. `reason` is what
 * travels with the decision: a policy whose rules do not say WHY is a policy nobody can argue
 * with, and this format has no comment field precisely because the reason field is the comment
 * and it is mandatory.
 */
export interface PublishRule {
  readonly id: string;
  readonly effect: PublishEffect;
  readonly match: PublishMatch;
  /** Stated by the rule's author, carried verbatim onto every decision this rule produces. */
  readonly reason: string;
}

/**
 * An ordered list of rules.
 *
 * ORDER IS NOT PRECEDENCE between the two effects — deny beats allow whatever the order (see
 * `evaluatePolicy`). Order decides only WHICH rule of the same effect gets named when several
 * match, and the first one written wins, so the rule a reader scrolling the document meets first
 * is the rule the product quotes back at them.
 *
 * An EMPTY list is valid and means: propose nothing, deny everything by fail-closed default.
 */
export interface PublishPolicy {
  readonly rules: readonly PublishRule[];
}

/** One reason a document is not a publish policy, addressed to whoever is editing the file. */
export interface PublishPolicyIssue {
  /** `rules[2].match.tier` — the index is named, the same rule as `LeafDocumentIssue`. */
  readonly at: string;
  readonly message: string;
}

export type PublishPolicyParse =
  | { readonly ok: true; readonly policy: PublishPolicy }
  | { readonly ok: false; readonly issues: readonly PublishPolicyIssue[] };

/** A rule, and where it sits in the document, so "the third rule" is checkable rather than told. */
export interface MatchedRule {
  readonly rule: PublishRule;
  /** Its 0-based position in `policy.rules`, as written. */
  readonly index: number;
}

/**
 * WHY THIS LEAFLET IS WHERE IT IS. Never a boolean.
 *
 * Three outcomes, and the third is the one most systems leave implicit:
 *
 *   `denied` / `denied-by-rule`   a deny rule matched. Absolute — this is the publish-time rail,
 *                                 and it blocks even a leaflet the subject explicitly shared.
 *                                 `overrode` names every allow rule that matched and lost.
 *   `denied` / `no-rule-matched`  NOTHING matched, so it FAILS CLOSED. Stated as a named cause
 *                                 because "no rule said yes" and "a rule said no" are different
 *                                 facts with different remedies: the first is a policy that has
 *                                 not been written yet, the second is a policy doing its job.
 *   `may-propose`                 an allow rule matched and no deny did. This is a CANDIDATE for
 *                                 the subject to approve. It is not permission, and nothing in
 *                                 this module can turn it into permission.
 */
export type PublishDecision =
  | {
      readonly outcome: "denied";
      readonly cause: "denied-by-rule";
      readonly denied: MatchedRule;
      /** Allow rules that also matched and were overridden. Empty when none did. */
      readonly overrode: readonly MatchedRule[];
    }
  | {
      readonly outcome: "denied";
      readonly cause: "no-rule-matched";
      readonly reason: string;
    }
  | { readonly outcome: "may-propose"; readonly allowed: MatchedRule };

/**
 * The reason carried by a fail-closed decision. A constant rather than prose assembled at the
 * call site, so the sentence a subject reads is the same everywhere and can be translated once.
 */
export const NO_RULE_MATCHED_REASON =
  `no rule in this policy matches this leaflet, so it is NOT published. The default is closed: ` +
  `a policy proposes only what it explicitly allows, because a rule that is missing must cost ` +
  `visibility rather than cause exposure. Add an allow rule naming a fact about this leaflet — ` +
  `its tier, its evidence source, its id prefix — if it should be offered for sharing.`;

/**
 * Is this decision the ABSOLUTE rail — a deny rule that blocks even something the subject
 * explicitly shared?
 *
 * The publish-time question, separated from the proposal question on purpose. `no-rule-matched`
 * is also a denial, but it is a denial of a PROPOSAL: it withholds a suggestion, and it must not
 * retroactively revoke a share the subject already made by hand, or writing an empty policy
 * would silently un-publish everything they had decided before it existed. Only an explicit deny
 * — the rail — overrides a person, and this predicate is the one place that distinction lives.
 */
export function isAbsoluteDenial(decision: PublishDecision): boolean {
  return decision.outcome === "denied" && decision.cause === "denied-by-rule";
}

/**
 * The reason behind a decision, in the words of whoever wrote the rule — or the fail-closed
 * sentence when nothing matched. What a surface prints beside "private".
 */
export function decisionReason(decision: PublishDecision): string {
  switch (decision.outcome) {
    case "may-propose":
      return decision.allowed.rule.reason;
    case "denied":
      return decision.cause === "denied-by-rule" ? decision.denied.rule.reason : decision.reason;
  }
}

/**
 * Every `Provenance` a leaflet carries: its own, then each body element's, in document order.
 *
 * Both places, always. See the note on `PublishMatch`.
 */
function evidenceOf(leaflet: Leaflet): readonly Provenance[] {
  const refs: Provenance[] = [];
  if (leaflet.provenance !== undefined) refs.push(leaflet.provenance);
  for (const element of leaflet.body ?? []) refs.push(element.provenance);
  return refs;
}

/**
 * Does this leaflet exhibit the fact this match names?
 *
 * Total: every kind is handled, and the union is closed, so a new kind is a type error here
 * rather than a rule that silently never matches.
 */
function matches(match: PublishMatch, leaflet: Leaflet): boolean {
  switch (match.kind) {
    case "tier":
      return leaflet.tier === match.tier;
    case "evidence-source":
      return evidenceOf(leaflet).some((p) => p.source === match.source);
    case "evidence-source-segment":
      return evidenceOf(leaflet).some((p) => sourceHasSegment(p.source, match.segment));
    case "evidence-ref":
      return evidenceOf(leaflet).some((p) => p.ref === match.ref);
    case "id-prefix":
      return (leaflet.id as string).startsWith(match.prefix);
    case "title-rating-shaped":
      return RATING_SHAPED.test(leaflet.title);
    case "no-evidence":
      return evidenceOf(leaflet).length === 0;
  }
}

/**
 * Judge one leaflet against one policy, and say which rule decided.
 *
 * DENY WINS ON MATCH, NOT ON ORDER. Every rule is examined before anything is returned: if any
 * deny matches, the leaflet is denied, whatever position an allow rule holds. That is what makes
 * the rail un-overridable — under first-match-wins, moving an allow rule to the top of the file
 * would silently disable a safety rule written below it, and "I reordered my policy" would be a
 * way to cause exposure. Order still decides which rule is NAMED when several of one effect
 * match: the first as written, so the product quotes the rule a reader meets first.
 *
 * Pure and total. O(rules × evidence refs), one pass.
 */
export function evaluatePolicy(policy: PublishPolicy, leaflet: Leaflet): PublishDecision {
  let denied: MatchedRule | null = null;
  let allowed: MatchedRule | null = null;
  const matchedAllows: MatchedRule[] = [];

  for (const [index, rule] of policy.rules.entries()) {
    if (!matches(rule.match, leaflet)) continue;
    if (rule.effect === "deny") {
      denied ??= Object.freeze({ rule, index });
      continue;
    }
    const matched = Object.freeze({ rule, index });
    allowed ??= matched;
    matchedAllows.push(matched);
  }

  if (denied !== null) {
    return Object.freeze({
      outcome: "denied" as const,
      cause: "denied-by-rule" as const,
      denied,
      // The allow rules this rail beat. A subject who wrote one is owed the collision, not a
      // flat "no" that makes their own policy look broken.
      overrode: Object.freeze(matchedAllows),
    });
  }
  if (allowed !== null) {
    return Object.freeze({ outcome: "may-propose" as const, allowed });
  }
  return Object.freeze({
    outcome: "denied" as const,
    cause: "no-rule-matched" as const,
    reason: NO_RULE_MATCHED_REASON,
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE PARSER. Same discipline as `parseLeafDocument`, one document over: unknown keys refused,
// score-shaped keys refused BY NAME, every problem reported at once, never a throw.
//
// The small helpers below (`isRecord`, `nonEmptyString`, `describe`, `checkKeys`) are private to
// document.ts and so are re-stated here — the same copy `harvestDocument.ts` already makes. They
// are four lines each and their behaviour is pinned by tests on both sides; exporting them would
// widen @foliage/leaf's public surface for no caller outside this repository.
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A policy document holds `rules` and nothing else — no `$comment`, no `version`, no `name`.
 * Every rule already carries a mandatory `reason`, which is where a policy's prose belongs: a
 * comment field is a place to explain a rule somewhere other than on the rule.
 */
const POLICY_KEYS: ReadonlySet<string> = new Set(["rules"]);
const RULE_KEYS: ReadonlySet<string> = new Set(["id", "effect", "match", "reason"]);
/** The keys each match kind may carry. A `tier` match with a `prefix` is refused, not ignored. */
const MATCH_KEYS: ReadonlyMap<PublishMatchKind, ReadonlySet<string>> = new Map([
  ["tier", new Set(["kind", "tier"])],
  ["evidence-source", new Set(["kind", "source"])],
  ["evidence-source-segment", new Set(["kind", "segment"])],
  ["evidence-ref", new Set(["kind", "ref"])],
  ["id-prefix", new Set(["kind", "prefix"])],
  ["title-rating-shaped", new Set(["kind"])],
  ["no-evidence", new Set(["kind"])],
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function describe(v: unknown): string {
  if (v === undefined) return "nothing (the field is absent)";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "string") return v.trim().length === 0 ? "an empty string" : "a string";
  if (typeof v === "object") return "an object";
  return `a ${typeof v}`;
}

function checkKeys(
  rec: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
  issues: PublishPolicyIssue[],
): void {
  for (const key of Object.keys(rec)) {
    if (allowed.has(key)) continue;
    const where = at === "" ? key : `${at}.${key}`;
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      issues.push({
        at: where,
        message:
          `"${key}" is refused by name: a policy carries no rating of any kind. A rule matches ` +
          `a fact that is already written in the document, and it either matches or it does ` +
          `not — a weight on a rule is a score deciding what a person may show.`,
      });
    } else {
      issues.push({
        at: where,
        message:
          `unknown field "${key}". Unrecognised fields are refused rather than ignored, so a ` +
          `misspelling cannot become a rule that quietly never fires. Allowed here: ` +
          `${[...allowed].join(", ")}.`,
      });
    }
  }
}

/** One checkable fact, or every reason it is not one. */
function parseMatch(v: unknown, at: string, issues: PublishPolicyIssue[]): PublishMatch | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message:
        `"match" must be an object naming one checkable fact about a leaflet, got ${describe(v)}.`,
    });
    return null;
  }

  const kind = v["kind"];
  if (typeof kind !== "string" || !MATCH_KEYS.has(kind as PublishMatchKind)) {
    issues.push({
      at: `${at}.kind`,
      message:
        `required: one of ${PUBLISH_MATCH_KINDS.join(", ")} — got ${
          typeof kind === "string" ? `"${kind}"` : describe(kind)
        }. The vocabulary is closed on purpose: a rule may only test something already written ` +
        `in the leaf document, so that the same leaflet gets the same answer from anyone who ` +
        `runs it. Nothing here consults a model.`,
    });
    return null;
  }

  const matchKind = kind as PublishMatchKind;
  checkKeys(v, MATCH_KEYS.get(matchKind) as ReadonlySet<string>, at, issues);

  /** A match parameter: present, a string, and not blank. */
  const param = (key: string): string | null => {
    const raw = v[key];
    if (nonEmptyString(raw)) return raw;
    issues.push({
      at: `${at}.${key}`,
      message: `a "${matchKind}" match requires a non-empty "${key}", got ${describe(raw)}`,
    });
    return null;
  };

  switch (matchKind) {
    case "tier": {
      const tier = v["tier"];
      if (typeof tier !== "string" || !PROOF_TIERS.includes(tier as ProofTier)) {
        issues.push({
          at: `${at}.tier`,
          message:
            `a "tier" match requires one of ${PROOF_TIERS.join(", ")} — got ${
              typeof tier === "string" ? `"${tier}"` : describe(tier)
            }. These tiers are unordered, so this is equality and never a threshold.`,
        });
        return null;
      }
      return Object.freeze({ kind: "tier" as const, tier: tier as ProofTier });
    }
    case "evidence-source": {
      const source = param("source");
      return source === null ? null : Object.freeze({ kind: "evidence-source" as const, source });
    }
    case "evidence-source-segment": {
      const segment = param("segment");
      if (segment === null) return null;
      if (segment.includes(":")) {
        issues.push({
          at: `${at}.segment`,
          message:
            `"${segment}" is not a segment — a segment is one piece of a source between colons ` +
            `(the "third-party" of "brain-note:third-party"). Use an "evidence-source" match to ` +
            `name a whole source string.`,
        });
        return null;
      }
      return Object.freeze({ kind: "evidence-source-segment" as const, segment });
    }
    case "evidence-ref": {
      const ref = param("ref");
      return ref === null ? null : Object.freeze({ kind: "evidence-ref" as const, ref });
    }
    case "id-prefix": {
      const prefix = param("prefix");
      return prefix === null ? null : Object.freeze({ kind: "id-prefix" as const, prefix });
    }
    case "title-rating-shaped":
      return Object.freeze({ kind: "title-rating-shaped" as const });
    case "no-evidence":
      return Object.freeze({ kind: "no-evidence" as const });
  }
}

function parseRule(v: unknown, index: number, issues: PublishPolicyIssue[]): PublishRule | null {
  const at = `rules[${index}]`;
  if (!isRecord(v)) {
    issues.push({ at, message: `must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, RULE_KEYS, at, issues);

  const id = v["id"];
  const effect = v["effect"];
  const reason = v["reason"];
  let bad = false;

  if (!nonEmptyString(id)) {
    issues.push({
      at: `${at}.id`,
      message:
        `required: a non-empty id, got ${describe(id)}. It is how a person names this rule when ` +
        `they want it changed — "drop deny-third-party-evidence" is a sentence someone can say.`,
    });
    bad = true;
  }
  if (typeof effect !== "string" || !PUBLISH_EFFECTS.includes(effect as PublishEffect)) {
    issues.push({
      at: `${at}.effect`,
      message:
        `required: one of ${PUBLISH_EFFECTS.join(", ")} — got ${
          typeof effect === "string" ? `"${effect}"` : describe(effect)
        }. They are not opposites: "deny" blocks absolutely, at publish time, even something ` +
        `the subject shared by hand; "allow" only proposes a candidate for a person to approve.`,
    });
    bad = true;
  }
  if (!nonEmptyString(reason)) {
    issues.push({
      at: `${at}.reason`,
      message:
        `required: why this rule exists, got ${describe(reason)}. It is carried verbatim onto ` +
        `every decision this rule makes, because the subject's question is "why is this one ` +
        `private?" and a rule id alone does not answer it.`,
    });
    bad = true;
  }

  if (!("match" in v)) {
    issues.push({
      at: `${at}.match`,
      message:
        `required: the checkable fact this rule tests. A rule that matches nothing in ` +
        `particular would match everything or nothing, and neither is a rule.`,
    });
    bad = true;
  }
  const match = "match" in v ? parseMatch(v["match"], `${at}.match`, issues) : null;
  if (match === null) bad = true;

  if (bad || match === null || !nonEmptyString(id) || !nonEmptyString(reason)) return null;
  return Object.freeze({
    id,
    effect: effect as PublishEffect,
    match,
    reason,
  });
}

/**
 * Parse an untrusted value into a `PublishPolicy`, or into every reason it is not one.
 *
 * Never throws and never partially succeeds. A policy missing one rule is not a stricter policy
 * — it may be missing the DENY that was holding a rail, so half a policy silently applied is
 * precisely the failure mode this refuses. Whole document or none of it.
 */
export function parsePublishPolicy(value: unknown): PublishPolicyParse {
  const issues: PublishPolicyIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          at: "(document)",
          message: `a publish policy must be a JSON object with a "rules" array — got ${describe(value)}`,
        },
      ],
    };
  }

  checkKeys(value, POLICY_KEYS, "", issues);

  const rawRules = value["rules"];
  const rules: PublishRule[] = [];

  if (rawRules === undefined) {
    issues.push({
      at: "rules",
      message:
        `required: an array of rules. An empty array [] is valid and means a policy that ` +
        `proposes nothing and denies everything by fail-closed default — it is not the same as ` +
        `the field being missing, which is a document nobody finished writing.`,
    });
  } else if (!Array.isArray(rawRules)) {
    issues.push({ at: "rules", message: `must be an array, got ${describe(rawRules)}` });
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of rawRules.entries()) {
      const rule = parseRule(raw, i, issues);
      if (rule === null) continue;
      if (seen.has(rule.id)) {
        issues.push({
          at: `rules[${i}].id`,
          message:
            `duplicate id "${rule.id}" — ids must be unique within a policy, or "remove ` +
            `${rule.id}" names two rules and removes one of them.`,
        });
        continue;
      }
      seen.add(rule.id);
      rules.push(rule);
    }
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  return { ok: true, policy: Object.freeze({ rules: Object.freeze(rules) }) };
}

/**
 * Freeze a plain JSON value all the way down.
 *
 * The default policy is exported data, and exported data that can be mutated is module-level
 * shared state one careless caller away from editing everyone's safety rails.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const inner of Object.values(value)) deepFreeze(inner);
  return Object.freeze(value);
}

/**
 * THE DEFAULT POLICY, SHIPPED AS DATA.
 *
 * Typed `unknown` deliberately: it gets no privileged path into the product. It goes through
 * `parsePublishPolicy` exactly like a policy a person wrote themselves, which is what makes it a
 * document rather than a hard-coded behaviour — a subject can print it, copy it into their own
 * file, delete a rule they disagree with, and the product is running the same evaluator over the
 * result. A default expressed in code would be a rule nobody can read and nobody can edit.
 *
 * IT IS DELIBERATELY CONSERVATIVE, and every rule below is a DENY except one. That is the
 * asymmetry doing its job: the rails are stated, and the only thing the policy proposes on its
 * own is the tier this product already says may be published as a claim. Anything else waits for
 * the subject to add a rule — and until they do, the fail-closed default costs them visibility
 * they can recover in one line, rather than exposure they cannot recover at all.
 */
export const DEFAULT_PUBLISH_POLICY_DOCUMENT: unknown = deepFreeze({
  rules: [
    {
      id: "deny-excluded",
      effect: "deny",
      match: { kind: "tier", tier: "excluded" },
      reason:
        "An excluded leaflet is work this leaf could NOT attribute to its subject — it is " +
        "somebody else's. Publishing it would claim another person's work under this person's " +
        "name. The leaflet already carries the reason it was excluded; that reason is the " +
        "subject's own private accounting, not an outward claim.",
    },
    {
      id: "deny-third-party-evidence",
      effect: "deny",
      match: { kind: "evidence-source-segment", segment: THIRD_PARTY_SEGMENT },
      reason:
        "This leaflet rests on material marked third-party-shaped — a note filed where notes " +
        "ABOUT other, identifiable people live. Publishing it would publish somebody who never " +
        "agreed to be in this portfolio, and who cannot see it to object. The mark is read off " +
        "a path, so it is a shape and not a verdict: it is refused rather than judged.",
    },
    {
      id: "deny-rating-shaped-title",
      effect: "deny",
      match: { kind: "title-rating-shaped" },
      reason:
        'The title uses a number as a rating — "rated 4.5/5", "9 out of 10 in the survey", or "5 stars". ' +
        "This product never shows a score about a person to anyone; score-shaped KEYS are " +
        "refused by name in every document gate, and a rating in the one line a reader " +
        "actually reads is the same claim wearing prose. A count, HTTP status pair, or sourced " +
        "engineering percentage is not a rating and is not matched by this rule.",
    },
    {
      id: "deny-no-evidence",
      effect: "deny",
      match: { kind: "no-evidence" },
      reason:
        "This leaflet carries no evidence ref at all: a title with nothing behind it. Every " +
        "outward claim in this product traces to something checkable, so a bare assertion may " +
        "not go out even if the subject shares it by hand — that is what makes the rail a rail.",
    },
    {
      id: "propose-verified",
      effect: "allow",
      match: { kind: "tier", tier: "verified" },
      reason:
        "Authorship of this leaflet is cryptographically established: a declared identity, a " +
        "signature git accepted, and a signer git bound to that identity. It is the one tier " +
        "this product will publish as a claim, so it is offered to the subject as a candidate " +
        "for sharing — and it is still THEIR decision. This rule proposes; it never publishes.",
    },
  ],
});

/**
 * The default policy, parsed by the same gate as anyone's.
 *
 * Returns the parse RESULT rather than a `PublishPolicy`, because this function is total and the
 * gate is the only thing that may declare a document valid. If it ever returns `ok: false` that
 * is a bug in the constant above, not in the caller's input — the same posture as promote.ts's
 * round-trip check, and the same reason: a producer that can emit something its own gate refuses
 * is the failure both are built to catch. Pinned by a test, so it cannot rot silently.
 */
export function defaultPublishPolicy(): PublishPolicyParse {
  return parsePublishPolicy(DEFAULT_PUBLISH_POLICY_DOCUMENT);
}
