/**
 * THE REVIEW GATE — one rule, and the TWO doors it has to hold at.
 *
 * The rule is a sentence: an artifact whose drafted prose no person has read may not be offered
 * outward. @foliage/enterprise-policy does not know about it — that machine governs a release
 * and knows nothing about whether a machine-written title was ever read — so this package adds
 * it. What it cost to learn is that adding it at one door is not adding it at all:
 *
 *   THE TRANSITION DOOR   release.ts refuses `propose` and `publish` unless review is
 *                         `approved`. This one was built first, and on its own it gates only
 *                         the artifacts that actually travel through it.
 *   THE DOCUMENT DOOR     artifactDocument.ts refuses a file that simply ASSERTS the end state.
 *                         Without it, `"release": "live"` beside `{"state": "candidate"}`
 *                         parsed clean, `isPublic` said true, and the ledger counted a draft
 *                         nobody had read as publicly live. The gate was never asked.
 *
 * Both doors read the SAME declarations here rather than each keeping its own, because two
 * copies of "which events move an artifact outward" is precisely how one door stops matching
 * the other. A third module rather than either importing the other: release.ts and
 * artifactDocument.ts already point at each other for types, and closing that cycle with a
 * VALUE import would read a frozen const before its module body had run — a TDZ crash at import
 * time, produced by a change that looks like tidying.
 *
 * The reachable set is DERIVED from the policy table rather than listed. A transition added to
 * @foliage/enterprise-policy changes what an unreviewed draft can reach, and this recomputes
 * instead of waiting for somebody to remember. Least fixed point over the table, O(states ×
 * transitions) on a nine-row table, evaluated once at module load.
 */

import { TRANSITIONS, type ReleaseEvent, type ReleaseState } from "@foliage/enterprise-policy";

/**
 * The two events that increase an artifact's exposure: `propose` offers it outward, `publish`
 * is the egress. Named rather than derived from the transition table, because "moves outward"
 * is a judgement about direction and the table declares reachability, not direction — deriving
 * it would read as rigour while quietly guessing.
 */
export const OUTWARD_EVENTS: ReadonlySet<ReleaseEvent> = new Set<ReleaseEvent>([
  "propose",
  "publish",
]);

/**
 * Where an artifact begins: drafted, internal, unread. Named for the same reason as
 * `OUTWARD_EVENTS` — the table declares which transitions are legal, never which state a new
 * artifact starts in. Annotated as `ReleaseState` rather than inferred, so renaming the state
 * upstream is a type error here instead of a silently empty starting point.
 */
const DRAFTED_STATE: ReleaseState = "internal";

/**
 * Every release state an artifact can hold while its review is still `candidate` — that is,
 * while nobody has read the draft.
 *
 * This is the EXACT set, not a cautious approximation, and it rests on one fact about review
 * states: `candidate` means NEVER REVIEWED, so a review can leave it and can never return to
 * it. An artifact reaches anything past the drafted state only by firing an outward event, and
 * the transition door refuses those while review is `candidate`. So the states an unreviewed
 * draft can occupy are exactly those reachable from `DRAFTED_STATE` without an outward event.
 *
 * On today's policy table that closure is `{internal}` — every other state sits behind
 * `propose`. It is computed rather than written down so it stays true of tomorrow's table.
 */
export const UNREVIEWED_RELEASE_STATES: ReadonlySet<ReleaseState> = closureWithoutOutwardEvents();

function closureWithoutOutwardEvents(): ReadonlySet<ReleaseState> {
  const reached = new Set<ReleaseState>([DRAFTED_STATE]);
  // Least fixed point: keep sweeping the table until a sweep adds nothing. A single pass would
  // depend on the table's row order, which is an editorial choice and not a guarantee.
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of TRANSITIONS) {
      if (OUTWARD_EVENTS.has(t.event) || !reached.has(t.from) || reached.has(t.to)) continue;
      reached.add(t.to);
      grew = true;
    }
  }
  return reached;
}
