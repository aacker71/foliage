# Workflow and private shell integration

Implementation: `~/.codex/worktrees/radix-hosted-release/foliage`.

- Workflow navigation uses shared WorkspaceHeader and Radix Tabs, retaining URL view/deep-link state and proposal selection. The populated overview now leads with a real review/saved draft when present.
- Shared controls and workspace.css own chrome and controls. The 299-line legacy runtime stylesheet has been retired from the bundle; layout.css owns content composition.
- Private server-rendered surfaces opt into the shared rail only when an owner navigation key and night face are both present. Public and standalone leaflet pages retain their existing audience boundary.
- Existing Scarlet route names, journey maintenance and undo, source permissions and publication behavior are retained.
- Focused renderer/navigation/real-server checks: 133 passed before the mechanical border correction; Leaf typecheck and workflow browser bundle passed.
- Impeccable detector ran once. Three existing thick side borders were reported and replaced with neutral complete borders or a single-pixel rule; adjacent story error border was normalized in the same correction batch. No second detector run.

Local review server: http://127.0.0.1:4420/workflow (initial PID 42963; replaced by PID 76017 after later integration). It reads the existing isolated real repository garden; no generated work or public publication is introduced. No model is configured. Workflow/private-shell gate passed 2159 tests in `/tmp/foliage-release-workflow-review-check.log`. Subsequent Photosynthesis integration also passed 2159 tests in `/tmp/foliage-release-integrated-private-check.log`. Later import/portfolio changes have their own verification record.

Browser captures and finish review are pending while the single review browser is handed to the owner for protected Vercel sign-in. This document is implementation evidence, not visual acceptance.
