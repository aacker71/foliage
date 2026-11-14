# Claude / Codex integration handoff — 2026-09-28

Owner-supplied coordination note is the current work split. Existing automatic-update acceptance
records describe prior behavior and do not authorize its continued delivery.

## Integration checkpoint

- `8ebfc3e` preserves the isolated Radix/application redesign before integration.
- `1e450ad` merges `origin/ui/less-text` (`bf4fe58`) with Claude's incoming wording and the
  shared component structure. Neither existing review screenshots nor the pre-merge test
  result accepts the merged candidate.
- `0bd1d53` merges the current #93 stack, `origin/queue/3-one-queue@adcf3e8`.
  The owner's real garden migration was not repeated. The collector retains its one harvest
  queue and single-flight behavior; Work uses the same `orderReviewQueue`/`shownQueue` view.
- The 2026-09-29 review explicitly authorized the copy and startup fixes. Startup and page
  reads no longer connect Scarlet; the collection timer no longer invokes journey maintenance.
  Grants/history remain stored and the enable control stays hidden. Explicit connection actions
  remain. The pending-suggestion maintainer is isolated in `journeyMaintenance.ts` but has no
  workflow run gate or visible review/save path, so it is not scheduled.
- Enterprise/dashboard reskin is isolated in `39d5dad`, following restoration of upstream
  surfaces in `30185ab`. Reverting that isolated commit removes the optional reskin, including
  its workspace dependencies, while retaining the rest of the foundation. Width-freeze owner
  decision remains pending.

## Binding journey behavior

Default: grant → evidence change → schedule/quiet-hours/Paused gate → Scarlet draft → pending
suggestion in the Scarlet workspace → owner save, finalize and publish. A Jev keep decision is
relevance, not write consent. Direct agent `savePresentation` is superseded.

Auto-publish is a separate explicit opt-in scoped to project or update type, using the existing
publish policy and publication path. In every mode: deny rules are absolute; every edit needs
a citation; unsupported claims and numbers absent from the cited evidence are refused; history
and undo remain; revocation takes effect immediately. Newer owner wording is preserved, as are
citations outside the grant. Nothing leaves at startup: the owner must connect Scarlet in that
session before any standing grant resumes, and collection schedule/quiet hours/Paused still apply.

`maintainJourney` must return named outcomes without throwing. Busy locks, changed records and
provider unavailability are retryable. Record pending work before provider calls, make at most
one call per tick across grants, avoid in-place state mutation, and handle outcomes exhaustively.
Transfer only the granted citations without a subject name, or explicitly include the name in
consent. Replace UI-oriented detail prose with typed reasons for Claude to label. Update the
journey entry in `public-boundary.json` with the actual permitted transfer.

The isolated maintainer chooses the second consent option:
`typesafe-fireworks-private-journey-with-subject`. Old grants retain history but are inert.
`maintainJourney` returns a named outcome and takes an optional `JourneyRunGate` with
`eligible`, `current` and atomic `commit(expected,next)` operations. Without that gate it
returns `gated` before any provider call. The workflow hook must verify a Scarlet connection
made by the owner in the current session, the collection schedule including Paused and quiet
hours, and the live grant. Its compare-and-swap receipt commit must not hold the workflow's
serialized lane during inference; revocation must be able to commit while a provider is
running. A paused session must still allow an interrupted receipt to commit, without storing
the provider result, so a later eligible run can retry; a crash-interrupted receipt never
replays silently. Wire the pending response into Scarlet's existing revision-bound save/finalize flow;
do not call the legacy direct `journey-maintain` writer unattended. This hook and its UI are
Claude-owned and remain open on the isolated branch.

## Ownership and requested handoff

Claude owns workflow/collector/queue/tick/Jev ordering, server workflow startup and timer,
`/review`, UI wording including `journeyWorkspace.ts`/`journeyActions.ts`, Aside, learn/setup and
searchable brain. Codex owns journey maintenance and consent/policy, journey collaboration,
the egress record, shared Radix/components/tokens/design docs and Canopy cloud.

The 2026-09-29 review fixes above are implemented under the owner's explicit request. Remaining:
provide the scheduled, session-connected pending-suggestion hook when the owned maintainer is
ready, then accept browser/state/provider behavior. This remains a draft integration checkpoint,
not a deployable autonomous journey release. No deployment or owner-garden migration occurred.
