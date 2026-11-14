# Photosynthesis capture and review

Package: `@foliage/photosynthesis-app` · Plane: `open` · Application: `apps/photosynthesis`.

## Status

Present: the integrated local collector and one review queue at Leaf /review. The earlier
standalone capture and review pair remains for legacy documents only.

## Responsibility

Gather selected activity, draft evidence-grounded candidates and support human decisions. It does not own the final portfolio renderer or a cloud conversational product.

Refinement direction from the [product thesis](../product-thesis.md): continuously connect
permitted work into the private record of contributions, decisions, learning and change;
prepare optional daily/weekly reflection and ask only for missing owner context. Summaries
must preserve evidence links and separate observation, external validation, self-report and
AI inference. Failed assumptions and abandoned paths remain part of the journey. Use existing
candidate and achievement operations, preserve corrections, and avoid mandatory journaling
or activity quotas. Reflection and unattended maintenance still require implementation
acceptance; this adds no new runtime. Email digests require explicit delivery preferences
and the existing notification contract; local-only evidence cannot silently become an email.

## Runtime and interfaces

`node foliage.mjs grow` collects into the garden's current `harvest.json`; `node foliage.mjs up`
serves its only decision queue at `/review`. The older `apps/photosynthesis/photosynthesis.mjs`
and `review-server.mjs` use a separate historical candidate format and remain paired only
for existing standalone documents. The package's `review` script points to the current queue;
`review:legacy` explicitly starts the historical server, whose pages and start-up log label it
legacy and point to `foliage up` /review. Given a current-format queue, empty or not, its page,
decide and promote answer a named 409 whose next step is `foliage up` /review, not Back.

## Storage and dependencies

The garden owns current candidate storage and the canonical Leaf destination. Sources remain
local. A configured loopback model can draft from admitted context. Only the historical
standalone pair uses `FOLIAGE_HARVEST` and `FOLIAGE_LEAF` directly.

## Access and invariants

The current Leaf review route enforces local mutation gates. The historical server enforces
its own origin and configured mutation targets and refuses current-format harvests with a
single route to the integrated queue. Human approval precedes promotion, and promoted
candidates remain pending attribution. Model unavailability, invalid output and source
failures are explicit; model output is never evidence of success.

## Data flow and boundaries

Jev is required for Photosynthesis's structured keep/pass and evidence-connection decisions
within permitted work pools. Follow the [shared Jev contract](../contracts/agents-and-evaluation.md#jev-decisions-shared-by-photosynthesis-and-scarlet--2026-09-23).
Local capture remains usable offline; Jev is an explicit cloud operation, and unavailable or
unauthorized decisions remain pending. The existing manual statement-support check does not
implement this selection loop. Reuse harvest/review and canonical Leaf operations.

Source adapters → candidate harvest → approve/reject → promotion to Leaf. Avoid a second candidate schema or review state machine in the Leaf or dashboard applications. Photosynthesis is the local processing boundary required by the user.

### Repository-title selection — 2026-09-27

The composed local collector invokes the shared Jev operation on the open git drafts of the
one review queue (`harvest.json`), for explicitly permitted repository sources.
`/workflow/jev`, linked from journey settings, discloses TypeSafe processing and lets the
owner allow or revoke each source. Only commit titles and fixed decision criteria transfer:
the draft's own titles, and as context the titles of up to eight approved candidates of the
same prefix (policy version 2; version 1 grants must be given again). Reviewer-written
titles, source metadata, file contents and diffs are not added. Title text itself can contain
private information. Permission covers that source's repository until revoked or removed,
not other sources or Scarlet.

The existing `workflow.json` owns optional `jev.grants` and `jev.attempts`; no separate
permission or evidence store, and nothing is written to `harvest.json`. An attempt's `packet`
is the harvest candidate id. Bindings include the source, caller, policy and exact selection
digest (the draft's refs and titles plus its context). A changed draft or new lineage context
requires another decision; unchanged completed results are reused. Provider failure stays
unresolved and stops that pass with one history line; no later pass sends that selection
again, and every attempt is kept. Interrupted attempts become explicitly unknown on restart.
Only the owner retries either, from `/review`. At most three new decisions
run per 30-second pass, newest author date first, while the schedule is active outside quiet
hours and TypeSafe is configured. Missing configuration never prevents local capture.

Keep/pass only places a row at `/review`: keep first, then unchecked or unsure, then pass. It
does not approve, reject, dismiss, promote, author a journey or publish anything, and it never
reaches the leaf, a public page or an export.

Mutations use the workflow's existing process ownership, serialized operations and atomic
file replacement. An in-flight request may finish before a queued revocation commits;
revocation prevents subsequent requests and invalidates current-use display of earlier
results. Disabling a source suspends selection, removal revokes permission, and reconnecting
does not reactivate it. Limits refuse new history instead of deleting older receipts.
Update runtimes together before using the new optional workflow state.

This is the Photosynthesis repository-title caller, not full artifact selection, the
standalone capture CLI, autonomous authoring or Scarlet integration. Source/journey pools
remain distinct; the latter requires its own admitted-context grant and caller wiring.

## Source and verification

- [foliage.mjs](../../foliage.mjs)
- [apps/leaf/server.mjs](../../apps/leaf/server.mjs)
- [packages/photosynthesis/src/harvestDocument.ts](../../packages/photosynthesis/src/harvestDocument.ts)
- [apps/photosynthesis/photosynthesis.mjs](../../apps/photosynthesis/photosynthesis.mjs)
- [apps/photosynthesis/review-server.mjs](../../apps/photosynthesis/review-server.mjs)
- [apps/photosynthesis/src/gather.ts](../../apps/photosynthesis/src/gather.ts)
- [apps/photosynthesis/src/drafter.ts](../../apps/photosynthesis/src/drafter.ts)
- [apps/photosynthesis/src/promote.ts](../../apps/photosynthesis/src/promote.ts)

Use this application's source-backed tests and the repository checks. Documentation inspection
is not live deployment acceptance. Shared laws and inventory: [architecture](../architecture.md).

## Direct host integration and feedback discovery — selected direction

Photosynthesis operates in the owner's OpenClaw or Hermes environment through direct host
integrations sharing the existing capture/candidate/review contracts. It searches authorized
user-feedback sources, links attributed feedback to achievements and drafts supported impact
claims. These integrations and the feedback loop require implementation acceptance. See the
[portfolio harness specification](../proposals/portfolio-harness.md) for the scoped contract.

## Selected evidence integrations

Nango supplies scoped external work and feedback sync/search; direct OpenClaw/Hermes hooks
supply local context. Cookiy plans and synthesizes user research, including separately
authorized real-participant studies. Arbigent runs authorized application scenarios through
the evaluation runtime. These are selected implementation requirements, not installed or
accepted integrations. See [harness workflows](../proposals/portfolio-harness.md).

### Shared observation implementation

`packages/photosynthesis/src/observationImport.ts` now owns the existing observation parser
and candidate merge used by CLI/MCP and the Canopy Nango adapter. The old Leaf import module
is a compatibility re-export, not a second implementation. Nango snapshots remain unreviewed
and unverified; full incremental source lifecycle and named-host acceptance remain pending.

### OpenClaw skill adapter — 2026-09-21

The existing `plugin/foliage/skills/foliage` now packages a portable host adapter with
explicit runtime and garden selection. Marketplace installation uses `npx skills add`;
doctor/status/refresh dispatch to the existing runtime. The skill installer itself does not change host settings.
The skill is not the runtime installer. Read-only embedded OpenClaw execution was accepted
on 2026-09-22. On 2026-09-23, two actual embedded turns created and updated one journey
around a manual correction, preserving exact citations and history in a disposable garden
of real Git evidence; see the [host authoring acceptance](../../docs/acceptance/2026-09-23-openclaw-authoring.md).
Durable background scheduling, scoped publication grants and Jev routing remain unaccepted.

### Shared agent packaging and explicit MCP connections — 2026-09-21

`plugin/foliage` owns one skill, the collection adapter and native Claude Code/Codex manifests.
OpenClaw installs that same skill. Host MCP settings bind an absolute runtime and garden;
`~/.foliage/agent-host.json` may record the same binding for collection commands. Neither
plugin caches nor host working directories own another Leaf. Achievement maintenance uses
the existing local MCP authoring gates and locked editor; portfolio and résumé remain
projections of the same saved statements. See [installation](../../plugin/foliage/README.md)
and [MCP permissions](../../docs/ASSISTANT-MCP.md).

Local Claude Code connection and OpenClaw seven-tool discovery passed. Codex plugin and MCP
configuration are installed; a live Codex task and embedded OpenClaw agent both called the
identity/import-context tool on 2026-09-22. Host connection is not
acceptance of a background update loop, publication grants or cloud Scarlet.

### Private garden retrieval

`packages/photosynthesis/src/searchGarden.ts` projects the validated local Leaf and its
subject-bound harvest into labeled search records. `foliage search` and `foliage_search` read
those records narrowed by `brainRecords` (`src/brainPages.ts`): an excluded leaflet is its title
and reason only, with no evidence references, and anything resting on a note about someone else is
held back. The BM25 ranker answers them: in keyword mode, the default, the garden's local brain is
not used for these two searches, and only `foliage brain search` reads it. Once the owner turns on
local embeddings (`foliage brain embed --local ollama:<model>`), the brain orders the first hits and
the BM25 matches follow (see [leaf](./leaf.md) for that path); which names, model lists, embedding
answers and choice files are accepted for that is pure code in `src/brainEmbedding.ts`. The
local MCP registers `foliage_search` only when the owner launches it with `--allow-search`.
The shared lexical ranker is the existing vault BM25 implementation, with no score in a result.
Hits carry exact record locations, bounded saved excerpts and retained evidence references.
The current search scope is the garden documents, not raw repository files or external career
systems. A host using MCP may transmit returned private text under its own data handling.
This is local retrieval acceptance only; live named-host and hosted access require separate
verification.
