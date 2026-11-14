import { test } from "node:test";
import assert from "node:assert/strict";

import { NON_PUBLIC_STATES, isPublic } from "@foliage/enterprise-policy";
import { parseHarvestDocument } from "@foliage/photosynthesis";
import { SCORE_SHAPED } from "@foliage/leaf";

import { RELEASE_STATES, parseEnterpriseDocument } from "./artifactDocument.ts";
import { UNREVIEWED_RELEASE_STATES } from "./reviewGate.ts";

/**
 * Every document in this file is a PARSER INPUT, not portfolio content: each one exists to pin
 * a specific accept/reject decision, and the ids are placeholders rather than any real company,
 * team or person. A passing suite proves the format is enforced — it does not imply that any
 * company's evidence has ever been read.
 */

const instant = "2026-08-16T00:00:00Z";
const evidence = [{ source: "git", ref: "e3b4489", observedAt: instant }];

const membership = (branch = "billing-core", bough = "payments") => ({
  tree: "acme",
  bough,
  branch,
});

const branchSubject = (branch = "billing-core", bough = "payments") => ({
  kind: "branch",
  tree: "acme",
  bough,
  branch,
});

const personSubject = (
  leaf: string,
  branches: readonly Record<string, unknown>[] = [membership()],
) => ({ kind: "leaf", tree: "acme", leaf, branches });

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "parser-input:branch-artifact",
    title: "parser input: a branch artifact",
    subject: branchSubject(),
    contributors: [],
    evidence,
    extractor: "git-cluster",
    draftedAt: instant,
    review: { state: "candidate" },
    release: "internal",
    ...overrides,
  };
}

/**
 * A reviewed draft, for the artifacts that assert a release state past `internal`: those states
 * are reachable only through a review, so a test input claiming one has to carry it.
 */
const APPROVED_REVIEW = {
  state: "approved",
  by: "a-reviewer",
  role: "policy_owner",
  at: instant,
} as const;

const REJECTED_REVIEW = {
  state: "rejected",
  by: "a-reviewer",
  role: "policy_owner",
  at: instant,
  reason: "names a customer by name",
} as const;

function issuesAt(value: unknown): string[] {
  const parsed = parseEnterpriseDocument(value);
  assert.equal(parsed.ok, false, "expected the document to be rejected");
  return parsed.ok ? [] : parsed.issues.map((i) => i.at);
}

function messageAt(value: unknown, at: string): string {
  const parsed = parseEnterpriseDocument(value);
  assert.equal(parsed.ok, false, "expected the document to be rejected");
  if (parsed.ok) return "";
  const issue = parsed.issues.find((i) => i.at === at);
  assert.ok(issue, `expected an issue at ${at}, got ${parsed.issues.map((i) => i.at).join(", ")}`);
  return issue.message;
}

test("a well-formed document parses at every subject level", () => {
  const parsed = parseEnterpriseDocument({
    artifacts: [
      artifact({ id: "tree-level", subject: { kind: "tree", tree: "acme" } }),
      artifact({
        id: "bough-level",
        subject: { kind: "bough", tree: "acme", bough: "payments" },
      }),
      artifact({ id: "branch-level", subject: branchSubject() }),
      artifact({ id: "person-level", subject: personSubject("a-person") }),
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(
    parsed.document.artifacts.map((a) => a.subject.kind),
    ["tree", "bough", "branch", "leaf"],
  );
  assert.ok(Object.isFrozen(parsed.document));
  assert.ok(Object.isFrozen(parsed.document.artifacts[0]));
});

test("AN EMPTY artifacts ARRAY IS VALID — an empty portfolio is not a missing one", () => {
  const parsed = parseEnterpriseDocument({ artifacts: [] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.artifacts.length, 0);
});

test("AN EMPTY contributors ARRAY IS VALID — a branch artifact belongs to no one person", () => {
  const parsed = parseEnterpriseDocument({ artifacts: [artifact({ contributors: [] })] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.document.artifacts[0]!.contributors, []);

  // ...but the field being ABSENT is a different fact and is refused.
  const absent = artifact();
  delete absent["contributors"];
  assert.deepEqual(issuesAt({ artifacts: [absent] }), ["artifacts[0].contributors"]);
});

test("an unknown field is refused so a misspelling cannot become an invisible omission", () => {
  assert.deepEqual(issuesAt({ artifacts: [], extras: true }), ["extras"]);
  assert.deepEqual(issuesAt({ artifacts: [artifact({ draftedBy: "who" })] }), [
    "artifacts[0].draftedBy",
  ]);
  assert.deepEqual(issuesAt({ artifacts: [artifact({ subject: { ...branchSubject(), squad: "x" } })] }), [
    "artifacts[0].subject.squad",
  ]);
});

test("a key that belongs to another subject kind is refused, not silently carried", () => {
  // `branch` on a bough subject would be attached, never read, and wrong about ownership.
  assert.deepEqual(
    issuesAt({
      artifacts: [
        artifact({
          subject: { kind: "bough", tree: "acme", bough: "payments", branch: "billing-core" },
        }),
      ],
    }),
    ["artifacts[0].subject.branch"],
  );
});

test("EACH score-family key is refused BY NAME, wherever it is attached", () => {
  for (const key of ["confidence", "score", "rating", "rank", "percentile", "weight"]) {
    const parsed = parseEnterpriseDocument({ artifacts: [artifact({ [key]: 0.9 })] });
    assert.equal(parsed.ok, false, `expected "${key}" to be refused`);
    if (parsed.ok) continue;
    const issue = parsed.issues.find((i) => i.at === `artifacts[0].${key}`);
    assert.ok(issue, `expected an issue at artifacts[0].${key}`);
    assert.match(issue.message, /refused by name/, key);
  }
});

test("the score refusal list is @foliage/leaf's — one list, three gates, no drift", () => {
  for (const key of SCORE_SHAPED) {
    const parsed = parseEnterpriseDocument({ artifacts: [], [key]: 1 });
    assert.equal(parsed.ok, false, `"${key}" must be refused at the document level`);
    if (parsed.ok) continue;
    assert.match(parsed.issues[0]!.message, /refused by name/, key);
  }
});

test("a score-shaped key is refused on a CONTRIBUTOR too — the most dangerous place for one", () => {
  const message = messageAt(
    {
      artifacts: [
        artifact({
          contributors: [{ subject: personSubject("a-person"), evidence, score: 7 }],
        }),
      ],
    },
    "artifacts[0].contributors[0].score",
  );
  assert.match(message, /refused by name/);
  assert.match(message, /least of all one attached to a person/);
});

test("an artifact with no evidence cannot exist — empty and absent are both refused", () => {
  assert.deepEqual(issuesAt({ artifacts: [artifact({ evidence: [] })] }), [
    "artifacts[0].evidence",
  ]);
  const absent = artifact();
  delete absent["evidence"];
  assert.deepEqual(issuesAt({ artifacts: [absent] }), ["artifacts[0].evidence"]);
});

test("evidence refs are held to Provenance's rules: observedAt needs an offset", () => {
  assert.deepEqual(
    issuesAt({
      artifacts: [
        artifact({ evidence: [{ source: "git", ref: "abc", observedAt: "2026-08-16" }] }),
      ],
    }),
    ["artifacts[0].evidence[0].observedAt"],
  );
});

test("a named contributor with no evidence is refused — that would be an unsourced assertion", () => {
  const message = messageAt(
    { artifacts: [artifact({ contributors: [{ subject: personSubject("a-person"), evidence: [] }] })] },
    "artifacts[0].contributors[0].evidence",
  );
  assert.match(message, /unsourced assertion about a person/);
});

test("A CONTRIBUTOR OUTSIDE THE SUBJECT IS REFUSED, with the containment reason", () => {
  const outsider = personSubject("a-person", [membership("ledgering", "platform")]);
  const message = messageAt(
    { artifacts: [artifact({ contributors: [{ subject: outsider, evidence }] })] },
    "artifacts[0].contributors[0].subject",
  );
  assert.match(message, /not a recorded member of branch "billing-core"/);
  assert.match(message, /may only name contributors/);
});

test("a contributor on another tree is refused — containment never crosses one", () => {
  const foreign = {
    kind: "leaf",
    tree: "other-co",
    leaf: "a-person",
    branches: [],
  };
  const message = messageAt(
    { artifacts: [artifact({ contributors: [{ subject: foreign, evidence }] })] },
    "artifacts[0].contributors[0].subject",
  );
  assert.match(message, /never crosses a tree boundary/);
});

test("a branch membership naming a different tree than the person is refused", () => {
  const message = messageAt(
    {
      artifacts: [
        artifact({
          subject: {
            kind: "leaf",
            tree: "acme",
            leaf: "a-person",
            branches: [{ tree: "other-co", bough: "payments", branch: "billing-core" }],
          },
        }),
      ],
    },
    "artifacts[0].subject.branches[0].tree",
  );
  assert.match(message, /tenancy boundary/);
});

test("a contributor that is not a person is refused", () => {
  const message = messageAt(
    { artifacts: [artifact({ contributors: [{ subject: branchSubject(), evidence }] })] },
    "artifacts[0].contributors[0].subject.kind",
  );
  assert.match(message, /a contributor is a person/);
});

test("a person's own artifact may name that same person as a contributor", () => {
  const parsed = parseEnterpriseDocument({
    artifacts: [
      artifact({
        subject: personSubject("a-person"),
        contributors: [{ subject: personSubject("a-person"), evidence }],
      }),
    ],
  });
  assert.equal(parsed.ok, true, parsed.ok ? "" : JSON.stringify(parsed.issues));
});

test("the same person twice on one artifact is refused — it would read as twice the work", () => {
  const message = messageAt(
    {
      artifacts: [
        artifact({
          contributors: [
            { subject: personSubject("a-person"), evidence },
            { subject: personSubject("a-person"), evidence },
          ],
        }),
      ],
    },
    "artifacts[0].contributors[1].subject",
  );
  assert.match(message, /already named on this artifact/);
});

test("REJECTED WITHOUT A REASON is refused — a rejection may not be a silent disappearance", () => {
  const message = messageAt(
    {
      artifacts: [
        artifact({ review: { state: "rejected", by: "a-reviewer", role: "policy_owner", at: instant } }),
      ],
    },
    "artifacts[0].review.reason",
  );
  assert.match(message, /requires a reason/);
  assert.match(message, /entitled to read/);
});

test("a review decision must name BOTH the actor and the capacity they acted in", () => {
  assert.deepEqual(
    issuesAt({ artifacts: [artifact({ review: { state: "approved", at: instant } })] }),
    ["artifacts[0].review.by", "artifacts[0].review.role"],
  );
  const message = messageAt(
    {
      artifacts: [
        artifact({ review: { state: "approved", by: "a-reviewer", role: "manager", at: instant } }),
      ],
    },
    "artifacts[0].review.role",
  );
  assert.match(message, /"subject", "policy_owner", "system"/);
});

test("automation may reject but may never approve — approval is never automatic", () => {
  const message = messageAt(
    {
      artifacts: [
        artifact({ review: { state: "approved", by: "drafter", role: "system", at: instant } }),
      ],
    },
    "artifacts[0].review.role",
  );
  assert.match(message, /may not be approved by "system"/);

  const rejected = parseEnterpriseDocument({
    artifacts: [
      artifact({
        review: {
          state: "rejected",
          by: "policy-scanner",
          role: "system",
          at: instant,
          reason: "names a customer",
        },
      }),
    ],
  });
  assert.equal(rejected.ok, true, "a system rejection keeps an artifact in, and is allowed");
});

test("`reason` on an approved review is refused rather than carried and never shown", () => {
  assert.deepEqual(
    issuesAt({
      artifacts: [
        artifact({
          review: { state: "approved", by: "r", role: "policy_owner", at: instant, reason: "stray" },
        }),
      ],
    }),
    ["artifacts[0].review.reason"],
  );
});

test("an unreviewed artifact says so explicitly; an absent review is refused", () => {
  const absent = artifact();
  delete absent["review"];
  const message = messageAt({ artifacts: [absent] }, "artifacts[0].review");
  assert.match(message, /explicitly unreviewed, not silently unstated/);
});

test("the release states are the policy machine's own, and approved is NOT public", () => {
  // Derived, not re-listed: every state the policy declares is accepted here — of an artifact
  // whose draft a person actually approved, which is the only artifact that could have got there.
  for (const state of RELEASE_STATES) {
    const parsed = parseEnterpriseDocument({
      artifacts: [artifact({ release: state, review: APPROVED_REVIEW })],
    });
    assert.equal(parsed.ok, true, `"${state}" should be an accepted release state`);
  }
  assert.equal(RELEASE_STATES.length, NON_PUBLIC_STATES.length + 1);
  assert.equal(RELEASE_STATES.filter(isPublic).length, 1);

  const message = messageAt({ artifacts: [artifact({ release: "published" })] }, "artifacts[0].release");
  assert.match(message, /never assigned by hand/);
});

test("AN UNREVIEWED DRAFT MAY ONLY BE internal — the end state cannot be asserted", () => {
  // The bypass this closes: the review gate in release.ts refuses to MOVE an unreviewed artifact
  // outward, and a document that simply declared the destination never asked it. `live` +
  // `candidate` parsed clean, isPublic said true, and the ledger counted it as publicly live.
  for (const state of RELEASE_STATES) {
    const parsed = parseEnterpriseDocument({ artifacts: [artifact({ release: state })] });
    const reachable = UNREVIEWED_RELEASE_STATES.has(state);
    assert.equal(
      parsed.ok,
      reachable,
      `"${state}" with an unreviewed draft should be ${reachable ? "accepted" : "refused"}`,
    );
  }
  assert.deepEqual([...UNREVIEWED_RELEASE_STATES], ["internal"]);

  const message = messageAt({ artifacts: [artifact({ release: "live" })] }, "artifacts[0].release");
  assert.match(message, /applyReleaseEvent cannot produce/);
  assert.match(message, /can only be "internal"/);
});

test("live BESIDE A REJECTED REVIEW STAYS VALID — it has to be, so it can be withdrawn", () => {
  // The nuance the pair check must not break: published, then rejected afterwards is a real
  // state, and refusing to represent it would strand a live artifact with no way to pull it.
  for (const state of RELEASE_STATES) {
    for (const review of [APPROVED_REVIEW, REJECTED_REVIEW]) {
      const parsed = parseEnterpriseDocument({ artifacts: [artifact({ release: state, review })] });
      assert.equal(parsed.ok, true, `"${state}" + "${review.state}" must stay representable`);
    }
  }
});

test("the pair check is about the PAIR — each half alone is still judged on its own", () => {
  // A bad release state and an unreviewed draft must not be reported as an unreachable pair:
  // "published" is not a state at all, and saying otherwise would send an editor after the
  // wrong field.
  const message = messageAt({ artifacts: [artifact({ release: "published" })] }, "artifacts[0].release");
  assert.doesNotMatch(message, /cannot produce/);

  // And an unparseable review leaves the release field alone rather than guessing about it.
  assert.deepEqual(issuesAt({ artifacts: [artifact({ release: "live", review: { state: "nope" } })] }), [
    "artifacts[0].review.state",
  ]);
});

test("THE REVIEW VOCABULARY IS THE OPEN PLANE'S, checked against its parser and not just its type", () => {
  // The type is derived with Extract/Exclude; the lists the parser reads were once hand-copied
  // from harvestDocument.ts, where they are module-private. They are generated from the type
  // now, and this drives BOTH REAL PARSERS over the same review values so the claim is a
  // behaviour rather than a comment. `role` is the one key this plane adds, so it is dropped
  // before the same review is offered to the open plane's gate.
  const harvestCandidate = (review: Record<string, unknown>): unknown => ({
    candidates: [
      {
        id: "parser-input:one",
        title: "parser input: a candidate",
        evidence,
        extractor: "git-cluster",
        draftedAt: instant,
        review,
      },
    ],
  });
  const withoutRole = (review: Record<string, unknown>): Record<string, unknown> => {
    const { role: _role, ...rest } = review;
    return rest;
  };

  for (const review of [{ state: "candidate" }, APPROVED_REVIEW, REJECTED_REVIEW]) {
    const here = parseEnterpriseDocument({ artifacts: [artifact({ review })] });
    const there = parseHarvestDocument(harvestCandidate(withoutRole(review)));
    assert.equal(here.ok, true, `this plane must accept "${review.state}"`);
    assert.equal(there.ok, true, `the open plane must accept "${review.state}" too`);
  }

  // A state name neither plane knows, and a key neither plane allows: both must refuse, or the
  // two vocabularies have drifted apart while both still looked fine on their own.
  for (const bad of [{ state: "in_review" }, { ...APPROVED_REVIEW, note: "stray" }]) {
    assert.equal(parseEnterpriseDocument({ artifacts: [artifact({ review: bad })] }).ok, false);
    assert.equal(parseHarvestDocument(harvestCandidate(withoutRole(bad))).ok, false);
  }
});

test("an unknown subject kind is rejected before its other keys are judged", () => {
  assert.deepEqual(
    issuesAt({ artifacts: [artifact({ subject: { kind: "squad", tree: "acme", squad: "x" } })] }),
    ["artifacts[0].subject.kind"],
  );
});

test("a person's branches field is required; an empty array means on no branch", () => {
  const noBranches = parseEnterpriseDocument({
    artifacts: [artifact({ subject: personSubject("a-person", []) })],
  });
  assert.equal(noBranches.ok, true);

  const absent = { kind: "leaf", tree: "acme", leaf: "a-person" };
  const message = messageAt(
    { artifacts: [artifact({ subject: absent })] },
    "artifacts[0].subject.branches",
  );
  assert.match(message, /on no branch/);
});

test("duplicate artifact ids are rejected", () => {
  assert.deepEqual(
    issuesAt({ artifacts: [artifact(), artifact({ title: "parser input: same id" })] }),
    ["artifacts[1].id"],
  );
});

test("one invalid artifact rejects the WHOLE document — no partial success", () => {
  const parsed = parseEnterpriseDocument({
    artifacts: [artifact(), artifact({ id: "bad-one", evidence: [] })],
  });
  assert.equal(parsed.ok, false);
});

test("every issue names a path an editor can find, and every rejection carries at least one", () => {
  const parsed = parseEnterpriseDocument({
    artifacts: [artifact({ id: "", subject: 4, evidence: [], review: { state: "nope" } })],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.ok(parsed.issues.length >= 4);
  for (const issue of parsed.issues) {
    assert.ok(issue.at.trim().length > 0);
    assert.ok(issue.message.trim().length > 0);
  }
});

test("the parser never throws, whatever it is handed", () => {
  for (const input of [null, undefined, 0, "", "a string", [], [1, 2], true, NaN]) {
    const parsed = parseEnterpriseDocument(input);
    assert.equal(parsed.ok, false, `${String(input)} must be rejected, not thrown on`);
    if (!parsed.ok) assert.ok(parsed.issues.length > 0, "a rejection must carry a reason");
  }
});
