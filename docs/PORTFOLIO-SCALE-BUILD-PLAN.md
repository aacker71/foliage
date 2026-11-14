# Foliage: complete build on the selected architecture

Owner direction, 2026-09-07: “Plan as if that is the architecture are we going 100% built.”
The delivery target is the complete working product at every portfolio level and across
all five offers. Every required journey includes its UI, authority, persistence, delivery,
recovery and operating support. Phases determine construction order; they do not remove
unfinished features from scope. This is a build plan, not a claim the product is already
complete or a production release approval.

The [engineering decisions](PORTFOLIO-SCALE-ENGINEERING-PLAN.md) remain authoritative for
D3–D9 and UX1, plus the accepted D10 evaluation extension carried forward from
`codex/portfolio-achievements@5f9fa1b`. The [acceptance matrix](PORTFOLIO-SCALE-ACCEPTANCE.md) defines observable
completion. The [launch plan](LAUNCH-TO-CUSTOMERS-PLAN.md) retains L0–L6 for customer launches;
a first pilot or L6 launch does not close this complete-product commitment.

## Current delivery focus

The [Scarlet delivery workflow](SCARLET-DELIVERY-WORKFLOW.md) sequences Photosynthesis,
Scarlet and public Canopy as one end-to-end slice, with dependency-driven selection and
reopening rules. It reuses B00–B14 and the existing task records; the full scope remains.

## Fixed architecture

The selected stack and its current implementation distinction now live in
[the canonical architecture](../context/architecture.md#selected-target-architecture--distinct-from-current-implementation).
Vercel, Supabase Postgres/private Storage, Novu and enterprise private-deployment adapters
remain the selected direction. This build plan owns B00–B14 sequencing and delivery, not a
second stack definition. The transaction/withdrawal details below explain the build contract.

```text
Personal device: source grants → capture → attribution/review → private Leaf/Leaflets
                                                        |
                                  exact permitted projection + personal consent
                                                        v
Vercel authenticated intake → ownership + trusted admission + current policy checks
                           → private immutable object staging
                           → one Postgres transaction:
                             revision/head + grants/consent + history + receipt + outbox
                                      |                                 |
                     current-authority reader gate           leased outbox dispatcher
                                      |                     current recipient/channel policy
                         private object bytes                           |
                                      v                                 v
                       permitted private/public views             Novu → inbox/email/SMS
                                                                        |
                                                        authenticated link → exact review

Enterprise members/representatives → scoped group workflows → same authority contracts
Private industry network ← explicit participating-company and applicable personal grants
Public industry view     ← deliberately published, currently permitted projections
```

Database commit cannot atomically upload a Storage object. First look up the authenticated
operation receipt, then stage immutable bytes, then commit the pointer and authority together.
Failed staging/commit preserves the prior head; unreferenced bytes are cleaned up safely.
After commit, missing/corrupt bytes leave committed authority and receipts intact: fail
closed and recover the matching immutable object. Never serve an older head as fallback.
The same operation ID with a different body is refused. A lost response triggers status
recovery for the original operation, never an invented success or blind duplicate write.

Withdrawal increments durable authority state. Every subsequent read checks current status
across pages, HEAD, details, media, downloads, listings, previews and historic deployments.
No cached positive decision, public bucket or reusable object URL can bypass that check.
Authority unavailable means no protected/withdrawn bytes served. A recovered old backup must
not resurrect a revoked publication or grant; retain/reconcile revocation evidence before
restoring service. Database recovery and object-byte recovery are separate requirements.

## One model across every level

| Level | Work and decisions | Authority and reader experience |
|---|---|---|
| Individual / Leaf | Sources, evidence-backed Leaflets, corrections, portfolio versions, personal review, sharing and exit | Person performs final public publish/replace. Employer permissions cover company material only. |
| Team / Branch | Nested teams, declared members, projects, team-owned artifacts and explicit contributions | Scoped representatives review group work; team membership and reporting placement do not themselves grant disclosure. |
| Organization / Bough | Several teams, organization-owned artifacts, governance, review queues and permitted rollups | Show supporting artifacts and exceptions without inventing contributions or personal scores. |
| Company / Tree | Membership lifecycle, reporting structure, enterprise policy, company-owned artifacts and company releases | One primary placement per person per company; collaboration and access grants remain separate. Company actions cannot publish a person's portfolio. |
| Private industry network | Participating companies, shared group artifacts, private readers and subscriptions | Company grants plus affected personal grants for person-specific disclosure. Matching future updates may use scoped revocable standing grants. |
| Public industry view | Published company/group/personal work and consented discovery/subscriptions | Only deliberate current publications; private participation never implies indexing or publication. |

Design relational entities around accounts, subjects, tenant scopes, reporting placements,
collaboration memberships, grants, policies, artifact owners/contributions, immutable
revisions, consent/review records, publication heads, revocations, operations, outbox events,
recipient delivery attempts and preferences. Payer and entitlement records are separate.
Use tenant/scope keys, referential constraints, unique operation IDs, revision/generation
checks and auditable changes. Exact migrations and retention rules are B01/B02/B05 deliverables.

Share pure domain contracts where licensing permits. Keep hosted and enterprise adapters in
their allowed planes; a shared database provider does not let open code import closed code
or make cloud code depend on enterprise models. Reuse the existing public projection instead
of creating separate recruiter, hosting and industry copies of publication truth.

## Approval that is informative and effortless

The review entry shows **what changed, who will see it and what the action will do**.
Evidence expands on demand. Actions use precise verbs such as approve company material,
request correction, defer, publish this revision or withdraw this publication. Persist the
decision and display its actual receipt; publication and message delivery have their own states.

Keep the person's session, edits, evidence context and queue position through sign-in,
errors and return visits. Reuse unchanged reviews and valid matching private grants. Ask
again only when the required authority, content or audience changed. Do not require approval
at every hierarchy level or add a second confirmation to an already explicit routine action.
Personal final publication remains the person's explicit action under D7. Publishing
person-identifying claims inside a group artifact also needs the applicable personal
public-disclosure authority; a D6 private grant and a group role are insufficient.

A notice links to the exact authorized review, never performs a mutation through GET, and
survives link scanners safely. A stale review explains the change and preserves the draft.
Saved, refused, delivery-pending and outcome-unknown states must remain distinguishable.
Acceptance includes actual narrow-screen, keyboard and participant observations at each level.

## Reuse before building

Source inventory on 2026-09-07 compared three different checkpoints: this checkout
`cf69178`, `codex/streamlined-journey@0fafce5`, and the reconciliation included in
`origin/main@38488cd`. They are not one integrated release candidate.

- Reuse local intake/review/promotion and the streamlined app-owned collection, private
  draft/edit/review, handoff and portfolio pipeline. Its hosted status is explicitly
  `not-connected`; connect real hosted receipts rather than rebuild the local journey.
- Reuse Canopy readers and publish/replace/withdraw management. The newer reconciliation
  has publication format v3 and explicitly offered pending/verified titles. Do not restore
  older verified-only assumptions or discard proof labels during integration.
- Preserve `apps/enterprise/src/releaseStore.ts`'s durable local commit/history/receipt/outbox
  fix while integrating the sibling's loopback binding and mandatory explicit local actor.
  The sibling still uses the older `fire`/`saveStore` path; this needs a deliberate merge.
- Reuse group-artifact and reporting domain types. Hosted membership, group workflows and
  industry federation remain unconnected. Member website prototypes are not `apps/member`.
- Reuse the shared UI and website work already reconciled through PR #66. Asana's deployment
  investigation reports a Canopy `@foliage/tokens` packaging failure on main; this is a named
  B00 blocker to verify on the next candidate, not a fresh deployment observation here.
- Keep concurrent evidence-cell/source-store work with its current operator. Reconcile source
  grants, local decisions and hosted invalidation under the existing workflow task; do not
  introduce a second scheduler, public publisher or capability ledger.

No hosted auth/admission, Supabase adapter, Novu dispatch, billing/entitlement implementation
or completed industry service was found in the inspected source. Source absence in these
checkpoints does not prove no resource exists elsewhere. Validate the selected candidate.

## Build packages and dependencies

Each package needs a named implementation operator and independent reviewer before it enters
In progress. Dates remain unset until staffing and dependencies support them. Asana holds
execution status; Git and the acceptance records hold implementation and observed evidence.
The task directory below maps existing work and the new gaps without duplicating tasks.

| ID | Deliverable | Depends on | Completion rows |
|---|---|---|---|
| B00 | Reconcile the candidate and preserve local safety, shared UI and current workflow changes; reconcile this checkout’s v2 writer with the sibling v5 publication contract. Fix Vercel workspace packaging and exercise deployed routes. | Current branch inventory | OP02; integrated local evidence for ST04 |
| B01 | Hosted account/session recovery, subject/identifier ownership, payer separation, device admission and exact-content consent. Specify trusted provenance; authentication/signing arbitrary JSON is not proof of authorship. | B00; identity/admission contract | AU01–AU03, OF05 |
| B02 | Supabase schema, server authorization plus RLS, immutable object adapter, transactional operations/outbox, revision/withdrawal generations, authoritative readers, export inventory and migrations. | B01 for authenticated acceptance; schema design may run alongside B01 | ST01–ST03, AU02, OF05 |
| B03 | Finish the individual repeat-use journey: supported installs/sources, truthful background work, evidence correction, local preservation, authorized cloud Scarlet context, hosted receipts and portable exit. Includes the local team project portfolio (unit 39): members' own explicit contributions, joining, leaving and local approvals, each on their own machine. | B00; B01/B02 for hosted portion; unit 12's local review (B04) for the team slice | LV01, OF01, ST04, OP01/OP05; team slice: LV02 (part), UX01/UX02, AU03–AU05 |
| B04 | Implement a shared approval decision model and reusable review controls, exact revision/audience effects, personal final action, group authority, correction/defer, grant reuse and uncertain-outcome recovery. | B01/B02; existing release rules | UX01–UX03, AU03 |
| B05 | Connect Member and Organization applications to tenant structure, membership lifecycle, policy, team/org/company artifacts, contribution records, scoped releases and departure/export. | B01/B02/B04 | LV02–LV04, OF02/OF03, AU01/AU02 |
| B06 | Build the private industry network and separate public industry projection, consented discovery, subscriptions, grant expiry/revocation and permitted aggregation. | B02/B04/B05; discovery contract | LV05/LV06, OF04, AU02/AU03 |
| B07 | Connect outbox → dispatch → Novu → inbox/email/SMS. Implement current-access checks, per-recipient/channel records, leases, cancellation, preferences/digests, callback authentication and unknown-ack reconciliation. | B02/B04; channels/sender and worker contracts | NT01–NT03 |
| B08 | Connect actual agent work: Photosynthesis locally; cloud-only Scarlet; scoped Dee Dee/Picus/Fern/Pango proposals, inspections and governance assistance, with declared tools and evidence; Pango protects the forest and maintains the Canopy. | B03–B06 as each scope becomes available | AU05; AU02/AU04 |
| B09 | Complete website and the five offer UIs using existing shared controls. Wire every promised route to real behavior or honest empty/error state; perform browser and participant acceptance. | B03–B08 for corresponding routes; design work parallel | All OF/LV and UX rows |
| B10 | Package the enterprise private deployment: supported runtime/storage adapters, installation, upgrades, offline inference/inbox as applicable, disabled or explicitly permitted egress, recovery and operator documentation. | B02/B05/B08 contracts; distribution/packaging decision | OP08; OP01–OP05 |
| B11 | Operate the service: preview isolation, US placement inventory, separate database/object backups, restore preserving revocations, monitoring, limits, incident/support response, export/deletion and rollback. | B02/B07/B10 as applicable; planning starts with B00 | OP02–OP05 |
| B12 | Complete offer/entitlement and payment lifecycle across all five offers: payer/subject separation, transparent limits, receipts, cancellation/refunds, reconciliation, support and exit. | Offer/payment/terms decisions; B01/B05 identity | OP06, all OF rows |
| B13 | Accept the complete product on an integrated candidate across every level, offer and supported deployment. Close review gates, actual user outcomes, recovery/operating evidence and release decision. | B00–B12 and B14 | Every applicable matrix row; OP07 |

| B14 | Integrate the portable Evaluation Runtime: local Docker and real observer, same contract in isolated cloud/CI/customer jobs, trusted signing/import and reviewed live portfolio updates. Reuse existing sibling runtime and Dify tooling under the [runtime contract](../context/contracts/agents-and-evaluation.md). | B00; B01/B02 for hosted admission; B03/B04 for review; B07/B08/B10/B11 as applicable | EV01–EV04; AU02–AU04 and applicable ST/NT/OP rows |

Construction order is B00 plus independent design/contract work; then one complete individual
hosted slice through B01–B04 and B07; then B05, B06 and their B08/B09 experiences; then all
supported deployment and service acceptance. B10–B12 planning proceeds early so private
deployment, recovery and commercial contracts shape the implementation. No level becomes
optional because a pilot is ready sooner. All customer-facing states must be finished for
the supported release; unfinished promises stay visible as required work.

## Implementation contracts and release inputs

The [ordered unit plan](../context/specs/00-build-plan.md) refines B00–B14 into scoped work.
Shared designs have one owner: [identity/admission](../context/contracts/identity-and-admission.md),
[storage/operations](../context/contracts/storage-and-operations.md),
[notifications](../context/contracts/notifications.md),
[agents/evaluation](../context/contracts/agents-and-evaluation.md), and
[deployment/service](../context/contracts/deployment-and-service.md).

The 2026-09-14 specification selects reuse of the existing Supabase Auth adapter, a bounded
notification dispatcher using Postgres leases, stronger cloud evaluation isolation, private
enterprise packaging, opt-in discovery and provider-neutral entitlement/payment interfaces.
These are engineering choices with implementation and acceptance requirements; earlier owner
choices are preserved separately. The dated source inventory above does not supersede the
newer candidate inventory in context.

Deployment still needs actual project/issuer/sender configuration, verified regions and
limits, retention/recovery settings, private-install infrastructure, approved commercial
terms and consenting participants. Unit specifications define unavailable states and required
proof for each missing input. Live charges, messaging and production release need their
actual authorization. Unattended newly generated evaluation commands remain refused without
a separately approved bounded grant; explicit immutable scenarios can proceed within scope.

## Engineering and acceptance evidence

Use the [acceptance matrix](PORTFOLIO-SCALE-ACCEPTANCE.md) as the test/release map. Exercise
domain transitions and parsing, real database transactions, independent process/HTTP seams,
actual private object storage, provider test-mode delivery and deployed browser/customer
journeys. Include negative authority cases and fault boundaries from the dataflow above.
No local-only test can establish multi-instance withdrawal or provider delivery.

Keep `pnpm check` and applicable deployment/website gates on the exact integrated candidate.
Choose focused regressions for changed contracts, then run the required candidate gates;
record commit/environment and unresolved failures. No passing aggregate substitutes for
the row-level evidence. Code Quality, Tests and Performance sections of the interactive
engineering review remain open until their actual review outputs are recorded.

Performance design must page review queues/history, index tenant/subject/grant/operation and
pending-job lookups, bound uploads/batches/worker concurrency, avoid hierarchy-wide scans
and repeated per-artifact authorization queries, and expose backpressure honestly. Measure
representative authorized workloads before setting latency, capacity, cost or recovery
commitments. Cache immutable computation where safe; do not cache a positive authorization
in a way that violates acknowledged revocation. Record limits and degraded states per offer.

Complete means every applicable acceptance row has a responsible owner, exact candidate,
observed outcome, exercised failure/recovery path and resolved blocking defects; every offer
has its install/onboarding, repeat use, support and exit path. Real customer outcomes,
commercial readiness and production launch remain distinct from implementation acceptance.
No arbitrary “100%” progress number, prototype screen or provider account closes this plan.

## Asana task directory

Execution board: [Foliage — Launch execution](https://app.asana.com/1/1218186870488143/project/1218204163479805).
Existing task IDs are preserved. Seven missing implementation workstreams and one complete
acceptance milestone are added as Planned; none is marked implemented or accepted. Task
dependencies represent completion gates; independent design and preparation can run earlier.

| Build package | Canonical execution records |
|---|---|
| B00 | [Candidate integration](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218204163610970); [Vercel packaging](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218252954676853) |
| B01 | [Account ownership and admission](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218203989567609) |
| B02 | [Supabase storage and withdrawal](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218204116033122); [Hosted isolation and retries](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218203989579993) |
| B03 | [Individual journey](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218188421446177); [Background reviews](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218207213104886); [Non-owner and reader acceptance](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218204116230146) |
| B04 | [Shared approvals](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255647666164) |
| B05 | [Member and group portfolios](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255472828375) |
| B06 | [Private/public industry](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255279825134) |
| B07 | [Novu delivery](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255646894319) |
| B08 | [Agent roles](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255414833150); [Individual Scarlet usefulness](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218207213096142) |
| B09 | [Shared UI](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218200069641417); [Browser acceptance](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218204040227476); [Website](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218245653058726); [Hosting](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218245373360197); [Member](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218259893751061); [Organization](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218245778804580); [Recruiter](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218245444230732) |
| B10 | [Private deployment](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255414136990) |
| B11 | [Support, incident and recovery operations](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218204040190101) |
| B12 | [Full offer/payment service](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255647725013); [Pricing decisions](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218204116230284); [Terms/distribution decisions](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218204163612596) |
| B13 | [Complete-product acceptance milestone](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255279855225); [Public launch decision](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218203989385598) |

| B14 | [Portable Evaluation Runtime and phase subtasks](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218309276793790) |

The [product mapping task](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218203951743482) retains its existing review status;
the new B13 milestone carries the full-product completion claim. Pilot milestones remain
separate. Update task evidence and dependencies as the detailed review resolves contracts,
without creating parallel implementations or silently dropping a blocked offer.
