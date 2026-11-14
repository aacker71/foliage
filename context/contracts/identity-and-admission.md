# Identity and evidence admission contract

## Decision and reuse

The owner selected Clerk SSO on 2026-09-15. Clerk owns hosted identity, Google sign-in,
confirmation and recovery; Supabase remains the database and private object store. The
previous Supabase Auth implementation remains a legacy adapter, not a second hosted login.
`clerkIdentity.ts` verifies signatures, issuer and authorized origin, then checks the current
Clerk session and user before resolving an internal actor. `clerkApp.ts` reuses an active
browser session and loads Clerk only on private pages. Telemetry is disabled.

Service-only `foliage_actors` maps `(issuer, subject)` to a stable internal UUID. Migration
202609150001 preserves existing Supabase actor UUIDs under a legacy namespace. Accounts are
never linked by email. Existing publication identifiers and receipts retain their owners.
Private deployments must implement the same verified-actor interface under their configured
OIDC authority; those adapters are not implied to be deployed.

## Interfaces and state

The server derives `{actorId, sessionId, issuer, authenticatedAt}` from a freshly verified
session. Clerk manages its short-lived browser session cookie; existing private mutations retain
same-origin POST and a Secure, HttpOnly, host-only double-submit CSRF cookie;
device clients may present verified Clerk bearer credentials. The legacy email/password
device bootstrap and refresh are disabled; the local connection now uses an explicitly approved, verifier-bound session grant (see unit 13); live acceptance remains required. Reject mixed transports. Clerk handles sign-up confirmation and recovery. Pending, revoked, expired, impersonated
and banned/locked sessions cannot publish. Account recovery never replays publication. Preserve the intended authorized destination
through sign-in with a same-origin allowlist, never an arbitrary redirect.

Account ID, subject ID, portfolio identifier, tenant membership, device key and payer ID are
separate records. Identifier reservation is unique and transactional; account recovery does
not transfer identifiers based on an email match. Every status/receipt lookup verifies the
actor as well as the operation. Service credentials never enter the browser.

Admission receives exact bytes, content digest, supported format, target subject, operation
ID and reviewed audience. Schema validity, control of a signing key and authenticated upload
are three facts; none establishes authorship. Reuse the sibling hosted admission and GitHub
proof adapters for their narrow supported cases. Unsupported evidence remains pending or
refused with its reason; do not relabel it verified. GitHub verification requires an exact
commit and trusted binding under that adapter, not contribution counts.

## Authority

Personal publication/replace is the subject's final action. Company release allows use of
company material; it cannot publish the person's portfolio. Group artifacts require explicit
group authority plus public-disclosure authority for affected person-identifying content.
Reporting placement, collaboration and payer status do not grant access. Recheck authority
at commit and each read. Denied/expired/unknown identity fails closed without private details.

## Configuration and acceptance

Deployment supplies Clerk application keys, the intended Supabase project, exact issuer and app origin,
server secrets and real consenting test identities. Missing values produce an explicit
unconfigured state. These are release inputs, not invitations to create a second design.
Two-account isolation, recovery replay, foreign receipt lookup, forged claims, expired
sessions and stale exact-content consent are required in units 03–05.

See [architecture](../architecture.md) and [unit plan](../specs/00-build-plan.md).

Clerk changes require configured-service browser acceptance. Novu contact resolution still
uses the legacy provider and is not enabled with Clerk; hosted startup explicitly refuses a
partial notification integration rather than looking up Clerk actors in Supabase Auth.

### Local session grants

The browser approves `/manage/device/connect` under Clerk and the existing CSRF gate.
`deviceConnection.ts` binds the signed grant to an in-memory local verifier and an exact
loopback callback. The local bridge obtains its actor through bearer-only
`GET /api/session/device`. All subsequent authority still checks the current Clerk session
and user. Grant expiry is at most a day and never exceeds the issuing session expiry.
Neither a device grant nor an external legacy cookie can create a browser login or another
grant. Removing local credentials does not by itself prove remote revocation; the existing
disconnect result preserves uncertainty. A lost callback requires a fresh SSO connection.

## Nango source transport — initial implementation

Source Connect sessions bind `tags.end_user_id` to the existing internal actor, with a single
server-configured integration allow-list. Observation requests authenticate with the same
Clerk/device path; client-provided actors and mixed cookie/bearer transport are refused.
Nango connection identity, integration and ownership tags are checked before and after
pagination. Tags must be server-controlled. A declared local Leaf target is a destination,
not a claim that the external work belongs to that person. The review contract retains this
distinction. Source connection grants never grant publication authority.

The first adapter refuses deletion/pruned/error/partial batches; it does not yet implement
retained-evidence revocation, source-specific grants or continuous sync.
