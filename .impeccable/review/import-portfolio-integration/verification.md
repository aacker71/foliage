# Portfolio import and reading-layout integration

Implementation: `~/.codex/worktrees/radix-hosted-release/foliage`.

## Changes

- `/leaf/import` uses the shared private workspace shell and controls. It accepts a local text/Markdown file or pasted writing, shows a section preview, and adds the exact previewed text to private review. A hidden digest refuses an altered submission; the preview also binds confirmation to the selected Leaf identity. Original source text is retained; no URL is fetched and no claim is verified or published.
- CLI: `pnpm --filter @foliage/leaf-app import:portfolio --input portfolio.md --title "My portfolio"` previews. Adding `--import --into <leaf.json> --out <harvest.json>` persists explicitly selected text.
- Assistant MCP: `foliage_import_portfolio` previews without writing. Supplying its exact `confirmDigest` imports through the same persistence service. The selected Leaf identity is checked on every call.
- Shared navigation and the owner portfolio's tools expose the import flow. Existing authoring, history, source permissions and publication routes remain available.
- Portfolio records no longer reserve viewport-height gaps. Wide branching layouts pair work panels around the animated stem. Narrow screens and the WebGL fallback retain readable content. Selection persists through programmatic scroll and resumes following the reader on manual movement.
- The compact identity and work typography have been folded into their component declarations instead of retaining the older append-only override blocks. Current collection/Leaflet style inheritance, media framing and history behavior were retained.
- The existing form editor now places its outline beside the writing. Its revision checks and backend operations were retained.

## Evidence and limits

- 28 focused service, MCP and HTTP tests passed, including changed-digest refusal, cross-origin refusal, repeat import, retained decisions and unchanged Leaf bytes.
- The HTTP import check uses a separate, correctly bound harvest destination. The service correctly refused an existing harvest with incomplete/different subject binding during development; that guard was retained.
- Workflow and portfolio browser bundles rebuilt. New browser asset is declared as an entry in `knip.jsonc`.
- One Impeccable detector run across the five import/portfolio UI targets returned `[]`. No second detector run.
- Updated local server: `http://127.0.0.1:4420`, PID 76017 after the identity-binding restart, cwd verified as the isolated integration worktree. Import, its assets, portfolio, authoring, Workflow and Photosynthesis responded 200. These HTTP results do not establish visual or interaction acceptance.
- Full repository gate passed: 2164 tests, zero failures, `/tmp/foliage-release-import-portfolio-check.log`. The final identity-binding change also passed its focused real HTTP test and Leaf typecheck (`/tmp/foliage-release-import-binding.log`, `/tmp/foliage-release-import-final-types.log`).
- The restarted local runtime successfully previewed the actual `docs/UI-FOUNDATION.md`, including the confirmation digest and selected Leaf identity. Preview only; no additional import or publication was performed. HTML capture: `/tmp/foliage-release-import-preview.html`.
- Current integrated screenshots, finish-review verdict and documentation handoff remain pending. The review browser is handed to the owner for protected Vercel sign-in. Older reviewed screenshots are not evidence for this integrated revision.
- No new deployment or production promotion was performed in this slice. The protected preview remains the earlier hosted-foundation candidate recorded in `docs/execution/radix-hosted-preview-2026-09-28.md`.
