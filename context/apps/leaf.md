# Individual Leaf and local studio

Package: `@foliage/leaf-app` · Plane: `open` · Application: `apps/leaf`.

## Status

Integrated in `codex/live-portfolio-integration`; preserved local assistant and evidence-cell work is committed alongside the achievement portfolio.

## Responsibility

Own the person’s local portfolio, source intake, candidate review, presentation and export. The primary local entry is `foliage.mjs`; the HTTP runtime is `apps/leaf/server.mjs`. Do not add new personal flows to the legacy dashboard.

The [product thesis](../product-thesis.md) clarifies that the underlying product is the
person's private work record. Existing canonical Leaf documents and authoring operations
remain its implementation base; portfolio, résumé and future reflection are projections.
Preserve decisions, discoveries, pivots and unfinished work without presenting all of them
as proven achievements or automatically publishing them. Broader Leaf/Leaflet terminology
is open to product testing, not an implicit schema migration or second portfolio database.

Journey authoring extends `Leaf.achievements[].claims` with optional intent, decision,
challenge, pivot, discovery and learning kinds. The local MCP and manual editor use the same
locked save operation; private and published projections share category labels. Citation
freshness does not establish authorship or prove an outcome. Existing source tiers remain
unchanged. Update paired runtimes before reading documents containing new kinds.

The `/leaf/scarlet` workspace now joins journey collaboration, existing Leaflet curation,
collection preferences and the hosted email-settings entry. It sends explicitly selected
journey context through the configured loopback Canopy companion. Provider credentials remain
in the companion environment. Exact-revision batch edits reuse `savePresentation`; settings
reuse the workflow store and compare a settings revision before changing cadence/source scope.
Missing connection, collection or hosted account configuration remains visible. A schedule
prepares review drafts; it does not enable unattended narrative writing or public updates.
Journey updates name every refusal known before consent in place of the consent form, each with
its next step: Collection unavailable, "Connect Scarlet first", no journey statement yet. They
keep work the owner picked through a refusal and through Connect, and state the Collection gate
(scheduled, not paused, outside quiet hours) with Collection's current state and the same next
step a gated update names (Set rhythm, Resume collection). An unscheduled Collection does not
refuse a permission, so consent is still asked for then.

`/workflow/jev` now owns the Photosynthesis source-selection controls and Jev history in
this runtime; Jev's marks show only at `/review`. It uses the existing loopback/origin gates
and `workflow.json`, with the source/policy-bound behavior described in [Photosynthesis](photosynthesis.md#repository-title-selection--2026-09-27).
No grant is enabled by installation, GET or provider-key availability. Scarlet journey
collaboration cannot inherit these source permissions. The page shows one state: consent
recorded (or on), then the missing piece that pauses automatic checks — TypeSafe not set up,
Collection not scheduled or paused, or every granted source paused — with `TYPESAFE_API_KEY`
named only inside its setup detail. Marks already given stay on `/review`, and a retry there still
runs. "On" counts only grants on sources Collection reads; turning one source off says how many
switches stay on and goes on to state what they do.

## Runtime and interfaces

`server.mjs` serves the local studio, Leaf, review, policy and publishing preparation. `intake.mjs`, `harvest.mjs`, `sessions.mjs`, `share.mjs`, `export.mjs` and `cells.mjs` are adapters around domain operations. Photosynthesis uses the retained `/scarlet/workspace` and `/scarlet/run` routes use selected recorded context and AG-UI; the current source is local.

Work links to `/leaf/capture`, where an owner can record an explicit local web URL as a real
screenshot and short MP4. The page previews private captures from their byte-checked receipts;
the still and clip enter the existing locked `/review` queue as one candidate. An approved,
promoted still and clip can lead Work and the owner Leaflet. The clip remains private until a
separate owner selection for public export or Canopy publication; neither capture nor Review
grants publication. Chrome/Chromium and ffmpeg are local prerequisites.
`foliage capture` uses the same capture and Review path. The optional local MCP
`--capture-origin` pins one loopback origin for the existing one-shot recorder; a separate
`--allow-demo-browser` opt-in lets the agent inspect that browser and choose a scene before recording it,
but cannot choose another origin, approve a candidate or publish media. See [local capture](capture.md) and the
[MCP permission contract](../../docs/ASSISTANT-MCP.md#optional-local-web-demo-capture).

`private-brain.mjs` is an owner-invoked signed search pilot, separate from the local stdio
MCP and the hosted published-only search. It binds one Ed25519 agent key and exact local search
record IDs to a short session; current selected records are re-read for every signed query.
Scope filtering precedes the shared search ranker. Revocation, expiry, selected-record change
and receipt persistence fail closed. It never runs at startup or syncs the private record.
The default listener remains HTTP on `127.0.0.1`. An owner may choose one explicit IPv4
interface only with a supplied TLS certificate and private key; clients must verify the
certificate and sign each request. Foliage creates no tunnel. A real second-host round trip,
provider account binding and remote MCP/OAuth acceptance remain open.

`brain.mjs` (`foliage brain build|refresh|rebuild|status|remove|search|embed`) keeps a local brain per
garden: a pinned gbrain on PGLite, run by a pinned bun from `vendor/` beside `apps/`. A checkout
stages it into its gitignored `vendor/` (`node tools/brain/stage-gbrain.mjs`, a build-machine step
that may download; nothing at runtime does). An installed copy gets it from the one download
(owner decision 2026-10-15), `foliage-<version>-<platform>-<arch>-<rev7>.tgz`
(`node tools/deploy/package-local.mjs <new folder> --archive`, the brain in it macOS arm64 only),
which holds `runtime/` and, beside it, the brain unit `vendor/`: `node install.mjs <new folder>`
from `runtime/` installs `../vendor` by default through the `--with-brain` checks and refuses the
install when it fails them; `--no-brain` leaves it out; `--with-brain <vendor>` names another; later
`--add-brain` and `--replace-brain` on an existing install go through `vendor.next/` and a swap and
never touch a garden. `tools/deploy/package-brain.mjs` still builds the same unit as a brain-only
archive for that, unpublished. The unit is the `vendor/` folder with its own `release.json`
(kind `foliage-brain`, the Foliage version it belongs to, the pins and every file's digest) and
`THIRD-PARTY-NOTICES` (gbrain's MIT notice, bun's licence page and every staged package's licence
files, verbatim) and a `START-HERE.md` saying it comes with Foliage. The main release
never lists `vendor/`: its check skips `vendor/` only when `vendor/release.json` is there and
checks it as a unit for the same version. Before the brain is copied and again where it lands, the
installer runs the installed Foliage's own preflight (`verifyShippedBrain` in `src/brainVendor.ts`:
Foliage's pins, the bun bytes it ships, the whole staged tree, bun's execute bits) and asks for
room for the brain as its copy allocates it and one empty garden brain (42 MB). Every `init` of a
new database asks for that room too. An installed copy's missing or changed runtime names the
installer's fix, not the checkout's staging command; on a platform no brain archive is built for,
it says none ships yet instead. `verifyRuntime` checks the whole brain unit (about 12,900 files,
seconds of hashing) whenever `vendor/release.json` is there: a launcher that runs it at every start
(draft PR #160's Mac app does) should pass `{ brain: 'ignore' }` and leave the brain to its own
checks, or one changed brain byte stops the whole app instead of falling back to Foliage's own
search. What "a changed byte is refused" covers: one changed, missing or extra file under
`vendor/`, unless someone also rewrites both `vendor/release.json` and `vendor/brain.json` to
match. Those records describe themselves, like the main release's, so the archive's published
SHA-256 is the real check, and none is published yet. Every gbrain process starts through one function in `src/localBrain.ts` with an
allowlisted environment, an empty `PATH` and working directory, and a fixed list of commands. A
brain that is, sits under or holds the owner's own `~/.gbrain` or `~/brain` is refused before
anything there is touched. Which records become pages, the page format, the refresh plan and the
merge of gbrain's order with Foliage's own matches are pure code in
`packages/photosynthesis/src/brainPages.ts`: an excluded leaflet goes in as its title and reason
only, and anything resting on third-party material stays out. A refresh first records which pages
gbrain may hold once it starts (a manifest that matches no record until it finishes), writes
changed pages, imports with `--fresh`, deletes and purges removed pages and checks nothing is left
of them, confirms, and writes the manifest last; a newly excluded leaflet, a record newly resting
on third-party material, a link or a stray file where Foliage keeps its own, and an update larger
than a rebuild rebuild the brain beside the old one and swap it in. `foliage brain remove` deletes
only a garden's brain and only the names Foliage makes there. `foliage brain search`
answers through the brain only when it matches the record byte for byte, never returns fewer hits
than Foliage's own search over the same records, and otherwise answers from Foliage's own search
with the reason. A search reads the record again once it holds the lock and never refreshes toward
older bytes; a brain behind its record is then refreshed in place, waiting up to 10 s, and never
rebuilt by a search. `foliage brain search` hands that refresh to a detached
`foliage brain refresh --background --in-place`, which updates in place only, so the command
answers by the bound and exits; a caller that stays up would refresh in process and let a refresh
past the bound finish behind the answer (the MCP server, once local embeddings are on). A refresh of the same record
bytes that stopped within the last 10 minutes is not tried again by a search, which answers at once
with that cause; an update in place that ran and found it needs a rebuild is written down
(`behind`) for searches without holding the triggers back. gbrain's own search is bounded at 5 s.
`foliage search` and the MCP `foliage_search` do not read the brain in keyword mode, the default
(owner decision 3, 2026-10-12): there it would only reorder Foliage's own hits, at about 0.75 s and
one gbrain process per search. `src/localSearch.ts` reads the record once, checks the Leaf identity
and the harvest's binding on those bytes, and answers from Foliage's own search over
`brainRecords`, with `retrieval` `foliage keyword` and `because` saying keyword mode is why; it
starts no process, and under `brain/` it reads only whether local embeddings are on. No search
answer names a gbrain page address, a garden path, or a file in `brain/` that Foliage did not make.
The `--allow-brain` tools, the private-brain session and Canopy's public search never read the brain.

Local embeddings are opt-in per garden (build order item 8, owner decision 3). `foliage brain embed
--local ollama:<model> [--port <n>]` asks the embedder on `127.0.0.1:<port>` (11434 unless said),
by IP and never through a proxy (`src/localEmbedder.ts`), whether it already holds the model
(Ollama's `/api/tags`) and measures the model's dimensions from one embedding of a fixed word
(`/v1/embeddings`, the endpoint gbrain's ollama recipe calls). A name Ollama gives its cloud models
(`-cloud`, `:cloud`), an entry that names a remote host or model, a model it does not hold, and an
embedder that is not answering are refused before anything changes; Foliage never pulls or
downloads a model. Then the choice is written (`brain/embedding.json`) and the brain is rebuilt for
it: `init` sizes the embedding column at the model's dimensions, config.json names the model and
pins gbrain's ollama base URL to that loopback address, `search.mcp_keyword_only` is false so
gbrain's `search` op fuses its keyword and vector lists (expansion, reranker and query cache stay
off), the database may hold no key that moves an embedding elsewhere, and `embed --stale --source
default` embeds what each import added, in every rebuild and refresh. `foliage brain embed --off`
removes the choice and rebuilds for keyword search without asking the embedder anything. The
manifest records the mode a brain was built in; a brain built in another mode, or for another model,
than the one chosen is rebuilt by a refresh and never searched. With local embeddings on, `foliage
search` and `foliage_search` read the brain beside Foliage's own search (`retrieval` `brain local
embedding`, Foliage's own matches after gbrain's, so recall never drops), with the bounds and
fallbacks above. Before each search, before anything is locked or started, the embedder must answer,
hold the model and embed one fixed word at the brain's size within the search's 5 s bound; a model
that is listed but fails to embed, or answers another size, is named there too, never left to
gbrain's silent fallback to keyword search, and the search answers from Foliage's own search naming
it. The embedder never holds up the record's own changes: a refresh or rebuild whose embedder is
down or fails writes, removes and purges every page anyway (a leaflet newly excluded is rebuilt out
at once), marks the manifest `unembedded`, and stays behind, naming why; a search whose embedder
answers catches it up in place, and the triggers wait 10 minutes before asking again. `foliage
status` checks the embedder's model list; `foliage brain status` also embeds the fixed word. A
change of port alone, or of the model's measured size, rebuilds with its own cause; `m` and
`m:latest` are the same model. The pure rules (accepted names, the model list's verdict, the
dimensions, the choice file) are in
`packages/photosynthesis/src/brainEmbedding.ts`. Recall with a real model is not measured: no
embedding model was installed where this was built, and none may be downloaded.
A `brain/` holding anything
Foliage did not make (Finder's `.DS_Store` aside) is never locked, moved, removed or written by
any brain command.

`src/brainUpkeep.ts` keeps each garden's brain current. `foliage grow`, `review --resume`,
`migrate-queue --apply`, `capture`, `share`, `unshare` and `integrations import` start
`foliage brain refresh --background` detached once they have answered. `foliage up`'s server asks
after every POST it answers, after every collection pass (the first runs at start) and every 30
seconds, which catches anything else that writes `leaf.json` or `harvest.json`, such as a hand
edit; publishing through `foliage canopy` writes only the published copy, which the brain does
not hold. The MCP server asks after every tool not annotated read-only. Each request reads the
record's hashes and the manifest first (`brainDrift`) and starts nothing for a garden without a
brain of Foliage's, the owner's own `~/brain` or `~/.gbrain`, a brain an earlier check refused
(it waits for `foliage brain rebuild`), or a brain built from the record's current bytes; only
one refresh runs at a time, and one that waits for another holder of the lock waits up to 120 s.
A refresh that fails never fails the action: it leaves the brain behind with its cause in
`brain/refresh-failure.json`, which `foliage status` and `foliage brain status` print, and the
triggers do not retry those same record bytes for 10 minutes unless the record changes. No brain
code writes `leaf.json` or `harvest.json`.

The brain offline gate (`scripts/check-brain-offline.mjs`, part of `pnpm check`) runs the staged
gbrain with every network switch planted and fails on any network attempt, other program
started, process left running after its step, unexpected exit status or config drift. It holds
the offline proofs of build order items 2 to 6 and 8 (`tools/brain/offline-gate.mjs`,
`tools/brain/offline-proofs.mjs` and `tools/brain/offline-embeddings.mjs`), each in its own garden:
build, settings, routing files and a killed build; search, refresh and removal through `foliage
brain search|refresh|remove`, with a refresh and a rebuild killed before each of their steps; the
brain kept current by the real launcher's actions and an MCP-only session; `foliage search` and
`foliage_search` in keyword mode, which may not start the staged bun and must leave every byte under
`brain/` as it was; and local embeddings on, across a model change and off again, through a
deterministic stand-in embedder on loopback (`tools/brain/standin-embedder.mjs`, not a model), each
such step allowed that one 127.0.0.1 port and nothing else (macOS only). On
macOS (measured on arm64, under `sandbox-exec`) it also kills and fails on any write under the
owner's own `~/.gbrain` and `~/brain`. On Linux nothing watches those writes: only the size and
modification time of `~/.gbrain/config.json` and `brain.pglite` are compared before and after;
`foliage up`, the private-brain session and item 8's stand-in embedder, servers on the gate's
loopback, run on macOS only. The merged gate has not run on Linux at all: no phase, and nothing on CI's ubuntu-latest.
Only #205's earlier version of the item 2 and 4 steps (gbrain's own search and removal ops, with
one program rule for every step) was measured on Linux, on arm64 in a container.
`tools/deploy/package-local.test.mjs` builds the one download and the brain-only archive, installs
them on a simulated clean machine (a fresh HOME, a PATH with no bun or gbrain), and runs every
installer step inside the gate's sandbox (`offlineSession`) with no bun allowed: a default install
that includes the brain beside `runtime/`, a `--no-brain` install, `--add-brain` from the download,
`--replace-brain` from the brain-only archive, and a changed byte or another version beside
`runtime/` stopping the default install. It then runs `foliage brain build|status|search` of each
INSTALLED copy, the default install and the one the brain was added to, in the same sandbox,
starting only that copy's bun, and refuses one changed
byte in an install until `--replace-brain` puts it right. On Linux it checks only that no brain
archive is made. Not measured: a real browser download. Its archives carry
`com.apple.quarantine`, and `/usr/bin/tar` and the installer's copy keep that flag, so a
downloaded brain installs a quarantined `vendor/bun/bun` (measured in review). Whether Gatekeeper
lets Foliage start that bun, signed by its maker but with no stapled ticket, and whether its first
check asks Apple's servers, is open; so a working brain from a download stays built-but-unverified
until it is measured on a clean Mac. The installer does not strip the flag. Measured 2026-10-15 on
the build machine (macOS 27.0, arm64), on the pinned bun the download ships (sha256 `e0c90ec1…`):
`spctl --assess --type install` accepts it (`source=Notarized Developer ID`, Jarred Sumner,
7FRXF46ZSN), `--type execute` rejects it as "not an app", as it does any bare command-line binary,
and `stapler validate` finds no ticket stapled to it. That lowers the risk that Gatekeeper blocks a
quarantined bun; it does not settle it, and the brain is now on every default install.

## Storage and dependencies

`FOLIAGE_LEAF` selects the canonical document; harvest, policy and workflow files carry their own state. Source repositories and retained local artifacts are read through configured adapters. Domain validation is in `packages/leaf`; candidate logic is in `packages/photosynthesis`. `<garden>/brain/` is derived data Foliage owns: pages, gbrain's home and database, an empty work and bin directory, a manifest written last, `next/` and `old/` only while a rebuild swaps, `refresh-failure.json` while the last refresh of the current record stopped, `embedding.json` while the owner has local embeddings on, and `.brain-lock`, which may be reclaimed once its holder is dead and says when its holder is refreshing; deleting it (`foliage brain remove`) loses nothing and turns local embeddings off. An install's `vendor/` (the brain archive) is code, not data, replaced as a unit: measured for 0.2.0 on macOS arm64, a 74 MB archive (74,357,029 bytes) that takes 372 MiB once installed (du; the installer asks for 389 MiB plus 42 MB for an empty brain), against 335 MiB for a checkout's staged `vendor/`. This app owns no cloud tenant database.

## Access and invariants

Local origin and mutation gates protect browser writes; they are not multi-user hosted authentication. Any request whose Host is not one the bound socket answers to is refused 421 before routing, so a DNS-rebound page can neither read nor write (`@foliage/leaf/bound-authorities`). Local Photosynthesis tools select evidence and draft wording rather than grant attribution or publication. Local model configuration is loopback. Export and sharing decisions stay explicit.

The script-free `/scarlet` first-run page links to `/scarlet/setup` when no local model is
selected. Setup probes Ollama's installed models only after an owner POST, validates selection
against a fresh loopback list, and saves a private per-garden model name. Session-provided
`FOLIAGE_LOCAL_MODEL` wins over that saved choice. No provider contact, model download, or
new startup egress occurs on GET or startup. Installing Ollama and a model remains a separate
action; this local setup does not claim that a saved name guarantees a running service.
The workspace says once that a declared model is set but not checked yet; when asking finds
nothing answering at the base URL, both pages say "The local model isn't answering at
<host:port>" — with Get Ollama at Ollama's default address, Ollama setup help at any other — and
keep the socket error in Technical details. The workspace opens that link in a new tab, so the
conversation survives.

## Data flow and boundaries

Actual retained evidence → local candidate review → canonical Leaf → presentation/export. The achievement editor, exact résumé citations, named views and format-5 handoff are integrated from `codex/portfolio-achievements@5f9fa1b`. Cloud Ladybug belongs to its separate architecture.

Approved drafts with no Leaf file yet lead Work, the `/review` panel and a refused "Add N to leaf"
to "Create your private record" (`/leaf/setup`; one wording, `CREATE_RECORD`), and Overview's Next
once no draft is left to review (a quiet link while Review leads; Work's likewise while a
Ready-to-review card leads); the drafts stay approved and that panel adds them once the record
exists. A bound queue is added only into a record of its own subject and id, so these surfaces
name that subject and setup starts with it; a binding no new record can meet is said plainly, with
no add promised (`recordStart`). The panel reads "missing" from the unread record's own load
(`LeafIndexUnavailable.load.cause === "absent"`), not from a second marker. A broken Leaf is
repaired, never replaced, so it gets no such action: malformed and unreadable name the file only
under a closed Technical details, invalid points at Portfolio's list of fields, and an unset
location (`unconfigured`: `/promote` and setup cannot work without it) says so and promises
neither a new record nor an add. An
empty Selected work on `/leaf` says a told story adds a record and links Work's records ("Choose a
record to tell its story": the link opens the list, each row tells its own story); its Git
source rows offer "Tell story" by Work's own rule (`canTellStory`: pending, private, citable).

The private `/workflow/api` response exposes `queue.open` and one `queue.next` preview
(`id`, literal `title`, Review `href`) from the same visibility and Jev ordering as `/review`.
No visible draft yields `next: null`; an unreadable harvest also keeps `open: null`.
The link expands only a currently visible record. Reads neither decide nor call a provider,
and no second queue or persisted preview is created.

An opened `/review` draft keeps its decision (Reviewer, Reason, Edit title, the
pending/no-publish line, Approve/Reject) with its first cited source. For an image-only draft,
the complete image frame precedes source, date and decision; drafts with video keep their
existing order. Remaining references sit under "All N references". Imported snapshots keep
their disclosure and text first. Reviewer
starts as the most recent recorded reviewer, else the Leaf subject, and stays required. A
decision made without a find returns to the next visible undecided draft under a `role="status"`
line naming it; only ids cross the redirect, and "approved waiting" is always approved drafts the
Leaf does not hold, linked to the promote panel from that line, Overview's next step and Work.
It is stated only when the Leaf was read; otherwise no surface counts it, and Review leads.

`/workflow#sources` lets the owner select a local Open Design project file, a bounded text
export, several personal project files, or one PNG/JPEG design image. Text is inspected
literally; a design image is previewed from metadata-stripped pixels through a bounded private
route before the owner adds it to the existing Review queue. A public Dribbble shot URL, when
entered, is an owner-supplied reference rather than fetched platform data. Changing the
selection cancels the previous preview. Repeated imports retain their prior review decision.
These one-time local snapshots are neither connected provider accounts nor publication authority.

## Source and verification

- [apps/leaf/server.mjs](../../apps/leaf/server.mjs)
- [apps/leaf/src/leafDocument.ts](../../apps/leaf/src/leafDocument.ts)
- [apps/leaf/src/scarletRun.ts](../../apps/leaf/src/scarletRun.ts)
- [apps/leaf/src/scarletTools.ts](../../apps/leaf/src/scarletTools.ts)
- [apps/leaf/src/gitIntake.ts](../../apps/leaf/src/gitIntake.ts)

Use this application's source-backed tests and the repository checks. Documentation inspection
is not live deployment acceptance. Shared laws and inventory: [architecture](../architecture.md).

## Customization ownership

Leaf owns canonical private presentation state and shared manual/agent editing operations.
Extend existing portfolio authoring, curation, named views and media for rich portfolio and
leaflet customization; do not introduce an agent-specific document. The
[customization contract](../proposals/portfolio-harness.md#81-user-and-scarlet-customization--required-product-scope)
defines inheritance, revision checks and undo requirements. Full implementation is pending.

Current presentation implementation: `Leaf.presentation` holds validated typography, spacing,
source-palette, compound-leaf layout, introduction-composition and admitted-media framing presets
with portfolio → named Leaf → Leaflet inheritance.
`/leaf/presentation?edit=style` provides a local live preview and a revision-bound immediate undo;
the explicit opt-in local MCP tools share `savePresentation` and its identity/revision/lock gate.
Private and public portfolio renderers use the same resolver, and publication filters private view
and Leaflet targets. The canonical presentation object retains a bounded style history with
manual/agent attribution; restoring or reapplying a saved value creates another revision, while
publication omits the private history. Media selection/admission, persisted motion settings and
history for introduction, curation and named-view edits remain planned. Journey title and
statement history now use the canonical `journeyHistory` field and existing locked editor.
Manual/MCP edits retain before/after snapshots; the owner's History and undo page restores a
version as a new edit, refusing stale document revisions and unavailable citations. Public
projections omit history. Older readers/writers must be upgraded together before adopting
documents with this field. The bounded history never silently evicts older words; at its limit
writes refuse and archival remains future work. This does not enable unattended maintenance.

## Optional statement support

`/leaf/claim-check` is an owner-invoked support check linked from the achievement reader,
statement editor and private portfolio. It resolves exact citations locally first. Missing,
stale, excluded or textless evidence produces a repair action without a provider request.
A same-origin POST then binds an explicit transfer choice to the current document digest.
Only the selected statement and displayed retained excerpts are sent to the fixed TypeSafe
endpoint using server-side `TYPESAFE_API_KEY`; no request is made by reading the page.
The pinned SDK/model, timeout, response-size bound and zero-retry policy live in
`apps/leaf/src/claimCheck.ts`. Nothing is saved or published by the check. A document change
during inference discards the result. Provider failures expose safe recovery text, not raw
responses. Model output is advisory and does not upgrade attribution or establish impact.

The uncertainty label uses an initial, uncalibrated confidence threshold; it never controls
publication or other authority. Claim-grouping, automated evidence connections, retained
run history, background checks and OpenClaw tool invocation remain separate unfinished work.
This local optional client is not the cloud Scarlet agent or completion of unit 16.

## Live résumé projection

`/leaf/resume` reads the same canonical achievements and statement citations as the private
portfolio; `/leaf/resume.md` downloads the current projection. There is no separate résumé
store. The existing private reading client follows `/leaf/resume-state` and replaces the view
when the saved document digest changes, retaining the last loaded content with a visible
failure message when refresh fails. Missing or changed citation support stays visible.
This implements propagation after a saved achievement update, not autonomous achievement
authoring, background collection acceptance or approved-scope cloud publication.


Optional local MCP `--allow-achievements` now exposes selected achievement/evidence context
and private achievement/statement writes through `savePresentation`. The three default tools
(import context, portfolio import, observation submission) are unchanged. Exact citations, fixed Leaf identity and current revision
bind writes; neither source records nor publication state can be changed. The same canonical
claims feed the portfolio and both résumé formats. See [host contract](../../docs/ASSISTANT-MCP.md#optional-achievement-maintenance).
The host still needs an accepted orchestration loop; tool availability alone is not automatic
maintenance or OpenClaw acceptance.


## Permitted private journey maintenance — 2026-09-28

Legacy direct-write journey grants remain stored for history, but their policy no longer
authorizes any provider transfer. The new subject-specific consent creates a separate grant
for one existing journey and up to twelve explicitly listed retained Leaflet IDs. It is off
by default and independent of repository-title selection. The existing workflow document
owns grants, revocation, pending cited suggestions and bounded attempt receipts; there is
no second portfolio or scheduler. The collector timer does not invoke journey maintenance.
The explicit `openWorkflow.requestJourneySuggestion(grantId?)` method targets an active
grant, supplies a live session and schedule gate, and persists receipts without holding
the serial queue across inference. Scarlet's same-origin owner POST is the only caller;
reading the page, installation and startup send nothing.

The isolated maintainer accepts a caller-provided owner-connected session and
schedule/quiet-hours/Paused gate, then records a pending attempt before either provider.
Jev uses the shared decision contract with caller `scarlet`; a keep decision permits a
cited suggestion, never a write. Selected Leaflet titles and excerpts plus existing journey
statement text go to Jev with a hashed subject identifier. Scarlet receives the subject
name under the new consent, selected evidence and the existing statement text, with
unselected citations stripped from its context. Every suggested edit must cite selected
evidence; a numeral absent from those citations is refused. Outside-grant citations are
preserved on the local draft. No highlights or publication are authorized. Scarlet shows
the pending receipt with previous wording, editable suggested wording and links to retained
evidence. The owner may save, discard or revoke. Saving checks the active grant, connected
session, schedule, exact Leaf revision, current citations and edited numbers under the
canonical document lock; the existing `journey-edits` editor records history and supports
undo. Publication remains a separate action.

Revocation before a suggestion commits discards it, and the comparison is made against
current workflow state rather than a captured grant. Pending attempts survive crashes as
interrupted and never replay silently. A session or schedule pause interrupts a pending
receipt without retaining the provider result; the same evidence can be retried only after
the caller's gate becomes eligible again. A provider-unavailable Jev decision is likewise
retryable; completed decisions are not resent for unchanged evidence. Receipt limits stop
new work instead of evicting history. Restart does not reconnect Scarlet automatically.
The owner save path admits the exact newly selected grant evidence while preserving older
outside-grant citations. A failed workflow receipt write after the Leaf save is reported as
uncertain; the changed Leaf revision prevents a blind retry. Live provider/host and owner
acceptance remain unfinished.

This slice watches already retained evidence. Automatically admitting newly collected packets,
connecting new Leaflets, creating journeys from scratch, scoped unattended publication, live
model-quality acceptance and actual host/participant cycles remain unfinished. Protocol
fixtures verify mechanics; they are not independent evidence of model correctness.


## Public runtime upgrade compatibility

The local MCP retains both existing search contracts: `--allow-search` includes labeled
pending/history records; `--allow-brain` exposes revision-bound canonical context, exact
reads and citation relationships. Each is independently enabled; no new store or implicit
cloud transfer is introduced. Brain projection and bounds live in `packages/leaf`.

The private `/leaf/reflection` page projects current daily/weekly journey changes with exact
claim/evidence links. It reads existing history, does not author a narrative or send email,
and preserves the distinction between recorded edit dates and work dates.

Historical source-scoped maintenance grants and admission receipts remain parseable and
retained. Their old policy never authorizes the new suggestion flow. Scarlet shows that
permission needs review; explicit current consent replaces it while preserving its history.
Newly collected source intake and former unattended private writing do not resume on upgrade.
No old provider permissions are silently copied to the new contract.
