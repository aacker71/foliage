# Evidence cells: local capture and permission gate

Cells are private source observations. They are not skill assessments, approval receipts,
authorship attestations or automatically publishable material. This slice adds no network,
model calls, scheduled jobs or UI. It reuses the open Photosynthesis candidate format and the
existing local document locks/writer; it does not change the licensing boundary or Leaf schema.

## Working path

Explicit Git commit or supplied Asana snapshot → versioned local cell store → explicit cell
selection → unreviewed Photosynthesis candidate → existing human review → live-store promotion gate.

Run `node apps/leaf/cells.mjs --help` from the checkout. Every operation requires an explicit
store path; no default garden is read or changed. Use an owner-only directory outside all Git
checkouts and outside any served/published directory. Create that directory first (mode 0700);
the CLI does not create directory chains. Stores and draft outputs are mode 0600.
These are access permissions, not encryption. The CLI refuses aliases and refuses to overwrite
an existing initialization or draft destination. A JSON null, malformed store, digest mismatch,
unknown field or busy lock is an error, never an empty store.

```sh
node apps/leaf/cells.mjs init --store /private/path/cells.json --subject 'Your name' --leaf-id your-leaf-id
node apps/leaf/cells.mjs allow --store /private/path/cells.json --source git --scope /path/to/repository/.git --reason 'Authorized personal repository'
node apps/leaf/cells.mjs git --store /private/path/cells.json --repo /path/to/repository --identity declared-email --commit FULL_COMMIT_SHA
node apps/leaf/cells.mjs allow --store /private/path/cells.json --source asana-import --scope PROJECT_GID --reason 'Authorized project snapshots'
node apps/leaf/cells.mjs asana --store /private/path/cells.json --snapshot /private/path/task.json --project PROJECT_GID
node apps/leaf/cells.mjs list --store /private/path/cells.json
node apps/leaf/cells.mjs draft --store /private/path/cells.json --cells CELL_ID,CELL_ID --title 'Your draft title' --out /private/path/new-candidate.json
node apps/leaf/cells.mjs check --store /private/path/cells.json --candidate /private/path/new-candidate.json
```

Placeholders above must be replaced with actual authorized inputs. The list command prints
private evidence: do not paste it into shared logs or public task comments. Git scope must be
the canonical common Git directory (not the worktree's `.git` pointer file for linked worktrees).

## Source permission and retraction

Version 2 stores start with no permitted sources. `allow` records the local owner's instruction
for an exact source kind/scope; it does not attest remote permissions or grant permission to send
anything to a model or employer. Capture and draft consumption both check it. The store retains
the latest instruction per scope, not a complete permission audit history.

```sh
node apps/leaf/cells.mjs deny --store /private/path/cells.json --source asana-import --scope PROJECT_GID --reason 'Stop using this project'
node apps/leaf/cells.mjs retract --store /private/path/cells.json --cell CELL_ID --reason 'Remove this observation'
```

`deny` blocks new capture and use, but retains private content for inspection. `retract` removes
all local revisions of the selected cell and retains only its hashed identity, time and reason
to prevent reimport. There is no undo in this store; it is not secure erasure from disk blocks,
backups or exports. Do not put source content into a retraction reason. Unrelated cells remain.

Drafts bind the exact evidence revisions AND the current source grant. Denied/retracted sources,
changed evidence, and a replacement grant invalidate prior drafts even if already approved.
Both the older promotion CLI and the server refuse cell-backed candidates without live authority.
After using the existing review workflow, promote an approved cell draft through:

```sh
node apps/leaf/cells.mjs promote --store /private/path/cells.json --candidate /private/path/reviewed-candidate.json --into /private/path/leaf.json --out /private/path/new-leaf.json
```

This locks and re-reads the store, candidate and target together, checks their exact binding,
and reuses the existing approval/excluded-evidence gates. Output is a NEW private leaf with
pending entries; the original leaf is unchanged. Nothing is published. A check-only result is
not a reusable authorization token. Use `promote` for the check and write under the same lock.

Legacy version 1 stores are refused in normal operations. Explicit migration preserves the old
file and creates a new version 2 store with NO permissions; no consent is inferred:

```sh
node apps/leaf/cells.mjs migrate --store /private/path/old-cells.json --out /private/path/new-cells.json
```

Old drafts need to be created and reviewed again after migration. Keep one authoritative store:
copies are independent, and an old backup cannot know a later denial or retraction occurred.

Asana input must contain exactly `gid`, `name`, `modified_at`, `completed`, `assignee` (null or
an object containing only `gid`) and `projects` (objects naming project gids). Supply this
projection from an authorized task read/export. No Asana token is read and no API request is
made by this CLI. Project membership is a claim in the supplied snapshot, not an independently
verified authorization. No task descriptions, comments, attachments or approval events are read.
`modified_at` is the snapshot's source time, not a contribution's completion time. The assignee
is recorded inside the snapshot and is never assigned as the cell's actor.

Git imports require one full immutable commit ID and an exact declared-author email match.
Git reads now share `@foliage/leaf/git-source` with Photosynthesis gathering and the existing
signature-aware intake. The latter retains its verifier pins and signature checks; passive
metadata reads explicitly disable signature display and never manufacture a proof tier.
The cell stores its subject and authored timestamp, not its patch, test result or delivery
outcome. Email matching does not verify authorship. Empty commit subjects are explicitly
unsupported in this initial adapter rather than replaced with invented evidence.

## Identity and history

Cell identity hashes source kind, source scope and source object. Revision hashes the canonical
observation, including source revision, source time, actor and original/structured text. The
observation time is separate: importing identical content again leaves the entire store unchanged.
An altered observation with the same source revision is refused. Older or ambiguous new source
revisions are refused. Accepted revisions remain in order, and draft selection uses the newest.
Git scope uses the canonical common Git directory, so linked worktrees share identity. Moving
or cloning that repository creates another scope; portable repository identity is future work.

The source's actor is distinct from the portfolio subject. Selecting evidence for a draft does
not establish that the subject did the work. These relationships still require review.

Draft identity binds title, selected cells, their revisions and current permission records. Every original source reference
and cell revision reference crosses into candidate evidence. Original Git refs are retained so
the existing excluded-evidence promotion check still applies. No model-generated interpretation
is relabelled as original evidence. Candidate output stays unreviewed and target-bound. Promotion
does not turn it into verified evidence or a public release.

Exported drafts are historical snapshots, not live views. Later imports do not rewrite their
bytes, but consumption through the live-store gate refuses stale or retracted evidence.
The cell-snapshot refs are inspectable in the local store; the existing source-reader
UI does not yet resolve them automatically.

## Deliberate limits and next gates

- No automatic semantic grouping, all-history import, LLM interpretation, search/vector store,
  manager scheduler or Photosynthesis–Ladybug feedback loop was added.
- No inferred approval, task-completion-to-impact mapping, personal score or cross-user ranking.
- No Asana webhooks, remote permission validation, OAuth or background synchronization.
- Local JSON is bounded to 8 MiB and 10,000 stored revisions. It is not a production database.
- Cell writes use the existing atomic writer with file fsync before rename/link and directory
  fsync after cleanup. A file-sync failure preserves the prior document; a directory-sync failure
  reports that bytes are visible but durability is uncertain. These paths are failure-injection
  tested, not a physical power-loss/storage-hardware guarantee. No multi-file transaction is claimed.
  Interrupted locks require inspection; no automatic lock stealing.
- Local consent/retraction is enforced, but provider permission changes are not detected remotely.
  Retention scheduling, permission audit history and a downstream revocation graph are still absent.
- Previously promoted leaf files, assessments, exports and hosted pages are NOT retrospectively
  changed. This is not the hosted immediate-withdrawal implementation. Never wire unattended
  publication on the assumption this local gate withdraws an existing public artifact.

Next: connect the authoritative store to downstream artifact invalidation and remote permission
refresh, then wire bounded automatic capture and models. Background capture remains disabled.
Reuse existing scheduler and Ladybug branches rather than building duplicate runtimes.

## Consolidation status

`packages/leaf/src/gitSource.ts` is the shared Node-only Git acquisition module, exported as
`@foliage/leaf/git-source`. Intake and harvest keep the signature-aware `readCommits` path;
`apps/leaf/src/gitIntake.ts` is only a compatibility re-export. Photosynthesis gathering and
cell capture share `readGitMetadata`. Acquisition shares one process runner, while attribution,
source permission, grouping and signature findings retain their distinct responsibilities.
No package's pure root export imports this Node-only module.

The cells path already uses the existing document locks/writer and Photosynthesis promotion
gate. No additional persistence engine or review queue was introduced in this consolidation.

Still outstanding across the journey branches: adapt scheduler/brief Git reads to this module,
reconcile workflow process ownership with document transactions, and migrate saved workflow
proposals to authoritative cell references without losing decisions or granting permissions.
The two existing prefix-grouping policies also differ (fallback label, prefix-length limit and
ordering); changing them requires preserving candidate identities, not a blind shared-helper
replacement. These remaining integrations are not claimed complete by the Git adapter move.
