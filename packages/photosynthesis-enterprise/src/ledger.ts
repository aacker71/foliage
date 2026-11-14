/**
 * THE CONTRIBUTION LEDGER — an honest tally for a subject, in the spirit of
 * `attributionLedger` in @foliage/leaf and `canopySize` in @foliage/canopy, and refusing in
 * the same direction as both.
 *
 * WHAT IS REFUSED HERE, AND WHY IT IS REFUSED HARDEST IN THIS PACKAGE. A leaf's ledger
 * summarises one person's own evidence, so the worst it can produce is a figure about
 * somebody by themselves. This ledger spans a branch — a whole team — and the moment you
 * summarise people against each other you are rating them:
 *
 *   NO RATIO, NO PERCENTAGE, NO COMPOSITE. Counts only. A caller who wants "Ada did 60% of
 *   it" has to divide two numbers themselves and own that claim; this package will not hand
 *   out a figure that reads like a rating of a person's work.
 *
 *   NO RANKING, AND NO ORDERING KEYED ON THE COUNTS. `contributors` comes back in FIRST
 *   APPEARANCE order across the artifacts — the order the company's own records happen
 *   to be in — and is never sorted by any tally. There is no `topContributor`, no maximum, no
 *   "most active": those are the same function with a friendlier name.
 *
 *   NO PER-PERSON TOTAL PRESENTED AS A SHARE. A contributor's `evidenceRefs` is the number of
 *   refs that NAME THEM, which is a count of records, not a measure of effort — two people can
 *   do the same work and leave a different number of commits behind. The field is named for
 *   what it counts, so a reader cannot mistake it for a measure of the person.
 *
 * WHAT IS COUNTED INSTEAD, and it is the part that is actually useful: how many artifacts a
 * subject holds, how many of them name no one person at all, how many were out of scope, and
 * where they stand with the release policy. Those are facts about ARTIFACTS.
 *
 * `artifactsWithNoNamedContributor` exists because a branch artifact legitimately belongs to no
 * one person, and a portfolio that quietly dropped those would be smaller than the truth.
 * `outOfScope` exists for the same reason one level up: a ledger that filtered artifacts away
 * silently would report a small number with no way to tell "we hold little" from "we excluded
 * most of it" — four causes collapsed into one zero, in a new costume.
 *
 * TOTAL and PURE, no clock, no throw. Complexity: O(artifacts × contributors), one pass, with
 * an O(distinct contributors) Map keyed by `subjectKey`.
 */

import type { ReleaseState } from "@foliage/enterprise-policy";

import { RELEASE_STATES, type EnterpriseArtifact } from "./artifactDocument.ts";
import { containment, subjectKey, type LeafSubject, type Subject } from "./subject.ts";

/**
 * One person's presence on a subject's artifacts.
 *
 * Two counts, both of records rather than of the person, and nothing else. There is
 * deliberately no field that could be read as a proportion of the whole.
 */
export interface ContributorTally {
  readonly subject: LeafSubject;
  /** The opaque grouping key, so a caller can join without re-deriving it. */
  readonly key: string;
  /** Artifacts in scope on which this person is named. */
  readonly artifacts: number;
  /** Evidence refs in scope that name this person. A count of records, not of effort. */
  readonly evidenceRefs: number;
}

export interface ContributionLedger {
  /** The subject the ledger was drawn for. */
  readonly subject: Subject;
  /** Artifacts this subject contains. */
  readonly artifacts: number;
  /** Evidence refs carried by those artifacts themselves (contributor refs are separate). */
  readonly evidenceRefs: number;
  /** Of those artifacts, how many name no one person — a real state for a branch's work. */
  readonly artifactsWithNoNamedContributor: number;
  /** Artifacts that were handed in but belong to some other subject. Reported, never dropped. */
  readonly outOfScope: number;
  /** Per release state. Unordered, exactly like the proof tiers: no state outranks another. */
  readonly byReleaseState: Readonly<Record<ReleaseState, number>>;
  /** FIRST APPEARANCE order. Never sorted by a tally — see the header. */
  readonly contributors: readonly ContributorTally[];
}

/** Every release state at zero, built from the policy's own state set rather than re-listed. */
function zeroedReleaseCounts(): Record<ReleaseState, number> {
  const counts = {} as Record<ReleaseState, number>;
  for (const state of RELEASE_STATES) counts[state] = 0;
  return counts;
}

interface MutableTally {
  readonly subject: LeafSubject;
  readonly key: string;
  artifacts: number;
  evidenceRefs: number;
}

/**
 * Tally the artifacts belonging to `subject` — those it contains, including its own.
 *
 * Scope is decided by `containment`, which is why the subject hierarchy carries full ancestry:
 * "is this artifact ours" is answered from the two subjects alone, with no lookup that could
 * miss and be mistaken for a no.
 */
export function contributionLedger(
  artifacts: readonly EnterpriseArtifact[],
  subject: Subject,
): ContributionLedger {
  const byReleaseState = zeroedReleaseCounts();
  const tallies = new Map<string, MutableTally>();
  let inScope = 0;
  let outOfScope = 0;
  let evidenceRefs = 0;
  let artifactsWithNoNamedContributor = 0;

  for (const artifact of artifacts) {
    if (containment(subject, artifact.subject).relation === "separate") {
      outOfScope++;
      continue;
    }

    inScope++;
    evidenceRefs += artifact.evidence.length;
    byReleaseState[artifact.release]++;
    if (artifact.contributors.length === 0) artifactsWithNoNamedContributor++;

    for (const contribution of artifact.contributors) {
      const key = subjectKey(contribution.subject);
      const existing = tallies.get(key);
      if (existing === undefined) {
        tallies.set(key, {
          subject: contribution.subject,
          key,
          artifacts: 1,
          evidenceRefs: contribution.evidence.length,
        });
        continue;
      }
      existing.artifacts++;
      existing.evidenceRefs += contribution.evidence.length;
    }
  }

  // Map preserves insertion order, so this is first-appearance order and nothing else. No
  // sort — see the header: an ordering keyed on the counts is a ranking of people.
  const contributors = Object.freeze(
    [...tallies.values()].map((t) =>
      Object.freeze({
        subject: t.subject,
        key: t.key,
        artifacts: t.artifacts,
        evidenceRefs: t.evidenceRefs,
      }),
    ),
  );

  return Object.freeze({
    subject,
    artifacts: inScope,
    evidenceRefs,
    artifactsWithNoNamedContributor,
    outOfScope,
    byReleaseState: Object.freeze(byReleaseState),
    contributors,
  });
}
