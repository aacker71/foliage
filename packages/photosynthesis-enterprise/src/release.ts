/**
 * RELEASE — the one door that moves an artifact's release state, and it opens onto
 * @foliage/enterprise-policy rather than onto a policy of its own.
 *
 * The state machine is NOT reimplemented here and must not be: `applyEvent` owns which
 * transitions are legal, which actor may fire them, and the fact that `approve` and `publish`
 * are separate events — approval is a company decision, egress is a distinct act, and exactly
 * one state (`live`) is public. Everything below drives that machine and reports what it said.
 *
 * ONE RULE IS ADDED, and it belongs here rather than there. The policy machine governs a
 * release; it knows nothing about whether the drafted prose was ever reviewed. An artifact is
 * machine-written until a person reads it, so an UNREVIEWED or REJECTED draft may not be
 * offered outward — `propose` and `publish` are refused unless review is `approved`. Both are
 * gated rather than only `propose`, because a rejection can land after a proposal and the
 * artifact would otherwise sit in `approved` with a standing licence to publish.
 *
 * THIS IS THE TRANSITION DOOR, AND IT IS NOT THE ONLY ONE. Gating the transition does nothing
 * for a document that asserts the end state instead of travelling to it; the parser holds the
 * same rule at the document door. Both read reviewGate.ts so the two cannot drift apart.
 *
 * WHAT THIS GATE DELIBERATELY DOES NOT DO: it does not expire an approval. A withdrawn artifact
 * carrying its original approval can be re-proposed and reach `live` again on that same
 * approval, and that is the chosen answer rather than an oversight. The draft's review is a
 * statement about the PROSE, and withdrawing an artifact does not change a word of it; the
 * policy machine already forces the whole propose → open_review → approve → publish walk again,
 * which is where a re-decision about RELEASE belongs. When the withdrawal happened *because* of
 * the content, the reviewer records that as a rejection and this gate refuses the re-proposal —
 * that is the path with teeth, and release.test.ts pins it. Expiring an approval instead would
 * need to know whether an approval predates a withdrawal, and nothing in the format records
 * when a withdrawal happened; inventing that instant to make a stricter-sounding rule work
 * would be a fabricated timestamp, which is worse than the rule is good.
 *
 * Events that move an artifact BACK IN — `retract`, `reject`, `withdraw` — are never gated on
 * review. Pulling something down must always be possible; a gate that could block a withdrawal
 * would be a safety failure wearing a policy costume.
 *
 * BOTH CAUSES ARE REPORTED. A refused call evaluates the policy machine AND the review gate
 * and returns every refusal that applies, each naming its own cause. Returning the first one
 * would send a caller round the loop twice, and collapsing them into one boolean is precisely
 * the error masking this repository exists to refuse.
 *
 * No round-trip re-validation, unlike `promoteApproved` in the open plane — deliberately. That
 * function BUILDS a document out of two sources and hands it to a different package's gate, so
 * it re-validates what it built. This one changes exactly one field, to a value the policy
 * machine itself produced from a state that already passed the gate. Re-parsing would imply
 * @foliage/enterprise-policy's own output is untrusted, which would be theatre.
 *
 * TOTAL and PURE: no fs, no clock, no throw. The input artifact is never mutated. O(1) beyond
 * the policy machine's own O(transitions) lookup.
 */

import { applyEvent, type Actor, type ReleaseEvent } from "@foliage/enterprise-policy";

import type { EnterpriseArtifact } from "./artifactDocument.ts";
import { OUTWARD_EVENTS } from "./reviewGate.ts";

/** Which gate refused, kept distinct because the two have different remedies. */
export type ReleaseRefusalCause =
  /** @foliage/enterprise-policy said no: illegal transition, or wrong actor. */
  | "policy-refused"
  /** The drafted prose has not been approved by a person. */
  | "review-not-approved";

export interface ReleaseRefusal {
  readonly cause: ReleaseRefusalCause;
  readonly reason: string;
}

export type ArtifactReleaseOutcome =
  | {
      readonly ok: true;
      /** A new artifact with the new release state. The input is untouched. */
      readonly artifact: EnterpriseArtifact;
      /** The policy table's own note for the transition that was applied. */
      readonly note: string;
    }
  | {
      readonly ok: false;
      /** Every refusal that applies, never just the first. At least one. */
      readonly refusals: readonly ReleaseRefusal[];
    };

/** The review gate, as a value rather than a branch, so both refusals can be collected. */
function reviewRefusal(
  artifact: EnterpriseArtifact,
  event: ReleaseEvent,
): ReleaseRefusal | null {
  if (!OUTWARD_EVENTS.has(event)) return null;
  const review = artifact.review;
  if (review.state === "approved") return null;
  return Object.freeze({
    cause: "review-not-approved" as const,
    reason:
      review.state === "candidate"
        ? `"${event}" would offer this artifact outward, and its draft is still "candidate" — ` +
          `unreviewed. A machine wrote the title; nobody has read it.`
        : `"${event}" would offer this artifact outward, and its draft was rejected by ` +
          `${review.by} (${review.role}) at ${review.at}: ${review.reason}`,
  });
}

/**
 * Fire a release event at an artifact.
 *
 * `actor` is the capacity the caller is acting in, and it is passed straight to `applyEvent`,
 * which decides whether that capacity may fire that event. This function does not second-guess
 * that decision — company policy has one home.
 */
export function applyReleaseEvent(
  artifact: EnterpriseArtifact,
  event: ReleaseEvent,
  actor: Actor,
): ArtifactReleaseOutcome {
  const policy = applyEvent(artifact.release, event, actor);
  const review = reviewRefusal(artifact, event);

  if (!policy.ok || review !== null) {
    const refusals: ReleaseRefusal[] = [];
    // The policy's own wording, verbatim: it distinguishes "not a legal transition" from "not
    // permitted for this actor", and rephrasing it here would create a second vocabulary for
    // the same refusal.
    if (!policy.ok) refusals.push({ cause: "policy-refused", reason: policy.reason });
    if (review !== null) refusals.push(review);
    return { ok: false, refusals: Object.freeze(refusals) };
  }

  return {
    ok: true,
    artifact: Object.freeze({ ...artifact, release: policy.state }),
    note: policy.note,
  };
}
