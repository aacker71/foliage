# Photosynthesis → Leaflet → Ladybug workflow test

**Update — 2026-09-07:** the first three gaps identified below are now implemented.
The browser created the saved workflow Leaflet (268 → 269) and a second reviewed
save updated that same record. The existing 3D view refreshed without navigation,
retaining search, selection and camera position within floating-point precision.
The selected Leaflet's complete 25-reference body and revision imported into
Ladybug's development manager and saved privately. No cloud model was run.
Return-packet export, local acceptance and stale-write refusal pass controlled
protocol regressions. See [implementation and current verification](LEAFLET-REVISION-WORKFLOW.md).
The report below records the earlier state; its missing-component findings are
historical, while the live-model evaluation/configuration limitation remains.

Tested 2026-09-06 in `codex/streamlined-journey`, starting from `a6b8f03`.

**Result: working steps, but the full workflow is not yet connected.** Explicit
Harvest approval and promotion grow the 3D Leaf. Saving an interactive workflow
draft does not create a Leaflet. Ladybug imports that workflow draft separately;
this is not yet a Leaflet revision handoff or a cloud assessment round trip.

## Live test

The test copied existing repository-derived Leaf, Harvest and workflow documents
into `/private/tmp/foliage-update-workflow-test`. No source evidence was invented.
The schedule remained paused. Review decisions were attributed to **Codex workflow
test**, not to the owner. Test artifacts remain private and pending.

| Step | Observed result |
| --- | --- |
| Edit saved Photosynthesis workflow wording | Updated wording survived Save changes and reload; the handoff links were hidden before saving |
| Open the draft in Photosynthesis | Exact saved title and packet context arrived; optional source reads returned two commit excerpts and reported additional unavailable context |
| Run installed local `llama3.2:3b` | Broad claim-checking answer was withheld for rating language and missing citations. A narrower title question completed with `[L1]`; no citation-label or literal-data issues were detected. This does not verify factual quality |
| Save workflow draft → inspect Leaf | Leaf stayed at 267; no Leaflet carried the saved draft title. This bridge is missing |
| Review real Harvest candidate `git-cluster:mark` | Inspected the two actual commits, supplied reviewed wording, and approved through the browser form |
| Carry approved work into Leaf | Browser action created one pending Leaflet; count increased 267 → 268. Both original commit references and body texts survived |
| Open 3D explorer | After navigation/refresh, the renderer reported 268 blades. Selecting the new blade showed the approved title, pending state, source and excerpts |
| Open new Leaflet in Photosynthesis | Selected Leaflet title, both evidence references and body text arrived in the local context |
| Export edited workflow draft → Ladybug import | The separate Canopy development manager preview retained the new wording, all 25 references and 242 omitted count; local paths and structured email metadata were absent |
| Preview versus save | Preview created no assessment file. Save imported packet privately persisted a draft with no assessment result |
| Cloud inference | Send remained disabled: provider key/model/approval were not configured and consent was unchecked. No cloud inference or publication was performed |

The browser rehearsal used one owned BrowserOS neo tab. Some native ref clicks did
not change the form state; those actions were completed using observed DOM fields
and the forms' normal `requestSubmit` behavior. Results were checked against both
browser output and the actual stored documents.

## Repeatable regression

`apps/leaf/src/studioSeam.test.ts` now covers real repository intake → HTTP review
approval → promotion → explorer record count → Photosynthesis Leaflet context.
It asserts pending status, title retention, every stored evidence reference, explicit
omissions in the bounded AI context, and that
repeating promotion neither duplicates records nor rewrites the Leaf file.
Final `pnpm check` passed: 1,644 tests, zero failures or skips, including boundary,
egress, duplication and type gates. Run it to repeat this regression. The focused existing
workflow/context/transport/assessment run also passed 15 tests before the new case.

## Gaps to close next

1. **Workflow draft → Leaflet:** introduce an explicit, subject-bound review and
   promotion step. A saved draft must not silently become verified work. Preserve
   packet identity, all evidence and omission limits; define update semantics for
   an existing Leaflet rather than appending duplicates.
2. **Explorer updates:** the server re-reads the Leaf on navigation, but the open
   canvas has no change subscription. Add version-aware refresh while preserving
   selection and camera position; distinguish a read failure from an empty Leaf.
3. **Leaflet → Ladybug → revision:** the current portable export starts from a
   workflow draft, not the promoted Leaflet. Define an explicit revision-bound
   cloud handoff and return suggestions for local review. Do not let cloud output
   rewrite evidence or publish automatically.
4. **AI acceptance:** exercise broader local claim checks with evaluation cases;
   the first live response here was unusable. Separately configure and approve a
   cloud provider before testing actual Ladybug inference.

## Local previews

- Leaf and the new blade: `http://127.0.0.1:4216/leaf/explore`
- Saved cloud-product development packet: `http://127.0.0.1:4214/ladybug`

These are isolated development previews. Ladybug remains a cloud-only product;
running its manager locally does not establish a local Ladybug product or verify
a deployed cloud service.
