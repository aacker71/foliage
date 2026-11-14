# Foliage portfolios at every scale

Engineering review in progress, started 2026-09-06. This document records the owner's
accepted scope and decisions as the interactive review proceeds. The owner subsequently
authorized the bounded D8 storage fix below. Other planned services remain unimplemented by
this review, and no release verdict is implied.

This extends the [product specification](PRODUCT-ARCHITECTURE-SPEC.md),
[agent ecology](AGENT-ECOLOGY.md) and [approved launch roadmap](LAUNCH-TO-CUSTOMERS-PLAN.md).
The launch roadmap's acceptance gates remain in force. Execution and review decisions are
tracked on the existing [product mapping task](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218203951743482).

## Scope accepted by the owner

Design every level of the live portfolio system: individuals, teams, organizations,
companies and entire industries. Include Novu for notifications, email and SMS. No level
has been removed from the design. Delivery sequence is not narrowed by this review.

Owner direction on 2026-09-07 fixes the selected architecture as the basis for the complete
build. The [full build plan](PORTFOLIO-SCALE-BUILD-PLAN.md) maps connected implementation,
dependencies, deployment and operations across all five offers. Its
[acceptance matrix](PORTFOLIO-SCALE-ACCEPTANCE.md) defines what must be observed before any
level is complete. A first customer launch does not discharge the remaining product scope.

The portfolio taxonomy remains:

```text
Canopy: collective layer
  Tree: company
    Bough: organization
      Branch: team, including nested teams
        Leaf: an individual's portfolio
          Leaflet: an artifact of evidence
```

Agent roles serve these scopes without creating new access rights: Photosynthesis operates
locally, Scarlet serves the individual in the cloud, Dee Dee the team, Picus the
organization/company, Fern governance, and Pango forest protection and Canopy maintenance.
The agent ecology's shorthand does not rename Tree/company or Bough/organization.

## D3 accepted: two separate industry views

Owner selected A on 2026-09-06: a private network of participating companies and a
separate public industry view.

The private network admits evidence through explicit company grants. The public view
uses deliberately published evidence and public subscriptions. Pango's responsibility for forest protection and
Canopy maintenance does not grant access to companies' private portfolios.

```text
Company-owned evidence                 Deliberately published evidence
           |                                        |
   explicit company grants                    public audience
           |                                        |
Private participating-company network     Public industry view
           |                                        |
   permitted private recipients              public subscribers
           |                                        |
   notification delivery                     notification delivery

No automatic private-network → public-view crossing.
```

Current code's company boundary is preserved as a boundary to cross deliberately:
`packages/photosynthesis-enterprise/src/subject.ts` states, "Containment never crosses
a tree boundary." A company joining the private network does not merge its tenancy with
the other companies. D5 establishes channel-content policy and D6 establishes private
person-specific disclosure authority. Grant storage and delivery lifecycle remain review items.

## Novu, selected by the owner

Novu is the chosen communication integration for the design. Its notification product
supports inbox, email and SMS, workflow conditions, digests and preferences. Its separate
Connect product supports agent conversations; the owner request does not yet specify
reply-based actions or autonomous approvals.

Primary sources inspected on 2026-09-06:

- [Repository](https://github.com/novuhq/novu): supported channels, notification and agent
  communication products, provider integrations and open-core edition distinction.
- [Workflow triggers](https://docs.novu.co/platform/workflow/trigger-workflow): subscriber
  and topic targeting, context/payload inputs and multiple-topic recipient deduplication.
- [Contexts](https://docs.novu.co/platform/workflow/advanced-features/contexts): persistent
  contextual metadata for workflows. Such metadata does not establish a Foliage access grant.

No Novu account, email/SMS provider, credentials, deployment region or commercial edition
has been selected or configured by this review. D5 below establishes channel-content
policy; retention and delivery design remain review items. No messages have been sent.

## What already exists

| Problem | Reuse candidate | Current limit |
|---|---|---|
| Individual evidence and human review | Open Leaf and Photosynthesis packages; local review/promotion/publication flows | Existing personal workflow is the foundation, not an industry authorization model |
| Company/org/team hierarchy | `packages/enterprise-policy/src/bough.ts` | Reporting placement and collaboration membership have different current representations |
| Group-owned evidence | `packages/photosynthesis-enterprise/src/artifactDocument.ts` and `subject.ts` | Team/org/company artifacts exist independently of personal ownership; application integration remains incomplete |
| Review/release rules | `enterprise-policy/src/release.ts` and `photosynthesis-enterprise/src/release.ts` | Pure transition rules do not establish authenticated identity, remote delivery or durable notification events |
| Enterprise source normalization | `photosynthesis-enterprise/src/root.ts` | Transformer consumes supplied observations; it is not live source transport or credential management |
| Public projections and revision changes | `packages/canopy/src/publicProjection.ts`, `publishedDocument.ts`, `republish.ts` | Reuse deliberate publication; do not pass private company portfolios to public renderers |
| Background collection | `apps/leaf/src/workflow.ts` on sibling `codex/customer-journeys`, observed at `51ce93f` | Reconcile before reuse; collection scheduling/history is not a notification delivery queue |

Inspections use current source, including clearly identified sibling-branch work. The main
checkout contains concurrent evidence-cell/local-file edits; this review has not changed them.
Older architecture documents contain dated capability claims, so they are used for recorded
intent and decisions rather than as proof of current implementation.

## D4 accepted: reporting and collaboration are separate

Owner selected A on 2026-09-06: one primary reporting placement within each company,
plus separately declared team/project participation and permissions. A person's primary
reporting placement does not grant every ancestor access to all their work or notifications.

The current models need to be reconciled around those distinct meanings:

- `enterprise-policy/src/bough.ts:182`: "A person sits in one place on the org chart."
  `pathToLeaf` returns the first matching placement.
- `photosynthesis-enterprise/src/subject.ts:154`: "A leaf sits on exactly one tree and on
  zero or more branches." Its person subject contains a `branches: readonly BranchPath[]` list.

The reporting chart answers where someone reports. Participation records answer which
teams and projects they work with. Access rules answer whether they may see or act on a
specific artifact. None of these records alone is a subscription to every related event.

```text
Person in a company
  +-- Primary reporting placement --> organization chart
  +-- Team/project participation --> shared work and contribution context
  +-- Explicit permissions -------> authorized evidence and actions

Event about an artifact
  --> responsible participants with current permission
  --> applicable notification subscription
  --> permitted delivery channel
```

A team/org/company artifact can exist without inventing an individual owner. Its assigned
reviewers and contributors remain explicit. Collaboration must not duplicate the person
in company headcounts or silently expand visibility through reporting ancestry.

## D5 accepted: notices by default, controlled email summaries

Owner selected A on 2026-09-06. Every level uses generic notices by default. SMS always
contains only a generic notice and an authenticated link. Email may contain a bounded,
redacted summary only when explicit disclosure policy, current recipient authorization
and the recipient's channel preferences permit it. Sensitive fields remain excluded.

The summary is a deliberately permitted external copy. Raw evidence and private review
notes are excluded from default messages. Notification templates and links must not
smuggle private evidence into a nominally generic notice.

The approved launch plan states: "It does not promise recall of downloads or instant backup
erasure" (line 21), and requires fresh authority checks before serving withdrawn content
(line 873). Email/SMS content already delivered exists outside that authenticated read path.
The enterprise deployment intent also permits a fully on-premises configuration
(`AGENT-ECOLOGY.md:54–62`), so permitting an external channel is a separate declared policy.

Recipient authorization, permission to use the external channel, permission to disclose
summary content and notification preferences are distinct checks. A subscription or Novu
topic membership alone establishes none of the other permissions. If an enterprise policy
does not allow the external channel, delivery through that channel is not permitted.

```text
Currently authorized recipient
  --> external channel permitted?
  --> recipient preferences permit delivery?
  --> SMS: generic notice + authenticated link
  --> Email: generic notice + authenticated link by default
       --> explicit summary disclosure policy also permits content?
            --> bounded, redacted email summary may be sent

Link opened --> current Foliage access check --> allowed evidence or unavailable
Already delivered message --> external copy; withdrawal cannot promise recall
```

This decision defines the design. It does not configure a provider, send messages or
establish an implemented delivery guarantee. Durable dispatch, retries and revocation
between scheduling and delivery remain architecture review items.

## D6 accepted: company and personal authority for private sharing

Owner selected A on 2026-09-07. Sharing a named person's evidence or contribution through
the private participating-company network requires both company authorization for the
company evidence and that person's authorization for the person-specific disclosure.
Neither approval substitutes for the other.

Scoped, revocable grants may cover future matching updates; this does not require a new
prompt for every notification. The grant must make its permitted audience and content
scope explicit. A new company, a broader audience or content outside that scope cannot
inherit permission merely because a previous update was allowed.

| Authority | What it permits | What it does not permit |
|---|---|---|
| Source company grant | Sharing the specified company-controlled evidence with the specified private audience | Sharing another company's evidence or substituting for a named person's permission |
| Personal grant | Disclosure of the specified claims about that person to the specified private audience | Overriding company restrictions on company-controlled evidence |
| Recipient access and preferences | Reading currently permitted evidence and receiving permitted notifications | Creating either source authorization above |

Company-authorized group work may still be shared after personal claims and identifying
details are removed. Removing only the contributor field is insufficient if the remaining
title, prose, evidence or media still identifies the person. The resulting projection must
remain truthful and supported by the evidence; no contributors are invented.

```text
Company evidence + proposed private audience
  --> current company grant covers the disclosure?
  --> contains person-specific evidence or identifying claims?
       +-- yes --> each affected person's current grant covers those claims?
       |            +-- yes --> permitted personal projection
       |            +-- no  --> withhold those claims; no implicit consent
       +-- no  --> permitted group projection
  --> current recipient access
  --> D5 channel and content policy + recipient preferences
  --> eligible notice or explicitly permitted summary
```

Refusal, expiry and withdrawal stop future use of the affected grant. They do not erase
historical evidence or establish recall of previously delivered external copies. Dispatch
and read paths must consult current authority; durable cancellation and in-flight delivery
semantics remain part of the delivery architecture review.

The current company boundary refuses cross-company containment
(`photosynthesis-enterprise/src/subject.ts:248–252`). The launch plan states that
"payer/organization membership cannot substitute for subject authority" (line 849).
Group artifacts can honestly contain no named contributors
(`photosynthesis-enterprise/src/artifactDocument.ts:129–133`), so group-owned work and
person-specific claims remain distinct. This decision concerns the private participating-company
view. It does not authorize public publication or transfer personal portfolio ownership.

## D7 accepted: the person performs final personal publication

Owner selected A on 2026-09-07. The person confirms each publication or replacement of
their personal portfolio after any required company approval. There is no delegation of
that final action, including delegation for an exact approved revision. Coordinated launches
must allow each person to complete their own publication step.

Company approval authorizes disclosure of company-controlled material; it does not become
the person's publication instruction. D6 standing grants cover private sharing and cannot
authorize a public publish or replacement. Sending or opening a notification is not itself
a publication action.

```text
Personal publication or replacement
  --> person reviews exact outward revision and destination
  --> required company disclosure approval remains current
  --> authenticated person performs final confirmation
  --> recheck current authority and reviewed revision at commit
  --> actual publication commit
  --> notification becomes eligible under D5 and current recipient authority

Company approval alone ------------------X--> personal publication
Private D6 grant ------------------------X--> public publication
Named representative's action -----------X--> personal publication
```

Authorized representatives may publish group-owned portfolios within their explicit
team/organization/company authority. This does not make them owners of members' personal
portfolios. Person-identifying claims in group publications still require authority covering
public disclosure; private D6 grants cannot supply it.

The approved launch plan requires "subject-only publish/withdraw"
(`LAUNCH-TO-CUSTOMERS-PLAN.md:953`), while the current transition table permits
`actors: ["subject", "policy_owner"]` for both publish and withdraw
(`enterprise-policy/src/release.ts:90–108`). The older engineering plan's public gate
"does not care who operates it" (`ENGINEERING-PLAN.md:542–546`) predates that launch rule.
Implementation must remove blanket company-role authority over a person's whole publication
and enforce the actual actor's identity and authority for the affected artifact.

Revocation of permission for company-controlled evidence remains a distinct scoped operation
from withdrawal of a person's entire portfolio. Its serving behavior must honor current
permission without granting the employer control of unrelated personal work. D7 does not
establish an implemented revocation or publication service.

## UX1: approval must be clear and low effort

Owner requirement, 2026-09-07: "the approval must be easy and intuitive informative while
effortless." This applies at every portfolio level. It adds an interaction requirement;
it did not select D8's storage choice or relax D3–D7's authority rules.

The review view must answer, before the person acts: what changed, why their decision is
needed, who will receive access, and what this action permits. Supporting evidence is
available beside the relevant claim without forcing everyone through a separate audit page.
Keep the consequence and any material limitation visible when the evidence is collapsed.

The following is a layout contract, not a populated customer example:

```text
Return to requests                    Acting as: [person / represented group]

[Specific decision requested]
[Brief factual explanation of the change and why this person is asked]

What changed      [content and evidence differences from the reviewed version]
Who can see it    [explicit audience; private or public]
This action      [review / company release / private grant / public publication]
Still needed     [other required permissions, or none]

[Actual content preview; material restrictions remain visible]
  Evidence for this claim [expand]
  Exact changes and permitted audience [expand]

[Action named by its effect]   [Request changes / decline]   [Leave for later]

[After commit: saved outcome, effective visibility and next available action]
```

### One interaction pattern, distinct decisions

| Scope | What the reviewer must understand | Action meaning |
|---|---|---|
| Leaf, individual | Exact proposed account of their work and supporting evidence | Record draft review; show attribution, entry into the Leaf and publication as separate states |
| Branch, team | Actual team-owned artifact, named contributions and declared team audience | Approve in the reviewer's explicit team capacity; membership is not contribution evidence |
| Bough, organization | Organization-owned work and the actual requested disclosure | Approve the specified organizational release; reporting ancestry adds no authority |
| Tree, company | Company-controlled material, restrictions and recipient scope | Approve company release; show when the person's separate action is still required |
| Private industry network | Participating companies, specific evidence, grant scope and affected people | Grant specified private sharing; show company and personal permissions separately |
| Public industry view | Deliberately published evidence and its current source-publication status | Reader view has no approval controls; publication is decided in the owning private workflow under D7 |

Use labels that name the effect: "Approve draft", "Approve company release", "Allow private
sharing", or "Publish this version". A generic "Approve" must not stand for several of
these operations. Public publication remains the person's explicit final action for a
personal portfolio; a low-effort interface cannot hide it inside a review or notification.
Request only the approvals required by the declared policy and ownership. Do not insert
an approval at every reporting level merely because the hierarchy contains that level.

### Remove repeated work

- Notification links open the exact pending review. If sign-in is needed, return to that
  review afterward. Reuse a valid session rather than asking for identity on every item.
- In authenticated hosted/enterprise flows, obtain the actor from the verified session.
  In local flows, retain a previously declared reviewer identity and let the person change it;
  do not infer it from source authors or a default company role.
- Require no new prose for routine approval. Keep corrections and refusal reasons beside
  the affected claim, requesting the information needed to resolve it. Preserve entered
  corrections, expanded evidence and queue position through validation errors and return visits.
- Preserve an existing review when its complete reviewed content and context are unchanged.
  Reuse an applicable D6 standing grant for matching private updates. Show already satisfied
  permissions instead of asking for them again. D7 still requires the person's final action
  for each personal public publication or replacement.
- Show content, audience, policy or permission changes that invalidate the pending decision,
  explain what needs another decision, and retain unrelated work. An old approval must not
  silently stretch to new content or an expanded audience.
- Put the consequence beside the final button. Do not add a second generic "Are you sure?"
  dialog to a review that already makes the action and its scope explicit. Preserve the
  required explicit consent and refusal/recovery behavior of each operation.

### Outcome and recovery states

| State | What the person sees and can do |
|---|---|
| Ready | Current content, audience and one clearly named decision; evidence and changes are accessible |
| Waiting on another permission | What remains outstanding and the person's own available action; no repeated request for a completed step |
| Changes requested | Actionable reason attached to the relevant claim; resume corrections with the original context |
| Stale content or scope | The material change and a refreshed review; preserve edits without automatically resubmitting them |
| Already decided | The recorded outcome and current effective state; repeated submission cannot perform the operation twice |
| Save in progress or outcome uncertain | Persistent status and a safe way to resume checking the same operation; no premature success message |
| Saved | What was saved and what becomes visible, with the actual next step; notification delivery has its own status |
| Withdrawn, expired or inaccessible | Honest unavailability and any authorized recovery action; no private preview disclosed to a former recipient |
| Nothing awaiting review | Honest empty state with a useful return destination; no invented request or approval button |

Opening an email/SMS link is navigation, never a mutation. Email scanners and preview
fetches cannot approve or publish. The authenticated decision uses a protected form/action
bound to the reviewed content and scope; the server checks current authority at commit.
Receipt text distinguishes draft approval, release permission, actual publication and
notification delivery. This outcome contract does not choose D8's persistence mechanism.

### Presentation and acceptance

Follow [UI-FOUNDATION.md](UI-FOUNDATION.md): reuse `@foliage/ui` and the selected shadcn
controls, themed only by `@foliage/tokens`. Private approvals use night; the public-reader
preview uses day. Preserve native links/forms and keyboard operation. On narrow screens,
use one reading column with the action reachable without losing the decision summary.
Use visible labels, focus and status announcements; honor reduced motion. Approve and
decline remain comparably legible rather than using visual pressure to obtain approval.

The current Leaf review already binds the reviewed version (`apps/leaf/src/render.ts:2355`),
keeps rejection reasons conditional (`:2362–2364`) and preserves error drafts. Reuse those
behaviors. The enterprise renderer's generic event buttons (`renderCompany.ts:128–143`)
need the same content/audience context before they can support this interaction contract.
Acceptance during implementation must show that a person can identify the change, audience
and effect, inspect support, decide or request a correction, and explain the resulting state
without operator help. Exercise keyboard and a real narrow viewport, stale updates, lost
responses, a second approver completing the request and return from sign-in. Record actual
observations and interventions; no usability timing or successful trial is claimed here.

## D8: transactional outbox selected; local Enterprise storage fixed

On 2026-09-07, the owner instructed, "Fix the storage now." This authorizes proceeding
with the recommended transactional outbox: save notification intent in the same commit
as the domain change, then deliver it separately. No further storage-option confirmation
is pending. It does not authorize provider configuration or sending notifications.

The existing single-host Enterprise implementation now has one versioned document for
release history and pending events. The protected release form carries a stable operation
ID and reviewed history length. `commitRelease` locks, reads current bytes, validates,
checks matching retries before stale history, applies the domain transition and writes
state plus event atomically with file/directory sync before acknowledging success.

Malformed, unreadable, unsupported or inconsistent documents remain intact and produce
errors. Valid legacy history migrates only on a successful change, with no historical
notification backfill. Initialization cannot overwrite existing state. New installations
use a permanent home-directory path; existing temporary-path state requires deliberate
migration/selection rather than silently appearing empty.

```text
Existing local Enterprise release POST
  --> shared document lock
  --> current validated history + operation lookup
  --> legal transition against reviewed history
  --> ONE durable document { release history, pending event/operation receipt }
  --> saved result or matching replay

Pending event --> retained for future authorized dispatcher
                   Novu/provider delivery is not implemented by this storage fix
```

Events use `enterprise.release.changed`; they never claim `publication.committed`.
The Enterprise handler still records a release state without invoking the actual public
publisher. The standalone Canopy publication/withdrawal file paths are unchanged by this
fix, and the planned hosted transaction still needs its database adapter. Hosted authority
must atomically commit publication state, consent, operation receipt and pending event;
an unrelated second JSON write would not establish that guarantee.

The implementation and recovery contract is in
[ENTERPRISE-RELEASE-STORAGE.md](ENTERPRISE-RELEASE-STORAGE.md). Work is tracked in
[the storage task](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218243750925990).
The isolated implementation passes `pnpm check`: 1,632 tests, no failures or skips, with
boundary, egress, duplication, findings and type gates. Actual subprocess and HTTP checks
cover crashes, concurrent writers, legacy migration, malformed bytes and repeated requests.
No customer, browser, hosted-service or notification-delivery acceptance is claimed.

Remaining delivery design includes current grants at dispatch, per-recipient delivery
records, leases/retries, cancellation, provider acknowledgements, retention and deployment
placement. The current outbox stores pending events only. These are follow-on integration
requirements, not features supplied by the local storage patch.

## D9 accepted: Vercel hosting with Supabase authority and private storage

On 2026-09-07, the owner selected Supabase: "Supabase it is for that." Hosted apps run
on Vercel; Supabase Postgres holds authoritative application state and private Supabase
Storage holds explicitly shared artifacts and media. Personal source evidence remains
local. This provider decision does not itself provision resources, deploy a service or
implement the hosted adapter. It does not select Supabase Auth; account/session identity
and the hosted admission contract remain separate implementation requirements.

| Responsibility | Selected location and contract |
|---|---|
| Hosted application and reader routes | Vercel; every content read checks current authority before serving permitted bytes |
| Durable authority | Supabase Postgres: ownership, reporting placement and membership, grants, approvals, publication revisions and withdrawal generations |
| Transaction history and retry/delivery intent | Supabase Postgres: commit the domain change, history, operation receipt and outbox event in one transaction, as required by D8 |
| Shared artifact and media bytes | Private Supabase Storage: immutable, explicitly admitted objects; company approval alone does not authorize personal publication |
| Personal source evidence | The person's local workflow; hosted storage receives only the payload deliberately admitted for its permitted audience |
| Notifications | Novu receives minimized delivery instructions from the durable outbox after current grant, recipient and channel checks; provider acceptance is not delivery |

Object staging is separate from the database transaction even though both services come
from Supabase. Check an existing operation before staging; for a new operation, stage
immutable private bytes, then atomically commit their authoritative pointer, current
authorization/consent, history, receipt and pending event. A failed transaction leaves
the old publication head intact. Cleanup may remove unreferenced staged objects, but
must not delete a current object or undo a committed receipt.

Every read beginning after acknowledged withdrawal must observe the committed revocation.
Pages, HEAD requests, Leaflets, media, downloads, listings, previews and historic deployment
routes must all pass the authority gate. A public object URL, reusable signed URL or cached
positive status must not bypass it. Database authority outages produce an honest failure;
they do not permit serving old bytes. D3–D7 audience and approval rules remain unchanged.

### Next implementation gates

1. Inspect the existing Vercel and Supabase resources before configuration changes. Record
   US compute and data regions, storage, replicas, backups, logs and applicable notification
   processing. A provider selection or primary database region does not establish the
   complete US residency requirement.
2. Implement the hosted schema, server ownership/grant checks and database access policies,
   then the D8 transaction and immutable-object staging adapter. Prove isolation, matching
   retries, stale revisions, concurrent changes and failures between upload and commit.
3. Route every content read through current authority and exercise withdrawal across real
   serving instances, object/media URLs, caches, previews and old deployments. Retain the
   accepted distinction between company release approval and the person's final publication.
4. Establish and rehearse database and object recovery together. Supabase database backups
   do not include Storage object bytes. Record object backup/restore coverage separately;
   restore current revocation authority before serving, preserve operation receipts and
   pending events, and detect missing objects without resurrecting withdrawn content.

Provider references supporting implementation planning:
[Vercel storage](https://vercel.com/docs/storage),
[Supabase regions](https://supabase.com/docs/guides/platform/regions), and
[Supabase backups](https://supabase.com/docs/guides/platform/backups).
These describe provider capabilities and limits, not inspected Foliage settings or a
successful deployment/restore. Hosted and notification acceptance remain open.

## Review progress

| Section | Status |
|---|---|
| Scope challenge | Every level retained; Novu added by owner |
| Architecture | In progress; D3–D7 accepted, D8 outbox selected and local storage fixed, D9 Vercel/Supabase providers accepted; hosted authority, delivery and deployment integration remain |
| Code quality | Pending |
| Tests and execution diagrams | Required acceptance matrix and full-build dataflow added; detailed test-design review and execution evidence remain pending |
| Performance | Pending |
| Implementation tasks, failure modes and final review report | Full-build execution map and failure/recovery requirements added; final engineering review report remains pending |

Evidence directory: `~/.gstack/projects/aacker71-foliage/scale-eng-review-20260906/`.
The owner-authorized D8 implementation ran the checks recorded above. Customer, deployment
and production acceptance remain open. Earlier local-safety tests remain evidence for their
original commit and scope.
