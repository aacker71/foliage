# OpenClaw private authoring acceptance — 2026-09-23

Two actual embedded OpenClaw agent turns created and updated one private journey around
an intervening manual correction. This accepts the local host authoring seam, not the
unattended capture/Jev/authoring/publication loop or participant launch acceptance.

## Environment and scope

- Runtime: OpenClaw 2026.8.1 (`ea80657`), installed official Codex plugin, existing configured
  `openai` / `gpt-5.6-sol` model. No model override, delivery flag or global configuration edit.
- Foliage: `codex/launch-completion` at `f1b6b3c`; Node 22 direct source execution.
- Isolated workspace, state directory and garden. A private copy of the host configuration
  replaced only its MCP binding with `foliage.mjs mcp --garden <disposable-garden>
  --allow-achievements`. Normal host configuration and the user's portfolio were not edited.
- Evidence came from actual local Git intake. Selected retained commit:
  `a7e0cf886e9de18684f6b4c758407d49decb43f4`, “Retain private journey revisions and restore owner wording.”
  The test subject and journey explicitly describe an acceptance check; they are not customer
  career evidence or proof of individual authorship or production impact.
- Commands used `agent exec --config … --state-dir … --cwd … --message-file … --timeout 180 --json`.
  Both exited zero. Tool output went to the host's configured cloud model; local execution
  of the MCP writer does not make model inference local. Jev was not called.

## Observed sequence

| Step | Actual operation | Result |
|---|---|---|
| First host turn | Context, `foliage_save_achievement`, fresh context, `foliage_save_statement`, context | One journey, one cited statement; two agent history entries |
| Manual intervention | Existing `savePresentation` with the current revision and `actor: manual` | Corrected wording explicitly says history stays private and the commit alone does not prove individual authorship or production impact |
| Second host turn | Context, `foliage_save_statement`, context | Same journey and claim IDs; changed wording, exact citations retained; previous owner wording preserved |
| Fresh-process inspection | Canonical parser, history and portfolio/résumé renderers | Four edits, newest first: agent/manual/agent/agent; current words present in the journey, live résumé and Markdown résumé |

First-turn session: `1ac63297-34a3-4545-94b0-6d396fde824f`.
Second-turn session: `9f3d4a64-ac57-4232-9d73-cc0c333eac3d`.
Journey: `df9cb34b-40f5-4670-a605-8936915a8951`.
Statement: `bd39ffe3-aab9-475f-85b7-6dd910736a6c`.
Final document: `sha256:af5d533c28f3ac5618db8961f949f5358b116ba33a76e35d783dfebbb5b936aa`.
Verified at `2026-09-24T05:00:02.924Z` (September 23 in the owner's timezone).

The first agent made two invalid context selections before recovering. Both were refused;
the receipts were not hidden or counted as successful reads. It subsequently selected the
source as a Leaflet and used fresh revisions for both writes. The second turn made three
successful MCP calls with zero failures. Recorded MCP invocations were confined to the three
Foliage tools above; all three successful write receipts say `published: false`.

## Evidence and limits

Actual `McpToolCall` events and saved canonical bytes were checked, rather than trusting the
agent's final answer. The second write's input revision matches the manual correction's
saved revision, and its result revision matches the final file. History stores the manual
correction before the second agent's replacement. No duplicate journey or claim was created.

Private run material is at
`/var/folders/_4/lysxv8f56wd7ymztkvjh4btc0000gn/T/foliage-openclaw-write-c6zy3ztt/`:
`first.log`, `second.log`, `owner-correction.json`, `verified.json`, and actual Codex session
events beneath `state/agents/main/agent/codex-home/sessions/`. Temporary logs are local
diagnostics, not a production audit store; this report retains their bounded result.

Outstanding: automatic source/Jev orchestration, saved pool transfer grants and revocation,
durable decision receipts, actual Photosynthesis/Scarlet caller integration, installation
and upgrade recovery on a fresh machine, hosted acceptance, email delivery, and real
participant/reader cycles. No scheduler, cloud Scarlet, publication or email was exercised.

Restart-safe undo, stale writes and unavailable-citation refusal were already covered by
the separate [journey history implementation](../../context/progress-tracker.md#recoverable-journey-revisions--2026-09-23).
This run adds real host mutation evidence; it does not rerun or replace those checks.
