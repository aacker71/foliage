# Hosted authority, objects and operations

## Decision and ownership

Vercel owns request handling; Supabase Postgres owns durable authority and private Supabase
Storage owns immutable admitted bytes. Reuse the sibling `supabase/migrations` and
`apps/canopy/src/hostedStore.ts` at `5f9fa1b`; migrate and extend them, never reset existing
customer state or create a parallel receipt store. Open-domain types remain provider-free.

## Logical data model

| Entity | Required identity / invariant |
|---|---|
| Account / subject / identifier | Separate IDs; identifier unique; subject controller explicitly recorded |
| Tenant / reporting placement / collaboration | Tenant-scoped references; one primary placement per person per company; separate participation |
| Artifact / contribution | Explicit owner kind and scope; contribution points to evidence and a named subject only when authorized |
| Revision / object manifest | Immutable digest-bound content; parent revision and admitted schema; no mutable object replacement |
| Grant / consent / approval | Issuer, subject/content scope, audience, purpose, reviewed revision, policy version, expiry and revocation |
| Publication head | Current revision, visibility, withdrawal generation; transactionally compared on mutation |
| Operation receipt | Unique actor + operation ID, request digest, outcome, resulting revision/generation; immutable original result |
| History / outbox | Same transaction as domain change; event type states what actually committed |
| Delivery / preferences | Event + recipient + channel uniqueness, lease/fence, preference version and separate provider state |
| Entitlement | Payer/account/offer references; never portfolio authority or personal score |

Foreign keys include the tenant/scope where applicable. Row-level policies deny by default;
server authorization remains required for privileged paths. Index identifier ownership,
actor/operation, scope membership, active grants, publication heads and pending work. Page
queues and histories; do not compute hierarchy-wide scans on every reader request.

## Commit protocol

1. Authenticate and resolve matching operation receipt before new staging or stale checks.
   Same operation with changed request digest conflicts. Original outcome and current
   visibility are returned separately.
2. Validate exact admitted bytes, current grant/policy and expected head/generation.
3. Stage immutable bytes privately under a digest-bound object key. Do not expose a URL.
4. In one database transaction recheck authority and expected version, then commit head,
   consent/history, receipt and outbox. Failed staging/commit leaves the old head unchanged.
5. If acknowledgement is lost, report outcome unknown and query that original operation.
   Do not blind-resubmit with a new ID. Cleanup may remove only unreferenced staged objects.

After commit, unavailable/corrupt bytes preserve the committed receipt/head and fail closed;
recover the matching object. Do not roll back a receipt or serve an older revision as fallback.

## Readers, withdrawal and recovery

Every HTML, HEAD, detail, image/video, download, listing, preview and old-deployment read
checks current authority before bytes. Public buckets, bearer object URLs and cached positive
authorization cannot bypass that check. Private caching of immutable computation must remain
behind fresh authority. Withdrawal increments durable generation; stale writers cannot
restore a previous generation. Prior downloads cannot be recalled.

Keep database and object backups separately verified. Restore current revocation evidence,
operation receipts and pending events before enabling reads. A restore with uncertain current
authority stays unavailable. Local file-lock durability is a different adapter with its own
[recovery limits](../../docs/LOCAL-DOCUMENT-SAFETY.md).

## Configuration and evidence

Separate preview/production projects, private buckets, secrets and service principals. Region,
replica, log and backup placement must be recorded from real configuration. Required limits
(upload bytes, batch size, deadlines and concurrent workers) are explicit adapter config with
startup validation; measure workloads before publishing service-level claims. Never invent
capacity or recovery promises. Units 06–08 and 29 exercise real database/storage faults.
