# Radix hosted integration preview

Preview: https://foliage-radix-review.example.invalid/auth/sign-in

Deployment: `dpl_DSa719DmFywM9mrcBjJihacHLpKx` (READY).
Immutable URL: https://foliage-canopy-q0jy2n4uy.example.invalid

Built in isolated worktree `radix-hosted-release` from `1db3f7c` plus uncommitted shared UI and hosted presentation changes. The adjacent manifest records source hashes. This is a protected review candidate, not production. Neither the prior preview nor getfoliage.com was replaced.

## Evidence

- Full `pnpm check`: 2,159 passed, zero failed. Log: `/tmp/foliage-release-foundation-check.log`.
- Focused runtime/packaging regressions: 13 passed. The optional compound renderer needed building in the fresh checkout; the journey maintenance test now expects escaped Markdown.
- Hosted/Clerk targeted tests: 47 passed. Existing hostname, identity, CSRF, storage and publication authority retained.
- Prebuilt artifact: 240 workspace files, 101 external packages.
- Authenticated Vercel CLI read of deployed sign-in: HTTP 200, new heading, all six expected stylesheet links.
- Impeccable detector on the three hosted presentation targets: no findings.

## Pending acceptance

Vercel browser login is pending; the review browser was handed to the owner. Clerk rendering, authenticated pages, desktop/mobile captures, the hosted Impeccable finish review, and real account flows are not yet accepted. HTTP reads and tests are not visual or provider acceptance.

The separate populated local Work/reader/editor review shipped at its captured scope in the primary workspace's `.impeccable/review/populated-flows/finish-review.md`. That verdict does not cover this hosted composition.

## Local integration boundary

A read-only three-way patch check against the reviewed local UI found conflicts in the server, renderer, portfolio presentation, workflow and assistant integration. No patch was applied. The newer base has renamed local Ladybug files to Scarlet and added permitted journey updates; reintroducing the old files or copying the older server would regress that work. Reconcile presentation against the current contracts in bounded slices. The detailed check is `/tmp/foliage-local-ui-integration-check.log`; the candidate patch is `/tmp/foliage-local-ui-integration.patch`.
