# Auto live portfolio implementation

Status: the local collection-to-review cycle now refreshes existing private drafts.
Hosted publication adapters are implemented separately; deployment and acknowledged hosted
revisions in this workspace remain unfinished. Public changes still require the owner’s review.

## Implemented

- New matching commits extend the latest source draft while its retained evidence fits the
  25-reference limit. Reviewed wording remains intact; accepted drafts return to pending review
  when evidence changes. Snoozes stay snoozed and dismissed drafts stay dismissed. Full packets
  start a new bounded packet without removing the previous one or its references.
- Every decision names the draft revision shown to the reviewer. A changed revision refuses
  the save. The browser retains in-progress wording and asks the reviewer to inspect the new
  evidence before enabling the decision again.
- Each newly collected reference keeps its own observation time. Saving the refreshed draft
  updates the same pending, private Leaflet and retains earlier review entries. Collection
  never edits the saved Leaf document by itself.

- The app-owned collector records a run identifier, trigger, source checkpoints,
  generated packet identifiers, individual source errors and completion time. Completed
  traces travel with the retained collection history; older histories remain readable.
  In-progress state does not assert completion. Failure to persist the initial run restores
  the previous in-memory state instead of leaving collection apparently running.
- Workflow Overview joins actual packets to saved Leaflets, shows revision references and
  distinguishes an edited draft from the packet last carried into the Leaf. Disconnected
  sources, unreadable documents and pending authorship carry reasons.
- Local attribution, visibility and policy checks have separate, overlapping counts. These
  are preliminary checks, not a replacement for Canopy's disclosure/redaction gate or a claim
  of hosted publication. The status says hosting was not checked and does not invent a
  last-published revision.
- Accept · Save to Leaf saves the edited private draft and opens its existing
  digest-bound preview directly. Final subject/reviewer confirmation and atomic Leaf writes
  remain unchanged. Collection alone never writes a verified or outward-facing Leaflet.
- An unsuccessful workflow refresh removes stale data and mutation controls. A successful
  refresh clears the connection error. The local workflow remains independent of Ladybug.

Implementation: `apps/leaf/src/{workflow,portfolioPipeline}.ts`, the `/workflow/api` response,
`apps/leaf/workflow-ui/{app,pipeline}.tsx` and the existing `leafletJourney.ts` write path.
No hosted dependencies or egress were added to the open plane.

## Current verification

The integrated candidate passed `pnpm check` with 1,946 tests and no failures or skips.
The real Git recovery test follows first collection, saved private Leaflet, unavailable source,
restart, new evidence, stale-decision refusal, and an explicit update of the same Leaflet.
The original timestamps and prior review entry survive. Additional real Git tests cover the
25-reference boundary, rollover, dismissed drafts, snoozes and merge-commit exclusion.
Pipeline tests distinguish offered
pending work from unlisted link consent using the native public projection rules.

BrowserOS inspection confirmed saving private wording. After another real Git commit and an
application collection, the existing page showed refreshed evidence, preserved unsaved wording,
and disabled save controls until the updated evidence was reviewed. The browser automation
call timed out during its wait; a subsequent read of the same owned tab confirmed those states.
No hosted publication or final post-refresh browser save is claimed by this inspection.

## Earlier verification, 2026-09-07 local time

- Full `pnpm check` passed: 1,648 tests, no failures or skips; boundary, egress, duplication,
  findings and type checks passed. Log: `/private/tmp/foliage-auto-portfolio-check.log`.
- Real Git integration tests exercise a missing source, scheduled retry after application
  restart, recovery with a new commit, checkpoint preservation, no duplicate packet and
  preservation of an earlier reviewed title. Existing tests exercise DST, quiet hours,
  one missed-window catch-up, interrupted-run recovery and stale/cross-origin writes.
- Revision tests follow a real repository packet through private creation and compare the
  pipeline's revision with the actual stored record. Missing Leaf and invalid policy remain
  unknown/unavailable rather than being presented as an empty successful portfolio.
- Isolated browser rehearsal: resumed the saved schedule through the UI. The application's
  timer collected eight real new commits from the connected Foliage repository into one
  packet without pressing Collect now. Continued directly to Leaflet review and confirmed
  the rehearsal subject. The copied Leaf grew from 269 to 270 records; the new record is
  pending/private with all eight references. The original Leaf document was not modified.
- Overview was inspected at desktop and true 375px width. `innerWidth=375`, the small-screen
  media query matched, and there was no horizontal overflow. Status text measured 7.25:1
  against its panel; metrics use JetBrains Mono and tabular numerals. Overview error and
  unhandled-rejection hooks recorded none. The existing 3D scene emitted the Three.Clock
  deprecation warning when opening it; this is not reported as a clean console for that route.

- Stopped the owned preview server while Overview remained open. Its next refresh displayed
  the connection error and removed the pipeline and mutation forms. Restarted the server,
  clicked Retry connection, and recovered the saved 270-record state. The run trace and
  reviewed packet survived the restart.

This does not prove physical sleep/wake, power-loss durability, a loaded login service,
independent customer usefulness, cloud model quality or deployed delivery.

## Remaining sequence and shared decisions

The main checkout's `cf69178` records the owner's D9 selection: Vercel with Supabase
Postgres authority and private Storage. It also states that Supabase Auth was not selected
and that the intended project and hosted admission contract remain unresolved. Follow
`docs/PORTFOLIO-SCALE-ENGINEERING-PLAN.md` in that checkout; avoid duplicating its storage work.
Its D8 requirement is to atomically commit state, history, operation receipt and outbox.

1. Identify the intended Supabase and Vercel projects and account/session authority. Inspect
   their actual configuration and health. Confirm US primary/compute locations and inspect
   backup, object, replica and log handling before making residency claims.
2. Establish source attribution for a real publishable Leaflet. Metadata matching in workflow
   packets stays pending; neither a model nor a review click manufactures signature proof.
3. Implement authenticated device-to-host admission of only the reviewed publication payload,
   with a durable operation identity, expected revision and retry receipt. Preserve current
   personal publication approval, including the explicit final-confirmation decision in D7.
4. Stage immutable objects privately, then commit the authority pointer, receipt, history and
   outbox transaction. Replaying old uploads cannot override withdrawal or newer revisions.
5. Route every hosted page, listing, Leaflet, media and download read through current authority.
   Prove immediate withdrawal across serving instances and old aliases. Restore revocations
   before serving after recovery; database backup alone does not establish object recovery.
6. Feed acknowledged hosted revisions and failures into this status view. Enable and rehearse
   the actual login service against the intended installation, including restart/offline/sleep
   recovery. Current installer availability is not evidence that it has been loaded.

Acceptance: real new work is collected automatically, a person reviews the attributable
revision and its disclosure, the hosted page acknowledges that revision, and retries,
restarts and withdrawal neither duplicate it nor expose unauthorized evidence.
