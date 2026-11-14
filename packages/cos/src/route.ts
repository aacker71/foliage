/**
 * THE ROUTING POLICY — where a request may go, and for everything that stays home, why.
 *
 * This is the domain half of the local chief-of-staff agent (docs/PRODUCT-ARCHITECTURE-SPEC.md
 * §4). It decides. It never acts: no fs, no network, no clock, no subprocess, no throw. Opening
 * the encrypted Tier 1 store and speaking HTTP to an inference provider are I/O details of one
 * app, and they live in `apps/cos` — the same split as document.ts / leafDocument.ts and
 * intake.ts / gitIntake.ts, drawn for the same reason.
 *
 * WHY THE POLICY IS OPEN SOURCE. `public-boundary.json` already argues it: "a privacy guarantee
 * you cannot inspect is only a promise; this is the part that makes it checkable." A gate whose
 * rules are proprietary is a promise about a gate. Putting the rules in the `open` plane means
 * the person whose material it governs can read the exact sentences their privacy is enforced
 * by, run them, and fork them. That is a deliberate, reviewable addition to `open` — it is a
 * commitment that these rules stay published — and it is the one made in §11.2 of the spec.
 *
 * WHAT THIS PACKAGE HAS NO CONCEPT OF, on purpose:
 *
 *   NO SCORE, NO ORDERING, NO MAGNITUDE. Not a comparator, not a threshold, not a "sensitivity
 *   level", not a confidence. `DeclaredKind` is three names. `RoutingDecision` is four outcomes.
 *   Neither can be compared, summed or sorted, because an ordered sensitivity invites a
 *   threshold and a threshold is a score with a privacy budget attached. `SCORE_SHAPED` is
 *   imported from @foliage/leaf and refused BY NAME; the list is not copied here, because the
 *   copy is the one that goes stale (spec §11.6).
 *
 *   NO PRICING TIER. §6 of the spec assigns people a dev/executive billing tier. It is not
 *   modelled here, not carried on a request, and not readable from a decision — §11.6: it may
 *   never sit beside portfolio data, "because a value stored next to portfolio data eventually
 *   gets rendered next to it." The router's input is material and a policy; that is all.
 *
 *   NO WRITE PATH INTO A PORTFOLIO. Nothing this function returns is a leaflet, carries a
 *   `ProofTier`, or can be written into a leaf document (§11.4). The human review gate between
 *   synthesis and proof does not move, and this router is on the far side of it.
 *
 * THE FOUR DECISIONS, and what each one actually licenses:
 *
 *   local-only      This request must be served entirely on the device. Neither the Tier 2
 *                   confidential store nor the Tier 3 inference provider may see any part of it.
 *   tier2-eligible  The request may draw on the Tier 2 confidential store, and NOTHING crosses
 *                   to Tier 3.
 *   escalate        The admitted set — and only it — may cross to Tier 3.
 *   refused         The router will not serve the request at all, with a named cause.
 *
 * These are four names, not four rungs. There is no function anywhere that says one is greater
 * than another, and adding one would be the change this header exists to make hard.
 *
 * THE RULE THAT DECIDES BETWEEN `escalate` AND `tier2-eligible`, stated once so nothing has to
 * infer it: ESCALATION IS ALL-OR-NOTHING OVER THE ASSEMBLED CONTEXT. If any item may not cross,
 * the request does not escalate. This is not fastidiousness; it is spec §3's own consequence.
 * With `store=false` the provider retains nothing between calls, so every call must carry its
 * full context — which means a partially-admitted escalation is a model reasoning about someone's
 * career from a silently truncated view, and returning an answer that reads exactly as confident
 * as a complete one. §4 names the cost of that directly: for the legacy/narrative function, a
 * mischaracterised fact "isn't a minor bug — it's actively corrupting someone's professional
 * record." So the invariant is mechanical and testable: `escalate` if and only if the withheld
 * set is empty, and `admitted` is non-empty under no other decision.
 *
 * TIER 1 MATERIAL CANNOT BE ROUTED TO `escalate`, and it is enforced twice rather than once,
 * because a rule with one enforcement point is a rule with one edit between it and gone:
 *   (a) an item declared `tier1-local` puts `tier1-material-present` in the causes, and the
 *       decision is `local-only`; and
 *   (b) an `EgressPolicy` that NAMES `tier1-local` as permitted to cross is REFUSED, not
 *       honoured. A device-only guarantee with an override is a setting, not a guarantee, so
 *       the malformed policy is reported rather than obeyed.
 *
 * UNDECLARED MATERIAL DEFAULTS CLOSED. An item the caller declared nothing about pins the
 * request to `local-only` and carries the reason `undeclared`. Nothing is guessed from its shape
 * or content — see the header of classify.ts for the measured reason inference is refused here.
 *
 * CAUSES ARE REPORTED TOGETHER, NEVER COLLAPSED. `local-only` carries a NON-EMPTY LIST of
 * causes, so a request that is local both because it touched device-only material and because
 * something was undeclared reports both facts. This repository's recurring bug class is distinct
 * causes flattened into one value — four different failures becoming `commitCount: 0` — and the
 * flattening is always cheaper to write than the list. The list is what gets written here.
 *
 * REFUSAL CAUSES HERE CAN NEVER BE MISTAKEN FOR TRANSPORT FAILURES. This function never emits
 * `no-credential`, `timeout`, `network-unreachable`, `provider-refused` or `malformed-response`:
 * those are the inference client's causes, in another package, and they mean the opposite thing.
 * "Policy would not let this leave" and "there was nobody to send it to" must stay visibly
 * distinct, because on a machine with no key configured they occur in the same second.
 *
 * Complexity: O(n) over items — one classification pass, one disposition pass — plus an O(1)
 * Set over the policy's declared kinds.
 */

import {
  DECLARED_KINDS,
  classifyAll,
  type ContextItem,
  type ContextItemId,
  type DeclaredKind,
  type ItemClassification,
} from "./classify.ts";
import { SCORE_SHAPED } from "@foliage/leaf";

/**
 * What the person has declared may cross to the Tier 3 inference provider.
 *
 * A SET OF KINDS, NOT A THRESHOLD. `mayCross: ["tier3-shareable"]` is a statement about which
 * named kinds may leave; it is not a dial, and there is no value of it that means "more". An
 * empty `mayCross` is the device-only posture of spec §3's resolution (b) — "your most sensitive
 * material literally cannot leave this machine" — and it is expressible as data rather than as a
 * build flag, which is what lets a person check it.
 *
 * Naming `tier1-local` in here is REFUSED. See the header.
 */
export interface EgressPolicy {
  readonly mayCross: readonly DeclaredKind[];
}

/** A request as a caller constructs it. `route` also accepts `unknown` and validates it. */
export interface RoutingRequest {
  readonly policy: EgressPolicy;
  readonly items: readonly ContextItem[];
}

const REQUEST_KEYS: ReadonlySet<string> = new Set(["policy", "items"]);
const POLICY_KEYS: ReadonlySet<string> = new Set(["mayCross"]);

/** One item that may cross to Tier 3. Produced under `escalate` and under nothing else. */
export interface AdmittedItem {
  readonly id: ContextItemId;
  readonly at: string;
  readonly kind: DeclaredKind;
}

/**
 * Why one item did not cross. Five named reasons, and the specific one always wins over the
 * general one: an item that is device-only reports `device-only`, not `request-is-local-only`,
 * even though both are true — a person asking "why did my review notes stay here?" is owed the
 * fact about their notes, not the fact about the request.
 */
export type WithheldReason =
  /** Declared `tier1-local`. Never crosses, under any policy. */
  | "device-only"
  /** The caller declared nothing about it, so it gets the most restrictive answer. */
  | "undeclared"
  /** Its declared kind is not in the person's `mayCross` set. */
  | "not-permitted-by-policy"
  /** It could have crossed, but the request as a whole may not leave the device. */
  | "request-is-local-only"
  /** It could have crossed, but something else in the context could not, so nothing did. */
  | "request-not-escalated";

export interface WithheldItem {
  readonly id: ContextItemId;
  readonly at: string;
  readonly reason: WithheldReason;
  /** A sentence a person can read, naming the fact rather than the rule number. */
  readonly detail: string;
}

/**
 * Exactly what crosses, and for everything that does not, why.
 *
 * THE WITHHELD SET IS ENUMERABLE ON PURPOSE. A privacy gate that reports "3 items withheld" has
 * told the person nothing they can check; this one names every item and its reason, so a UI can
 * show the list item by item and a test can assert over it. `admitted` and `withheld` together
 * account for EVERY classified item, exactly once — that partition is the property worth testing,
 * because an item that appears in neither is an item nobody can ask about.
 */
export interface EgressPlan {
  readonly admitted: readonly AdmittedItem[];
  readonly withheld: readonly WithheldItem[];
}

/** Why a request must be served entirely on this device. Reported as a list, never collapsed. */
export type LocalOnlyCause =
  | "tier1-material-present"
  | "undeclared-material-present"
  | "policy-permits-no-egress";

/**
 * Why the router will not serve a request at all. Every one of these is a malformed INPUT — the
 * caller handed the policy something it cannot reason about. None of them is a transport failure
 * and none of them is a sensitivity judgement.
 */
export type RefusalCause =
  | "malformed-request"
  | "malformed-policy"
  | "malformed-context"
  | "tier1-egress-declared"
  | "unrecognized-egress-kind"
  | "score-shaped-key";

/** One reason a request was refused, addressed to whoever wrote the caller. */
export interface RoutingIssue {
  readonly at: string;
  readonly cause: RefusalCause;
  readonly message: string;
}

export type RoutingDecision =
  | {
      readonly decision: "local-only";
      /** Non-empty. Every reason that applies, in declaration order — not severity order. */
      readonly causes: readonly LocalOnlyCause[];
      readonly egress: EgressPlan;
    }
  | { readonly decision: "tier2-eligible"; readonly egress: EgressPlan }
  | { readonly decision: "escalate"; readonly egress: EgressPlan }
  | {
      readonly decision: "refused";
      readonly cause: RefusalCause;
      readonly issues: readonly RoutingIssue[];
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDeclaredKind(v: unknown): v is DeclaredKind {
  return v === "tier1-local" || v === "tier2-confidential" || v === "tier3-shareable";
}

function refuse(cause: RefusalCause, issues: readonly RoutingIssue[]): RoutingDecision {
  return { decision: "refused", cause, issues };
}

/**
 * Validate the declared egress policy, or say every way it is not one.
 *
 * Returns the permitted kinds as a Set, or the issues. The `tier1-local` check lives here rather
 * than at the routing step deliberately: a policy naming device-only material as exportable is
 * wrong the moment it is written, independently of whether this particular request happens to
 * contain any. Refusing it only when it would have mattered is how a broken setting sits unnoticed
 * until the day it matters.
 */
type PolicyRead =
  | { readonly state: "read"; readonly mayCross: ReadonlySet<DeclaredKind> }
  | { readonly state: "malformed"; readonly issues: readonly RoutingIssue[] };

function readPolicy(raw: unknown): PolicyRead {
  if (!isRecord(raw)) {
    return {
      state: "malformed",
      issues: [
        {
          at: "policy",
          cause: "malformed-policy",
          message: "policy must be an object declaring mayCross. There is no default: an unstated egress policy would have to be guessed, and guessing is what this package refuses.",
        },
      ],
    };
  }
  const issues: RoutingIssue[] = [];
  for (const key of Object.keys(raw)) {
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      issues.push({
        at: `policy.${key}`,
        cause: "score-shaped-key",
        message: `"${key}" is a score-shaped key, refused by name. An egress policy expressed as a magnitude is a threshold, and a threshold over people is a score.`,
      });
    } else if (!POLICY_KEYS.has(key)) {
      issues.push({
        at: `policy.${key}`,
        cause: "malformed-policy",
        message: `"${key}" is not a field of an egress policy. Unknown keys are refused rather than ignored — an ignored policy key is a setting the person believes is in force and is not.`,
      });
    }
  }
  const rawMayCross: unknown = raw["mayCross"];
  if (!Array.isArray(rawMayCross)) {
    issues.push({
      at: "policy.mayCross",
      cause: "malformed-policy",
      message: "mayCross must be an array of declared kinds. An empty array is meaningful and allowed — it is the device-only posture — but an absent one is not a posture, it is an omission.",
    });
    return { state: "malformed", issues };
  }
  const mayCross = new Set<DeclaredKind>();
  for (const [index, entry] of rawMayCross.entries()) {
    if (entry === "tier1-local") {
      issues.push({
        at: `policy.mayCross[${index}]`,
        cause: "tier1-egress-declared",
        message: "tier1-local material is device-only by construction and this policy declares it may cross. The declaration is refused, not honoured: a guarantee with an override is a setting, and the whole Tier 1 claim is that this one has none.",
      });
      continue;
    }
    if (!isDeclaredKind(entry)) {
      issues.push({
        at: `policy.mayCross[${index}]`,
        cause: "unrecognized-egress-kind",
        message: `expected one of ${DECLARED_KINDS.join(", ")}. An unrecognised kind is not mapped to the nearest known one — a policy the router half-understood is not a policy.`,
      });
      continue;
    }
    mayCross.add(entry);
  }
  if (issues.length > 0) return { state: "malformed", issues };
  return { state: "read", mayCross };
}

/**
 * THE ENTRY POINT. Total over `unknown`: a well-typed `RoutingRequest` passes trivially, and a
 * record parsed from a local store, an MCP client or a config file is validated rather than
 * trusted. Never throws — a caller needs every problem at once, and an exception carries one.
 */
export function route(input: unknown): RoutingDecision {
  if (!isRecord(input)) {
    return refuse("malformed-request", [
      { at: "", cause: "malformed-request", message: "a routing request must be an object with a policy and items." },
    ]);
  }

  const requestIssues: RoutingIssue[] = [];
  for (const key of Object.keys(input)) {
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      requestIssues.push({
        at: key,
        cause: "score-shaped-key",
        message: `"${key}" is a score-shaped key, refused by name from the one list in @foliage/leaf. Nothing this router assembles may carry a rating of a person.`,
      });
    } else if (!REQUEST_KEYS.has(key)) {
      requestIssues.push({
        at: key,
        cause: "malformed-request",
        message: `"${key}" is not a field of a routing request. Unknown keys are refused rather than ignored.`,
      });
    }
  }

  const policy = readPolicy(input["policy"]);
  if (policy.state === "malformed") requestIssues.push(...policy.issues);

  const rawItems: unknown = input["items"];
  const items: readonly unknown[] = Array.isArray(rawItems) ? rawItems : [];
  if (!Array.isArray(rawItems)) {
    requestIssues.push({
      at: "items",
      cause: "malformed-request",
      message: "items must be an array of assembled context items. An empty array is a real, well-formed state — nothing was assembled — and is routed honestly rather than refused.",
    });
  }

  if (requestIssues.length > 0 || policy.state === "malformed") {
    return refuse(primaryCause(requestIssues), requestIssues);
  }

  const classified = classifyAll(items);

  const itemIssues: RoutingIssue[] = [];
  for (const c of classified) {
    if (c.state === "refused") {
      itemIssues.push({
        at: c.at,
        cause: c.cause === "score-shaped-key" ? "score-shaped-key" : "malformed-context",
        message: c.detail,
      });
    }
  }
  if (itemIssues.length > 0) return refuse(primaryCause(itemIssues), itemIssues);

  return decide(classified, policy.mayCross);
}

/**
 * Which single cause names a refusal that has several.
 *
 * `score-shaped-key` wins whenever it is present. Not because it is "worse" — there is no
 * severity here — but because it is the refusal a reader must not misdiagnose: arriving as the
 * generic "malformed context", a `confidence` field looks like a schema mismatch and gets fixed
 * by adding the field to the schema. The full list still travels in `issues`; this only decides
 * which word the caller sees first.
 */
function primaryCause(issues: readonly RoutingIssue[]): RefusalCause {
  for (const i of issues) if (i.cause === "score-shaped-key") return "score-shaped-key";
  const first = issues[0];
  return first === undefined ? "malformed-request" : first.cause;
}

/** Item-level disposition, computed once and used to build both the decision and the plan. */
type Disposition =
  | { readonly kind: "may-cross"; readonly item: AdmittedItem }
  | { readonly kind: "withheld"; readonly item: WithheldItem };

/**
 * THE EGRESS RULE, as a checkable pure function over already-classified context.
 *
 * Exported so it can be exercised — and shown — on its own: given an assembled context and a
 * declared policy, this returns the decision AND the complete item-by-item account behind it.
 * A caller that wants to render "here is why each thing stayed on your machine" needs exactly
 * this, and needs it without having to reconstruct the reasoning from the decision name.
 */
export function decide(
  classified: readonly ItemClassification[],
  mayCross: ReadonlySet<DeclaredKind>,
): RoutingDecision {
  // Pass 1: the most specific true reason for each item, independent of the request outcome.
  const dispositions: Disposition[] = [];
  for (const c of classified) {
    if (c.state === "refused") {
      // Unreachable via `route`, which refuses first. Handled rather than assumed away: a
      // refused item must never fall through into an admitted set.
      continue;
    }
    if (c.state === "undeclared") {
      dispositions.push({
        kind: "withheld",
        item: {
          id: c.id,
          at: c.at,
          reason: "undeclared",
          detail: `nothing was declared about this item (${c.cause}), so it gets the most restrictive answer rather than a guess about what it contains.`,
        },
      });
      continue;
    }
    if (c.kind === "tier1-local") {
      dispositions.push({
        kind: "withheld",
        item: {
          id: c.id,
          at: c.at,
          reason: "device-only",
          detail: "declared tier1-local: device-only material, which does not leave this machine under any policy.",
        },
      });
      continue;
    }
    if (!mayCross.has(c.kind)) {
      dispositions.push({
        kind: "withheld",
        item: {
          id: c.id,
          at: c.at,
          reason: "not-permitted-by-policy",
          detail: `declared ${c.kind}, which this person's egress policy does not permit to cross.`,
        },
      });
      continue;
    }
    dispositions.push({ kind: "may-cross", item: { id: c.id, at: c.at, kind: c.kind } });
  }

  // Pass 2: the request-level decision, from the reasons actually present.
  const causes: LocalOnlyCause[] = [];
  if (dispositions.some((d) => d.kind === "withheld" && d.item.reason === "device-only")) {
    causes.push("tier1-material-present");
  }
  if (dispositions.some((d) => d.kind === "withheld" && d.item.reason === "undeclared")) {
    causes.push("undeclared-material-present");
  }
  if (mayCross.size === 0) causes.push("policy-permits-no-egress");

  if (causes.length > 0) {
    return { decision: "local-only", causes, egress: closeEverything(dispositions, "request-is-local-only") };
  }

  const anyWithheld = dispositions.some((d) => d.kind === "withheld");
  if (anyWithheld) {
    return { decision: "tier2-eligible", egress: closeEverything(dispositions, "request-not-escalated") };
  }

  // Nothing was withheld, so the model would receive the whole assembled context. This is the
  // ONLY branch that produces a non-empty admitted set, and an empty context reaches it
  // honestly: nothing assembled means nothing withheld, and an empty admitted set is a real
  // result, not a failure.
  return {
    decision: "escalate",
    egress: {
      admitted: dispositions.flatMap((d) => (d.kind === "may-cross" ? [d.item] : [])),
      withheld: [],
    },
  };
}

/**
 * Collapse a set of dispositions into a plan where NOTHING crosses, giving items that had no
 * reason of their own the request-level reason. Items that DID have a reason keep theirs — the
 * specific fact survives the general one.
 */
function closeEverything(
  dispositions: readonly Disposition[],
  fallback: Extract<WithheldReason, "request-is-local-only" | "request-not-escalated">,
): EgressPlan {
  const detail =
    fallback === "request-is-local-only"
      ? "this item could have crossed, but the request touched material that may not leave this machine, so none of it did."
      : "this item could have crossed, but something else in the assembled context could not, and a partial context would put a truncated view of your work in front of the model.";
  return {
    admitted: [],
    withheld: dispositions.map((d) =>
      d.kind === "withheld" ? d.item : { id: d.item.id, at: d.item.at, reason: fallback, detail },
    ),
  };
}

/**
 * EXACTLY what may cross to Tier 3, for a caller about to make the call.
 *
 * This is the function the inference client is handed, and it is the reason that client is
 * structurally unable to send what policy withheld: it never receives a `RoutingDecision`, only
 * an `AdmittedItem[]`, and every decision other than `escalate` returns an empty one — including
 * `refused`, where no plan exists at all. There is no argument that makes this return withheld
 * material.
 */
export function admittedForEgress(decision: RoutingDecision): readonly AdmittedItem[] {
  return decision.decision === "escalate" ? decision.egress.admitted : [];
}
