# The three-pass review — every product PR, three lenses, all must approve

Pass order is parallel; merge arms only when all three verdicts are APPROVE. A needs-fix goes
back to the developer; the failing pass re-runs on the new diff (all three re-run only if the
diff changed materially). Docs-only PRs: CI alone. Owner-taste PRs (copy, design): owner + pass 3.

## Pass 1 — ADVERSARIAL CORRECTNESS (refute-first)
Default: the change is wrong; prove it. Mutation-test the diff's central claim in an isolated
worktree (revert the fix → its test must fail; force its guard open → some test must fail).
Weakened/deleted/conditionalized assertions. Overclaiming commit messages. Re-derive any
measured number in the PR from source (hex → ratio, counts → recount).

## Pass 2 — SEAMS AND DEPENDENCIES (blast radius, enumerated)
Enumerate every changed/added/removed EXPORT and SYMBOL, then enumerate every consumer:
`gbrain code-refs <symbol> --quiet` + grep; graphify `get_pr_impact` when a graph exists.
For each seam: caller still correct? env/config seams (new env vars, flags, paths) traced to
every reader. Cross-plane: check:boundary rationale, not just the gate. Schema edits: BOTH
enterprise keysOf maps + parser + merge rule move together (the tripwire fires by design).
Concurrent writers on any touched file path. Union members: every switch handling the changed
type is exhaustive (`never`). Two implementations of one domain rule token-match nothing — hunt
reimplementations by RULE, not by text; the dup gate cannot see them.

## Pass 3 — SCOPE COMPLETENESS AND LAW
The task's DONE criteria vs the diff: everything in scope present, nothing beyond scope smuggled.
Controls untouched (band, no-score, boundary). FINDINGS/ledger edits honest (state flips match
tests that exist). The objective function: which axis does this serve — fidelity, legibility,
signal, noise — and does it? DELETE check: what did this change make deletable that remains?
Docs the diff makes stale.

Verdict format per pass: APPROVE or NEEDS-FIX with file:line findings. The synthesizer merges
verdicts; ANY needs-fix blocks. Cost accepted by owner directive 2026-08-29: three Sonnet
reviews per product PR.
