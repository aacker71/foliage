# Photosynthesis → Leaflet → Ladybug revision

Saved Photosynthesis drafts can now create or update a pending/private Leaflet.
The living leaf refreshes when that local document changes. Ladybug can receive
a selected Leaflet revision and return findings with reviewer-composed wording
for explicit local acceptance. These steps do not establish authorship, change
proof tiers or publish work.

## User journey

1. Save a workflow draft, then choose **Save to Leaf**.
   Inspect the wording, all retained references and the collection's omitted
   count. Enter a reviewer and the exact Leaf subject before saving.
2. The first save creates `workflow:<packet id>`. Later saves update that same
   pending/private record with the current saved wording and retained evidence.
   The preview describes replacement of the existing workflow body. Verified,
   excluded and shared records are refused. Draft edits require a fresh preview.
3. In the living leaf, select **Preview evidence for external review**. Inspect or download the
   complete selected Leaflet packet, then paste it into Ladybug's import form.
   Import previews before saving; inference still requires configured cloud
   credentials and the existing explicit send consent.
4. After an assessment, enter proposed wording alongside its findings and choose
   **Download suggestion**. This wording is composed by the
   reviewer; the export keeps model findings, citations and caveats together.
5. In Photosynthesis, choose **Review suggestion**. Preview current
   wording, proposed wording and all imported notes. Accept with reviewer and
   exact subject confirmation. Acceptance changes the title and appends a local
   receipt while retaining original evidence. Imported notes do not become proof.

## Contracts and boundaries

The open `@foliage/leaf-app/leafletRevision` export owns the portable version-one
`foliage-leaflet-review` and `foliage-leaflet-suggestion` formats. A target contains
Leaf id, Leaflet id and its SHA-256 content revision. Packet digests detect changed
content; they do not authenticate a sender. The local review page says this.
The closed Canopy app consumes this contract without an open-to-cloud import.

Local forms use loopback-host/origin checks, bounded request bodies, document
locks and a fresh whole-document digest before committing. Workflow writes also
hold the workflow command queue so a draft cannot change during its commit.
Returned suggestions must match the current Leaflet revision. Replay, wrong
subject, foreign origin, published state and stale previews are refused.

The selected Leaflet evidence limit is 12,000 characters; oversized bodies are
refused rather than truncated. Returned notes are limited to 24,000 characters.
Export/import are explicit portable transfers; there is no automatic cloud-to-Mac
connection. Photosynthesis remains the local agent. Ladybug remains cloud-only;
its loopback manager is development infrastructure.

`/leaf/explore/state` returns a changed rendered collection or 204 for an unchanged
revision. The browser retains camera, search and surviving selection, disposes
the previous Three.js scene and rebuilds the one-record/one-blade mapping. It
checks every five seconds in the foreground, thirty seconds in the background,
and on visibility changes. Errors retain the last loaded collection with a reason.

## Verification — 2026-09-07

- BrowserOS used isolated repository-derived test state: draft creation changed
  268 records to 269; a second reviewed update retained 269 records and blades.
- The already-open scene picked up changed wording without navigation. Search
  and selected id survived; camera coordinate drift was below `1e-15`.
- Temporarily removing the isolated test document preserved all 269 visible
  records with the read-failure reason. Restoring it recovered the current status.
- The complete workflow Leaflet exported and imported through the development
  Ladybug UI with all 25 references, the 242 omitted count and target revision.
  The saved assessment remained a draft and sending remained disabled.
- A true 375px viewport on the transfer page matched the mobile media query and
  had no horizontal overflow. The refreshed desktop scene was visually inspected.
- `leafletRevision.test.ts` uses actual git intake and workflow collection for
  reviewed creation/update, exact reference retention, locking/queue behavior,
  HTTP origin checks, revision refresh, explicit suggestion acceptance and replay
  refusal. Cloud return probes are labelled protocol tests, not model results.
- Assessment and manager tests exercise revision import, complete return notes,
  download headers, CSRF/origin/stale-state refusal and nonmutating export.
- `pnpm check` runs boundary, egress, duplication, findings, types and tests.
  Final result is recorded in the task completion; the gates remain executable.

Actual Ladybug cloud inference is unverified here because provider configuration
and consent were absent. Broader local-model answer-quality evaluation remains
separate work, as identified in the earlier workflow test.
The subsequent [local-model rehearsal](LOCAL-REVISION-REHEARSAL.md) provides a
repeatable test command while Fireworks billing is unavailable and records the
live models' refusal outcomes without claiming cloud success.
