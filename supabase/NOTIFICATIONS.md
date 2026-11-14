# Owner publication notifications

`apps/canopy/src/hostedNotifications.ts` and migration `202609080002_owner_notifications.sql`
extend the [hosted publication store](README.md). This is the personal owner notification
slice of B07. It is not organization/industry routing, a configured Novu environment or
evidence that any message was delivered. No provider resources, sender or schedule are created.

## Server composition

`createHostedNotificationWorker` takes `supabaseUrl`, `serviceRoleKey`, `novuUrl`, `novuKey`,
`appOrigin`, `workerSecret` and `workflows: {inbox?, email?, sms?}`. Reuse the server's
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; select the other credentials/environment
explicitly. No browser receives these values. `fetch` and `now` are injectable test seams.

- `run({limit?})` consumes at most 20 leased attempts, default 10, and reports counts for
  accepted, unknown, rejected, cancelled and deferred outcomes. Acceptance is not delivery.
- `handleRequest(Request)` accepts only `POST /internal/notifications/run` with the exact
  configured bearer secret. It ignores requested body limits and returns no-store results.
- `preferences(actor)` and `setPreferences(actor, {inbox,email,sms,weeklySummary,dailyDigest})` bind the verified server
  actor UUID. The application must enforce its authenticated mutation/CSRF contract before
  calling the setter. Inbox starts enabled; email and SMS require explicit opt-in.

A configured workflow permits that channel; an omitted channel is cancelled without a send.
Each recipient must still be the event's current reserved owner. The worker reads Supabase
Auth's server-only admin user endpoint, checks that exact UUID and authenticated account,
and uses only provider-confirmed email/phone fields. User metadata, document names and
uploaded contact claims are ignored. Contact addresses appear only in Novu's recipient
transport, not the event payload, SQL attempt row, logs or worker response. The subscriber
identifier is that authenticated owner's UUID; there is no topic or subscriber discovery.

## Required workflow configuration

Before **each** trigger, the worker reads `GET /v2/workflows/{workflowId}`. Unsupported,
unreadable or inactive workflows fail closed. The supported contract is deliberately small:
one active `novu-cloud` step, with `in_app`, `email` or `sms` matching the attempt; no extra
disabled steps, agent routing, translation, provider overrides or personalized template data.
This prevents another channel in the same workflow from bypassing Foliage preferences.

For inbox and SMS, the exact body is `A Foliage update is available. {{payload.reviewUrl}}`.
Email uses subject `Foliage update` and this exact HTML body:

```html
<p>A Foliage update is available.</p><p><a href="{{payload.reviewUrl}}">Review in Foliage</a></p>
```

Control values may contain only that body, the email subject where applicable, and an absent
or false `skip`. Payload contains a generic notice and the server's HTTPS `/manage` URL.
That route requires sign-in; no magic token, subject name, portfolio content or evidence URL
is sent. There is no email summary mode in this slice. The actual Novu renderer/provider
must be tested with these exact controls before enabling channels.

The runtime workflow read is supported by Novu's [retrieve workflow API](https://docs.novu.co/api-reference/workflows/retrieve-a-workflow).
The [trigger API](https://docs.novu.co/api-reference/events/trigger-event) accepts the
workflow identifier, recipient, transaction ID and payload; the worker explicitly disables
agent routing. These protocol sources were read on 2026-09-08, along with the owner's
[Novu repository](https://github.com/novuhq/novu).

## Durable states and recovery

The publication transaction already commits its outbox row. A later SQL transaction expands
it into unique event/owner/channel records. Events expire after 24 hours in this first worker;
expired, superseded, withdrawn-publication or opted-out notices remain recorded as cancelled.
A current withdrawal event may itself generate a generic owner update. Enabling a channel
does not backfill previously cancelled notices.

An attempt keeps one UUID as both Novu `transactionId` and `Idempotency-Key`. A 60-second lease
can be reclaimed with a new lease token only before the durable `dispatching` marker. The
marker checks current owner, event revision/generation, expiry and preference in SQL.
Stale lease tokens cannot begin or finish another worker's attempt. A process that dies after
the marker may have sent: expired dispatching leases become **unknown**, never pending.

A matching processed acknowledgement records **accepted**; known workflow refusal records
**rejected**. Timeouts, malformed/mismatched responses, HTTP conflicts/errors and lost outcome
writes remain **unknown**. A late positive acknowledgement from the same attempt/lease can
resolve it. The worker does not automatically retrigger an unknown operation. Novu documents
that [API idempotency](https://docs.novu.co/api-reference/idempotency) is organization-dependent
and time limited; a transaction ID alone is not sufficient retry protection.

Unknown rows retain their transaction ID, exact dispatch digest, workflow, lease and time for
operator reconciliation against the intended Novu environment. An authoritative provider
lookup, authenticated delivery callbacks and operator reconciliation UI are not implemented.
Do not reset unknown rows to pending or call a new trigger to discover their outcome. This
slice never claims accepted means delivered and does not pretend to retract external copies.

The SQL authorization point, Auth contact read, workflow read and external trigger are separate
operations. Withdrawal, preference/contact changes or a Novu workflow edit can race after those
reads. Payload minimization and the authenticated review route limit disclosure; this is not
an atomic cross-provider revocation guarantee. Disable dispatcher configuration during workflow
edits. Prove the chosen workflow/provider settings and processing locations before activation.

## Evidence and remaining deployment work

Run `node --experimental-strip-types --test apps/canopy/src/hostedNotifications.test.ts`.
For real disposable Postgres execution, set `FOLIAGE_PGLITE_MODULE` to an installed PGlite
package and run `node --test supabase/tests/owner-notifications.mjs`. Test contacts, clocks,
provider responses and auth/storage surfaces are named harness inputs, never customer results.
PGlite queues one backend: those tests establish SQL transitions/rollback and role restrictions,
not independent-session locking, actual Supabase Auth/Storage or real Novu delivery.

Vercel scheduled execution remains a placement candidate. Its schedule must invoke the
protected worker through an explicitly configured POST adapter; this module activates no cron.
Production acceptance still needs isolated environment/sender setup, confirmed contact and
workflow tests, independent worker races, delivery tracking, callbacks/reconciliation,
notification preferences UI, digest policy, US processing evidence and restart/restore drills.
Full organization, cross-company and industry recipient/grant routing remains in B04/B07.

## Work-summary preference slice (2026-09-23)

Apply `202609230002_summary_preferences.sql` after the Clerk actor migration and before
shipping the updated settings route. It extends the existing preference row and read RPC;
a six-argument setter saves channels and cadence atomically. The retained four-argument
setter updates channels without clearing cadence choices. All RPC access remains server-only.

Weekly summaries default on and additional daily digests default off. Both can be disabled.
Email remains off by default, and existing opt-outs are unchanged. Saving these choices does
not create notification attempts, configure a provider or schedule a summary. The existing
worker still sends only generic service notices. Content generation, timezone/window
scheduling and live summary delivery remain pending; UI copy discloses that state.

Disposable migration/role/round-trip checks are in `supabase/tests/clerk-actors.mjs`, using
the same `FOLIAGE_PGLITE_MODULE` setup above. These are local SQL tests, not hosted delivery.
