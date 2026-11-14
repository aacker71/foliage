import { test } from "node:test";
import assert from "node:assert/strict";

import { isPublic, type Actor, type ReleaseEvent } from "@foliage/enterprise-policy";

import { parseEnterpriseDocument, type EnterpriseArtifact } from "./artifactDocument.ts";
import { applyReleaseEvent } from "./release.ts";

/**
 * Every artifact here is a PARSER INPUT built to pin one release decision. It goes through the
 * real gate first, so the release driver is always tested against exactly the values the
 * product would hand it, and nothing in this file is portfolio content.
 */

const instant = "2026-08-16T00:00:00Z";

function artifactOf(overrides: Record<string, unknown> = {}): EnterpriseArtifact {
  const parsed = parseEnterpriseDocument({
    artifacts: [
      {
        id: "parser-input:branch-artifact",
        title: "parser input: a branch artifact",
        subject: { kind: "branch", tree: "acme", bough: "payments", branch: "billing-core" },
        contributors: [],
        evidence: [{ source: "git", ref: "e3b4489", observedAt: instant }],
        extractor: "git-cluster",
        draftedAt: instant,
        review: { state: "candidate" },
        release: "internal",
        ...overrides,
      },
    ],
  });
  assert.equal(parsed.ok, true, parsed.ok ? "" : JSON.stringify(parsed.issues, null, 2));
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.document.artifacts[0]!;
}

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

function causes(artifact: EnterpriseArtifact, event: ReleaseEvent, actor: Actor): string[] {
  const outcome = applyReleaseEvent(artifact, event, actor);
  assert.equal(outcome.ok, false, `expected ${event} to be refused`);
  return outcome.ok ? [] : outcome.refusals.map((r) => r.cause);
}

test("the happy path reaches live only through review, approval, then publish", () => {
  let artifact = artifactOf({ review: APPROVED_REVIEW });
  for (const [event, actor] of [
    ["propose", "subject"],
    ["open_review", "policy_owner"],
    ["approve", "policy_owner"],
  ] as const) {
    const outcome = applyReleaseEvent(artifact, event, actor);
    assert.ok(outcome.ok, `${event} should be legal: ${outcome.ok ? "" : JSON.stringify(outcome.refusals)}`);
    artifact = outcome.artifact;
  }

  // APPROVED IS NOT PUBLIC. Approval is a company decision; egress is a separate act.
  assert.equal(artifact.release, "approved");
  assert.equal(isPublic(artifact.release), false);

  const published = applyReleaseEvent(artifact, "publish", "subject");
  assert.ok(published.ok);
  assert.equal(published.artifact.release, "live");
  assert.equal(isPublic(published.artifact.release), true);
});

test("AN ILLEGAL TRANSITION IS REFUSED WITH ITS CAUSE", () => {
  const artifact = artifactOf({ review: APPROVED_REVIEW });
  const outcome = applyReleaseEvent(artifact, "publish", "policy_owner");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.refusals.map((r) => r.cause),
    ["policy-refused"],
  );
  assert.match(outcome.refusals[0]!.reason, /not a legal transition from "internal"/);
});

test("a wrong actor and an illegal transition stay DIFFERENT refusals, not one boolean", () => {
  const artifact = artifactOf({ review: APPROVED_REVIEW });
  const illegal = applyReleaseEvent(artifact, "publish", "policy_owner");
  const wrongActor = applyReleaseEvent(artifact, "propose", "policy_owner");
  assert.ok(!illegal.ok && !wrongActor.ok);
  assert.match(wrongActor.refusals[0]!.reason, /not permitted for actor/);
  assert.notEqual(illegal.refusals[0]!.reason, wrongActor.refusals[0]!.reason);
});

test("a refused call never returns an artifact a caller could proceed with", () => {
  const outcome = applyReleaseEvent(artifactOf(), "publish", "policy_owner");
  assert.equal(outcome.ok, false);
  assert.ok(!("artifact" in outcome), "failure must not carry an artifact");
});

test("an UNREVIEWED draft may not be offered outward", () => {
  const outcome = applyReleaseEvent(artifactOf(), "propose", "subject");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.refusals.map((r) => r.cause),
    ["review-not-approved"],
  );
  assert.match(outcome.refusals[0]!.reason, /still "candidate" — unreviewed/);
});

test("a REJECTED draft may not be offered outward, and the refusal quotes the rejection", () => {
  const outcome = applyReleaseEvent(artifactOf({ review: REJECTED_REVIEW }), "propose", "subject");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.refusals[0]!.reason, /rejected by a-reviewer \(policy_owner\)/);
  assert.match(outcome.refusals[0]!.reason, /names a customer by name/);
});

test("publish is gated on review too — a rejection can land after the proposal", () => {
  const approvedState = artifactOf({ review: APPROVED_REVIEW, release: "approved" });
  assert.ok(applyReleaseEvent(approvedState, "publish", "subject").ok);

  // Same release state, review since rejected: the standing licence to publish is gone.
  const sinceRejected = artifactOf({ review: REJECTED_REVIEW, release: "approved" });
  assert.deepEqual(causes(sinceRejected, "publish", "subject"), ["review-not-approved"]);
});

test("BOTH CAUSES ARE REPORTED when both gates refuse", () => {
  // publish from internal is illegal AND the draft is unreviewed. One call, two reasons.
  const outcome = applyReleaseEvent(artifactOf(), "publish", "policy_owner");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.refusals.map((r) => r.cause),
    ["policy-refused", "review-not-approved"],
  );
  for (const refusal of outcome.refusals) assert.ok(refusal.reason.trim().length > 0);
});

test("MOVING BACK IN IS NEVER GATED ON REVIEW — a withdrawal must always be possible", () => {
  // A live artifact whose review was rejected afterwards is exactly the state that needs this.
  const live = artifactOf({ review: REJECTED_REVIEW, release: "live" });
  const withdrawn = applyReleaseEvent(live, "withdraw", "subject");
  assert.ok(withdrawn.ok, withdrawn.ok ? "" : JSON.stringify(withdrawn.refusals));
  assert.equal(withdrawn.artifact.release, "withdrawn");
  assert.equal(isPublic(withdrawn.artifact.release), false);

  const proposed = artifactOf({ review: REJECTED_REVIEW, release: "proposed" });
  assert.ok(applyReleaseEvent(proposed, "retract", "subject").ok);

  const inReview = artifactOf({ review: REJECTED_REVIEW, release: "in_review" });
  assert.ok(applyReleaseEvent(inReview, "reject", "policy_owner").ok);
});

test("approval cannot be self-served by the subject — the policy owns that rule", () => {
  const artifact = artifactOf({ review: APPROVED_REVIEW, release: "in_review" });
  assert.deepEqual(causes(artifact, "approve", "subject"), ["policy-refused"]);
});

test("the input artifact is never mutated, and the result carries the policy's own note", () => {
  const artifact = artifactOf({ review: APPROVED_REVIEW });
  const outcome = applyReleaseEvent(artifact, "propose", "subject");
  assert.ok(outcome.ok);
  assert.equal(artifact.release, "internal", "the input must be untouched");
  assert.equal(outcome.artifact.release, "proposed");
  assert.match(outcome.note, /offer their own leaf outward/);
  assert.ok(Object.isFrozen(outcome.artifact));

  // Everything except the release state travels unchanged.
  assert.deepEqual({ ...outcome.artifact, release: "internal" }, { ...artifact });
});

test("THE POLICY MACHINE, not this gate, is what stops a withdrawn artifact going straight back live", () => {
  // Named for whose rule it is. The refusal below comes entirely from @foliage/enterprise-policy
  // — the draft here is approved, so this package's review gate has nothing to say — and the
  // test would still pass with that gate deleted. It is kept because the seam is worth pinning,
  // and the cause it asserts is the one that proves which package refused.
  const withdrawn = artifactOf({ review: APPROVED_REVIEW, release: "withdrawn" });
  assert.deepEqual(causes(withdrawn, "publish", "subject"), ["policy-refused"]);
  const reproposed = applyReleaseEvent(withdrawn, "propose", "subject");
  assert.ok(reproposed.ok);
  assert.equal(reproposed.artifact.release, "proposed");
});

test("A STALE APPROVAL DOES re-publish a withdrawn artifact, and that is the decided answer", () => {
  // Decided rather than left ambiguous: the draft's review is a statement about the PROSE, and
  // withdrawing an artifact changes not a word of it. The policy machine still forces the whole
  // propose → open_review → approve → publish walk, which is where a fresh decision about
  // RELEASE belongs. Expiring the approval instead would mean knowing whether it predates the
  // withdrawal, and nothing in the format records when a withdrawal happened — inventing that
  // instant to support a stricter-sounding rule would be a fabricated timestamp.
  let artifact = artifactOf({ review: APPROVED_REVIEW, release: "withdrawn" });
  for (const [event, actor] of [
    ["propose", "subject"],
    ["open_review", "policy_owner"],
    ["approve", "policy_owner"],
    ["publish", "subject"],
  ] as const) {
    const outcome = applyReleaseEvent(artifact, event, actor);
    assert.ok(outcome.ok, `${event} should be legal: ${outcome.ok ? "" : JSON.stringify(outcome.refusals)}`);
    artifact = outcome.artifact;
  }
  assert.equal(artifact.release, "live");
  assert.equal(artifact.review.state, "approved");
  if (artifact.review.state !== "approved") return;
  assert.equal(artifact.review.at, instant, "the same approval, never refreshed");
});

test("...and when the CONTENT was the problem, the review gate is what refuses the re-proposal", () => {
  // The path with teeth, and the reason the decision above is safe: a withdrawal caused by the
  // prose is recorded as a rejection, and then the artifact cannot be offered outward again at
  // all — this package's gate, not the policy machine's, which permits propose from withdrawn.
  const withdrawn = artifactOf({ review: REJECTED_REVIEW, release: "withdrawn" });
  assert.deepEqual(causes(withdrawn, "propose", "subject"), ["review-not-approved"]);
});
