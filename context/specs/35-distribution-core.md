# Unit 35: Make admitted work discoverable and shareable

Build package: `B06` · Owner: [canopy](../apps/canopy.md)
Acceptance: OF01, OF04, AU02, AU03, AU04, ST01, ST03, NT01, UX01
Specification: ready · Implementation: first shared-resume/Ashby-note slice implemented locally; full unit acceptance remains open.
See [integration behavior and remaining scope](../../docs/DISTRIBUTION-INTEGRATIONS.md).

## Goal

Let an owner prepare a current, evidence-linked portfolio/resume or client case-study view,
share it deliberately, and receive a wanted inquiry without needing a recruiting partnership.

## Design

Follow [portfolio distribution](../contracts/portfolio-distribution.md). Reuse the existing
publication projection, reader, authority, Nango identity bindings, outbox and Novu preferences.
Initial views contain only admitted public material. Private recipient-specific admission is
outside this slice. Views select stable achievements; factual changes return to authoring.
Public listing/search stays in unit 20 and can be delivered separately. No new recruiter app.

Use [UI context](../ui-context.md) and [code standards](../code-standards.md).

## Implementation

1. Extend hosted relations for views, opportunity preferences and scoped distribution grants; keep current publication generation/digest authoritative. Add authenticated exact-preview/create/revoke operations and schema versioning to existing migrations.
2. Project the same admitted claims/citations into accessible HTML, structured JSON/Markdown and a cited resume/proposal export. Preserve collaboration, AI assistance, limitations and claim links; strip unselected fields from metadata, media and downloads.
3. Add the existing-portfolio Opportunities flow with direct sharing and explicit discovery/update preferences. Integrate unit 20 only when its listing acceptance is met; unsupported destination actions offer link/document fallback honestly.
4. Add sender-verified, rate-limited inquiries and opted-in subscriptions through existing notification infrastructure. No outbound introduction or application from preparing a view. Persist action receipts with truthful prepared/downloaded/inquiry states.
5. Recheck current grants on every read, cache response, export and queued action. Revoke scoped links, cancel pending work, preserve owner edits and show external-copy limitations. Automatic updates require implemented publication grants as well as distribution grants.

## Dependencies

- Required units: [13](./13-publish-handoff.md), [21](./21-outbox-dispatch.md), [22](./22-notice-preferences.md), [24](./24-public-portfolio.md)
- Reuse existing workspace projection, authority, connection and worker packages. Install no
  provider SDK until its first real use is justified and pinned under the contract.
- Real participant, tenant/provider credentials and external agreements are environment inputs,
  never committed. Their absence blocks live acceptance, not truthful link/export fallbacks.

## Verify when done

- [ ] A consenting developer shares actual work with an independent recruiter/manager and a prospective client; each can inspect a precise claim's evidence and send a wanted inquiry without public-reader signup.
- [ ] Two-account isolation, stale generation, idempotent retries, foreign views and revoked grant/read/download/HEAD/metadata paths are exercised.
- [ ] A changed achievement updates the permitted live view while pinned submitted exports stay historical; no unrelated/private text or false evidence assertion appears.
- [ ] Desktop, mobile and keyboard reading work without WebGL; sender verification, suppression and unsubscribe work; a fetch is never labeled a human read.
- [ ] Record focused tests, architecture/boundary checks, required repository gates and actual environment evidence. No vendor integration or autonomous publication is inferred from this slice.


## Public brain transport — owner decision, 2026-09-28

The private work-record brain remains local first. The opt-in local MCP `foliage_search`
and `foliage search` CLI are tracked separately. Canopy calls only the pure
`@foliage/photosynthesis/search` record-search export, never a private garden entry point.

The public brain matches what the published page shows: owner-published pending-tier leaflets are allowed.
Unreviewed or rejected harvest candidates, excluded, example and private material never enter
it. Publication policy and visibility apply; unlisted work is accessible only through its link,
never enumeration or global discovery. No score is exposed.

`GET /leaf/:id/search.json?q=...&limit=...` and `POST /leaf/:id/mcp` are bounded,
read-only direct-link readers in hosted Canopy. They use `readPublic`, search only the
current admitted published document, and recheck revision/generation/digest before returning.
Withdrawal is 404; a changed publication is 409; adapter, projection or authority failure
is 503. Neither route lists portfolios, reads the private garden, stores a hosted index or
calls a provider. Responses have no cookies and are not cached. The MCP route uses the
official stateless HTTP SDK and offers only `foliage_search_published` for its addressed Leaf.

`searchPublished` accepts `(PublishedLeafDocument, query, limit)` and returns only `{ id,
snippet }` selections. The transport rebinds each selection to the admitted page projection,
including authored profile, achievements, claims, collections and Leaflets. One foreign ID
or snippet refuses the entire result with 503. Limits are 300 characters/512 UTF-8 bytes
and 1–10 hits. The wire response includes the addressed portfolio URL, revision and page
citation; internal rank values and extra metadata are not serialized. Static site export
writes the same admitted projection to an individual Leaf search index. A frozen publication
artifact takes precedence over a mutable live tree. A fresh export after withdrawal removes
the index. The static index is a file, not a revocable hosted endpoint.

Acceptance of this slice requires bounded input, no score serialization, GET/HEAD behavior,
authority outage, changed revision and withdrawal tests. End-to-end acceptance additionally
requires the real shared module's projection parity, forbidden-material and unlisted tests,
plus hosted verification. Local tests and package checks do not establish deployed-host
acceptance. No private MCP behavior, collector, queue, startup code or UI copy changes belong
to this slice.

### Word résumé download — 2026-10-05

Extend the existing admitted résumé projection with `/leaf/:id/resume.docx`. This is a
candidate-held document for manual applications, not an ATS submission or provider receipt.
Use a single reading-order column, actual text paragraphs, a visible linked portfolio address,
claim/citation hyperlinks and an honest publication snapshot notice. Carry every admitted
claim category, including limitations and AI assistance. Do not insert private metadata or
invent contact details. The browser reader and personal Share page expose the download.

The Canopy app owns OOXML presentation and uses a pinned document writer. Every GET/HEAD
uses the current publication authority; after asynchronous generation, recheck revision and
generation before returning bytes. A withdrawn or replaced publication must not return the
old document. Verify archive contents/relationships, Unicode and escaping, actual Word
rendering, download headers, withdrawal and replacement during generation. No provider
credentials or new publication schema are needed.
