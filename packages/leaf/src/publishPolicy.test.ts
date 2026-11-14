import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PUBLISH_POLICY_DOCUMENT,
  decisionReason,
  defaultPublishPolicy,
  evaluatePolicy,
  isAbsoluteDenial,
  parsePublishPolicy,
  PUBLISH_MATCH_KINDS,
  RATING_SHAPED,
  type PublishDecision,
  type PublishPolicy,
} from "./publishPolicy.ts";
import { leafletId, type Leaflet } from "./leaf.ts";

/**
 * Every policy in this file is a PARSER INPUT or a rule under test, and every leaflet is a
 * probe built to exercise one rule. None of it is portfolio content, and a green suite here
 * proves the rules behave as written — it says nothing about whether any real evidence exists.
 */

const instant = "2026-08-13T00:00:00Z";
const git = { source: "git", ref: "e3b4489", observedAt: instant };

/** Parse a policy document and fail the test loudly if the gate refused it. */
function policyOf(document: unknown): PublishPolicy {
  const parsed = parsePublishPolicy(document);
  assert.equal(parsed.ok, true, `expected a valid policy, got: ${JSON.stringify(parsed)}`);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.policy;
}

function issuesAt(value: unknown): string[] {
  const parsed = parsePublishPolicy(value);
  assert.equal(parsed.ok, false, "expected the policy to be rejected");
  return parsed.ok ? [] : parsed.issues.map((i) => i.at);
}

/** The rule id a decision names, whichever outcome it is — the "which rule?" question. */
function namedRule(decision: PublishDecision): string | null {
  if (decision.outcome === "may-propose") return decision.allowed.rule.id;
  return decision.cause === "denied-by-rule" ? decision.denied.rule.id : null;
}

const verified: Leaflet = {
  id: leafletId("git:e3b4489"),
  title: "Wired the boundary gate into check",
  tier: "verified",
  provenance: git,
};

// ── THE ASYMMETRY ───────────────────────────────────────────────────────────────────────────

test("A DENY RULE BEATS AN ALLOW RULE — even when the allow is written FIRST", () => {
  // The whole safety argument. Under first-match-wins, moving an allow rule to the top of the
  // file would silently disable a rail below it, and reordering a policy would be a way to
  // cause exposure. Deny wins on MATCH, not on position.
  const policy = policyOf({
    rules: [
      {
        id: "share-everything-verified",
        effect: "allow",
        match: { kind: "tier", tier: "verified" },
        reason: "I want my verified work offered for sharing.",
      },
      {
        id: "never-that-commit",
        effect: "deny",
        match: { kind: "evidence-ref", ref: "e3b4489" },
        reason: "That change touched a client's private repository.",
      },
    ],
  });

  const decision = evaluatePolicy(policy, verified);
  assert.equal(decision.outcome, "denied");
  assert.equal(namedRule(decision), "never-that-commit");
  assert.equal(isAbsoluteDenial(decision), true);
});

test("a denial NAMES THE ALLOW RULES IT OVERRODE, so the subject's own rule is not silently ignored", () => {
  const policy = policyOf({
    rules: [
      {
        id: "share-my-photos",
        effect: "allow",
        match: { kind: "id-prefix", prefix: "photo:" },
        reason: "Photographs of my own work are mine to show.",
      },
      {
        id: "share-verified",
        effect: "allow",
        match: { kind: "tier", tier: "verified" },
        reason: "Verified work may be offered.",
      },
      {
        id: "no-ratings",
        effect: "deny",
        match: { kind: "title-rating-shaped" },
        reason: "No number that reads like a rating goes outward.",
      },
    ],
  });

  const rated: Leaflet = {
    id: leafletId("photo:af31"),
    title: "Kitchen remodel, rated 4.5/5 by the client",
    tier: "verified",
    provenance: { source: "photo", ref: "af31", observedAt: instant },
  };

  const decision = evaluatePolicy(policy, rated);
  assert.equal(decision.outcome, "denied");
  if (decision.outcome !== "denied" || decision.cause !== "denied-by-rule") return;
  assert.equal(decision.denied.rule.id, "no-ratings");
  assert.deepEqual(
    decision.overrode.map((m) => m.rule.id),
    ["share-my-photos", "share-verified"],
    "both allow rules matched and both lost; a subject is owed the collision, not a flat no",
  );
});

test("AN ALLOW RULE ONLY PROPOSES — no outcome in this module means published", () => {
  const policy = policyOf({
    rules: [
      {
        id: "share-verified",
        effect: "allow",
        match: { kind: "tier", tier: "verified" },
        reason: "Verified work may be offered to me as a candidate.",
      },
    ],
  });
  const decision = evaluatePolicy(policy, verified);
  assert.equal(decision.outcome, "may-propose");
  // The vocabulary itself refuses the mistake: there is no "published"/"public"/"allowed: true"
  // to read off a decision, so a caller cannot skip the person by mistake.
  assert.deepEqual(
    Object.keys(decision).sort(),
    ["allowed", "outcome"],
    "a permitting decision carries the rule and nothing that reads like permission",
  );
});

test("AN UNMATCHED LEAFLET IS DENIED — fail closed, with the cause named rather than implied", () => {
  const policy = policyOf({
    rules: [
      {
        id: "share-my-photos",
        effect: "allow",
        match: { kind: "id-prefix", prefix: "photo:" },
        reason: "Photographs of my own work are mine to show.",
      },
    ],
  });
  const decision = evaluatePolicy(policy, verified);
  assert.equal(decision.outcome, "denied");
  if (decision.outcome !== "denied") return;
  assert.equal(decision.cause, "no-rule-matched");
  assert.match(decisionReason(decision), /NOT published/);
  assert.match(decisionReason(decision), /Add an allow rule/, "it names the remedy");
});

test("AN EMPTY POLICY IS VALID and proposes nothing — the honest state of a policy nobody wrote", () => {
  const policy = policyOf({ rules: [] });
  assert.deepEqual(policy.rules, []);
  const decision = evaluatePolicy(policy, verified);
  assert.equal(decision.outcome, "denied");
  if (decision.outcome !== "denied") return;
  assert.equal(decision.cause, "no-rule-matched");
  // And it is NOT the absolute rail: an empty policy must not retroactively un-publish
  // something the subject shared by hand before it existed.
  assert.equal(isAbsoluteDenial(decision), false);
});

test("FAIL-CLOSED IS NOT THE RAIL, AND AN EXPLICIT DENY IS — the two denials are distinguishable", () => {
  // Both are "denied". Only one may override a person's own act, and a caller that cannot tell
  // them apart either leaks (treats the rail as advisory) or erases (treats silence as a veto).
  const denying = policyOf({
    rules: [
      {
        id: "no-excluded",
        effect: "deny",
        match: { kind: "tier", tier: "excluded" },
        reason: "Somebody else's work.",
      },
    ],
  });
  const excluded: Leaflet = {
    id: leafletId("git:9c1"),
    title: "Vendored dependency bump",
    tier: "excluded",
    reason: "authored by another contributor under a different address",
    provenance: { source: "git", ref: "9c1", observedAt: instant },
  };
  assert.equal(isAbsoluteDenial(evaluatePolicy(denying, excluded)), true);
  assert.equal(isAbsoluteDenial(evaluatePolicy(denying, verified)), false);
});

test("A RULE'S REASON TRAVELS WITH ITS DECISION, verbatim", () => {
  // "Why is this one private?" has to be answerable from the decision alone, in the words the
  // rule's author wrote — not a paraphrase this module invents and not a rule id.
  const written = "That client's repository is under NDA until the launch.";
  const policy = policyOf({
    rules: [
      {
        id: "nda-until-launch",
        effect: "deny",
        match: { kind: "evidence-source", source: "git" },
        reason: written,
      },
    ],
  });
  const decision = evaluatePolicy(policy, verified);
  assert.equal(decisionReason(decision), written);
  if (decision.outcome !== "denied" || decision.cause !== "denied-by-rule") return;
  assert.equal(decision.denied.rule.reason, written);
  assert.equal(decision.denied.index, 0, "the decision says WHERE in the document the rule sits");
});

// ── EACH MATCH KIND, ON A LEAFLET THAT EXHIBITS IT ──────────────────────────────────────────

/** One deny rule of the given match, so each kind can be exercised through the real evaluator. */
function denyOn(match: unknown): PublishPolicy {
  return policyOf({
    rules: [{ id: "under-test", effect: "deny", match, reason: "the rule under test" }],
  });
}

test("tier matches by equality and never by rank", () => {
  const policy = denyOn({ kind: "tier", tier: "pending" });
  const pending: Leaflet = { id: leafletId("p"), title: "Attributable, not proven", tier: "pending" };
  assert.equal(namedRule(evaluatePolicy(policy, pending)), "under-test");
  // `verified` is not "above" `pending`; a rule naming one says nothing about the other.
  assert.equal(namedRule(evaluatePolicy(policy, verified)), null);
});

test("evidence-source reads the leaflet's OWN provenance and EVERY body element", () => {
  // The seam where six real refs were dropped once already: a leaflet carrying seven refs must
  // not walk past a rail that refuses one of them.
  const policy = denyOn({ kind: "evidence-source", source: "photo" });
  const mixed: Leaflet = {
    id: leafletId("photosynthesis:cluster-1"),
    title: "Rebuilt the intake path",
    tier: "pending",
    provenance: git,
    body: [
      { provenance: git },
      { provenance: { source: "photo", ref: "af31", observedAt: instant } },
    ],
  };
  assert.equal(namedRule(evaluatePolicy(policy, mixed)), "under-test");

  const gitOnly: Leaflet = { ...mixed, body: [{ provenance: git }] };
  assert.equal(namedRule(evaluatePolicy(policy, gitOnly)), null);
});

test("evidence-source-segment matches the MARK inside a source, not the whole string", () => {
  // `brain-note:third-party` marks material about other people. Matching whole strings would
  // need one rule per light source and would miss the next one.
  const policy = denyOn({ kind: "evidence-source-segment", segment: "third-party" });
  const aboutSomeoneElse: Leaflet = {
    id: leafletId("brain-note:people-dana"),
    title: "Notes from the vendor review",
    tier: "pending",
    provenance: { source: "brain-note:third-party", ref: "people/dana", observedAt: instant },
  };
  assert.equal(namedRule(evaluatePolicy(policy, aboutSomeoneElse)), "under-test");

  const ownNote: Leaflet = {
    ...aboutSomeoneElse,
    provenance: { source: "brain-note", ref: "projects/foliage", observedAt: instant },
  };
  assert.equal(namedRule(evaluatePolicy(policy, ownNote)), null);
  // And it is a SEGMENT, not a substring: "brain-notes-third-party-ish" is a different source.
  const lookalike: Leaflet = {
    ...aboutSomeoneElse,
    provenance: { source: "third-party-ish", ref: "x", observedAt: instant },
  };
  assert.equal(namedRule(evaluatePolicy(policy, lookalike)), null);
});

test("evidence-ref names one specific artifact — the subject saying 'not that one'", () => {
  const policy = denyOn({ kind: "evidence-ref", ref: "e3b4489" });
  assert.equal(namedRule(evaluatePolicy(policy, verified)), "under-test");
  const other: Leaflet = { ...verified, provenance: { ...git, ref: "aaaa111" } };
  assert.equal(namedRule(evaluatePolicy(policy, other)), null);
});

test("id-prefix matches the namespace intake writes into the id", () => {
  const policy = denyOn({ kind: "id-prefix", prefix: "photo:" });
  const photo: Leaflet = {
    id: leafletId("photo:af31"),
    title: "Bench, finished",
    tier: "pending",
    provenance: { source: "photo", ref: "af31", observedAt: instant },
  };
  assert.equal(namedRule(evaluatePolicy(policy, photo)), "under-test");
  assert.equal(namedRule(evaluatePolicy(policy, verified)), null);
});

test("title-rating-shaped refuses ratings while admitting factual engineering numbers", () => {
  const policy = denyOn({ kind: "title-rating-shaped" });
  const titled = (title: string): Leaflet => ({ ...verified, title });

  for (const title of [
    "Redesign, 4.5/5 from the client",
    "Scored 9 out of 10 in review",
    "5 stars on the internal survey",
    "Rated my engineering ability at 40%",
    "Candidate is 40%",
    "Placed in the top 1% of contributors",
    "My skills score: 80 percent",
  ]) {
    assert.equal(namedRule(evaluatePolicy(policy, titled(title))), "under-test", title);
  }

  // Counts, status codes, proportions and measured improvements are work facts. The same
  // syntax cannot make them a score of the builder without rating context.
  for (const title of [
    "cleanup: 7 commits",
    "Wired the boundary gate into check",
    "intake: 1930 commits read",
    "HTTP 409/500 split for unreadable documents",
    "2/3 checks passed after the migration",
    "Cut p99 latency by 40% on the read replica",
    "40% of tests passed after the migration",
    "Reduced failed requests by 40 percent",
    "Added a score normalizer and a 40% faster ranking pass",
    "9 out of 10 requests completed",
    "9/10 API checks passed",
    "Top 1% of slowest requests were retried",
  ]) {
    assert.equal(namedRule(evaluatePolicy(policy, titled(title))), null, title);
  }
});

test("the rating regex is stateless — the same title answers the same way every time", () => {
  // A /g flag here would make `test` carry `lastIndex` between calls, so the SECOND leaflet with
  // a rating in its title would sail past the rail. Pinned because it is invisible when wrong.
  const title = "Redesign, 4.5/5 from the client";
  assert.equal(RATING_SHAPED.test(title), true);
  assert.equal(RATING_SHAPED.test(title), true);
  assert.equal(RATING_SHAPED.global, false);
});

test("no-evidence matches a title with nothing behind it, and nothing else", () => {
  const policy = denyOn({ kind: "no-evidence" });
  const bare: Leaflet = { id: leafletId("p"), title: "Led the migration", tier: "pending" };
  assert.equal(namedRule(evaluatePolicy(policy, bare)), "under-test");
  assert.equal(namedRule(evaluatePolicy(policy, verified)), null);
  // A body element with a ref and no words is evidence — an honest listing, not an absence.
  const bodyOnly: Leaflet = { ...bare, body: [{ provenance: git }] };
  assert.equal(namedRule(evaluatePolicy(policy, bodyOnly)), null);
});

test("every match kind in the vocabulary is exercised above", () => {
  // The gap this closes: adding a kind to the union, forgetting its test, and shipping a rule
  // that silently never fires. The list is the source of truth, so this fails when it grows.
  assert.deepEqual(
    [...PUBLISH_MATCH_KINDS].sort(),
    [
      "evidence-ref",
      "evidence-source",
      "evidence-source-segment",
      "id-prefix",
      "no-evidence",
      "tier",
      "title-rating-shaped",
    ],
    "a new match kind needs a rule test above before this list may change",
  );
});

// ── THE DEFAULT POLICY, RULE BY RULE ────────────────────────────────────────────────────────

test("THE DEFAULT POLICY IS DATA, and it passes the same gate as anyone's file", () => {
  const parsed = defaultPublishPolicy();
  assert.equal(parsed.ok, true, `the shipped default must parse: ${JSON.stringify(parsed)}`);
  if (!parsed.ok) return;
  assert.deepEqual(
    parsed.policy.rules.map((r) => `${r.effect} ${r.id}`),
    [
      "deny deny-excluded",
      "deny deny-third-party-evidence",
      "deny deny-rating-shaped-title",
      "deny deny-no-evidence",
      "allow propose-verified",
    ],
    "four rails and one proposal — the conservative shape, pinned so a widening is visible",
  );
  assert.ok(
    parsed.policy.rules.every((r) => r.reason.trim().length > 0),
    "every rule states why it exists",
  );
});

test("the default document is frozen all the way down — nobody can edit everyone's rails", () => {
  const document = DEFAULT_PUBLISH_POLICY_DOCUMENT as { rules: { reason: string }[] };
  assert.ok(Object.isFrozen(document));
  assert.ok(Object.isFrozen(document.rules));
  assert.ok(document.rules.every((r) => Object.isFrozen(r)));
});

test("DEFAULT: an excluded leaflet is never published — it is somebody else's work", () => {
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  const excluded: Leaflet = {
    id: leafletId("git:9c1e"),
    title: "Bumped the vendored dependency",
    tier: "excluded",
    reason: "authored by another contributor under a different address",
    provenance: { source: "git", ref: "9c1e", observedAt: instant },
  };
  const decision = evaluatePolicy(policy, excluded);
  assert.equal(namedRule(decision), "deny-excluded");
  assert.equal(isAbsoluteDenial(decision), true, "the rail blocks even a hand-shared leaflet");
  assert.match(decisionReason(decision), /somebody else's/);
});

test("DEFAULT: third-party-shaped evidence is never published, even under a verified leaflet", () => {
  // The exposure this refuses is not the subject's: it is the person the note is ABOUT, who
  // never agreed to be in this portfolio and cannot see it to object.
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  const aboutSomeoneElse: Leaflet = {
    id: leafletId("git:cc21"),
    title: "Wrote the vendor review summary",
    tier: "verified",
    provenance: git,
    body: [
      { provenance: git },
      {
        provenance: {
          source: "brain-note:third-party",
          ref: "meetings/2026-05-vendor-review",
          observedAt: instant,
        },
      },
    ],
  };
  const decision = evaluatePolicy(policy, aboutSomeoneElse);
  assert.equal(namedRule(decision), "deny-third-party-evidence");
  if (decision.outcome !== "denied" || decision.cause !== "denied-by-rule") return;
  assert.deepEqual(
    decision.overrode.map((m) => m.rule.id),
    ["propose-verified"],
    "the tier allow matched and the rail beat it — the asymmetry, on the shipped default",
  );
});

test("DEFAULT: a rating-shaped title is never published, whatever tier it carries", () => {
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  const rated: Leaflet = { ...verified, title: "Rebuilt onboarding — 9 out of 10 in the survey" };
  const decision = evaluatePolicy(policy, rated);
  assert.equal(namedRule(decision), "deny-rating-shaped-title");
  assert.match(decisionReason(decision), /never shows a score/);
});

test("DEFAULT: measured engineering work is eligible when evidence and owner sharing permit it", () => {
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  for (const title of ["HTTP 409/500 split", "Cut p99 by 40%", "2/3 checks passed"]) {
    const decision = evaluatePolicy(policy, { ...verified, title });
    assert.equal(decision.outcome, "may-propose", title);
  }
});

test("DEFAULT: a leaflet with no evidence is never published, even if the subject shares it", () => {
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  const bare: Leaflet = {
    id: leafletId("hand:1"),
    title: "Led the platform migration",
    tier: "pending",
    visibility: "public",
  };
  const decision = evaluatePolicy(policy, bare);
  assert.equal(namedRule(decision), "deny-no-evidence");
  assert.equal(isAbsoluteDenial(decision), true);
});

test("DEFAULT: a verified leaflet is PROPOSED, and proposing is all it is", () => {
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  const decision = evaluatePolicy(policy, verified);
  assert.equal(decision.outcome, "may-propose");
  assert.equal(namedRule(decision), "propose-verified");
  assert.match(decisionReason(decision), /never publishes/);
});

test("DEFAULT: a pending leaflet is denied by fail-closed default, not by a rail", () => {
  // Nothing in the default proposes `pending`: attributable is not proven. It is withheld
  // rather than refused, and the difference is legible in the cause.
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  const pending: Leaflet = {
    id: leafletId("git:aaaa111"),
    title: "Refactored the extractor",
    tier: "pending",
    provenance: { ...git, ref: "aaaa111" },
  };
  const decision = evaluatePolicy(policy, pending);
  assert.equal(decision.outcome, "denied");
  if (decision.outcome !== "denied") return;
  assert.equal(decision.cause, "no-rule-matched");
  assert.equal(isAbsoluteDenial(decision), false);
});

test("DEFAULT: the only thing it proposes is the tier the product already publishes as a claim", () => {
  // The conservative claim, checked rather than asserted: across one leaflet of every tier,
  // exactly one is proposed.
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  const oneOfEach: Leaflet[] = [
    verified,
    { id: leafletId("b"), title: "Attributable, not proven", tier: "pending", provenance: git },
    {
      id: leafletId("c"),
      title: "Somebody else's commit",
      tier: "excluded",
      reason: "different author identity",
      provenance: git,
    },
  ];
  assert.deepEqual(
    oneOfEach.map((l) => evaluatePolicy(policy, l).outcome),
    ["may-propose", "denied", "denied"],
  );
});

// ── THE PARSER ──────────────────────────────────────────────────────────────────────────────

test("a score-shaped key is refused BY NAME, and the message says a weight would be a score", () => {
  const parsed = parsePublishPolicy({
    rules: [
      {
        id: "r",
        effect: "allow",
        match: { kind: "tier", tier: "verified" },
        reason: "why",
        weight: 0.8,
      },
    ],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "rules[0].weight");
  assert.ok(issue, "expected the refusal to name the key's location");
  assert.match(issue.message, /refused by name/);
  assert.match(issue.message, /a score deciding what a person may show/);
});

test("a score-shaped key is refused INSIDE a match too — the gate reaches every level", () => {
  assert.deepEqual(
    issuesAt({
      rules: [
        {
          id: "r",
          effect: "allow",
          match: { kind: "tier", tier: "verified", confidence: 0.9 },
          reason: "why",
        },
      ],
    }),
    ["rules[0].match.confidence"],
  );
});

test("an unknown key is refused rather than ignored, at every level", () => {
  assert.deepEqual(issuesAt({ rules: [], name: "my policy" }), ["name"]);
  assert.deepEqual(
    issuesAt({
      rules: [
        { id: "r", effect: "allow", match: { kind: "tier", tier: "verified" }, reason: "w", note: "x" },
      ],
    }),
    ["rules[0].note"],
  );
  // A `tier` match carrying a `prefix` is a rule whose author believed something the evaluator
  // ignores — refused, so the policy cannot stop meaning what its author read.
  assert.deepEqual(
    issuesAt({
      rules: [
        {
          id: "r",
          effect: "deny",
          match: { kind: "tier", tier: "verified", prefix: "photo:" },
          reason: "w",
        },
      ],
    }),
    ["rules[0].match.prefix"],
  );
});

test("an unknown match kind is refused, and the message says the vocabulary is closed", () => {
  const parsed = parsePublishPolicy({
    rules: [{ id: "r", effect: "deny", match: { kind: "looks-sensitive" }, reason: "w" }],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "rules[0].match.kind");
  assert.ok(issue);
  assert.match(issue.message, /Nothing here consults a model/);
});

test("a rule with no reason is refused — a rule that cannot explain itself cannot be argued with", () => {
  assert.deepEqual(
    issuesAt({ rules: [{ id: "r", effect: "deny", match: { kind: "no-evidence" } }] }),
    ["rules[0].reason"],
  );
});

test("a rule with no id is refused — a rule nobody can name is a rule nobody can remove", () => {
  assert.deepEqual(
    issuesAt({ rules: [{ effect: "deny", match: { kind: "no-evidence" }, reason: "w" }] }),
    ["rules[0].id"],
  );
});

test("an unknown effect is refused, and the message states the asymmetry", () => {
  const parsed = parsePublishPolicy({
    rules: [{ id: "r", effect: "publish", match: { kind: "no-evidence" }, reason: "w" }],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "rules[0].effect");
  assert.ok(issue);
  assert.match(issue.message, /"allow" only proposes/);
});

test("a rule with no match is refused, and every problem is reported in one pass", () => {
  // The parser reports the complete list, exactly like parseLeafDocument: a person editing a
  // policy fixes it in one pass rather than one error at a time.
  assert.deepEqual(issuesAt({ rules: [{ id: "r", effect: "sometimes" }] }).sort(), [
    "rules[0].effect",
    "rules[0].match",
    "rules[0].reason",
  ]);
});

test("a segment containing a colon is refused — it is a segment, not a source", () => {
  assert.deepEqual(
    issuesAt({
      rules: [
        {
          id: "r",
          effect: "deny",
          match: { kind: "evidence-source-segment", segment: "brain-note:third-party" },
          reason: "w",
        },
      ],
    }),
    ["rules[0].match.segment"],
  );
});

test("a missing rules field is refused, and says an empty array is how to say empty", () => {
  const parsed = parsePublishPolicy({});
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  const issue = parsed.issues.find((i) => i.at === "rules");
  assert.ok(issue);
  assert.match(issue.message, /empty array \[\] is valid/);
  assert.match(issue.message, /not the same as/);
});

test("a duplicate rule id is refused — 'remove that rule' must name exactly one", () => {
  assert.deepEqual(
    issuesAt({
      rules: [
        { id: "same", effect: "deny", match: { kind: "no-evidence" }, reason: "a" },
        { id: "same", effect: "allow", match: { kind: "tier", tier: "verified" }, reason: "b" },
      ],
    }),
    ["rules[1].id"],
  );
});

test("a non-object document is refused without throwing, whatever it is", () => {
  for (const value of [null, undefined, 7, "rules", [], true]) {
    const parsed = parsePublishPolicy(value);
    assert.equal(parsed.ok, false, JSON.stringify(value) ?? "undefined");
    if (parsed.ok) continue;
    assert.equal(parsed.issues[0]?.at, "(document)");
  }
});

test("A HALF-VALID POLICY IS REFUSED WHOLE — half a policy silently applied could be missing a rail", () => {
  const parsed = parsePublishPolicy({
    rules: [
      {
        id: "deny-excluded",
        effect: "deny",
        match: { kind: "tier", tier: "excluded" },
        reason: "somebody else's work",
      },
      { id: "broken", effect: "deny", match: { kind: "tier", tier: "excellent" }, reason: "w" },
    ],
  });
  assert.equal(parsed.ok, false, "one bad rule rejects the document rather than being dropped");
});

test("the parsed policy is frozen, rules and all", () => {
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.rules));
  assert.ok(policy.rules.every((r) => Object.isFrozen(r) && Object.isFrozen(r.match)));
});

test("NO DECISION AND NO RULE CARRIES A NUMBER THAT COULD BE READ AS A SCORE", () => {
  // The FCRA posture at this API surface. The only numeric field a decision may carry is a
  // rule's POSITION in the document, which is an address and not a magnitude.
  const policy = policyOf(DEFAULT_PUBLISH_POLICY_DOCUMENT);
  const decisions = [
    evaluatePolicy(policy, verified),
    evaluatePolicy(policy, { id: leafletId("p"), title: "bare", tier: "pending" }),
  ];
  for (const decision of decisions) {
    const numeric = Object.entries(decision as unknown as Record<string, unknown>).filter(
      ([, v]) => typeof v === "number",
    );
    assert.deepEqual(numeric, [], "a decision itself is never numeric");
  }
  for (const rule of policy.rules) {
    const numeric = Object.entries(rule as unknown as Record<string, unknown>).filter(
      ([, v]) => typeof v === "number",
    );
    assert.deepEqual(numeric.map(([k]) => k), [], "a rule has no weight, priority or strength");
  }
});
