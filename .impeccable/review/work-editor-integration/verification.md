# Work and connected editor integration

Implementation: `~/.codex/worktrees/radix-hosted-release/foliage`.

- Work (`/leaf/photosynthesis`) leads with real saved accounts, retained proposals and harvest drafts. Native search and All/Saved/Draft filters preserve the query. Evidence images come only from resolved citations. Missing source documents remain visibly unavailable.
- Shared local navigation points to Work, Portfolio and Workflow, with import, review and other tools in the secondary menu. The Sources compatibility route redirects to the existing Workflow Sources section.
- `/leaf/setup` connects the writing outline, claim editor, introduction and private reader preview to the current canonical save operation. All current claim kinds, revision checks and history remain intact. No additional store or publication authority was introduced.
- Only the private reader preview permits same-origin framing; published documents continue refusing framing. New private routes refuse foreign hosts before document reads. Form mutations require the existing same-origin checks.
- The initial full gate found a test client problem: fetch did not transmit the supplied foreign Host header. The check now uses node:http and exercises the actual refusal. The focused real-server suite passes: 10 tests, `/tmp/foliage-release-work-editor-final-tests.log`.
- Leaf typecheck and Workflow bundle build passed. One detector run on this slice returned no findings.
- Local runtime restarted at http://127.0.0.1:4420, PID 71276, verified cwd in the integration worktree. Work, editor, editor state, private preview, import and Workflow returned HTTP 200. Uses the isolated owner-derived garden; no publication performed.
- Current visual captures, independent finish verdict and documentation handoff remain pending. HTTP results and older screenshots do not establish current visual acceptance.

Full integration gate passed: `pnpm check`, 2166 tests, zero failures. Log: `/tmp/foliage-release-canopy-work-check.log`. `git diff --check` also passed. This is code/integration evidence; visual and deployed acceptance remain pending.
