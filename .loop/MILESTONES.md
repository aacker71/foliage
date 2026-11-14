# Foliage release path

**Plan of record, revised 2026-10-05.** Start here for sequence and release gates.
[Product thesis](../context/product-thesis.md) defines the purpose;
[ordered units](../context/specs/00-build-plan.md) define implementation contracts;
[progress](../context/progress-tracker.md) retains dated verification receipts.
The [August milestone ladder](HISTORY-MILESTONES-2026-08-24.md) is historical.
The old [capability ledger](STATUS.md) is a dated audit, not a current release verdict.

The first offer is a person's private, living record of real work. Portfolio, résumé,
reflection and a public brain are projections of that record. The first useful pilot is a
builder with real work who can collect, review, understand and selectively share it, while an
independent reader can follow a claim to its permitted evidence. A green test suite or a
preview URL does not complete that outcome.

## Why critical work accumulated

1. **The integration base landed late.** On 2026-09-29,
   `origin/codex/live-portfolio-integration` was more than 200 commits ahead of `main` and
   [PR #90](https://github.com/aacker71/foliage/pull/90), the first dependent UI PR, had a
   merge conflict. PRs #91–#93 were stacked after it; #94–#99 branched again. The reconciled
   candidate landed as [PR #100](https://github.com/aacker71/foliage/pull/100) on 2026-10-01.
   Landing clears the integration block; it does not supply live owner acceptance.
2. **Multiple status narratives survived.** `STATUS.md`, this file, `README.md`,
   `context/progress-tracker.md` and the unit build plan used different dates, candidate
   branches and meanings of “done.” The plan, implementation contracts and dated evidence now
   have the distinct roles above. Status is only as current as its linked receipt.
3. **The scope widened before the first outside-user test.** The complete product includes
   hosted authority, all portfolio levels, distribution, enterprise, recovery, billing and
   evaluation. Those remain commitments in the [acceptance matrix](../docs/PORTFOLIO-SCALE-ACCEPTANCE.md),
   but must not obscure the shorter first-user critical path.
4. **Infrastructure checks were mistaken for use.** Local tests, CI and Vercel previews
   validate code and packaging. They do not establish that an owner can maintain the record,
   an agent can query the permitted brain, a stranger can inspect the published view, or a
   withdrawn page is unreachable in production.

## Release ladder

| Gate | Current state | Next integration | Exit evidence |
|---|---|---|---|
| **0. One candidate** | [PR #100](https://github.com/aacker71/foliage/pull/100) landed as `a8e95eb`. [Draft PR #126](https://github.com/aacker71/foliage/pull/126) is the current UI integration; [screen receipts](../docs/UI-SCREEN-CHECKLIST.md) cover Work, Policy, Import, Canopy and website scenes but remain bounded. Public titles redact identifier-shaped spans while private titles retain the source words. The owner editor and publisher both check cited numbers; the public page withholds unsupported claims. The owner's unrelated checkout was untouched. | Recheck the final PR head in CI and preview; finish populated, empty, denied and recovery-state acceptance against the screen checklist with real permitted work. Green tests and local screenshots do not alone complete the redesign. | A builder can use the integrated app on real permitted work, with no lost owner data and clear evidence of every blocked state. Record the UI acceptance verdict and remaining fixes. |
| **1. Private record and brain** | The one harvest review queue, shared search, `foliage search` and opt-in local `foliage_search` MCP are integrated. The owner-invoked Scarlet prepare/review/save action is included in draft PR #126; startup and the collector timer do not send or write. The local browser rehearsal used real Git evidence with protocol model replies, not a live provider or owner pilot. | Land the integrated owner action, then exercise approved source → one queue → cited journey/résumé update with history and undo on real permitted work. Default drafts use Scarlet's finalize-and-publish path; project-scoped auto-publish needs durable policy grants. Current work by owner direction 2026-10-10: the packaged local brain ([unit 38](../context/specs/38-local-brain.md)), a pinned gbrain built from each garden's records with every network path off, answering `foliage search` and `foliage_search` with Foliage's own search as fallback. | An owner and one other developer each recover real work and cited decisions; exact private MCP queries retrieve only permitted records. Restart, stale revisions, deny, revoke and undo are exercised. No generated claim without evidence. The local brain installs without any download and builds and answers on the owner's and a second person's machine with the network denied: no outbound attempt in the sandbox log, no score, excluded hits only with their reason. |
| **2. Public brain and publication** | Main has one pure published projection/search, a static index and hosted HTTP/MCP read-only serving. A [local real-record rehearsal in #111](https://github.com/aacker71/foliage/pull/111) covered publication, search/MCP and withdrawal; deployed account/CDN behavior remains unverified. | Connect the release operation and exact-preview consent; rehearse replacement, withdrawal and scope with an actual hosted Leaf. | Owner-published pending-tier work may appear; unreviewed, rejected, private, excluded and example work never appears. Anonymous reader and agent can inspect a cited hit; withdrawn/replaced and unlisted scope are verified live across HTML, JSON, search, metadata and media. No person score. |
| **3. Install and first public pilot** | The public [start page](https://getfoliage.com/start) still offers the checked manual-extract Node archive. [Draft PR #160](https://github.com/aacker71/foliage/pull/160) adds a self-contained Apple silicon app candidate with a bundled Node runtime. A clean local bundle and its extracted unsigned ZIP passed manifest and checksum verification; LaunchServices opened its loopback Overview and Review, then stopped every app process without changing the garden. Apple rejects the app because it has no usable signature, so the website download has not changed. The open archive excludes closed Canopy and cannot publish by itself. | Sign and notarize the app with an Apple Developer identity; verify downloaded-app Gatekeeper behavior and an outside-builder install. Qualify a separately configured Canopy companion or hosted service through real sign-in, owner isolation, backup/restore, support and an outside builder/reader path. | A second person installs and maintains their own record without repository checkout. They deliberately publish selected evidence through an authorized Canopy path; an independent reader understands one capability and its proof, and withdrawal/recovery work from another account. Record elapsed setup time and all failures. |
| **4. Remote private brain** | **Open.** Local opt-in `foliage_search` and published-only hosted MCP remain separate. An owner-started signed loopback pilot binds one Ed25519 key, exact local records and expiry/revoke, with a receipt before each response; it creates no tunnel or startup transfer. | Exercise the pilot through owner-configured authenticated HTTPS, then add provider account binding and production remote MCP/OAuth with host/provider acceptance. Preserve local-first storage and distinct private/public boundaries. | A permitted external agent retrieves only the owner's granted private records; another account cannot, withdrawal takes effect immediately, and every transfer has an owner-visible receipt. |
| **5. Complete product offers** | Required by the accepted product scope, not part of the first pilot claim. | Complete units 14–37, 39 and 40: group governance/member exit, consented discovery and inquiries, authorized ATS/CRM delivery, contracted feeds, notifications, portable evaluation, private deployment, residency, payment/support. | Each acceptance-matrix row has environment-specific evidence and the final release decision names remaining limits. A partner agreement or provider key is not acceptance. Unit 39, the local team project portfolio, sits in this range by number only; its place in this ladder is an open owner decision (unit 39, decision 4). |

## Journey-maintenance integration block — 2026-09-30

The isolated maintainer in #103 requires a caller-provided `JourneyRunGate` and stores a
cited suggestion as a pending workflow receipt. `openWorkflow.requestJourneySuggestion(grantId?)`
targets an active grant and supplies the current connected Scarlet session and schedule,
pause and quiet-hours gate. An absent or revoked target is refused before transfer.
Inference runs outside `serial`; only compare-and-swap receipt persistence takes a short
serialized turn in the existing `workflow.json`. A revoke command can complete during a
held provider request and discards its late answer. A schedule pause records interruption
without storing the late answer. The legacy `maintainJourneys()` entry remains inert. No
startup connection, timer transfer, direct Leaf write or publication follows from a grant.

The owner-action candidate in draft PR #126 adds a same-origin `prepare-update` action and a private
pending-receipt review. Saving rechecks the grant, connected session, schedule, exact Leaf
revision, citations and edited numbers; it admits newly selected grant evidence while keeping
existing outside-grant citations. The canonical editor records owner wording and undo. Discard
and revoke remain local, and publication is separate. A failed receipt write after a Leaf save
is reported as uncertain; the changed Leaf revision blocks a blind repeat. Land this
candidate and observe the on-demand path with real owner work before enabling any automatic
caller. The workflow seam and local protocol tests alone do not close Gate 1.

## Work now, in dependency order

1. **Pilot UI acceptance:** exercise every screen and populated interaction state on real
   permitted work against the [screen checklist](../docs/UI-SCREEN-CHECKLIST.md). Fix the
   blocking path, then record the result in the progress tracker.
2. **Two brains:** local search is read-only and opt-in; public search is derived from the exact
   published projection. Share one rank implementation; never expose numeric rank or private
   index data. A local prototype on an unpublished branch is not the release implementation.
3. **Trusted maintenance:** one queue, source grants, exact citations, owner corrections,
   history/undo and immediate revoke. Jev's Keep/Pass changes review order only. It does not
   write achievements or confer publication authority.
4. **Distribution and release:** the checked manual Node archive is live on the website.
   Package Canopy separately and run the two-account publication/withdrawal/recovery rehearsal
   through a configured service. A signed/notarized native installer is a broad-launch
   requirement, not a property of this pilot archive.
5. **First outside-user check:** use one builder's permitted real history and an independent
   reader. Capture what they could and could not understand; fix the blocking path before
   claiming a wider launch.
6. **Remote private access:** keep a separate permission and identity plan for outside agents;
   a public published-view MCP must never be described as access to the owner's local brain.

A new critical PR must name one gate, its base branch, acceptance evidence and the next
integration step. A gate closes on its exit event, not on a test count. Update this file when
sequence changes; append the exact verification receipt to the progress tracker. The
40-unit plan remains the complete-product contract, not an instruction to start 40 parallel
branches. No fake work, personal score, unconsented outward transfer, or license file is
introduced to make a gate appear complete.
