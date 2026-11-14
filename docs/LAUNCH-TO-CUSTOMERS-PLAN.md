<!-- /autoplan restore point: ~/.gstack/projects/aacker71-foliage/codex-canopy-cloud-autoplan-restore-20260905-122659.md -->
# Foliage: from the current product to serving customers

Roadmap approved, 2026-09-05, with named owner and technical gates retained. The original parallel L1/L2 sequence stands; this is not an approved production launch or a claim of readiness.

Execution authorized in conversation on 2026-09-05. The private [Launch execution board](https://app.asana.com/1/1218186870488143/project/1218204163479805) now holds L0–L6, execution tasks and dependencies. Existing roadmap tasks are reused. The connector could not alter the original project's section structure, so this dedicated execution board uses Planned / In progress / Ready for validation / Blocked / Accepted; the original roadmap retains historical/template material, explicitly labeled. Customer strategy remains provisional and production launch still requires its own decision.

Milestone records: [L0](https://app.asana.com/0/1218204163479805/1218203989457187), [L1](https://app.asana.com/0/1218204163479805/1218204116096533), [L2](https://app.asana.com/0/1218204163479805/1218204040141891), [L3](https://app.asana.com/0/1218204163479805/1218203951679589), [L4](https://app.asana.com/0/1218204163479805/1218204040057279), [L5](https://app.asana.com/0/1218204163479805/1218204040110648), [L6](https://app.asana.com/0/1218204163479805/1218204116168373). Acceptance remains incomplete until evidence is recorded on the corresponding task. Implementation integration is tracked in `docs/LAUNCH-ROUTE-INVENTORY.md`.

## Outcome

A customer can bring authorized evidence, understand and correct what Foliage derives, produce a useful portfolio, deliberately share it with a real reader, update or withdraw it, and get help when something fails. A paying customer also understands the offer, can pay and cancel, and receives the promised service.

Launch has three separate events: a supported private pilot, a hosted customer release, and a broader public release. Neither a deployed landing page nor a green test suite establishes any of these by itself.

On 2026-09-07 the owner directed planning for the complete product on Vercel, Supabase and
Novu. The [full build plan](PORTFOLIO-SCALE-BUILD-PLAN.md) and
[acceptance matrix](PORTFOLIO-SCALE-ACCEPTANCE.md) retain all portfolio levels, five offers
and supported enterprise deployments. L0–L6 sequence customer releases; even an accepted
first public launch does not mark unfinished levels or offers complete.

## Planning basis and unresolved choices

- The product specification names Individual, Individual Enterprise, Organization, Recruiter, and Portfolio Hosting. The marketing website supports them; it is not a sixth substitute product.
- The specification leads commercially with executives and has a developer acquisition track. Current implementation evidence is strongest for repository-based work. First-customer selection is pending owner input; provisionally plan a supported individual pilot consistent with the executive strategy. Do not silently redefine the market as developers.
- The owner has decided US data residency and immediate withdrawal. The release checkout's deployment record supersedes older static-publication recommendations and older claims that all serverless deployment is disallowed.
- D9 accepted, 2026-09-07: Vercel hosts the apps; Supabase Postgres holds transactional authority and private Supabase Storage holds explicitly shared artifacts/media. Personal source evidence stays local. Supabase Auth is not selected by this storage decision. Provider responsibilities and remaining implementation gates are recorded in [the portfolio-scale engineering plan](PORTFOLIO-SCALE-ENGINEERING-PLAN.md#d9-accepted-vercel-hosting-with-supabase-authority-and-private-storage); no provisioning or deployment is established by this decision.
- Immediate withdrawal means no request beginning after durable acknowledgement receives withdrawn content. It does not promise recall of downloads or instant backup erasure.
- Core invariants remain: subject control; approval separate from publication; no personal scores; honest exclusions; no invented evidence; declared identities; licensing boundaries; self-hosted fonts; Foliage tokens and correct taxonomy.
- Existing milestone terminology conflicts. The older `.loop/LAUNCH.md` uses M1/M2 for engineering work, while later design work uses them for customer outcomes. This plan uses L0–L6 to avoid silently changing either definition.
- This document proposes delivery sequencing. `.loop/STATUS.md` remains the capability evidence ledger. Asana should reference that evidence and track execution, not become a second independently maintained capability ledger.

## Evidence observed, not readiness inferred

| Area | Evidence available | What remains unproven |
|---|---|---|
| Local evidence and portfolio | Existing intake, review, promotion, rendering, and tests | A non-owner successfully completing the intended customer journey |
| Publication manager | Canopy Cloud release work and PR #50; explicit review/publish/replace/withdraw | Hosted identity, ownership, transport, storage and withdrawal across deployed instances |
| Website | Claude checkout commits `fefda2b` and `df3353d`: foundation and landing | Design acceptance, customer usefulness, production behavior and remaining review findings |
| Quality gates | Separate checkouts report different passing baselines | One integrated release candidate with matching CI, browser and deployment evidence |
| Commercial readiness | Product spec contains proposed tiers and price bands | Accepted offer, actual willingness to pay, billing/support capability |
| Asana | Release, journey and UI work captured | Accurate workstreams, milestone dependencies, owners and acceptance states |

Sources: `docs/PRODUCT-ARCHITECTURE-SPEC.md`, `docs/ENGINEERING-PLAN.md`, `LICENSING.md`, `.loop/LAUNCH.md`, `.loop/STATUS.md`, release checkout `docs/DEPLOYMENT.md`, Claude's implementation checkout, and the Foliage Product roadmap inspected in this conversation. Old document dates and test totals are not current validation.

## Release strategy

| Approach | Benefit | Cost and risk | Recommendation |
|---|---|---|---|
| Supported individual pilot, followed by hosted release | Fastest route to observing real value; reuses the local workflow | Support effort is initially high; must distinguish assistance from self-service success | Start here while building hosted foundations |
| Self-service developer launch first | Fits the most exercised source type; tests distribution and activation | Can accidentally redefine an executive-led product around developer tooling | Use if owner selects this customer or as a separate technical validation cohort |
| Full organization/member/recruiter suite before any customer | Covers the full product breadth | Longest path; many permissions, governance and demand assumptions remain untested | All remain required by the full build plan; an earlier pilot can validate one supported journey |

These are sequencing proposals, not removal of enterprise or recruiter scope. If the first buyer is an organization, the enterprise gates below move before paid launch; they cannot be bypassed with manual access to other people's private material.

## Milestones and acceptance gates

### L0 — one coherent release plan and candidate

**Deliver:** select first-customer profile and paid promise; reconcile the two implementation checkouts and PR #50 against current remote state; identify one integration branch and eventual release SHA; inventory existing tests and open findings; replace stale Asana status with evidence-backed state.

**Acceptance:** each launch task has one accountable owner, a workstream, milestone, dependencies, observable acceptance and evidence link. Missing dates stay unset. Example tasks are separated from committed scope without being treated as real deliverables. No incomplete work remains labeled accepted/shipped. Owner approves what is in the first offer and what remains later.

**UI output:** a route-and-state inventory spanning all five products, with each route marked existing, being changed, planned or gated. Agree on Foliage's information hierarchy and source of truth.

### L1 — a real individual gets useful evidence into a leaf

**Deliver:** supported onboarding from an empty machine; authorized source selection; identity declaration; configured inference route with honest unavailable states; candidate review/correction; a useful leaf and individually readable leaflets; export and recovery instructions.

For an executive pilot, use real, authorized material appropriate to that person's work. Validate existing document/source coverage before promising it. If the workflow only supports their repositories, state that limitation and either build the necessary supported source path or choose a participant with matching material. A staff-written invented portfolio is not an acceptable workaround.

**Acceptance:** a consenting non-owner uses their own material and can explain what is supported, uncertain, withheld and local. Record every operator intervention. A separate unassisted trial targets first candidates within five minutes under stated prerequisites, following the existing later M2 definition; the time is a proposed acceptance target, not observed performance. A recipient of an authorized export can identify at least one concrete capability and explain what evidence is missing, following the later M1 intent.

**UI output:** source setup, empty state, processing/progress, blocked/retry, review/correction, leaf overview and leaflet detail. Private work uses night; shared documents use day. Labels explain attribution and disclosure separately.

**Test output:** clean-install journey, unavailable provider, bad/missing source, identity mismatch, malformed candidate, no evidence, interruption/retry, correction preservation and export round trip. Use authorized real inputs and documented generated cryptographic test artifacts; never present test artifacts as customer results.

### L2 — a subject can safely publish and revoke a hosted leaf

**Dependencies:** L0; L1 validates the payload and customer interaction. Hosting foundations can begin alongside L1.

**Deliver in order:** account/session authentication and recovery; subject ownership distinct from payer; identifier reservation and non-recycling policy; authenticated artifact upload with server-side validation; durable private storage and publication revisions; hosted reader; replace/withdraw and recovery inventory.

Use the existing public projection and release rules with the selected Vercel/Supabase providers. Keep raw local evidence and provider credentials off the hosting path. Inspect existing Vercel/Supabase resources before proposing configuration changes. Specify US storage, processing, backup, restore and content-log handling explicitly, including separate recovery of object bytes. Authentication is not proof of authorship.

**Acceptance:** two independent customer accounts cannot read, replace, delete or claim each other's private material or identifiers. Every content path enforces authoritative publication status: page, leaflet, media, download, preview and listing. A stale upload cannot resurrect withdrawn content. Revocation survives retries, process restarts, rollback and restore. Unknown status fails closed. No object URL or historic deployment bypasses withdrawal. Test this on the deployed preview across multiple serving instances.

**UI output:** sign-in/recovery, exact subject/content review, explicit publish, published receipt/URL, replace comparison, withdrawal confirmation/result and ambiguous-outcome recovery. Success appears only after durable acknowledgement.

### L3 — coherent UI and website accepted against the integrated candidate

**Dependencies:** L0. Website and component work runs alongside L1/L2; final acceptance uses the same candidate as L2.

**Deliver:** Radix Primitives with Foliage-owned `@foliage/ui` components mapped to `@foliage/tokens`; remove scaffold overrides; document component usage without copying token values; Magic UI animations use Foliage motion and reduced-motion behavior. Correct destructive/excluded semantics and the full Tree/Bough taxonomy. Resolve existing Asana findings with changed-file evidence.

Public pages must explain what a customer gets, supported evidence, local versus hosted handling, how to start, and how to contact support. Add product/how-it-works, offer/pricing when decided, privacy/terms and support routes as needed to complete those journeys. No fabricated testimonials, portfolios or counts. A real portfolio example requires its subject's separate publication consent. Missing example consent blocks that example, not all truthful product explanation.

**Acceptance:** owner accepts visual design and customer-facing copy. Real viewport checks at 360, 768 and 1440 pixels plus relevant wider layouts; keyboard, focus, readable zoom, reduced motion and screen-reader checks; measured text/control contrast; correct mark, typography, tabular metrics and accent restraint. Every promised navigation/CTA reaches a functioning route or explicit honest state. Browser evidence includes viewport read-back and the tested commit. Check shipped JS/network behavior, not only source strings.

Adopting the shared Radix foundation does not itself authorize rewriting existing no-script surfaces or weakening CSP. Decide the migration per route; preserve working contracts until the replacement demonstrates equivalence.

### L4 — operationally ready for the first hosted customer

**Dependencies:** L2 and L3 for their respective customer-facing surfaces.

**Deliver:** repeatable deploy with separated preview/production data; migration and rollback procedures; tested backup/restore preserving revocations; health checks and alerts without private content; quotas/rate limits and cost limits; named support and incident owners; onboarding and recovery runbooks; third-party abuse/reporting path; retention/export/account-deletion procedures.

Owner/counsel review the offer, privacy wording, terms, subprocessors and licensing/distribution obligations before the applicable release. Do not equate no-score implementation with a legal compliance conclusion. Repository publication, external contributions and enterprise commercial terms retain their explicit gates. No license is selected by this plan.

**Acceptance:** rehearse failed publish, lost acknowledgement, status-store outage, suspected cross-account exposure, takedown, restore and customer exit. Each has detection, user-visible behavior, an accountable responder and a tested recovery. Define a support response commitment that Alex can actually staff; do not promise 24/7 coverage by default. Production access, hostname and launch authorization are resolved. No open defect permits disclosure, impersonation, silent data loss or post-withdrawal serving.

### L5 — first paid customers receive the agreed outcome

**Dependencies:** L1–L4 for hosted service. A separately agreed private/local supported engagement has a narrower deployment scope, which must be explicit to the customer.

**Deliver:** an owner-approved offer, payer/subject model, price and limits, cancellation/refund rules and a working payment path. For a small supported cohort, a hosted checkout or invoice can be simpler than a custom billing portal, provided reconciliation, entitlement changes, receipts, failures and cancellation all work. Payment status must never change attribution or transfer ownership of a person's evidence.

**Acceptance:** test payment lifecycle safely before actual charging; then observe a real consenting customer's purchase and delivery of the promised outcome. Payment retries cannot double-charge; cancellations and billing failures do not destroy customer-owned data. Customer can export and leave. Record actual service time, hosting/inference spend and reasons for purchase or refusal. Spec price bands are hypotheses, not validated willingness to pay.

**Proposed pilot cohort:** three to five suitable individuals, onboarded sequentially at first. This is a planning target, not a claim of customers. Alex selects and contacts participants; agents prepare briefs and record authorized evidence. A paid pilot is a learning milestone, not proof of product-market fit.

### L6 — controlled public launch and ongoing service

**Dependencies:** L5 evidence, a stable integrated candidate, and explicit owner go/no-go.

**Deliver:** public distribution appropriate to the chosen licensing decision; truthful launch site and onboarding; capacity limits matched to support capacity; launch-day operator coverage; rollback path; an intake queue and weekly customer review.

**Acceptance:** publish a release decision containing exact commit, environment, passed gates, known limitations, rollback owner and support contact. Keep customer intake bounded until onboarding and support effort are understood. A website launch, open-source release and recruiter discovery launch are separate decisions. Default portfolio non-indexing stays until discovery consent is decided.

After launch, review weekly: attempted and completed onboarding; where people stop; useful portfolios read by another human; support requests and response times; cost per served account; failures; repeat use; paid continuation and cancellations with reasons. These are service-operation measures, never personal proof scores or employer-facing rankings. Collect them with stated consent and minimum necessary data.

## Product breadth and expansion gates

| Product | Initial role | Gate before selling its full promise |
|---|---|---|
| Individual | Core supported pilot and customer workflow | L1, relevant L2–L5 requirements |
| Portfolio Hosting | Safe sharing, replacement and withdrawal | L2 and L4 |
| Recruiter | Read a subject-shared leaf at launch | Discovery requires separate consent, no-score-safe filters and validated reader demand; no implied search product |
| Individual Enterprise | Preserved expansion workstream; moves forward if organization is first buyer | Subject-scoped access, employer policy visibility, correction and portable exit/export |
| Organization | Preserved expansion workstream; moves forward if organization is first buyer | Durable governance store, declared membership, role isolation, separate approve/publish authority, member departure and takedown behavior |

Custom portfolio domains, broad integrations, native capture, automatic pricing-tier inference and broad discovery should have explicit later milestones unless the agreed first offer requires them. This is proposed sequencing, not unilateral cancellation.

## Workstreams, ownership and dependency discipline

| Lane | Accountable role to name | Main outputs |
|---|---|---|
| Customer and product | Alex | First customer, offer, participant contact, outcome review, go/no-go |
| Local application | One implementation owner | L1 workflow and source/provider recovery |
| Hosting and security | One implementation owner | L2 identity, ownership, transport, revocation |
| UI and website | Claude currently has implementation context; confirm assignment | L3 components, routes and interaction states |
| Testing and release | Independent reviewer plus release owner | Evidence against one candidate, negative tests, release decision |
| Customer operations and commercial | Alex initially, with named specialist support where needed | L4–L6 support, agreements, billing, costs and incidents |

The same person may hold several roles. No unassigned role is implied to be staffed. Concurrent agents need separate worktrees and file ownership; shared tokens, boundary manifests and integration belong to one named integrator. A reviewer reports findings to the implementer and records acknowledgement or an explicit delivery blocker. Recording a task alone is not delivery.

Critical path: L0 → L1 customer validation + L2 hosted foundation → L3/L4 acceptance → L5 paid delivery → L6 wider launch. UI construction, customer recruitment and runbooks can proceed concurrently; security and consent gates cannot be traded for a launch date.

## Asana structure to implement after scope agreement

Keep one launch project initially. Use status sections: Planned, In progress, Ready for validation, Blocked, Accepted. Add workstream and release-milestone fields or equivalent tags. Create L0–L6 as true milestones, dependent on their acceptance tasks. Keep the five products as a separate product field so product breadth and delivery state are not confused.

Each task must contain outcome, owner, prerequisites, acceptance, evidence/commit, and blocker or next action. A task awaiting owner input is Blocked with the precise question; one built but untested is Ready for validation. Accepted requires the stated evidence, not just implementation. Do not move every task to In progress merely because it is important.

Reconcile the existing release, journey and shadcn tasks rather than duplicate them. Isolate the five template/example tasks from committed launch scope; do not silently convert their dates into promises. Move the incomplete journey out of Shipped. Link test tasks as dependencies of acceptance milestones. Preserve historical evidence while placing current state at the top of task notes.

## Scheduling and immediate next actions

Do not manufacture a launch date from unestimated hosted work. First complete L0 and inspect the existing hosted configuration. Then estimate the remaining work in each lane with its accountable owner, available capacity and dependency constraints. Set a supported-pilot appointment separately from a public launch date. Forecast a range and update it after L1 and the first deployed revocation test.

Next actions, in order:
1. Alex confirms the first paying customer profile and names one reachable pilot participant; no outreach is sent automatically.
2. Integrator reconciles current branches and deployment decisions; produces the canonical candidate and gap list.
3. Product/UI owner maps the first customer's end-to-end screens and support needs, including failure and exit.
4. Hosting owner specifies and exercises the two-account publication/revocation path in preview.
5. Reviewer validates the remaining UI findings and ties each result to the candidate.
6. Alex approves the bounded pilot offer and support commitment; invite the first participant once its applicable safety gates hold.

Decisions still required: first customer; scope of first paid promise; payer and price; authentication/recovery approach; verified hosted configuration and hostname; distribution/license decisions; discovery policy; support owner/capacity. Existing US-residency and immediate-withdrawal decisions are not reopened.

## Autoplan review, 2026-09-05

Review in progress. This review amends the delivery plan, not product code, customer commitments, or production state. Its recommendations remain subject to the final owner gate. Base: `main`; source checkout: `codex/canopy-cloud` at `ee5899f`. The original draft is preserved at the restore path above.

### Evidence and decision precedence

The deployment decisions in the release/integration version of `docs/DEPLOYMENT.md` supersede the older copy in this checkout. On this review's live GitHub read, PR #50 remained open at `9f3aa555caf0fb1a4c0fa7db316c6eff847bbd39`; remote `codex/launch-integration` pointed to `3a9bf885d5d26c6552e0402a4a45697400f54026`. That latter commit adds launch documentation. The inventory's validation at `ab4863f` remains historical evidence for that candidate, not a passing result for every subsequent SHA. Record code-tree equivalence or rerun affected gates when advancing the candidate.

A prior durable decision dated August 26 describes v1 as a git-attributed developer portfolio. This draft's provisional executive-led pilot is a possible change to that decision, not an established supersession. Keep first-customer selection open and surface the conflict at the final gate; neither developer-first nor executive-first is silently selected here.

The inspected implementation includes the publication manager, publication format and diff, filesystem mutation lock, local source/review/promotion paths, Leaf frond, route handlers, manifests and existing test files. The launch journey spans several future releases; no assessment below claims that unimplemented hosted services passed tests.

### Decision Audit Trail

<!-- AUTONOMOUS DECISION LOG -->

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| A01 | Intake | Review the launch-to-customers draft with its two companion briefs | Mechanical | P6 | These are the active launch documents in the working tree | Reviewing the older general engineering plan |
| A02 | Intake | Preserve original draft in an external restore point | Mechanical | P5 | Amendments remain reversible and auditable | Replacing the draft without recovery |
| A03 | CEO | SELECTIVE EXPANSION; retain all five product workstreams and L0–L6 | Mechanical | P1/P2 | Complete the stated release sequence without changing product breadth | Turning this into a developer-only launch |
| A04 | CEO | Keep first-customer conflict unresolved for the owner | Taste, pending | P6 | Prior developer decision and current executive proposal need explicit precedence | Treating a document's premise as a new owner decision |
| A05 | CEO | Bind release evidence to exact candidate and content equivalence | Mechanical | P5 | Remote integration has moved beyond the tested SHA | Copying a previous test tally onto a newer candidate |
| A06 | CEO | Add a publishable-evidence eligibility check to L1 | Mechanical | P1 | Local approval does not produce verified attribution; an empty hosted result may be correct | Promising a usable public portfolio from arbitrary authorized inputs |
| A07 | CEO | Specify local versus frozen-public content contracts before promising rich hosted leaflets | Mechanical | P4/P5 | PublishedLeaflet currently has title and provenance, not body/media | Passing raw Leaf documents through as a shortcut |
| A08 | CEO | Plan all mutation outcomes, including unknown outcome, separately from failure | Mechanical | P1 | Lost acknowledgement and cleanup errors do not establish that a write failed | Showing retry as a safe blind repeat |
| A09 | CEO | Require consent-safe operation metadata and named incident responders | Mechanical | P1 | L4 alerts need enough context to recover without logging evidence | Raw content logs or an unstaffed response promise |
| A10 | CEO | Keep revocations monotonic through deployment and restore | Mechanical | P1/P5 | Rollback must never restore old public availability | Restoring application and authority state together |
| A11 | CEO | Include local concurrent review/promotion safety in L1 | Mechanical | P2/P4 | `apps/leaf/server.mjs` documents last-writer loss; multi-tab UI is in the blast radius | Relying on atomic rename alone |
| A12 | CEO | Clarify supported pilot contact, substitute comparison and price learning within L0/L1 | Mechanical | P1 | These make existing customer/product work observable without creating a new workstream | Claiming an arbitrary contact quota is necessary |
| A13 | CEO | Preserve original launch sequence while reviewing export-first alternative | User Challenge UC1, pending | P6 | Moving hosted work behind a new demand gate changes the user's sequence | Silently adding L0.5 or deleting L2/L3 scope |
| A14 | Design | Review all seven dimensions using tokens and UI foundation as the existing system | Mechanical | P4 | No root DESIGN.md does not mean no design system exists | Creating a parallel design system |
| A15 | Design | Start visual implementation from My Leaf → owner leaflet → return | Taste, recommended | P5 | The newer interaction brief makes readable evidence the first test | Review-first remains viable if reviewer completion is the first pilot bottleneck |
| A16 | Design | Add explicit state matrix, return-context and keyboard behavior | Mechanical | P1 | Launch labels alone do not specify user-visible recovery | Leaving errors and mobile navigation to implementation guesswork |
| A17 | Design | Preserve native links/forms/details; adopt shadcn per reviewed route contract | Mechanical | P4/P5 | Tokens and local controls are reusable; runtime/CSP migration is a separate seam | Global React rewrite as an incidental launch dependency |
| A18 | Design | Carry factual state in text, not botanical size/color/motion | Mechanical | P1 | Attribution has no ordering and the accent budget cannot scale with list size | Repeating chartreuse badges or inferring quality from geometry |
| A19 | Design | Keep unconfirmed publication as operation/effective-status uncertainty, not a new visibility intent | Mechanical | P5 | A lost ACK changes what is known, not the owner's private/unlisted/public choice | Adding a fourth visibility value |
| A20 | Design | Retain neutral per-artifact attribution; simplify repeated prose without changing facts | Mechanical | P1 | Pending means attributable without proof, not unattributed | Dominant-state exception coloring or silently omitting attribution |

### CEO 0A: Premise challenge

**Customer value:** a reader understanding a person's work is the outcome; completing seven milestones is an operational proxy. L1 already includes a real recipient task, which is the right feedback point. Add an explicit read-out recording the recipient's task, what evidence they used, what they could not infer, and the subject's correction, without creating a personal score.

**Evidence availability:** authorized material is necessary but insufficient for hosted publication. `reviewForPublication` in `packages/canopy/src/publish.ts` withholds every non-verified leaflet, while the existing frozen `PublishedLeaflet` contains title, tier, provenance and title-redaction state. L1 must inspect one consenting participant's actual source coverage, attribution and outward projection before L2 promises that their useful local portfolio will survive publication.

**Demand:** a supported executive pilot is a proposal, and price bands remain hypotheses. The August developer-first decision is relevant context, but it does not justify overriding this draft. Record a first-customer/first-offer decision at L0, including what existing evidence that customer can supply and what reader decision the portfolio helps.

**Platform:** request-time hosting plus durable authority is consistent with the settled immediate-withdrawal requirement. A Vercel preview check and a filesystem lock do not establish that contract across servers. US residency remains an inspection and evidence requirement; this review makes no new provider-compliance claim.

**Doing nothing:** the project retains local engineering capability and publication preparation but has no demonstrated non-owner journey or paid delivery. More UI construction alone cannot settle usefulness, input compatibility or willingness to pay. The supported pilot remains the recommended learning vehicle, with the customer choice still open.

### CEO 0B: What already exists

| Sub-problem | Existing implementation | Reuse and remaining seam |
|---|---|---|
| Authorized intake and honest unavailable states | `apps/leaf/intake.mjs`, `photoSource.ts`, `brainSource.ts`, `sessionSource.ts` | Inventory actual formats and dependencies; do not infer executive-document coverage from git tests |
| Candidate validation and human decision | `packages/photosynthesis/src/harvestDocument.ts`, `reviewSubjectDigest`; `apps/leaf/server.mjs` review handler | Retain target binding, evidence references and reviewer attribution; specify body-correction migration separately |
| Promotion into the owner's leaf | `packages/photosynthesis/src/promote.ts`, `apps/leaf/server.mjs` | Reuse duplicate, binding and stale-review refusal; do not equate promotion with verified/public |
| Private collection/detail | `apps/leaf/src/frond.ts`, `render.ts`, owner leaflet route | Keep real document order and native detail links; design readable long collections |
| Publication projection and replacement diff | `packages/canopy/src/publish.ts`, `publishedDocument.ts`, `republish.ts` | Reuse allowlisted outward format; explicit versioned expansion if body/media enters hosting |
| Deliberate publication management | `apps/canopy/src/manageState.ts`, `manage-server.mjs`, `publish.mjs`, `withdraw.mjs` | Retain exact-byte/policy review; add a cloud-owned authenticated transport adapter |
| Local mutation serialization | `publicationLock.mjs`, `publicationMutation.mjs` | Preserve current local behavior; hosted state needs durable conditional writes across instances |
| Reader routing and privacy headers | `apps/canopy/server.mjs`, `publishedLeaf.ts` | Hosted adapter must have no fallback to local projection after absent/revoked state |
| UI tokens and website controls | `@foliage/tokens`; integration `apps/www` theme/Button/BlurFade | Reuse tokens; website-local components are not a shared application runtime |
| Deterministic checks | Root `package.json`, `.loop/STATUS.md`, `.loop/FINDINGS.md` | Preserve boundary/egress/dup/findings/type/test gates and one evidence ledger |

### CEO 0C: Dream state and alternatives

```text
CURRENT                         THIS PLAN                       12-MONTH IDEAL
Local source and review   ->     One observed subject/reader -> Repeatable useful portfolios
Separate release lines          One integrated candidate       across supported evidence types
Filesystem publication          Hosted authority + withdrawal  Reliable subject-controlled service
Proposed commercial offer       Paid outcome + measured costs  Repeat use and viable support
```

The 10x opportunity is continuity of evidence and consent from source through reader, rather than a wider set of screens. The plan leaves enterprise governance, discovery demand and broad input coverage as later gated work. That is a deliberate sequencing gap from the ideal, not cancellation of those products.

| Approach | Effort, human / agent estimate | Risk | Pros | Cons | Reuse |
|---|---|---|---|---|---|
| Supported individual pilot plus complete hosted foundations | Several weeks / several focused days, excluding human trials and approvals | Medium | Earliest direct usefulness evidence; preserves hosted destination | Operator effort can mask friction; source eligibility may fail | Existing intake, review, export and publication gate |
| Hosted self-service first | Several weeks or more / several focused days plus deployed validation | High | Tests distribution and activation; repeatable onboarding | Auth, recovery and support investment precede demand; customer may not have supported evidence | Same core plus new hosted adapter |
| Full organization/member/recruiter suite before pilot | Months / multiple weeks plus organizational validation | High | Serves an organization-first contract if actually selected | Most governance and demand assumptions; longest wait for first reader evidence | Enterprise policy, declared taxonomy, open core |

Recommendation remains the first approach (P1/P5), with cohort identity reserved for the owner. Estimates are planning ranges, not measured completion times or a promise that human trials compress with code generation.

### CEO 0D–0F: Scope and temporal decisions

Accepted clarifications stay inside the plan: candidate identity, source/publication eligibility, frozen-public content limits, and named failure outcomes. Proposed scope expansions beyond the first agreed offer, such as a hosted source playground or generalized billing portal, are deferred. SELECTIVE EXPANSION is confirmed; all original L0–L6 outcomes remain.

| Implementation horizon | Decision required before the work | Human / agent planning equivalent |
|---|---|---|
| Hour 1: foundations | Candidate SHA; participant/input profile; files owned by each implementer | ~1h / ~10–20min technical planning |
| Hours 2–3: core logic | Public payload version; principal-to-subject binding; mutation revision semantics | ~2h / ~20–40min planning; implementation separately estimated |
| Hours 4–5: integration | Hosted adapter placement; local bridge; preview isolation; withdrawal paths | ~2h / ~20–40min planning |
| Hour 6+: acceptance | Auth recovery, stale writes, restore, browser state coverage and operator handoff | ~1h+ / ~15–30min planning; live trials remain real elapsed time |

### CEO 1: Architecture

The current local manager correctly delegates publication to the existing commands; the reader carries no mutation authority. L2 introduces new account, ownership, transport and storage boundaries, so placing a network call inside the open Leaf app without a boundary design would be an architectural shortcut. Keep cloud transport and hosted authority in the cloud plane, and retain a local-only workflow that stands alone.

```text
OPEN, SUBJECT MACHINE
authorized source -> intake -> harvest -> human review -> promote -> Leaf -> local reader/export
                                                         |
CLOUD PLANE ON SUBJECT MACHINE                           v
                           exact projection + policy + consent -> cloud transport [NEW]
                                                                       |
HOSTED CLOUD                                                          v
identity/session [NEW] -> ownership check [NEW] -> revision transaction [NEW]
                                                      |             |
                                         private artifact store   publication authority
                                                      |             |
reader GET/HEAD -> current authority check ------------+-------------+
                  | live + matching revision -> permitted bytes only
                  | absent/revoked -> indistinguishable unavailable response
                  | authority unavailable -> service error, no fallback
```

At 10x load, model work, full-document renders and authority reads need bounded concurrency and measurement. At 100x, database pools and support capacity are first-class limits; no availability improvement may bypass revocation. The authority store is an intentional dependency whose failure hides content rather than exposing stale bytes.

### CEO 2: Error & Rescue Registry

Names below are proposed hosted contract codes unless explicitly marked existing; they are not claims that classes already exist. Catch errors at the owning boundary and preserve both mutation and cleanup causes. Log identifiers and error categories, never raw evidence, credentials or payment details.

| Codepath | Failure/code | Rescue action | User sees | Evidence/test status |
|---|---|---|---|---|
| Intake | Missing/unreadable source; existing named loader causes | Write nothing; identify source and correction | Source could not be read, with next action | Local negative tests exist; clean-machine trial pending |
| Inference | Unreachable, timeout, redirected, non-200, malformed, empty/refusal | Bound wait; distinguish causes; no invented fallback draft | Availability or unusable-response explanation | Local provider tests exist; selected route trial pending |
| Review/promotion | Missing target, identity mismatch, stale digest, duplicate | Preserve input; reject stale mutation; reread target | What changed and how to resume safely | Local binding/digest tests exist |
| Login/recovery | AUTH_EXPIRED / RECOVERY_INVALID | Reauthenticate without losing private draft; single-use recovery | Sign in again or request a new recovery link | NEW hosted test requirement |
| Upload | PAYLOAD_INVALID / PAYLOAD_TOO_LARGE | Reject before publish; retain local source | Named field/limit and repair action | NEW hosted requirement |
| Ownership/reservation | SUBJECT_FORBIDDEN / ID_UNAVAILABLE | No mutation; do not expose other tenant details | Cannot use this destination | NEW isolation requirement |
| Publish/replace | REVISION_CONFLICT; existing local ESTALEPUBLIC | Reload current receipt and require fresh review | Publication changed since review | Local stale-publication tests; hosted race test NEW |
| Mutation acknowledgement | OUTCOME_UNKNOWN | Query operation status; do not blindly repeat publish | Result not yet confirmed; Check status | NEW deployed fault test |
| Withdrawal | AUTHORITY_UNAVAILABLE | Do not acknowledge success; fail closed on serving | Withdrawal not confirmed; status/retry route | NEW multi-instance requirement |
| Cleanup after committed write | Existing releaseWarning | Keep successful mutation result plus recovery warning | Change completed; cleanup needs attention | `publicationMutation.test.ts` |
| Reader | Absent/revoked / STORE_UNAVAILABLE | Generic missing state or service outage; never local fallback | Unavailable address or temporary service error | Local routing tests; hosted adapter NEW |
| Billing | PAYMENT_PENDING / PAYMENT_FAILED / DUPLICATE_EVENT | Reconcile provider event id; protect subject data | Pending, failure or confirmed receipt | NEW safe payment lifecycle tests |
| Restore/rollback | REVOCATION_STATE_STALE | Keep service closed until latest revocations reapplied | Temporary service outage | NEW recovery rehearsal |

### CEO 3: Security and threat model

Account authentication does not establish authorship and a client-supplied `verified` field is not independent proof. L2 must specify how a server validates the provenance representation and communicates its limits, while enforcing account-to-subject ownership independently. Threats include identifier takeover (high impact), recovery takeover (high), oversized/hostile uploads (high), duplicate payment events (medium financial impact), and disclosure through media URLs, logs or stale deployments (high); none is closed by a local manager test.

Input schemas must reject missing, wrong-type, excessive-length, traversal and script-bearing values before storage. Recovery tokens and sessions require expiry, replay protection, secure cookie/credential handling and revocation after recovery; diagnostic logs must omit their values. Hosted provider configuration and residency claims remain evidence tasks rather than asserted compliance.

### CEO 4: Data flow and interaction edge cases

```text
SOURCE -> validate -> draft -> REVIEW -> promote -> PROJECT -> upload -> commit -> receipt
 nil:     named missing, no write
 empty:   honest no-candidates/no-publishable-content state
 invalid: named schema issue, preserve prior valid state
 error:   provider/storage cause, no fabricated output or false success
 stale:   reject expected-version mismatch, rereview current state
 timeout: resolve operation status before repeating a mutation
```

Every write must handle double-submit, stale page, expired session, navigation away, interrupted response and concurrent tab. The UI should preserve draft corrections on validation failure; it must show actual persisted state after redirect rather than a success query parameter. Collection changes need stable item addresses and return anchors, with no sibling discovery from an unlisted link.

```text
candidate --human approval--> approved --bound promotion--> local Leaf
candidate --reasoned rejection--> rejected
approved != verified; local Leaf != published

not published --fresh review+consent+conditional commit--> live(revision n)
live(n) --fresh replacement review+conditional commit--> live(n+1)
live(n) --withdraw commit--> revoked(n+1)
revoked --stale upload/retry--> REFUSED
revoked --fresh explicit consent at current revision--> live(new revision)
```

### CEO 5: Code quality

Reuse the parsers, policy gate and publication diff instead of building a second hosted interpretation of Leaf data. The frozen-public and local projection routes currently differ; a new adapter must name which contract it serves rather than letting route fallback choose privacy semantics. Prefer a small explicit storage interface with conditional mutation results over a generalized job/workflow framework; new hosted dependencies need ordinary security and boundary review.

### CEO 6: Test review

The existing tests exercise local typed confirmation, digest/policy changes, malformed documents, replacement, withdrawal and mutation/cleanup distinction. These are valuable behavior tests, but none proves hosted tenant isolation, durable multi-instance serialization or restore safety. The final engineering phase must map every new branch to unit, integration or deployed journey coverage and preserve an explicit list of missing hosted tests.

```text
NEW UX: setup -> review/correction -> readable detail -> publish receipt -> replace/withdraw -> recovery
NEW DATA: approved outward payload -> authenticated transport -> private storage -> authorized reader
NEW ASYNC: bounded inference, upload interruption, billing events, recovery, backup restoration
NEW NEGATIVE PATHS: nil/empty/malformed, foreign tenant, stale revision, lost ACK, revoked retry
EXISTING BASE: local gate/parser/diff/lock tests
REQUIRED ADDITION: deployed two-account, two-instance, outage and restore tests
```

### CEO 7: Performance

The existing publication diff uses maps and linear passes; duplicating it would add risk without reducing cost. Large local documents and botanical layouts need real-size measurement, while hosted uploads require explicit byte/item limits and bounded reads before parsing. Measure intake duration, reader latency and withdrawal acknowledgement latency; current p99 values are unknown, and no positive publication-status cache is permitted as a shortcut.

### CEO 8: Observability and debugging

L4 names alerts but needs a minimal operational schema: request/operation id, principal id, publication id, expected/current revision, outcome category and duration. Keep evidence text, filenames, tokens and payer details out of content logs; protected identifiers themselves need retention rules. Alert on failed withdrawals, authority outages, repeated unauthorized mutations and unresolved operations, with a named responder and links to the recovery procedure.

### CEO 9: Deployment and rollout

The integration record must move as a unit: candidate SHA, applicable check outputs, browser viewport evidence, environment and acceptance status. Deploy additive schema first, then adapters with reader access closed until isolation/revocation probes pass; old and new code must share revision semantics. Rollback changes application code without rewinding revocations or restoring public access to obsolete artifacts.

```text
inspect existing resources -> isolated preview -> additive migration -> guarded adapter
 -> two-account/multi-instance tests -> owner acceptance -> bounded customer release

incident -> stop new mutations if needed -> close uncertain content paths
 -> preserve revocation authority -> roll back compatible code
 -> replay latest revocations after restore -> run serving probes -> reopen
```

### CEO 10: Long-term trajectory

The plan preserves all five products but should expand them only when the selected buyer requires their permission model. Durable ownership, consent receipts and portable export support that trajectory without introducing employer rankings. Reversibility is high for navigation and adapters, low for leaked data or mistaken ownership; spend early rigor on those boundaries and retain the pilot read-out as the demand checkpoint.

### CEO 11: Design and UX

The interaction brief supplies a specific botanical collection and content-first detail, which is stronger input than a generic dashboard. Its three state axes must stay distinct throughout the journey: review, attribution and disclosure. The next design phase must resolve a content-led local detail versus title-only frozen public format, explicit empty/error states, and the conflicting proposed first design slices in the UI foundation and interaction brief.

```text
Overview -> Sources -> Review -> My Leaf -> owner leaflet -> return anchor
                                       -> Sharing preview -> exact review -> hosted receipt
Reader: deliberately shared URL -> permitted Leaf -> permitted leaflet -> permitted evidence
Error: correction preserved -> repair/retry or status resolution -> actual state
```

### CEO NOT in scope and failure modes

New source connectors beyond the first agreed offer, a public playground holding private sources, broad discovery, and a custom billing portal are not added by this review. Existing enterprise/member/recruiter milestones remain gated in the original plan. Defer generalized infrastructure until a concrete customer flow requires it; complete every safety path in the selected flow.

| Failure mode | Rescued now? | Test now? | User-visible behavior required | Logging | Critical implementation gap? |
|---|---|---|---|---|---|
| Participant has no publishable evidence | Local gate withholds honestly | Local yes, actual pilot no | Explain unavailable outward portfolio before promising hosting | Eligibility read-out only | Yes, value/offer eligibility unproven |
| Rich content lost at frozen projection | Existing contract is title/provenance only | Format tests exist | Preview exactly what crosses; no implied parity | Format/version | Yes, rich hosted promise unproven |
| Tenant takeover or recovery takeover | Hosted service absent | No hosted coverage | Refuse without leaking tenant details | Auth category/operation id | Yes |
| Withdraw races stale publish | Local serialization only | Local yes, distributed no | Revoked stays revoked; fresh consent required | Revision/outcome | Yes |
| Lost ACK mistaken for failure | Partial local result handling | Cleanup test only | Unknown result and status lookup | Operation id | Yes |
| Restore resurrects content | Hosted service absent | No deployed rehearsal | Fail closed until authority recovered | Restore checkpoint | Yes |
| Billing cancellation destroys data | Billing absent | No | Export and subject ownership retained | Event id/outcome | Yes before paid service |
| Pilot interventions hide friction | Plan asks to record interventions | No observed trial | Distinguish assisted and unassisted outcome | Consented study notes | Yes before usability claim |

### CEO amendments to milestone acceptance

L0 records one named customer profile, the current artifact that person uses instead, permitted evidence types, the exact offered outcome, payer/subject relationship, revenue form, and owner capacity. Alex's existing customer/product lane includes actual participant contact and an outcome/decline note; this review authorizes preparation of interview material, not agent outreach. Price conversations may inform the offer before L5; collecting money and operating hosted publication retain their original gates.

L1 includes an eligibility inspection over the participant's authorized inputs: source parse succeeds or names why it cannot; attribution is reported as-is; the exact outward projection is reviewed; a reader can identify what that projection actually supports. If it produces no useful publishable content, do not manufacture proof or widen policy: record that result and return to the owner for a source/offer decision. A participant's employer-confidential material is not assumed available merely because the participant can access it.

L1 also closes local multiwriter loss before claiming interruption/correction preservation. All harvest and Leaf writers need a common concurrency protocol in the open plane, preserving target binding and author edits; the cloud-only publication lock is a reference pattern, not an importable open dependency. Test web review against CLI refresh/promotion and a second review tab, including crash recovery and visible conflict.

L2 declares its public payload version and supported content kinds before transport work. Preserve title/provenance-only behavior honestly unless a separately reviewed version adds outward body/media, updates redaction/validation/diff/reader paths, and proves preview parity. Never infer that server authentication validates a submitted attribution assertion, and never send the raw local document as a substitute for a missing public format.

L4 adds the operation metadata and restore ordering described above. L5 explicitly tests delayed, repeated and out-of-order provider events and cancellation without loss of the subject's export or withdrawal rights. Operational targets (limits, response commitments and costs) must be written before paid availability, with actual owner capacity rather than an invented service-level promise.

### CEO outside voices and consensus

**CLAUDE SUBAGENT (CEO, strategic independence):** supplied through the local Claude CLI, with the original plan text and no prior review. It returned 18 concerns, mainly learning order, executive input fit, hosting alternatives, demand/contact, economics and owner capacity. This was a text review: its attempted file read was denied. Its old portfolio-count and alternate-checkout claims were explicitly unverified and are not adopted as facts. The broad claim that no demand lane exists overstates the draft, which already assigns participant contact to Alex; A12 makes that existing work observable rather than inventing a seventh lane.

**CODEX SAYS (CEO, strategy challenge):** 8 repo-grounded concerns. It independently found that promoted candidates are `pending` and cannot pass the verified-only publication gate, and that the outward format excludes body/media. Its strongest recommendation is an exact-outward-artifact reader test before substantial hosted investment, with an actual substitute comparison and explicit failure branches. It also asks for a bounded service allowance and a repeatable acquisition route.

Full voice outputs: `~/.gstack/projects/aacker71-foliage/autoplan-launch-20260905/ceo-claude.md` and `ceo-codex.md`. A separate bounded spec review ran twice: the first found a missing authoritative-plan link in the external CEO overlay; that link was added. The second passed at 9/10. That score assesses the document, not people or product readiness.

| CEO dimension | Claude | Codex | Consensus |
|---|---|---|---|
| Premises valid? | Input fit/segment unproven | Exact outward eligibility unproven | CONFIRMED concern |
| Right problem? | Reader value should govern investment | Reader task must beat current material | CONFIRMED concern |
| Scope calibration? | Hosting may precede needed learning | Platform investment can outrun pilot | CONFIRMED concern |
| Alternatives explored? | Add export/local/hosted alternatives | Local engagement/hosted/pause branch | CONFIRMED concern |
| Competitive risk? | Substitutes/distribution unspecified | Buyer alternative/acquisition untested | CONFIRMED concern |
| Six-month trajectory? | No failure/stop criteria | No investment checkpoint | CONFIRMED concern |

Six of six dimensions agree on concerns; that is not six passing dimensions. No strategic disagreement between the voices is treated as settled fact. The following change to the user's stated sequence is a **User Challenge**, not an automatic amendment:

**UC1: let outward-artifact usefulness control substantial hosted investment.** The original plan starts hosting foundations alongside L1 and carries L0–L6 as its sequence. Both voices recommend a bounded subject-and-reader trial using the exact outward artifact before substantial L2 spending, with owner-set continuation criteria and a genuine local-engagement or pause branch. They may be missing an existing customer commitment or strategic reason to build hosting now. If wrong, this gate delays necessary platform work and overweights a tiny early sample. Original parallel L1/L2 sequencing stands unless the owner explicitly accepts the challenge; no new L0.5 milestone is created automatically.

### CEO Completion Summary

| Required output | Result |
|---|---|
| Mode / audit / Step 0 | SELECTIVE EXPANSION; checkout/candidate drift, customer-decision conflict and publication eligibility identified; alternatives and temporal map written |
| Architecture | Cloud transport/authority and local/public format boundaries specified |
| Errors | 13 error groups mapped; hosted rescue implementations remain required |
| Security | Ownership/recovery, attribution trust, upload validation, egress/logs and alternate serving paths addressed in requirements |
| Data and interactions | Four shadow paths plus stale/timeout; two state machines; multi-tab and navigate-away recovery specified |
| Quality | Reuse parsers, policy and diff; shared open-plane writer protocol; avoid second publication interpretation |
| Tests | Flow diagram produced; local coverage distinguished from missing hosted/participant evidence |
| Performance | Bounded uploads/model concurrency/large-document rendering; measurements unknown |
| Observability | Operation metadata, privacy limits and responder requirements added |
| Deployment | Preview migration and rollback diagrams; revocations cannot rewind |
| Future | Reversible UI/adapter choices; irreversible disclosure risk; demand checkpoint queued for owner |
| Design | Three state axes and public/local content mismatch passed to Design |
| NOT in scope | Four new expansions declined; original gated product scope preserved |
| Existing leverage / dream delta | Both written |
| Error/failure registries | 13 error groups, 8 critical implementation/evidence gaps; no claim these are fixed code |
| TODO proposals | Four existing/later expansions to collect in Eng without replacing legacy TODOs |
| Scope amendments / decisions | 13 audit entries; 1 user challenge queued; 2 taste questions remain open |
| CEO artifact | External overlay written and independently reviewed in 2 rounds; 1 issue fixed |
| Outside voices | Claude text-only + Codex repo review; 6/6 shared concerns, 0 confirmed passing dimensions |
| Completeness choices | All 10 mechanical choices preserve or improve required coverage |

### CEO Implementation Tasks

- [ ] **CEO-T1 (P1, human: ~2h / agent: ~30min technical preparation plus owner session)**: record L0 buyer, permitted input, first offer, substitute, support allowance and candidate identity. Files: this plan and `.loop/STATUS.md`; verify decisions are attributable and readiness points to exact evidence.
- [ ] **CEO-T2 (P1, human: ~1 day / agent: ~1–2h preparation plus real sessions)**: run the L1 source and exact-outward-artifact eligibility/reader protocol using authorized material. Files: this plan and a private participant evidence record; verify unavailable evidence remains unavailable and interventions are recorded.
- [ ] **CEO-T3 (P1, human: ~1–2 days / agent: ~2–4h)**: close shared local review/promotion write races without crossing licensing planes. Files: `apps/leaf/server.mjs`, `apps/leaf/harvest.mjs`, relevant open writer helper and seam tests; verify no lost decisions under concurrent writers.
- [ ] **CEO-T4 (P1, human: ~1 day / agent: ~1–2h design work)**: define frozen-public payload and receipt contracts before hosted transport. Files: `packages/canopy/src/publish.ts`, `publishedDocument.ts`, `republish.ts` and this plan; verify rich content is either explicitly supported by a reviewed version or honestly withheld.
- [ ] **CEO-T5 (P1 before paid hosting, human: ~1 day / agent: ~1–2h preparation plus rehearsal)**: specify privacy-safe operation records and revocation-preserving recovery. Files: hosted adapter design and `docs/DEPLOYMENT.md`; verify lost-ACK/outage/restore procedures have responders and observable outcomes.

### Design scope and initial assessment

Initial design completeness: **7/10** for the launch plan plus interaction brief. Source-backed hierarchy and visual constraints exist, but hosted recovery, account transitions, mobile navigation and the local/public payload mismatch are not yet specified as complete screens. A 10/10 plan would specify every supported route state and outward payload, with accepted visual references; this review can improve specification completeness but cannot substitute for owner visual acceptance or participant observation.

There is no root `DESIGN.md`; `AGENTS.md`, `docs/UI-FOUNDATION.md` and `@foliage/tokens` supply the actual design contract. Existing `render.ts` has native details, explicit title-only/ref-only/unreadable media states and owner/public audience branches. Existing `frond.ts` renders equal-sized markers in document order, but the proposed botanical readable collection is new work. Website-local Button/BlurFade do not establish that app routes have adopted React components.

### Design pass 1: Information architecture, 7 → 8/10

*Navigation superseded 2026-10-08: the owner chose, and the app ships, Home (`/`, formerly Overview), Work, Review, Portfolio (`/leaf`, formerly My Leaf) and Sources, with Scarlet, Policy, Publish and the other personal tools under More (`apps/leaf/src/workspaceNavigation.ts`; [UI context](../context/ui-context.md)). That settles the navigation half of the Navigation/copy decision in Design pass 7. The navigation below is this review's 2026-09-05 proposal.*

Prioritize actual work, its evidence and its audience, in that order. Private navigation remains Overview, My Leaf, Review, Sources, with Sharing reachable from My Leaf/detail and Policy from the relevant withholding explanation; every existing deep link remains functional. The first-slice recommendation is My Leaf → owner leaflet → return because it tests whether the artifact is understandable before extending the review and publication interfaces; Review-first is a final taste choice because the UI foundation currently recommends that entry point.

```text
PRIVATE APP, night
Navigation: Overview | My Leaf | Review | Sources
My Leaf: title/available authored headline
         actual work previews + botanical spine, equal-weight markers
         source + observed date + attribution text
         link to detail, stable item anchor
Detail:  title -> actual body/media -> adjacent evidence -> source/provenance
         owner disclosure and relevant policy -> return to list anchor

HOSTED MANAGEMENT, night
Destination + exact subject/content -> explicit consent -> operation result/status

PUBLISHED READER, day
Public subject/available headline -> permitted work -> permitted evidence
Missing, revoked or withheld: same unavailable page; no private breadcrumbs or siblings
```

### Design pass 2: Interaction state coverage, 6 → 8/10

Every row below specifies visible behavior, not merely a backend state. The same screen must distinguish a successful empty result from an unreadable input, and a completed mutation from an unknown response. Error text identifies the next safe action; private recovery may carry details that public pages must omit.

| Feature | Loading | Empty | Error | Success | Partial/uncertain |
|---|---|---|---|---|---|
| Overview/source setup | Source being inspected; current phase in text | Choose an authorized source; prerequisites visible | Source unavailable with cause and repair action | Source and observation recorded; Continue to Review | Some sources failed, named individually; usable sources stay visible |
| Harvest/inference | Phase and elapsed time, no fabricated percent or spinner | No candidates found in the selected source | Provider unavailable/invalid response, retry after repair | Real candidates link to Review | Interrupted run retains last durable result; no implied completion |
| Review/correction | Saving decision; controls prevent duplicate submit | No undecided candidates; My Leaf link | Entered correction retained beside exact validation error | Decision shown from saved record, approval distinct from promotion | Concurrent change keeps draft, names conflict and requires rereview |
| My Leaf/filter | Native navigation or labelled pending request | No leaflets; choose source, or Clear filters for filtered-empty | Leaf unreadable; do not show zero work | Real preview cells and normal links | Unreadable elements named; complete readable items retained |
| Owner leaflet | Native document navigation | Title-only/ref-only states explain what is actually attached | Unreadable element/media message at its position | Content plus adjacent evidence disclosures | Missing media never replaced with stock imagery; source record remains |
| Sharing preview | Preparing exact outward projection | Nothing currently eligible, with private reasons | Policy or payload invalid; nothing changed | Exact reader preview and limits; separate publish action | Some content withheld; all reasons inspectable before consent |
| Sign-in/recovery | Submitting; no duplicate recovery request | Signed out with sign-in path | Invalid/expired recovery, resend path without account enumeration | Session established; return to intended manager task | Session expiry preserves local draft; fresh review required before publication |
| Publish/replace | Sending explicit operation; destination and subject remain visible | No publication yet; preview path | Named refusal, conflict or auth repair | Durable receipt, revision and usable reader link | Result unknown; Check status with operation id, no blind republish |
| Withdraw | Withdrawal being confirmed; no premature success | Already unavailable, confirmed from authority | Not confirmed; safe retry/status action | Content unavailable after durable acknowledgement, with download caveat | Lost ACK uses status lookup; never restore the old content locally |
| Published reader | Native page load; no private skeleton labels | Same unavailable state as missing/withdrawn | Service temporarily unavailable when authority cannot be read | Only authorized projection; normal detail navigation | No sibling counts, owner paths or withheld titles leak into layout |
| Payment/cancel | Payment or cancellation pending | No active purchase; approved offer only | Safe failure/retry with no duplicate charge | Confirmed receipt/entitlement and cancellation terms | Pending reconciliation shown; subject data/export/withdrawal preserved |
| Export/exit/support | Export preparation or request submission | No exportable content, honestly explained | Cause, retry and support contact | Download receipt or request reference | Explain partial export and omissions; never label it complete |

Owner-account deletion, credential recovery and billing authorization must not hide the subject's ability to resolve a withdrawal. If session recovery is impossible, support must have a separately documented identity-safe path; that is a security design requirement, not an unrestricted administrator impersonation button.

`Unconfirmed` describes the latest operation and knowledge of effective hosting status. It is not a fourth visibility intent and must not mutate the existing private/unlisted/public schema. Show the last confirmed revision with its observation time and a clear stale/unknown warning; status refresh resolves the uncertainty through the authoritative hosted store. Preserve the three existing state axes and keep operation progress separate.

### Design pass 3: Journey and emotional arc, 7 → 8/10

The first five seconds should explain what this screen is and the next useful action, not the entire taxonomy. Within five minutes under stated prerequisites, the subject should see something traceable to their own source or a clear reason that no candidate exists; the target is unmeasured. Over repeated use, trust comes from preserved corrections, comprehensible changes and working withdrawal rather than decorative motion.

| Step | User does | Expected feeling | Design requirement |
|---|---|---|---|
| Arrive | Learn the offer and supported evidence | Oriented rather than sold to | One truthful start path, support route and scope limits |
| Bring source | Select permitted material | Cautious but in control | Local/remote processing explained before any transfer |
| Review | Inspect and correct a draft | Recognized, able to disagree | Evidence beside text; edits retained on refusal |
| Read Leaf | Find and open an artifact | Able to understand own work | Readable preview, plain attribution, stable return position |
| Share | Inspect exact outward content | Deliberate, not rushed | Destination, limits, omissions and distinct consent |
| Wait | Resolve interrupted publication | Uncertain but not trapped | Status lookup and named operation, no false success |
| Reader visit | Inspect permitted evidence | Curious, appropriately skeptical | Claims distinguishable from support; inaccessible evidence named honestly |
| Withdraw/leave | End access and export | In control | Durable confirmation and clear limits on recalling downloaded copies |

### Design pass 4: Specificity and generic-layout risk, 8 → 9/10

The app is a workspace with bordered evidence cells, not a card mosaic; the website is a marketing surface with a single clear offer and action. A botanical data shape is justified only when it helps find the same real items available in the list, with equal visual weight and no inferred grouping. No generated summary, portfolio, testimonial, photograph or numeric claim fills an empty state; the study images for this review contain empty states only and are labelled unimplemented concepts.

Use the tokenized brand and actual mark asset rather than generating a new mark. The global design skill's generic requirements for gradients, minimum animation counts and deletion quotas do not override Foliage's surface, motion and evidence constraints. Text should be specific about the source/action/state, with implementation explanations kept in operator documentation.

### Design pass 5: Design-system alignment, 8 → 9/10

Consume `@foliage/tokens` without copying values into documentation or creating a second palette. On routes that adopt React, begin with local shadcn Button, Input, Label and an appropriate AlertDialog for deliberate destructive actions; inspect token mapping and keyboard behavior. Keep native `<details>` and ordinary links/forms on existing no-script routes until their replacement has equivalent content security and privacy behavior; use Magic UI only where it helps orientation and fully resolves under reduced motion.

Attribution is a textual fact and explanation, not a progress sequence. Repeating a verified accent throughout a long collection would violate the at-most-two emphasis rule, so use neutral text labels and keep geometry equal. Published pages use day, private management uses night, fonts remain self-hosted, and all actual metrics use mono tabular numerals.

### Design pass 6: Responsive and accessibility, 6 → 8/10

At 360px use a single readable content column, a compact always-reachable navigation block and full-width actions; no tiny botanical target is the only link to work. At 768px allow preview/evidence stacking with visible reading order, and at 1440px put supporting evidence beside the selected artifact where space permits. Do not squeeze an entire large collection into the viewport: use growing sections or bounded pages with an equivalent complete list and stable URLs.

Use landmarks, a skip link, visible labels, visible keyboard focus and at least 44px primary touch targets. Native disclosure activation works by keyboard; errors receive focus or an appropriate announcement; background status uses restrained live regions; modal confirmation restores focus to its trigger. Preserve browser history and return anchors/filters, distinguish visited work links where the token palette allows, and retain content at readable zoom and reduced motion.

Measure text, control, focus and state contrast in the rendered day/night surfaces and state the actual ratios. The mockup is not contrast or accessibility evidence, and no AA claim is made. Browser acceptance must record viewport read-back, tested SHA, keyboard interactions, screen-reader behavior and network/CSP observations on the integrated candidate.

### Design pass 7: Unresolved decisions, 6 → 7/10

Three choices still affect implementation: the first journey entry point, the frozen-public payload's rich-content promise, and the final owner-approved navigation/copy. A15 recommends My Leaf first but preserves Review-first as a viable alternative; the new public payload cannot be guessed from the private layout. This score stays below design-complete because owner acceptance and a supported outward content contract remain open, rather than inflating the score because requirements were written.

| Decision | Recommendation | Consequence if unresolved |
|---|---|---|
| First implementation slice | My Leaf → detail → return, then connect Review | Separate teams optimize different entry points |
| Public body/media | Versioned allowlisted contract before promising parity | Rich local work disappears or unsafe raw data crosses |
| Navigation/copy | Proposed labels in this review; owner acceptance at L3 | Route labels and customer promise drift |
| Long collection | Sections/pages with equivalent list and native links | Tiny inaccessible chart becomes the sole index |
| Unknown publication result | Dedicated status-resolution state | User repeats a write or falsely assumes revocation |

### Design NOT in scope and implementation tasks

Broad app migration, a hover-only explorer, generated content examples and a new design system are not introduced here. What already exists is the token package, native renderer/disclosures, equal-sized data frond, local review form and website-local shadcn/Magic components. Later explorer enhancements remain in the existing expansion track rather than blocking the native detail journey.

- [ ] **DES-T1 (P2, human: ~2 days / agent: ~2–4h)**: implement the accepted first journey with readable previews, native detail links and retained return context. Files: `apps/leaf/src/render.ts`, `frond.ts`, `apps/leaf/public/leaf.css`, related behavior tests; validate empty/title-only/media/error/large collection with real material.
- [ ] **DES-T2 (P1 for hosted launch, human: ~1 day / agent: ~1–2h)**: implement the management state matrix, including unknown result, session expiry and withdrawal receipt. Files: management renderer/hosted adapter and their tests; validate keyboard and retry behavior after a lost acknowledgement.
- [ ] **DES-T3 (P1 before UI acceptance, human: ~1 day / agent: ~1–2h plus owner review)**: measure integrated responsive/accessibility/CSP/network behavior and approve truthful copy. Files: `docs/LAUNCH-ROUTE-INVENTORY.md`, `docs/UI-FOUNDATION.md`, affected route styles; capture actual ratios and viewport read-back.


### Design independent voices and reconciliation

**CLAUDE SUBAGENT (design — independent review):** seven findings: unknown publication outcome absent from the original disclosure schema; public-reader design too late; pending-state accounting dominates work; botanical index has no defined navigation job; partial progress states incomplete; React/native behavior contract missing; work-first/mobile hierarchy unproven. This voice reviewed the original supplied plan and briefs without repository tools or CEO findings. Full output: [design-claude.md](~/.gstack/projects/aacker71-foliage/autoplan-launch-20260905/design-claude.md).

**CODEX SAYS (design — visual challenge):** seven findings: exact-outward usefulness; existing public withholding totals and verbose failures conflict with the proposed disclosure rules; all-pending hierarchy; stale missing-back-link claim; draft loss on refusal; control-level responsive acceptance; repeated verified accent. This voice inspected source at `1b7b3aa` and the amended plan, including CEO context. Full output: [design-codex.md](~/.gstack/projects/aacker71-foliage/autoplan-launch-20260905/design-codex.md). Another task committed Scarlet work during this review; it is not this review's change, and current source statements are pinned to that newer SHA.

The absent-back-link claim is corrected: owner detail already links to My Leaf. The remaining defect is loss of the item anchor/filter and incomplete owner navigation, not absence of any return link. Refused correction forms currently lose submitted values; retaining those drafts is a concrete implementation requirement rather than an aspirational matrix entry.

Both voices flag outward usefulness, reinforcing UC1; neither grants authority to change launch sequencing. Claude's proposed fourth disclosure value is rejected: unknown is an operation-observation state, not visibility intent. Claude's suggestion to call all pending work “none yet attributed” is rejected because pending is not an attribution finding; factual neutral per-item labels remain. The motion disagreement resolves in favor of native behavior and restrained state feedback under the existing user contract, with no animation quota.

The existing frozen reader deliberately renders withholding totals/categories in `apps/canopy/src/renderPublished.ts`, while the new interaction brief excludes private accounting. The planned public-field allowlist must therefore explicitly cover aggregates, metadata, error text and identifiers as well as title/provenance. Recommend omitting private accounting and repair instructions from the hosted public reader, but preserve the existing format pending an explicit disclosure-contract decision; do not silently claim that this protection already exists. Public unavailable states must not disclose another artifact's identifier or operator recovery instructions.

| Design litmus | Claude | Codex | Reconciliation |
|---|---|---|---|
| Unmistakable brand | Brand at risk in execution | Strong direction, execution unproven | Agreement: token/mark direction supported, not accepted pixels |
| Visual anchor | Accounting dominates | All-pending accounting dominates | Agreement: work becomes anchor, factual state retained |
| Scanning | Incomplete | Previews/return context incomplete | Agreement: readable list + native detail/anchor |
| Section purpose | Mostly clear | Mostly clear, sparse/public cleanup needed | Agreement: keep artifact/evidence purpose specific |
| Necessary cells | Ambiguous accounting emphasis | Conditional purpose | Agreement: no decorative card density |
| Purposeful motion | Contract underspecified | Native restrained behavior sufficient | Difference: no new motion requirement; existing constraints govern |
| Quality without shadows | Intent only, not verified | System supports it, unvalidated | Agreement: source supports direction; visual acceptance pending |

Consensus: **6/7 aligned judgments, 1 difference resolved by the existing no-quota/native-motion constraint; no claim of seven passing screens.** Specification score: **6.9 → 8.1/10** across the seven passes. The unresolved-decision dimension remains 7/10, so design is not implementation-ready without the named L0/L3 decisions.

### Design visual evidence and completion

The image-generation study contains only empty/error states, never portfolio evidence. Its invented mark and public lock icon were rejected. Gstack generation returned a quota error; the built-in image tool produced the study, and gstack's subsequent image check returned `pass: true` alongside “Vision check unavailable — skipped.” That is **an unavailable check**, not a pass.

The corrected [native wireframe](~/.gstack/projects/aacker71-foliage/designs/launch-states-20260905/wireframes.html) was rendered and visually inspected. It imports the actual token styles/assets through resolved package exports, separates private operation uncertainty from the day public unavailable state, and is explicitly labelled a nonfunctional concept. Local file rendering did not display the CSS-mask mark, so the wireframe supplies no evidence of correct deployed mark rendering. Its screenshot is a design reference only; application routes, mobile interaction, contrast, network and CSP acceptance remain untested here.

All seven design passes, state/journey diagrams, litmus table, independent outputs and implementation tasks are written. The first-slice taste choice, outward payload/disclosure contract and owner visual acceptance remain open. **Phase 2 complete; pass the amended design contracts to DX, then Eng.**


### Decision audit continuation — Design reconciliation

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| A21 | Design | Public allowlist includes withholding aggregates, identifiers and failure text; recommend no private accounting | Taste, pending contract | P1/P6 | Existing reader deliberately exposes aggregates; resolve policy before transport | Silent format change or claiming present privacy protection |
| A22 | Design | Retain refusal drafts and stable return context; correct stale back-link finding | Auto | P1/P5 | Source shows partial navigation and lost submitted values | Rebuilding a link that already exists |
| A23 | Design | No new animation quota; wireframe is reference only; image checker unavailable | Auto | P1/P5 | User motion constraints and actual error outweigh model/style defaults | Treating an API error as accepted visual evidence |

### DX scope, persona and evidence

Mode: **DX POLISH**. Product type: local Node/TypeScript CLI and self-hosted app, with a hosted publishing service planned. The persona is a technical pilot facilitator who can use git and a terminal, has legitimate access to a participant's permitted material, and wants to get that participant to a readable artifact without becoming the product's operator forever. This is a tooling persona, not a decision to replace the executive customer with a developer market. Their five-minute attention budget is a design target; no participant timing was measured in this review.

Initial DX plan completeness: **5.5/10**. README links a canonical quickstart, the CLI has an explicit garden override, and lower-level commands expose useful refusals. However, the quickstart's static-host-anywhere ending conflicts with immediate hosted withdrawal, its fifteen-minute budget and under-two-minute machine claim are historical assertions, and the new hosted onboarding/upgrade path is not yet delivered. No prior comparable `plan-devex-review` score was returned by the review log; do not infer a trend from other reviews.

Read-only CLI help was exercised; README, `TESTER-QUICKSTART.md`, `foliage.mjs`, `harvest.mjs` and Node preflight source were inspected. No cold installation, harvest of customer material, model download, payment, publish or support submission was performed. Code excerpts describe current behavior, not a successful first-user session.

### DX empathy narrative and roleplay

The following is a first-person **roleplay grounded in source**, not a participant quote or measured session:

> I want to see my own work before deciding whether to ask someone else to try this. The README gives me one quickstart, which helps, but I must already have the private checkout, Node, pnpm and git. I need to know whether I can use a separate garden so my experiment cannot mix two people's material. The identity command shows addresses from history; it does not tell me which ones I am entitled to claim. I appreciate that missing signature verification is explained rather than converted into a bad-looking result. When the quickstart says “nothing joins your leaf without you,” I would assume that includes the intake leaflets, although grow has already written those before candidate review. I can approve a candidate and still have nothing publishable, because approval does not establish cryptographic authorship. Then the guide tells me to host the export anywhere, while the newer plan promises withdrawal. I need those two outcomes distinguished before I hand a file to a reader. If a model fails after intake succeeds, I want to know what was saved and what failed. I would keep going if the next safe command were clear; I would ask for help if retrying might overwrite somebody's corrections.

| Roleplay point, not elapsed time | Evidence-backed confusion | Resolution in plan |
|---|---|---|
| Arrival | Private checkout/prerequisites precede the three product commands | Separate acquisition and cold setup from installed-first-result timing |
| First grow | Intake writes before candidate approval; the guide overstates the gate | Describe intake attribution and candidate promotion as separate operations |
| Review | Approved candidates remain pending | Show exact reason for public eligibility, never suggest approval verifies authorship |
| First share | Local export and hosted withdrawal differ | Two explicitly labelled delivery contracts; hosted onboarding ends at managed reader URL |
| Recovery | Retrying after partial success may change durable files | Print saved stage/destination plus failed stage and safe retry/status action |

Artificial roleplay timestamps are omitted because they would resemble measured onboarding evidence without a run.

### DX benchmark and first useful moment

Three browser searches and the following primary documentation were inspected on 2026-09-05. These are onboarding-pattern comparisons, not equivalent portfolio products and not measured competitive timings. The lower-effort delivery vehicle is the existing CLI plus a local browser view of the subject's actual source; no invented demo, new browser sandbox, mandatory cloud account or automatic model download is introduced.

| Reference | Documented onboarding pattern | Timing evidence and applicability |
|---|---|---|
| [GitHub CLI authentication](https://cli.github.com/manual/gh_auth_login) | Guided browser authentication and credential storage | No timing measured; useful model for explicit hosted sign-in and recovery |
| [Ollama quickstart](https://docs.ollama.com/quickstart) | Platform installation followed by model execution/download | Cold model preparation is separate and unmeasured; optional for Foliage's deterministic git path |
| [GitHub Pages quickstart](https://docs.github.com/en/pages/quickstart) | Repository/settings/deployment path | Docs allow up to ten minutes for publication; compare clarity only, not withdrawal guarantees |
| Foliage source path | Install, grow, browser review/read; sharing is a separate act | Existing guide budgets about fifteen minutes end-to-end; current measured TTHW unavailable |

Target tier: competitive installed-first-result clarity, **under five minutes** from prepared checkout/dependencies and a supported small authorized source to meaningful source-backed content or a truthful no-result explanation. A truthful empty result validates system behavior but does not count as reaching the useful-artifact milestone. Record cold checkout/install time, source size, model preparation, human review time and exact-public-reader time separately; an executive source workflow gets its own protocol instead of inheriting the git time target.

Proposed canonical quickstart after prerequisite checks, from the checkout: (1) `pnpm install`; (2) `node foliage.mjs grow --repo "$FOLIAGE_SOURCE" --subject "$FOLIAGE_SUBJECT" --identity "$FOLIAGE_IDENTITY" --garden "$FOLIAGE_PILOT_GARDEN"`; (3) `node foliage.mjs up --garden "$FOLIAGE_PILOT_GARDEN"`, then follow the printed loopback URL into Review/My Leaf. The guide must first tell the facilitator to set these task-specific variables to the real permitted repository, declared subject and identity, and a distinct pilot garden; repeat `--identity` for additional legitimately declared addresses. These commands are a documented proposal, not executed evidence. The prepared clock starts immediately before grow is invoked and stops when the participant can inspect actual work in the local browser; acceptance is strictly less than 300 seconds. Checkout access, runtime setup and pnpm install precede that clock and remain part of reported total onboarding time. Before the trial, record the actual source commit count, byte size, identity coverage, dependency-cache state and machine; this is a selected-source target, not a universal bound for arbitrary repositories. Human correction and exact-public-reader validation use separate clocks.

Keep `pnpm check` as the integrated candidate's required engineering gate. It is not the definition of a customer's first useful artifact, and its runtime is reported separately. The first meaningful moment is recognizable work with inspectable evidence and correct limits, not a test tally or a generated success screen.

### DX nine-stage journey map

| Stage | Developer does | Source/friction | Planned resolution/status |
|---|---|---|---|
| 1 Discover | Read README and preview offer | Private repo/license gate and customer choice | Honest supported-preview access; no public redistribution implied |
| 2 Install | Check Node/pnpm/git, link dependencies | Native TypeScript floor; no core build | Pin tested runtime and show exact repair; cold install unmeasured |
| 3 Configure | Select source, identity and garden | Multiple identities/subjects; garden can default | Explicit first-session target and supported-source recipe |
| 4 First result | Grow and open loopback app | Intake/candidate review differ; honest empty possible | Stage receipts and meaningful-artifact criterion |
| 5 Real usage | Review, correct, promote, inspect exact outward result | Pending promotion does not become verified | Separate local value from publishable capability; exact public contract |
| 6 Debug | Read refusal, retry safely | Timeout/unreachable and partial success | Problem/cause/fix plus current durable state and documentation |
| 7 Upgrade | Change checkout/runtime/schema | No complete migration/restore contract | Versioned format compatibility and reversible migration rehearsal |
| 8 Support | Use existing quickstart contact or issue access | Contact exists; service allowance/response owner unagreed | Owner, coverage hours, intake/redaction and response expectations at L4 |
| 9 Exit | Export, withdraw, cancel, remove account | Static copies differ from managed access | Distinct confirmations/retention rules; revocations survive restore |

These statuses mean requirements recorded, not implemented or tested.

### DX pass 1: Getting started, 5 → 8/10

The existing garden/CLI is the simplest delivery vehicle that reaches actual material, so reuse it. The installed git path can avoid a local model entirely: `foliage grow` delegates to deterministic `harvest propose` without its optional model flag. Do not add Ollama to that path's prerequisites merely because another drafting implementation has a model fallback. A 10/10 requires a successful novice run on the selected customer's supported source, complete cold and prepared timing, and an accurate end-of-guide outcome.

### DX pass 2: API/CLI ergonomics, 7 → 8/10

Keep the existing top-level `grow`, `review`, `up`, `status`, `export` and `canopy` names; reveal lower-level source flags through the supported-source recipe and help rather than renaming commands. In this private preview, copyable output should use `node foliage.mjs` from the checkout or clearly explain the uninstalled shorthand; hosted sign-in must not make open-plane local use depend on cloud code. Garden and model endpoint overrides remain explicit, with no automatic remote fallback, silent source selection or publication as a side effect of approval. A 10/10 needs exercised help examples and consistent structured outcomes across the actual installed and hosted entrypoints.

### DX pass 3: Errors and debugging, 6 → 8/10

Three current paths were traced below. Preserve existing exit classes and specific refusal causes; improve recovery without substituting a second cause or claiming nothing changed when an earlier stage wrote successfully. Diagnostic output stays private and redacted before support export, while public errors reveal no subject/record existence or operator details.

| Path | Current source-backed behavior | Required message/behavior |
|---|---|---|
| Missing git identity, `foliage.mjs` grow | “no --identity given and the repo has no git user.email. Pass --identity <email>.” | Distinguish unavailable git/not-a-repo/config-missing if subprocess failed; name selected source and how to inspect legitimate identities; show an executable checkout command and quickstart section |
| Local git model failure, `harvest.mjs` draft | Refuses, writes nothing for this proposal; timeout currently folded into unreachable; HTTP failure includes limited body but no next action | Distinct timeout, unreachable, redirected, HTTP and invalid-output codes; actual limit/endpoint, repair action and optional explicit deterministic rerun; never automatic substitution |
| Missing harvest, `foliage.mjs` review | Names path and asks for `foliage grow --repo <path>` | Preserve cause/path, include selected garden and `node foliage.mjs` command; malformed/unreadable JSON gets a separate diagnosis with no fabricated empty count |

The Node preflight already names the runtime floor, explains the failure and offers a repair, so reuse its pattern. Hosted errors additionally carry an opaque operation reference and safe status action, never raw credentials or content. If model drafting fails after grow's intake, both the successful intake destination and failed draft must be stated; process exit alone is insufficient.

### DX pass 4: Documentation and learning, 5 → 8/10

Keep one quickstart linked from README, with separate local-own-copy and managed-hosted-sharing endings. Remove invented illustrative result counts and stale timing assertions from customer-facing instructions unless backed by a recorded run; show the shape of real output without pretending a participant produced it. Align help, quickstart, `docs/CANOPY-CLOUD.md`, `docs/DEPLOYMENT.md` and the capability ledger to the same candidate/version, and make unsupported source types visible before installation. A 10/10 requires copy-paste testing plus a new user finding install, recovery, privacy and exit instructions within the two-minute target; no new search service is needed for a small documentation set.

### DX pass 5: Upgrade and migration, 3 → 7/10

Add a compatibility matrix for runtime, leaf/harvest/policy/frozen-public formats and the hosted API. Unknown versions fail closed with a supported recovery path, and migrations operate on backups before atomically switching; downgrade must refuse documents the old version cannot interpret. Publication revocations and operation records cannot be rolled back with a content snapshot, so a normal file backup is not a complete hosted recovery story. Seven reflects a specified requirement, not an implemented migration; 10 requires real old/new artifacts, failed-migration rollback and support documentation on the release candidate.

### DX pass 6: Development environment and tooling, 7 → 8/10

The core uses Node's native TypeScript support, workspace exports and included types; it needs no generated `dist` or mandatory SDK, IDE extension or container. Preserve noninteractive CLI use and test exit codes, path quoting, Unicode, spaces, occupied ports and available OS/runtime combinations rather than declaring Windows support from source alone. Qualify the selected pilot OS/runtime/source combination before L1, then record the broader promised support matrix at L4, with the separate website framework build limited to that app. A 10/10 needs fresh-environment verification on every promised platform and a minimal redacted diagnostic report that explains configuration without exporting portfolio data.

### DX pass 7: Community and support, 5 → 7/10

The quickstart already provides an email and a GitHub issue path; the gap is a named responder, service scope and sustainable support commitment, not absence of a channel. Keep the repository/private preview and license/CLA owner gates explicit; do not add a LICENSE, promise permissive licensing, open contributions or create a public community merely to satisfy a generic checklist. Show the approved offer and any model/hosting costs before consent or payment, with no invented free tier or surprise escalation. A 10/10 requires operating support, accepted terms and a real escalation/exit rehearsal appropriate to the selected customer.

### DX pass 8: Measurement and feedback, 6 → 8/10

Use opt-in facilitated observations for the first pilot rather than adding background product telemetry. Record candidate SHA, environment/source prerequisites, elapsed stage times, intervention points, errors and whether the participant produced a useful artifact and an eligible outward artifact; never convert those measurements into a personal score. Redact identities, private filenames/content and model prompts from shared diagnostics, and preserve failed/empty attempts in the trial record. A 10/10 needs actual observations and a subsequent live DX review comparing the measurements to these targets.

| DX scorecard, specification only | Initial | Amended | Remaining evidence |
|---|---|---|---|
| Getting started | 5 | 8 | Cold/prepared first-user run |
| API/CLI | 7 | 8 | Real help/recipe completion |
| Errors | 6 | 8 | Three repaired paths and partial-stage recovery |
| Documentation | 5 | 8 | Version-matched copy-paste/findability trial |
| Upgrade | 3 | 7 | Compatibility/rollback rehearsal |
| Environment | 7 | 8 | Actual supported OS/runtime matrix |
| Community/support | 5 | 7 | Responder and offer accepted |
| Measurement | 6 | 8 | Real participant observations |
| Overall | 5.5 | 7.8 | Specification improved; product DX unmeasured |

Competitive position: **needs evidence**. First useful moment is designed via the local CLI/browser using authorized source material. Zero-friction, learning by doing, uncertainty reduction, explicit defaults/escape hatches and code-in-context have plan coverage; actual delivery and measurement remain gaps. The fifteen-minute historical full-journey budget exceeds the five-minute first-result target, but they measure different endpoints, so no false improvement is claimed.

### DX implementation checklist and tasks

- [ ] One dependency-install command after explicit access/runtime prerequisites; no hidden cold downloads.
- [ ] Actual meaningful first result within the stated prepared five-minute target; cold total reported separately.
- [ ] Existing CLI/browser provides the source-backed first useful moment; empty results remain honest.
- [ ] Copyable command grammar, explicit garden/source defaults, safe overrides and three actionable error paths.
- [ ] Versioned local/export/hosted documentation with real examples; no invented counts or unsupported hosting promise.
- [ ] Format compatibility, deprecation notices, migration and revocation-preserving rollback; automate only migrations actually required.
- [ ] Types/noninteractive commands and promised OS/runtime combinations tested; no new general SDK or IDE plugin.
- [ ] Existing support channel staffed with agreed scope; changelog and approved price/terms available before paid launch.
- [ ] Documentation navigation/findability tested; full-text search service, public community and free tier are not automatic requirements.
- [ ] Opt-in observation records validate targets without background content telemetry.

- [ ] **DX-T1 (P1, human: ~1 day / agent: ~1–2h)**: reconcile quickstart/help and local-versus-hosted sharing contracts. Files: `TESTER-QUICKSTART.md`, `README.md`, `foliage.mjs`, `docs/CANOPY-CLOUD.md`; run exact recipes on the accepted candidate.
- [ ] **DX-T2 (P1, human: ~1 day / agent: ~1–2h)**: make CLI recovery stage-aware and preserve named failures. Files: `foliage.mjs`, `apps/leaf/harvest.mjs`, CLI seam tests; validate malformed state, subprocess failure, timeout and partial success.
- [ ] **DX-T3 (P1 before release, human: ~1–2 days / agent: ~2–4h plus rehearsal)**: document and exercise format/runtime compatibility and private support diagnostics. Files: `docs/DEPLOYMENT.md`, format parsers/tests, `TESTER-QUICKSTART.md`; observe real onboarding and exit without claiming unmeasured timings.

### Decision audit continuation — DX

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| A24 | DX | Technical facilitator persona and DX POLISH | Auto | P6 | Fits private checkout and CLI evidence without choosing commercial customer | Silent developer market pivot |
| A25 | DX | Existing deterministic CLI/browser as first-result vehicle; prepared under-five-minute target | Auto | P4/P5 | No new sandbox/model prerequisite needed; cold total stays visible | Invented demo or measured timing |
| A26 | DX | Split local-copy and managed-hosted docs, preserve both capabilities | Auto | P1 | Static copies cannot promise later withdrawal; existing launch policy already decided | Host-anywhere advice as customer release path |
| A27 | DX | Preserve exact error causes, stage receipts and executable recovery | Auto | P1/P5 | Partial writes and malformed state must not become zero/success | Blind retry or silent fallback |
| A28 | DX | Compatibility and revocation-preserving migration plus bounded support | Auto | P1/P6 | Paid users need safe exit; scope/pricing remain owner gates | New license/free tier/public community by checklist |
| A29 | DX | Opt-in timing/findability trial, no background content telemetry | Auto | P1/P5 | Measures actual friction without weakening privacy promise | Fabricated benchmark or person score |


### DX independent voices and final reconciliation

**CLAUDE SUBAGENT (DX — independent review):** seven findings from original plan/README/launcher excerpts without earlier reviewer context: alleged missing workspace preflight, competing document roots, tests before value, port defaults, runtime range, upgrades, and flag/source defaults. Full output: [dx-claude.md](~/.gstack/projects/aacker71-foliage/autoplan-launch-20260905/dx-claude.md). Discard the missing-preflight claim: `server.mjs` catches dynamic imports through `preflight.ts`, which already prints the resolver cause plus the install remedy. Also discard its unsupported port-band/test-count assertions and blanket refusal to use Foliage's own repository; this owner legitimately has work here. Do not duplicate every garden option into every child CLI merely to make names match. The installer already checks the runtime ceiling, while entrypoints enforce only the floor; reconcile those contracts rather than inventing a second preflight policy.

**CODEX SAYS (DX — developer experience challenge):** seven repository-backed findings: unsafe harvest refresh, swallowed promotion failure, help/context behavior, timing boundaries, candidate-specific docs, early upgrade procedure and pre-pilot environment qualification. Full output: [dx-codex.md](~/.gstack/projects/aacker71-foliage/autoplan-launch-20260905/dx-codex.md). Source reviewed at `ffea9b2`, with cached integration comparison at `3a9bf88`; its remote comparison is not a fresh remote probe.

The highest-priority additions are concrete. `proposeDocument.ts` treats unreadable/malformed prior harvests as absent; `harvest.mjs` forced proposal writes directly with truncation. Require distinct absence versus invalid/unreadable outcomes, original-byte preservation, lock-protected atomic replacement and interruption recovery. `foliage.mjs` ignores the promotion result and can recommend export after failure; repeating review on an all-decided queue bypasses promotion. Require a named approved-but-unpromoted state, full diagnostic/exit propagation and an explicit resume command with the same harvest/leaf context. These extend DX-T2 and CEO-T3 rather than adding a second storage implementation.

`grow --help` currently enters grow, so per-command help must be parsed before any directory creation, intake or writes, and unknown options must fail explicitly. Document `--garden`, `--repo`, `--by` and correction consistently, including review against the original repository rather than defaulting evidence lookup to this checkout. Add DX-T4 for that distinct CLI contract.

Before the first pilot update, the facilitator records the current approved revision, stops writers, backs up the entire participant garden, selects the next approved revision, relinks dependencies, checks supported document versions and exercises read-only loading before resuming. An incompatible or failed migration leaves the original garden intact; restore local backups only with writers stopped. Hosted recovery follows the separate monotonic-revocation protocol. DX-T3 is therefore required before L1 updates, with the broader hosted release rehearsal at L4.

| DX dimension | Claude | Codex | Consensus |
|---|---|---|---|
| Getting started under five minutes | Unproven; guide impedes value | Unmeasured; boundaries inconsistent | Shared concern; clock/prerequisites corrected |
| Guessable naming | Strong domain, operational drift | Retain names; help/context unsafe | Shared concern; preserve names, repair behavior |
| Actionable errors | Strong core, alleged gaps | Concrete refresh/promotion gaps | Shared concern, different evidence; preflight false positive removed |
| Findable complete docs | Competing roots/map | Candidate-specific parity | Shared concern; one version-indexed entry |
| Safe upgrades | Missing garden path | Procedure needed before pilot | Shared concern; L1 procedure required |
| Environment friction | Runtime/identity prerequisites | Qualify source/platform before L1 | Shared concern; model optional for git |

Consensus: **6/6 shared concerns, zero confirmed passing dimensions and no remaining model disagreement requiring a new owner choice.** Both favor making first value precede contributor checks in customer documentation; this is a documentation clarification, not removal of the required candidate `pnpm check` gate or a launch-scope challenge.

- [ ] **DX-T4 (P1, human: ~1 day / agent: ~1–2h)**: make per-command help nonmutating, reject unknown flags and retain explicit source/garden/reviewer context. Files: `foliage.mjs`, `TESTER-QUICKSTART.md`, CLI seam tests; verify help leaves the filesystem unchanged and review resumes against the intended source.

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| A30 | DX | Discard unsupported preflight/port claims; reuse current installer and entrypoint guards | Auto | P4/P6 | Actual code disproves absent guard and documents differing runtime checks | Duplicate root-symlink probe or blanket own-repo refusal |
| A31 | DX | Refuse unreadable prior harvest; atomic refresh and explicit failed-promotion resume | Auto | P1 | Concrete source paths can lose state or imply completion | Truncating retry or swallowed child failure |
| A32 | DX | Nonmutating subcommand help, strict arguments, persistent source/garden context | Auto | P1/P5 | A help request must not start a write | Renaming all child flags or silently guessing target |
| A33 | DX | One precise prepared timing boundary; qualify platform and backup/update before L1 | Auto | P1/P6 | First pilot already needs safe environment and updates | Leaving all qualification until L4 |

**Phase 2.5 complete.** DX specification: **5.5 → 7.8/10**. Actual TTHW remains unmeasured; prepared target <300 seconds, cold setup and human review reported separately. Eight scored passes, nine-stage journey, empathy/roleplay, benchmark sources, checklist and four tasks are complete. Seven findings from each outside voice were evaluated, including rejected false positives. Pass the amended plan to **Eng, the final review phase**.

### Engineering scope challenge and existing leverage

Mode: **FULL REVIEW**, after CEO, Design and DX amendments. All L0–L6 outcomes and all five product tracks remain; there is no scope reduction. This is several release milestones, not one safe implementation commit: the local writer fixes, hosted admission contract, identity/storage transaction, reader/revocation path, UI adoption and commercial readiness have different prerequisites. Split those into explicit deliverables and evidence gates while preserving the original permission to build hosting foundations alongside L1.

Actual source and selected test bodies were read at `4dcb8ca` (which includes the concurrently landed Scarlet change); cached integration `3a9bf88` is a separate candidate and does not inherit local UI work. Prior learning applied: **publication-consent-binds-effective-state**, confidence 10/10, 2026-09-04: consent binds exact leaf bytes, semantic policy and exact existing publication bytes; recovery remains available without a readable local source. The previous review-driven publication fixes are present, but they solve local files, not a deployed multi-instance service.

| Subproblem | Already exists | Planned use / delta |
|---|---|---|
| Source parsing, attribution, exclusions | `@foliage/leaf`, intake CLI and git signature tests | Reuse; qualify actual first-customer material before promising new connectors |
| Candidate review and promotion | `@foliage/photosynthesis`, digest/binding tests, web/CLI review | Reuse rules; close all participating file-writer races and failed-resume behavior |
| Publication policy and outward format | `@foliage/canopy` review/parser/diff, v1/v2 compatibility | Reuse codec/policy, not as proof of remote uploader honesty; version any rich payload expansion |
| Local publication transaction | `publicationLock.mjs`, `publicationMutation.mjs` | Preserve local semantics; durable hosted transaction replaces filesystem serialization in hosted adapter |
| Local manager/reader | `manage-server.mjs`, `renderManage.ts`, `renderPublished.ts` | Reuse review presentation and admitted artifact renderer behind new authenticated transport |
| Account, ownership, durable operations | No deployed implementation established | New cloud-only adapter and US datastore, explicit admission/security contract |
| UI system | Tokens, native renderers, website-local controls | Route-scoped adoption, no second palette or general rewrite |
| Install/diagnostics | Node/installer/workspace preflights and quickstart | Reconcile current contracts; repair help/context/partial results rather than replace all tools |
| Enterprise release policy | `@foliage/enterprise-policy` pure transition gates | Reuse when its first-buyer gate activates; hosted role/membership enforcement is additional work |

Complexity check: a generic workflow engine, new service per mutation, shared global score model, second policy evaluator, public source playground and custom billing portal add complexity without a required first-flow benefit. The smallest complete architecture is existing domain gates plus one narrow hosted authority and one shared local writer protocol. It still needs durable operation records, a proof/admission decision and revocation-safe serving; removing those would remove required correctness, not simplify implementation.

### Engineering 1: Architecture, ownership and transactions

```text
OPEN PLANE                                      CLOUD PLANE
real authorized source                          account/session provider
  -> intake/attribution                           -> ownership + id reservation
  -> candidate draft/review                        -> admission verifier [CONTRACT GATE]
  -> shared local write protocol                   -> publication service
  -> Leaf/policy                                        |       |
       | explicit exact-outward review/consent            |       +-> history + receipts + outbox
       +---------------- admitted payload -------------->|
                                                         +-> private immutable bytes
                                                         +-> durable revision + revocation
                                                                  |
                                                      public reader on every request
                                                      -> authority -> exact allowed bytes
                                                      -> unavailable/error, never fallback
ENTERPRISE (when buyer gate activates)
subject/membership + policy-owner approval -> existing release machine -> same outward gate

Billing -> payer entitlement only; never subject ownership or publication consent
Logs -> opaque operation/outcome/version only; never content, credentials or raw private review
```

The hosted service is a new trust boundary. Authentication proves control of an account; a structurally valid frozen artifact proves neither that its uploader owns the named subject nor that its provenance was cryptographically checked. The current parser intentionally reconstructs verified leaflets while re-running text/shape rails, so directly accepting arbitrary uploads into that parser would elevate client claims. **L2 admission is blocked until the approved trust source, identity/key binding, evidence retention and privacy-preserving verification envelope are specified and adversarially tested.** Reusing the codec is sound; treating it as an authorship verifier is not. Do not solve this by uploading a raw private Leaf or all source objects without separate explicit consent, or by downgrading the product's verified-only publication rule.

Required durable records in the selected Supabase Postgres authority are account→subject ownership, non-recycled public identifier, immutable artifact revision, publication head, monotonic revocation generation, consent envelope, history, idempotent operation result and pending outbox event. Ownership is server-derived and immutable through normal upload; payer/organization membership cannot substitute for subject authority. Consent binds destination/account/subject, exact payload digest, effective policy digest, expected public revision, admission-format version and operation intent; authorization and bounds are rechecked at commit, not only during preview. The admissible proof payload is still a contract gate, not an invented implementation detail.

```text
review exact artifact + current authoritative revision
  -> explicit consent -> authenticate + authorize operation/receipt access
  -> existing operation? (before staging or new-mutation revision checks)
       -> same request hash -> recorded historical receipt + separately read current visibility
       -> different request hash -> conflict
       -> in progress -> authenticated pending/status response, no second mutation
  -> new operation -> ownership + admission + bounded input
  -> stage immutable PRIVATE bytes (unreachable from public paths)
  -> transaction recheck operation uniqueness + current ownership/admission/policy
       -> raced existing operation -> its recorded/pending outcome, never second commit
       -> compare expected revision and revocation generation
            -> stale / changed policy or admission -> refuse, rereview
            -> commit head + consent + history + operation result + outbox atomically -> durable receipt
  -> network lost after commit -> UNKNOWN in UI -> owner-authorized status lookup
  -> staging failure / transaction abort -> old head unchanged; orphan cleanup safe
```

Use a Supabase Postgres transaction/row lock or an equivalent atomic compare-and-set, not the local filesystem lock or a process mutex. D8 requires the domain change, history, operation receipt and pending outbox event in the same transaction; Novu delivery happens separately after current authorization and channel checks. Private Supabase Storage object staging is a separate operation, not part of that database transaction: keep bytes immutable, stage before commit, then publish only a committed pointer. A failed cleanup after commit is a warning attached to successful publication, just as the local helper separates `releaseWarning` from `mutationError`. Uncommitted objects can be deleted later, but cleanup must not delete any current referenced object or undo the authoritative operation record.

Withdrawal increments the durable generation and clears public reachability in the same transaction that stores its history, receipt and pending event. Stale publish/replace operations, including old retries after logout, cancellation or restore, cannot re-enable that generation. Republishing is permitted only after fresh review and consent against current authority. Idempotency records may expire only under a documented policy that still prevents an old request from resurrecting revoked content; the monotonic authority survives longer than a short request cache.

A read beginning after acknowledged withdrawal must query authority that observes that commit, then serve only a matching committed artifact; no positive-status cache or stale replica is permitted. HTML, HEAD, leaflet, media, download, tree/listing, preview alias and historic deployment routes must all pass this gate. Missing/revoked/nonexistent states share the approved unavailable public response; authority outage is an honest service failure with no fallback to local projections or old bytes. Logs may distinguish internal causes without disclosing them publicly.

Supabase is selected for Postgres authority and private object storage under D9. Database grants and RLS are complementary controls; service-role paths require explicit server ownership checks because that role bypasses RLS. Storage service keys likewise bypass storage policy and must remain server-only; a private bucket by itself does not enforce the application's subject rules. These are documented provider behaviors, not inspected settings of Foliage's resources. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control). Supabase Auth remains a separate identity choice; selecting storage does not establish hosted admission or authorize personal publication.

Before hosted acceptance, inspect the existing Vercel/Supabase resources, implement and test the transaction/staging adapter, enforce withdrawal on every content read, and rehearse recovery across database authority and object bytes. [Vercel storage](https://vercel.com/docs/storage) describes the hosting/storage options; [Supabase regions](https://supabase.com/docs/guides/platform/regions) informs region selection. Record actual US compute, data, replicas, backup and log handling rather than inferring residency from the provider name. [Supabase database backups](https://supabase.com/docs/guides/platform/backups) do not contain Storage object bytes: evidence their backup/restore separately, then prove that a combined restore preserves revocations, receipts and pending work and detects missing objects before serving. This amendment records the provider decision and implementation requirements; it does not provision, deploy or claim these hosted controls are implemented.

### Engineering findings with source and confidence

These findings distinguish verified source behavior from future design risks; none is described as a reproduced exploit in this review. Fix requirements are recorded in the plan, not implemented code.

| # / priority / confidence | Motivating source quotation | Finding and decision |
|---|---|---|
| E1 / P1 / 10 | `apps/leaf/server.mjs:969`: “two decisions racing still read the same document”; `:977`: `await rename(temp, load.path);` | Atomic rename does not prevent lost updates. One open-plane protocol must cover read/validate/write for every writer of the same document. |
| E2 / P1 / 10 | `apps/leaf/src/proposeDocument.ts:109`: “an absent, unreadable or malformed prior document is \"nothing to carry forward\"”; `harvest.mjs:363`: `flag: force ? "w" : "wx"` | Distinct prior-read failures are collapsed before a truncating forced write. Refuse invalid/unreadable existing state and preserve bytes; use atomic staged writes with interruption recovery. |
| E3 / P1 / 10 | `foliage.mjs:334`: `const g = runQuiet(...` promotion; `:335`: prints `g.out.trim().split("\\n")[0]`; `:344`: export recommendation | Promotion status is not checked; previously approved but unpromoted work lacks a launcher resume path. Propagate full errors and durable stage result; add explicit resume. |
| E4 / P1 for hosting / 10 | `packages/canopy/src/publishedDocument.ts:457`: `tier: "verified" as const`; `:793`: `tier: "verified"` in reconstructed leaf | Codec rechecks shape/text, not remote evidence authorship. Add a separate hosted admission trust contract before exposing an upload route. |
| E5 / P1 contract / 10 | `packages/canopy/src/publish.ts:199–206` defines only `id`, `title`, `tier`, `provenance`, `titleRedacted`; `promote.ts:449`: `tier: "pending" as const` | Local rich candidates do not imply an eligible rich public portfolio. Enforce exact-outward trial and versioned payload gate, preserving owner sequencing choice. |
| E6 / P1 for hosting / 9 | `publicationLock.mjs:24`: `const lockPath = \`${target}.lock\``; `:36`: `await link(ownerPath, lockPath)` | Local lock is filesystem-scoped. Preserve locally; use durable transaction/CAS for hosted multi-instance mutations and revocation. |
| E7 / P2 UI / 10 | `server.mjs:891–893` reads reviewer/reason/title; `:898`: `body: renderReviewPage(load, refusal)` | Refused form drafts are not passed back. Preserve escaped submitted draft separately from accepted state and restore accessible focus. |
| E8 / P1 privacy contract / 10 | `renderPublished.ts:169`: `const w = document.withheld`; `:193`: renders `w.count` | Existing public aggregates conflict with the new no-private-accounting design direction. Explicit public allowlist/owner contract, including failures and metadata, precedes UI/transport claims. |

Exact source excerpts and test assertions were read, rather than promoting search matches alone. Any broader claims about actual database isolation, provider regions, OS compatibility, load performance or cold onboarding are unverified and remain acceptance requirements. There is no claim that current local files are an already exposed hostile multi-tenant service.

### Engineering 2: Code quality and local write protocol

There are multiple atomic-write implementations across intake, harvest, share, policy and two review servers. Their differences are observable: forced harvest writes truncate while intake stages a replacement; unique temp names prevent collisions but not lost updates; one loader collapses unreadable prior state while another preserves explicit causes. The fix is a common open-plane I/O protocol, with domain parsing and candidate/policy decisions remaining in their existing packages; do not import the cloud publication helper into open code or add disk operations to the pure `@foliage/leaf` model.

Place the shared Node I/O helper behind an explicit open-package export (a narrow `@foliage/photosynthesis` subpath is the recommended first implementation location, subject to boundary/type checks). Inventory and enroll every writer of the relevant leaf/harvest/policy resources: `apps/leaf/intake.mjs`, `harvest.mjs`, `share.mjs`, `policy.mjs`, `server.mjs`, and `apps/photosynthesis/photosynthesis.mjs`/`review-server.mjs`. Reads used for a decision happen under the guard or are compared against a freshly read exact revision while holding it. For operations spanning leaf and harvest, acquire resources in a stable path order and recheck both bindings; duplicate promotion remains idempotent and a failed multi-step result records exactly which durable file changed.

Slow git/model work should occur outside the commit lock against an identified input snapshot, followed by guarded re-read/compare at write time. Use exclusive temporary files in the target directory, validate the serialized result before atomic replacement, and preserve original bytes on any failed precondition. Define symlink/path-alias identity and either canonicalize consistently or refuse unsupported aliases, so two names cannot bypass one lock; stale owner records fail closed with a documented recovery action. A portable file lock cannot promise protection from arbitrary editors outside this protocol, so document external-edit limitations and never silently reclaim another process's lock.

Use discriminated outcomes for absent, malformed, invalid, unreadable, stale, unauthorized, failed and unknown. Preserve primary failure plus cleanup failure; no `null`, zero count, generic success or redirected toast should imply that unread work was empty or a mutation did not happen. Existing preview/diff and publication parsing should remain single definitions, with hosted transport adapting I/O rather than reproducing the rules. Inline architecture comments belong at the local transaction helper, hosted commit/status service and withdrawal reader gate, where order is part of correctness; no ornamental diagrams are needed in simple renderers.

### Engineering 3: Tests and branch coverage plan

Framework detected from `package.json`: **Node `node:test`**, running TypeScript through native stripping, plus real subprocess/HTTP seams. Test source bodies were read for local manager consent/origin/stale bytes, publication/withdrawal, lock contention, cleanup failure, policy precedence, refresh review-digest behavior, promotion binding, loopback redirect refusal, media integrity and enterprise role transitions. These tests provide useful existing mechanisms, but synthetic parser inputs or generated cryptographic fixtures never establish a real customer portfolio or a deployed security result.

The following map covers the planned UX and transport branches. “Existing” means relevant source assertions were inspected, not rerun in this documentation review. Every `GAP` is a required implementation test or milestone observation; no gap is silently deferred past the milestone that needs it. Exact new filenames below are proposed and follow the existing `*.test.ts`/`*.seam.test.ts` conventions.

```text
T01 help/config -> help | unknown flag | invalid context | supported run
T02 source -> missing/unreadable/not git | no commits | undeclared identity | attributable work
T03 refresh -> absent | valid unchanged | changed | invalid/unreadable prior | interrupted write
T04 decide -> approve/retitle | reject/reason | stale/already decided | concurrent writer | I/O error
T05 promote -> bound | legacy unbound | wrong subject | already promoted | saved decision/failed promotion
T06 model/media -> explicit opt-in | refused endpoint/redirect | timeout | invalid/ungrounded | valid
T07 owner UI -> empty/filter-empty | title/body/media | unreadable part | return/focus/mobile/large list
T08 outward codec -> eligible | pending/excluded/deny | redacted | unsupported version | exact diff
T09 auth -> signed out | sign-in/recovery | expired/replayed session | foreign subject | valid owner
T10 public ID -> reserve | conflict | invalid path | withdrawn/deleted reservation | forbidden reassignment
T11 upload -> over limit/bad type | forged provenance | wrong owner | stale policy/consent | admitted bytes
T12 commit -> new/replace | expected-revision conflict | staging error | transaction abort | committed receipt
T13 retry/status -> same id/body | same id/changed body | lost ACK | navigate away | foreign/expired status
T14 public read -> allowed | missing/revoked | authority outage | old alias/cache/object path | HEAD/media/tree
T15 withdraw -> live | already revoked | stale publish race | ACK lost | post-ACK read on another instance
T16 release/restore -> compatible migration | fail/rollback | old backup | old deployment | region/config drift
T17 payment -> success/decline | duplicate/out-of-order event | forged webhook | cancel/dispute | reconciliation
T18 exit/support -> export | partial export | account recovery | delete/retention | corrupted local source
T19 enterprise -> right/wrong role | membership change | subject/policy-owner separation | withdrawal/departure
T20 customer gates -> authorized source | assisted/unassisted | useful/ineligible artifact | reader/offer/support
```

| Group | Relevant inspected coverage | Required gap closure / test type |
|---|---|---|
| T01 | `nodeFloor.test.ts`, `tools/install/requirements.test.mjs` validate runtime errors; garden tests exist | `foliageHelp.seam.test.ts` [NEW]: per-command help makes no filesystem/process mutation; unknown flags/duplicates/missing values refuse; target context remains explicit. Integration. |
| T02 | Intake attribution/merge source, existing git and zero-attribution seams | Run actual supported source/environment cases at L1; add only newly supported source branches, no invented positive result. CLI integration + real participant observation. |
| T03 | `reviewDigest.seam.test.ts` preserves identical approvals and reopens changed/legacy material | `localWrites.seam.test.ts` [NEW]: unreadable/invalid prior bytes unchanged; forced refresh interruption does not truncate; stale snapshot refuses/retries explicitly. Subprocess fault injection. **Critical.** |
| T04 | Review digest/binding and local HTTP refusal tests | Extend `localWrites.seam.test.ts` plus `studioSeam.test.ts`: two processes deciding same/different candidates, refresh-versus-decision, preserved retitle/reason/focus on refusal, failed temp/rename, stale lock. **Critical integration + browser.** |
| T05 | `promoteRoute.seam.test.ts` exercises bound/unbound redirect and durable append | `foliagePromotionResume.seam.test.ts` [NEW]: decision survives failed promotion; nonzero child result/full causes; all-decided resume; duplicate-safe retry; leaf/harvest race. **Critical integration.** |
| T06 | `loopbackFetch.test.ts` real redirect/no second-host body; media integrity tests | Keep those gates; add timeout distinction and any new input/egress limits. If prompts/tools change, run named LLM suites/evals below. Socket integration + parser units + conditional eval. |
| T07 | `render.test.ts`, frond/CSP/day-face tests; media store verifies bytes/digest | Accepted journey browser evidence at real 360/768/1440 viewports, keyboard, zoom, reduced motion, return filters/anchors, long strings/large real collection, no extra accent or external fonts. UI behavior gaps remain. |
| T08 | `publishSeam.test.ts` exact permitted title set, headers and withheld exclusions; parser v1/v2 and diff tests | Extend contract tests only for approved format/aggregate changes; old version refusal/compatibility, exact preview equality, no raw Leaf fallback, complete metadata/order diff. Rich payload tests conditional on approved format. |
| T09 | Local manager origin/Host/CSRF tests only, not account auth | `hostedAuth.seam.test.ts` [NEW →E2E]: two actual test accounts, expired/replayed sessions, sign-in return, recovery, cross-subject read/write/status refusal, payer≠owner. **Critical.** |
| T10 | Public-id parser rejects path transformations/traversal | `hostedIdentity.seam.test.ts` [NEW]: concurrent reservation, conflict, ownership, deletion/tombstone, never recycle; old identifier cannot be reassigned. DB integration. |
| T11 | Frozen parser tests shape/redaction but do not verify remote authorship | `hostedAdmission.seam.test.ts` [NEW →E2E]: arbitrary valid-looking artifact cannot acquire verified status; trusted proof/key binding per approved contract, changed digest/policy/owner, unknown fields, byte/type/depth limits. **Critical.** |
| T12 | Local exact leaf/policy/public-digest tests and lock/cleanup tests | `hostedPublication.seam.test.ts` [NEW →E2E]: independent app instances, real database/object store, compare-and-set races, stage/commit/cleanup faults, no orphan public reachability. **Critical.** |
| T13 | Local cleanup success/failure separation; no durable hosted request-status protocol | Same hosted suite: duplicate id returns same receipt, changed body conflicts, response lost after commit resolves through authenticated status, navigation/session expiry retains reference, operation expiry never authorizes replay. **Critical.** |
| T14 | `publishedLeaf.test.ts` absence/error/escape cases and local no-store/CSP seam | `hostedReader.seam.test.ts` [NEW →E2E]: all serving routes and historical URLs fail closed; query authoritative status per request; no direct public/signed URL bypass; no wrong-id/operator leakage. **Critical.** |
| T15 | `withdraw.test.ts` confirms exact target/removal and stale-byte refusal | `hostedWithdrawal.seam.test.ts` [NEW →E2E]: request-start after durable ACK on another instance gets no bytes; concurrent stale upload/retry cannot resurrect; duplicate/lost ACK converges. **Critical.** |
| T16 | v1/v2 parser compatibility and local stale-lock tests only | Deployed preview rehearsal: failed migration leaves originals; restore older content with latest revocation authority before serving; refuse old unsupported app; audit regions/replicas/backups/logs/old deployments. **Critical operational E2E.** |
| T17 | Billing implementation not established | `billingEvents.seam.test.ts` [NEW →E2E before paid L5]: real provider test-mode events/signatures, duplicates/order/replay, decline/cancel/dispute, pending reconciliation, entitlement without ownership/data deletion. **Critical for paid launch.** |
| T18 | Local inventory/withdraw works with corrupt local Leaf in manager test | `hostedExit.seam.test.ts` [NEW →E2E]: recover owned publication without local bytes; authorized export/partial error; account recovery and deletion retain revocation protections; support redaction and no model/employee impersonation. |
| T19 | `enterprise-policy/release.test.ts` and enterprise review-gate units | `enterpriseAccess.seam.test.ts` [NEW →E2E when buyer gate activates]: real memberships/roles/department boundaries, departing member, employer denial, subject-only publish/withdraw and recruiter explicit-only visibility. No scope deletion. |
| T20 | No customer results established by test suite | L0/L1/L5/L6 evidence protocol: actual source permission, participant intervention/timing, exact outward reader usefulness, accepted offer/support and candidate-specific acceptance. Business observation, not generated unit data. |

**LLM and prompt evaluation:** this review changes documentation only, so no model eval was executed. For later inference/tool/prompt edits, run `apps/photosynthesis/src/drafter.test.ts`, `pipeline.test.ts`, `apps/leaf/src/harvestDraft.test.ts`, `brainSource.test.ts`, `photoSource.test.ts`, `scarletPrompt.test.ts`, `scarletModel.test.ts`, `scarletReliability.test.ts` and `scarletSeam.test.ts` as applicable to touched paths, plus the enterprise/escalated suites if their planes change. Add real authorized held-out source cases for unsupported citations, cross-subject contamination, changed policy/context, prompt injection in source content, empty/invalid/rating-shaped output, timeout and unintended writes/egress. Compare against the accepted candidate's literal-fact/citation and refusal behavior; a model's fluent answer or self-review is not truth evidence.

Run `pnpm check` on the final integrated implementation candidate, observing real output from every gate. Run targeted actual test filenames during fixes instead of a potentially unmatched workspace filter; the core has no build/dist step. Browser evidence names its own process/port, one owned tab, actual viewport read-back and tested SHA. The website gets its own documented framework checks in its actual integration checkout; do not claim a root check covers routes absent from this checkout.

### Engineering 4: Performance and resource bounds

Existing publication diff builds maps once and compares reader-visible order/metadata, so reuse its linear structure rather than adding a query per leaflet. The local renderer and document loaders read full files; that is acceptable only within explicit supported bounds and measured large-document behavior, not a blanket claim that arbitrary portfolios are cheap. Hosted reads should load one authoritative publication head and its admitted artifact per request, with bounded lists and batch-authorized media relationships; do not add a per-leaflet database round trip.

Set upload byte, decoded media byte/pixel, JSON depth/item-count, response and request-time bounds before accepting public requests. Avoid allocating the entire unbounded request before checking the limit, and reject compressed/decompression amplification or unsupported content types. Bound local model concurrency and do expensive source/model work outside transaction locks; record latency/queue/timeout observations without content. Exact numeric service limits are established against real candidate workloads and provider constraints before L2 acceptance, not invented as measured capacity here.

Cache immutable shell assets/fonts/styles if useful; personal artifact bytes and positive publication status cannot bypass per-request revocation authority. An authoritative store outage deliberately trades availability for non-disclosure; dashboards must show that failure rather than produce a zero-work page. At tenfold measured pilot load, test storage/read amplification, connection-pool pressure, slow media and concurrent publish/withdraw, and record actual latency/memory/error outcomes. No p95, throughput or recovery-time result was measured during this planning review.

### Engineering deployment, operations and failure modes

Use a new hosted adapter behind preview access while preserving the loopback server's Host/origin protections. Capture a coherent code/config/schema candidate, inspect US resource placement, apply backward-compatible schema changes, deploy the compatible reader, then exercise real multi-instance mutation/revocation before any customer URL is enabled. A backup restore is a separate procedure: stop serving, restore content, reconcile the latest durable ownership/revocation/operation authority, validate, and only then reopen; if authoritative revocations cannot be recovered, continue failing closed. Owner-set recovery-time/data-loss targets and responders remain L4 prerequisites.

Billing uses the chosen provider's authenticated events and durable reconciliation; a browser redirect is not payment truth. Stripe, if selected, documents signed raw-body verification, duplicate delivery and non-guaranteed ordering, so test those behaviors rather than assume one ordered event per charge. See [Stripe webhook documentation](https://docs.stripe.com/webhooks). Cancellation changes entitlement under the approved terms and never grants or transfers subject ownership, publishes work or silently destroys a garden.

| Failure group | Test/handling today | Required visible result and control | Critical gap until |
|---|---|---|---|
| F1 Local refresh/concurrent decision loses work | Partial digest/atomic paths; explicit race and prior-read masking | Preserve bytes/drafts; conflict/recovery; one writer protocol | T03/T04 pass |
| F2 Promotion fails but export is recommended | Child result ignored in launcher | Decision saved, promotion failed, executable resume and nonzero exit | T05 pass |
| F3 Account/recovery/subject takeover | No hosted account enforcement established | Refuse foreign authority without existence leak; secure recovery | T09/T10/T18 pass |
| F4 Forged uploaded artifact becomes verified | Parser assumes trusted producer, no hosted proof admission | Refuse admission without approved evidence/key binding | T11 contract + adversarial tests pass |
| F5 Duplicate/stale operation changes public state | Local lock only | Durable idempotent receipt/CAS; unknown-result status resolution | T12/T13 pass |
| F6 Withdrawn content served through another path | Local tests only | No bytes after ACK across instances/routes/objects/history | T14/T15 pass |
| F7 Restore or old deployment resurrects content | No deployed rehearsal | Revocation authority reconciled before serving; fail closed | T16 pass |
| F8 Billing event wrongly revokes ownership/data | No billing integration established | Reconcile event; entitlement separate from subject/data | T17 pass before paid L5 |
| Invalid source/model/media | Named local refusals tested in source | Specific repair with no fabricated output; no remote fallback | Retain T02/T06, extend only touched branches |
| Slow/oversized work | Some local bounds; no hosted capacity evidence | Limit named before dangerous allocation; no fake progress | T07/T11 load evidence |
| Enterprise role/membership change | Pure transition tests exist | Server-authorized scope and subject-controlled exit | T19 before organization/member/recruiter offer |
| Pilot has no useful outward artifact | No participant evidence | Honest local value/public eligibility and reader read-out | T20 before usefulness/offer claims |

The eight F-groups are **critical implementation/evidence gaps for their stated milestones**, not eight newly deployed exploits. Each has explicit required error handling and tests in this plan; the plan does not label those future controls as shipped.

### Engineering workstreams, exclusions and task boundaries

| Workstream | Modules | Depends on |
|---|---|---|
| Local safety + CLI recovery | `apps/leaf`, `apps/photosynthesis`, `packages/photosynthesis` | L0 source/context contract |
| Pilot offer/observations/support | Private participant records, launch/operations docs | Owner first-customer/offer; selected environment |
| Hosted admission + authority | `packages/canopy`, `apps/canopy`, cloud migrations | L0 ownership, proof/payload/disclosure contract |
| Hosted reader/revocation | `apps/canopy`, deployment configuration | Hosted authority/format + exact-serving protocol |
| UI adoption | `apps/leaf`, tokens consumers, website | Accepted first slice; local safety before recovery acceptance |
| Billing/enterprise expansion | Cloud billing / enterprise modules | Respective first-offer and governance gates |

For later implementation, cap active code lanes at two plus one integration owner: a local lane and a cloud lane can use separate worktrees once their shared contracts are agreed; participant/offer work can proceed independently if authorized. Local UI follows local writer/CLI work because both touch `apps/leaf`; cloud reader follows authority because both touch `apps/canopy`. Merge reviewed checkpoints into one candidate, then run integrated checks/evidence. Do not launch more agents during this review or edit the same plan/module in parallel; the concurrent Scarlet commit demonstrates why candidate identity must remain explicit.

**NOT in scope:** no new customer segment, no public launch/marketing messages, no fresh platform migration, no full React rewrite, no personal ranking, no unrequested source connectors, no public source playground, no generic workflow engine and no custom billing portal. Existing local export, all five product tracks and gated discovery remain. Deferred expansions are captured in TODOS with prerequisites rather than treated as accepted first-offer dependencies.

- [ ] **ENG-T1 (P1, human: ~2–3 days / agent: ~3–6h)**: implement one open-plane document transaction protocol across every participating local writer, including interruption/alias/stale-state handling. Files: `packages/photosynthesis` I/O subpath, `apps/leaf` writers, `apps/photosynthesis` writers and seam tests. Overlaps CEO-T3/DX-T2; coordinate one implementation.
- [ ] **ENG-T2 (P1 before hosted admission, human: ~2–4 days / agent: ~3–6h plus contract decision)**: define and implement hosted ownership, proof/admission, consent envelope and public-field allowlist. Files: `packages/canopy/src/publishedDocument.ts`, `apps/canopy/src/hosted` (new), cloud schema/tests. An arbitrary valid-looking upload must never mint verified authorship.
- [ ] **ENG-T3 (P1 before hosted release, human: ~3–5 days / agent: ~4–8h plus deployed rehearsal)**: implement the selected Supabase Postgres revision/history/receipt/outbox transactions, private Supabase Storage staging and all-route withdrawal on Vercel, with separate object recovery and revocation-preserving restore. Files: hosted adapter/schema, reader routes and `docs/DEPLOYMENT.md`; inspect actual regions/backup coverage and validate across real preview instances. Coordinates CEO-T5/DES-T2 and the accepted D8/D9 storage decisions.
- [ ] **ENG-T4 (P1 at the affected offer gates, human: ~2–3 days / agent: ~3–5h plus real acceptance)**: execute candidate-specific security, UI, onboarding, payment/support and conditional enterprise acceptance from the test artifact. Files: targeted seam suites, deployment/route evidence and private participant records. Reuse existing checks; no generated customer outcomes.

### Decision audit continuation — Engineering

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| A34 | Eng | Preserve scope; separate milestone deliverables and reuse existing gates | Auto | P2/P4 | One launch roadmap is not one implementation commit | Scope cuts or a generic platform rewrite |
| A35 | Eng | Common open-plane guarded read/validate/write for every local writer | Auto | P1/P5 | Atomic rename alone loses updates; cross-plane imports prohibited | Cloud helper import or process-only mutex |
| A36 | Eng | Hosted proof/admission contract before trusting uploaded artifacts | Auto, technical gate open | P1 | Parser mints verified type under trusted-producer assumptions | Account auth or valid JSON as authorship proof |
| A37 | Eng | Durable CAS/idempotent result with private staged bytes and monotonic revocation | Auto | P1/P5 | Lost ACK and stale retries must not publish or resurrect silently | Filesystem lock or cache as hosted authority |
| A38 | Eng | Authority check on every reader path and revocation-safe restore | Auto | P1 | Implements already-decided immediate withdrawal | Static personal pages, public objects or reusable signed redirects |
| A39 | Eng | Full branch/UX test map; new hosted seams and applicable LLM evaluations | Auto | P1 | Existing local tests do not prove distributed or customer outcomes | Test-count or parser-fixture evidence as readiness |
| A40 | Eng | Bounded resource use, safe logs, payment reconciliation and conditional role tests | Auto | P1 | Complete selected customer flow without surprise egress or ownership changes | Unbounded payloads/background content telemetry |
| A41 | Eng | Two future code lanes plus integration owner; serialize shared modules | Auto | P5/P6 | Scope can parallelize only at actual independent boundaries | Concurrent edits to the same modules/candidate claims |


### Engineering independent voices and reconciliation

**CLAUDE SUBAGENT (eng — independent review):** nine findings from the original plan, neutral amended requirements and source excerpts; no earlier reviewer conclusions or repository tool access. Its findings cover hosted identity/revision authority, untrusted redaction flags, malformed-state loss, ignored promotion status, duplicated decisions/writers, cleanup/locking, distributed storage, outward format and fault tests. Full output: [eng-claude.md](~/.gstack/projects/aacker71-foliage/autoplan-launch-20260905/eng-claude.md).

**CODEX SAYS (eng — architecture challenge):** three findings from the final amended plan/source/test bodies at `4dcb8ca`: local publisher not enrolled in the source/policy transaction; hosted admission/authoritative policy still an acknowledged contract blocker; receipt lookup ordered after stale-revision checks. Full output: [eng-codex.md](~/.gstack/projects/aacker71-foliage/autoplan-launch-20260905/eng-codex.md).

Accepted Claude findings reinforce the existing admission, local preservation and stage-result tasks. Extend admission to the truth of redaction/verbatim flags and authoritative policy freshness, not merely the claimed attribution tier. An uploader-controlled signature or HMAC does not prove an uploader's claims; the approved contract must name a trusted producer/verifier and its identity/key binding, permitted evidence disclosures and authoritative policy source. This unresolved L2 contract stays explicit, so a signed envelope is not silently selected as a solved architecture.

Several suggested fixes conflict with inspected code or owner requirements and are rejected. Do not import the cloud lock into the open plane, automatically steal stale file locks, use short cache TTLs/purge as withdrawal, redirect to reusable signed URLs, or copy a file the process cannot read. Pure candidate-decision reuse belongs with existing photosynthesis rules, not a new unrelated model in `@foliage/leaf`; retain separate I/O guards and domain decisions. The ignored promotion result occurs in `review`, not `grow`, and `--force` is not safely repaired by simply removing it from an existing update workflow. Existing mutation tests already cover cleanup failure and changed unparsable bytes, and the publisher handles `releaseWarning`; the blanket claim that those paths are all silent is false.

Public exclusions do not have to disclose private excluded records or counts to be honest. They remain visible with reasons in the subject's own accounting and are withheld outward under the existing contract. Unsupported hosted media/leaflet/download paths still need negative leakage tests; specifying those tests does not promise that the current format carries rich media. No narrowing of the original L2 safety surface is accepted.

**E9 / P1 / confidence 9/10:** `apps/canopy/publish.mjs:463` reads `const [source, policy] = await Promise.all(...)`, while `:650` inside the target lock checks only `assertPublicationUnchanged(existing, lockedExisting, target)`. A policy/source write between those points is not covered by the existing test that changes policy before the command starts. Enroll the local publisher's source/policy read-and-commit window in the shared protocol; cloud code may depend on the open helper, but never the reverse. Establish one stable lock order across source, policy and public target, re-read all current inputs under the guard, compare the exact reviewed digests, and commit only that version. Do not hold locks while waiting for a human or model. Add a controlled interleaving in `publishSeam.test.ts` that pauses after initial source/policy read, attempts a policy denial/source replacement, then resumes publication; the writer must serialize or publication must refuse the changed inputs, never publish a superseded projection silently.

**Receipt-order correction:** after authentication and authorization, resolve an already-known operation by its scoped identifier and request hash before staging bytes or applying new-mutation revision checks. A successful first attempt advanced its own revision, so repeating that request must return its original receipt rather than a stale-write conflict. An old success receipt must never imply that content is still live after a later withdrawal; show current effective visibility separately. Preserve transactional uniqueness for two simultaneous first attempts and test receipt recovery when object staging is unavailable. The architecture diagram and T13 requirements are amended accordingly.

| Engineering dimension | Claude | Codex | Reconciliation |
|---|---|---|---|
| Architecture | Needs writer/authority work | Conditional; publisher guard and admission gate | Aligned concern; both gaps made explicit |
| Test coverage | Inadequate; some alleged missing tests | Broad plan; precise race/retry additions | Difference: existing cleanup coverage credited, new seams required |
| Performance | Unproven; suggested TTL alternatives | Bounds appropriate; measurements absent | Difference: no TTL/signed bypass under owner contract; actual load evidence pending |
| Security | Admission/flags blocked | Admission/authoritative policy blocked | Aligned concern; technical contract unresolved |
| Error paths | Current local loss/masking blocks | Plan strong; receipt ordering wrong | Difference in code-versus-plan assessment; fixes/tests specified, no code-pass claim |
| Deployment | Not ready | Sound restore direction, evidence absent | Aligned concern; no launch approval implied |

Consensus: **3/6 aligned assessments, 3 differences reconciled using source evidence and existing user constraints; no new unresolved taste decision.** These are independent review judgments, not a security certification or six passing implementations.

### Engineering completion summary

| Required output | Result |
|---|---|
| Scope challenge | Original scope preserved, existing leverage mapped, complexity narrowed through reuse |
| Architecture | Graph + transaction/retry order + ownership/admission + all-route revocation specified; D9 Vercel/Supabase providers accepted on 2026-09-07 with D8 atomic history/receipt/outbox; hosted implementation and admission/policy trust contract remain open |
| Code quality | Shared writer inventory, prior-read preservation, decision reuse, full stage/cleanup outcomes and draft recovery |
| Source findings | Nine source-backed findings E1–E9; no deployed exploit claimed |
| Test review | Twenty scenario groups with branch/UX mapping, existing assertions distinguished from required seams/observations |
| Test artifact | Written at the linked path below, including the final publisher-race and receipt-order cases |
| Performance | File/read amplification, upload/model resource bounds, immutable shell caching and authority-read constraints reviewed |
| NOT in scope / existing work | Both written; all five product tracks remain |
| Failure modes | Eight critical milestone-specific groups F1–F8; remedies/tests specified but not implemented |
| TODOS | Five contextual expansions appended; legacy items preserved |
| Independent voices | Claude 9 findings; Codex 3 findings; false positives/invalid remedies explicitly rejected |
| Parallelization | Future local/cloud lanes capped at two plus an integration owner; overlapping UI/reader modules sequential |
| Completeness choices | All eleven A34–A44 choices preserve required coverage; none removes a safety path |
| Verification performed | `pnpm check:boundary` passed; no implementation test suite, deployed acceptance or customer trial run in this documentation review |

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| A42 | Eng | Extend trust review to redaction flags/policy authority; discard conflicting external fixes | Auto | P1/P4 | A caller-controlled signature is not proof; real existing cleanup checks matter | Signed-URL/TTL/stale-lock/import-boundary shortcuts |
| A43 | Eng | Include local publisher source/policy reads in shared ordered transaction | Auto | P1 | Target-only lock misses a post-read policy/source change | Calling the existing pre-launch policy-change test sufficient |
| A44 | Eng | Resolve existing operation receipts before new staging/CAS checks | Auto | P1/P5 | Successful first attempt makes its own expected revision stale | Requiring new writes or available object storage to recover a receipt |

**Phase 3 complete.** Engineering reviewed the fully amended plan last. Requirements and acceptance artifacts are complete with named implementation and owner gates; no code has been implemented by this review. Proceed to the final approval gate, not deployment.


### Cross-phase themes and final gate

The independently recurring themes are exact-outward usefulness (CEO/Design/Eng), incomplete-work recovery (Design/DX/Eng), current consent/authority (CEO/Eng) and candidate-specific evidence (CEO/Design/DX). See the [approval report](LAUNCH-AUTOPLAN-REVIEW.md) for all 44 decisions, three owner choices, UC1 and the sixteen aggregated implementation tasks. Five contextual expansions were appended to `TODOS.md`; no original milestone or product track was removed.

The [test plan](~/.gstack/projects/aacker71-foliage/alex-codex-canopy-cloud-eng-review-test-plan-20260905-190632.md) includes all twenty scenario groups plus final publisher-race and operation-replay corrections. The full pre-gate checklist was checked against the files; all mandatory outputs exist. `pnpm check:boundary` and documentation whitespace checks passed; implementation tests and deployed/customer acceptance were not run in this documentation-only review.

**STATUS: APPROVED WITH OPEN GATES, 2026-09-05.** The owner approved the current plan without overrides or adoption of UC1. Review logs retain `issues_open` because the named customer, UI/disclosure, hosted-admission and implementation gates remain. Any later accepted UC1 or other scope/architecture amendment must receive a final engineering review before its approval gate is closed.
