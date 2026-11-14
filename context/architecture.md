# Canonical architecture

Scope: integration candidate `codex/live-portfolio-integration`, being verified 2026-09-15.
It preserves the main working-tree snapshot and merges `codex/portfolio-achievements@5f9fa1b`. Separate-branch features are explicitly identified. This is the single current
cross-application map. Application details live in the linked files, never in a competing
system overview. Historical proposals are indexed at the end.

## Stack and shared ownership

Product center: the private work record is the underlying product; portfolio, résumé,
reflection and audience-specific views are projections. See the owner-supplied
[product thesis](product-thesis.md) and its [scope interpretation](project-overview.md).
This is a semantic clarification, not a new storage service. Reuse `packages/leaf` canonical
documents, achievements, provenance and existing authoring operations. Photosynthesis owns
capture/transformation; Canopy owns admitted public projections. Reflection, richer journey
relationships and work-value estimates require bounded additions and acceptance through
these owners. The thesis's broader Leaf terminology remains an explicit ontology decision;
current IDs, taxonomy and formats are unchanged.

| Layer | Technology / source | Responsibility |
|---|---|---|
| Runtime | Node native TypeScript stripping; `.mjs` entry points | Product servers and CLIs; runtime requirements live in `package.json` and `.nvmrc` |
| Workspace | pnpm, `pnpm-workspace.yaml` | Application and package discovery |
| Evidence | `packages/leaf` | Canonical documents, attribution, provenance and validation |
| Candidate pipeline | `packages/photosynthesis` | Candidate state, decisions and promotion contracts |
| Publication | `packages/canopy` | Admitted public projection, publication documents and replacement differences |
| Local reasoning | `packages/cos`, `apps/cos` | Routing, local model and encrypted memory adapters |
| Escalation | `packages/escalated-inference` | Cloud inference boundary, separate from local Photosynthesis |
| Governance | `packages/enterprise-policy`, `packages/photosynthesis-enterprise` | Release policy and organizational taxonomy |
| UI | `packages/ui`, `packages/foliage-tokens` | Shared controls and token source of truth |
| Operations | `foliage.mjs`, `tools/`, `scripts/` | Local lifecycle, retrieval, checks and verification; not additional customer apps |

## Selected target architecture — distinct from current implementation

The owner selected Vercel, Clerk SSO, Supabase and Novu in the complete-product build direction.
Those choices are settled architecture intent; they are not evidence of a configured or
accepted deployment. Detailed accepted authority decisions D3–D9 and UX1 remain in the
[engineering decision record](../docs/PORTFOLIO-SCALE-ENGINEERING-PLAN.md).

| Target component | Responsibility | Implementation qualification |
|---|---|---|
| Vercel | Website, application/reader surfaces and authenticated server entry points | Actual workspace packaging and integrated deployment need acceptance |
| Clerk SSO | Verified hosted sessions, Google sign-in, confirmation and recovery | Owner-selected replacement for Supabase Auth; internal ownership uses an issuer-scoped actor registry |
| Supabase Postgres | Ownership/grants/policy, revisions, publication authority, operation receipts and transactional outbox | Use integrated migrations and hosted store; extend scope and validate real RLS/transactions |
| Private Supabase Storage | Immutable admitted artifacts and media, gated by current database authority | No public bucket or reusable object URL may bypass withdrawal checks |
| Novu | Authorized inbox, email and SMS with preferences/digests and delivery tracking | Use integrated owner-notification worker; extend channels/scopes under the notification contract |
| Enterprise adapters | Supported private/on-premises operation under the same domain contracts | OCI application/worker images, Postgres, private object storage and OIDC; install/upgrade/restore acceptance remains |

Clerk is the owner's explicit identity choice as of 2026-09-15. Supabase is storage and
transactional authority, not a parallel sign-in provider. See the progress tracker for live
preview acceptance; configuration and local tests alone do not establish production readiness.

The shared contracts own the implementation detail: [identity/admission](contracts/identity-and-admission.md),
[storage/operations](contracts/storage-and-operations.md), [notifications](contracts/notifications.md),
[agents/evaluation](contracts/agents-and-evaluation.md), [deployment/service](contracts/deployment-and-service.md)
and [portfolio distribution](contracts/portfolio-distribution.md).
The [ordered units](specs/00-build-plan.md) bind these contracts to source, dependencies and
acceptance. Credentials, actual infrastructure placement and approved commercial terms are
release inputs; their absence has specified unavailable states.

## Authority and asynchronous work

The intended hosted write checks authenticated operation identity before staging immutable
bytes, then commits head/revision, current authority, history, receipt and outbox together
in Postgres. Object staging is separate from that transaction. Matching retries return the
original result; changed-body reuse is refused. Missing bytes after commit fail closed and
recover the exact committed object rather than serving an older publication.

Every read checks current authority; withdrawal applies to HTML, HEAD, detail, media,
download, preview and historical deployment paths. Previously downloaded external copies
are not recalled. Restoration must preserve revocations as well as object bytes.

A durable dispatcher processes committed events, rechecks recipient grants, channel policy
and preferences, then calls Novu. Pending, provider-accepted, delivered, failed, cancelled and
unknown outcomes remain distinct. Notification links never approve or publish through GET.
These are the selected contracts, not a claim this checkout runs a hosted worker.

Reporting placement, collaboration membership, artifact ownership, personal consent,
company permission, subscription and payment entitlement are separate relationships.
Private industry sharing needs applicable company and personal grants. Public personal
publication requires the person's final action; private standing grants do not authorize it.

## Applications in this checkout

Every actual `apps/*/package.json` must have exactly one corresponding architecture below.
The plane is read from `public-boundary.json`; it is licensing, not a synonym for deployment.

| Application | Package | Plane | Architecture |
|---|---|---|---|
| Individual Leaf / local studio | `@foliage/leaf-app` | open | [Leaf](apps/leaf.md) |
| Photosynthesis capture and review | `@foliage/photosynthesis-app` | open | [Photosynthesis](apps/photosynthesis.md) |
| Canopy public reader and publication manager | `@foliage/canopy-app` | cloud | [Canopy](apps/canopy.md) |
| Organization administration | `@foliage/enterprise-app` | enterprise | [Enterprise](apps/enterprise.md) |
| Legacy composed local dashboard | `@foliage/dashboard-app` | open | [Dashboard](apps/dashboard.md) |
| CoS local runtime adapters | `@foliage/cos-app` | open | [CoS](apps/cos.md) |

## Product surfaces and separate release lines

These are accounted for without inventing packages or silently changing the boundary manifest.

| Surface | Implementation status / intended owner | Architecture |
|---|---|---|
| Individual Enterprise | Reserved `apps/member`; absent here | [Member](apps/member.md) |
| Recruiter, hiring manager and client | Reader role in Canopy; discovery and distribution specified, implementation acceptance pending | [Recruiter](apps/recruiter.md) |
| Public website | Integrated `apps/www`, `@foliage/www` in the cloud plane; separate website build | [Website](apps/www.md) |
| Cloud Ladybug / Scarlet product | Integrated bounded cloud assessment transport; hosted conversational service not accepted | [Ladybug](apps/ladybug.md) |
| Portable evaluation runtime | Integrated local Docker/signing/import code; cloud isolation and full observer acceptance pending | [Evaluation runtime](apps/evaluation.md) |
| Native capture clients | Desktop artifact handoff specified; no native app package here | [Capture clients](apps/capture.md) |

## Data flow and storage

```text
Owner-selected local sources
  → Photosynthesis → candidate harvest → human decision → canonical Leaf
  → local presentation / local assistant (selected evidence only)
  → explicit publication review → admitted artifact → Canopy reader

Organization manifest + release decisions → enterprise policy
  → governed release eligibility (not automatic publication)

Cloud Ladybug and sandbox evaluation are separate intended boundaries;
this diagram does not imply they are connected or deployed.
```

Local Leaf, harvest and policy documents remain local files. Canopy's public store holds
admitted artifacts, not the private source document. Enterprise has a company manifest and
release-decision store. CoS owns encrypted local memory. Each application document identifies
its actual storage and access controls. No universal production database, tenancy or billing
service is asserted merely because an old design proposes one.

### Version and persistence facts for this checkout

- The public document writer emits format **5** for unphotographed named portfolios and **6**
  for an explicitly selected photo set in
  [publishedDocument.ts](../packages/canopy/src/publishedDocument.ts). Historical versions remain
  readable under their original rules; the old build plan's format-3 references are dated checkpoints.
- Leaf, harvest and policy formats belong to their domain parsers. A filename or content
  copied from another branch is not a compatible schema contract.
- Local shared document locks and atomic writes have the limits in
  [local document safety](../docs/LOCAL-DOCUMENT-SAFETY.md). They are not a distributed database.
- Enterprise's current release adapter has a versioned release/history/pending-event document
  and idempotent operations; an event is not a publisher receipt or delivered notification.
- Scarlet's local conversation history is page memory; selected tools supply bounded evidence
  context. CoS encrypted memory is a separate adapter, not proof all conversations persist.

## Access and invariants

1. Follow [AGENTS.md](../AGENTS.md): no fabricated evidence or person scores; excluded
   records keep their reason. Canonical proof states are unordered.
2. Open packages may not import cloud or enterprise packages. The executable authority is
   [public-boundary.json](../public-boundary.json) and its checker, not prose permission.
3. Candidate approval, attribution and publication are distinct transitions. An AI answer
   does not confer proof or publish content.
4. A loopback origin/CSRF gate is not hosted user authentication. Document actual ownership
   controls at each boundary before exposing a local tool to multiple users.
5. Local Photosynthesis capture/inference stays local; its optional escalation adapters must be described separately. Existing policy-controlled CoS escalation is a separate
   legacy capability; it must not be described as a cloud Ladybug deployment or universal
   zero-egress guarantee.
6. A company is a Tree, organization a Bough, team a Branch, person a Leaf, evidence item
   a Leaflet. Named Leaf views select shared evidence, not duplicate identity.

## Documentation ownership and history

[Six-file methodology](ai-workflow-rules.md) defines maintenance. Product intent belongs in
[overview](project-overview.md); operational status in [progress](progress-tracker.md).
Feature contracts such as [local document safety](../docs/LOCAL-DOCUMENT-SAFETY.md),
[Scarlet interaction](../docs/SCARLET-CONTEXT.md) and
[enterprise release storage](../docs/ENTERPRISE-RELEASE-STORAGE.md) remain detailed references.
They must link here rather than redeclare the whole product architecture.

The two superseded broad overviews are preserved as dated history:
[system history](../docs/HISTORY-SYSTEM-ARCHITECTURE.md) and
[owner specification and alignment history](../docs/HISTORY-PRODUCT-ARCHITECTURE-SPEC.md).
The old paths are short migration pointers. Historical gates remain unresolved unless an
explicit later owner decision or verified implementation closes them.

## Portfolio harness draft intake — 2026-09-16

[Revised harness specification and application ownership](proposals/portfolio-harness.md) maps the new
proposal onto this inventory. It is not a second canonical architecture. Coeadapt is the predecessor; Photosynthesis connects directly to OpenClaw and Hermes.
Provider and legacy-code reuse require verification; host integrations are intended scope,
not completed implementation.

### Selected harness integrations

Nango is the selected external connection, sync, webhook and agent-tool layer, owned by the
Canopy cloud boundary with scoped inputs to Photosynthesis. Cookiy supplies user research;
Arbigent supplies UI-testing observations through the evaluation runtime. Their concrete
workflows and acceptance requirements live in the [harness specification](proposals/portfolio-harness.md).
Selection does not imply installed integrations or provider acceptance.

## Recruiting and client distribution — 2026-09-23 design

Canopy owns four outward paths from the same admitted publication: opted-in public discovery,
direct views/cited exports, customer-authorized ATS/CRM delivery, and contracted supplier feeds.
The [distribution contract](contracts/portfolio-distribution.md) defines destination capabilities,
audience/field/update grants, identity bindings, durable receipts, reconciliation and withdrawal.
Reuse existing Supabase authority/outbox, Nango connection ownership and Novu notices; no new
recruiter application, evidence schema or independent permissions store. Photosynthesis remains
the private authoring source. Scarlet and Jev may propose actions; deterministic authority gates
all disclosure and writes. Public reading never confers supplier or employer API rights.

[Units 35–37](specs/00-build-plan.md) distinguish the useful independent sharing/discovery slice
from customer integrations and partner feeds. Juicebox supplier admission requires its own
agreement; buying its MCP plan does not supply that right. This is implementation design,
not accepted integration or authorization to contact partners or transfer people's records.
