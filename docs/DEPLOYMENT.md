# Foliage — deployment plan of record

Implementation status reviewed 2026-10-01. This document records code and remaining acceptance
work; it does not establish a production launch. The earlier September 4 readiness study is
historical evidence, not a description of the current tree.

## Where each app runs

Owner direction: personal applications stay local and connect to Canopy; deployed applications
use separate Vercel projects.

| Surface | Runtime | Boundary |
|---|---|---|
| Leaf, Photosynthesis, CoS, dashboard | Local | Open packages stand alone; no closed imports |
| Local Canopy manager | Loopback | Closed companion; sends explicitly reviewed public projection to the chosen Canopy service |
| Hosted Canopy | Separate Vercel application | Account authority, private storage, request-time reader |
| Enterprise | Separate deployment, later | Current durable local release storage is not evidence of shared hosted authority |

The local processes are not packaged as publicly writable web applications. Local Host/Origin
checks must never be weakened to accommodate a deployment preview.

## Implemented connection

`foliage canopy` still starts a local manager and local read-only reader. The optional
`FOLIAGE_HOSTED_ORIGIN` activates the manager's **Live portfolio** connection to one exact HTTPS
origin. `FOLIAGE_HOSTED_STATE` keeps its session, reviewed payload and operation privately in the
selected garden. This is configuration-derived egress; the literal-host scanner cannot prove
which service an operator selected.

The companion sends the existing publication projection to `/api/subjects/:id/preview`, then
requires a separate publication decision. The hosted HTTP application reuses verified account
identity, admission and durable publication operations for device and browser transports.
Device routes refuse browser Cookie/Origin authority. The local app receives only a dated,
non-secret hosting observation. See [the handoff contract](LOCAL-HOSTED-HANDOFF.md).

`apps/canopy/src/hostedIdentity.ts`, `hostedAdmission.ts`, `hostedStore.ts` and `hostedApp.ts`
implement the hosted identity/admission/persistence/HTTP composition. The SQL migrations and
operator configuration are in [the persistence guide](../supabase/README.md).
`tools/deploy/build-canopy-vercel.mjs` packages the actual hosted entry and shared dependencies.
Building that output does not configure Supabase or verify Vercel delivery.

## Public content and withdrawal

Current unphotographed publication writes version 5; an explicitly selected photo set writes
version 6. Both carry admitted **pending and verified** work under attribution, deny and
redaction gates. Verified hosted entries require supported independently checked source proof;
client assertions cannot upgrade a pending entry. Selected narrative and references can cross
through the local handoff without adding authorship verification. Unselected bodies, media and
unapproved drafts stay local. Selected v6 renditions use private immutable storage and
current-authority media reads. Static export refuses photo-bearing artifacts rather than
producing media that withdrawal cannot govern. Historical formats remain readable under their
original rules. See [selected photos](PUBLIC-PHOTOS-IMPLEMENTATION.md) for exact bounds and
unverified provider acceptance.

A garden with no offered eligible work produces an honest empty publication. Historical counts
from local private files must not be reused as today's evidence. Never substitute an example or
invented provider result for a person's real portfolio.

Owner direction: **withdrawal should stop serving immediately**. Implemented hosted reads consult
current authority and private artifact bytes for every request and recheck the revision. There
is no positive publication cache or public object URL. The hosted adapter supplies no-store
headers and does not fall back to local files or old revisions on authority failure.

Publish, replace and withdraw carry operation identity, reviewed revision and generation.
Lost acknowledgments retain that identity and resolve its receipt before retry. A historical
receipt and current public state are separate facts. Static exports remain copies outside this
authority; withdrawing a managed publication cannot recall downloads or screenshots.

These code paths and their local harnesses do not prove the deployed delivery path. Acceptance
must cover every exposed reader, download, metadata and future media route. Requests beginning
after acknowledged withdrawal must receive none of the withdrawn content. Already in-flight
responses and downloaded copies cannot be recalled.

## United States residency

Owner decision, September 4: **US**. No further country decision is needed. Supabase `us-east-1`
and Vercel `iad1` are the proposed storage/compute pairing, not inspected live settings.
Verify the selected project's primary processing/storage, backups, replicas, restore behavior
and content-bearing logs before making residency claims. A primary-region setting alone does
not establish the location of every provider-handled copy.

Do not migrate an unrelated existing project or enable cross-region replicas implicitly.
The intended application project/organization must be selected explicitly. The existing Foliage
Brain project is not authorized for reuse merely because its name matches.

## Enterprise

Enterprise now has explicit local actor selection and durable release/history/receipt/outbox
storage; see [the storage contract](ENTERPRISE-RELEASE-STORAGE.md). This replaces the old claim
that the only implementation calls `saveStore` into ephemeral `/tmp`. It does not make a local
filesystem a multi-instance hosted database. Hosted organization identity, shared authority and
recovery acceptance remain separate work. Canopy's personal account flow does not supply them.

## Remaining launch evidence

- Select the intended application Supabase organization/project; configure Auth, private storage,
  migrations, Vercel environment and approved US locations. Inspect provider settings directly.
- Verify account creation, recovery, connection and ownership against that real service, with
  two independent accounts. Local synthetic HTTP contract inputs are not provider acceptance.
- Publish actual offered work; inspect the exact public reader from an independent browser.
  Replace it, interrupt acknowledgments, restart the local companion and recover the operation.
- Warm every exposed delivery path, withdraw, and issue fresh GET/HEAD requests from independent
  clients and serving instances. Probe encoded identifiers, historical deployments, preview
  aliases and direct object access. Nothing may bypass current publication authority.
- Race replacement and withdrawal; replay an old upload; make identity/storage unavailable.
  Errors must not become stale content, a guessed zero, or a false success receipt.
- Restart instances, roll back application code, and rehearse storage restore. Revocations must
  survive. Document retention and erasure separately from stopping publication.
- Review the finished UI with real content, including empty/error/recovery/mobile/keyboard
  states. Complete public narrative/media before claiming the complete portfolio experience.
- Confirm production Vercel settings, deployment protection and hostname, then record production
  release evidence. A preview build and a noindex header do not establish customer acceptance.

All of these remain evidence gates. Existing implementation must be reused and tested rather
than repeatedly scheduled as missing code. No production cutover, customer acceptance or
full launch is claimed by this plan.
