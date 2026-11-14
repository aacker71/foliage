/**
 * The enterprise plane: the org chart, and the release decisions attached to it.
 *
 * Built on the Open Design Foliage system — `.plane-bar--internal`, `.chip--{state}`,
 * `.cell`, `.rachis`, `.counts`, `.btn`, `.stack`. Screen-local rules are named `ent-*`.
 *
 * THE PLANE MUST BE UNMISTAKABLE. This is the private face: internal work, not yet public,
 * some of it never to be. The design system inverts the whole band for it, and E3 exists
 * as a capability precisely so that "which plane am I looking at" is never a guess.
 *
 * TWO THINGS THAT LOOK SIMILAR AND ARE NOT, kept visually apart on purpose:
 *   RELEASE STATE   internal → proposed → in_review → approved → live, plus withdrawn.
 *                   The company's decision about EGRESS. Rectangular chip.
 *   PROOF TIER      verified / pending / excluded. What the evidence establishes about ONE
 *                   record. Shown per record in a release review, never tallied per person:
 *                   a per-person count on an employer screen invites ranking people.
 * A leaf can be `verified` and `internal` at once — proven, and deliberately not public.
 * Blurring the two would let "approved" read as "true", which is exactly wrong.
 *
 * EVERY CONTROL ON THIS PAGE IS ONE THE MACHINE WILL ACCEPT. Buttons come from
 * `availableEvents(state, actor)`, so the UI cannot offer a transition that would be
 * refused — and because the machine is still consulted on POST, a stale page cannot force
 * one either.
 */

import { ui, workspaceHeader } from "@foliage/ui";
import { randomUUID } from "node:crypto";

import {
  isListedOnLeaf,
  leafletVisibility,
  type Leaf,
  type PublishPolicy,
  type SubjectsOwnLeaflet,
} from "@foliage/leaf";
import {
  availableEvents,
  companySize,
  duplicateLeaves,
  everyLimb,
  isContentsBound,
  isPublic,
  limbSize,
  releaseContents,
  releaseContentsDigest,
  type Actor,
  type Bough,
  type Branch,
  type CompanyTree,
  type Limb,
  type ReleaseState,
} from "@foliage/enterprise-policy";

import type { CompanyLoad, CompanyLoadFailure } from "./companyDocument.ts";
import {
  allHistory,
  approvedContents,
  CHANGED_SINCE_APPROVAL,
  historyOf,
  stateOf,
  type ReleaseStore,
} from "./releaseStore.ts";

/** Which of the three pages on `.fol-nav` is current, for `aria-current="page"`. */
type ActivePage = "chart" | "releases" | "members";

/**
 * Each member's publish policy, for the rail a release review applies. Required, like the
 * canopy's `LeafPolicyLookup`: a caller with no member policy passes the shipped default.
 */
type MemberPolicyLookup = (leaf: Leaf) => PublishPolicy;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Release state → the design system's chip class + the word shown.
 *
 * `live` IS NOT CALLED LIVE. Publish records the decision and a `pending` outbox event, and
 * nothing in this repository consumes that event (docs/ENTERPRISE-RELEASE-STORAGE.md), so no
 * reader can reach the work. The word says what happened; when a publisher exists, its
 * delivery receipt — not this state — is what may say "live".
 */
const STATE_CHIP: Readonly<Record<ReleaseState, { cls: string; word: string }>> = Object.freeze({
  internal: { cls: "internal", word: "Internal" },
  proposed: { cls: "proposed", word: "Proposed" },
  in_review: { cls: "review", word: "In review" },
  approved: { cls: "approved", word: "Approved" },
  live: { cls: "live", word: "Publish recorded · not delivered yet" },
  withdrawn: { cls: "withdrawn", word: "Withdrawn" },
});

/** The company counts' and each limb's label for `isPublic` states, for the same reason. */
const PUBLISH_RECORDED = "Publish recorded";

const EVENT_LABEL: Readonly<Record<string, string>> = Object.freeze({
  propose: "Propose",
  open_review: "Open review",
  approve: "Approve",
  reject: "Reject",
  publish: "Publish",
  withdraw: "Withdraw",
  retract: "Retract",
});

const ACTOR_LABEL: Readonly<Record<Actor, string>> = Object.freeze({
  subject: "Portfolio owner",
  policy_owner: "Policy owner",
  system: "System",
});

const RELEASE_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  timeZone: "UTC", timeZoneName: "short",
});

type SetupKind = "connect" | "repair" | "organizations" | "members" | "member-files";

/** The manifest remains operator-managed; these steps never imply an in-browser write. */
function companySetup(kind: SetupKind, path: string | null): string {
  const next: Readonly<Record<SetupKind, { label: string; instruction: string }>> = {
    connect: {
      label: "Connect company",
      instruction: "Set FOLIAGE_COMPANY to a company manifest path, then restart Enterprise.",
    },
    repair: {
      label: "Check company file",
      instruction: "Repair the configured company manifest, then refresh this page.",
    },
    organizations: {
      label: "Set up organizations",
      instruction: "Add an organization to the connected manifest, then refresh this page.",
    },
    members: {
      label: "Add members",
      instruction: "Add member leaf references to the connected manifest, then refresh this page.",
    },
    "member-files": {
      label: "Repair member files",
      instruction: "Restore the missing Leaf files or correct their paths in the connected manifest, then refresh.",
    },
  };
  const action = next[kind];
  return `<details class="ent-setup"><summary>${action.label}</summary>
    <div class="ent-setup-body"><p>${action.instruction}</p>${path === null ? "" : `<p class="mono ent-file-path">${esc(path)}</p>`}</div>
  </details>`;
}

/**
 * The release-state chip, as MARKUP — factored out because `/members` now needs the exact
 * same cell `personRow` already drew (one PERSON, one chip, the machine's own word for their
 * state) and a second hand-written copy is exactly the "two copies drift" trap this file's own
 * header warns about for the mark. One function, both call sites.
 */
function chipHtml(state: ReleaseState): string {
  const chip = STATE_CHIP[state];
  return `<span class="chip chip--${chip.cls}" data-chip="${chip.cls}">${chip.word}</span>`;
}

/**
 * A record's tier in the words a reader outside the person's own workspace gets — the Leaf
 * app's published wording ("Pending" reads as queued; it is not). Only the subject's own tiers
 * can reach a release review, so `excluded` has no entry: `releaseContents` never yields one.
 */
const RELEASE_TIER_WORD: Readonly<Record<SubjectsOwnLeaflet["tier"], string>> = Object.freeze({
  verified: "Verified",
  pending: "Attributed, unverified",
});

/** Enough to decide from at a glance; the remainder sits in a closed disclosure, never dropped. */
const RELEASE_PREVIEW_LIMIT = 10;

/** The release states whose next decision — approve, then publish — is about these contents. */
const SHOWS_RELEASE_CONTENTS: ReadonlySet<ReleaseState> = new Set(["in_review", "approved"]);

function releaseRecordHtml(record: SubjectsOwnLeaflet): string {
  return `<li class="ent-release__record" data-leaflet="${esc(record.id)}">
        <span class="ent-release__title">${esc(record.title)}</span>
        <span class="proof proof-${record.tier}" data-pill-tier="${record.tier}">${RELEASE_TIER_WORD[record.tier]}</span>
      </li>`;
}

/**
 * WHAT APPROVING WOULD RELEASE — the subject's own public records the publish rail allows, one
 * row each, in their document order. A tier here belongs to one record (the shared `.proof`
 * badge's own contract), which is why this can show tiers when the person card no longer tallies
 * them. Unlisted records are never named or counted here: being handed a link is not consent to
 * be enumerated. "Nothing public yet" and "public records exist, the publish rules hold them all
 * back" are told apart, but the second names no cause: which rule or attribution held them back
 * is the subject's own accounting, as on the public canopy. Past the first ten, the rest sit in
 * a closed disclosure, so the reviewer can open everything they decide about.
 *
 * `id` names the section for the Approve and Publish buttons that decide about it.
 */
function releaseContentsHtml(leaf: Leaf, records: readonly SubjectsOwnLeaflet[], id: string): string {
  const shown = records.slice(0, RELEASE_PREVIEW_LIMIT);
  const rest = records.slice(RELEASE_PREVIEW_LIMIT);
  return `<section class="stack stack--1 ent-release" id="${id}" aria-labelledby="${id}-h" data-release-contents="${records.length}">
    <h3 class="fol-label ent-release__h" id="${id}-h">In this release · Public once released</h3>
    ${
      records.length === 0
        ? leaf.leaflets.some((l) => isListedOnLeaf(leafletVisibility(l)))
          ? `<p class="t-13 muted">None of ${esc(leaf.subject)}’s public records pass the publish rules.</p>`
          : `<p class="t-13 muted">${esc(leaf.subject)} has no public records yet.</p>`
        : `<ul class="ent-release__records">
      ${shown.map(releaseRecordHtml).join("\n      ")}
    </ul>${
          rest.length === 0
            ? ""
            : `
    <details class="ent-release__more" data-release-more="${rest.length}">
      <summary>Show ${rest.length} more</summary>
      <ul class="ent-release__records">
      ${rest.map(releaseRecordHtml).join("\n      ")}
      </ul>
    </details>`
        }`
    }
  </section>`;
}

function personRow(leaf: Leaf, store: ReleaseStore, actor: Actor, token: string, policyFor: MemberPolicyLookup): string {
  const state = stateOf(store, leaf.id);
  const history = historyOf(store, leaf.id);
  // Approve and publish post the digest of exactly the list shown here; the server refuses the
  // decision if the leaf's releasable records have changed since.
  const records = SHOWS_RELEASE_CONTENTS.has(state) ? releaseContents(leaf, policyFor(leaf)) : null;
  // Publish may release only what the policy owner approved. Once the records differ, the server
  // refuses it, so the card says why and offers no Publish; the new list is never shown under
  // the Approved chip as if it had been approved.
  const approved = approvedContents(store, leaf.id);
  const changedSinceApproval = records !== null && approved !== undefined && releaseContentsDigest(records) !== approved;
  const events = availableEvents(state, actor).filter((e) => !(changedSinceApproval && e === "publish"));
  const contentsId = `release-${randomUUID()}`;

  return `<article class="cell ent-person" data-person="${esc(leaf.id)}" data-release="${esc(state)}">
  <div class="row row--between ent-person__head">
    <span class="stack stack--1">
      <span class="t-20 ent-name">${esc(leaf.subject)}</span>
      <span class="fol-label">${esc(leaf.id)}</span>
    </span>
    ${chipHtml(state)}
  </div>

  ${
    records === null
      ? ""
      : changedSinceApproval
        ? `<section class="stack stack--1 ent-release" data-release-changed>
    <p class="t-13">${CHANGED_SINCE_APPROVAL}</p>
  </section>`
        : releaseContentsHtml(leaf, records, contentsId)
  }

  ${
    events.length === 0
      ? `<p class="t-13 muted ent-none">No action available to ${esc(ACTOR_LABEL[actor])}.</p>`
      : `<div class="row row--tight ent-actions">
    ${events
      .map(
        (e) => `<form method="post" action="/release">
      <input type="hidden" name="csrf" value="${esc(token)}">
      <input type="hidden" name="leaf" value="${esc(leaf.id)}">
      <input type="hidden" name="event" value="${esc(e)}">
      <input type="hidden" name="operationId" value="${randomUUID()}">
      <input type="hidden" name="expectedHistoryLength" value="${historyOf(store, leaf.id).length}">${
        isContentsBound(e) && records !== null
          ? `\n      <input type="hidden" name="contentsDigest" value="${releaseContentsDigest(records)}">`
          : ""
      }
      ${ui.button(EVENT_LABEL[e] ?? e, {
        type: "submit", size: "sm", variant: e === "approve" || e === "publish" ? "default" : "outline",
        ...(isContentsBound(e) && records !== null ? { "aria-describedby": contentsId } : {}),
      })}
    </form>`,
      )
      .join("\n")}
  </div>`
  }

  ${
    history.length === 0
      ? ""
      : `<details class="ent-history"><summary class="fol-label">Decision history — ${history.length}</summary>
    ${history
      .map(
        (h) =>
          `<p class="t-13 muted"><time datetime="${esc(h.at)}">${esc(RELEASE_DATE.format(new Date(h.at)))}</time> · <b>${esc(
            EVENT_LABEL[h.event] ?? h.event,
          )}</b> by ${ACTOR_LABEL[h.actor]} · ${STATE_CHIP[h.from].word} → ${STATE_CHIP[h.to].word}</p>`,
      )
      .join("\n")}
  </details>`
  }
</article>`;
}

function limbSection(
  limb: Limb,
  kind: string,
  depth: number,
  store: ReleaseStore,
  actor: Actor,
  token: string,
  policyFor: MemberPolicyLookup,
): string {
  const size = limbSize(limb);
  const live = limb.leaves.filter((l) => isPublic(stateOf(store, l.id))).length;

  return `<section class="ent-limb" data-limb="${esc(kind)}" data-depth="${depth}" style="--ent-depth:${depth}">
  <div class="row row--between ent-limb__head">
    <span class="stack stack--1">
      <span class="fol-label">${esc(kind)}</span>
      <span class="t-25 ent-limb__name">${esc(limb.name)}</span>
    </span>
    <span class="row ent-limb__counts">
      <span class="ent-stat"><span class="fol-label">People here</span><span class="fol-metric">${size.directLeaves}</span></span>
      <span class="ent-stat"><span class="fol-label">Beneath</span><span class="fol-metric">${size.totalLeaves}</span></span>
      <span class="ent-stat"><span class="fol-label">${PUBLISH_RECORDED}</span><span class="fol-metric">${live}</span></span>
    </span>
  </div>

  ${limb.leaves.map((l) => personRow(l, store, actor, token, policyFor)).join("\n")}
  ${limb.branches.map((b: Branch) => limbSection(b, "Team", depth + 1, store, actor, token, policyFor)).join("\n")}
</section>`;
}

const FAILURE_LABEL: Readonly<Record<CompanyLoadFailure["cause"], string>> = Object.freeze({
  absent: "Leaf file missing",
  unreadable: "Leaf file unreadable",
  malformed: "Leaf file is not valid JSON",
  invalid: "Not a Leaf file",
  duplicate: "Duplicate Leaf",
});

function failureBlock(failures: readonly CompanyLoadFailure[], named: number, manifestPath: string): string {
  if (failures.length === 0) return "";
  return `<section class="section stack stack--3 ent-failures">
  <span class="fol-label">${failures.length} of ${named} member ${named === 1 ? "file" : "files"} ${failures.length === 1 ? "needs" : "need"} attention</span>
  ${companySetup("member-files", manifestPath)}
  ${failures
    .map(
      (f) => `<div class="cell ent-failure" data-entry-failure="${esc(f.cause)}">
    <span class="fol-label">${esc(FAILURE_LABEL[f.cause])}</span>
    <p class="t-13 mono">${esc(f.entry)}</p>
    <details><summary>Details</summary><p class="t-13 muted">${esc(f.detail)}</p></details>
  </div>`,
    )
    .join("\n")}
</section>`;
}

const SHELL_HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/foliage.css">
<link rel="stylesheet" href="/roles.css">
<link rel="stylesheet" href="/controls.css">
<link rel="stylesheet" href="/workspace-shell.css">
<link rel="stylesheet" href="/enterprise.css">
<link rel="icon" href="/mark-icon.svg">`;

/**
 * The site navbar — `.fol-nav` from the shared component layer, wired to this app's three
 * pages. `active` drives `aria-current="page"`, the SAME non-colour-only cue foliage.css
 * documents for the shared nav: colour, weight AND a border, so removing colour still leaves
 * two cues standing.
 *
 * The plane badge's WORDS are supplied here, in markup, per the component's own contract
 * ("the badge cannot silently drift from what is actually true") — foliage.css's
 * `text-transform: uppercase` renders it "ENTERPRISE — INTERNAL" from ordinary sentence case,
 * the same source-casing convention `shell.html`'s own demo uses.
 */
function navHtml(active: ActivePage): string {
  return `<a class="ent-skip" href="#main">Skip to workspace</a>${workspaceHeader({layout:"rail",plane:"internal",section:"Enterprise",links:[
    {href:"/",label:"Org chart",current:active === "chart"},
    {href:"/releases",label:"Releases",current:active === "releases"},
    {href:"/members",label:"Members",current:active === "members"},
  ],privacy:"Private organization"})}<main id="main" class="fol-app-main"><div class="fol-app-content">`;
}

/**
 * The INTERNAL plane band, with the acting identity — extracted unchanged from what
 * `renderCompanyPage` used to draw inline, so `/releases` and `/members` carry the SAME
 * inversion this app already established as its law rather than a second, redrawn copy of it.
 * The whole face inverts here; which plane you are on is never a guess.
 */
function planeBar(actor: Actor): string {
  return `<div class="plane-bar plane-bar--internal">
  <span class="plane-bar__group">
    <span class="plane-dot plane-dot--closed"></span>
    <b class="plane-bar__name">Canopy Enterprise</b>
  </span>
  <span class="plane-bar__sep">/</span>
  <span>Private</span>
  <span class="plane-bar__spacer"></span>
  <span>Acting as ${ACTOR_LABEL[actor]}</span>
</div>`;
}

export function renderCompanyPage(
  load: Extract<CompanyLoad, { ok: true }>,
  store: ReleaseStore,
  actor: Actor,
  token: string,
  policyFor: MemberPolicyLookup,
): string {
  const size = companySize(load.tree);
  // Every leaf under every limb — boughs' own direct reports and every branch beneath them.
  // This used to be a second, hand-written recursive walk; `everyLimb` already does exactly
  // this traversal for `/members` below, and two copies of "every leaf in the tree" is the
  // same drift trap this file's header names for the mark, just about people instead of pixels.
  const allLeaves = everyLimb(load.tree).flatMap((l) => l.leaves);
  const live = allLeaves.filter((l) => isPublic(stateOf(store, l.id))).length;

  return `<!doctype html>
<html lang="en" data-face="night">
<head>${SHELL_HEAD}
<title>${esc(load.tree.company)} — Canopy Enterprise</title>
</head>
<body class="fol-app enterprise-app">
${navHtml("chart")}
${planeBar(actor)}

<div class="wrap">

  <section class="section stack stack--4">
    <h1 class="t-40 ent-limb__name">${esc(load.tree.company)}</h1>


    ${size.boughs === 0 ? "" : `<div class="counts">
      <div class="counts__cell"><span class="fol-label">Organizations</span><span class="counts__n">${size.boughs}</span></div>
      <div class="counts__cell"><span class="fol-label">Teams</span><span class="counts__n">${size.branches}</span></div>
      <div class="counts__cell"><span class="fol-label">People</span><span class="counts__n">${size.leaves}</span></div>
      <div class="counts__cell"><span class="fol-label">${PUBLISH_RECORDED}</span><span class="counts__n">${live}</span></div>
    </div>`}

  </section>

  <section class="section stack stack--3">
    <h2>Org chart</h2>
    ${size.boughs === 0
      ? `<div class="ent-empty"><p>No organizations yet</p>${companySetup("organizations", load.source.path)}</div>`
      : load.tree.boughs.map((b: Bough) => limbSection(b, "Organization", 0, store, actor, token, policyFor)).join("\n")}
  </section>

  ${failureBlock(load.failures, load.named, load.source.path)}

  <footer class="section t-13 muted"><details class="ent-source-details"><summary>Source details</summary>
    <dl><dt>Manifest</dt><dd class="mono ent-file-path">${esc(load.source.path)}</dd>
      <dt>Size</dt><dd class="mono">${load.source.bytes} bytes</dd>
      <dt>Read</dt><dd><time datetime="${esc(load.source.readAt)}">${esc(load.source.readAt)}</time></dd></dl>
  </details></footer>
</div>
</div></main></body>
</html>`;
}

/**
 * Every leaf, EVERY OCCURRENCE, paired with the org path it actually sits at.
 *
 * Deliberately not `everyLimb(tree).flatMap(l => l.leaves)` plus a `pathToLeaf` lookup per
 * leaf. `pathToLeaf` answers "where is THIS id", and for an id that appears under more than
 * one limb it always answers with the FIRST limb it finds — right for a search, wrong for a
 * listing: looking it up per row would print the SAME first path twice for a duplicated id,
 * once correctly and once for a limb the row is not actually about. `duplicateLeaves` exists
 * precisely because that happens, so this walks the tree itself and records the path each
 * leaf occupies at the moment it is found — every occurrence, not just the first.
 */
function rosterRows(
  tree: CompanyTree,
): readonly { readonly leaf: Leaf; readonly path: readonly Limb[] }[] {
  const rows: { leaf: Leaf; path: readonly Limb[] }[] = [];
  const walk = (limb: Limb, trail: readonly Limb[]): void => {
    const here = [...trail, limb];
    for (const leaf of limb.leaves) rows.push({ leaf, path: here });
    for (const child of limb.branches) walk(child, here);
  };
  for (const bough of tree.boughs) walk(bough, []);
  return rows;
}

/**
 * `/members` — a flat roster across every limb: who, where on the chart, and what the company
 * has decided about their release. Reuses `chipHtml` verbatim from the org chart's own
 * `personRow`, so this can never disagree with what "/" already says about the same person.
 * No proof-tier column: a per-person tally on an employer roster invites ranking people.
 */
export function renderMembersPage(
  load: Extract<CompanyLoad, { ok: true }>,
  store: ReleaseStore,
  actor: Actor,
): string {
  const rows = rosterRows(load.tree);
  const duplicates = duplicateLeaves(load.tree);

  return `<!doctype html>
<html lang="en" data-face="night">
<head>${SHELL_HEAD}
<title>Members — ${esc(load.tree.company)} — Canopy Enterprise</title>
</head>
<body class="fol-app enterprise-app">
${navHtml("members")}
${planeBar(actor)}

<div class="fol-page">
  <div class="fol-page-masthead">
    <h1 class="t-40 ent-limb__name">Members</h1>

  </div>

  <div class="fol-page-body">
    ${
      duplicates.length === 0
        ? ""
        : `<div class="cell ent-failure" data-duplicate-leaves="true">
      <span class="fol-label">${duplicates.length} leaf id${duplicates.length === 1 ? "" : "s"} appear${
        duplicates.length === 1 ? "s" : ""
      } under more than one limb</span>
      <p class="t-13 muted">Duplicate memberships found.</p>
      <p class="t-13 mono">${duplicates.map((id) => esc(id)).join(", ")}</p>
    </div>`
    }
    ${
      rows.length === 0
        ? load.failures.length > 0
          ? failureBlock(load.failures, load.named, load.source.path)
          : `<div class="plate">
      <p class="plate-t">No members yet</p>
      ${companySetup(companySize(load.tree).boughs === 0 ? "organizations" : "members", load.source.path)}
    </div>`
        : `<div class="fol-table-wrap" data-table="members">
      <table class="fol-table">
        <thead><tr>
          <th scope="col">Person</th>
          <th scope="col">Org path</th>
          <th scope="col">Release state</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              ({ leaf, path }) => `<tr data-person="${esc(leaf.id)}">
            <td><span class="ent-member-identity"><span class="ent-name">${esc(leaf.subject)}</span><span class="fol-label">${esc(leaf.id)}</span></span></td>
            <td>${path.map((l) => esc(l.name)).join(" › ")}</td>
            <td>${chipHtml(stateOf(store, leaf.id))}</td>
          </tr>`,
            )
            .join("\n")}
        </tbody>
      </table>
    </div>`
    }
    ${rows.length > 0 ? failureBlock(load.failures, load.named, load.source.path) : ""}
  </div>
</div>
</div></main></body>
</html>`;
}

/**
 * `/releases` — every transition the state machine has actually applied, across every leaf,
 * newest first. Reads `allHistory(store)` — see that function for why a refused attempt can
 * never appear here: the machine only ever records what it accepted.
 */
export function renderReleasesPage(
  load: Extract<CompanyLoad, { ok: true }>,
  store: ReleaseStore,
  actor: Actor,
): string {
  const rows = allHistory(store);
  // Best-effort name resolution, first occurrence wins — a name collision on a duplicated id
  // is `/members`' defect to surface, not this page's. A leaf named in the audit trail that is
  // no longer anywhere on the CURRENT chart (left the company, manifest rewritten) is real
  // too, and is shown as its bare id rather than a name invented for it.
  const nameOf = new Map<string, string>();
  for (const limb of everyLimb(load.tree)) {
    for (const leaf of limb.leaves) if (!nameOf.has(leaf.id)) nameOf.set(leaf.id, leaf.subject);
  }

  return `<!doctype html>
<html lang="en" data-face="night">
<head>${SHELL_HEAD}
<title>Releases — ${esc(load.tree.company)} — Canopy Enterprise</title>
</head>
<body class="fol-app enterprise-app">
${navHtml("releases")}
${planeBar(actor)}

<div class="fol-page">
  <div class="fol-page-masthead">
    <h1 class="t-40 ent-limb__name">Release decisions</h1>

  </div>

  <div class="fol-page-body">
    ${
      rows.length === 0
        ? `<div class="plate">
      <p class="plate-t">No release decisions yet</p>
      ${load.failures.length > 0
        ? `<a class="fol-button fol-button-outline" href="/members">Review member files</a>`
        : companySize(load.tree).leaves === 0
        ? companySetup(companySize(load.tree).boughs === 0 ? "organizations" : "members", load.source.path)
        : `<a class="fol-button fol-button-outline" href="/">Open org chart</a>`}
    </div>`
        : `<div class="fol-table-wrap" data-table="releases">
      <table class="fol-table">
        <thead><tr>
          <th scope="col">Leaf</th>
          <th scope="col">Event</th>
          <th scope="col">Actor</th>
          <th scope="col">From</th>
          <th scope="col">To</th>
          <th scope="col">When</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr data-release-event="${esc(r.event)}" data-release-leaf="${esc(r.leaf)}">
            <td>${
              nameOf.has(r.leaf)
                ? esc(nameOf.get(r.leaf) as string)
                : `<span class="mono">${esc(r.leaf)}</span>`
            }</td>
            <td>${esc(EVENT_LABEL[r.event] ?? r.event)}</td>
            <td>${ACTOR_LABEL[r.actor]}</td>
            <td>${chipHtml(r.from)}</td>
            <td>${chipHtml(r.to)}</td>
            <td><time datetime="${esc(r.at)}">${esc(RELEASE_DATE.format(new Date(r.at)))}</time></td>
          </tr>`,
            )
            .join("\n")}
        </tbody>
      </table>
    </div>`
    }
  </div>
</div>
</div></main></body>
</html>`;
}

export function renderCompanyFailure(
  load: Extract<CompanyLoad, { ok: false }>,
  active: ActivePage = "chart",
): string {
  const heading: Readonly<Record<Extract<CompanyLoad, { ok: false }>["cause"], string>> = {
    unconfigured: "No company is configured",
    absent: "No company manifest at that path",
    unreadable: "The company manifest could not be read",
    malformed: "The company manifest is not valid JSON",
    invalid: "That file is not a company manifest",
  };
  return `<!doctype html>
<html lang="en" data-face="night">
<head>${SHELL_HEAD}<title>${esc(heading[load.cause])} — Canopy Enterprise</title></head>
<body class="fol-app enterprise-app">
${navHtml(active)}
<div class="plane-bar plane-bar--internal">
  <span class="plane-bar__group"><span class="plane-dot plane-dot--closed"></span>
  <b class="plane-bar__name">Canopy Enterprise</b></span>
</div>
<div class="wrap"><section class="section stack stack--4">
<h1 class="t-32">${esc(heading[load.cause])}</h1>
${companySetup(load.cause === "unconfigured" ? "connect" : "repair", load.path)}
<details class="ent-history"><summary>Technical details</summary>
<p class="t-13 mono muted">${esc(load.detail)}</p>
${load.path === null ? "" : `<p class="t-13 mono muted">${esc(load.path)}</p>`}
</details>
</section></div>
</div></main></body></html>`;
}

/** Keep a committed decision distinct from a refusal when lock cleanup needs attention. */
export function renderReleaseResult(reason: string, outcome: "refused" | "saved" = "refused"): string {
  const title = outcome === "saved" ? "Decision saved; cleanup needs attention" : "That transition was refused";
  const detail = outcome === "saved"
    ? "The release decision and pending event were saved together. This does not confirm publication or notification delivery."
    : "No release decision was committed by this request.";
  return `<!doctype html>
<html lang="en" data-face="night">
<head>${SHELL_HEAD}<title>${title} — Canopy Enterprise</title></head>
<body class="fol-app enterprise-app">
${navHtml("chart")}
<div class="plane-bar plane-bar--internal">
  <span class="plane-bar__group"><span class="plane-dot plane-dot--closed"></span>
  <b class="plane-bar__name">Canopy Enterprise</b></span>
</div>
<div class="wrap"><section class="section stack stack--4">
<h1 class="t-32">${title}</h1>
<p class="lede">${esc(reason)}</p>
<p class="t-14 muted">${detail}</p>
<p>${ui.link("Back to the chart", { href: "/" })}</p>
</section></div>
</div></main></body></html>`;
}
