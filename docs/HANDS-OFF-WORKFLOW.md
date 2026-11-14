# Hands-off Foliage workflow

## The useful moment

The user connects authorized sources once, declares identity and purpose, then returns when Foliage has something worth using. The output should be a small, evidence-backed packet: what changed, why it matters to the declared purpose, and a proposed artifact or next action. A large task inbox is not the desired experience.

Collection and private drafting can be unattended. Review decisions and external publication remain distinct. Rejected drafts must stay rejected, duplicate evidence must not create duplicate prompts, source failures must retain their causes, and a repeated job must not overwrite existing decisions.

## Working rehearsal

`pnpm review:brief --repo <authorized repository> --state <private directory> --identity <declared email>` gathers new committed evidence for exactly matching author emails. It saves a private JSON brief and checkpoint, caps the displayed evidence with an explicit omitted count, prevents overlapping runs, and produces an unchanged result for an already-read revision. It never runs intake, overwrites a portfolio, approves, promotes or publishes. Rewritten history or changed configuration requires investigation rather than a silent reset.

The installed copy is `~/.local/share/foliage/workflow/review-brief.mjs`; state and reports live in the adjacent `state` directory. Source is `tools/launch/review-brief.mjs`. Update the installed copy when changing the source. This is a local repository rehearsal with an author email from repository metadata, not an authenticated claim about a person.

The Codex heartbeat named **Foliage background workflow** is **paused** following the owner's correction on 2026-09-05. The required schedule belongs inside the customer application. The collector remains a manual engineering rehearsal; it is not a shipped app scheduler.

Open Design project `foliage-quiet-workflows-e05d` contains the interactive application UI for Overview, Sources, Workflow and Review. Saved browser preferences must not imply that background collection is active. Runtime scheduling, authorized source reads, durable proposals and delivery remain integration work until verified end to end.

## Simulated review, 2026-09-05

A fresh isolated garden at `/private/tmp/foliage-simulated-review` was produced from real repository history. Subject label explicitly says simulated review of repository author metadata. It contained 278 source leaflets and 45 candidates at intake. No invented customer profile or evidence was seeded.

In BrowserClaw at http://127.0.0.1:4196/review, Codex acted as **Simulated reviewer — Codex**:

- Rejected the WIP cluster with a reason: its commit summaries are not a useful outward portfolio claim.
- Edited and approved the website cluster as “Built a Foliage website and five interactive application prototypes.” The title refers to source work actually inspected in this session.
- Left the other candidates undecided. No promotion or publication occurred.

The review records persisted with the simulation label. This is a workflow exercise, not evidence of human satisfaction or non-owner customer acceptance.

## Findings and remaining product work

The current queue exposes too much at once: 45 candidates and repeated evidence blocks. The scheduled collector provides bounded raw material, but meaningful grouping, purpose-aware drafting and a polished review packet remain to be implemented in the app. Do not label this experience finished or claim it delights customers yet.

Next delivery: ask once for the user's actual purpose (portfolio refresh, board introduction, opportunity or periodic reflection); maintain that preference; gather incrementally; draft at most three useful proposals with evidence links; preserve approve/edit/dismiss/snooze history; and surface a ready artifact when requested. Triggering from external calendar or opportunity events requires a connected and authorized source. Never invent urgency.

Product scheduler acceptance must cover restart/recovery, time zones, quiet hours, pause/resume, source removal, unchanged runs, failed reads, deduplicated delivery, decision preservation, cost limits and explicit publication. A real user still needs to judge usefulness.

## Open Design UI review, 2026-09-05

[Local preview](http://127.0.0.1:60861/api/projects/foliage-quiet-workflows-e05d/raw/foliage-workspace.html) (address lasts for the current Open Design daemon session). Project source is in Open Design, separate from the application runtime. The React source imports shadcn-derived Button, Input, Label and Radix Tabs, plus Magic UI BlurFade and the Foliage token package. No customer account is populated by the optional repository-evidence walkthrough.

Independent BrowserClaw inspection checked desktop workflow at 1440px, mobile overview/review at 375px and Sources at 768px. Viewports were changed through page-scoped device emulation and read back, rather than inferred from screenshot dimensions. The checked layouts had no horizontal overflow. Weekly preference survived a reload; mobile navigation opened and closed; review wording could be edited and snoozed with an honest simulation receipt; a web URL was rejected as a local repository path. These checks do not establish runtime scheduling or customer usefulness.

Open Design reported 36 passing interaction checks and 23 static checks. Its automated viewport report was incomplete, so that report must not be represented as full browser acceptance. Production integration still requires the scheduler acceptance above, including durable recovery and preservation of decisions.

## Connected local workflow

The reviewed UI is now implemented at **`/workflow` in the local Leaf app**. It uses the new open-plane `@foliage/ui` package; the website re-exports the same shadcn Button/Input/Label/Tabs and Magic UI BlurFade components. Tokens and fonts are still resolved from `@foliage/tokens`. The browser bundle has an explicit build; the Node TypeScript runtime and test pipeline still run directly without server compilation.

Run from this checkout:

```sh
pnpm install
pnpm --filter @foliage/leaf-app workflow:build
node foliage.mjs up
```

Open `/workflow` on the printed local address. `foliage up` supplies a private `workflow` directory under the selected garden. Direct server users set `FOLIAGE_WORKFLOW_DIR` explicitly. The workflow fails visibly if its state is malformed, another process owns that directory, or the UI bundle has not been built. It accepts only loopback Host values and same-origin JSON writes; public documents retain their previous script restrictions.

Connect a repository root and explicitly authorize an exact author email. Save daily/weekly cadence, timezone and quiet hours. Collection runs inside the application process every 30 seconds to check the persisted due window. Closing the browser does not stop it; stopping the server does. One overdue read catches up on restart outside quiet hours. Quiet hours hold scheduled and catch-up runs only; Collect now runs when the owner asks. Pausing prevents collection; resuming permits one catch-up. A failed source receives two bounded retries before the next regular window. Successful source checkpoints, source failures and private decisions persist together. No network collection or model invocation is involved.

Review packets contain actual commit references and messages, with at most three packets visible and three commits initially expanded per packet. They are deterministic evidence packets, not purpose-aware generated portfolio claims. Exact email matching does not verify authorship. Edit/save-private-draft, dismiss and one-day snooze persist across reloads and restarts. Decisions do not write the existing harvest, approve authorship, promote or publish. Existing harvest review remains linked separately.

Live validation used this repository's real history in an isolated state directory at `/private/tmp/foliage-workflow-live`. The operator explicitly selected the repository author email, collected one bounded packet, edited and saved a private draft, then reloaded and inspected that saved decision on a 375px viewport. No account was seeded and no publication occurred. Source paths and email remain local. Browser resource inspection found no external requests. Application usefulness for a real customer, richer source connectors, purpose-aware proposals and publication handoff still require further work.

Verification: the full repository gate passed 1,603 tests with no failures or skips. The website production build passed after extracting the shared controls. Dedicated workflow checks cover calendar/DST boundaries, quiet-hour refusal, real Git collection, deduplication and preserved decisions, source failures, malformed state, one overdue catch-up, interrupted-run recovery and HTTP origin/Host restrictions. The separate live local server was restarted with its existing private state before final browser inspection.
