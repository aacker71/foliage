# Remaining acceptance for the Radix integration

2026-09-29: #93 is merged at `0bd1d53`; startup/timer and copy corrections are recorded in
[the current handoff](claude-codex-stack-handoff.md). The pending-suggestion maintainer remains
unimplemented. Enterprise/dashboard reskin is separately removable via `39d5dad`.
Post-review `pnpm check` passed: 2,322 tests, zero failures or skips. Current browser
acceptance remains open; these corrections were not deployed.

The earlier Radix checkpoint is `8ebfc3e`; merge `1e450ad` incorporates #90. The gate results below
precede that merge. See [the current stack handoff](claude-codex-stack-handoff.md) for ownership,
the pending queue integration and the superseding journey consent requirements.

Post-copy-merge validation: `pnpm check` passed (2,170 tests, no failures or skips); website
production build/lint and portfolio/workflow/hosting/explore bundles passed. This does not
close browser acceptance or implement the superseding journey contract.

This list applies to the isolated `radix-hosted-release` worktree. It is not a claim that getfoliage.com contains these changes.

## Integrated locally

- Shared Radix/Foliage controls, tokens and workspace shell.
- Hosted Canopy/Clerk page shell, local Workflow, Review navigation and Photosynthesis assistant.
- Existing portfolio text import in the owner UI, CLI and assistant MCP, using one persistence service.
- Compact living portfolio panels with retained leaf animation and presentation inheritance.
- Work page and connected portfolio editor/private preview, retaining all journey claim kinds and history.
- Canopy native publication manager and React Hosting workspace, including exact authored-context preview/digest.
- Scarlet assessment and local hosting connection; failed assessment edits retain submitted content and the stale revision.
- Public Leaf and company readers with quieter controls and retained source/date boundaries.
- Standalone Photosynthesis Review and organization administration use the shared shell; legacy dashboard serves the same Review assets.

## Still owed

1. Inspect and theme the actual Clerk widgets in the signed-in browser. Current shell tests do not establish provider rendering or authenticated account acceptance.
2. Capture current desktop/mobile and populated/empty/error flows. Complete keyboard, reduced-motion, overflow, contrast, edit/import recovery and publication-boundary checks. The owned browser was handed to the user for Vercel login and now reports an unresponsive headed server. Login completion or release of that handoff is still needed before browser recovery and review.
3. Obtain Impeccable's fresh finish-review verdict, apply its bounded fixes, then use its documenter to reconcile DESIGN.md, the design sidecar and UI adoption records with this actual integrated build.
4. Build and deploy the verified candidate, retain source manifest and rollout evidence, and confirm the deployed routes. The protected alias still serves the earlier hosted-foundation deployment. The current local prebuilt candidate passes packaging; production has not been replaced.

The full repository gate and real HTTP checks supplement these tasks; neither is visual or launch acceptance.

Latest local gates: `pnpm check` passed 2,167 tests; Next production build and lint passed; Canopy Vercel packaging passed (251 workspace files, 101 external packages). Exact changed tracked-source hashes are in `radix-integrated-source.manifest.json`. These results do not close the browser and acceptance tasks above.
