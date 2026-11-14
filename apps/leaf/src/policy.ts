/**
 * THE PUBLISH POLICY, WHERE A PERSON ACTUALLY MEETS IT — the rule compiled FROM ONE OF THEIR OWN
 * LEAFLETS, and the per-leaflet answer to "so what happens when a stranger asks for this address?".
 *
 * `@foliage/leaf` owns what the rules MEAN: the match vocabulary, the deny/allow asymmetry, the
 * evaluator, and the conservative default shipped as data. None of that is restated here, and
 * this file computes no verdict of its own — every decision below is `evaluatePolicy`'s, quoted.
 * What lives here is the part the domain deliberately does not do: turning an example the subject
 * points at into a rule, editing the document that holds them, and composing the policy's answer
 * with the subject's own act.
 *
 * PURE, TOTAL, NO DISK. The read lives one file over in `policyDocument.ts`, because `render.ts`
 * imports this module and a renderer whose import graph reaches `node:fs` is one careless line
 * away from reading a file while rendering a page.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THE GAP THIS CLOSES, measured before it was written (2026-08-19):
 *
 *   grep -rn "publishPolicy\|evaluatePolicy" apps packages --include='*.ts' --include='*.mjs'
 *   → every hit inside packages/leaf/src/publishPolicy{,.test}.ts and its one re-export line.
 *
 * The policy existed, was 123-tests green, and NOTHING ASKED IT ANYTHING. A rail nobody calls is
 * not a rail; it is a document about a rail. So this module and `../policy.mjs` are the callers,
 * and `render.ts` is where the answer stops being advice.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * THE DECISION TAKEN HERE THAT COULD HAVE GONE THE OTHER WAY: THE FIRST WRITE MATERIALISES THE
 * DEFAULT RULES ALONGSIDE THE NEW ONE. `addRule` on a subject with no policy file does NOT write
 * a one-rule document — it writes the four default rails plus their rule. Starting from empty
 * would mean the act of adding "share my photos" silently DELETED the rail that refuses
 * third-party evidence, which is precisely the class of quiet damage the asymmetry exists to
 * prevent. Stated in the CLI's own output, not only here.
 */

import {
  DEFAULT_PUBLISH_POLICY_DOCUMENT,
  PUBLISH_MATCH_KINDS,
  evaluatePolicy,
  isAbsoluteDenial,
  isLinkShareable,
  leafletVisibility,
  parseLeafDocument,
  parsePublishPolicy,
  type Leaf,
  type LeafDocumentIssue,
  type Leaflet,
  type LeafletVisibility,
  type Provenance,
  type PublishDecision,
  type PublishEffect,
  type PublishMatch,
  type PublishMatchKind,
  type PublishPolicy,
  type PublishPolicyIssue,
  type PublishRule,
} from "@foliage/leaf";

/* ======================================================================== BY EXAMPLE ==== */

/**
 * COMPILING A RULE FROM A LEAFLET THE SUBJECT POINTS AT.
 *
 * This is the whole "adjust it by example" path, and the reason it is a compiler rather than a
 * conversation: a model may DRAFT a rule, and nothing may EVALUATE one. What crosses from chat
 * into the product is a rule naming a fact that is already written in the document — never a
 * sentence a matcher has to interpret later. Run the same rule next year against the same
 * leaflet and it answers the same, with no weights in the room.
 *
 * The example is a REAL leaflet out of the subject's own leaf, so the compiler never invents a
 * value: every match below is READ OFF the leaflet, and where the leaflet does not exhibit the
 * fact, the answer is a named refusal rather than a rule that would match nothing. A rule that
 * silently matches nothing is worse than no rule — it reads, in the file, like protection.
 */
export type RuleFromExample =
  | { readonly ok: true; readonly rule: PublishRule }
  | {
      readonly ok: false;
      readonly cause: "no-such-fact";
      readonly kind: PublishMatchKind;
      readonly detail: string;
    }
  | {
      readonly ok: false;
      readonly cause: "ambiguous";
      readonly kind: PublishMatchKind;
      readonly detail: string;
      /** Every candidate value, so the subject can choose one instead of guessing. */
      readonly candidates: readonly string[];
    };

/** Is this string one of the domain's match kinds? Asked of the domain's list, never re-spelled. */
export function isMatchKind(value: string): value is PublishMatchKind {
  return (PUBLISH_MATCH_KINDS as readonly string[]).includes(value);
}

/** Every `Provenance` a leaflet carries — its own, then each body element's, in document order. */
function evidenceOf(leaflet: Leaflet): readonly Provenance[] {
  const refs: Provenance[] = [];
  if (leaflet.provenance !== undefined) refs.push(leaflet.provenance);
  for (const element of leaflet.body ?? []) refs.push(element.provenance);
  return refs;
}

/** The distinct values of one field across a leaflet's evidence, in first-seen order. */
function distinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * A rule id that reads like what it does: `deny-evidence-ref-3f2a1c9`.
 *
 * Derived rather than random so that running the same command twice produces the same id, and
 * the second run is refused BY THE PARSER as a duplicate instead of quietly filing a second copy
 * of a rule that already exists. Truncated because an id is a handle, not the value: the value is
 * in `match`, where the evaluator reads it.
 */
function ruleId(effect: PublishEffect, match: PublishMatch): string {
  const value =
    match.kind === "tier"
      ? match.tier
      : match.kind === "evidence-source"
        ? match.source
        : match.kind === "evidence-source-segment"
          ? match.segment
          : match.kind === "evidence-ref"
            ? match.ref
            : match.kind === "id-prefix"
              ? match.prefix
              : "";
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12);
  return slug === "" ? `${effect}-${match.kind}` : `${effect}-${match.kind}-${slug}`;
}

/**
 * Read one fact off one real leaflet and return the rule that matches it.
 *
 * `reason` is the subject's own words and is REQUIRED by the domain gate — a rule whose reason
 * is blank is refused whole, because the person on the other side of a `deny` is owed a sentence
 * and not a rule id. The CLI collects it with `--because`.
 */
export function ruleFromExample(
  leaflet: Leaflet,
  effect: PublishEffect,
  kind: PublishMatchKind,
  reason: string,
): RuleFromExample {
  const evidence = evidenceOf(leaflet);
  const built = (match: PublishMatch): RuleFromExample => ({
    ok: true,
    rule: { id: ruleId(effect, match), effect, match, reason },
  });

  switch (kind) {
    case "tier":
      return built({ kind, tier: leaflet.tier });

    case "evidence-source": {
      const sources = distinct(evidence.map((p) => p.source));
      const [only] = sources;
      if (only === undefined) {
        return {
          ok: false,
          cause: "no-such-fact",
          kind,
          detail:
            `"${leaflet.id}" carries no evidence at all, so there is no source to read a rule ` +
            `off. The fact this leaflet DOES exhibit is "no-evidence" — a rule on that kind is ` +
            `the one this example can produce.`,
        };
      }
      if (sources.length > 1) {
        return {
          ok: false,
          cause: "ambiguous",
          kind,
          detail:
            `"${leaflet.id}" rests on ${sources.length} different evidence sources, so a rule ` +
            `made "like this one" would silently pick one of them. Name the source you mean.`,
          candidates: sources,
        };
      }
      return built({ kind, source: only });
    }

    case "evidence-source-segment": {
      // A source is a colon-joined path like `brain-note:third-party`. Which SEGMENT the subject
      // means is genuinely their call — `brain-note` and `third-party` are wildly different rules
      // — so this kind is never guessed from an example.
      const segments = distinct(evidence.flatMap((p) => p.source.split(":")));
      return {
        ok: false,
        cause: "ambiguous",
        kind,
        detail:
          `a source segment cannot be read off an example: "${leaflet.id}" would offer ` +
          `${segments.length} of them, and they mean different things — one names the KIND of ` +
          `material, another names a shape within it. Choose the segment and write the rule with ` +
          `it, or use "evidence-source" to match the whole source.`,
        candidates: segments,
      };
    }

    case "evidence-ref": {
      const refs = distinct(evidence.map((p) => p.ref));
      const [only] = refs;
      if (only === undefined) {
        return {
          ok: false,
          cause: "no-such-fact",
          kind,
          detail:
            `"${leaflet.id}" carries no evidence ref, so there is nothing to name. A leaflet ` +
            `with no evidence is already denied by the default rail "deny-no-evidence".`,
        };
      }
      // The leaflet's OWN provenance ref is the one that means "this artifact", and it is first
      // in document order. A body element's ref is evidence the artifact cites, which is a wider
      // and different claim — so a multi-ref leaflet is reported rather than narrowed silently.
      if (refs.length > 1) {
        return {
          ok: false,
          cause: "ambiguous",
          kind,
          detail:
            `"${leaflet.id}" carries ${refs.length} evidence refs — its own and the ones its ` +
            `body cites. A rule on one of them denies every leaflet that cites it, which is ` +
            `probably wider than "never this one". Name the ref you mean.`,
          candidates: refs,
        };
      }
      return built({ kind, ref: only });
    }

    case "id-prefix": {
      // Ids minted by this product are `<producer>:<handle>` — `git:<sha>`, `photo:<digest>`.
      // The prefix INCLUDES the colon so that `photo:` cannot also match `photograph:`.
      const colon = (leaflet.id as string).indexOf(":");
      if (colon <= 0) {
        return {
          ok: false,
          cause: "no-such-fact",
          kind,
          detail:
            `"${leaflet.id}" has no "<producer>:" prefix, so there is no family of leaflets to ` +
            `name from it. An id-prefix rule is for "everything that came from my photos"; this ` +
            `id names only itself.`,
        };
      }
      return built({ kind, prefix: (leaflet.id as string).slice(0, colon + 1) });
    }

    case "title-rating-shaped":
    case "no-evidence": {
      // Both are facts with no value to read: the rule is the same rule whatever example you
      // point at. Refused unless the example ACTUALLY exhibits the fact, because otherwise the
      // subject is being told a rule was made "like this leaflet" about a leaflet it will never
      // match — and they would reasonably read that as protection they now have.
      // ASKED BY RUNNING THE RULE, not by re-implementing its test. A second copy of "is this
      // title rating-shaped?" here would be a fifth definition of the same regex, and the copies
      // drift. The probe is a one-rule policy and the question is `isAbsoluteDenial` — NOT
      // `outcome === "denied"`, which is also true of `no-rule-matched` and would have reported
      // that every leaflet exhibits every fact. That inversion was caught by this file's own test.
      const exhibits =
        kind === "no-evidence"
          ? evidence.length === 0
          : isAbsoluteDenial(
              evaluatePolicy(
                { rules: [{ id: "probe", effect: "deny", match: { kind }, reason: "probe" }] },
                leaflet,
              ),
            );
      if (!exhibits) {
        return {
          ok: false,
          cause: "no-such-fact",
          kind,
          detail:
            `"${leaflet.id}" does not exhibit "${kind}", so a rule made from it as an example ` +
            `would match nothing — and a rule that matches nothing reads, in the file, like ` +
            `protection you have. Write this rule from a leaflet that does, or state it directly.`,
        };
      }
      return built({ kind });
    }
  }
}

/* ===================================================================== EDITING THE FILE ==== */

/** What an edit to the policy document produced, or every reason it produced nothing. */
export type PolicyEdit =
  | {
      readonly ok: true;
      /** The whole document to write. A NEW object graph — the input is never mutated. */
      readonly document: unknown;
      readonly rules: readonly PublishRule[];
      /** True when this write is the one that materialises the shipped defaults into a file. */
      readonly seededDefaults: boolean;
    }
  | { readonly ok: false; readonly cause: "not-a-policy"; readonly issues: readonly PublishPolicyIssue[] }
  | { readonly ok: false; readonly cause: "duplicate-id"; readonly id: string }
  | { readonly ok: false; readonly cause: "no-such-rule"; readonly id: string; readonly known: readonly string[] }
  | { readonly ok: false; readonly cause: "would-not-parse"; readonly issues: readonly PublishPolicyIssue[] };

/**
 * The document an edit starts from.
 *
 * `null` means "there is no policy file yet", and it seeds THE DEFAULTS rather than an empty
 * document — decision 3 in the header, and the one place in this module where getting it wrong
 * would remove a rail instead of adding one.
 */
function baseDocument(existing: unknown): { readonly raw: unknown; readonly seeded: boolean } {
  if (existing !== null) return { raw: existing, seeded: false };
  return {
    raw: JSON.parse(JSON.stringify(DEFAULT_PUBLISH_POLICY_DOCUMENT)) as unknown,
    seeded: true,
  };
}

/** Every rule in a document, as the plain JSON a writer round-trips. */
function rulesArrayOf(raw: unknown): Record<string, unknown>[] {
  const rec = raw as { rules?: unknown };
  return Array.isArray(rec.rules) ? (rec.rules as Record<string, unknown>[]) : [];
}

/**
 * Add one rule to a policy document.
 *
 * JUDGED TWICE, exactly as `setVisibility` judges a leaf: once on the way in, so this command
 * cannot turn a broken policy into a differently broken one, and once over a full round trip on
 * what is about to be written, so a bug here cannot put a document on disk that this product
 * would then refuse to load. The caller still holds its original bytes either way.
 *
 * ORDER IS APPEND, and it does not matter to safety: `evaluatePolicy` decides deny-on-MATCH, not
 * on order, so a rule added at the end cannot be punched through by one added later at the top.
 */
export function addRule(existing: unknown | null, rule: PublishRule): PolicyEdit {
  const { raw, seeded } = baseDocument(existing);
  const before = parsePublishPolicy(raw);
  if (!before.ok) return { ok: false, cause: "not-a-policy", issues: before.issues };
  if (before.policy.rules.some((r) => r.id === rule.id)) {
    return { ok: false, cause: "duplicate-id", id: rule.id };
  }

  const next = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  next["rules"] = [...rulesArrayOf(next), JSON.parse(JSON.stringify(rule)) as unknown];

  const after = parsePublishPolicy(JSON.parse(JSON.stringify(next)));
  if (!after.ok) return { ok: false, cause: "would-not-parse", issues: after.issues };
  return { ok: true, document: next, rules: after.policy.rules, seededDefaults: seeded };
}

/**
 * Remove one rule by id.
 *
 * Removing a rule can only ever make the policy LOOSER, which is the one direction this product
 * refuses to do quietly — so it is an explicit command with an explicit id, it never matches by
 * prefix or pattern, and an id that is not there is a named failure listing the ids that are.
 */
export function dropRule(existing: unknown, id: string): PolicyEdit {
  const before = parsePublishPolicy(existing);
  if (!before.ok) return { ok: false, cause: "not-a-policy", issues: before.issues };
  if (!before.policy.rules.some((r) => r.id === id)) {
    return {
      ok: false,
      cause: "no-such-rule",
      id,
      known: before.policy.rules.map((r) => r.id),
    };
  }

  const next = JSON.parse(JSON.stringify(existing)) as Record<string, unknown>;
  next["rules"] = rulesArrayOf(next).filter((r) => r["id"] !== id);

  const after = parsePublishPolicy(JSON.parse(JSON.stringify(next)));
  if (!after.ok) return { ok: false, cause: "would-not-parse", issues: after.issues };
  return { ok: true, document: next, rules: after.policy.rules, seededDefaults: false };
}

/* ================================================================== WHAT ACTUALLY HAPPENS == */

/**
 * WHAT A STRANGER AT THE ADDRESS GETS — the composition of the two questions, and the only place
 * in this app that composes them.
 *
 * `@foliage/leaf` is emphatic that these are separate: the subject's ACT (`visibility`) and the
 * RAIL (`evaluatePolicy`). Neither replaces the other, so a surface must ask both — and a surface
 * that asks both in its own way is a surface that will one day ask only one. Hence one function,
 * one union, four arms, each of which is a different sentence to a different person.
 *
 *   `served`             the subject shared it and no rail objects. Its address answers.
 *   `withheld-by-rule`   THE RAIL BEAT THE PERSON. A deny rule blocks it, shared or not.
 *                        This is the only arm where the product overrides its own subject, so it
 *                        carries the rule that did it — a bare "no" here would be unanswerable.
 *   `not-shared`         the subject has not offered it. `candidate` says whether the policy
 *                        would PROPOSE it, which is the proposal list and not permission.
 *
 * THERE IS DELIBERATELY NO "the policy could not be read" ARM. That is not a fact about a
 * leaflet, it is a fact about a file, and it answers identically for every id — so it belongs at
 * the boundary that loads the policy (`../server.mjs`, which answers 503 and names the cause) and
 * not in a per-leaflet union where a renderer would have to decide what to say about it. An arm
 * nothing can construct is dark code wearing a discriminator.
 */
export type OutwardState =
  | { readonly kind: "served" }
  | { readonly kind: "withheld-by-rule"; readonly rule: PublishRule; readonly index: number }
  | { readonly kind: "not-shared"; readonly candidate: boolean };

/** One leaflet, its decision, and what that adds up to at its own address. */
export interface PublishRow {
  readonly id: string;
  readonly title: string;
  readonly visibility: LeafletVisibility;
  readonly decision: PublishDecision;
  readonly outward: OutwardState;
}

/**
 * Compose the subject's act with the rail, for ONE leaflet.
 *
 * Pure and total. The rail is asked FIRST and its absolute denial wins, because that is the
 * asymmetry the domain documents: a deny is evaluated at publish time and blocks even something
 * the subject explicitly shared.
 */
export function outwardStateOf(policy: PublishPolicy, leaflet: Leaflet): OutwardState {
  const decision = evaluatePolicy(policy, leaflet);
  // `isAbsoluteDenial` DECIDES; the two tests after it only recover the type, because a boolean
  // cannot narrow a union for the compiler. They are never a second opinion — `&&` short-circuits,
  // so if the domain ever widens what counts as absolute, this stops at the first call and the
  // arms below become a compile error rather than a rail that silently stopped firing.
  if (isAbsoluteDenial(decision) && decision.outcome === "denied" && decision.cause === "denied-by-rule") {
    return { kind: "withheld-by-rule", rule: decision.denied.rule, index: decision.denied.index };
  }
  if (!isLinkShareable(leafletVisibility(leaflet))) {
    return { kind: "not-shared", candidate: decision.outcome === "may-propose" };
  }
  return { kind: "served" };
}

/**
 * Every leaflet of a leaf, judged. Document order, because any other order is a ranking.
 *
 * Takes a parsed `Leaf` rather than raw bytes: the CLI needs the raw document for its own reasons
 * (see `../policy.mjs`) and the server already holds a parsed one, so re-parsing here would be a
 * second gate to keep in agreement with the first.
 */
export function publishRows(leaf: Leaf, policy: PublishPolicy): readonly PublishRow[] {
  return Object.freeze(
    leaf.leaflets.map((l) => ({
      id: l.id as string,
      title: l.title,
      visibility: leafletVisibility(l),
      decision: evaluatePolicy(policy, l),
      outward: outwardStateOf(policy, l),
    })),
  );
}

/**
 * The same, from the raw document — the CLI's entry point.
 *
 * Reports the gate's issues rather than throwing, so `policy.mjs check` on a broken leaf says
 * which document is broken instead of blaming the policy.
 */
export function publishRowsFromDocument(
  raw: unknown,
  policy: PublishPolicy,
):
  | { readonly ok: true; readonly subject: string; readonly rows: readonly PublishRow[] }
  | { readonly ok: false; readonly issues: readonly LeafDocumentIssue[] } {
  const parsed = parseLeafDocument(raw);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  return { ok: true, subject: parsed.leaf.subject, rows: publishRows(parsed.leaf, policy) };
}
