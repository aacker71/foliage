# Unit 09: Connect authorized sources to retained cells

Build package: `B03` · Owner: [photosynthesis](../apps/photosynthesis.md)
Acceptance: LV01, ST04, AU04
Specification: ready · Implementation: not accepted by this specification.

## Goal

Capture selected real sources into the canonical cells and candidate review path.

## Design

Show each configured source and its actual state; no invented default portfolio.

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reconcile current cells/gitSource and sibling workflow/import stores; keep source, subject and identity bindings explicit.
2. Use source grants and existing adapters for local repositories/artifact exports; preserve raw source provenance and observation time.
3. Refresh under canonical document locks after slow reads; merge by stable identity without losing another source or prior review decisions.

## Dependencies

- Required units: [01](./01-candidate.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Real authorized input reaches review; repeat capture creates no duplicate evidence.
- [ ] Retraction, exclusion, lost access and changed evidence stay distinct.
- [ ] Failed source read preserves previous valid bytes and another source pending work.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.

## Nango implementation slice — 2026-09-16

Implemented account-bound Connect sessions, bounded source snapshots through Canopy and
companion import into the existing review writer. Reused the MCP/import observation contract
by moving its implementation into Photosynthesis, with a compatibility re-export. No new
evidence schema, review database or candidate merge algorithm.

Acceptance scope: protocol ownership/CSRF/transport checks, pagination and partial/deleted
refusal, local replay preserving review and no publication. Live provider configuration,
source-specific sync functions, automatic connection selection, incremental checkpoints and
revocation propagation remain open. See [integration setup](../../docs/INTEGRATIONS.md).

## Selected personal-project batch — 2026-10-13

### Goal

Let an individual retain several artifacts from one independently chosen project in the
existing private Review queue. This covers work outside an employer repository without
turning a folder, course completion or third-party message into a verified achievement.

### Design

Sources offers one project name and a bounded selection of local text artifacts. The owner
sees each selected file's literal text before one explicit addition. Use the existing
Sources controls and Review destination; do not add a new component, queue or public view.
The browser's file selection is one-time authority to preview those bytes, not permission
to scan the containing folder or sync later.

### Implementation

The selected batch uses the existing `foliage-observations` contract. The owner chooses a
stable, unique project name for this record; preview identifies files that match an existing
project/file pair before import. Each pair has a stable local record identity and a
content-based revision, so an unchanged replay preserves Review decisions and changed
content becomes a distinct unreviewed revision. An owner-edited Review title for the same
revision refuses the whole batch under the existing importer conflict rule, rather than
silently replacing that title or importing only the other files.
All files are validated before persistence. Bound the file count and total bytes below the
observation import limit; refuse duplicate names, unsupported types, empty/binary files and
a changed Leaf. Record observation time as observation time, never a claimed work date.

### Dependencies

Reuse the local Sources picker, observation importer and Review queue. No provider account,
new package, background scheduler or model connection is required.

### Verify when done

- [x] One selected batch reaches the existing private Review queue; no Leaf or public
  publication is written by selection or import.
- [x] Replaying unchanged, unedited files preserves decisions; changed content creates a new
  revision. A locally retitled record causes an explicit whole-batch refusal.
- [x] An invalid file, duplicate name, exceeded bound or changed Leaf refuses the batch
  without a partial write.
- [ ] The real empty, selected, preview, refusal and completion states work at phone and
  desktop widths with keyboard access; source text remains literal, never executed.

## Selected design image — 2026-10-13

### Goal

Let a designer retain the visual artifact itself alongside their account of the problem,
iterations and decisions. The first path starts with artwork the owner selects locally,
such as a Figma frame export; it does not imply a connected Figma or Dribbble account.

### Design

Sources shows the selected PNG/JPEG pixels before one explicit addition to private Review.
The file, the owner's project context and any optional Dribbble URL have separate labels.
A public Dribbble shot URL is an owner-entered reference only: do not fetch or retain Dribbble API data
while its [published API terms](https://developer.dribbble.com/terms/) restrict storage.
Do not admit private Figma file links into candidate evidence: those refs would reach a later
public leaflet if the owner shares it. Review remains the only decision queue. The image is evidence of the selected file's bytes,
not independent proof of authorship, client permission or impact. Public media still requires
a separate owner selection.

### Implementation boundary

Reuse the existing image-byte identification, metadata stripping, content digest, private
media store and photo candidate/promotion path. Admit only bounded actual image bytes through
an owner-initiated local upload; do not render selected SVG/HTML as live markup, make a remote
request on preview, or widen the text-only observation contract to hold binary media.
Preview must not write Review or publication. A changed record, invalid image or unavailable
media store must refuse with its cause rather than leave a claimed image without pixels.

### Verify when done

- [x] A real selected PNG/JPEG appears in preview and in the private Review candidate;
  no Leaf or public page changes from selection or Review intake alone.
- [x] Image signatures, bounds, metadata stripping, repeated selection and failed writes
  follow the existing media/provenance contract without an orphaned public reference.
- [x] The actual selected, preview, refusal and completion states work at phone and desktop
  widths with keyboard access and no horizontal overflow.
- [x] This selected-file path makes no Figma or Dribbble provider request or authenticated
  provenance claim. A direct Figma account flow needs a separate qualified OAuth grant;
  Dribbble API ingestion remains out of scope pending permitted use.
