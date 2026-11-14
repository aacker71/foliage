# Ordered implementation units

The current first-user critical path and integration order live in the
[release path](../../.loop/MILESTONES.md). This unit index remains the complete-product
implementation contract, not a competing release-status list.

These units finish the Six-File Methodology's execution specification. They refine the
existing [B00–B14 delivery packages](../../docs/PORTFOLIO-SCALE-BUILD-PLAN.md), including the
accepted evaluation commitment; they do not create another product architecture or task board.
Detailed constraints have one owner in [architecture](../architecture.md) and its contracts.

All future refinements follow the owner-supplied [product thesis](../product-thesis.md): the
private work record comes first; portfolio, résumé, reflection and opportunity views derive
from it. Use the [workflow refinement check](../ai-workflow-rules.md) alongside each unit's
acceptance. Units 09–12 own retained work, evidence and review; 10/16–18 own authorized
maintenance and agent behavior; 21–22 own optional delivery; 24/35–37 own reader/distribution
projections. These are extension points, not claims that journey synthesis, reflection or
work-value estimation is built. Write a bounded change to the owning unit before implementing
new behavior. The founder's real multi-year record and an independent reader are the product
test; passing technical gates alone does not establish either person's experience.

Every unit has Goal, Design, Implementation, Dependencies and Verify when done. IDs are in
valid dependency order; independent work may begin when its prerequisites are accepted.
"Specification ready" is not "implementation accepted". Existing code is explicitly reused,
then verified on the integrated candidate. Start with unit 01, not a new implementation of
already-existing hosted or evaluation adapters.

| Unit | Result | Build | Depends on |
|---|---|---|---|
| [01](01-candidate.md) | Reconcile one reproducible candidate | B00 | — |
| [02](02-deployment-package.md) | Package every actual runtime | B00 | 01 |
| [03](03-hosted-session.md) | Verify hosted sessions and recovery | B01 | 01 |
| [04](04-identifier-ownership.md) | Reserve identifiers without transferring subjects | B01 | 03 |
| [05](05-admission.md) | Admit exact reviewed evidence | B01 | 03, 04 |
| [06](06-authority-schema.md) | Persist authority and operations atomically | B02 | 03, 04 |
| [07](07-immutable-objects.md) | Commit private publication objects | B02 | 05, 06 |
| [08](08-current-reader.md) | Enforce withdrawal across all readers | B02 | 07 |
| [09](09-sources-cells.md) | Connect authorized sources to retained cells | B03 | 01 |
| [10](10-background-collection.md) | Own background collection lifecycle | B03 | 09 |
| [11](11-achievement-model.md) | Retain authored achievements and claim citations | B03 | 09 |
| [12](12-local-review.md) | Preserve human review through failure | B04 | 09, 11 |
| [13](13-publish-handoff.md) | Return a real publication receipt | B04 | 07, 08, 12 |
| [14](14-group-governance.md) | Model governed company membership | B05 | 06, 12 |
| [15](15-member-exit.md) | Deliver the enterprise member journey | B05 | 14, 13 |
| [16](16-cloud-tools.md) | Bind cloud tools to approved context | B08 | 05, 06, 09 |
| [17](17-cloud-conversation.md) | Stream useful cloud suggestions | B08 | 16, 03, 07 |
| [18](18-scoped-agents.md) | Apply agent roles without inherited permissions | B08 | 14, 15, 17 |
| [19](19-private-industry.md) | Share explicitly within a private network | B06 | 14, 15 |
| [20](20-public-discovery.md) | Offer consented public discovery | B06 | 08, 14 |
| [21](21-outbox-dispatch.md) | Dispatch committed notification intent | B07 | 06, 13 |
| [22](22-notice-preferences.md) | Make permitted channels and recovery work | B07 | 21 |
| [23](23-shared-review-ui.md) | Complete shared decision controls | B09 | 12, 13 |
| [24](24-public-portfolio.md) | Complete the achievement-first reader | B09 | 08, 11, 23 |
| [25](25-website-offers.md) | Connect website promises to actual offers | B09 | 02, 20, 24 |
| [26](26-local-evaluation.md) | Observe and import a real local evaluation | B14 | 09, 11 |
| [27](27-cloud-evaluation.md) | Run isolated cloud and customer evaluation | B14 | 26, 06, 17 |
| [28](28-private-deployment.md) | Package a working private enterprise install | B10 | 07, 15, 18, 21, 23 |
| [29](29-restore-revocation.md) | Rehearse durable recovery | B11 | 07, 08, 21, 28 |
| [30](30-observability.md) | Expose actionable safe operational signals | B11 | 06, 17, 21, 27 |
| [31](31-entitlements.md) | Model offers without changing ownership | B12 | 03, 04, 06 |
| [32](32-payment-lifecycle.md) | Reconcile payment and support outcomes | B12 | 31 |
| [33](33-capture-clients.md) | Retain authorized desktop artifacts | B03 | 09 |
| [34](34-dify-development.md) | Make Dify experiments reproducible | B14 | 01 |
| [35](35-distribution-core.md) | Make admitted work discoverable and shareable | B06 | 13, 21, 22, 24 |
| [36](36-destination-adapters.md) | Deliver to authorized recruiting and client systems | B06 | 35 |
| [37](37-partner-feeds.md) | Supply contracted talent platforms with current evidence | B06 | 35, 36 |
| [38](38-local-brain.md) | Keep each garden's brain in a packaged local gbrain | B03 | 02, 09, 11, 12 |
| [39](39-team-project-portfolio.md) | Keep one local project portfolio with the people who built it | B03 | 09, 11, 12, 33 |
| [40](40-release-acceptance.md) | Accept the integrated complete product | B13 | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39 |

## Completion and external inputs

Use [progress](../progress-tracker.md) for local implementation status and the existing
[execution-task directory](../../docs/PORTFOLIO-SCALE-BUILD-PLAN.md#asana-task-directory) for
work records. Neither files nor an agent role assign a human operator or authorize messaging.
The final acceptance unit covers every required LV/OF/UX/AU/ST/NT/OP/EV row. Individual
units attach their own observed evidence; failed acceptance reopens the owner and invalidates
dependent evidence, not unrelated checks.

Provider projects/secrets, live participant access, commercial terms and release approval
are [explicit release inputs](../contracts/deployment-and-service.md#release-inputs-versus-design-decisions).
The technical contracts specify behavior when they are absent. Unattended generated code
execution remains refused without separately approved authority; explicit immutable scenarios
are the supported execution path. No unresolved placeholder is disguised as completed work.

The machine-readable [unit index](units.json) is checked for missing specs, wrong owners,
missing acceptance coverage and cyclic/out-of-order dependencies by `check:architecture`.

## Distribution extension — 2026-09-23

Units 35–37 extend B06 under the [distribution contract](../contracts/portfolio-distribution.md).
The former release unit 35 moved to 38 (now 40), preserving the final dependency gate. This is a spec
renumbering, not implementation progress. Direct sharing in unit 35 does not wait for public
directory governance (unit 20), a customer ATS tenant or a supplier agreement. When directory
listing is offered, unit 20's separate acceptance applies. Units 36 and 37 qualify external
systems progressively; an accepted narrow pilot must be described by its actual capabilities,
not as complete-product acceptance. A missing partner agreement must not prevent usable direct
sharing, nor be hidden by marking an unexercised provider integration complete.

## Local brain extension — 2026-10-10

Unit 38 gives each garden its own brain: a pinned gbrain shipped with Foliage, run on the
owner's machine, built from that garden's records, with every network path switched off. It
follows the owner's 2026-10-10 direction that Wondersearch is paused and everything stays
local. The former release unit 38 is now 40, keeping the final dependency gate last. The team
portfolio branch (`spec/team-portfolio-local`) also claimed unit 38; integrated together, the
local brain keeps 38 and the team portfolio is 39. This is a spec addition, not implementation
progress.

## Local-only extension — 2026-10-10

Unit 39 adds a team project portfolio kept on each member's machine, under the owner's
2026-10-10 direction that everything stays local. Foliage adds no hosted service and sends
nothing itself; members hand each other their records as files. Whether records may also go
through a team's git remote is an open owner decision in the unit. Wondersearch is paused, and
the hosted-first drafts in PR #199 and PR #132 are on hold. The release unit moved from 38 to
40, keeping the final dependency gate last. Those paused drafts number their own units 38–40;
if either resumes, it renumbers after 40. This is a spec addition, not implementation progress.
