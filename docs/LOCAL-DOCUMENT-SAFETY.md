# Local document safety and recovery

Local refresh, review and promotion preserve existing bytes when a prior document cannot be
read or validated. Only a missing file starts a new document. Slow source/model work happens
before locking; the prior document is read again under the lock before changes are merged.

`@foliage/leaf/local-files` provides the Node-only coordination shared by Leaf intake, harvest
producers and decisions, sharing, policy edits, both review servers, Photosynthesis refresh and
promotion, and confirmed Canopy publication. The pure domain export remains independent of
Node filesystems and of cloud/enterprise packages.

Writers acquire adjacent `.local-lock` files in canonical path order using exclusive creation.
Parent directory aliases share a lock; file symlinks and hardlinks are refused. A contender
fails immediately and retries the entire operation later. Each lock records its owner's pid,
computer name and start time. On the command line (`foliage grow`, intake, harvest) and in the
server 409 replies that pass the error text through, the busy message says, by file name only,
whether a live process holds the lock or its pid is not running on this computer, and names the
one file to clear. Locks are
never stolen or expired automatically. Cleanup checks ownership and reports cleanup failures alongside
the original failure. Newly created empty directories are removed on refusal; directories
containing saved data remain.

Not every surface shows that detail yet. A decision on the Leaf browser review page still says
only "Document busy. Your text is kept below; retry." with no owner and no file to clear, even
after a crash; passing the refusal through `apps/leaf/server.mjs` is a separate follow-up. The
assistant tools and the background collector keep their own generic busy handling.

Under the lock, writers read, validate and publish a fully written temporary file from the same
directory. Replacement uses rename; first creation uses an exclusive hard link so an existing
file cannot be overwritten. Both keep partial bytes away from the document path. The publisher
retains its separate public-artifact lock and digest comparison and holds source/policy locks
through the confirmed write.

## Recovering a refused operation

- **Busy:** wait for the named operation to finish and retry. After a crash the command-line
  message says the owner's pid is not running on this computer and names its lock file; check
  that nothing else is writing the document, then remove only that file. The browser review
  page does not name it yet; a review decision locks `harvest.json`, so its lock is
  `harvest.json.local-lock` beside it, and the same check applies before removing it. A PID
  alone is not proof that an operation is dead (another computer, a reused pid); do not
  bulk-delete locks.
- **Damaged or unreadable prior data:** preserve the file, repair access or restore a known good
  copy, then retry. Refresh refuses it rather than silently treating it as empty.
- **Changed review draft:** the launcher and rendered review forms bind decisions to the
  candidate shown. A changed candidate is refused. The Leaf review page keeps entered text on
  busy/stale responses so the person can inspect the current draft before resubmitting.
- **Partial grow:** damaged prior harvest data is refused before intake. Intake and drafting are separate stages. A drafting failure reports that
  intake already completed and leaves existing harvest bytes intact.
- **Changed replacement:** interactive replacement permission binds both the approved candidate
  body and the existing leaf, including its sharing settings. Promotion rechecks both under
  the document locks and refuses a changed snapshot; review the current work again.
- **Saved approval, failed promotion:** repair the target and use the printed `review --resume`
  command with the same garden. It reuses saved approvals and refuses duplicate leaflets.
  The separate Photosynthesis app similarly reports when the leaf exists but harvest marking
  failed; retrying promotion repairs marks without adding duplicate leaflets.

## Limits and evidence

This protocol coordinates participating local writers. Manual editors and other programs that
ignore the locks are outside it. It is not a multi-file rollback transaction or a power-loss
durability guarantee: a killed process can leave a lock or temporary file, and no fsync-based
hosted-storage contract is claimed. Legacy direct decision callers can deliberately operate on
the current candidate id without supplying a snapshot digest; the launcher and rendered forms
always supply one.

`packages/leaf/src/localFiles.test.ts` covers independent process contention, stale locks,
normal exit cleanup, file aliases, failed writes, and combined operation/cleanup failures.
`packages/leaf/src/staleDocumentLock.test.ts` covers the owner record and the refusal wording
for live, another user's live, stopped, older-format, other-computer and ownerless locks.
`apps/leaf/src/growStaleLock.seam.test.ts` runs `foliage grow` into a crashed lock and a live
one and checks each refusal is one line with no stack.
`apps/leaf/src/localWrites.seam.test.ts` uses real temporary Git histories and actual CLIs to
exercise corrupt refresh, competing decisions, saved-decision recovery, duplicate-safe retry,
live review HTTP conflicts, interrupted first publication and source/policy changes during
confirmed publication. These are engineering regression cases, not customer acceptance or
visual browser evidence. Integration, non-owner use, and hosted launch gates remain separate.
