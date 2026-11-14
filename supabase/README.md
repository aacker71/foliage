# Hosted publication persistence

This slice supplies the closed-plane `apps/canopy/src/hostedStore.ts` adapter and a
Supabase migration for personal publication authority. It does not deploy an API, select
an existing project, send notifications or establish hosted acceptance. Apply migrations
only to the intended application project after its environment and recovery plan are set.

## Server interface

`createHostedStore({supabaseUrl, serviceRoleKey, fetch?, timeoutMs?})` uses standard
Supabase REST/RPC and private Storage calls. The origin must be HTTPS (HTTP is allowed only
for loopback test/private development). Credentials remain server-only. Redirects are
refused, requests bypass caches, bodies are bounded and no object URL is returned.

Methods:

- `reserveSubject(actor, subjectId)` reserves a stable identifier for the verified actor,
  or returns its existing state if already theirs. An identifier is never reassigned.
- `publish(actor, operation)` accepts current-format artifact JSON and verified admission.
- `withdraw(actor, operation)` clears reachability and advances the durable generation.
- `operation(actor, operationId)` returns that actor's original receipt and current state,
  or `null`; another actor's identifier does not expose its receipt.
- `readPublic(subjectId)` reads current authority and exact private bytes, verifies digest
  and public format, rechecks authority, then returns a document or `null` if unavailable
  by publication state. Storage/authority failures throw; there is no older-head fallback.
- `listOwned(actor, {after?, limit?})` pages owned identifiers and current state for recovery.

`actor` is `{id: string}` where `id` is the Supabase Auth user UUID established by verified
server session lookup. It is a separate argument, never taken from an operation body or
unverified JWT claims. SQL RPCs are executable only by `service_role`; they still check
ownership before mutations and private receipt/inventory reads. Browser roles have neither
table privileges nor RPC execution. RLS is enabled as an additional default-deny boundary.

An operation binds `operationId`, `subjectId`, `expectedRevisionId` and
`expectedGeneration`. Initial authority is `null`/`0`. Each new committed publication or
withdrawal increments the generation. `publish` additionally needs raw v3 artifact JSON
and `VerifiedPublicationAdmission`: actor, subject, operation, exact artifact/policy digests,
reviewed revision/generation, and stable admission/consent IDs. The identity/admission lane
must produce this binding from verified server ownership, trusted admission and the person's
explicit final consent. **Parsing the document is not proof of authorship.** The initial
admission lane supports pending-only transport; verified claims require its independent
verification contract before being admitted. This persistence module does not mint admission.

Canonical uploaded bytes are UTF-8 `JSON.stringify(toArtifactJson(parsedDocument))`, without
a trailing newline. Pass `toArtifactJson(admitted.document)` to `publish`; the parsed object
contains an internal review marker that is not an allowed wire field. The byte limit is
2 MiB, a local implementation guard rather than measured hosted capacity. The fixed private
bucket is `foliage-publications`; this slice stores publication JSON, not arbitrary media.

## Commit and recovery

The adapter resolves matching receipts before staging or stale-version checks. A request
fingerprint binds actor, operation, subject, action, reviewed revision/generation and exact
artifact digest. A changed logical request conflicts. After private immutable staging, one
SQL transaction checks the current owner/head/generation and commits revision, head,
history, receipt and pending outbox. Same-operation advisory locks and subject row locks
coordinate participating database writers. A retry returns the historical receipt plus
current visibility; an old publish receipt never republishes a withdrawn revision.

Staging is outside the transaction. A staging or definitive transaction failure preserves
the old head. A lost commit acknowledgement is `outcome_unknown`; check/retry the same
operation. Staged objects are deliberately not deleted in an error handler: a commit may
have succeeded. Unreferenced staged objects remain private for a later reference-checked
cleanup procedure. No automatic orphan collector or delivery worker is implemented here.

After a commit, missing/corrupt bytes leave its head and receipt intact. Recover the matching
immutable object and digest; never roll back its receipt or serve the previous head. All
public routes must use this authority gate for each request, including HEAD, downloads,
media/listings and historic deployments. A public bucket, cached positive status or signed
URL cannot substitute. The migration refuses an existing public bucket and adds a
restrictive object policy that blocks browser roles even if another permissive policy exists.

The schema retains owned identifiers and audit records, including references to Auth users.
Hard deletion of referenced Auth users is refused; account exit/retention must preserve
ownership and revocation continuity before any later deletion migration. Group memberships,
company permissions, cross-company grants, private audience readers, admission revocation,
media, notification delivery and restore fencing remain their build-plan workstreams.
Do not route those through this personal-only authority as if they were implemented.

## Validation

Run transport regressions with:

```sh
node --experimental-strip-types --test apps/canopy/src/hostedStore.test.ts
```

For disposable SQL validation, point `FOLIAGE_PGLITE_MODULE` at an existing installed
`@electric-sql/pglite` package, then run `node --test supabase/tests/hosted-publications.mjs`.
This needs no cloud credentials and adds no root dependency. It executes the actual migration,
RPCs, constraints, privileges and RLS in Postgres, with minimal provider-owned auth/storage
tables identified as harness substitutes. PGlite queues calls through one backend; it does
not establish independent-session locking, Supabase Storage behavior, regional durability,
backups, restore continuity or deployed multi-instance withdrawal.

Before hosted acceptance, apply the migration in the isolated intended Supabase environment;
exercise two real authenticated accounts, independent serving instances, actual private object
uploads/reads, role restrictions and object URL denial, fault recovery and post-acknowledgement
withdrawal. Record database and object backup/restore evidence separately. No such live result
is claimed by the local harness.


### Address cap

`migrations/202610090001_address_cap.sql` replaces `foliage_reserve_subject` so one actor
reserves at most 3 addresses. Reservations stay permanent, so withdrawn addresses still count;
an address the actor already owns stays reachable at the cap. The actor row lock serializes
one account's concurrent reservations. The refusal is `foliage_address_limit`, which the store
maps to `address-limit` with the plain message. `MAX_ADDRESSES_PER_ACCOUNT` in
`apps/canopy/src/hostedStore.ts` holds the same number; `hostedStore.test.ts` fails if they differ.

Migrations are applied by hand, not by deploy. Apply this one with the release that contains it.
Either order refuses a fourth address: until it is applied, the app check in `hostedApp.ts` refuses
on its own, but two simultaneous requests can both pass it, so only the database check is
race-free. Applied before that release, the earlier app reports the refusal as a generic
authority failure.

To raise one account's allowance, an operator inserts the requested `foliage_subjects` row
directly. The RPC then serves that address, and the account still cannot reserve new ones.
Disposable check: `node --test supabase/tests/address-cap.mjs` with `FOLIAGE_PGLITE_MODULE`
set as above.

### Selected photos (candidate, provider rehearsal pending)

Apply `migrations/202609300001_selected_photos.sql` after the existing hosted migrations,
on the intended isolated application project. It requires the private publication bucket and
permits bounded JPEG/PNG/GIF renditions there; it does
not create public objects or browser storage access. The application stages every selected
rendition beneath the same account/subject/revision before committing its JSON manifest.
The manifest's artifact digest binds the image set to the existing operation and SQL transaction.
Public image reads always check the current artifact and post-read revision/generation.
See [the photo contract](../docs/PUBLIC-PHOTOS-IMPLEMENTATION.md) for limits and unrun provider cases.
