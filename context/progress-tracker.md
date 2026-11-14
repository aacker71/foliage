# Progress tracker

### Source cleanup — 2026-10-20

`codex/source-cleanup`, based on `release/0.3.1-fixes@357a7bf0`, retires the
unused-export baseline: 30 app/tool helpers and types are now internal, the unused
dashboard `HarvestLoadCause` alias is removed, and the ranker's adjacent type
declaration matches its runtime exports. All 34 `@knipBaseline` annotations and
the blanket suppression are gone. Package-declared APIs remain intact.

Removed duplicate/stale Knip exclusions and a redundant CLI entry. `check:dup`
now fails on stale configuration and suppression tags as well as unused code.
Static checks pass with no Knip findings/hints or detected clones. The runtime
implementations of all 16 edited modules are unchanged after accounting for export
visibility, comments and erased types. Independent Claude review concerns were checked
against hidden workflow/plugin consumers, package exports and live ranker imports.

The repository suite reported 3,023 passes, two failures and two skips. One failure
exposed the old sharing test's assumption that the developer's default leaf is absent;
the existing fix from `babc3b47` is reused, including temporary app copies for tests that
previously overwrote developer-local defaults. The other failure came from a machine-local
`.git/info/exclude` rule hiding 16 tracked design-review files; that exclusion is now
narrowed. All 12 focused sharing, default-path and ignore-rule tests pass after these
corrections. Static checks pass again, and independent Claude review of the test fix
reported no actionable findings.

The full local gate completed its offline behavior phases, then failed because the macOS
observer missed the deliberate DNS-denial control. A fresh control-only session observed
and killed all four forbidden operations; that narrower probe did not replace the failed run.

The corrected head `9a1f823f` subsequently passed full macOS and Linux CI in
[run 39542755829](https://github.com/aacker71/foliage/actions/runs/39542755829).
macOS passed 3,026 tests with two skips; its offline gate completed 362 sandboxed
processes and observed all six controls. Linux passed 3,017 tests with 11 skips;
its offline gate completed 289 sandboxed processes and observed both Linux controls.
Build-order item 8 is explicitly not run on Linux. Neither platform reported a test
failure, forbidden network attempt or surviving sandboxed process. The Linux website
build and boundary/network negative controls also passed. This closes the cleanup's
full-run acceptance gap without claiming that the earlier observer miss was fixed.

The cleanup is integrated with `release/0.3.1-fixes@4cde7d74`, which already includes
the CI cost change from #230: the full brain gate runs on the Mac and gates the Linux
portable job. The release candidate receives fresh checks after this combined merge;
the cleanup's passing checks do not establish production release acceptance.

### Parent release CI correction — 2026-10-19

`codex/brain-refresh-ci-parent` isolates the brain-search proof correction from
#220 on `release/0.3.0-rc`. The Linux gate rejected the documented current-record
answer while a detached refresh continued. The proof now verifies that answer,
waits for completion, positively checks manifest hashes and rejects repair by a
follow-up search. It changes no product deadline, runtime behavior, version or
download pin. The regression fixture uses this branch's exported
keyword-mode wording. All 63 focused tests, tools typecheck and architecture-link
checks pass after staging the pinned runtime. #220's first completed Linux offline
proof took 54 minutes, leaving too little of the former one-hour job budget for
tests. Both branches now allow 90 minutes of runner capacity with all test and
product bounds unchanged. Full CI remains the merge gate; see the
[parent correction receipt](../docs/acceptance/2026-10-19-brain-refresh-ci-parent.md).

The parent advanced again to `a776f2d7` with one refresh helper for items 3, 5 and
6 and the same 90-minute Linux budget. Reconciliation preserves its database
identity and final lock checks in our shared helper, alongside manifest hashes,
current-record results and unchanged source bytes. New controls for a replaced
database and a leftover follow-up lock failed before those guards were moved.
The earlier #222 Linux run passed its 74-minute offline proof, then hit 90 minutes
late in repository tests; the current parent itself has since passed full CI.
The budget stays unchanged and the reconciled #222 head requires fresh full CI.

### Linux brain-search gate correction — 2026-10-19

Actions capacity is restored. Reruns of #212, #217 and #220 actually executed;
boundary/egress controls passed, but the Linux full gate rejected the documented
current-record fallback while a detached brain refresh was still running. The
offline proof now checks that fallback against the current record, waits for the
existing writer, verifies the manifest hashes, and requires a subsequent brain read
that changes neither manifest nor source bytes. Product timeouts and workflow gates
are unchanged. Nine regression controls pass, including three false-green paths
found during Claude review and reproduced before fixing them. At `5927dc6d`, full
macOS CI passed and Linux completed all its offline proofs, then exhausted the
estimated one-hour job budget during the remaining tests. The runner budget is
now 90 minutes; complete Linux validation still remains pending. See the
[CI correction receipt](../docs/acceptance/2026-10-19-brain-refresh-ci.md).

### Release source and media reconciliation — 2026-10-17

`codex/release-source-reconciliation` starts at the #217 first-run fixes and
integrates #210/#211 with the existing #215/#216/#218 media composition. The
candidate-scoped local Review image route is carried forward separately from
draft #214; Figma provider authentication is not enabled. #196/#197 are already
inherited through #212. The frozen release, download pins and owner runtime stay
unchanged. The full local gate passed (3,013 passed, zero failed, two Docker-runtime
checks skipped); the offline gate passed across 362 sandboxed processes. Aside MCP
verified real-file replay and revised-file intake, image preview through private Work
at phone/desktop widths, and automatic local-brain refresh with cited search results.
The generic image entry now defaults to local origin; Figma export labeling follows
the explicit Figma entry. GitHub protected checks and hosted/provider acceptance
remain separate; see the
[integration receipt](../docs/acceptance/2026-10-17-release-source-reconciliation.md).

### Spec numbering after integration — 2026-10-13

`release/0.3.0-rc` integrates both 2026-10-10 spec branches below, which each claimed unit 38
and moved release acceptance to 39. Resolved: the local brain keeps
[unit 38](specs/38-local-brain.md), the team project portfolio is
[unit 39](specs/39-team-project-portfolio.md) and release acceptance is
[unit 40](specs/40-release-acceptance.md). The two entries below use those final numbers.

### Local team project portfolio spec — 2026-10-10

Branch `spec/team-portfolio-local` adds [unit 39](specs/39-team-project-portfolio.md), a draft
spec for a team project portfolio kept on each member's machine, and moves release acceptance
to [unit 40](specs/40-release-acceptance.md). It follows the owner's 2026-10-10 direction:
Wondersearch is paused and everything stays local. Each member keeps one record under
`refs/foliage/team/` in the project's own repository. Foliage writes it only after showing the
exact write and getting a second confirm, from `foliage team … --confirm` or the `/leaf/team`
page, and never pushes or fetches; members hand each other records as git bundle files. AI
drafting uses a model on the member's machine only, and four owner choices are marked
`UNRESOLVED`. The delivery plan's B03 row now names this slice. This is specification work
only: no code, no repository writes and no acceptance claim. `pnpm check` passed (exit 0):
architecture 39 units and 38 acceptance rows, 0 clones, typecheck clean, tests 2711 pass, 0 fail.

### Local gbrain brain spec — 2026-10-10

Branch `spec/local-gbrain` adds [unit 38](specs/38-local-brain.md), a draft spec for shipping a
pinned gbrain with Foliage as each garden's local brain, built from the garden's own records with
every network path switched off, and moves release acceptance to
[unit 40](specs/40-release-acceptance.md). It follows the owner's 2026-10-10 direction:
Wondersearch is paused and everything stays local. Review fixes are applied: the egress gate
watches inside the sandbox (deny log plus a negative control) instead of at a proxy; brain
results are gbrain's order followed by Foliage's own remaining matches, because gbrain's search
always drops near-duplicates and caps one page type; removal purges with a 0-hour cutoff;
imports run `--fresh --include-gitignored` with explicit brain and source; excluded hits carry
their reason and never the body; the brain installs as its own verified unit. The review probe
(throwaway home, network and `~/.gbrain` writes denied by `sandbox-exec`) measured those gbrain
behaviours. The local brain moves to gate 1 in `.loop/MILESTONES.md`. Four owner choices are
marked `UNRESOLVED`. This is specification work only: no code, no packaging and no acceptance
claim. `pnpm check` passed on 2026-10-10 (2711 tests, 0 failed).

### Same-job project demo and evaluation receipt — 2026-10-10

`codex/revision-bound-demo`, based on main `f1ee2cbc`, extends the existing optional
project-test scenario with an owner-pinned app launch, in-container port, path and clip
duration. The app starts after successful command steps inside the same offline Docker
job. A bounded host relay reaches that job alone; the existing guarded Chrome observer
records checks, PNG and MP4. The evaluation binds their exact receipts/digests to the
source archive/commit, image and scenario. The MCP action puts the media and executor
report in one unreviewed candidate. Replaying keeps its decision; altered receipts or
media under the same attempt are refused. `foliage-eval import --include-demo` recovers
the selected unsigned local report and media without rerunning the workload.

Real Docker/Chrome/ffmpeg acceptance on a disposable, labelled Git protocol app covers
the actual MCP launcher, dirty-checkout exclusion, exact media/receipt binding, changed
receipt refusal, replay, command failure, unavailable app, blocked external page resources,
cancellation during recording and confirmed container/browser/relay teardown. It is runtime
acceptance, not a customer's achievement. The owner garden and installed service were not
changed. [PR #196](https://github.com/aacker71/foliage/pull/196) records the full repository
and release gates for its exact head. Claude Code's independent review did not run: its
OAuth session expired and could not be refreshed.

The local archive now includes the evaluator and shared capture modules omitted by the
workspace-only packager. A relocated installation, after its source archive is removed,
can discover and call the existing project-test MCP tool, queue a real unavailable-runtime
receipt and preview that receipt through its installed CLI. This checks packaging and
failure honesty; the successful browser recording is covered by the separate live run.

This closes the separate-running-app provenance gap for explicitly prepared local scenarios.
Dependency preparation, signed combined-media admission, cloud/external-code isolation,
automatic scene choice and the full source-to-published-portfolio loop remain separate gates.
The UI rebuild is coordinated in the other session and does not overlap these changes.

### Owner-pinned project test and demo-browser checks — 2026-10-08

`codex/project-test-capture-20261008` adds an opt-in, zero-argument
`foliage_test_selected_project` MCP action. The owner selects an absolute repository,
full commit, bounded scenario and immutable local Docker image before connection; the
agent cannot substitute commands or paths. The restricted executor records the actual
outcome and cleanup in a private receipt, then sends its report to the existing Review
queue without approving, attributing or publishing it. The previously implemented
owner-pinned local browser can now check visible overflow, broken images, unnamed controls
and browser errors before recording a still and short video from that session. Page checks
do not require ffmpeg; recording does. The browser is a disposable host process, not a VM.

Local verification: `pnpm check` passed all gates and 2,585 tests on the candidate before
the final browser-check refinement; its focused Chrome tests passed 18/18 afterward. A
real Docker smoke run on the current repository commit covered successful Leaf tests,
failure, timeout, output limit, cancellation and cleanup refusal. A disposable-garden MCP
test admitted one actual executor report to Review. No owner garden or public portfolio was
changed. The evaluated revision and the separately running browser page are not yet bound
as one build. A versioned browser observer, controlled dependency preparation, cloud
isolation and external-code acceptance remain open under [unit 26](specs/26-local-evaluation.md).

### Workflow next-draft preview — 2026-10-07

`codex/workflow-next-review` adds one private `queue.next` (`id`, title and Review link)
to `/workflow/api`, reusing the same visible queue and current Jev order as `/review`.
The preview advances after a decision; paused Git drafts remain hidden, and an unreadable
harvest retains `open: null` rather than reporting an empty queue. Following the link opens
only a currently visible draft; refusal recovery and recorded-decision links still work.
No provider call, new queue, write authority or publication is introduced. Workflow UI
consumption is owned by the coordinated UI change, not implemented by this API slice.

Focused HTTP/render checks passed 107 tests, including the collector's real temporary Git
commit and explicit protocol fixtures for Jev ordering. These check queue mechanics, not
model quality or an automatic work-record update. Full `pnpm check` passed 2,539 tests and
all repository gates; log: `/tmp/foliage-next-review-check.log`. Owner runtime unchanged.

### Public runtime compatibility — validated locally

Restored the already implemented revision-bound private brain API and daily/weekly
reflection from the live-portfolio lineage into the public runtime. Existing local search
remains available independently. Historical source-scoped maintenance state is retained
without granting new provider authority; current explicit consent is required for suggestions.
This closes API/history upgrade failures, not the separate hosted-production acceptance gate.
Validation: `pnpm check` passed all static gates, builds, typechecks and 2,516 tests.
Real MCP transport checks cover opt-in reads, identity binding, stale revisions and unchanged
source bytes. Historical permission/admission state survives reload and explicit renewal
without provider calls under the historical grant. Aside browser checks passed at 1440×1000
and 390×844, including period navigation and honest empty state. Reflection GET returned 200,
invalid periods 409, POST 405 and foreign Host 421. The owner runtime and record were untouched.
Claude Code's independent review could not start because its OAuth session expired; no
outside-model review result is claimed. Archive promotion and hosted acceptance remain separate.
Independent release review removed the unused public audience mode: the restored helper is
explicitly `privateBrainRecords`; publication admission remains a separate boundary. A real
legacy producer at `9c80cefb` generated a protocol workflow from a temporary Git repository,
including a source-scoped grant, admission and Jev v1 receipt. The new runtime reopened that
saved state, retained history and explicitly renewed consent with no provider calls or Leaf
changes during upgrade. Injected legacy model replies test persistence, not model accuracy.

For current release sequence and exit gates, start at the [release path](../.loop/MILESTONES.md).
This file preserves dated implementation and verification receipts; a local pass does not
mark a release gate complete.

## Current phase

### Merge ATS setup candidate — 2026-10-05

`codex/ats-resume-reader` extends draft [PR #141](https://github.com/aacker71/foliage/pull/141)
with native Merge hosted Link and actor-filtered ATS connection status under
`/recruiting/accounts`. Work email and organization label the setup; verified Foliage actor
identity binds it. API region is explicit; credentials remain server-side. Candidate sync is
disabled at setup. Personal portfolio sharing and existing Ashby reviewed sends remain separate.

The 55 focused protocol/HTTP tests passed, including foreign-owner/category refusal, bounded
pagination, untrusted links, outages, account switching and CSRF. The actual app's empty setup
page and form-to-return-link flow were checked in Aside at 375px and 1280px without horizontal
overflow, using a labeled local protocol service rather than a customer account. No provider
sign-in was performed. The full repository gate passed static checks and 2,426 of 2,428 tests;
one explorer request hit its four-second deadline and the Vercel build test hit its 180-second
deadline under concurrent machine load. Both tests passed unchanged in isolation (the packaging rerun completed in 21 seconds).
This is not an all-green full-suite result.

Merge delivery/account-token handling, Kombo completion/delivery, Juicebox authorization and a
real employer-admin round trip remain open; setup is not evidence of a delivered résumé.
See [configuration](../docs/DISTRIBUTION-INTEGRATIONS.md#native-merge-ats-account-setup--2026-10-05).

### Work-first integration and shared-title redaction — 2026-10-05

Draft [PR #126](https://github.com/aacker71/foliage/pull/126) now leads the website home and
private Work, Photosynthesis and Harvest screens with real retained work; Review, Workflow
first use and Publish expose their next action without repeating controls or commands. The
[front-door](../docs/acceptance/2026-10-05-frontdoor-work-first.md),
[Photosynthesis](../docs/acceptance/2026-10-05-photosynthesis-provenance-summary.md),
[Harvest](../docs/acceptance/2026-10-05-harvest-reading.md),
[Workflow](../docs/acceptance/2026-10-05-workflow-first-use.md) and
[Publish](../docs/acceptance/2026-10-05-publish-canopy-handoff.md) receipts show the current
bounded phone and desktop checks. The Publish page links to Canopy's separate publication
review only when an exact loopback manager origin is configured; that link does not publish.
Leaf's local server still has no authenticated Share or Export POST.

The same candidate now makes the one Work account action prominent, gives Import an accessible
file picker, presents default Policy rules as compact reading rows, and tightens the Canopy public
reader without losing the living leaf. The website scenes use current, dated captures from real
local Git-derived work. Bounded [Policy](../docs/acceptance/2026-10-05-policy-rule-reading.md),
[Import](../docs/acceptance/2026-10-05-import-file-picker.md),
[Canopy](../docs/acceptance/2026-10-05-canopy-public-reading.md),
[website scene](../apps/www/acceptance/2026-10-05-product-scenes.md) and
[Leaf-to-Canopy navigation](../docs/acceptance/2026-10-05-leaf-to-canopy-local-handoff.md)
receipts name their source and limits. The local handoff performed no publication write.

The shared address detector from draft [PR #150](https://github.com/aacker71/foliage/pull/150)
is integrated in #126. Direct shared Leaflet pages, public lists and static export redact
identifier-shaped title spans; the owner view retains the source words. Export still requires
explicit confirmation for an affected title and then emits a redacted heading. This closes the
earlier preview-only title-disclosure gap in local source; an outside-reader and hosted
publication pass on the exact release remains open.

The follow-up fixed Import's misleading file picker when scripts are disabled: a native paste
preview remains usable, while the file picker appears after its handler initializes. The
[Import receipt](../docs/acceptance/2026-10-05-import-file-picker.md) records both browser paths.
The website Reader now shows the actual local Canopy publication rehearsal with both complete
Leaflet actions on a taller phone capture, with its Pending scope stated in the
[scene provenance](../apps/www/public/product/PROVENANCE.md). This is not a hosted owner release.

Local `pnpm check` on `ceef910` passed **2,493 tests**, zero failures or skips, with
architecture, boundary, egress, duplicate, findings, typecheck and bundle gates. Website
build, lint and typecheck passed, and Impeccable detection found no issues in the changed UI.
CI and Vercel preview status on the pushed head must be assessed before merging. No connected owner source/model,
two-account hosted publish/withdraw, outside reader, full route-state keyboard/reduced-motion
or installer acceptance is claimed by these checks.

### Pilot trust and recovery continuation — 2026-10-04

Draft [PR #126](https://github.com/aacker71/foliage/pull/126) now separates shared links from
static-export selection on Publish, warns when a shared title contains an email address, and
keeps terminal release commands in a disclosure. History previews the current wording that an
older achievement version would replace, requires an explicit acknowledgement, and keeps the
displaced version in history. Owner-written uncited wording remains labeled as self-report;
autonomous suggestions, review and Save use the same selected-citation numeric check. A
matching token is not independent factual verification. Manual Check for update reports the
specific schedule, permission or provider gate and a recovery action. Malformed private
documents reach a navigable recovery page; a failed Workflow read settles to Retry rather than
an endless loading state. The [screen receipt](../docs/acceptance/2026-10-01-pilot-ui-screens.md)
contains new local Publish and History captures and states their interaction limits.

At the 4 October checkpoint, a Publish warning did not prevent an email-bearing shared title
from appearing at its direct link. An earlier macOS CI run timed out in the relocatable Canopy
companion package test under runner contention; the focused test passed after its deadline and
diagnostics were strengthened. The integrated local `pnpm check` then passed 2,474 tests with
zero failures or skips, including the new Workflow, History and citation seams. These were
checkpoint findings; the 5 October redaction, test result and required release checks are
recorded above.

### Pilot screen continuation — 2026-10-03

Draft [PR #126](https://github.com/aacker71/foliage/pull/126) now leads the private Overview
with retained work and one next action, places approved Leaflets on Work, compacts Review and
Photosynthesis, gives first-use Import a read-only preview and explicit private-record creation,
and unifies empty and owner Leaflet pages under the night workspace. Static export carries linked
per-Leaflet detail pages and exact evidence references; local Canopy serves detail only from the
current admitted publication and returns 404 after withdrawal. The public and manager screens
drop dead controls, operator paths and repeated source labels. The
[measured screen receipt](../docs/acceptance/2026-10-01-pilot-ui-screens.md) links true-width
375px and 1280px captures from isolated gardens using this repository's real Git history.
Static exports require a fresh destination for each completed release; withdrawing an already
hosted static copy requires switching or removing that copy at its host.

The integrated `pnpm check` gate passed 2,468 tests with no failures or skips. Website build/lint,
Leaf and Canopy typechecks, Impeccable detection and diff hygiene also passed. This is a local
draft candidate, not a deployed release or owner acceptance. Connected source/model operation,
hosted two-account publication and withdrawal, full route/state keyboard and reduced-motion
coverage, and an outside reader test remain in the
[screen checklist](../docs/UI-SCREEN-CHECKLIST.md) and [release path](../.loop/MILESTONES.md).

### Shared application component foundation — 2026-10-01

[PR #126](https://github.com/aacker71/foliage/pull/126) is the unmerged
integration candidate for the pilot screens and shared `@foliage/ui` adoption.
Radix supplies Tabs, Select, Checkbox, ToggleGroup and AlertDialog behavior;
Foliage owns the styles through tokens and shared CSS. ActionList/ActionRow and
Field serve the React Workflow; EmptyState and Textarea serve native Leaf routes.
FeedbackNotice unifies matching error/result surfaces in Workflow,
Import and Canopy while retaining page-owned recovery. Token and control
selector namespaces are separated and guarded by a test. The Sources header
no longer repeats collection status outside its relevant section. The
[UI foundation](../docs/UI-FOUNDATION.md) owns the
component inventory and the [screen receipt](../docs/acceptance/2026-10-01-pilot-ui-screens.md)
contains true-width integrated captures of Work, Workflow, Sources, Import,
Setup and the website.

The Work continuation in the same candidate replaces its count-only retained state with
actual attributed record titles and owner-written context when available. Eligible private
records lead into the exact-citation story form; the form now uses one reading column under
the Work navigation. A local HTTP seam covers private save and public non-disclosure, while
the [updated screen receipt](../docs/acceptance/2026-10-01-pilot-ui-screens.md#work-to-private-story-continuation)
shows the populated entry and form at true phone and desktop widths. This does not create
an achievement automatically or publish a story.

The next screen continuation keeps Review's true queue total while title, ID, source and cited
reference find reach later drafts; Review retains the find context after a decision. Publish
now distinguishes proposed outward work from private records and
opens the selected private record directly. The updated screen receipt records 202 real-history
drafts and a 952-record local preview at phone width. These are read and navigation changes,
not approval, policy change or publication.

The combined local check, website build/lint and browser checks are recorded
on the PR and screen receipt. This is not production deployment or owner
acceptance of the complete redesign; the [screen checklist](../docs/UI-SCREEN-CHECKLIST.md)
and connected provider/host gates remain open.

### Production website and integrated app — 2026-10-01

[PR #100](https://github.com/aacker71/foliage/pull/100) landed on `main` as `a8e95eb`
after the full local gate (2,415 passing tests, zero failures/skips), Linux and macOS CI,
boundary, and both Vercel builds passed. An isolated first run at true 375px created an empty
private record; Work, Import, editor and preview rendered without overflow or console errors.
The owner's existing checkout and garden were not changed. Twelve superseded Codex PRs were
closed after their heads were confirmed in `main` or their patch matched a landed commit;
Claude's active queue PRs were left open.

The production [homepage](https://getfoliage.com/) and [start page](https://getfoliage.com/start)
show the new design and real app scenes. Gstack Aside checks at true 375px and 1280px found no
overflow, console error or broken visible image; all four scene tabs switched and all ten
product images returned anonymous 200. A cookie-free production fetch returned the exact
14,554,602-byte Mac arm64 archive and SHA-256
`1038c43964f616d9b023c33432b45181f10bedf74eae3896b6d62eba46810fbf`.
See the [production receipt](../docs/acceptance/2026-10-01-public-site.md).

This establishes a public technical-pilot download, not outside-user or hosted publication
acceptance. The archive requires Node/manual extraction and excludes closed Canopy. Live
two-account sign-in, publication/withdrawal, recovery, provider-bound external private MCP,
autonomous journey maintenance, the remaining UI screen checklist and a signed native
installer stay open in the [release path](../.loop/MILESTONES.md).

### Pre-merge release assembly — 2026-10-01

The local `codex/release-candidate-20261001` branch integrates the prior UI/review stack with
selected work versus raw-source separation, retained Work access, a private-record creation
path, Scarlet's real local-model first run, clearer errors, Canopy workspace bootstrap,
v6 selected photos, consented pending journey suggestions,
scoped private-brain sessions and the read-only public brain. The website start path has a
checksum-pinned Mac pilot download, real app scenes and a sign-in link gated on live hosted
account acceptance. [PR #100](https://github.com/aacker71/foliage/pull/100) is the integrated
candidate with an exact archive from app source `c881624` and real scenes. At this checkpoint,
production cutover and outside-user acceptance had not occurred.

The integrated release tree through `90387ec` passed `pnpm check` with 2,415 tests, zero
failures or skips, including architecture, boundary, egress and type checks. The website
production build and lint passed with the archive and updated hero caption. An isolated
real-garden browser pass at true 375px and
1440px showed 849 raw Git records reachable through 71 pages, no private debug path, and intact
Scarlet setup styling. A later source-only correction was rechecked with 869 real records at
both widths: Selected work showed no raw rows and Source records retained paginated access.
A separate public-site pass covered all eight routes at both widths without broken navigation,
console errors or overflow. The final `/start` asset was rechecked at true 375px and 1280px:
the claim, first citation and attribution are visible; the local anonymous download returned
the exact bytes and digest below. These are bounded
local checks, not full UI acceptance across the [screen checklist](../docs/UI-SCREEN-CHECKLIST.md).

The rebuilt macOS arm64 Node archive from `c881624` is 14,554,602 bytes with SHA-256
`1038c43964f616d9b023c33432b45181f10bedf74eae3896b6d62eba46810fbf`.
Its manifest, relocated install, empty-garden search, first private-record creation and
`/`, `/review`, `/leaf/photosynthesis` and `/workflow` routes passed. It is a manual-extract
pilot requiring Node, not a signed or notarized native installer. Closed Canopy is excluded:
publishing requires a separately configured companion or hosted service. Live Vercel bytes,
Clerk/Supabase account isolation, two-account publication/withdrawal and remote private-agent
access remain acceptance gates in the
[release path](../.loop/MILESTONES.md).

### Earlier integrated candidate — 2026-09-30

[Draft PR #100](https://github.com/aacker71/foliage/pull/100) now contains the work-record
integration base, UI and review stack #90–#99, the promoted website source, the Workflow shell
repair and the selected-source handoff from #104. Exact source `1e677e8` passed local
`pnpm check`: 2,388 tests, zero failures or skips, plus architecture, egress, boundary and
typechecking. This is a source gate, not browser or production acceptance.

A macOS arm64 local archive built from that clean source is
`foliage-local-0.1.0-darwin-arm64-1e677e8.tgz` (SHA-256
`a2106f34337d45982884ca27d7e11556a55e54d2814f5e118ada5aa4177c1753`).
The package manifest and relocated extraction were verified; the installed app served `/`,
`/review`, `/leaf/photosynthesis` and `/workflow` from an owned local listener, and empty-garden
search returned the named `no-record` state. A public website download is being prepared in
[PR #102](https://github.com/aacker71/foliage/pull/102); the archive is not yet a live
installer or an outside-user installation receipt.

Read-only queries against the existing local garden returned cited private search results,
without a score; the default local MCP omitted `foliage_search`, while an explicit
`--allow-search` session exposed it and returned cited hits. This verifies local tool behavior
only. Hosted public-brain and remote private-brain provider acceptance remain open. Legacy
photo publication #78 requires a new v6 format because its v5 meaning collides with the
integrated named-view v5. The [release path](../.loop/MILESTONES.md) owns the remaining gates.

### Pending journey suggestions — isolated candidate, 2026-09-30

`codex/journey-pending-suggestions-20260929` changes the permitted journey maintainer
from direct private edits to cited pending suggestions in the existing workflow receipt.
Legacy grants cannot trigger provider calls. A new subject-specific consent, live
revocation check and caller-supplied session/schedule gate are required; without the gate,
the current workflow call is inert. The old `journey-maintain` write action is removed.
Unsupported numbers, uncited edits and highlight changes are refused before storing a
draft. No Leaf, résumé or publication is automatically changed. Focused tests, Leaf
typecheck, egress and boundary gates passed. The full repository gate remains required
on the latest integrated base.

This is not an accepted automatic update loop. Claude-owned workflow scheduling,
nonblocking atomic receipt persistence, Scarlet's pending-suggestion review/save path and
live provider/participant acceptance remain open. See the [handoff](../docs/execution/claude-codex-stack-handoff.md).

### Public brain implementation candidate — 2026-09-29

Draft PR #95 now connects the hosted Canopy entry to the shared pure search module and
the exact admitted publication projection. It serves direct-link JSON search and one
read-only MCP tool for an explicitly addressed published Leaf, and static export writes
an index beside each admitted Leaf page. A frozen publication artifact takes precedence
over the live tree. Owner-published pending-tier work is allowed; unreviewed/rejected
harvest candidates, private, excluded, example and unlisted work never enter discovery.
Search results are rebound to current page records and citations, with no score. Tests
cover page-anchor parity, withdrawal, replacement, static export and a real MCP SDK client
exchange. Local gate and relocated-package verification are required before merge;
deployed-host and participant acceptance remain open. Private brain CLI/MCP work is on a
separate candidate and must be integrated on its own merits. See [unit 35](specs/35-distribution-core.md#public-brain-transport--owner-decision-2026-09-28).

### PR #94 review corrections — 2026-09-29

Merged current #93 (`adcf3e8`) as `0bd1d53`, then removed the redundant manage footer and
withheld-response sentence, shortened new Work/import/setup/journey notices, and mapped citation
states exhaustively. Work uses the harvest's shared queue order and pause view; the duplicate
proposal branch/primary-draft card is removed. Startup and page reads no longer connect Scarlet,
and the collection timer no longer invokes direct journey writes. Grants/history remain.
Enterprise/dashboard reskin is isolated in `39d5dad` and can be removed independently pending
the owner's width-freeze decision. No actual garden migration or deployment occurred.

Focused regression checks: 55 passed, including a server startup/page-read/full-timer-cycle
check with a retained grant: no companion request, record edit or lost grant. Full post-review
`pnpm check`: 2,322 tests passed, zero failures or skips; browser bundles rebuilt. The
pending-suggestion maintainer and current browser acceptance remain open.
See [the current handoff](../docs/execution/claude-codex-stack-handoff.md). Older results below
are historical checkpoints.

### Shared UI/copy stack handoff — 2026-09-28

The isolated redesign is committed as `8ebfc3e` on `codex/radix-stack-integration`.
Merge `1e450ad` incorporates `origin/ui/less-text@bf4fe58` (#90), retaining the shared
component structure and incoming copy. Draft PR #94 requests Claude's merged queue stack and
startup/scheduling handoff. No queue migration, deployment or publication was performed.

Post-merge `pnpm check` passed (2,170 tests, no failures or skips). Website production
build/lint and the portfolio, workflow, hosting and explore bundles also passed. These gates
verify the merged code; browser acceptance and the revised journey implementation remain open.

The owner superseded the direct private journey-update behavior recorded below. Default
updates must become pending Scarlet suggestions for owner save/finalize/publish. Scoped
auto-publish requires its own explicit opt-in and policy enforcement. No startup transfer,
unsupported claims/numbers or delayed revoke is authorized. These are binding requirements,
not a claim that the implementation already meets them. See the
[ownership and consent contract](../docs/execution/claude-codex-stack-handoff.md).


### Radix application integration candidate — 2026-09-28

Isolated implementation: `~/.codex/worktrees/radix-hosted-release/foliage`, base
`1db3f7c` plus the recorded working diff. Shared controls/tokens/navigation now extend through
Work, connected portfolio setup/import, Workflow, local Photosynthesis, Canopy publication and
assessment/connection, standalone Review, public readers and organization administration.
Existing source, revision, consent and publication boundaries remain in place. The newer
journey-update backend is retained. Native forms remain native; Workflow/Hosting use Radix Tabs.

Final `pnpm check`: 2,167 passed, zero failures. Website production build/lint and Canopy Vercel
prebuilt packaging passed. Twenty-six local routes and their linked CSS were checked; this is
HTTP evidence, not browser acceptance. [Integration evidence](../.impeccable/review/remaining-surface-integration/verification.md)
and the [remaining acceptance work](../docs/execution/radix-integration-remaining.md) record the boundary.
[DESIGN.md](../DESIGN.md), its sidecar and UI adoption documents now describe this actual source.
The current review browser is unavailable during the owner's pending sign-in handoff. Current
visual/state review, finish verdict and deployment remain open; getfoliage.com was not changed.


### Scoped private journey auto-updates — 2026-09-28

Integrated `1084ef6` as `91542e7`. Final static gates passed after the disconnect guard.
Local companion and Leaf runtime now run the integrated code (`:56005` and `:64292`).
The prior Leaf PID was stale and its port was free; startup recovered it without replacing
another listener. Live Scarlet displayed Auto-update Off with an enabled opt-in button at
375px; document width was 375px and console errors were empty. The control was not submitted.
Capture: `/tmp/foliage-maintenance-browser/live-opt-in.png`. Unrelated UI files retained their
pre-integration hashes. Browse: DONE. No new durable learnings this session.

Implemented an off-by-default Auto-update control in Scarlet for one existing journey and
its explicitly listed retained records. The existing workflow store retains separate grants,
revocation and attempt receipts; its timer now invokes Jev with caller `scarlet`, then the
paired Fireworks collaborator only after keep. The existing locked authoring operation applies
cited statement replacements as agent edits with history/undo. Portfolio and résumé read the
same updated record. No source, attribution, visibility or publication operation is added.

Exact unchanged evidence is skipped across restarts; owner wording alone does not trigger a
rewrite. Stale documents, missing/excluded/foreign evidence and disconnects prevent writes.
Pending crash checkpoints become interrupted and cannot silently replay. Turn-off commits
through the existing serialized lane, so an in-flight update may finish before revocation.
One inference attempt per tick and bounded receipt history limit repeated provider work.

Verification: full `pnpm check` passed 2,157 tests (`/tmp/foliage-maintenance-check.log`).
After final disconnect/receipt refinements, 15 focused tests passed, including two update
cycles, canonical reader/résumé propagation, source preservation, manual correction, restart,
pass/unresolved, invented citations, stale writes, disconnected agent and native permission
commands (`/tmp/foliage-maintenance-targeted-final.log`). Models were injected protocol
responses over real Git evidence: this is not live TypeSafe/Fireworks quality acceptance.
Mobile browser inspection of the off/unconfigured state found no overflow; the enable action
was correctly disabled. Screenshot: `/tmp/foliage-maintenance-browser/opt-in.png`.

Remaining: automatic admission of newly captured work, new evidence-to-journey connections,
new journey creation, scoped automatic publication, live provider/host/participant cycles,
digests and hosted acceptance. This implements a private retained-evidence update loop, not
the complete capture-to-publication promise. No owner update permission was enabled in testing.

### One personal navigation for people and agents — 2026-09-27

*Superseded 2026-10-08: the shipped rail is Home, Work, Review, Portfolio and Sources, with
Scarlet under More; see [UI context](ui-context.md).*

Workflow now uses Portfolio / Scarlet / Sources and a native More disclosure at both desktop
and mobile widths. Removed the separate sidebar, duplicate brand and mobile-only navigation.
Collection leads with status and its relevant action; schedule opens for first setup, while
processing and history remain inspectable. Overview has one next-step action and collapsed
status details. Native links, named landmarks, current-page state, labeled fields and busy
state remain accessible to people and browser agents. No new agent API or authority was added.

`a048e9c` integrated as `cd081ff`, served at `:64292`. Leaf typecheck, workflow build and
47 focused navigation/transport/studio tests passed. Browser checks covered 1280px and 375px,
source search/selection, view focus, More, schedule mouse/keyboard disclosure, review and
first-schedule empty state. No horizontal overflow or console errors in these checks. Screenshots:
`/tmp/foliage-simple-shell-browser/`. No owner settings changed; unrelated working edits retained.
Browse: DONE. No durable learnings this session. Agent-host task completion remains untested;
this verifies browser accessibility and navigation, not autonomous portfolio maintenance.


### Scarlet, Sources and portfolio copy reduction — 2026-09-27

Scarlet now leads with the selected journey and conversation; Highlights, Collection and
Email are native disclosures. Pending highlight proposals remain expanded. Settings fragment
links open their target, including back/forward navigation. Cloud transfer scope stays beside
Send; unavailable connection details remain inspectable. Sources uses compact provider rows
and moves Scarlet connection controls below them. Portfolio drops repeated explanatory copy
and preserves the person's actual work, introduction and citations.

Implemented in `8e7000c` and `801b2a3`; integrated locally as `ac3ffc5` and `20d6334` on
`:64292`. Leaf typechecking, workflow bundle build and 138 focused tests passed; navigation
checks passed again after the final spacing fix. Desktop 1280px and mobile 375px browser
inspection found no horizontal overflow on the changed surfaces. Collection disclosure click,
keyboard Enter and direct `#updates` navigation worked. Headless Chromium could not create
WebGL; readable records remained available. This is not 3D or launch acceptance. Screenshots
are in `/tmp/foliage-quiet-browser/`. Existing unrelated UI edits were preserved; three
pre-existing eyebrow removals were incorporated in the implementation commit. No source
permissions, saved work or cloud requests were changed during inspection.

Browse review: DONE_WITH_CONCERNS (WebGL unavailable in the test browser).
No durable learnings this session.


### Jev compact controls — 2026-09-27

Owner found the first minimal pass still wordy. Jev now shows a compact source row and
permission control; Back, duplicate state text and persistent Source/Review/History labels
are removed. Accessible overflow disclosures retain metadata and receipts. The first enable
still reveals the exact cloud-transfer scope before granting future collection permission.
Native grant/revoke and expanded source details passed at 375px with no overflow or console
errors in an isolated real-Git workflow. Three workflow tests, six stylesheet checks and Leaf
typechecking passed. Actual source permissions were not enabled by this UI change.

### Minimal interface and separate applications — 2026-09-27

*Partly superseded 2026-10-08: personal navigation is as recorded in [UI context](ui-context.md),
and on the website the business previews keep a switcher among themselves again (#157).*

Owner direction: remove descriptive interface copy across pages; keep personal and enterprise
application journeys separate. The shared personal shell now exposes Portfolio, Scarlet and
Sources, with advanced personal tools under More. Scarlet, Jev, source collection/review,
introduction/style/journey/collection editors, résumé, overview, policy and publish preview
use short labels and named disclosures. The person's own work and citation content remain.
Action-specific transfer scope and error/recovery information remain available.

Website prototypes no longer provide an in-workspace switcher between Individual, Hosting,
Recruiter, Organization and Member. Each keeps its own entry and sections; the public catalog
still lists applications. Enterprise retains only company administration navigation. Hosted
personal and recruiting shells remain separate, with shorter onboarding and publication copy.
No auth, storage, agent permission or publication boundary was changed. The member app remains
an unconnected prototype, not a completed enterprise runtime.

Browser review: 14 personal routes/views at 1280px; Scarlet, sources, editor, résumé and Jev
at a verified 375px viewport, without horizontal overflow. No enterprise/recruiting navigation
links were found in these personal pages. Personal and Organization prototypes were separately
inspected at 375px; no cross-app switcher. Jev grant/revoke worked in a disposable workflow
using real Git history, with no provider credential and no real source grant enabled. The
personal page review used a disposable copy of the actual Leaf. Captures and route receipts:
`~/.gstack/projects/aacker71-coeadapt-dev-master/designs/minimal-separate-apps/`.

The headless browser could not create WebGL for the portfolio; its readable fallback stayed
available. This is not 3D visual acceptance, hosted-provider acceptance or a full review of
all legacy/error states. No new durable browser-workflow learning was found.


Verification: full `pnpm check` passed, 2,150 tests, no failures
(`/tmp/foliage-minimal-acceptance.log`). Website lint/build passed. Four integration-worktree
transport/authoring checks passed after merging while preserving five pre-existing user edits.
Integrated UI commit: `046ee97` (`30af532` in launch-completion). Local app restarted at
`http://127.0.0.1:64292`; the live Jev page returned 200 with the new navigation and no console
errors. Hosting/enterprise changes are in the integrated source; no production deployment was
performed. This closes the shared UI simplification pass, not the outstanding launch goal.

### Photosynthesis Jev source permissions and collection caller — 2026-09-27

Implemented `/workflow/jev`, linked from journey settings, for disclosed per-repository
commit-title selection. Saved grants, revocation and decision attempts live in the existing
workflow file. The composed collector now calls the shared Jev operation only for permitted
sources after local collection. Exact unchanged inputs reuse decisions; missing provider
configuration stays unresolved; interrupted attempts remain visible and require manual retry.
Source removal revokes its grant and reconnecting does not restore it. Pass never dismisses
the draft or deletes source history; no journey/portfolio/publication mutation is added.

Full `pnpm check`: 2,150 tests passed, zero failures (`/tmp/foliage-jev-source-check.log`).
Eight focused workflow checks passed, including restart, retry, unchanged-input reuse,
source removal, scope refusal and HTTP origin gates. Provider replies in these tests are
injected protocol fixtures, not model accuracy or live TypeSafe acceptance.

Browser checks used an isolated workflow populated from actual repository history, with
provider credentials absent: grant and revoke persisted; the 375px viewport reported a
375px document width; no console errors. Desktop/mobile captures are under
`~/.gstack/projects/aacker71-coeadapt-dev-master/designs/jev-source-selection/`.
No real source grant or private TypeSafe transfer was enabled during verification.
No new durable browser-workflow learning was found in this bounded review.

Integrated as `56a30d5` in `codex/live-portfolio-integration`; local runtime restarted and
both `/workflow/jev` and `/leaf/scarlet` returned HTTP 200. Existing unrelated UI edits were
preserved byte-for-byte. The previously supplied TypeSafe test key was restored to the
private local app environment (never the repository). A subsequent explicit readiness call
using only a short product-thesis excerpt completed on `jev-1.13.0`; the application's
conservative confidence gate retained `unresolved / model_uncertain`. This confirms provider
connectivity, not model accuracy or an automatic source-selection cycle. Receipt:
`~/.foliage/local-app/jev-readiness.json`, checked `2026-09-27T20:12:42.661Z`.
The running app still had zero source grants and zero workflow decision attempts.

Remaining: Scarlet-specific admitted journey permissions/caller, richer artifact selection,
evidence connection and automatic authoring, hosted acceptance, digest delivery and participant
cycles. This closes the local repository-title caller slice, not the full six-part launch goal.

2026-09-23 recruiting separation: owner requested that recruiting stop interrupting the
personal journey. Canopy now has a dedicated `/recruiting` entry, portfolio connection/search
pages and delivery receipts. Personal `/manage/:id/share` contains only live portfolio and
cited résumé links and makes no recruiting-provider reads. Recruiting has its own navigation
and Clerk sign-in copy/return paths. Legacy browser distribution links redirect after access
checks; existing device endpoints retain their contracts. No new permissions or evidence store.

Browser evidence is a clearly labelled, disposable UI protocol preview with no customer data
or live providers. Personal sharing and recruiting empty states were inspected at 1440px and
375px, with no horizontal overflow; recruiting detail has no personal-workspace links.
Screenshots: `~/.gstack/projects/aacker71-coeadapt-dev-master/designs/recruiting-separation/`.
This is local UI/routing acceptance, not a hosted deployment or actual ATS delivery.
Validation: 47 focused Canopy routing/Clerk checks passed, including ownership, CSRF,
legacy redirects, device compatibility, and no recruiting reads on personal pages. Integrated
`pnpm check` passed static gates and 2,140 of 2,141 tests; its sole failure was a missing
generated Leaf explorer bundle in the new checkout. Building `@foliage/leaf-app explore:build`
resolved it and the failing `leafletRevision.test.ts` passed on rerun. No test assertion was
weakened for that failure. Logs: `/tmp/foliage-recruiting-check-final.log` and
`/tmp/foliage-recruiting-leaf-setup.log`. The full suite was not rerun after generating that
optional browser artifact. Sharing/recruiting preview pages reported no console errors.

2026-09-23 launch execution: the owner accepted retaining all six first-ten-developer
outcomes: automatic work-record/portfolio/résumé maintenance; hosted identity and publication;
installation and OpenClaw writes; weekly/optional daily delivery; coherent reviewed UX;
and real participant/reader acceptance with recovery and isolation. Work is isolated on
`codex/launch-completion`, based on `6881e8c`, preserving concurrent integration UI edits.
Engineering review is in progress; design review and implementation acceptance are pending.

Architecture finding 1 (source-verified, not an observed customer data-loss incident):
`savePresentation` rejects a stale document revision, but claim updates retain only the
current ID, kind, text and citations. The `actor` argument records style edits, not statement
authorship/correction history. A later authorized agent reading the new revision can replace
owner wording without knowing it was corrected. The owner selected option B: authorized
automatic maintenance may rewrite manually edited wording, retaining private edit history
and undo. The canonical writer and local recovery path are now implemented (see below);
automatic-loop acceptance remains pending. The complete remedy includes restart-safe recovery, exact citations, stale/conflict
refusal and a second automatic cycle after a manual edit. Publication authority remains
separate. Unit 11 owns this addition; no competing narrative store is introduced.

Product center: the living private work record. The launch goal is a live, automatically
maintained portfolio and résumé projected from that record. Collection, evidence linking,
achievement drafting, support checks and approved-scope publication should form one update
loop. Manual statement checking is a diagnostic entry point, not the everyday workflow.

### OpenClaw write and update acceptance — 2026-09-23

Two actual OpenClaw 2026.8.1 embedded Codex turns now exercised private journey creation
and statement update around a manual correction in a disposable garden of real Git evidence.
Stable journey/claim IDs and exact citations survived; private history retained the owner's
correction. Fresh-process inspection confirmed the same updated words in the journey, live
résumé and Markdown résumé. Three successful MCP write receipts explicitly report no
publication. The first turn recovered from two refused context selections; the second had
zero tool failures. Full receipts, scope and remaining gaps are in the
[acceptance record](../docs/acceptance/2026-09-23-openclaw-authoring.md).

No global host settings or actual user portfolio were changed. This accepts local host
authoring, not unattended source collection, Jev selection, hosted Scarlet or publication.
The shared Jev adapter still needs saved revocable pool transfer grants, durable receipts,
and actual capture/conversation callers. The six-part launch goal remains in progress.

### Recoverable journey revisions — 2026-09-23

Implemented owner decision B in the canonical Leaf/editor: title and claim changes retain
private before/after versions, actor and time. Manual and MCP writes share this operation;
unchanged retries do not append history. The private History and undo page restores a recorded
version through the existing revision-bound lock and logs the restoration. Exact references
survive; missing/stale/excluded support refuses restore instead of inventing replacement proof.
Public projection omits the history and the public parser rejects injected history.

Full `pnpm check`: 2,148 tests passed, zero failures (`/tmp/foliage-history-check-final.log`). Focused
authoring/publication tests passed eight checks including a fresh-process restore and a second
agent-labelled write after the owner correction. These are writer protocol tests, not a real
OpenClaw/model cycle. Browser restore ran against an isolated copy of the actual portfolio;
desktop and real 375px viewports had no horizontal overflow, and console errors were empty.
Captures: `~/.gstack/projects/aacker71-coeadapt-dev-master/designs/journey-history/`.
The original portfolio was not edited or sent to a provider. Durable Jev grants/receipt storage,
actual collection/conversation integration and unattended maintenance remain outstanding.
History-cap archival is also unfinished; the writer refuses at its limit instead of evicting
earlier words. Existing runtimes must be upgraded together for the new private document field.

### Jev shared decision foundation — 2026-09-23

Owner clarified Jev is required in both Photosynthesis and Scarlet. The shared agent contract
now makes keep/pass purpose-specific and preserves failures/pivots, source history, private
context and separate action grants. Pool configuration taxonomy is still open.

Extracted the existing TypeSafe transport without adding a provider or runtime. Statement
support now uses it. Added a shared exported pool decision operation with exact transfer
binding, minimized provider payloads and private receipts. Missing configuration, malformed
provider output, conflicting decision/reason and uncertain results remain unresolved. This is
an implementation foundation: no pool UI, background decision loop, durable receipt storage,
Scarlet conversation invocation or new cloud transfer is claimed. Unit 16 lists remaining
integration work. Focused protocol checks cover both caller labels and statement-check
regressions; these injected responses are not evidence of model accuracy or live acceptance.

Validation: full `pnpm check` passed 2,146 tests, zero failures, including the static gates
(`/tmp/foliage-jev-check-final.log`). Focused Jev/claim checks passed 10 tests and renderer
checks passed 12. The first full run exposed two renderer-test assumptions that recent real
commit titles were distinct; cherry-picked commits contradicted that assumption. Those
text-presence/order probes now select distinct real titles; renderer behavior was unchanged.
No live TypeSafe request, private source transfer, hosted deployment or browser UX change
was performed in this slice.

2026-09-23: incorporated the owner's cadence decision: weekly summary by default, with an
additional daily digest if the user wants it. Both can be disabled independently. The existing
Canopy account notification form and preference row now persist both choices; email/SMS
opt-outs and local collection/publication settings are preserved. Older channel-only SQL
saves retain cadence. No summary is scheduled or sent by saving a preference.

`pnpm check` passed with 2,136 tests (`/tmp/foliage-summary-check.log`). Four disposable
Clerk/SQL tests passed, including actual migration defaults, round trips, opt-outs, role
restrictions and account isolation (`/tmp/foliage-summary-sql.log`). A disposable browser
protocol preview exercised daily opt-in, save and refresh while email remained off. Final
visual acceptance is incomplete: the preview initially lacked imported token assets, then
the shared browser session reset. Do not treat that capture as approved production UI.

Apply `202609230002_summary_preferences.sql` before deploying this code. No hosted migration
or real account preference mutation was performed. Summary generation, digest-window dispatch
and live email delivery remain unfinished and are labelled unavailable in the UI. The
notification contract and unit 22 own that remaining work; no second settings store was added.

2026-09-23: added `/leaf/scarlet`, an owner workspace for improving the real retained
journeys and curating their cited Leaflets. The existing paired Canopy companion now sends
selected, disclosed context through Scarlet's configured Fireworks transport. Replies can
propose editable statement revisions or highlight order; only the existing revision-bound
local editors apply them. Collection preferences reuse the workflow scheduler. Email uses
the existing hosted account settings rather than a second local preference store.

Installed and tested on the integration checkout at `127.0.0.1:64292`, paired with the local
Canopy companion at `127.0.0.1:56005`. A real cloud reply asked about the owner's personal
judgment and AI contribution in the first journey; no text or highlights were changed.
Conversation survived navigation and refresh (bounded in-memory scratch, two-hour lifetime;
not durable across app restart). The actual Foliage repository is connected as a collection
source; no collection schedule was enabled. Desktop and actual 390px mobile checks found
no horizontal overflow; the workspace had no browser console errors.

`pnpm check` passed with 2,136 tests, zero failures, including exact citation/claim bounds,
atomic revision application, stale-edit rejection, collection-settings persistence and
unknown transport outcome handling. Log: `/tmp/foliage-scarlet-workspace-check.log`.
This is a bounded unit 17 implementation, not full streaming or hosted-agent acceptance.
This installation still lacks a hosted account destination for email. Daily/weekly email
digests, unattended narrative maintenance and automatic public updates remain unavailable.

2026-09-23: read and preserved the complete owner-pasted
[Foliage — Language & Product Framing](product-thesis.md), replacing this turn's preliminary
summary in the same reference file. Aligned overview, architecture, UI, workflow, Leaf,
Photosynthesis and the existing build plan around the work record as product and portfolio/
résumé as projections. Captured grounded pride, meaning, the builder's journey, optional
daily/weekly reflection, meaningful compression, evidence classes and bounded work-value
estimates. The broader Leaf ontology is an explicit unresolved schema decision; no identity
or format changed. The founder's real journey plus an independent reader is the product test.
The Library's remote identity remains unverified, but full-text capture no longer depends on
that link. This is saved direction and context alignment, not implemented feature acceptance.
The existing gbrain thesis page was updated in place with the full text and its earlier
history preserved; a future-session memory note points to this source. Architecture coverage
and local-link checks passed (66 context documents); whitespace checks passed. No runtime
code changed and no new feature or live-provider acceptance is claimed by this documentation pass.

2026-09-23: implemented the first [distribution integration](../docs/DISTRIBUTION-INTEGRATIONS.md)
in Canopy. Public cited resume HTML/Markdown derives only from the current admitted publication;
private sharing has an account picker, candidate search, exact preview and delivery receipts.
Ashby through Nango can add one portfolio note and read it back after an uncertain response.
The existing Supabase authority owns the new one-time receipt state; withdrawal/replacement
cancels prepared deliveries. Duplicate sends, stale content and foreign-account reads/writes
are refused. Clerk session bridging covers the new private delivery routes.

This is a bounded slice of units 35/36: the owner must also control the destination connection.
Standing automatic updates, cross-actor recruiter grants, inquiries, more adapters and Juicebox
supplier feeds remain unimplemented. No production migration, external delivery or partner
agreement was performed. `pnpm check` passed with 2,129 tests; the additional disposable
Postgres contract passed seven tests, including uncertain-write recovery, isolation,
withdrawal, repeat-send protection and provider-outage fallback. Logs:
`/tmp/foliage-distribution-check.log`, `/tmp/foliage-distribution-sql.log`.
The browser flow reached candidate search, preview, send and receipt using protocol substitutes;
sharing and public résumé fit an actual 390px viewport. Deployment packaging and architecture
coverage passed. These checks do not establish a live provider round trip or production readiness.

2026-09-23: designed [portfolio distribution](contracts/portfolio-distribution.md) as an extension
of existing Canopy publication/authority, Nango connections and durable operation infrastructure.
The four paths are opt-in public discovery, direct views/cited exports, customer-authorized
ATS/CRM delivery, and contracted supplier feeds. The contract specifies scoped automatic
updates, pinned submitted resumes, inquiries, receipts, identity binding, unknown-outcome
reconciliation and honest external-copy/removal limits. Juicebox paid MCP is not supplier
admission; an agreement and actual ingestion acceptance remain external requirements.

Updated application ownership, overview, UI context and discovery unit. Added bounded units
35–37 and moved complete-product release acceptance from 35 to 38. Direct sharing can ship
without a directory, employer API account or data partnership; every advertised external
capability still needs its own live evidence. This is architecture/specification work only:
no integration code, partner contact, profile transfer, deployment or acceptance claim.
Architecture coverage and context whitespace checks passed. Full `pnpm check` passed with
2,123 tests, zero failures; `/tmp/foliage-distribution-architecture-check.log`. These checks
validate the current candidate, not the proposed destination integrations.

2026-09-22: resolved the OpenClaw embedded-agent startup failure. Its 2026.8.1 default
configuration selected no harness during early plugin preparation (`memory-core` only),
then later selected Codex and failed on the absent registration. The official Codex plugin
was already installed/enabled. Declaring the same runtime with
`agents.defaults.models["openai/*"].agentRuntime.id = "codex"` makes preparation load
`codex` and `memory-core`; no model/provider change or approval relaxation was needed.

A real embedded OpenClaw turn now calls `foliage_import_context` against the selected
`alex-a` Leaf. The terminal receipt records that tool, no reroute, no aborted run and zero
tool failures. A real Codex task also called that MCP tool successfully. Reproduction:
`/tmp/foliage-openclaw-registration-regression.mjs` asserts the old/fixed startup plans
and the successful live receipt. Logs: `/tmp/foliage-openclaw-registration-regression.log`,
`/tmp/foliage-openclaw-tool-acceptance.log`. This supersedes the missing-registration
blocker below. Host-driven achievement writes, scheduled maintenance and approved-scope
publication remain unaccepted; read-only host execution alone does not establish them.
Full `pnpm check`: 2,123 passed, zero failed; `/tmp/foliage-openclaw-recovery-check.log`.

2026-09-21: installed the shared Photosynthesis skill for all three launch coding hosts.
Claude Code now uses this integration checkout instead of the stale Caracas marketplace,
loads plugin 0.2.0 and reports its fixed local MCP connection connected. Codex has the native
local plugin installed/enabled and the same seven-tool MCP configuration. OpenClaw reports
the skill eligible/model-visible and a live MCP probe discovers all seven tools without
diagnostics. Installed skill bytes match the shared source in all three hosts.

A real OpenClaw agent attempt still fails before model/tool execution: its prepared run
reports the Codex harness registration missing. The official compatible
`@openclaw/codex@2026.8.1` was installed, pinned and enabled; plugin inspection reports
loaded, but a fresh local agent retry returns the same registration failure. The configured
Gateway is not running. No provider switch, global permissions relaxation, background service
or portfolio mutation was used to disguise that failure. Log:
`/tmp/foliage-openclaw-host-acceptance.log`. Fresh Codex task execution and a successful
OpenClaw host turn remain acceptance gaps; these installations do not establish unattended
portfolio updates. Plugin/skill validators pass. Full `pnpm check` passed with 2,123 tests
and zero failures; log `/tmp/foliage-host-plugins-check.log`.

2026-09-21: added the missing local agent authoring path. Explicit `--allow-achievements`
exposes bounded selected context and achievement/statement writes through the existing locked
editor. A real stdio MCP client created and revised a cited statement, preserved source records
and the personal introduction, rejected stale/foreign/invalid-citation edits, and verified that
the live and Markdown résumé consume the same canonical achievements. The installed OpenClaw
skill now describes this workflow, preserving its runtime/garden binding. This is transport
acceptance, not a successful OpenClaw agent conversation or unattended publication. Default
MCP permissions remain observation-only. Full `pnpm check`: 2,123 passed, zero failures;
log `/tmp/foliage-agent-achievements-check.log`. Focused log: `/tmp/foliage-agent-achievements-focused.log`.

2026-09-21: the private résumé now projects canonical achievements and citations and reuses the
existing live reader to follow document changes. Markdown download reflects the same source.
Jev support checks are wired into private statement/achievement authoring with selected-excerpt
consent, exact revision checks, fixed egress, safe provider failures and no evidence/publication
writes. Three real TypeSafe calls through the application route distinguished supported,
contradictory and insufficient-context protocol claims against public SDK documentation; no
private career material was sent. Desktop and 390px browser checks confirmed live statement
replacement, no horizontal overflow and no console errors. The actual local Leaf has collected
work but no authored achievements at that checkpoint; its résumé correctly remained empty.

2026-09-23: the missing journey authoring slice is implemented in the canonical achievement
model. Optional intent, decisions, roadblocks/responses, pivots, discoveries and lessons now
flow through the existing locked manual/MCP editor, exact citations, private portfolio and
résumé, publication admission, and distribution projections. Shared labels prevent separate
reader vocabularies. The Foliage host skill describes evidence-grounded authoring, stable IDs,
owner corrections and unresolved work rather than manufacturing a heroic ending.

On the owner's actual bound garden, a fresh real stdio MCP connection created three private
accounts with 23 cited statements from retained Foliage Git references and inspected local
commit records. The original 235 Leaflets, proof tiers and introduction were preserved, with
a private pre-edit backup. These are AI-authored draft accounts of recorded project changes,
not independently established personal authorship, customer outcomes or measured impact.
No publication, cloud assessment or background schedule was enabled. User data stays outside
the repository. This supersedes the earlier empty-achievement observation, not the remaining
automatic-maintenance or independent-reader acceptance gaps.

Browser acceptance used the updated local runtime on loopback: portfolio links opened the
authored journey, the editor offered all categories, and the résumé rendered the same three
accounts and 23 statements. The journey and résumé had no horizontal overflow at 390px;
the journey also passed at 1280px. A discovered CSP mismatch was fixed by limiting the
presentation-editor script to the editor; journey, editor and résumé then reported no console
errors. The headless portfolio's WebGL context was unavailable; the readable fallback worked.
Existing long-running app/MCP processes need a restart/reconnect before consuming the expanded
claim enum. An already-open host connection refused the new document; a fresh connection
accepted it. Do not call that older connection upgraded or call this an unattended host run.

Validation for this slice on `codex/live-portfolio-integration`: full `pnpm check` passed
2,130 tests, zero failures (`/tmp/foliage-journey-check.log`), including architecture, boundary,
egress, duplication and TypeScript gates. Focused MCP/domain/distribution run passed 19 tests
(`/tmp/foliage-journey-focused.log`). Regression coverage includes all journey categories,
source preservation, stale-write refusal, stable statement updates and the read-only CSP fix.

Remaining critical path: automatically maintain achievement drafts from approved sources,
connect new evidence to existing achievements, feed both reader formats, then apply explicit
project-scoped publication grants with receipts and recovery. OpenClaw host acceptance,
provider decision calibration and durable run history remain open. This slice is not acceptance
of the whole automatic loop. Full repository check: 2,122 passed, zero failed; log
`/tmp/foliage-live-resume-check.log`. Final focused check: `/tmp/foliage-resume-final-focused.log`.

2026-09-21: OpenClaw launch installation slice implemented in the existing Foliage skill.
Fixed its YAML frontmatter and added a bundled Photosynthesis doctor/status/refresh adapter
with explicit runtime/garden binding. No additional candidate store or host configuration.
The actual `npx skills add` local-checkout command installed successfully into a temporary
OpenClaw workspace; the installed adapter passed doctor and refreshed real Git history.
Focused tests passed source-selection refusal and repeat-refresh/private-state checks.
OpenClaw itself was not on PATH, so a live host conversation is not verified. Runtime
bootstrap, background enablement, scoped automatic publication and Jev remain outstanding.
The skill installer does not install the Foliage runtime. Nothing was deployed or published.
Full `pnpm check` passed: 2,117 tests, zero failures; log `/tmp/foliage-openclaw-check.log`.

2026-09-20: populated-image verification completed for the private reader and style editor.
Both now share image rendering (caption, description, format checks and provenance facts).
Preview selection stays inside the selected named Leaf and prefers an attached image. Panel-width
media uses the actual panel gutter at each breakpoint; missing bytes show a recovery message,
including after live refresh. An isolated temporary document used the existing specimen artwork,
explicitly labeled as an interface check, through the real metadata-stripping store. Desktop and
true 390px browser checks showed decoded images and no horizontal overflow; contained/compact
controls also worked. Removing/restoring the object exercised failure/recovery. Private media
returned 200 and the public route returned 404. This does not establish hosted media publication,
3D rendering or a user's career evidence. Full `pnpm check`: 2,115 passed, zero failures.
Next: persisted motion preferences, cloud Scarlet customization, then hosted publication rehearsal.

2026-09-18: the private style editor now previews and saves four supported dimensions:
typography, reading rhythm, source palette and compound-leaf layout. Portfolio → named Leaf →
Leaflet inheritance, revision-bound undo and the bounded manual/agent history all use the same
operation. Reviewed publication carries the resolved presets for admitted scopes and omits the
private history. Private browser verification covered save/reload plus a true 390px viewport:
quiet colors and linear reading persisted, the three-source legend remained present and the page
had no horizontal overflow. Public projection and renderer seams cover the same contract; hosted
published-browser acceptance was not performed. Rich media/hero composition, persisted motion
settings and history for non-style edits remain.

2026-09-18: the same presentation operation now controls introduction composition and framing for
already admitted evidence images. Editorial split/focused stack and contained/panel-width media
round-trip through live preview, undo/history, local assistant edits, named-view inheritance and
public projection. The preview uses a real retained image when one exists and otherwise states the
empty condition; framing cannot select or publish media. Local browser verification confirmed
save/reload at desktop width and a true 390px viewport with no horizontal overflow. The rehearsal
Leaf contained no media bytes, so real-image visual acceptance remains open.

2026-09-17: selective leaf shapes now extend from the approved Open Design direction into
the native portfolio: shared primary actions, opposing timeline-panel corners, Canopy
publication actions, and a direct Look & feel entry point. Inputs and secondary links stay
quiet. The next implementation sequence is recorded in `specs/24-public-portfolio.md`:
live customization preview with named-view inheritance and undo, cloud Scarlet using the
existing operations, real relationship context, then hosted end-to-end acceptance.

Validation for this slice: full `pnpm check` passed 2,115 tests with zero failures;
`git diff --check` passed. Local browser checks at 1440px and 390px found no horizontal
overflow; the primary action measured 44px high on mobile. The existing style editor
remained reachable. The headless browser could not create a WebGL context, so these checks
cover the readable portfolio fallback, not acceptance of the 3D rendering. No deployment
or push was performed. Check log: `/tmp/foliage-leaf-shape-final-check.log`.

2026-09-15: the four-step live-portfolio plan has an integrated local candidate and real-data
rehearsal evidence. Cloud evidence transfer approval and hosted-service acceptance remain open.
The six-file context package and its 35 ordered units remain the canonical broader plan.

## Candidate

`codex/live-portfolio-integration` in the adjacent integration worktree:
`9797a78` preserves original changes; `c2e574c` integrates the achievement portfolio;
`b1d6064` reconciles packaging lineage. The original `codex/canopy-cloud` checkout and real
Leaf document remain unchanged. The integrated tree has seven application packages and
12 owned application/surface architectures. Public writer, reader and export use format 5.

## Four-step execution

| Step | Verified locally | Still required |
|---|---|---|
| 1. Integrate | Local source/cell/assistant work, achievement portfolio, website, hosted adapters and packaging reconciled; full `pnpm check` passed 2,094 tests | Deployment acceptance belongs to configured services |
| 2. Actual evidence through local/cloud review | Real Git intake → reviewed private Leaflet; local/cloud UI distinction; Fireworks benign inference HTTP 200 | Approval for bounded evidence-bearing cloud rehearsal; hosted Ladybug conversation |
| 3. Portfolio presentation | Achievement and exact résumé citation authoring, named Leaf view, private/public Three.js, newest ordering, motion control and real mobile layout | Owner biography/media/claim approval; broader accessibility and visual acceptance remain unit-specific |
| 4. Repeat updates | Two real commits update the same record, preserve authored content, reject stale edits; local publication replacement retains URL and withholds other private records | Internet publication and notification/provider acceptance |

[Acceptance record](../docs/acceptance/2026-09-15-live-portfolio.md) contains candidate
provenance, source-preservation evidence, exact check log, private rehearsal artifact locations,
observed browser limitations and remaining gates. No personal capability score is produced.

## Documentation and architecture

The complete supplied methodology README was read in the prior documentation unit. Six
context files, twelve application records, five shared contracts, 35 ordered units and all
38 required acceptance rows remain accounted for. Duplicate broad architecture narratives
are migration pointers with their historical content retained. The architecture checker
continues to enforce package coverage, links, dependencies and acceptance mapping.

The prior twelve negative controls established checker failure behavior. They do not need
repeating to claim this integration. Current runtime results come from the candidate checks
and rehearsal record, not inherited sibling test counts.

## Hosting verification

Vercel preview is configured and protected. The owner selected Clerk SSO on 2026-09-15,
superseding the earlier Supabase Auth login choice. Latest runtime `e881d25` is deployed as
`dpl_8NLwoT2JPiNTA4es76wtQoWNKU3R` (Ready, Node 22, `iad1`) at
https://foliage-canopy-preview.example.invalid/manage .
Production was not promoted and no Git push occurred.

Live browser acceptance: Google sign-in reached the private workspace; an existing Clerk
session skipped sign-in; sign-out and sign-in again both completed. The browser was left
signed in. A real browser test exposed and corrected the legacy no-referrer/form Origin
conflict on private pages. Public portfolios retain no-referrer and no Clerk scripts.

The dedicated free Supabase project `foliage-canopy-preview` (`ilxdoyfwspgoupxtyirg`) stores
private objects and authority. All three migrations, including issuer-scoped Clerk actors,
are applied. Live actor RLS/role checks deny browser reads and actor creation. The real login
created one internal Clerk actor, no Supabase Auth user, no reserved portfolio and no public
revision. Existing projects and original source evidence were not changed.

Full `pnpm check`: 2,101 passed, zero failed. New disposable actor SQL checks: three passed;
previous publication/notification SQL suites: 17 passed. See the
[Clerk SSO acceptance record](../docs/acceptance/2026-09-15-clerk-sso.md) for exact scope and
logs. Earlier integration evidence remains in the
[live portfolio record](../docs/acceptance/2026-09-15-live-portfolio.md).

Remaining hosted gates: live acceptance of the implemented Clerk device connection, Clerk-aware
Novu contact resolution, live second-account/recovery acceptance, and owner-approved
publish/update/withdraw. Legacy password device endpoints refuse explicitly. Clerk remains
a development instance; production identity configuration is separate work. Secrets stay
outside the repository. No owner portfolio was uploaded or published.

## Resume here

Unit 01 has local acceptance evidence. Use the existing dependency graph for hosted identity,
storage, notifications, governed agents and evaluation. Reuse the integrated adapters.
Do not recreate them because older branch notes say they are absent.

Pending release inputs are recorded in the [deployment contract](contracts/deployment-and-service.md#release-inputs-versus-design-decisions).
A provider key alone does not approve evidence transfer or residency. No production launch,
external message or original portfolio publication was performed. Keep the cloud rehearsal
approval pending until the owner answers; continue independent local work where useful.

### Clerk account controls — 2026-09-15

Preview runtime `eb5a41c` adds the signed-in Clerk name/avatar menu and account dialog.
CLI 3.3.0 links the requested application; doctor reports no failures (development-instance
and optional shell-completion warnings remain). Full `pnpm check`: 2,101 passed. Live browser
verified account menu and Google-connected profile dialog. See
[Clerk acceptance](../docs/acceptance/2026-09-15-clerk-sso.md) for deployment and remaining gates.

### Hosted onboarding correction — 2026-09-15

`ac236e7` removes manual address reservation from the browser start, derives the address from
a validated export, and reuses ownership/admission/explicit publication gates. Empty addresses
show the same guided import rather than exposing internal identifiers. GitHub verification and
settings use optional disclosures. `f11382d` compacts the layout after live browser inspection.
Full `pnpm check` passed 2,103 tests; focused hosted/Clerk checks passed 38. Logs:
`/tmp/foliage-onboarding-check.log`, `/tmp/foliage-onboarding-focus.log`. Live preview verified
the existing `foliagetest` page and keyboard disclosure. No evidence was uploaded or published.

This is an interim import improvement, **not completed consumer onboarding**. Automatic
Photosynthesis connection, native installation/discovery and a no-file first portfolio remain
the product-critical gap. The UI states connection unavailability instead of offering a dead
Connect button. Full mobile/contrast acceptance and a real user-approved import remain open.
The scope extends [publish handoff](specs/13-publish-handoff.md), not a parallel architecture.

Final preview runtime `f11382d`: `dpl_7hm8vSLMerNEGDvNx6jdCrCMCrRt` is Ready and
assigned to the stable preview alias. Browser inspection confirmed the import action fits
within the current desktop viewport, account controls remain available, and technical details
are collapsed. The browser remains on the owner's existing unpublished portfolio.

### Click-through Photosynthesis connection — 2026-09-15

Runtime `e881d25` replaces the primary import action with **Connect my work**. The local
companion discovers the configured Canopy origin, reuses Clerk SSO, and accepts a
verifier-bound, session-checked device grant lasting at most one day. Private preparation
leads to a rendered preview and explicit Publish; password entry, proof-coordinate JSON
and typed identifier confirmation are absent from this path. Export import is secondary.

Full `pnpm check`: 2,106 passed, zero failed; focused identity/connection checks: 42 passed.
Logs: `/tmp/foliage-handoff-final-check.log`, `/tmp/foliage-device-focus.log`. Preview
`dpl_8NLwoT2JPiNTA4es76wtQoWNKU3R` is Ready at the stable alias. Read-only deployed probes
returned 401 for unauthenticated device access, 404 for an unpublished leaf, and 200 for the
discovery script. Vercel preview protection remains enabled. Its automation credential is
kept outside the repository and used only by the local companion against the configured host.

The companion runs at `127.0.0.1:4180` using the existing isolated real-data pilot and shipped
publication policy. Discovery succeeds for the configured origin and refuses an unrelated
origin. Live **Connect my work** reached the browser's local-service permission prompt;
approval of that prompt and the account connection is pending. Successful live grant storage
and a full first-run portfolio are therefore **not yet verified**. No owner evidence was
uploaded or published. The pilot currently offers no records under the shipped policy.

Still required for the intended hands-off product: native installer/distribution, automatic
source selection and AI drafting orchestration, automatic GitHub proof-coordinate derivation,
long-lived connection renewal, and approved end-to-end preview/publish/update acceptance.
The earlier export-first notes above are historical; the primary connection button is now
implemented. This is a working connection slice, not completed consumer onboarding.

### Portfolio harness draft saved — 2026-09-16

Preserved the complete owner-supplied [original](proposals/2026-09-15-portfolio-harness-original.md)
and added [architecture alignment](proposals/portfolio-harness.md), including owning applications,
proposed integrations and unresolved contradictions. Documentation intake only: no new capture,
scoring, provider integration or automatic publication is implemented by this change. Next:
audit Coeadapt reuse points and reconcile the draft before extending existing build units.

### Foliage harness rewrite — 2026-09-16

Rewrote the [harness specification](proposals/portfolio-harness.md) using the owner's
clarification: Coeadapt is Foliage's predecessor; Photosynthesis exists in OpenClaw/Hermes
and connects directly; impact evidence includes actual user feedback the agent searches
and attaches. Updated owning application context. Original draft remains unchanged.
This is a design/documentation revision, not completed host integration or feedback search.

### Nango, Cookiy and Arbigent made explicit — 2026-09-16

Corrected the harness rewrite after owner feedback: Nango is a central selected integration
layer, not optional historical import. Cookiy supports actual user research as well as
synthetic studies; Arbigent is the selected UI observer. Read the three primary sources and
added concrete workflows, evidence outputs, authority boundaries and acceptance checks to
the [specification](proposals/portfolio-harness.md). Upstream Arbigent web testing qualification
is retained. Documentation only; no installations, external studies or provider jobs launched.

### Harness implementation: Nango into existing review — 2026-09-16

Implemented an opt-in Canopy Nango Cloud adapter with actor-tagged Connect sessions, a fixed
API destination, bounded pagination and connection ownership checks before/after acquisition.
The device source endpoint uses existing Clerk/device authentication. The companion's
`importSource` and `import-source.mjs` use the existing private review writer, with a fixed
configured Leaf/harvest. No duplicate store, MCP server, candidate schema or merge path.
The existing observation parser/merge was moved into Photosynthesis with a Leaf compatibility
re-export so both runtimes share one contract.

Local contract checks cover foreign/revoked/unhealthy connections, changed revisions, duplicate
pages, incomplete pagination, deleted/pruned data, safe errors, CSRF and bearer separation.
An actual temporary Git intake passed through the companion/HTTP review path in a controlled
provider protocol test; this is not a live Nango result. Source records remain unreviewed and
publication was never called. See [integration setup](../docs/INTEGRATIONS.md#nango-connection-and-bounded-source-import).

Installed Hermes MCP discovery passed against the existing real pilot Leaf in an isolated
profile: both existing tools were discovered. No model invocation, submission or personal host
configuration change. Log: `/tmp/foliage-hermes-probe.log`. OpenClaw and Arbigent executables
were not found on the current PATH; this is not a claim they are absent everywhere.

Remaining: live Nango configuration and normalized sync scripts, automatic connection choice,
incremental checkpoints/webhooks, retained-source revocation, Cookiy/Arbigent execution/import,
full host acquisition and consumer onboarding. No provider account, paid study or deployment
was changed by this implementation unit.

Verification: full `pnpm check` passed **2,113 tests, zero failures**, including architecture,
boundary, egress, duplicate-code, findings, type checks and relocated Canopy package boot.
Log: `/tmp/foliage-nango-check.log`. The first packaging attempt omitted the newly moved,
untracked parser; staging the explicit source files fixed inclusion without changing the
packager. This result is local acceptance only; Nango OAuth/browser, provider normalization,
real synced records and deployed source UI still need live acceptance.

### Rich customization requirement — 2026-09-16

Recorded the owner's requirement for highly customizable portfolios and leaflets, editable
directly and by Scarlet. Extended the existing harness, UI context, Leaf/Ladybug ownership
and unit 24 with shared operations, inheritance, preview/undo, retained evidence and publication
parity. Existing authoring and curation are reuse points; no new runtime features are claimed
by this specification update.

### First customization runtime — 2026-09-16

Implemented Look & feel in the existing `/leaf/presentation` editor: editorial/clean typography,
airy/compact reading rhythm, individual Leaflet overrides and reset to inherited defaults.
Settings persist in the Leaf document independently of retained evidence. Private and public
portfolio renderers use the same presets; publication includes styles only with explicitly
selected authored context and filters overrides to admitted records. The existing revision-bound,
locked save operation is shared with two opt-in local MCP presentation tools. No new state store.

This is a first slice: named-view style overrides, palette/media/layout editing, live draft preview,
undo history and cloud Scarlet tool delivery remain unimplemented. The local agent transport is
not evidence that cloud Scarlet is deployed. Browser save/reload checked the real copied pilot;
390px editor had no horizontal overflow. Headless WebGL context creation failed, so this pass
establishes native reading/editor behavior, not 3D acceptance.

Validation: full `pnpm check` passed after preserving the existing public row markup contract;
focused coverage includes HTTP save/reset/stale refusal, real MCP SDK edits, evidence unchanged,
and public projection/roundtrip with private override exclusion. Shared browser bundle rebuilt.

## Aside installer and download audit — 2026-09-29

Branch `codex/aside-installer-release`, based on current origin #94 (`71c63b9`). Reuses the
`cc1cb1e` CLI/MCP adapter without importing its unrelated automation/search implementation.
Both source and archive installers accept `--with-aside --garden`; the local open-package
builder includes the helper and integrity manifest. Installed paths survive relocation,
including macOS `/var` symlinks. Optional connection failure preserves the installed app and
reports failure. Profile differences are preserved; capture and publication are never enabled.

Live official developer/task/permission docs and `getfoliage.com/start` were read through an
isolated gstack browser. The live site has previews only; Vercel production has none of the
three release-download variables. No artifact or website deployment was published. Current
website implementation remains on the separate portfolio-connection line.

Focused archive acceptance exercises the real installer CLI, invalid-option refusal,
relocated Foliage launcher, profile paths, integrity and optional Aside failure recovery.
The protocol executable represents no real browser/account or captured work. Actual selected
page → observation → review acceptance remains open because Aside has no normal browser
window for its current account. Setup, source references and release steps:
[Aside installation](../docs/ASIDE-INSTALL.md).

Validation on this branch: rebuilt browser bundles; full `pnpm check` passed with 2,329 tests, zero failures or skips. No live browser capture or public installer distribution is claimed.

## Résumé reader and agent projection — 2026-10-03

Implemented on the existing distribution projection: responsive public résumé, browser PDF
control, visible portfolio address, exact statement/evidence links, structured JSON route,
and Share links. Private Markdown remains clearly labeled as a private draft. All public
formats read current publication authority; withdrawal covers GET and HEAD. No new ATS
adapter, provider authorization, or deployment is claimed by this front-end change.

Local browser checks used explicitly labeled protocol input at 375px and 1280px with no
horizontal overflow. The print control invoked browser printing; the generated one-page PDF
retained selectable text and clickable portfolio/statement links. HTTP tests cover all three
formats and withdrawal. These are renderer and transport checks, not ATS parsing acceptance.


## Word résumé download — 2026-10-05

The existing résumé reader and personal Share page now offer `.docx`. It consumes the
admitted distribution projection, preserving reading-order text, all claim categories and
portfolio/evidence hyperlinks. Generation rechecks publication revision, generation and
digest before returning bytes; GET/HEAD withdrawal and changed-authority checks are covered.
The dependency stays in the closed Canopy app. There is no ATS send or acceptance claim.

Focused HTTP/document tests cover ZIP/XML content, Unicode, private-metadata exclusion,
empty exports, download headers and mid-generation authority changes. The bundled Word
renderer required an explicit fontconfig containing existing system fonts for Japanese and
emoji fallback; this was a QA-environment adjustment, not a source-text change.

The added dependency exposed a release-packager lookup defect for npm dependencies sharing
Node built-in names (`string_decoder`). Package lookup now resolves manifest search paths;
a relocated-runtime test generates an actual Word archive. All four packaging checks passed
sequentially after the correction. The browser reader was measured at 375px and 1280px with
no horizontal overflow; single- and multi-page Word renders were inspected.

### Nonblocking private journey suggestion seam — 2026-10-01

Branch `codex/journey-request-20261001` starts at `origin/main` `fa29203`. The explicit
`openWorkflow.requestJourneySuggestion(grantId?)` call targets an active journey grant,
refuses a stale target before transfer, and passes the current connected Scarlet session
and schedule, pause and quiet-hours gate into the existing maintainer. Jev and
Scarlet inference run outside the workflow's serial queue; only compare-and-swap receipt
writes take short serialized turns in `workflow.json`. A revocation or schedule pause can
complete while Scarlet is deliberately held, and the late answer is discarded. A saved
grant still triggers no startup or timer transfer, Leaf write or publication.

Five focused new protocol tests passed for connection/schedule gating, exact grant
selection, immediate revoke, pause during inference, and pending suggestion recovery
after restart. Full `pnpm check` passed **2,420 tests, zero failures** on the initial seam;
the grant-target follow-up passed focused tests and Leaf typecheck. Log:
`/tmp/foliage-journey-request-check.log`. These injected provider responses
prove the workflow contract, not actual model quality or owner acceptance. Scarlet still
needs a same-origin prepare/review action and revision-bound save/finalize path that admits
newly selected grant evidence while preserving outside-grant citations and history/undo.

### Owner-invoked Scarlet update action — isolated candidate, 2026-10-01

Branch `codex/journey-owner-action-20261001` builds on the nonblocking seam above. The
same-origin Scarlet workspace can explicitly permit up to twelve selected retained
Leaflets for one existing journey, request a single update, inspect the pending cited
suggestion, edit its wording, save it to the canonical Leaf, discard it, or revoke the
grant. A searchable, bounded source picker keeps a large work record usable. No page read,
startup event or collector timer calls the provider; save and discard do not publish.

The pending receipt, current grant, connected Scarlet session, schedule, Leaf identity and
exact revision are rechecked before the locked save. The editor admits newly granted
evidence while retaining earlier outside-grant citations; every edited number must occur
in currently cited evidence. The canonical journey history records the saved wording and
supports version restoration. A failed receipt write after a Leaf save reports uncertainty;
the changed document revision prevents a blind duplicate.

Three focused real-Git protocol tests passed for prepare → review → save → undo, current
citations, unsupported numbers, revocation, discard, pause, stale revision and no public
mutation. Full `pnpm check` passed **2,424 tests, zero failures** on this isolated
candidate; log: `/private/tmp/foliage-journey-owner-action-check.log`. Provider answers
were injected protocol fixtures. A real owner/provider session, browser acceptance,
automatic discovery of newly captured evidence and live hosted publication remain open.

## Opt-in agent demo browser — 2026-10-08

The local Foliage MCP connection can now expose a guarded browser when its owner enables
`--allow-demo-browser` for one exact loopback origin. A connected agent inspects bounded page
pixels and named controls, chooses a same-origin scene, and records that same isolated browser
state as a still and short MP4. Successful exploratory clicks and scrolls remain in the private
receipt. The still and clip enter one unreviewed candidate; approval, sharing and public video
selection stay separate. The existing Work capture form remains an owner-triggered one-shot path,
not an in-app agent runtime.

On a disposable copy of the real local garden, the MCP agent inspected Work, followed its
visible Capture action, and recorded the resulting page into Review. The candidate remained
unapproved and unpublished. The local Work and Capture pages were also inspected at desktop
and 375px with no console errors or horizontal overflow. This does not establish autonomous
scene quality across arbitrary apps or a hosted capture service.
