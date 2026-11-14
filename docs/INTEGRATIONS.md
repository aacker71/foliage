# Foliage integrations

Owner direction, 2026-09-08: integrate Workday, Rippling, Lattice, Udemy, Coursera, ChatGPT,
Claude, email services, OneDrive, Hermes, OpenClaw and other assistant harnesses. Use integration
services where they reduce maintenance. This expands the source roadmap; it does not say that
every vendor has a public API or that a configured connector is customer-accepted.

Tracking: [Integration delivery](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255737993477).
The [source picker and local Ladybug handoff](SOURCE-CONNECTIONS.md) now provide selected-file acquisition and private review. Named provider OAuth and ongoing synchronization remain outstanding.

## Current implementation and limits

The first bridge imports a deliberately selected observation batch into the **existing**
Photosynthesis harvest and Leaf review/promotion flow. It opens no provider connection, holds
no credential, calls no model and publishes nothing. A record is a source observation, never
an attestation of authorship or a verified portfolio claim. Its provenance remains declared.

This manual importer does not authenticate the declared provider, tenant or account, read
policy.json or the evidence-cell permission store, or enforce current upstream grants and
retractions. Selecting a file is the operator's one-time local import action. Automated
provider intake must first use the authoritative cell/grant lifecycle in the newer runtime
work; this bridge must not be advertised as permission-checked synchronization. Existing
promotion, sharing and publication gates still apply at their own separate stages.

```bash
node foliage.mjs integrations --help
node foliage.mjs integrations import --garden /absolute/garden --input /absolute/observations.json
```

The garden is required explicitly: the command never selects one from `FOLIAGE_GARDEN` or a
default garden.
The selected garden must already contain a valid Leaf. By default its leaf.json is the subject
and its harvest.json is the review destination. Explicit --into and --out are available through
the underlying importer; all parsing, binding, existing decisions and writes remain that
importer's responsibility. This is an adapter handoff for an authorized export or assistant,
not a vendor login button. Use real provider records; no seeded portfolio is supplied.

### Selected observation format

An export adapter supplies UTF-8 JSON with exactly the fields below; unknown fields are
refused at every object level. The file or piped input is limited to 1 MiB. This format carries
selected text, not the provider's complete response. The producer must remove credentials and
unrelated private material before creating it; validation is not automatic content redaction.

| Field | Required value or limit |
|---|---|
| `format`, `version` | `"foliage-observations"`, `1` |
| `subject` | Object containing `leafId` and `name`, each nonempty text up to 512 characters. Both must exactly match the selected Leaf's `id` and `subject`. |
| `source` | Object containing `provider`, `tenantId`, `accountId`. Provider is a lowercase slug starting with a letter, at most 64 characters. Tenant is an opaque ID or `null` for a consumer account; account is an opaque ID. These are declared namespaces, not authenticated identities. |
| `completion` | `"complete"` means this deliberately selected batch was fully obtained. It does not mean every upstream record was read. `"partial"` is refused without writing. |
| `deletedRecordIds` | Required empty array. A nonempty array is refused; this bridge cannot retract or delete earlier evidence. |
| `observations` | Array of zero to 100 objects, each containing exactly `recordId`, `revision`, `title`, `excerpt`, `observedAt`. An empty batch writes nothing and asserts nothing about the upstream account. |
| `recordId`, `revision` | Nonempty opaque identifiers. The provider/tenant/account/record/revision tuple determines snapshot identity. Duplicate tuples within one batch are refused. |
| `title`, `excerpt` | Nonempty selected text, at most 2,000 and 16,000 characters respectively. Titles use the existing no-rating rule; excerpts remain verbatim source text, visibly quoted during review. Neither field may contain terminal control characters other than tab/newline/carriage return. |
| `observedAt` | ISO instant with an offset identifying when the producer observed this record; it is not a course completion date or proof of authorship. An instant more than 10 minutes after the import is in the future and refuses the whole batch without writing. |

Opaque IDs are at most 200 characters and may contain letters, digits and `._:+/=-`.
URLs and email addresses do not belong in these ID fields. JSON field/type validation does
not prove the truth of a title, excerpt, timestamp, provider or account declaration.

The importer requires a valid, non-example Leaf and refuses an existing nonempty harvest
without the same complete subject binding. Both documents are locked during the write;
documents and merged output are limited to 8 MiB. The selected input must be a regular file
(final-component symlinks are refused), or use `--input -` for bounded stdin with a 30-second
deadline. The Leaf and harvest cannot be the same path.

Repeating an unchanged revision retains the original snapshot, clock and review decision
without rewriting the file. Different material under an existing revision refuses the whole
batch. **A locally edited review title also causes this explicit replay conflict**: the
original title is no longer the reviewed title. The local edit and decision remain intact;
do not invent a new upstream revision to bypass it. Automated synchronization needs the
authoritative source/review reconciliation described above before using this bridge.

A real new revision appends a separate unreviewed snapshot; it does not supersede an old one.
A later Git refresh preserves imported snapshots, including edited titles and decisions.
Terminal and browser review show the full declared source, record, timestamp and excerpt
before approval. Approval permits the existing promotion flow to create a **pending, private**
Leaflet; the importer itself does not approve or promote anything.

The [local assistant MCP server](ASSISTANT-MCP.md) now exposes selected-target context,
observation submission and owner-selected portfolio import (`foliage_import_portfolio`: preview
first, then import that exact text by its digest) through this same importer. Optional launch
flags add presentation, achievement and search tools; see the
[launch-flag table](ASSISTANT-MCP.md#tools-and-review-flow). It binds its destination at
startup and has no approval or publication tools. Current SDK and legacy protocol tests are separate from
named-host or customer acceptance; this is still a manual, unverified snapshot handoff.

Provider OAuth, tenant administration, automatic synchronization, hosted connection settings,
remote HTTPS/OAuth MCP deployment and outbound provider/tool acquisition remain
implementation/acceptance work. They must consume the existing evidence/review path instead
of creating another queue.

## Provider routes verified on 2026-09-08

These are documented capabilities, not connected Foliage accounts. The service shortlist is
an engineering recommendation inferred from the sources. No commercial prices or customer
entitlements were verified, and no service has been purchased.

| Provider | Recommended route and qualification |
|---|---|
| Workday | Pilot Merge for workforce context; qualify Workday Learning separately through Kombo or a customer-approved direct report/API. Workday documents learning enrollments/completion dates, but tenant integration identity and security permissions are required. [Learning API](https://community.workday.com/sites/default/files/file-hosting/productionapi/Learning/v46.2/Get_Learning_Enrollments.html), [Merge coverage](https://www.merge.dev/integrations/workday). |
| Rippling | Pilot Merge; Finch is an approved alternative for workforce context. Rippling explicitly names these intermediaries. A customer API token does not itself grant partner webhook access; retain User and Worker identities separately. [Partner requirements](https://developer.rippling.com/documentation/developer-portal/getting-started/requirements), [token access](https://developer.rippling.com/documentation/rest-api/essentials/api-tokens). |
| Lattice | Qualify current Talent API for selected goals/work references. Do not assume an old HRIS connector covers current Talent features; Kombo's Talent variant is open beta. [Talent API](https://developers.lattice.com/reference/introduction), [Kombo variant](https://docs.kombo.dev/hris/connectors/latticetalent). |
| Udemy Business | Enterprise API entitlement is required. Pilot Kombo's LMS adapter or the direct API; direct xAPI can supply completion events when entitled. Kombo documents up to six-hour source delays. [Udemy entitlement/use cases](https://business-support.udemy.com/hc/en-us/articles/360005792753-Udemy-Business-Web-APIs-Use-cases-and-best-practices), [Kombo connector](https://docs.kombo.dev/lms/connectors/udemy). |
| Coursera for Business | Confirm the customer's enterprise API/partner entitlement. Kombo's connector is open beta and new enrollments can lag up to 48 hours. Consumer history access is not established by the enterprise integration page. [Coursera integrations](https://www.coursera.org/business/integrations), [Kombo connector](https://docs.kombo.dev/lms/connectors/coursera). |
| Outlook / OneDrive | Direct delegated Microsoft Graph. Mail.ReadBasic excludes bodies; body import needs the applicable Mail.Read grant. Selected file permissions require both consent and resource assignment. Tenant policy can require administrator approval. [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference), [Selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview). |
| Gmail / Google Drive | Gmail read scopes are Restricted and may require verification/security assessment for a public app. Drive's file-limited drive.file scope is a practical selected-file route but includes write capability; Foliage must enforce read-only behavior. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). |
| ChatGPT | Build a scoped Foliage MCP interface, then the authenticated remote deployment required by ChatGPT. Official documentation currently names this a plugin. Model APIs are not general access to a person's ChatGPT history. [ChatGPT deployment](https://developers.openai.com/plugins/deploy/connect-chatgpt), [authorization](https://developers.openai.com/plugins/build/auth). |
| Claude / Claude Code | Claude custom connectors use remote MCP; Claude Code also supports local stdio. The documented claude mcp serve exposes coding tools, not a general transcript-history service. Deliberately supplied exports are a separate import adapter. [Claude connectors](https://support.claude.com/en/articles/11175166-about-custom-integrations-using-remote-mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp). |
| Hermes / OpenClaw | Hermes here means Nous Research Hermes Agent. Both document MCP client support. OpenClaw's reverse Gateway bridge can expose existing routed conversations; allow read tools only, excluding send/permission-response actions. It does not enumerate unrelated consumer chat archives. [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/), [OpenClaw MCP](https://docs.openclaw.ai/cli/mcp). |
| Other harnesses | Qualify each host against the same Foliage tool contract, beginning with Codex and VS Code/Copilot. Supporting MCP in a host is not a tested Foliage connection. [Codex](https://developers.openai.com/codex/mcp), [VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers). |

**Shortlist:** Merge for workforce context, Kombo for Business learning, direct Graph for
Microsoft 365, and one Foliage MCP facade for assistant hosts. Qualify Lattice Talent directly
or through its current supported variant. These are separate data families, not duplicate
aggregators for the same feed. Validate one eligible customer tenant per family before committing
to contracts or promising general availability.

Kombo's LMS data-changed events report changes observed by its sync; its docs state that no
LMS connector currently supports upstream webhooks. Do not market this as real-time provider
delivery. [LMS webhook limits](https://docs.kombo.dev/lms/guides/upstream-webhooks)

Nango is an optional auth/sync infrastructure choice if custom adapters justify it; it does not
supply provider entitlement or complete evidence mappings. Workato is useful when a customer
already operates it; Prismatic is an embedded integration deployment option to evaluate only
when customer requirements justify another platform. [Nango](https://nango.dev/docs/getting-started/intro-to-nango),
[Workato Workday](https://docs.workato.com/en/connectors/workday.html), [Prismatic](https://prismatic.io/docs/integrations/)

OpenAI's model-side connectors can read selected providers using OAuth tokens obtained by the
application, but source material then enters the model processing path. They do not replace
a local-only source importer. Microsoft Work IQ is documented public preview with tenant/Copilot
requirements; its broader grants are not the narrow personal default. [OpenAI API connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp),
[Work IQ prerequisites](https://github.com/microsoft/work-iq/blob/main/ADMIN-INSTRUCTIONS.md)

## Architecture: separate transport from authority

The following is the production target. The manual snapshot bridge above implements only
bounded local observation admission and persistence into the existing review queue.

| Layer | Responsibility |
|---|---|
| Provider adapter | Read the explicitly authorized resource/account; map an allowlisted subset of records with stable upstream IDs and provenance. |
| Credential/session adapter | OAuth grants or customer-managed service identity; refresh/revoke safely; keep tokens out of evidence, browser bundles, logs and source control. |
| Sync worker | Bounded incremental reads, durable cursor/lease/retries, webhooks as untrusted wake-up hints, and honest partial/deletion results. |
| Foliage admission | Recheck connection, tenant, subject, source scope and policy; validate observations; keep records private and unreviewed. |
| Existing review and release | Human attribution/correction, company-material authority where applicable, personal final publication and current withdrawal checks. |
| Assistant interface | Explicitly scoped Foliage read/draft operations for MCP-capable hosts; permission to read is not permission to publish or message. |

Use a hybrid implementation:

- **Enterprise HRIS:** evaluate one unified HRIS service against actual required endpoints
  and customer entitlements. Do not operate two aggregators for the same records.
- **Personal mail/files:** prefer delegated provider APIs through the local app for selected
  content. A hosted credential broker or AI connector is a new processor, not a way around
  the requirement that personal raw evidence stays local.
- **Business learning:** vendor-approved Business/Enterprise APIs or customer-authorized
  exports. Consumer accounts and enterprise subscriptions have different access.
- **Agents:** standards-based MCP tools plus explicit export/import adapters when a host
  lacks the required protocol capability. Model inference APIs are a separate feature.

The accepted hosted direction remains Vercel, Supabase authoritative state/private objects,
and Novu for authorized notification delivery. These decisions are recorded in the newer
portfolio-scale build/engineering plans on the active implementation branch. This integration
work does not select a paid vendor plan, provision a tenant, change storage residency, or
replace Novu with mailbox ingestion. Source emails and outgoing notifications have different
permissions and data flows.

Personal raw mail/files/chat exports are processed locally unless the person separately
authorizes a specific disclosed transfer. Enterprise data uses tenant-scoped ingestion in its
permitted enterprise environment. A company's connector grant cannot publish a person's Leaf.

## What each record can mean

| Source | Admissible use | It does not establish |
|---|---|---|
| HRIS | Declared directory identity, employment/membership facts and reporting structure, with explicit Foliage identity mapping | Authorship, contribution, competence, a Foliage role grant, or publication consent |
| Lattice / performance systems | Deliberately selected goal or work-artifact references under company and personal permissions | A ranking, employee score, or automatic performance assessment |
| Learning provider | A provider-reported enrollment/completion/credential record with a re-checkable source | Proficiency, work authorship, or a composite skill score |
| Email / files | User-selected evidence with source/version and access context | Every recipient/owner being a contributor, or consent from every participant |
| Chat / agent session | Selected transcript/artifact context or generated proposals, explicitly labeled | Verified evidence merely because an assistant produced or summarized it |

Do not import payroll, compensation, health, protected traits, performance ratings or unrelated
private personnel material into a portfolio connector. Use field allowlists per endpoint rather
than a generic raw JSON storage field. Never turn an employee email match into trusted identity
without an explicit mapping and its authority record. Keep upstream assertions distinct from
Foliage review decisions.

Content from a source is data, not instructions. Embedded prompts, links and tool-like text do
not authorize additional reads, AI calls, messages, account changes or publication.

## One connection lifecycle

A production connection belongs to an authenticated principal and scope. Its record identifies
provider, transport, account/tenant, admitted resources, permission reference, sync state,
cursor generation, credential reference and revocation generation. Secrets live in the selected
credential adapter; token references are not reusable browser credentials.

UI and persisted state must distinguish:

1. Available to configure (documented capability only).
2. Needs vendor access or administrator consent.
3. Connecting / verifying actual account and granted scopes.
4. Connected, no sync completed yet.
5. Syncing / up to date / partially synced.
6. Access expired, permission denied, rate limited or provider unavailable.
7. Paused / disconnected / revoked, with last known evidence and next action.

A successful OAuth redirect is not a completed import. A successful import is not a reviewed
Leaflet. A reviewed Leaflet is not publication. Show the actual receipt at each transition.

Incremental jobs use the application's durable scheduler. For hosted work, persist leased jobs
and operation receipts with Supabase authority; a scheduled wake-up starts bounded work rather
than holding a long-running Vercel request open. For local work, extend the existing application
workflow scheduler on the newer runtime branch. Do not revive the retired development loop or
create Codex reminders to stand in for product scheduling.

Cursor advances only with the admitted batch/receipt commit. Retries use stable record/revision
identity and refuse changed content under the same identity. Webhooks require provider-specific
verification, replay handling and a current account read; an unsigned payload is never evidence
of deletion, authorization or attribution. Disconnect revokes future reads and queued work;
deletion/retraction needs explicit source events and Foliage's evidence/publication authority
flow. Missing from one page is not deleted.

## Connections UI required for completion

Use the Foliage-themed shared shadcn controls; place personal connections with Sources and
company connections in tenant settings. Each connector explains what it reads, whose account
is connected, how often it runs, where material is processed and what it never does automatically.

The complete flow includes account verification, narrow resource selection, initial preview,
sync history, actionable failure/retry, pause, scope changes and disconnect. Reauthorization
must preserve selected resources and queue context. Empty, denied, partial, revoked and stale
states must be honest. Show an “Available” provider separately from an actually connected one.

No published page receives provider credentials or live mailbox/file access. Private surfaces
use night; published documents use day. Reuse tokens and shared controls instead of website-only
mockups. Interface acceptance requires real account and recovery behavior in the browser.

## Delivery and acceptance

| Workstream | Completion evidence |
|---|---|
| Observation bridge | Real selected records reach the existing review queue; replay is safe; mismatched subjects, partial/deletion batches and malformed input cannot write; promotion stays pending/private. |
| Microsoft 365 | Delegated Outlook/OneDrive authorization, selected resource import, delta/resync, refresh/revoke and lost-permission behavior exercised on an authorized account. |
| HRIS | One chosen integration service/direct tenant; Workday/Rippling/Lattice endpoint and field coverage recorded separately; explicit identity mapping and tenant-isolation tests. |
| Learning | Udemy Business and Coursera business entitlement confirmed separately; actual completion records mapped; updates/revocation/partial reporting tested. |
| Assistants | One usable scoped Foliage MCP interface plus documented host-specific setup; ChatGPT/Claude/Hermes/OpenClaw compatibility tested separately; no claim to blanket chat-history access. |
| Gmail / other mail/files | Provider-specific permissions and verification requirements; same source admission/sync contracts; no duplicate notification system. |
| Operator/customer UI | Real states, scope disclosure, sync receipts, recovery, pause/disconnect and keyboard/mobile acceptance for the integrated candidate. |

“All training providers” means an extensible supported-provider program with per-provider
qualification. It does not mean scraping accounts without an approved API or promising a
universal endpoint. Where no eligible API exists, an explicit export adapter can be offered
with its limitations visible.

Production acceptance additionally requires exact deployed candidate, actual tenant/account
access, secret storage/rotation, US processing/storage requirements where applicable, deletion
handling, rate-limit/backoff recovery and an operating owner. Documentation and mocked adapter
responses do not establish a live integration.

### First individual-source sequence — 2026-10-13

This is the next delivery order for a person's work record, not a claim that the named
accounts are connected. Complete one real owner journey at each step before multiplying
provider tiles. The [release path](../.loop/MILESTONES.md) still owns the overall ship gate.

| Order | User result | Completion evidence |
|---|---|---|
| 1. Selected personal work | Choose several local artifacts from a side project, creative practice, learning project or volunteer work; preview each and add one private batch to the existing Review queue. | Real files; unchanged replay, changed revision, invalid batch and changed-Leaf refusal; phone/desktop interaction. No automatic sync or authorship claim. |
| 2. Selected design work | Bring an image the designer owns and selected locally, such as a Figma frame export, with the project's own context into private Review. An owner-entered public Dribbble shot URL can point to where it was shared; no provider data is fetched. Show the actual selected image before adding it. | Real PNG/JPEG export; byte validation, metadata stripping, exact preview, private Review media, replay/refusal and phone/desktop interaction. Review alone never publishes the image. A provider tile or URL alone does not pass. |
| 3. One preferred agent | Connect one explicitly selected host to the local MCP with opt-in private search. Let that host submit selected observations or cited proposals, but keep review, correction and publication in Foliage. | A host-specific round trip with a real garden, exact granted tools and records, revoked access, and a visible Review result. Test Claude Code, Codex, Cursor, OpenClaw and Hermes separately; a generic MCP config is not acceptance for all. |
| 4. Selected conversations | Import only owner-chosen email or message threads/exports into the private record. Show participants, source date, exact admitted excerpt and third-party material before Review. | A real selected thread enters Review; unrelated messages, attachments and credentials do not. Removal/revocation and changed-source behavior are exercised. No send permission. |
| 5. One real account | Connect one authorized mail or file account with narrow delegated read scope, chosen resources and local processing; add GitHub and GitLab account/repository selection on top of the existing local Git intake. Qualify a Figma selected-frame connection separately. Hold Dribbble API ingestion until its data-use terms permit this product's storage and display. | Actual account identity, scope, first read, incremental read, partial/error recovery, disconnect and source-specific retraction. OAuth setup or an available catalog entry alone does not pass. |
| 6. Continued understanding | Use the private record to show decisions, experiments, pivots, applied learning and outcomes across work and non-work projects. Local semantic retrieval is optional and must preserve evidence labels and correction history. | An owner can trace a reflection to admitted artifacts and distinguish fact, self-report and inference; no person score or automatic public claim. |

The agent relationship has two directions: an agent may read only the records the owner
permits through Foliage, while agent-produced work enters as selected observations or
proposals. Permission for one direction never grants the other. Neither a course completion
nor a chat summary establishes contribution or skill. Outside employment, the record can
hold open-source and side projects, freelance work, research and talks, creative output,
community work, mentoring and applied learning when the owner selects artifacts. A career
break or pivot may be written by the owner without importing family, health or payroll records.
For designers, the record should connect an owner-selected artwork file to the problem,
iterations, decisions and outcome that the owner supplies. A posted shot is a visible
artifact, not proof that its uploader made every element or that the work produced an outcome.
Figma's [file/image API](https://developers.figma.com/docs/rest-api/file-endpoints/) can
support a future selected-frame connection with account consent; its rendered image URLs are
temporary. [Dribbble's published API terms](https://developer.dribbble.com/terms/) restrict
retaining platform data, so an owner-entered link is a reference only until permitted use
is established. An owner-uploaded original is distinct from a Dribbble-hosted copy; this
does not establish permission to copy data from Dribbble.

## Execution records

| Workstream | State when created |
|---|---|
| [Import authorized observations into existing review ](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255828167595) | In progress |
| [Microsoft 365 Outlook and OneDrive ](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218256240261922) | Planned |
| [Workday Rippling and Lattice through one qualified HRIS service ](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218256187766953) | Planned |
| [Udemy Business Coursera and learning-provider adapters ](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218256187927456) | Planned |
| [ChatGPT Claude Hermes OpenClaw and MCP harnesses ](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218256365555234) | In progress — local stdio handoff implemented; named-host and remote acceptance remain open |
| [Gmail Google Drive and additional mail providers ](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218255827917323) | Planned |
| [Connections UI durable sync and customer acceptance ](https://app.asana.com/1/1218186870488143/project/1218204163479805/task/1218256187870260) | Planned |

Asana holds current status. These rows do not transfer provider or UI acceptance from one
workstream to another. No provider connection, credential consent or paid subscription was
created while opening the workstreams.

## Nango connection and bounded source import

Canopy now has an opt-in Nango adapter. It reuses Clerk/internal actor identity and the existing
`foliage-observations` review contract; it does not create a second evidence store. The parser
and candidate merge live in `@foliage/photosynthesis/observations`; the previous Leaf module
re-exports that same implementation for compatibility.

Configure the hosted environment with `NANGO_SECRET_KEY`, `NANGO_INTEGRATION_ID`, `NANGO_MODEL`
and `NANGO_CONNECT_ORIGIN` together. The last value is the exact HTTPS origin of the Connect
links issued by your Nango deployment. This first adapter pins the API to Nango Cloud; it is
not a self-hosted endpoint adapter. Missing configuration hides the source action; partial or
invalid configuration fails closed. No credentials are included in this repository.

Use a scoped environment key for connect-session creation, connection metadata reads and
record reads. Connection credential reads are unnecessary. The server creates sessions with
`tags.end_user_id` equal to its verified internal actor and one allowed integration. Provider
OAuth scopes and source-selection behavior belong to that integration's deployed configuration.
The owner follows `/manage/sources/connect` through a CSRF-checked action to Nango's Connect
link. The source action appears in the private workspace only when configured. No public
portfolio loads Nango code or credentials. Authentication tags must remain server-controlled.

The configured sync model must project the existing observation fields: `id` (mapped to
`recordId`), `revision`, `title`, `excerpt`, and `observedAt`, plus Nango's own metadata. This is
an explicit normalization contract, **not** a claim that stock connector records already have
these fields. Use original provider revisions and capture dates; retain source locators and
attribution in the selected excerpt. Do not invent feedback or verification. Raw provider
payloads and credentials are never forwarded as a fallback. Provider-specific sync scripts
and source grants still need deployment and acceptance.

The companion's operator/agent entry is:

```bash
node apps/canopy/import-source.mjs --connection <selected-connection-id>
```

It uses `FOLIAGE_HOSTED_ORIGIN`, `FOLIAGE_HOSTED_STATE`, `FOLIAGE_LEAF`, `FOLIAGE_POLICY` and
`FOLIAGE_HARVEST` from the existing local setup. The device uses its Canopy session, **not** a
Nango master key. The actor remains locked through acquisition and persistence; the shared
writer locks the selected Leaf/harvest and validates the exact local subject. The CLI is an
operator integration seam, not the finished no-identifier consumer onboarding UI.

`POST /api/sources/observations` accepts only bearer authentication and an exact form body
containing `connectionId`, `leafId`, and `name`. Browser cookies/Origin and extra fields are
refused. Leaf identity is a local destination declaration, not provider attribution. Nango
connection identity, integration and current actor tags are checked before and after record
pagination. Upstream errors, deleted/pruned records, malformed data, stalled cursors, changed
same-revision material, oversized batches and incomplete acquisition fail without importing.
The adapter caps each response at 1 MiB, pagination at ten pages and each returned batch at the
existing 100-record/1 MiB limits. Each request has a ten-second timeout and refuses redirects.

This first path takes a complete bounded snapshot, not continuous sync. New revisions become
separate unreviewed candidates; missing records never imply deletion. Retry of unchanged
material preserves decisions. Deletion/revocation propagation to retained candidates, durable
checkpoints, webhooks, automatic connection selection, reconnect UI and provider-specific
normalizers remain unfinished. Disconnecting upstream stops new reads but does not erase
retained evidence or silently withdraw a publication.

Protocol references inspected 2026-09-16:
- [Connect sessions](https://nango.dev/docs/reference/backend/http-api/connect/sessions/create)
- [Connection metadata](https://nango.dev/docs/reference/backend/http-api/connections/get)
- [Synced records](https://nango.dev/docs/reference/backend/http-api/sync/records-list)

Tests use explicitly labeled protocol responses and an actual temporary Git intake through the
companion/review path. They prove local contracts, not an authenticated live Nango deployment.
