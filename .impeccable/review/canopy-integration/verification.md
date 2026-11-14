# Canopy publication workspace integration

Implementation: `~/.codex/worktrees/radix-hosted-release/foliage`.

- Native publication manager and React Hosting workspace use the shared Foliage rail and token roles. Radix Tabs and shared controls own interaction styling; local CSS owns composition.
- Publication content appears before diagnostics. The native layout places the release decision beside its preview on wide screens and below it on narrow screens. Replacement consequences stay visible next to confirmation.
- Workspace state now includes the existing authored-context digest and serialized preview. The UI preserves the includePortfolio selection during refresh and sends that digest through the existing guarded publication action. No publication format, storage, identity or CSRF rules changed.
- Newer Clerk and onboarding CSS retained while replacing the older manager composition. Public-link underlines removed. The one detector pass reported a 6px decorative boundary stripe; the stripe was removed, retaining the explicit boundary label and normal border. No second detector run.
- Canopy typecheck and browser bundle build passed. Focused manager render and real-server checks passed: 10 tests, `/tmp/foliage-release-canopy-tests.log`. Checks include the authored-context preview/digest and shared stylesheet endpoint.
- Local manager http://127.0.0.1:4421, PID 53481, verified cwd. Manager, workspace, state and four asset routes returned HTTP 200. State reports ready with authored context, digest and preview. No publication submitted.
- Full repository gate is tracked in `/tmp/foliage-release-canopy-work-check.log`.
- Visual acceptance is pending. The owned review browser remains handed to the user for Vercel login; no navigation or takeover occurred. No current desktop/mobile screenshots or finish-review verdict exist for this integration.
- No deployment in this slice. The protected hosted preview still contains only the earlier hosted foundation; getfoliage.com was not changed.

Full integration gate passed: `pnpm check`, 2166 tests, zero failures. Log: `/tmp/foliage-release-canopy-work-check.log`. `git diff --check` also passed. This is code/integration evidence; visual and deployed acceptance remain pending.
