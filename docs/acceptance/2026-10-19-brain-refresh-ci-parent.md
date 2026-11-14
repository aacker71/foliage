# Parent release brain-search CI correction

This branch starts at `release/0.3.0-rc@85661512` and isolates the test correction
from #220's `5927dc6d`. It carries no source/media feature integration and changes
no release archive, version, download pin or runtime code.

After billing capacity was restored, Linux runs 38858141547, 38875158743 and
39101853725 failed the same item-3 assertion: search returned the documented
`Brain: behind your record, refreshing` fallback, while the proof required
immediate brain retrieval. The ten-second product bound deliberately allows
current-record search results while the detached refresh continues.

The shared proof now compares that fallback with Foliage's own current-record
search, observes the existing writer with the existing completion bound, verifies
the manifest hashes against the original Leaf and Harvest bytes, rejects failure
notes, and requires a subsequent brain read that changes neither the manifest
nor the source record. It never issues a repair or explicit refresh.

The synthetic fixture imports this branch's `KEYWORD_MODE` rather than copying
the follow-on branch's newer wording. Protocol fixtures are not user records or
real gbrain results. Later parent reconciliation also moves database identity
and final lock checks into the shared helper, covering all three callers.

Claude Opus 5.5 reviewed the original correction, exposed false-completion and
repair-by-follow-up gaps, and returned `NO_FINDINGS` after their fixes. The three
controls for those gaps failed before the guards and passed afterward. That
review is evidence about the shared proof; this parent still requires its own
complete check suite before merging. The original source assertion and the
parent applicability were checked directly, not inferred from a cherry-pick.

Local parent validation: the pinned runtime was copied from the existing staged
checkout and independently verified with `stage-gbrain.mjs --restage`. Then all
63 focused local-brain, offline-gate and new proof tests passed, along with tools
typecheck, architecture coverage/link checks and `git diff --check`. The initial
focused run in the fresh checkout had one existing test failure because the
runtime was not yet staged; staging corrected that prerequisite without changing
the product or its tests.

The shared proof now also has real Linux evidence from #220 at `5927dc6d`:
[run 39290315739](https://github.com/aacker71/foliage/actions/runs/39290315739)
passed all available offline phases, including actual delayed fallbacks in items
3, 5 and 6, across 289 sandboxed processes with no unexpected network attempts.
That proof consumed nearly 54 minutes; the one-hour job budget then canceled the
remaining repository tests. The full macOS check passed on that commit. Neither
result substitutes for complete parent CI.

While CI ran, the parent advanced to `94153ecc`, incorporating an independent
item-3 correction and the public agent reader integration. The merge retains the
independent correction's database-inode assertion and explanatory context while
using the shared proof for all three refresh cases. This avoids duplicate wait
logic and preserves the stronger manifest, source-byte and failure-note guards.
The original parent correction at `e8a7e315` also passed its full macOS job in
run `39294401121`; the reconciled head still requires its own complete CI.

Both branches now allow 90 minutes for the Linux job, replacing a timeout that
the workflow itself called an unmeasured guess. No product deadline, test/proof
bound, negative control, gate or command is removed or widened. Existing
workflow-contract tests pass. The superseded one-hour run is not a full pass.

Full CI status belongs to this branch's exact commit and PR checks. A passing
source/media follow-on does not by itself accept the older parent. No merge,
deployment or full-launch acceptance is claimed by this receipt.

## Reconciliation with the later parent

The parent then advanced to `a776f2d7`, consolidating its own three call sites and
setting the same 90-minute job budget. This merge uses one helper, retaining its
database-inode and final-lock checks along with our result, manifest, failure-note
and source-byte checks. The two new regression controls failed before centralizing
those guards: database replacement during either search, and a follow-up leaving
a writer lock. This is synthetic proof-protocol testing, not real gbrain evidence.

The previous #222 run `39300182351` passed all available Linux offline phases at
19:25:16 UTC after about 74 minutes, across 289 sandboxed processes and two controls.
It was still passing repository tests when GitHub canceled it at the 90-minute
job limit. It is not a full pass. The current parent `a776f2d7` subsequently passed
full CI in run `39320661235`, while #220 passed full CI and merged into
`release/0.3.1-fixes` as `94c203bf`. The execution budget remains 90 minutes.
Fresh full CI is required for this reconciled #222 head.

After reconciliation, all 30 focused proof, offline-harness and workflow tests
passed with no skips, alongside tools typecheck, architecture/link validation
and `git diff --check`. Both new negative controls pass after their red run.
