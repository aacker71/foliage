/**
 * THE MCP ROOT SYSTEM — how enterprise material reaches Photosynthesis, and the exact shape it
 * is allowed to arrive in.
 *
 * WHY MCP AND NOT N CONNECTORS. The enterprise sources this product was asked for — WorkIQ /
 * Copilot, Atlassian, Claude Code — all already expose or speak MCP, and a company that runs
 * them has ALREADY deployed and authorized those servers for its agents. Writing a bespoke
 * connector per vendor would mean re-implementing, per vendor, the three things that are
 * hardest to get right and most dangerous to get wrong: authentication, consent, and tenancy.
 * So Photosynthesis does not connect to Jira. It becomes an MCP CLIENT, and the company's own
 * MCP servers are the root system that feeds it. Consent, authentication and tenancy are
 * INHERITED from those servers. That is less code, and it is a far better consent story,
 * because the company already decided that an agent may read those tools — this product does
 * not get to make that decision on its behalf, and now it structurally cannot.
 *
 * `Root` HERE IS NOT MCP's `roots`, AND THE COLLISION IS PERMANENT — the same discipline the
 * repository already applies to `Branch` vs git's branch, written down before it costs anyone
 * an hour. In the MCP protocol, `roots/list` is a CLIENT capability: the client tells the
 * server which filesystem or URI boundaries it may operate within. `McpRoot` here is the
 * opposite direction and a different noun — a botanical root, the organ through which this
 * organism draws material IN, declared by a tenant and pointing AT a server. Nothing in this
 * file implements, consumes or contradicts `roots/list`. The rule: `McpRoot`/`McpRootId` and
 * the word "root system" are this taxonomy; the protocol's is always written `roots/list` and
 * only ever appears in prose describing the protocol.
 *
 * WHAT THIS FILE IS, STATED PLAINLY SO NOTHING READS AS MORE THAN IT IS. It is the CONTRACT
 * and nothing else: what a tenant may declare, what an adapter may report, and every named way
 * both can be refused. It is not a connector. It opens no socket, spawns no process and holds
 * no credential. NO ATLASSIAN, WORKIQ OR CLAUDE CODE MCP SERVER IS REACHABLE FROM THE MACHINE
 * THIS WAS WRITTEN ON, so a connector written here could not have been exercised, and an
 * unexercised connector that claims to work is precisely the failure this repository exists to
 * refuse. See docs/MCP-ROOTS.md for what is contract-only and what was measured.
 *
 * WHAT WAS MEASURED, and it shapes three types below rather than sitting in a comment. The one
 * real MCP server reachable on this machine is gbrain 0.42.73.2 (`gbrain serve`, stdio). Driven
 * with a hand-written JSON-RPC `initialize` + `tools/list` on 2026-08-17 it advertised
 * **106 tools**, and three facts fell out of that response:
 *
 *   1. ITS `search` TOOL PAGINATES BY `limit`/`offset` AND ISSUES NO CURSOR. Offset resumption
 *      is therefore the ORDINARY case, not the exotic one — and an offset is not stable under
 *      mutation. See `McpResume`, which models cursor, offset, watermark and none as four
 *      different promises rather than one `nextPage` string.
 *   2. IT REPORTS NO TOTAL AND NO "there is more". A caller that asks for 20, receives 20, and
 *      concludes it has everything has invented a fact the server never stated. See
 *      `McpRemainder`, whose third arm is `unknown` — exhausted, more, and *nobody said* are
 *      three states, and collapsing the third into the first is the honest-empty bug at page
 *      scale.
 *   3. IT EXPOSES A TOOL NAMED `takes_scorecard`. The pressure this package's charter predicts
 *      is not hypothetical: the FIRST real MCP server available here already offers ratings.
 *      No field an MCP root produces can become a tier, an attribution or a score, and below
 *      that is structural rather than a promise.
 *
 * OBSERVATIONS, NEVER CONCLUSIONS — the same split as apps/leaf/src/gitIntake.ts (which reports
 * `ObservedCommit` and decides nothing) against packages/leaf/src/intake.ts (which decides what
 * a commit means). An MCP tool returns arbitrary JSON, and the narrow shape accepted from it is
 * `McpObservation`: an upstream handle, the upstream's OWN title string, and a flat list of
 * labelled text. Three things are then unrepresentable rather than discouraged:
 *
 *   A ROOT CANNOT ASSERT A TIER.        `drawFromRoot` writes `review: {state: "candidate"}` and
 *   `release: "internal"` unconditionally — those are the only values it can produce, and the
 *   review gate (reviewGate.ts, and artifactDocument.ts's document door) refuses any other pair
 *   beside an unread draft. The result is re-validated by `parseEnterpriseDocument` before it is
 *   returned, so the claim is checked by the real gate rather than by this file's opinion.
 *
 *   A ROOT CANNOT ATTRIBUTE WORK TO A PERSON. `contributors` is `[]` unconditionally, and there
 *   is no input that can change it. An upstream `assignee` is a string somebody typed into a
 *   ticket system; treating it as attribution would be `git config user.email` all over again —
 *   self-declared, and the exact reason a matching author address yields `pending` and never
 *   `verified`. Contributors are added by a human at review, inside `containment`.
 *
 *   A ROOT CANNOT SMUGGLE ARBITRARY JSON INTO THE DOCUMENT. `McpField`s do NOT enter the
 *   artifact — the enterprise document format was deliberately not widened to hold them. They
 *   come back BESIDE the result in `observedFields`, exactly as `transcriptions` travel beside
 *   photo intake's candidates, because folding an unverified fact into the result is how a guess
 *   becomes a claim. Widening the format to hold upstream JSON is also the precise door a
 *   monitoring feed would walk through, and subject.ts's charter closes it.
 *
 * PARTIAL SUCCESS CAN NEVER RENDER AS AN HONEST EMPTY RESULT, and that is enforced by the
 * SHAPE of `McpDraw` rather than by asking callers to be careful. The complete arm exposes
 * `artifacts`; the partial arm does not have that property at all — it exposes `artifactsSoFar`
 * beside `shortfall` and `resume`. So `draw.artifacts` does not type-check until the caller has
 * narrowed on `completeness`, and a caller who narrows cannot avoid seeing that material is
 * missing. `isHonestlyEmpty` is the one predicate a renderer needs, and it is true only when a
 * complete draw drew nothing.
 *
 * TENANCY IS `containment`, NOT A SECOND RULE. A root belongs to exactly one tree, and material
 * drawn through it may only be attributed to a subject that tree contains — checked with
 * subject.ts's `containment` and refused with its own `why`. A page may NARROW the attribution
 * (a root declared for a bough may attribute a page to a branch inside it) and may never widen
 * it; the two refusals are separate causes rather than one, because "another company" and "a
 * bigger slice of this company" are different mistakes with different remedies.
 *
 * NO CREDENTIAL MAY ENTER THIS FORMAT. A root declaration is a file a company checks into a
 * repository, and AGENTS.md records what a tracked secret already cost this lineage once. There
 * is no token field, no header field and no auth field in any type here; `CREDENTIAL_SHAPED`
 * refuses those keys BY NAME so the parser says "no credential belongs in this file" instead of
 * "unknown field", which is the difference between a reader fixing the cause and a reader adding
 * the field somewhere else.
 *
 * DOMAIN ONLY: pure, total, no fs, no network, no clock, no throw. Spawning a process, opening a
 * transport, and turning a `tools/call` result into `McpObservation`s is I/O and belongs in an
 * app. `URL` is used to parse an endpoint — it is a WHATWG global present in every JavaScript
 * runtime, not a Node module import, so this package still imports nothing outside the
 * workspace, and it throws on bad input, which is why every use of it is wrapped.
 *
 * Complexity: parsing is O(roots × tools) with an O(roots) Set for duplicate ids; drawing is
 * O(observations × fields), one pass, with an O(observations) Set for duplicate upstream ids.
 */

import type { ReleaseState } from "@foliage/enterprise-policy";
import { PROOF_TIERS, SCORE_SHAPED, isIsoInstant, type Provenance } from "@foliage/leaf";

import {
  parseEnterpriseDocument,
  type EnterpriseArtifact,
  type EnterpriseDocumentIssue,
} from "./artifactDocument.ts";
import {
  containment,
  describeSubject,
  treeId,
  type Subject,
  type TreeId,
} from "./subject.ts";

/**
 * `Provenance.source` prefix for material drawn through a root: `mcp:atlassian-prod/jira_search`.
 *
 * A constant, and the rest of the label is BUILT from the root and the tool rather than accepted
 * from a caller — the same rule as `GIT_SOURCE` and `PHOTO_SOURCE`. A caller able to label its
 * own output could label MCP material "git", and `source` is the one field a reviewer reads to
 * decide what a ref even means.
 */
export const MCP_SOURCE_PREFIX = "mcp:";

/**
 * The review and release values `drawFromRoot` writes, ALWAYS, on every artifact it produces.
 *
 * Named constants rather than literals at the construction site, because they are the entire
 * "AI output is never proof" guarantee of this file and a reader has to be able to find them.
 * Typed as `ReleaseState` so renaming the state upstream is a compile error here rather than a
 * document the parser silently refuses later.
 */
const DRAWN_RELEASE_STATE: ReleaseState = "internal";
const DRAWN_REVIEW_STATE = "candidate";

/** Opaque ids, the same device as `TreeId`/`BranchId`: three kinds of string, never swappable. */
export type McpRootId = string & { readonly __brand: "McpRootId" };
export type McpServerId = string & { readonly __brand: "McpServerId" };
export type McpToolName = string & { readonly __brand: "McpToolName" };

export const mcpRootId = (s: string): McpRootId => s as McpRootId;
export const mcpServerId = (s: string): McpServerId => s as McpServerId;
export const mcpToolName = (s: string): McpToolName => s as McpToolName;

/**
 * How the client reaches the server. DECLARED, never dialled — nothing in this package opens
 * either one.
 *
 * The two transports MCP actually defines. `stdio` names a command the operator's own machine
 * runs; `http` names a URL, and the URL is checked by PARSING it rather than by matching the
 * string, which is the discipline apps/leaf/harvest.mjs uses on the model endpoint. The rule it
 * enforces is not the same rule, and pretending otherwise would be worse than stating the
 * difference: harvest is loopback-ONLY because the open plane's privacy claim is zero network
 * calls beyond 127.0.0.1, whereas a company's Atlassian MCP server is by definition remote. So
 * what carries over is the METHOD (parse the hostname, fail closed), and the rule becomes:
 * `https` to anywhere, plaintext `http` only to the loopback interface, where it never leaves
 * the machine.
 */
export type McpEndpoint =
  | { readonly transport: "stdio"; readonly command: string }
  | { readonly transport: "http"; readonly url: string };

/** The server a root draws through: the tenant's own name for it, and how to reach it. */
export interface McpServerRef {
  readonly id: McpServerId;
  readonly endpoint: McpEndpoint;
}

/**
 * One tool on that server which this root may call, and why it is on the list.
 *
 * An ALLOW-LIST, because the alternative — "any tool on the server" — inherits the server's
 * whole surface, and an MCP server's surface is large: the one measured here advertises 106
 * tools, of which a portfolio product has business calling perhaps three. `purpose` is the
 * tenant's own words, recorded and never interpreted; it is what a reviewer reads when asking
 * why this product was reading that tool at all.
 */
export interface McpToolPermit {
  readonly tool: McpToolName;
  readonly purpose: string;
}

/**
 * What authorises the calls — and the whole point is that it RECORDS an authorisation made
 * elsewhere rather than granting one here.
 *
 * Two arms because the consent story genuinely differs between them, and collapsing them would
 * let the weaker one wear the stronger one's justification:
 *
 *   `inherited-session`  — the calls ride the operator's OWN already-authorized MCP session.
 *   Whatever the company let that person's agent read, this reads; nothing more. This is the
 *   arm the architecture argument is about.
 *
 *   `service-principal`  — the calls ride a machine identity, whose reach is not any one
 *   person's. "The company already consented" is a much weaker claim here, so this arm REQUIRES
 *   `authorisationRef`: a re-checkable handle for the record where the company decided it. Same
 *   discipline as `Provenance.ref` — an assertion with no handle is an assertion.
 *
 * There is no credential on either arm. This package never holds one; see the header.
 */
export type McpScopeGrant =
  | {
      readonly kind: "inherited-session";
      /** The identity the session belongs to, in the company's own id space. */
      readonly principal: string;
      /** Who inside the company recorded this root, and when. */
      readonly declaredBy: string;
      readonly declaredAt: string;
    }
  | {
      readonly kind: "service-principal";
      readonly principal: string;
      readonly declaredBy: string;
      readonly declaredAt: string;
      /** The company's own record of the decision — a ticket, a policy id, an approval ref. */
      readonly authorisationRef: string;
    };

/**
 * One declared root: a server, the tools on it this tenant permits, where the material belongs,
 * and what authorises the whole thing.
 *
 * `tree` is the tenancy and it is carried separately from `attributesTo` even though the latter
 * also names a tree — because the two can disagree, and a declaration whose subject sits in a
 * different company from its root is exactly the leak this field exists to catch. They are
 * checked against each other at the door and again in `drawFromRoot`.
 */
export interface McpRoot {
  readonly id: McpRootId;
  readonly tree: TreeId;
  readonly server: McpServerRef;
  /** At least one; an allow-list with nothing on it is refused at the door. See the parser. */
  readonly tools: readonly McpToolPermit[];
  /** The default subject material drawn here belongs to. A page may narrow it, never widen it. */
  readonly attributesTo: Subject;
  readonly grant: McpScopeGrant;
}

export interface McpRootDocument {
  readonly roots: readonly McpRoot[];
}

/** One reason something about a root is not usable, addressed to whoever is editing it. */
export interface McpRootIssue {
  /** `roots[1].tools[0].tool` — the index is named, the same rule as the other parsers. */
  readonly at: string;
  readonly message: string;
}

export type McpRootDocumentParse =
  | { readonly ok: true; readonly document: McpRootDocument }
  | { readonly ok: false; readonly issues: readonly McpRootIssue[] };

// ---------------------------------------------------------------------------------------------
// THE OBSERVATION CONTRACT — what an adapter may report, and nothing it may conclude.
// ---------------------------------------------------------------------------------------------

/**
 * One labelled piece of text an MCP tool returned about one item.
 *
 * `text`, always — never a number, never a boolean, never nested JSON. Not for tidiness: a
 * number invites arithmetic, and arithmetic over items is an aggregate, and an aggregate over
 * work is a score. A flat `string` has nothing this package can do to it except show it to a
 * person, which is the only thing that should happen to an unreviewed upstream field.
 *
 * These do NOT enter the artifact. See the header: the document format was not widened to hold
 * upstream JSON, so a field's only destination is `observedFields` on the draw, beside the
 * result rather than inside it.
 */
export interface McpField {
  readonly label: string;
  readonly text: string;
}

/**
 * One item as an MCP tool ACTUALLY RETURNED IT. Observations only.
 *
 * Deliberately narrow, for the same reason `ObservedCommit` is: an upstream record is full of
 * other people's names, and carrying a third party's personal details into a document that a
 * company renders internally is an egress risk taken for no benefit. There is no author field,
 * no assignee field and no participant field here, and that absence is the contract.
 *
 * `title` is the UPSTREAM'S OWN string — a Jira summary, a Confluence page title, a Claude Code
 * session name — carried verbatim and never composed here. An empty one is a real state (an
 * unnamed session), handled by stating the fact rather than by inventing a title.
 */
export interface McpObservation {
  /**
   * The upstream's own stable handle: an issue key, a page id, a session id. It becomes
   * `Provenance.ref` and part of the artifact id, so it is the entire checkable surface of the
   * item and a blank one is refused rather than defaulted.
   */
  readonly upstreamId: string;
  /** The upstream's own title string, verbatim. May legitimately be empty. */
  readonly title: string;
  readonly fields: readonly McpField[];
}

/**
 * How to ask for the next page, and what that promise is actually worth.
 *
 * FOUR ARMS, not one `nextPage` string, because the four make DIFFERENT promises and a caller
 * that cannot tell them apart cannot describe its own result honestly:
 *
 *   `cursor`    — the server issued an opaque cursor. Stability is the SERVER's promise; if it
 *                 later rejects the cursor that surfaces as an interruption, which is honest.
 *   `offset`    — resumption is POSITIONAL, and positions move. An item inserted upstream above
 *                 the offset shifts everything below it, so a resumed read SKIPS an item; an item
 *                 deleted upstream makes it REPEAT one. Repeats are catchable — artifact ids are
 *                 deterministic, so `parseEnterpriseDocument` refuses the duplicate at the
 *                 document door. SKIPS ARE NOT DETECTABLE FROM HERE AT ALL, and that is stated
 *                 rather than smoothed over. Measured: gbrain 0.42.73.2's `search` takes
 *                 `limit`/`offset` and issues no cursor, so this is the ordinary case.
 *   `watermark` — resumption is "everything changed since this instant", the upstream's OWN
 *                 timestamp string and never a clock read here (this package has no clock). An
 *                 item whose timestamp equals the watermark can be missed or repeated depending
 *                 on whether the upstream's filter is inclusive, and clock skew between that
 *                 server and this machine is unobservable from here.
 *   `none`      — there is no way to resume; the read can only be re-run from the start, which
 *                 is a different read at a different instant. Carries WHY, because "cannot
 *                 resume" with no cause is the unexplained absence this repository refuses.
 */
export type McpResume =
  | { readonly kind: "cursor"; readonly cursor: string }
  | { readonly kind: "offset"; readonly nextOffset: number }
  | { readonly kind: "watermark"; readonly updatedSince: string }
  | { readonly kind: "none"; readonly why: string };

/**
 * Whether there is more material upstream — and the third arm is the point.
 *
 * `exhausted` and `more` are what a well-behaved API tells you. `unknown` is what the one real
 * MCP server measured here actually does: `search` returns up to `limit` rows and says nothing
 * about whether more exist. Folding `unknown` into `exhausted` would let a full page render as
 * a complete portfolio — the honest-empty bug at page scale — so it is its own state and it
 * forces `completeness: "partial"`.
 */
export type McpRemainder =
  | { readonly kind: "exhausted"; readonly why: string }
  | { readonly kind: "more"; readonly resume: McpResume }
  | { readonly kind: "unknown"; readonly why: string; readonly resume: McpResume };

/**
 * Something that went wrong DURING the call, after some material had already arrived.
 *
 * Separate from a refusal because 900 of 1000 items is not a failure and is not a success. A
 * timeout that yields nine hundred real items must not be reported as an error (which discards
 * them) or as a result (which asserts a portfolio of nine hundred). It makes the draw partial.
 */
export type McpInterruptionCause = "timed-out" | "upstream-error" | "transport-closed";

export interface McpInterruption {
  readonly cause: McpInterruptionCause;
  /** Exactly what the transport or the server reported, not a paraphrase of it. */
  readonly detail: string;
}

/**
 * One MCP call's worth of material, as the app layer measured it.
 *
 * `attributesTo` is REQUIRED rather than defaulted to the root's own subject, so the containment
 * check runs on every call instead of on the calls where somebody remembered to pass it.
 */
export interface McpPage {
  readonly root: McpRootId;
  readonly tool: McpToolName;
  readonly attributesTo: Subject;
  readonly observations: readonly McpObservation[];
  readonly remainder: McpRemainder;
  /** Empty is the ordinary case: the call completed. */
  readonly interruptions: readonly McpInterruption[];
  /** When the call was made, as an ISO-8601 instant with an offset. */
  readonly observedAt: string;
}

// ---------------------------------------------------------------------------------------------
// THE RESULT OF DRAWING — complete, partial with everything needed to resume, or refused.
// ---------------------------------------------------------------------------------------------

/**
 * Why a draw is short of the material the tool holds. A LIST, never one cause: a page can time
 * out AND have items skipped AND leave more upstream, and reporting one of the three is the
 * error-masking bug AGENTS.md names.
 */
export type McpShortfallCause =
  | "more-upstream"
  | "remainder-unknown"
  | "interrupted"
  | "observation-skipped";

export interface McpShortfall {
  readonly cause: McpShortfallCause;
  readonly detail: string;
  /**
   * How many items this cause accounts for, or NULL when that is not knowable — which it is not
   * for a timeout or for material still upstream. Null and not zero: a count of zero would say
   * "this cost nothing", which is the collapse this repository exists to refuse.
   */
  readonly count: number | null;
}

/**
 * Why an arrived observation did not become an artifact.
 *
 * One cause today, and it is a union rather than a string because the next one belongs here too.
 * A malformed observation is NOT here: that fails the whole draw, because a partial answer to a
 * broken adapter asserts a smaller portfolio than the tool returned — the same split photo
 * intake draws between an unusable observation and an undraftable file.
 */
export type McpSkipCause = "duplicate-upstream-id";

export interface McpSkip {
  readonly upstreamId: string;
  readonly cause: McpSkipCause;
  readonly reason: string;
}

/** One item whose title states a fact about the item because the upstream returned none. */
export interface McpDraftNote {
  readonly upstreamId: string;
  readonly reason: string;
}

/** One observed field, carried to the reviewer and never into the document. */
export interface McpObservedField {
  readonly upstreamId: string;
  readonly label: string;
  readonly text: string;
}

/** One observed field refused by name, WITH its text — a refusal nobody can see is a deletion. */
export interface McpWithheldField extends McpObservedField {
  readonly reason: string;
}

/**
 * Why a whole draw was refused. Every arm is a named cause and none of them is a zero.
 *
 * `cross-tenant` and `scope-widened` are deliberately NOT one cause: the first says the material
 * was attributed to another company, the second says it was attributed to a bigger slice of this
 * one. Different mistakes, different remedies — the same reason @foliage/enterprise-policy keeps
 * "not a legal transition" apart from "not permitted for actor".
 */
export type McpDrawRefusal =
  | "root-mismatch"
  | "tool-not-permitted"
  | "cross-tenant"
  | "scope-widened"
  | "unusable-observations";

export type McpDraw =
  | {
      readonly ok: true;
      /** Everything the tool holds was drawn, and nothing that arrived was dropped. */
      readonly completeness: "complete";
      /** Exactly as `parseEnterpriseDocument` accepted them. */
      readonly artifacts: readonly EnterpriseArtifact[];
      readonly untitled: readonly McpDraftNote[];
      readonly observedFields: readonly McpObservedField[];
      readonly withheldFields: readonly McpWithheldField[];
    }
  | {
      readonly ok: true;
      readonly completeness: "partial";
      /**
       * DELIBERATELY NOT NAMED `artifacts`. A renderer that reaches for `draw.artifacts` fails to
       * compile on this arm, which is the mechanical version of "partial success must never
       * render as an honest empty result" — the caller has to narrow, and narrowing puts
       * `shortfall` in front of them.
       */
      readonly artifactsSoFar: readonly EnterpriseArtifact[];
      /** Every reason this is short. At least one, by construction. */
      readonly shortfall: readonly McpShortfall[];
      /** What the next call needs, including the honest `none`. */
      readonly resume: McpResume;
      readonly skipped: readonly McpSkip[];
      readonly untitled: readonly McpDraftNote[];
      readonly observedFields: readonly McpObservedField[];
      readonly withheldFields: readonly McpWithheldField[];
    }
  | {
      readonly ok: false;
      readonly cause: McpDrawRefusal;
      readonly issues: readonly McpRootIssue[];
    }
  | {
      /**
       * The artifacts this function built were refused by the enterprise gate. If this ever
       * occurs it is a bug in THIS module, not in the caller's input — reported with the gate's
       * own issues rather than thrown, exactly as `promoteApproved` and `photosToCandidates` do.
       */
      readonly ok: false;
      readonly cause: "round-trip-rejected";
      readonly issues: readonly EnterpriseDocumentIssue[];
    };

/**
 * Is this draw genuinely, honestly empty — the tool holds nothing, and nothing was dropped?
 *
 * The one predicate a renderer needs, so that "no material yet" is never printed over a page
 * that timed out at item nine hundred. True ONLY for a complete draw with no artifacts; a
 * partial draw with zero artifacts is not empty, it is unread.
 */
export function isHonestlyEmpty(draw: McpDraw): boolean {
  return draw.ok && draw.completeness === "complete" && draw.artifacts.length === 0;
}

// ---------------------------------------------------------------------------------------------
// REFUSED BY NAME.
// ---------------------------------------------------------------------------------------------

/**
 * Keys that would put a CREDENTIAL in a declaration file.
 *
 * Every one of these is ALREADY refused as an unknown field — no type here has any of them — so
 * this list can never widen what is accepted and can only improve the message. That is the whole
 * justification for a by-name list beside a strict key check: "unknown field" invites the reader
 * to find the right place to put their token, and there is no right place. A root declaration
 * lives in a company repository, and AGENTS.md records what a tracked secret cost this lineage.
 *
 * Matched on the key with separators removed, unlike `SCORE_SHAPED` which is matched exactly as
 * the two existing gates match it — that one must behave identically in all three places or the
 * three drift, and this one is local to this file and has no such obligation.
 */
const CREDENTIAL_SHAPED: ReadonlySet<string> = new Set([
  "token",
  "tokens",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "bearer",
  "apikey",
  "key",
  "keys",
  "privatekey",
  "secret",
  "secrets",
  "clientsecret",
  "password",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "auth",
  "authorization",
  "authorisation",
  "header",
  "headers",
  "cookie",
  "cookies",
  "session",
  "sessionid",
  "pat",
]);

/**
 * Labels an observed field may not carry, because they would read as a PROOF CLAIM made by an
 * upstream tool.
 *
 * DERIVED from @foliage/leaf's own `PROOF_TIERS` rather than listed, so a tier added there is
 * refused here without anyone remembering to. The reason it matters even though fields never
 * enter the document: they are shown to the reviewer, and a field rendered `tier: verified`
 * beside an unread candidate is the product making a proof claim on an upstream string's say-so.
 *
 * The tradeoff is stated rather than hidden, exactly as photo intake states its rating regex's:
 * a ticket system with an ordinary field named "Pending" will have it withheld and reported. That
 * is the acceptable direction — the operator sees the refusal with the text and can act on it,
 * against a proof word arriving in a review queue with an upstream's authority behind it.
 */
const PROOF_CLAIM_LABELS: ReadonlySet<string> = new Set<string>([
  "tier",
  "prooftier",
  "proof",
  "proven",
  "verification",
  ...PROOF_TIERS,
]);

/** Lowercase, with the separators a JSON key might use removed. Never applied to `SCORE_SHAPED`. */
function squash(key: string): string {
  return key.toLowerCase().replace(/[-_\s.]/g, "");
}

// ---------------------------------------------------------------------------------------------
// The small validation plumbing. Restated, like the other parsers, because only the RULES
// (`SCORE_SHAPED`, `PROOF_TIERS`, `isIsoInstant`, `containment`) must never drift — and those are
// imported.
// ---------------------------------------------------------------------------------------------

const DOCUMENT_KEYS: ReadonlySet<string> = new Set(["roots"]);
const ROOT_KEYS: ReadonlySet<string> = new Set([
  "id",
  "tree",
  "server",
  "tools",
  "attributesTo",
  "grant",
]);
const SERVER_KEYS: ReadonlySet<string> = new Set(["id", "endpoint"]);
const PERMIT_KEYS: ReadonlySet<string> = new Set(["tool", "purpose"]);

const ENDPOINT_KEYS_BY_TRANSPORT: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  stdio: new Set(["transport", "command"]),
  http: new Set(["transport", "url"]),
});
const TRANSPORTS: readonly string[] = Object.freeze(Object.keys(ENDPOINT_KEYS_BY_TRANSPORT));

const GRANT_KEYS_BY_KIND: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  "inherited-session": new Set(["kind", "principal", "declaredBy", "declaredAt"]),
  "service-principal": new Set([
    "kind",
    "principal",
    "declaredBy",
    "declaredAt",
    "authorisationRef",
  ]),
});
const GRANT_KINDS: readonly string[] = Object.freeze(Object.keys(GRANT_KEYS_BY_KIND));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Same wording rules as the other three parsers: say what was there, absence included. */
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
  issues: McpRootIssue[],
): void {
  for (const key of Object.keys(rec)) {
    if (allowed.has(key)) continue;
    const where = at === "" ? key : `${at}.${key}`;
    if (SCORE_SHAPED.has(key.toLowerCase())) {
      issues.push({
        at: where,
        message:
          `"${key}" is refused by name: no rating of any kind may enter this format. A root ` +
          `declares which tools may be read, never how good anything read through it is — and ` +
          `an MCP server that offers a scorecard tool does not get to put one in here.`,
      });
    } else if (CREDENTIAL_SHAPED.has(squash(key))) {
      issues.push({
        at: where,
        message:
          `"${key}" is refused by name: no credential belongs in a root declaration. This file ` +
          `is checked into a company repository, and this package holds no secret at all — ` +
          `authentication is INHERITED from the MCP server's own session, which is the whole ` +
          `reason the root system is MCP rather than N connectors.`,
      });
    } else {
      issues.push({
        at: where,
        message:
          `unknown field "${key}". Unrecognised fields are refused rather than ignored, so a ` +
          `misspelling cannot become an invisible omission. Allowed here: ` +
          `${[...allowed].join(", ")}.`,
      });
    }
  }
}

function requireText(
  v: unknown,
  at: string,
  what: string,
  issues: McpRootIssue[],
): v is string {
  if (nonEmptyString(v)) return true;
  issues.push({ at, message: `required: ${what}, got ${describe(v)}` });
  return false;
}

function checkInstant(
  v: unknown,
  at: string,
  what: string,
  issues: McpRootIssue[],
): v is string {
  if (!nonEmptyString(v)) {
    issues.push({ at, message: `required: ${what} as an ISO-8601 instant, got ${describe(v)}` });
    return false;
  }
  if (!isIsoInstant(v)) {
    issues.push({
      at,
      message:
        `"${v}" is not an ISO-8601 instant with an offset (e.g. 2026-08-16T09:41:00Z). A ` +
        `local-time stamp is an observation plus an unstated assumption about where it was made.`,
    });
    return false;
  }
  return true;
}

/**
 * Is this hostname the loopback interface? Compared against PARSED hostnames, never against the
 * URL string — `http://127.0.0.1.evil.example/` contains "127.0.0.1" and is not loopback.
 *
 * `URL` lowercases the host and wraps IPv6 in brackets, which is why `[::1]` is the literal
 * compared here.
 *
 * `localhost` IS ON THIS LIST AND IT IS THE WEAKEST ENTRY, said out loud rather than left for
 * someone to find: it is a NAME, and a name resolves through `/etc/hosts` and the resolver, so a
 * machine whose hosts file has been edited can point it somewhere else. apps/leaf/harvest.mjs
 * accepts only the literal `127.0.0.1` for exactly that reason, and its rule is stricter than
 * this one on purpose — it governs where a model call goes, where the open plane's whole privacy
 * claim lives. This governs a DECLARATION that nothing in this package dials, and
 * `http://localhost:<port>` is what an operator's real MCP config actually says. An adapter that
 * eventually opens one of these should resolve the name and check the address it got, which is a
 * check that belongs in the app, where there is a resolver.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]", "localhost"]);

/**
 * Check an MCP endpoint URL by parsing it. Total: `URL` throws on garbage, so it is wrapped, and
 * the failure is a named reason rather than an exception crossing this package's boundary.
 */
function checkEndpointUrl(raw: string): { readonly ok: true } | { readonly ok: false; readonly why: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      why:
        `"${raw}" is not a URL this runtime can parse. An endpoint that cannot be parsed cannot ` +
        `be checked, and an unchecked endpoint fails closed rather than being dialled.`,
    };
  }
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      why:
        `the endpoint carries credentials in its userinfo. No credential belongs in a root ` +
        `declaration — this package holds none and inherits the MCP server's own session.`,
    };
  }
  if (url.protocol === "https:") return { ok: true };
  if (url.protocol === "http:") {
    if (LOOPBACK_HOSTS.has(url.hostname)) return { ok: true };
    return {
      ok: false,
      why:
        `plaintext http is permitted only to the loopback interface, and the PARSED hostname of ` +
        `"${raw}" is "${url.hostname}". Checking the parsed hostname rather than the string is ` +
        `the point: "http://127.0.0.1.example/" contains "127.0.0.1" and is not loopback.`,
    };
  }
  return {
    ok: false,
    why:
      `"${url.protocol}" is not an MCP HTTP transport scheme. Use https to a remote server, or ` +
      `http to the loopback interface, where the material never leaves this machine.`,
  };
}

function parseEndpoint(v: unknown, at: string, issues: McpRootIssue[]): McpEndpoint | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message:
        `an endpoint must be an object with a "transport" of ${TRANSPORTS.join(", ")}, got ` +
        `${describe(v)}. It is DECLARED here, never dialled — nothing in this package opens it.`,
    });
    return null;
  }

  const transport = v["transport"];
  if (typeof transport !== "string" || !TRANSPORTS.includes(transport)) {
    issues.push({
      at: `${at}.transport`,
      message: `required: one of ${TRANSPORTS.map((t) => `"${t}"`).join(", ")} — got ${
        typeof transport === "string" ? `"${transport}"` : describe(transport)
      }. These are the two transports MCP defines.`,
    });
    return null;
  }

  const allowed = ENDPOINT_KEYS_BY_TRANSPORT[transport];
  if (allowed === undefined) return null;
  checkKeys(v, allowed, at, issues);

  if (transport === "stdio") {
    const command = v["command"];
    if (
      !requireText(
        command,
        `${at}.command`,
        `the command that starts the server (e.g. "gbrain serve")`,
        issues,
      )
    ) {
      return null;
    }
    return Object.freeze({ transport: "stdio" as const, command });
  }

  const url = v["url"];
  if (!requireText(url, `${at}.url`, "the server's URL", issues)) return null;
  const checked = checkEndpointUrl(url);
  if (!checked.ok) {
    issues.push({ at: `${at}.url`, message: checked.why });
    return null;
  }
  return Object.freeze({ transport: "http" as const, url });
}

function parseServer(v: unknown, at: string, issues: McpRootIssue[]): McpServerRef | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message: `a server must be an object with an id and an endpoint, got ${describe(v)}`,
    });
    return null;
  }
  checkKeys(v, SERVER_KEYS, at, issues);

  const id = v["id"];
  const idOk = requireText(
    id,
    `${at}.id`,
    `the tenant's own name for this server (e.g. "atlassian-prod")`,
    issues,
  );
  const endpoint = parseEndpoint(v["endpoint"], `${at}.endpoint`, issues);
  if (!idOk || endpoint === null) return null;
  return Object.freeze({ id: mcpServerId(id), endpoint });
}

function parseToolPermits(
  v: unknown,
  at: string,
  issues: McpRootIssue[],
): readonly McpToolPermit[] | null {
  if (!Array.isArray(v)) {
    issues.push({
      at,
      message:
        `required: an array of at least one permitted tool, got ${describe(v)}. This is an ` +
        `allow-list: an MCP server's whole surface is large — the one measured for this ` +
        `contract advertises 106 tools — and inheriting all of it is not a decision this ` +
        `product may make on a company's behalf.`,
    });
    return null;
  }
  if (v.length === 0) {
    issues.push({
      at,
      message:
        `must permit at least one tool. This is the one place in this repository where an empty ` +
        `array is NOT the honest empty state: a root that may call nothing behaves exactly like ` +
        `a root nobody declared, so it is refused as an unfinished declaration rather than ` +
        `carried as a root that can never draw anything.`,
    });
    return null;
  }

  const permits: McpToolPermit[] = [];
  const seen = new Set<string>();
  let bad = false;
  for (const [i, raw] of v.entries()) {
    const where = `${at}[${i}]`;
    if (!isRecord(raw)) {
      issues.push({
        at: where,
        message: `a permitted tool must be an object with a tool name and a purpose, got ${describe(raw)}`,
      });
      bad = true;
      continue;
    }
    checkKeys(raw, PERMIT_KEYS, where, issues);

    const tool = raw["tool"];
    const purpose = raw["purpose"];
    let permitBad = false;
    if (!requireText(tool, `${where}.tool`, "the tool name as the server advertises it", issues)) {
      permitBad = true;
    }
    if (
      !requireText(
        purpose,
        `${where}.purpose`,
        `why this tool is on the list, in the tenant's own words`,
        issues,
      )
    ) {
      permitBad = true;
    }
    if (permitBad) {
      bad = true;
      continue;
    }
    if (seen.has(tool as string)) {
      issues.push({
        at: `${where}.tool`,
        message:
          `"${String(tool)}" is already permitted on this root. One entry per tool: two would ` +
          `mean two stated purposes for one grant, and no way to say which one applies.`,
      });
      bad = true;
      continue;
    }
    seen.add(tool as string);
    permits.push(Object.freeze({ tool: mcpToolName(tool as string), purpose: purpose as string }));
  }
  return bad ? null : Object.freeze(permits);
}

function parseGrant(v: unknown, at: string, issues: McpRootIssue[]): McpScopeGrant | null {
  if (!isRecord(v)) {
    issues.push({
      at,
      message:
        `a scope grant must be an object with a "kind" of ${GRANT_KINDS.join(", ")}, got ` +
        `${describe(v)}. It RECORDS an authorisation the company already made; it does not ` +
        `grant one.`,
    });
    return null;
  }

  const kind = v["kind"];
  if (typeof kind !== "string" || !GRANT_KINDS.includes(kind)) {
    issues.push({
      at: `${at}.kind`,
      message: `required: one of ${GRANT_KINDS.map((k) => `"${k}"`).join(", ")} — got ${
        typeof kind === "string" ? `"${kind}"` : describe(kind)
      }.`,
    });
    return null;
  }

  const allowed = GRANT_KEYS_BY_KIND[kind];
  if (allowed === undefined) return null;
  checkKeys(v, allowed, at, issues);

  const principal = v["principal"];
  const declaredBy = v["declaredBy"];
  const declaredAt = v["declaredAt"];
  let bad = false;

  if (
    !requireText(
      principal,
      `${at}.principal`,
      `the identity the calls are made as, in the company's own id space`,
      issues,
    )
  ) {
    bad = true;
  }
  if (
    !requireText(
      declaredBy,
      `${at}.declaredBy`,
      `who inside the company recorded this root`,
      issues,
    )
  ) {
    bad = true;
  }
  if (!checkInstant(declaredAt, `${at}.declaredAt`, "when the root was declared", issues)) {
    bad = true;
  }

  if (kind === "inherited-session") {
    if (bad) return null;
    return Object.freeze({
      kind: "inherited-session" as const,
      principal: principal as string,
      declaredBy: declaredBy as string,
      declaredAt: declaredAt as string,
    });
  }

  const authorisationRef = v["authorisationRef"];
  if (!nonEmptyString(authorisationRef)) {
    issues.push({
      at: `${at}.authorisationRef`,
      message:
        `a service principal requires a re-checkable authorisation ref, got ` +
        `${describe(authorisationRef)}. An inherited session carries one person's own consent ` +
        `and needs no second record; a machine identity reads on behalf of many people, so ` +
        `"the company agreed" has to name where the company agreed — the same discipline as ` +
        `Provenance.ref, where an assertion with no handle is just an assertion.`,
    });
    bad = true;
  }
  if (bad) return null;
  return Object.freeze({
    kind: "service-principal" as const,
    principal: principal as string,
    declaredBy: declaredBy as string,
    declaredAt: declaredAt as string,
    authorisationRef: authorisationRef as string,
  });
}

/**
 * The SUBJECT GRAMMAR HAS EXACTLY ONE PARSER IN THIS PACKAGE, and this file does not fork it.
 *
 * `parseSubject` is module-private inside artifactDocument.ts, and restating it here would be a
 * second copy of the rule that decides what a tenant's org chart means — the drift that
 * `SCORE_SHAPED` is imported to avoid, in a place where the consequence is attributing work to
 * the wrong team. So the raw value is handed to the REAL parser by driving
 * `parseEnterpriseDocument` over a one-artifact probe, and its issues are re-addressed to where
 * the reader's file actually says it.
 *
 * THE PROBE IS PARSER HARNESS, NOT DATA. It never leaves this function, is never returned and
 * is never written; its only purpose is to satisfy the eight fields the enterprise gate requires
 * around a subject so that the ONLY issues it can report are the subject's. If any issue comes
 * back from outside the subject, that is a bug in this harness and it is reported as one rather
 * than silently dropped.
 */
const SUBJECT_PROBE_INSTANT = "2000-01-01T00:00:00Z";
const SUBJECT_PROBE_PREFIX = "artifacts[0].subject";

function parseSubjectViaGate(v: unknown, at: string, issues: McpRootIssue[]): Subject | null {
  const probe = parseEnterpriseDocument({
    artifacts: [
      {
        id: "subject-probe",
        title: "subject-probe",
        subject: v,
        contributors: [],
        evidence: [
          { source: "subject-probe", ref: "subject-probe", observedAt: SUBJECT_PROBE_INSTANT },
        ],
        extractor: "subject-probe",
        draftedAt: SUBJECT_PROBE_INSTANT,
        review: { state: DRAWN_REVIEW_STATE },
        release: DRAWN_RELEASE_STATE,
      },
    ],
  });

  if (probe.ok) {
    const artifact = probe.document.artifacts[0];
    if (artifact !== undefined) return artifact.subject;
    issues.push({
      at,
      message:
        `the subject probe returned no artifact. That is a bug in root.ts, not in this ` +
        `document — reported rather than thrown.`,
    });
    return null;
  }

  for (const issue of probe.issues) {
    if (issue.at === SUBJECT_PROBE_PREFIX) {
      issues.push({ at, message: issue.message });
    } else if (issue.at.startsWith(`${SUBJECT_PROBE_PREFIX}.`)) {
      issues.push({ at: `${at}${issue.at.slice(SUBJECT_PROBE_PREFIX.length)}`, message: issue.message });
    } else {
      issues.push({
        at,
        message:
          `the subject probe reported "${issue.at}: ${issue.message}", which is not about the ` +
          `subject. That is a bug in root.ts's harness, not in this document — reported rather ` +
          `than dropped.`,
      });
    }
  }
  return null;
}

/** The whole-tree subject a root's tenancy is expressed as. One line, but named, because it is
 * the tenancy boundary and it should be greppable. */
function treeSubject(tree: TreeId): Subject {
  return { kind: "tree", tree };
}

function parseRoot(v: unknown, index: number, issues: McpRootIssue[]): McpRoot | null {
  const at = `roots[${index}]`;
  if (!isRecord(v)) {
    issues.push({ at, message: `must be an object, got ${describe(v)}` });
    return null;
  }
  checkKeys(v, ROOT_KEYS, at, issues);

  const id = v["id"];
  const tree = v["tree"];
  let bad = false;

  if (!requireText(id, `${at}.id`, "a non-empty root id", issues)) bad = true;
  if (
    !requireText(
      tree,
      `${at}.tree`,
      `the tree (company) this root belongs to — a root belongs to exactly one`,
      issues,
    )
  ) {
    bad = true;
  }

  const server = parseServer(v["server"], `${at}.server`, issues);
  if (server === null) bad = true;

  const tools = parseToolPermits(v["tools"], `${at}.tools`, issues);
  if (tools === null) bad = true;

  const grant = parseGrant(v["grant"], `${at}.grant`, issues);
  if (grant === null) bad = true;

  const attributesTo =
    "attributesTo" in v ? parseSubjectViaGate(v["attributesTo"], `${at}.attributesTo`, issues) : null;
  if (attributesTo === null) {
    if (!("attributesTo" in v)) {
      issues.push({
        at: `${at}.attributesTo`,
        message:
          `required: the subject material drawn here belongs to. An artifact always belongs to ` +
          `somebody, even when that somebody is a branch rather than a person.`,
      });
    }
    bad = true;
  }

  // THE TENANCY CHECK AT THE DOOR. `tree` and the subject's own tree can disagree, and a
  // declaration whose subject sits in a different company from its root is the leak this field
  // exists to catch. Checked with `containment` rather than by comparing strings, so this file
  // holds no second copy of the containment rule.
  if (attributesTo !== null && typeof tree === "string" && tree.trim() !== "") {
    const relation = containment(treeSubject(treeId(tree)), attributesTo);
    if (relation.relation === "separate") {
      issues.push({
        at: `${at}.attributesTo`,
        message:
          `this root is declared on tree "${tree}" but attributes its material to ` +
          `${describeSubject(attributesTo)}: ${relation.why} A tree is one company and the ` +
          `tenancy boundary of this plane; a root that drew across one would be a leak rather ` +
          `than a hierarchy.`,
      });
      bad = true;
    }
  }

  if (bad || server === null || tools === null || grant === null || attributesTo === null) {
    return null;
  }
  return Object.freeze({
    id: mcpRootId(id as string),
    tree: treeId(tree as string),
    server,
    tools,
    attributesTo,
    grant,
  });
}

/**
 * Parse an untrusted value into an `McpRootDocument`, or into every reason it is not one.
 *
 * Never throws and never partially succeeds — one invalid root rejects the whole document, the
 * same rule as the other three parsers. Carrying the survivors would silently narrow which
 * sources a company believes it declared, and a source that quietly is not there is the
 * undercount failure wearing a new hat.
 */
export function parseMcpRootDocument(value: unknown): McpRootDocumentParse {
  const issues: McpRootIssue[] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          at: "(document)",
          message:
            `a root declaration must be a JSON object with a roots array — got ${describe(value)}`,
        },
      ],
    };
  }

  checkKeys(value, DOCUMENT_KEYS, "", issues);

  const rawRoots = value["roots"];
  const roots: McpRoot[] = [];
  if (rawRoots === undefined) {
    issues.push({
      at: "roots",
      message:
        `required: an array of roots. An empty array [] is valid and means a tenant that has ` +
        `declared no source yet — an honest empty state, and not the same fact as the field ` +
        `being missing.`,
    });
  } else if (!Array.isArray(rawRoots)) {
    issues.push({ at: "roots", message: `must be an array, got ${describe(rawRoots)}` });
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of rawRoots.entries()) {
      const root = parseRoot(raw, i, issues);
      if (root === null) continue;
      if (seen.has(root.id)) {
        issues.push({
          at: `roots[${i}].id`,
          message: `duplicate id "${root.id}" — root ids must be unique within a document.`,
        });
        continue;
      }
      seen.add(root.id);
      roots.push(root);
    }
  }

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  return { ok: true, document: Object.freeze({ roots: Object.freeze(roots) }) };
}

// ---------------------------------------------------------------------------------------------
// DRAWING — turning one page of observations into candidate artifacts, or into a named refusal.
// ---------------------------------------------------------------------------------------------

/**
 * The artifact id for one drawn item: `mcp:<server>/<tool>#<upstreamId>`.
 *
 * DETERMINISTIC, which is what makes the offset-resumption hazard survivable: an item that
 * repeats across two resumed pages produces the SAME id twice, and `parseEnterpriseDocument`
 * refuses duplicate ids at the document door. Segments are percent-encoded for the same reason
 * `subjectKey` encodes its own — the delimiters are otherwise forgeable by a tool name or an
 * upstream key containing "/" or "#".
 */
function drawnArtifactId(server: McpServerId, tool: McpToolName, upstreamId: string): string {
  const e = encodeURIComponent;
  return `${MCP_SOURCE_PREFIX}${e(server)}/${e(tool)}#${e(upstreamId)}`;
}

/** The `Provenance.source` label. Built from the root and the tool, never supplied by a caller. */
function drawnSource(server: McpServerId, tool: McpToolName): string {
  return `${MCP_SOURCE_PREFIX}${server}/${tool}`;
}

/**
 * A title made only of what was observed, for an item the upstream gave no title for.
 *
 * The same discipline as "(commit recorded with no message)" in @foliage/leaf's intake and photo
 * intake's file-fact titles: a statement of fact about the artifact, never invented content. The
 * upstream handle is included because it is the one observed thing that tells two untitled items
 * apart, and a review queue of identical titles is not a review queue.
 */
function titleFromUpstream(tool: McpToolName, upstreamId: string): string {
  return `${upstreamId} — item returned by ${tool} with no title`;
}

function refuse(cause: McpDrawRefusal, issues: readonly McpRootIssue[]): McpDraw {
  return { ok: false, cause, issues: Object.freeze([...issues]) };
}

/**
 * Draw one page of MCP observations into candidate artifacts.
 *
 * Everything it produces is `review: {state: "candidate"}`, `release: "internal"` and
 * `contributors: []` — unconditionally, with no input that can change any of the three — and the
 * result is then re-validated by `parseEnterpriseDocument`, so the artifacts handed back are the
 * gate's and not this function's opinion of what it built.
 *
 * Total and pure. Complexity O(observations × fields), one pass, plus an O(observations) Set.
 */
export function drawFromRoot(root: McpRoot, page: McpPage): McpDraw {
  // 1. IS THIS EVEN THIS ROOT'S PAGE? Fails closed and first, because every check below is
  //    meaningless if the page came from somewhere else.
  if (page.root !== root.id) {
    return refuse("root-mismatch", [
      {
        at: "page.root",
        message:
          `this page was drawn through root "${page.root}" and was handed to root "${root.id}". ` +
          `They carry different tool allow-lists and different tenancies, so the mismatch is ` +
          `refused rather than resolved in either direction.`,
      },
    ]);
  }

  // 2. THE ALLOW-LIST IS THE CONSENT BOUNDARY THIS PACKAGE ACTUALLY ENFORCES. Authentication and
  //    consent are inherited from the server; WHICH TOOLS is the one thing the tenant declares
  //    here, so a page from an unpermitted tool is refused even though the server answered it.
  if (!root.tools.some((permit) => permit.tool === page.tool)) {
    return refuse("tool-not-permitted", [
      {
        at: "page.tool",
        message:
          `"${page.tool}" is not on root "${root.id}"'s allow-list, which permits ` +
          `${root.tools.map((p) => `"${p.tool}"`).join(", ")}. The server answering a call is ` +
          `not the same fact as this tenant having declared that this product may read it.`,
      },
    ]);
  }

  // 3. TENANCY, via `containment` and never a second rule. Two refusals rather than one: another
  //    company, and a bigger slice of this one, are different mistakes.
  const tree = treeSubject(root.tree);
  const inTree = containment(tree, page.attributesTo);
  if (inTree.relation === "separate") {
    return refuse("cross-tenant", [
      {
        at: "page.attributesTo",
        message:
          `root "${root.id}" belongs to tree "${root.tree}" and this page attributes its ` +
          `material to ${describeSubject(page.attributesTo)}: ${inTree.why} Material drawn ` +
          `through a root may only be attributed to subjects inside that root's tree.`,
      },
    ]);
  }
  const inScope = containment(root.attributesTo, page.attributesTo);
  if (inScope.relation === "separate") {
    return refuse("scope-widened", [
      {
        at: "page.attributesTo",
        message:
          `root "${root.id}" is declared for ${describeSubject(root.attributesTo)} and this page ` +
          `attributes its material to ${describeSubject(page.attributesTo)}: ${inScope.why} A ` +
          `page may NARROW a root's subject — a root on a bough may attribute a page to a branch ` +
          `inside it — and may never widen it, because widening is how a team's declaration ` +
          `quietly becomes the company's.`,
      },
    ]);
  }

  // 4. THE OBSERVATIONS THEMSELVES. Unusable ones fail the whole draw, for the reason
  //    `photosToCandidates` fails as a whole: a partial answer to a broken adapter asserts a
  //    smaller portfolio than the tool actually returned.
  const issues: McpRootIssue[] = [];
  if (!isIsoInstant(page.observedAt)) {
    issues.push({
      at: "page.observedAt",
      message:
        `"${page.observedAt}" is not an ISO-8601 instant with an offset (e.g. ` +
        `2026-08-16T09:41:00Z). A local-time stamp is an observation plus an unstated ` +
        `assumption about where it was made.`,
    });
  }

  const drafts: Record<string, unknown>[] = [];
  const skipped: McpSkip[] = [];
  const untitled: McpDraftNote[] = [];
  const observedFields: McpObservedField[] = [];
  const withheldFields: McpWithheldField[] = [];
  const seen = new Set<string>();

  for (const [i, observation] of page.observations.entries()) {
    const upstreamId = observation.upstreamId.trim();
    if (upstreamId === "") {
      issues.push({
        at: `page.observations[${i}].upstreamId`,
        message:
          `an observation must carry the upstream's own stable handle — an issue key, a page ` +
          `id, a session id. It becomes the evidence ref, and a ref that cannot be resolved ` +
          `upstream is indistinguishable from a fabricated one.`,
      });
      continue;
    }

    if (seen.has(upstreamId)) {
      skipped.push({
        upstreamId,
        cause: "duplicate-upstream-id",
        reason:
          `"${upstreamId}" was already drawn from this page. One upstream item is one artifact; ` +
          `the repeat is reported rather than drafted twice. Repeats across RESUMED pages are ` +
          `caught the same way one level up — the artifact id is deterministic, so the ` +
          `enterprise document gate refuses the duplicate id.`,
      });
      continue;
    }
    seen.add(upstreamId);

    let fieldBad = false;
    for (const [f, field] of observation.fields.entries()) {
      const label = field.label.trim();
      if (label === "") {
        issues.push({
          at: `page.observations[${i}].fields[${f}].label`,
          message:
            `an observed field must carry the label the upstream gave it. Unlabelled text ` +
            `cannot be read by a reviewer and cannot be refused by name either.`,
        });
        fieldBad = true;
        continue;
      }
      // REFUSED BY NAME, and the text is carried WITH the refusal — a refusal nobody can see is
      // indistinguishable from a tool that returned nothing.
      if (SCORE_SHAPED.has(label.toLowerCase())) {
        withheldFields.push({
          upstreamId,
          label,
          text: field.text,
          reason:
            `"${label}" is refused by name: no rating of any kind reaches a reviewer through ` +
            `this product. It is withheld from the draw and printed here so the operator can ` +
            `see what the tool said, rather than quietly discarded.`,
        });
        continue;
      }
      if (PROOF_CLAIM_LABELS.has(squash(label))) {
        withheldFields.push({
          upstreamId,
          label,
          text: field.text,
          reason:
            `"${label}" is refused by name: it would read as a PROOF claim made by an upstream ` +
            `tool. In this product a tier is decided by evidence and a human reviewer, never ` +
            `asserted by a field in a ticket. Withheld and printed here, not discarded.`,
        });
        continue;
      }
      observedFields.push({ upstreamId, label, text: field.text });
    }
    if (fieldBad) continue;

    const upstreamTitle = observation.title.trim();
    let title = upstreamTitle;
    if (title === "") {
      untitled.push({
        upstreamId,
        reason:
          `${page.tool} returned no title for this item, so the title states that fact and the ` +
          `handle it was returned under. Nothing was composed on the upstream's behalf.`,
      });
      title = titleFromUpstream(page.tool, upstreamId);
    }

    drafts.push({
      id: drawnArtifactId(root.server.id, page.tool, upstreamId),
      title,
      subject: page.attributesTo,
      // UNCONDITIONALLY EMPTY. An MCP root cannot name a person; see the header.
      contributors: [],
      evidence: [
        {
          source: drawnSource(root.server.id, page.tool),
          ref: upstreamId,
          observedAt: page.observedAt,
        } satisfies Provenance,
      ],
      extractor: drawnSource(root.server.id, page.tool),
      draftedAt: page.observedAt,
      // UNCONDITIONALLY UNREAD, AND UNCONDITIONALLY INTERNAL. There is no input to this
      // function that can change either, which is what makes "AI output is never proof"
      // structural here rather than a rule somebody has to follow.
      review: { state: DRAWN_REVIEW_STATE },
      release: DRAWN_RELEASE_STATE,
    });
  }

  if (issues.length > 0) return refuse("unusable-observations", issues);

  // 5. THE ROUND TRIP. The gate judges what was built, including its own review-gate door — so
  //    the "candidate/internal" claim above is checked by the real parser rather than asserted.
  const validated = parseEnterpriseDocument(JSON.parse(JSON.stringify({ artifacts: drafts })));
  if (!validated.ok) {
    return { ok: false, cause: "round-trip-rejected", issues: validated.issues };
  }
  const artifacts = validated.document.artifacts;

  // 6. IS IT COMPLETE? Only when the upstream SAID there is nothing more AND nothing that
  //    arrived was dropped. Anything else is partial, carrying every cause and the resume.
  const shortfall: McpShortfall[] = [];
  let resume: McpResume;
  switch (page.remainder.kind) {
    case "exhausted":
      resume = {
        kind: "none",
        why: `${page.tool} reported the material exhausted: ${page.remainder.why}`,
      };
      break;
    case "more":
      resume = page.remainder.resume;
      shortfall.push({
        cause: "more-upstream",
        detail:
          `${page.tool} reported more material beyond this page. What was drawn is a page, not ` +
          `the portfolio.`,
        count: null,
      });
      break;
    case "unknown":
      resume = page.remainder.resume;
      shortfall.push({
        cause: "remainder-unknown",
        detail:
          `${page.tool} said nothing about whether more material exists: ${page.remainder.why} ` +
          `A caller that asked for a page, received a page, and concluded it had everything ` +
          `would be inventing a fact the server never stated — measured on gbrain 0.42.73.2, ` +
          `whose search tool returns up to a limit and reports no total.`,
        count: null,
      });
      break;
  }

  for (const interruption of page.interruptions) {
    shortfall.push({
      cause: "interrupted",
      detail:
        `the call did not finish (${interruption.cause}): ${interruption.detail} What arrived ` +
        `is real and is kept; what did not arrive is unknown, which is why this is neither an ` +
        `error nor a result.`,
      count: null,
    });
  }

  if (skipped.length > 0) {
    shortfall.push({
      cause: "observation-skipped",
      detail:
        `${skipped.length} observation(s) arrived and did not become artifacts. Every one ` +
        `carries a named cause in "skipped".`,
      count: skipped.length,
    });
  }

  if (shortfall.length === 0) {
    return {
      ok: true,
      completeness: "complete",
      artifacts,
      untitled: Object.freeze(untitled),
      observedFields: Object.freeze(observedFields),
      withheldFields: Object.freeze(withheldFields),
    };
  }

  return {
    ok: true,
    completeness: "partial",
    artifactsSoFar: artifacts,
    shortfall: Object.freeze(shortfall),
    resume,
    skipped: Object.freeze(skipped),
    untitled: Object.freeze(untitled),
    observedFields: Object.freeze(observedFields),
    withheldFields: Object.freeze(withheldFields),
  };
}
