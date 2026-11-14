# Integrated local journey — 2026-09-05

## Candidate and scope

Branch: `codex/streamlined-journey`, isolated checkout `/private/tmp/foliage-streamlined-journey`.

Integrated the current local heads of all three implementation branches:

- `d6d64fe` — contextual Leaf/Ladybug UI, safe CLI help and local decision/write recovery.
- `b4267bf` — Open Design workflow, shared interactive controls, durable app-owned collection, token shapes and connected Hosting workspace.
- `3e3428c` — private Canopy Ladybug assessment and explicit assessment release/withdrawal.

Merge commits: `aa58452` and `8c1c02c`. Retained the local source/policy locks and atomic publication writer, Hosting workspace routes and scoped CSP, and both static and interactive UI exports. All three source heads are ancestors of the candidate. Other sessions' checkouts and untracked documents were not modified. Subsequent uncommitted evidence-cell work in the original checkout remains with its owning session.

## Interaction changes

- Each workflow view has a direct link and browser history. Reload and Back retain context.
- Saved private drafts can be reopened with their original evidence, edited and saved again. Opening does not change their status.
- Overview points to pending reviews, source failures, saved drafts or setup according to actual state.
- Source setup links to scheduling; collection links to new reviews.
- Mobile navigation identifies Foliage and includes the leaflet-review path. The skip link focuses the current workspace without replacing its location.

## Evidence

Full repository check on final runtime `ec05f4c`: 1,633 tests passed, zero failures/skips. Both local UI bundles and the website production build passed. The earlier test invocation overlapping the second merge is invalid evidence and was replaced by this clean run.

BrowserOS neo used one owned tab. The local listener was checked before binding and identified as this session's process. Isolated state: `/private/tmp/foliage-streamlined-state`; the real repository was read with explicit exact-email metadata matching and a clearly labelled Codex rehearsal subject. No invented customer evidence or model findings.

Observed flow:

1. Empty workflow → connect actual repository → save schedule → manually collect one evidence packet.
2. Save a private draft, reopen it by keyboard, correct the wording, save again.
3. Stop and restart the actual local server; reload the direct draft link. The same corrected wording and evidence persisted.
4. Real 375px and 1440px viewports read back from the page. Checked workflow, review and contextual Ladybug layouts had no horizontal overflow. Source view survived reload; mobile menu opened; keyboard focus measured 2px.
5. Contextual Ladybug read the selected candidate and bounded git source excerpts, retaining return links to the exact review item. No local model configured: unavailable state remained readable; no live completion claimed.
6. Local publish preview reported zero proposed outward items and 267 unresolved source leaflets under the current policy. No publication action taken.
7. Connected Hosting workspace rendered the honest empty publication store. Canopy Ladybug saved a manual packet containing two actual commit references, then required provider configuration and separate consent before assessment. No provider call or release performed.

Workflow fonts observed: Fraunces, Instrument Sans, JetBrains Mono, served locally. Sampled muted panel label contrast measured 5.30:1. No external resource requests observed on the checked workflow and Hosting pages. These observations do not establish application-wide accessibility acceptance.

## Remaining acceptance

This is integration and an agent usability rehearsal, not proof of unfamiliar-user success. The follow-on handoffs below now connect scheduled packets to contextual Ladybug review and a private Canopy assessment draft without manufacturing a Leaf or harvest candidate. The Canopy transfer is an explicit copy/import flow between separate processes. Purpose-aware proposal generation and unfamiliar-engineer acceptance remain product work. Do not silently promote a saved workflow draft to a verified leaflet or a released assessment.

Live configured Fireworks/Kimi assessment quality, independent human review, hosted account isolation and authoritative withdrawal, public disclosure decisions, and pilot/commercial acceptance remain open. No deployment or remote merge was performed.

The isolated rehearsal scheduler was paused after validation; its sources and drafts remain available for inspection.

Detailed design findings and screenshots: `~/.gstack/projects/aacker71-foliage/designs/streamlined-journey-20260905/design-audit.md`.

## Workflow packet → Ladybug → decision

Implemented a read-only `read_workflow` selection on the existing AG-UI runner. The workflow editor links its saved packet to `/ladybug/workspace?packet=<id>` and Ladybug returns to `/workflow#review/<id>`. Unsaved wording hides the handoff link and explains that it must be saved first. Opening Ladybug does not save, accept, promote, publish, or send to Canopy.

*Since changed: there is no `/ladybug/workspace` route, and `/workflow` has no `#review` view (the one review queue is `/review`). A saved draft's Export evidence page (`/workflow/export?packet=<id>`) now offers **Continue with Scarlet**, which opens the paired manager's import preview.*

The server resolves the packet and connected source again for each question. A digest binds the saved wording, evidence, decision and source connection; changed packets or removed sources invalidate an open question. Unrelated schedule changes do not. Source excerpts use only the selected packet's repository, with no fallback to the global repository. Removed sources retain their saved references but cannot supply new source reads.

Context includes up to eight recorded commit subjects and author-email metadata, with omissions stated. It assigns no proof tier or portfolio subject. New collections record their observation time separately from draft edits; older packets explicitly state that collection time is unknown. Optional git reads retain the existing two-reference and excerpt bounds. Citations return to the original packet. The same selected context, streaming, cancellation and answer checks use the existing AG-UI path; no second chat transport was added.

Validation: the repository gate passed with 1,635 tests. New real-repository tests cover a missing Leaf, exact reference retention, packet edits, removed sources, missing packets, legacy observation times, source routing and foreign-origin refusal. The workflow browser bundle passed. No live model answer was generated or assessed.

Browser rehearsal used the existing saved repository packet: workflow link → Ladybug → optional source read → keyboard return to the same editor. At a measured 375px width, both routes fit without horizontal overflow; the final Ladybug layout also fit at 1440px and its desktop screenshot was inspected. Two real commit reads succeeded; additional refs were explicitly unavailable under the bound. The unsaved-wording guard was exercised through a native input event after browser automation typing failed to alter the field; no rehearsal wording was saved. The final preview continues to use isolated state with collection paused.

## Private assessment transfer — 2026-09-06

Saved workflow drafts now offer **Prepare a private assessment transfer**. The script-free preview provides the exact portable packet for copying and a revision-bound JSON download. Exports carry saved wording, every retained commit reference and subject, collection/saved times, original omission count and stable packet/source identifiers. They omit local paths, structured author-email metadata and Ladybug conversations. The integrity digest detects changed transfer bytes; it does not authenticate an exporter or establish authorship.

Canopy’s private Ladybug page offers **Import a saved workflow draft**. The user supplies a portfolio id and name; the importer does not infer a person from git metadata. Import applies existing redaction rules and displays the resulting evidence before an ordinary digest-bound save. Preview does not write. Replacement explicitly discards the prior private packet/assessment; related-work, market and correction fields start empty. Oversized assessment evidence is refused instead of truncated. Saving, Fireworks consent and public release remain separate operations.

This reuses shared static `@foliage/ui` controls and normal forms, retaining the no-script CSP. Canopy consumes the open portable format; Leaf imports no cloud code and opens no cross-app connection. There is no automatic pairing, remote upload, account authentication or hidden model submission.

Validation: full repository gate passed with 1,635 tests, including extended real-repository export/import seams. Checks cover pending-draft refusal, stale export/download, transfer integrity, malformed imports, all-reference retention, preview without persistence, stale preview/save, cross-origin refusal and unchanged model/publication gates. Both app typechecks and the workflow browser bundle passed. The initial full check exposed direct test imports crossing TypeScript project roots; the Canopy rehearsal now exercises Leaf collection in its own process and the final full check passes.

One owned BrowserOS tab rehearsed the actual saved repository packet: export → paste into Canopy → inspect preview → keyboard save. All 25 retained commit references and the original 242 omitted count survived. The draft persisted through an actual manager restart; provider consent stayed unchecked and sending disabled. Isolated record: `/private/tmp/foliage-streamlined-state/transfer-assessment.json`; the prior rehearsal assessment was not replaced. No provider call or publication occurred.

Measured 375px and 1440px export layouts fit; browser inspection caught and fixed overflow from a duplicate long identifier. The import preview fit at 375px, the final readable preview was inspected at 1440px, and the saved assessment page fit at 1440px. Local previews: Leaf `http://127.0.0.1:4213/workflow#review`, Canopy `http://127.0.0.1:4214/ladybug`.
