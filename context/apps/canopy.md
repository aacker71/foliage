# Canopy hosting and public reading

Package: `@foliage/canopy-app` · Plane: `cloud` · Application: `apps/canopy`.

## Status

Identity direction: Clerk SSO with Supabase storage; see the shared identity contract for
legacy actor migration and the pending local device connection flow.

Integrated: public server, publication CLI, local manager, hosted identity/admission, Supabase storage/migrations and owner-notification adapters. Local publication and replacement have been rehearsed. Intended hosted project configuration and production acceptance remain outstanding.

## Responsibility

Own the publication boundary and public reader, with recruiter reading reusing that same public projection. Hosting management and public reading are separate surfaces of this application, not separate evidence architectures.

## Runtime and interfaces

`apps/canopy/server.mjs` serves public pages, tree and admitted published documents. `manage-server.mjs` handles local publication decisions; `publish.mjs` produces reviewed publication artifacts. The local tree also has marketing/demo route work; that is distinct from the integrated Next website application.

The hosted browser start uses portfolio language and a secondary Photosynthesis export import.
`POST /manage/import/start` derives the canonical subject from a validated export, reserves it
under the current actor and enters the existing private preview. Final publication consent
remains separate. Empty saved addresses can import the export's original identity rather than
forcing a filename/identifier match. Existing public portfolios retain their exact-subject update
route. The main start now discovers the configured loopback companion and opens its Clerk SSO connection. The export form is a secondary fallback; unavailable installation and local-network permission are explained.

## Storage and dependencies

Hosted implementation follows [identity/admission](../contracts/identity-and-admission.md),
[storage/operations](../contracts/storage-and-operations.md) and
[notifications](../contracts/notifications.md). These contracts own the shared hosted design.

`FOLIAGE_PUBLISHED` names publication storage. The manager reads a configured local Leaf and policy for review; public rendering consumes the admitted document. `packages/canopy` owns public projection and publication formats. Do not copy private source documents into the public store.

## Access and invariants

Public reading is not authority to publish. Local manager origin/confirmation controls are not hosted account identity. One hosted account reserves at most three permanent addresses: the app refuses first, and `supabase/migrations/202610090001_address_cap.sql` enforces it in the authority RPC once applied by hand. Integrated hosted identity, tenancy and storage adapters still require configured-service acceptance; no production authentication or residency claim follows from this document.

## Data flow and boundaries

Local source + policy → review → admitted artifact → public reader. Replace/withdraw use the owning publication flow. Recruiter discovery is separately gated. Optional authored-context publication and format 5 are integrated with their readers, export and admission consumers.

Selected-photo publication is a separate v6 candidate. Photos remain local until explicitly
chosen in the private companion; the hosted artifact names only stripped rendition digests,
sizes, formats and selected text. Hosted image GET/HEAD rechecks the current publication and
revision after reading private bytes. The forward storage migration and live two-account,
replacement and withdrawal rehearsal are required before enabling it on a hosted project.
Static export refuses photo-bearing artifacts because it cannot revoke image bytes on withdrawal.

Selected-demo publication uses v7 and a second, unchecked owner choice. The selected MP4
must already be in a reviewed, policy-admitted Leaflet with its captured still selected as
a public photo. The private video store permits up to 64 MiB, but the current hosted
transport admits at most **two H.264 MP4 clips of 1 MiB each** per publication. A larger
clip remains private; the companion names the limit before publication. A combined image
and demo selection over the 4 MiB request ceiling is refused during local preparation
and hosted admission, with room reserved for the review fields.
The artifact contains only digests, duration and optional reviewed caption; exact bytes
are staged in the private revision scope before the authority commit. Public
`GET`/`HEAD /leaf/:id/video/<artifact-digest>/<video-digest>` checks the current artifact,
digest and bytes, then checks authority again after reading. Replacement or withdrawal
ends that address. The static Canopy export refuses media-bearing artifacts because it
cannot revoke their bytes. Hosted service acceptance still requires a live publish,
replacement and withdrawal rehearsal. Apply
`supabase/migrations/202610070001_selected_videos.sql` to the chosen hosted project before
enabling v7 publication; the existing private bucket otherwise refuses `video/mp4`.

## Source and verification

- [apps/canopy/server.mjs](../../apps/canopy/server.mjs)
- [apps/canopy/manage-server.mjs](../../apps/canopy/manage-server.mjs)
- [apps/canopy/publish.mjs](../../apps/canopy/publish.mjs)
- [apps/canopy/src/renderPublished.ts](../../apps/canopy/src/renderPublished.ts)
- [packages/canopy/src/publish.ts](../../packages/canopy/src/publish.ts)

Use this application's source-backed tests and the repository checks. Documentation inspection
is not live deployment acceptance. Shared laws and inventory: [architecture](../architecture.md).

## Nango connection ownership — selected design

Canopy owns the hosted Nango connection UI and authenticated connection/tool boundary. Clerk
continues to own sign-in; Nango handles external-source authorization and sync, not publication
authority. Bind connections to actors/tenants; keep master credentials server-side.
Photosynthesis consumes permitted records/tools. See the [harness design](../proposals/portfolio-harness.md).
Implementation and deployment acceptance remain pending.

### Nango first implementation

`src/hostedNango.ts` implements opt-in Cloud Connect sessions and bounded record snapshots;
`hostedApp.ts` authenticates source routes through the current identity adapter. The existing
local companion imports into the existing review writer via `import-source.mjs`.
[Configuration and limits](../../docs/INTEGRATIONS.md#nango-connection-and-bounded-source-import).
Live provider and consumer onboarding acceptance remain pending.

## Distribution extension — first local implementation

Canopy also owns the proposed [portfolio distribution contract](../contracts/portfolio-distribution.md):
permitted views/cited exports, public discovery, inquiries, customer ATS/CRM adapters and
contracted partner feeds. All consume the admitted publication projection and reuse current
identity, grants, operations, outbox and withdrawal authority. Extend existing Nango actor/tenant
connections for destination scopes; the bounded source importer above does not implement writes.

The [recruiter/manager/client surface](recruiter.md) specifies reader journeys; units 35–37 own
delivery acceptance. No additional public store, recruiter app, source collector or permissions
engine. Recipient-specific private admission is outside the first public-material distribution
slice. Public listing, distribution updates and outreach each need their own applicable consent.

Implemented 2026-09-23: public cited resume HTML/Markdown; private sharing, connected-account
picker and candidate search; exact-preview one-time Ashby notes through Nango; durable SQL
receipts, no-duplicate dispatch, uncertain-write readback and cancellation on publication change.
Routes use existing Clerk/bearer/CSRF boundaries. The deployment opt-in, migration, provider
limits and remaining contract scope are in [distribution integrations](../../docs/DISTRIBUTION-INTEGRATIONS.md).
This is local implementation/verification, not a deployed or live-accepted ATS connection.

2026-09-23 journey separation: `/manage/:id/share` now owns ordinary portfolio/résumé
sharing. Recruiting controls, candidate search and delivery history live under `/recruiting`
with dedicated navigation and sign-in return paths. Personal pages do not load recruiting
connections. Existing authenticated device distribution endpoints remain compatible; legacy
browser routes redirect into recruiting after their access checks. No source, consent or
publication schema changed. This candidate still needs hosted deployment acceptance.

## Work-summary preferences

The existing hosted notification settings save weekly-summary (default on) and daily-digest
(default off) choices under the same actor-bound preference row and RPC. Neither changes
email permission, Photosynthesis collection nor publication. Apply migration
`202609230002_summary_preferences.sql` before the updated application. Summary generation
and sending remain unavailable; the settings screen states that saving only retains a choice.


## Public brain direct-link readers — 2026-09-29

`src/searchPublished.ts` connects the existing hosted app's `/leaf/:id/search.json` route
to the shared pure search over the current published projection. `/leaf/:id/mcp` uses the
official MCP SDK to expose the same read-only search as `foliage_search_published`, bound
to the explicitly addressed Leaf. Both recheck publication authority and send uncached
responses. Static export writes one index for each admitted public Leaf, with frozen artifact
precedence and no example material. There is no hosted inventory/index, private-garden access
or second ranker. See [unit 35](../specs/35-distribution-core.md#public-brain-transport--owner-decision-2026-09-28).
This is locally implemented; a deployed endpoint has not yet been verified.

For an MCP client, configure the Streamable HTTP URL
`https://<your-host>/leaf/<published-id>/mcp`. The only tool is
`foliage_search_published` (`query` required; `limit` optional, 1–10). The address must
be a particular published Leaf. Withdrawal removes the endpoint; replacement during a
request returns 409. A static export supplies `<published-id>.search.json` beside its
Leaf HTML, not an MCP server.

## Word résumé export — 2026-10-05

`GET /leaf/:id/resume.docx` renders the existing admitted distribution projection into a
single-column Word document with live portfolio, statement and evidence hyperlinks. The
public résumé and personal Share page expose it alongside Markdown and browser PDF printing.
After asynchronous generation, the handler rechecks current revision, generation and artifact
digest before serving the file. HEAD performs the authority checks without generating bytes.
Withdrawal, replacement and authority failure refuse obsolete downloads. Files already saved
by recipients remain snapshots; this route performs no provider write or ATS submission.

## Native ATS setup — 2026-10-05

`src/mergeConnections.ts` adds opt-in, region-pinned Merge Link creation and actor-scoped
connection status. `/recruiting/accounts` is independent of portfolio ownership or publication;
its setup POST uses existing verified identity and CSRF. Contact labels never authorize access.
Hosted startup requires both `MERGE_API_KEY` and `MERGE_REGION`. No candidate sync, account-token
storage or Merge delivery is enabled. Provider connection metadata stays at Merge; there is no
second local authority store. See the [configuration and live acceptance limits](../../docs/DISTRIBUTION-INTEGRATIONS.md#native-merge-ats-account-setup--2026-10-05).
