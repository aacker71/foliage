# Portfolio distribution integrations

The canonical design is [portfolio distribution](../context/contracts/portfolio-distribution.md).
This document describes the first implemented transport, not all the planned integration scope.

## Available in this checkout

- Public `/leaf/:subject/resume`, `/leaf/:subject/resume.md`, `/leaf/:subject/resume.docx` and `/leaf/:subject/resume.json` project the current admitted
  publication's introduction, achievements and claim/citation links. No private authoring
  document, admission/source digest or raw attachment is added. Withdrawal gates every request,
  including HEAD. Downloads are snapshots; live links follow current publication authority.
- The public résumé uses a single-column print layout, a visible clickable portfolio address,
  exact statement links, and evidence disclosures. “Print / Save PDF” opens the browser print
  dialog; Word, Markdown and structured JSON use the same admitted projection. The print script is
  self-hosted and cannot make network requests. Personal Share exposes every format.
  Private résumé downloads remain labeled private drafts with local links.
- The Word download is a `.docx` containing actual reading-order paragraphs and hyperlinks,
  with no layout tables, embedded screenshots, macros or private source metadata. The Canopy
  app pins `docx` for OOXML generation; `jszip` is test-only for archive inspection. Public
  authority is checked again after generation: withdrawal returns 404, changed revision or
  generation returns 409, and an authority outage refuses the download. An exported copy
  cannot be revoked from a recipient. File generation does not send an application or prove
  parsing/indexing by any ATS.
- Private `/manage/:subject/distribution` offers those links, configured destination connection,
  a connected-account picker, bounded candidate-name search, exact preview and delivery history.
  A connection or receipt-service outage leaves direct sharing available and reports each failed
  read separately. API fields use `null` for unavailable connections/history, never an empty result.
- The first adapter is **Ashby via Nango**: read an existing candidate, create one plain-text
  portfolio note, and reconcile a lost response by its unique receipt marker. Candidate creation,
  applications, notifications, automatic updates, note replacement and removal are not enabled.
- The new receipt table is in the existing hosted Supabase database. SQL binds owner, current
  publication revision/generation, adapter configuration, connection, candidate and payload digest.
  Each prepared preview needs one explicit send. It has no autonomous worker or retry queue.
- Sending atomically consumes the one-time authorization. Retries cannot issue another write.
  A stale dispatch becomes `unknown`; bounded provider readback can confirm it, but a missing
  note never authorizes another write. Preparing a new operation is a separate deliberate action.
- Publication replacement/withdrawal cancels unsent previews in the same authority transaction.
  A write already in flight may be accepted externally. Its receipt discloses current local
  visibility and the external-copy limitation; no provider deletion is claimed.

This first route requires the **same signed-in owner** to own the publication and the Nango
connection. It fits an authorized pilot account; it does not allow an applicant to connect an
employer's ATS without permission. Separate recruiter identities consuming owner-issued grants
remain unit 35/36 work. Any applicant can use the direct live-link/Markdown path without ATS access.

## Configuration and rollout

Apply existing Supabase migrations in filename order, then
`supabase/migrations/202609230001_distribution.sql` to the intended environment. It depends on
the existing Clerk actor migration. Do not enable destination delivery before applying it.
Deployment configuration remains explicit; no migration or production enablement was performed
by the local implementation tests.

Existing hosted requirements still apply: Clerk identity, application HTTPS origin, Supabase
service credentials and private publication storage. To enable the Ashby adapter, set server-only:

| Setting | Meaning |
|---|---|
| `NANGO_SECRET_KEY` | Existing Nango environment credential; no browser exposure |
| `NANGO_ASHBY_INTEGRATION_ID` | The configured Ashby integration's exact ID |
| `NANGO_DESTINATION_CONNECT_ORIGIN` | Exact HTTPS origin expected in Nango Connect links |

Source imports retain their separate `NANGO_INTEGRATION_ID`, `NANGO_MODEL` and
`NANGO_CONNECT_ORIGIN` settings. A destination-only configuration does not enable source import.
The shared Nango key alone does not opt into either feature. Partial destination configuration
fails the hosted startup with a controlled `distribution-adapter` diagnostic, never secret values.

Configure the Nango integration for Ashby's documented authentication and the pilot customer's
appropriate read/write permissions. Restrict the Nango key to required connection-list/read,
Connect-session and proxy scopes. Created connections are tagged with the verified Foliage actor.
The server rechecks actor tags before reads/writes; it does not trust a browser-supplied owner.
The proxy destination is fixed to Ashby and automatic proxy retries are zero.

The user connects their authorized recruiting account, returns to sharing, finds a candidate,
inspects that candidate in Ashby if necessary, reviews exact content and sends once. Name search
never establishes attribution, auto-selects a person or merges records. More than 25 matching
records asks for a narrower query. Missing integration/configuration shows working direct-share
options rather than a simulated connected provider.

## HTTP contract

Browser routes use Clerk sessions and the existing same-origin CSRF gate. Device equivalents
use existing bearer-only transport and reject browser cookies/Origin. No new authentication system.

- `GET /api/subjects/:subject/distribution`: owned publication, capabilities, connections and receipts.
- `POST /api/subjects/:subject/distribution/connect`: `reviewActorId`; returns a validated Connect URL.
- `POST /api/subjects/:subject/distribution/search`: `reviewActorId`, `connectionId`, `candidateName`.
- `POST /api/subjects/:subject/distribution`: `reviewActorId`, UUID `operationId`, `connectionId`, `candidateId`; prepares only.
- `GET /api/distribution/:operation`: own receipt and exact preview while still current/prepared.
- `POST /api/distribution/:operation/send`: `reviewActorId`, exact reviewed `payloadDigest`.
- `POST /api/distribution/:operation/cancel`: `reviewActorId`; cancels an unsent operation.
- `POST /api/distribution/:operation/reconcile`: `reviewActorId`; readback only, never resend.

Bodies use the existing bounded URL-encoded form transport. HTTP GET/HEAD never sends.
Unexpected fields, foreign actors, stale publication or changed target/configuration refuse the
operation. Saved statuses are `prepared`, `sending`, `accepted`, `rejected`, `unknown`, `cancelled`.
`accepted` means provider acknowledgement or matching readback, not indexing or recruiter attention.
Receipts contain identifiers/digests/status, not another stored resume body or provider credentials.

## Acceptance and remaining scope

Local tests exercise the actual SQL migration/RPCs in disposable PGlite/Postgres, with protocol
identity/storage setup and substituted provider responses. PGlite uses one backend; this does
not establish independent-session locking or deployed Supabase/Clerk/Nango/Ashby acceptance.
Browser checks use explicitly labeled empty protocol data; no fabricated career results.
The 2026-09-23 local check covered search, exact preview, send and receipt with a substituted
provider. Sharing and public résumé were checked at an actual 390px viewport without horizontal
overflow. These checks establish local UI behavior, not provider acceptance.

Run normal gates with `pnpm check`. SQL acceptance is an additional explicit check:

```sh
FOLIAGE_PGLITE_MODULE=/path/to/installed/@electric-sql/pglite \
  node --experimental-strip-types --test supabase/tests/distribution.mjs
```

Before advertising a live Ashby integration, use a consenting owner and authorized real tenant:
connect, search and confirm the right candidate, send once, inspect the note, repeat the same
request without duplicate notes, and exercise connection loss/withdrawal and unknown-outcome
recovery. Confirm actual credential scope and tenant binding. No such external delivery is
claimed by local tests.

Remaining: tailored saved views, recipient grants across actors, inquiries/subscriptions,
standing update grants and durable asynchronous dispatch, provider-specific replacement/removal,
more ATS/CRM adapters, public directory/SEO consent, and contracted supplier feeds. Juicebox
requires its own supplier agreement and ingestion contract; customer MCP is not that channel.

## API sources checked 2026-09-23

- [Ashby candidate lookup](https://developers.ashbyhq.com/reference/candidateinfo)
- [Ashby candidate search](https://developers.ashbyhq.com/reference/candidatesearch)
- [Ashby create note](https://developers.ashbyhq.com/reference/candidatecreatenote)
- [Ashby list notes](https://developers.ashbyhq.com/reference/candidatelistnotes)
- [Nango proxy POST](https://nango.dev/docs/reference/backend/http-api/proxy/post)
- [Nango connection listing](https://nango.dev/docs/reference/backend/http-api/connections/list)

## Native Merge ATS account setup — 2026-10-05

Recruiting now links to `/recruiting/accounts`. An employer administrator enters work email
and organization, then continues to Merge's hosted ATS selector. Email and organization are
contact labels, not access authority. The server generates `end_user_origin_id` from the
verified Foliage actor with a `foliage:ats:` namespace; browsers cannot choose it. The returned
setup address must have the exact `https://link.merge.dev` origin. Link sessions expire after
30 minutes. Initial, periodic and forced candidate syncs are disabled by `are_syncs_disabled`
at setup; this connection slice does not ingest candidate data.

Returning to ATS accounts queries Merge's linked-account API, filtered by the actor's origin
ID and ATS category. Every returned row is checked for the same owner and category before
showing organization, integration and status. Pagination is bounded and accepts only opaque
cursors, never arbitrary provider URLs. Missing integration metadata on an unfinished setup
shows “ATS setup.” A failed provider read shows unavailable rather than “no accounts.” Raw
provider diagnostics, account tokens, link tokens and service credentials never enter the page.

Server-only configuration:

| Setting | Meaning |
|---|---|
| `MERGE_API_KEY` | Merge organization API credential, independent of Nango |
| `MERGE_REGION` | Required `us`, `eu` or `ap`; pins the API host, with no region fallback |

Either setting opts into setup and requires the other. Partial/invalid configuration fails
initialization at `recruiting-connections`. Configure Merge's default ATS scopes to the pilot's
approved purpose before allowing connections. The setup UI uses the existing Clerk session,
verified actor and same-origin CSRF gate; GET/HEAD does not create a setup link. There is no
browser SDK or new token store. The provider retains connection metadata across Foliage restarts.
These routes are browser routes, not new device distribution endpoints.

**This is connection setup and status only.** Merge delivery is not enabled, its account tokens
are not exchanged or stored, and the screen says so. The separate Ashby/Nango reviewed-note
flow is unchanged. Kombo requires its own completion binding; its connection and application
note adapter are not implemented by this slice. Juicebox authorization and supplier ingestion
remain separate. A real configured Merge environment, employer-admin authorization and a
cross-account isolation rehearsal are still required for live acceptance.

Official contracts checked 2026-10-05:

- [Merge hosted Link creation](https://docs.merge.dev/merge-unified/ats/linked-account/link-token/create)
- [Merge linked-account listing and origin filters](https://docs.merge.dev/merge-unified/ats/linked-account/linked-accounts/list)
- [Merge activity creation and remote user requirement](https://docs.merge.dev/merge-unified/ats/common-models/activities/create)
- [Merge per-account available actions](https://docs.merge.dev/merge-unified/ats/linked-account/available-actions/retrieve)
- [Kombo connection completion](https://docs.kombo.dev/hris/guides/connect/embedded-flow)
- [Kombo application notes](https://docs.kombo.dev/ats/v1/post-applications-application-id-notes)
