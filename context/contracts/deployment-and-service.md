# Deployment, private operation and service contract

## Deployment topology

Hosted website/Canopy/agent entry points run on Vercel; authority and admitted objects remain
in the selected Supabase services. Clerk supplies hosted SSO identity. Keep preview and production data/secrets separate. The
website has its own Next build; native TypeScript servers use their actual entry adapters and
packaged workspace assets. An old deployment must use the current authority gate or be
inaccessible before withdrawal guarantees can be accepted.

Notifications use bounded invocations under [their worker contract](notifications.md).
Evaluation jobs run outside web handlers in ephemeral workers. Default cloud executor design:
a managed Kubernetes Job with gVisor RuntimeClass on an operator-selected US cluster, non-root
workload, read-only image, bounded scratch space, no host mounts/socket, deny-default network,
CPU/memory/PID/deadline limits and supervisor signing outside the workload. This is an engineering
design choice, not a claim a cluster exists. Startup refuses unavailable isolation; ordinary
Docker is not the fallback for arbitrary external code. Local Docker evaluation remains for
explicit authorized workloads under the existing runtime restrictions.

Private enterprise delivery uses versioned OCI application/worker images plus Postgres and
private S3-compatible object storage adapters. Provide Compose for a supported single-host
installation and documented orchestration values for a customer's supported cluster.
Use configured OIDC identity; local inference and inbox remain usable with external egress
disabled. Optional Novu/external inference require declared policy. Do not containerize the
whole product as one privileged process or claim every provider adapter already exists.

## Operations and observability

Correlate operation, run, revision and delivery IDs. Collect stage latency, queue lag,
failures, retries, timeouts, resource use and cleanup outcomes without private prompts,
source text, credentials or personal capability scores. A runtime failure and missing
telemetry are different states. Keep per-environment access-controlled diagnostic retention;
raw evidence is not a debugging convenience.

Canopy's hosted entry emits `canopy.hosted.unavailable` to server logs on startup failure.
Its controlled `stage`, missing setting names and recovery instruction contain no values,
URLs, provider error messages or request bodies. Repeated identical failures in a running
instance are suppressed. Public responses stay uncached 503 refusals with no local authority
fallback. These diagnostics identify startup failures; they do not prove identity, storage,
notifications or publication are operational.

Each hosted request that ends in a 5xx emits one `canopy.hosted.request_failed` line: a
random `requestId` (returned as `x-request-id` and shown on the failure page), the catching
layer, method, route template (addresses, ids and digests become `:id`), status, and the
error's name, code, cause names, code frames and a bounded message scrubbed of token, key,
email and query shapes. It never reads request bodies, cookies, headers or query strings.
`GET /healthz` is anonymous and uncached: `ok` after one read-only authority lookup,
otherwise a 503 `unavailable` that names no setting or provider. It does not check Clerk;
public reading does not need it, and Clerk failures appear as `session` request failures.

The website and Canopy have separate Vercel projects. Root `.vercelignore` excludes local
agent state, control files, environment files and local evidence from source uploads.
Canopy uses the locally built Build Output package; run CLI deployment from the repository
root with a fresh `.vercel/output` copied from `apps/canopy/.vercel/output`. Select the
Canopy project and preview target explicitly. Source-based cloud packaging is not yet
accepted: the packager currently relies on the tracked Git file inventory.

Before release, record supported versions, real processing/storage/log/backup regions,
operator/contact, capacity limits, retention/deletion rules and recovery targets. Refuse
production activation if required deployment configuration is absent. Load tests establish
supported limits; no speculative latency/SLA number is promised in these specs. Exercise
migration, rollback, database/object restore and revocation continuity together.

## Discovery and commercial defaults

Canopy reading through a deliberately shared link works independently of discovery.
Listing requires explicit revocable subject/group-owner consent; private-network participation
never enables public indexing. Supported initial discovery filters are reader-supplied declared
fields and chosen date order; no relevance/person score. Subscriptions do not create grants.

Keep entitlement behind an adapter separate from ownership. Default implementation uses
provider-neutral checkout/webhook/reconciliation interfaces; select the operator's configured
payment provider in test mode. Actual price, refund/support promises, distribution license
and live charging are business release inputs, not missing technical architecture. No
LICENSE file or charge is created by these specs. Absent offer configuration shows no
purchasable offer. Cancellation cannot destroy local ownership or publish/unpublish work
without the relevant authority.

## Release inputs versus design decisions

| Input supplied by operator/owner | Behavior until supplied | Acceptance unit |
|---|---|---|
| Intended Clerk/Supabase/Vercel/Novu projects, credentials, callbacks and sender identities | Unconfigured adapter; no external action | 02–08, 21–22 |
| Cloud evaluation cluster, trusted issuer keys and region/isolation evidence | No arbitrary-code cloud dispatch | 26–27 |
| Customer private infrastructure/issuer and allowed egress | No private-install readiness claim | 28 |
| Approved offers, provider merchant account, price/terms/license/support owner | No purchase or live billing | 31–32 |
| Consenting participants, operational contacts and explicit release decision | Engineering checks only; no customer/production acceptance | 35 |

These inputs can block a deployment or trial, not writing the complete unit specs. Use
[test/acceptance requirements](../../docs/PORTFOLIO-SCALE-ACCEPTANCE.md) to record actual results.
