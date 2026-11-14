/**
 * The release state machine: Canopy Enterprise (private) → Canopy (public).
 *
 * This package is PRIVATE. It must never be reachable from a public package — that is
 * enforced by scripts/check-public-boundary.mjs, not by convention.
 *
 * Why a machine rather than a boolean: "published" is not one bit. A leaf can be internal,
 * proposed by its subject, under policy review by the company, approved, live, or
 * withdrawn after the fact — and the legal difference between "approved" and "live" is
 * real, because approval is a company decision and going live is an egress event. Modelling
 * it as a boolean is how you end up publishing something that was only ever approved in
 * principle.
 *
 * Transitions are declared as data. That makes the whole policy auditable by reading one
 * table rather than tracing branches, and it makes an illegal transition a lookup miss
 * instead of a missing `if`.
 */

export type ReleaseState =
  /** Visible only inside the organization. The default, and the only safe default. */
  | "internal"
  /** The subject has asked for outward release. A request, not a decision. */
  | "proposed"
  /** The company is reviewing against its release policy. */
  | "in_review"
  /** Policy says yes. NOT yet public — approval and egress are separate events. */
  | "approved"
  /** Actually reachable in the public Canopy. */
  | "live"
  /** Was live, has been pulled. Distinct from `internal`: it has an exposure history. */
  | "withdrawn";

export type ReleaseEvent =
  | "propose"
  | "open_review"
  | "approve"
  | "reject"
  | "publish"
  | "withdraw"
  | "retract";

/** Who is permitted to fire an event. */
export type Actor = "subject" | "policy_owner" | "system";

interface Transition {
  readonly from: ReleaseState;
  readonly event: ReleaseEvent;
  readonly to: ReleaseState;
  readonly actors: readonly Actor[];
  readonly note: string;
}

export const TRANSITIONS: readonly Transition[] = Object.freeze([
  {
    from: "internal",
    event: "propose",
    to: "proposed",
    actors: ["subject"],
    note: "Only the subject may offer their own leaf outward.",
  },
  {
    from: "proposed",
    event: "open_review",
    to: "in_review",
    actors: ["policy_owner", "system"],
    note: "Review may be opened manually or by policy automation.",
  },
  {
    from: "proposed",
    event: "retract",
    to: "internal",
    actors: ["subject"],
    note: "The subject can withdraw their own request before review concludes.",
  },
  {
    from: "in_review",
    event: "approve",
    to: "approved",
    actors: ["policy_owner"],
    note: "A company decision. Never automatic.",
  },
  {
    from: "in_review",
    event: "reject",
    to: "internal",
    actors: ["policy_owner"],
    note: "Returns to internal; the leaf itself is untouched.",
  },
  {
    from: "approved",
    event: "publish",
    to: "live",
    actors: ["subject", "policy_owner"],
    note: "The egress event, deliberately separate from approval.",
  },
  {
    from: "approved",
    event: "retract",
    to: "internal",
    actors: ["subject", "policy_owner"],
    note: "Approved but never published can go back with no exposure history.",
  },
  {
    from: "live",
    event: "withdraw",
    to: "withdrawn",
    actors: ["subject", "policy_owner"],
    note: "Pulled from public Canopy. Retains that it was once exposed.",
  },
  {
    from: "withdrawn",
    event: "propose",
    to: "proposed",
    actors: ["subject"],
    note: "May be offered again; re-review is required.",
  },
]);

/** States from which nothing is publicly reachable. */
export const NON_PUBLIC_STATES: readonly ReleaseState[] = Object.freeze([
  "internal",
  "proposed",
  "in_review",
  "approved",
  "withdrawn",
]);

/**
 * The single question the public plane is allowed to ask.
 *
 * Exactly one state is public. Anything else — including `approved` — is not. Callers must
 * use this rather than comparing states themselves, so the rule lives in one place.
 */
export function isPublic(state: ReleaseState): boolean {
  return state === "live";
}

export type TransitionResult =
  | { readonly ok: true; readonly state: ReleaseState; readonly note: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Apply an event. Returns a result rather than throwing, and never returns a state on
 * failure, so a caller cannot accidentally proceed with a half-applied transition.
 *
 * Failure carries the cause — "not permitted for this actor" and "not a legal transition"
 * are different problems and collapsing them into one boolean is how error masking starts.
 */
export function applyEvent(
  state: ReleaseState,
  event: ReleaseEvent,
  actor: Actor,
): TransitionResult {
  const legal = TRANSITIONS.filter((t) => t.from === state && t.event === event);

  if (legal.length === 0) {
    const available = TRANSITIONS.filter((t) => t.from === state).map((t) => t.event);
    return {
      ok: false,
      reason:
        `"${event}" is not a legal transition from "${state}". ` +
        `Available: ${available.length ? available.join(", ") : "(none — terminal)"}.`,
    };
  }

  const permitted = legal.find((t) => t.actors.includes(actor));
  if (!permitted) {
    const who = [...new Set(legal.flatMap((t) => t.actors))].join(", ");
    return {
      ok: false,
      reason: `"${event}" from "${state}" is not permitted for actor "${actor}". Permitted: ${who}.`,
    };
  }

  return { ok: true, state: permitted.to, note: permitted.note };
}

/** Every event legal from a state, for rendering exactly the controls that will work. */
export function availableEvents(
  state: ReleaseState,
  actor: Actor,
): readonly ReleaseEvent[] {
  return Object.freeze(
    TRANSITIONS.filter((t) => t.from === state && t.actors.includes(actor)).map((t) => t.event),
  );
}
