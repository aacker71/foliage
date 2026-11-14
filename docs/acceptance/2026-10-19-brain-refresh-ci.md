# Linux brain-search gate correction

## Observed failure

After Actions billing capacity was restored, the full Linux checks in runs
[38858141547](https://github.com/aacker71/foliage/actions/runs/38858141547),
[38875158743](https://github.com/aacker71/foliage/actions/runs/38875158743) and
[39101853725](https://github.com/aacker71/foliage/actions/runs/39101853725)
reached the same item-3 assertion. Search correctly returned
`Brain: behind your record, refreshing`; the proof required immediate
`brain keyword` retrieval. Boundary and egress negative controls passed.

The product intentionally bounds the initial refresh wait at ten seconds. Past
that bound it answers from the current Foliage record while the detached refresh
continues. This is documented in unit 38 and covered by local-brain tests. The
offline proof incorrectly treated that permitted result as a failure in items
3, 5 and 6. The parent release branch has no recent green Linux run against which
to establish a first performance regression; the observed issue is a contract
mismatch, not evidence that the product deadline should change.

## Correction

The shared proof accepts either an immediate brain result or the exact healthy
refreshing fallback. It compares the fallback's subject and complete hits to
Foliage's own current-record search, observes lock/drift until completion using
item 5's existing completion bound, and checks the manifest's record hashes
before issuing any follow-up search. A failure note is rejected even when drift
reports false. The follow-up must read the brain without changing the manifest.
Source Leaf and Harvest bytes must remain unchanged throughout.

The proof issues no explicit refresh or repair. Relevant MCP sessions are closed
and awaited before these searches; the earlier server-upkeep proof also stops and
awaits its server before returning. The proof correction changes no product code,
product timeout, retry, skip, release
archive, version or download pin changes.

## Evidence and limits

- The initial regression probe reproduced the old rejection of the documented
  fallback. The focused product/gate suite then passed 60 tests.
- A delayed-writer regression control keeps a stale manifest and lock until its
  original simulated writer finishes. The next search cannot rescue that writer.
- Claude Opus 5.5 identified a false-green route: `brainBehind` can report false
  for a refused/unavailable brain, letting a follow-up repair the failed refresh.
  Three added controls failed before the additional guards and passed afterward:
  false completion, a leftover failure note and a manifest-mutating follow-up.
- All nine final regression tests pass; `pnpm run typecheck:tools` and
  `git diff --check` pass. Fixtures are labelled synthetic gate-protocol inputs,
  not actual user records or real gbrain results.
- The full local `pnpm check` was already running when the review added the
  manifest guards. Its outcome cannot by itself validate those final guards.
  The complete GitHub run for the pushed commit remains the acceptance gate.

This receipt records the state before that GitHub run. Its result belongs to the
exact commit's check suite and PR #220. No merge, deployment or launch acceptance
is claimed here. Parent release branches still need this correction before their
full Linux checks can pass.

## Completed platform checks and runner capacity

Run [39290315739](https://github.com/aacker71/foliage/actions/runs/39290315739)
tested `5927dc6d`. Full macOS CI passed: 3,024 tests, 3,022 passed, zero failed,
two explicit Docker-runtime skips. Its offline proof passed across 362 sandboxed
processes and six controls, with no unexpected network attempts or owner-file
changes. Claude's follow-up review of the final proof returned `NO_FINDINGS`.

Linux exercised the actual delayed fallback in items 3, 5 and 6 and passed every
offline proof available on that platform: 289 sandboxed processes, two controls,
no unexpected attempts or surviving processes, and unchanged records and owner
files. Item 8 remains explicitly not run on Linux. The offline proof ran from
17:02:27 to 17:56:14 UTC, almost 54 minutes. The repository tests then ran until
GitHub canceled the job at its one-hour execution limit at 18:00:14 UTC. No
assertion failure preceded cancellation, but the test suite and website build
did not finish; this is not a full Linux pass.

The old workflow comment explicitly described its 60-minute budget as an
unmeasured guess. The job now has 90 minutes for the measured offline proof,
remaining tests (previously up to 13 minutes), setup and website build. This
changes runner capacity only: all gates, proof bounds, product deadlines and
negative controls remain required. Existing workflow-contract tests pass. A new
complete run is required before merging.

The release parent independently added an item-3 check that the refresh preserves
the existing database inode. That guard is retained here around the shared proof,
matching the reconciliation in #222 without duplicating its wait logic. This
additional assertion requires a fresh complete CI run for the new head.
