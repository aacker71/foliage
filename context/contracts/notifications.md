# Notification and worker contract

## Decision and reuse

Use Novu for inbox/email/SMS and the existing Postgres outbox for authority. Reuse
`apps/canopy/src/hostedNotifications.ts` and the owner-notifications migration on
`codex/portfolio-achievements@5f9fa1b`. The current adapter proves bounded transport/lease
behavior through tests, not real delivery. Extend beyond owner notices only under current
artifact and recipient grants.

Use bounded, secret-authenticated scheduled invocations of the existing hosted notification
endpoint on Vercel, with Postgres leases for durable state. Invocation scheduling has no
exactly-once assumption. If the selected Vercel plan cannot meet the required invocation
cadence/duration, deploy the same worker entry as a managed container job; the queue, leases
and contract stay unchanged. Long-running evaluation never runs in this request handler.

## State machine

A committed domain event fans out to unique `(event, recipient, channel)` delivery records.
States distinguish pending, leased, cancelled, rejected, provider-accepted, delivered,
failed and unknown. Provider-accepted is not delivered. Lease IDs fence stale workers.
Read-only preflight can retry; once a durable dispatch marker exists, a lost send response
requires reconciliation using the same delivery ID, never a blind resend. Duplicate and
out-of-order callbacks cannot reverse a later terminal fact.

Before dispatch, recheck current event reachability, grants, recipient identity, channel
permission and preferences. Preference/role changes between enqueue and send are effective.
Absent workflow/sender configuration leaves that channel unavailable; it does not select a
new provider or claim completion. In-flight sends cannot promise recall after revocation.

## Payload and user experience

Generic notices are the default. SMS contains a generic notice and an authenticated link.
Email summaries require explicit content policy plus current access and channel preferences;
raw evidence and private review notes are excluded. Only allowlisted payload fields enter
Novu. Inbox preferences, quiet time/timezone and digest windows never grant access.

A link navigates to the exact review after a fresh access check. GET, HEAD, link previews and
email scanners never mutate. Keep saved domain state and delivery status separate in the UI.

## Work-summary cadence — owner decision, 2026-09-23

Weekly summaries are the starting preference; daily digests are an additional opt-in.
Keep the choices independent so either can be disabled. This cadence is separate from
Photosynthesis source collection, service notices and publication permissions. Reflection
should surface meaningful decisions, roadblocks, discoveries and progress, with inspectable
support, rather than an activity tally. Do not send empty digests.

The existing account preference row owns `weekly_summary` and `daily_digest`; no separate
local preference store. Defaults are true/false respectively. Existing email/SMS opt-outs
remain intact. The migration and authenticated form persist choices only: summary content,
digest-window scheduling, timezone/quiet-time dispatch and live delivery remain unfinished.
A saved cadence does not claim an active subscription or authorize extra evidence transfer.

## External inputs and acceptance

The operator configures Novu environment/workflows and verified email/SMS senders, not the
agent writing specs. Provider-specific setup is part of unit 22 in test mode; no messages are
sent by these specs. A channel remains off until its callback authentication, payload policy
and permission checks pass. Required evidence: crash/retry, revoke-before-send, unknown
acknowledgement, duplicated callbacks and actual permitted test deliveries.
