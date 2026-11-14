# Enterprise release storage

The single-host Enterprise app commits each release transition and its pending event in
one versioned document. It no longer turns unreadable or invalid release history into an
empty store. This is a local filesystem adapter, not the hosted multi-instance database.

## Location and existing data

`FOLIAGE_RELEASE` selects an explicit path. The default for a new installation is
`~/.foliage/enterprise/release.json`, outside the temporary directory. Paths are not
automatically moved or rewritten at startup.

If `/tmp/foliage-release.json` exists and no explicit path was selected, startup refuses
to silently switch to an empty durable directory. Stop all writers, preserve a backup,
inspect that legacy file, and deliberately move it to the permanent location or set
`FOLIAGE_RELEASE` to the intended existing file. When both locations exist, select the
intended one explicitly after inspection. Continuing to select `/tmp` retains that
directory's cleanup risk. A filesystem permission error remains an error.

Valid legacy maps are read without rewriting bytes. The next successful transition
preserves their histories and writes the versioned envelope. It adds only the event for
that new transition; historical notifications are not invented. Refused operations do
not migrate data. Stop old application versions before migration: their old overwrite
API does not understand the envelope or preserve its pending events.

## One commit and a repeatable operation

```text
Protected POST with operation ID + reviewed history length
  --> canonicalize directory aliases + test existing ancestor sync capability
  --> acquire shared document lock
  --> read and validate current release document
  --> existing operation?
       matching request: return original event, separately retain current state
       different request: refuse identifier reuse
  --> reviewed history still current?
  --> apply release transition
  --> approve/publish: reviewed contents digest equals the leaf's current one?
  --> publish: and equals the digest its approval recorded?
  --> append history + pending event in one document
  --> write private temporary file + fsync
  --> atomic rename + fsync complete canonical directory ancestry
  --> acknowledge saved outcome
```

The envelope contains `format`, `version`, `releases` and `outbox`. Each new event has a
stable event ID and operation ID, `enterprise.release.changed` kind, leaf ID, transition,
recorded actor role, timestamp, history index and `pending` status. It contains no email
addresses, phone numbers, recipients or portfolio body. An event must correspond exactly
to its history entry, and event, operation and transition identities cannot be duplicated.

This event states that release policy state changed. In particular, a recorded `live`
transition is not a successful public-publisher receipt. The current server does not
invoke that publisher. The recorded actor role is also not authenticated identity;
hosted identity and the accepted D7 actor changes remain separate work.

The server renders hidden operation IDs and history versions into existing forms. Reusing
the same operation and logical input returns the original event without another write,
even after later transitions. A changed actor, leaf, event or reviewed version conflicts.
Server retry time does not rewrite the original timestamp. A stale form with a new
operation ID is refused. Missing operation fields require refreshing the review.

Approve and Publish forms also carry the `releaseContentsDigest` of the records the review
listed. The server recomputes it from the leaf as it is now; a missing digest is refused and
a different one is refused as a conflict, so a decision never covers records its reviewer was
not shown. The accepted history entry records that digest as `contents`; entries written
before this field existed have none. Other events carry no digest. Publish must also match
the digest on the approval it follows, whoever publishes, so it never releases records the
policy owner did not approve; once they differ the approved card says so and offers Retract
instead. An approval with no recorded digest has nothing to hold Publish to.

`saveStore` is now initialization/import only and refuses an existing target.
`commitRelease` owns the entire read, validation and write transaction. Callers must not
restore the old load/modify/save sequence. The lock comes from the existing open
`@foliage/leaf/local-files` helper; all event and storage code stays in Enterprise.

## Recovery

- **Damaged data:** preserve the original bytes. JSON, schema, history-chain and event
  correspondence failures block reads/mutations rather than resetting state. Restore or
  repair a known source under controlled access. Only an absent path starts empty.
- **Busy:** another participating process holds the document lock. Retry the complete
  request after it finishes. HTTP reports a conflict rather than overwriting its work.
- **Unsupported location:** every canonical ancestor must permit directory opening and
  sync. The capability check runs before creating parents, a lock or release bytes. Choose
  a supported location if this fails; a writable folder beneath an unreadable ancestor
  is not supported by this adapter.
- **Process death:** inspect the specific `.local-lock` and its owner before deliberately
  removing it. No automatic expiry or stealing occurs. A restart reads the complete old
  document or the complete new document, then reuses the original operation ID.
- **Write failed before rename:** the previous release state and outbox remain unchanged.
  A leftover temporary file is not a committed document.
- **Sync failed after rename:** bytes may already be committed; the error names that
  uncertainty. Retry the same operation, not a new action. Replay syncs the complete
  canonical ancestry through the filesystem root before acknowledging the existing receipt.
  It does not shorten the chain just because an earlier attempt created directories.
- **Lock cleanup failed after a durable commit:** show that the decision was saved and
  cleanup needs attention. Do not label it a failed transition or encourage a new operation.

No pending event is removed or marked delivered by this change. The eventual worker must
perform current grant, recipient and channel checks before Novu delivery. Provider
acceptance, actual delivery, cancellation and unknown acknowledgements remain distinct.

## Limits and evidence

This adapter coordinates participating processes on one supported local filesystem.
Manual editors and old writers that ignore the lock are outside that protocol. File and
directory sync requests rely on the filesystem honoring them; tests inject process death
and I/O faults, not physical power loss. Network/shared-host storage and database-backed
multi-instance authority require their own adapter and evidence.

Directory aliases are resolved before the transaction; the canonical target is used for
locking, reading, replacement and syncing. Directory aliases and mounts must remain stable
during an operation. File symlinks and hardlinks are refused by the shared lock helper.
The complete directory chain is deliberately synced on every acknowledgement, including
replay: interrupted attempts can leave new directory entries even before an envelope exists.

The local document is limited to 32 MiB and is validated as a whole. At the limit, further
writes refuse while preserving existing bytes. There is no silent pruning of histories,
operation receipts or pending events. Growth, retention and delivered-event compaction
belong to the later delivery/storage design.

Regression evidence is in `apps/enterprise/src/releasePersistence.test.ts`,
`releasePath.test.ts`, `release.test.ts` and `shell.test.ts`: real process contention and
SIGKILL around rename, strict legacy migration, directory-sync uncertainty, matching retry,
stale/conflicting requests, corruption preservation, path migration refusal, and actual
HTTP POST/read behavior. The test inputs are harness data, not customer portfolios.

Full `pnpm check` passed on this implementation checkout with 1,632 tests, no failures or
skips. This does not establish customer usability, hosted durability, Novu delivery or
deployment. The wider portfolio-scale engineering review remains in progress.
