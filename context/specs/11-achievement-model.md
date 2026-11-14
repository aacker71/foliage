# Unit 11: Retain authored achievements and claim citations

Build package: `B03` · Owner: [leaf](../apps/leaf.md)
Acceptance: LV01, OF01, AU04
Specification: ready · Implementation: not accepted by this specification.

## Goal

Integrate biography, achievements, named views and exact claim support without altering source evidence.

## Design

Achievement-first private portfolio; title-only drafts and unsupported claims remain honest.

2026-09-23 refinement: preserve the personal work journey inside the existing achievement
claims. Optional intent, decisions, roadblocks and responses, pivots, discoveries and lessons
join the existing problem/contribution/outcome account. Readable labels are shared across the
local editor, private portfolio/résumé, published reader and distribution export. Motives need
owner support; unresolved challenges and AI assistance remain explicit. No separate narrative
store, forced heroic ending or inference of personal authorship from a commit.

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Integrate the existing achievement branch parsers/editors instead of rewriting the schema.
2. Retain exact citation tuples and collision-safe anchors; preserve authored fields through refresh/promotion.
3. Use explicit named-view membership and owner-selected keystones; resume draft distinguishes local links from public citations.
4. Expose journey kinds through the existing revision-bound MCP tools. Reuse stable account
   identifiers and exact citations. Populate the authorized private record from real sources;
   changing a schema without producing readable accounts does not satisfy this refinement.
5. Owner decision B (engineering review, 2026-09-23): within enabled maintenance scope,
   automation may rewrite manually edited statements. Retain private before/after history
   with actor and time through the existing canonical authoring operations. Offer undo
   against the current revision; restoration is a new recorded edit, not deletion of history.
   Persist history across restart and preserve exact citation tuples. Do not put private
   correction history into public projections. Existing document locks and revision checks
   must refuse stale/concurrent writes; automatic rewriting does not confer publication
   permission or establish the truth of an inferred claim.

## Local history implementation — 2026-09-23

The canonical Leaf now retains `journeyHistory` through the existing manual/MCP writer.
Title/claim changes keep actor, time and exact before/after snapshots; unchanged writes add no
history. `/leaf/presentation?edit=journey-history&achievement=<id>` provides private preview
and version restoration. Restore uses the same current-revision lock and records another edit;
missing/stale/excluded citations refuse, and older words remain readable. Public projection and
public-parser rejection are covered. This field requires coordinated reader/writer upgrades.
History is bounded to 1,024 changes and a 16 MiB UTF-8 write ceiling; exceeding
either refuses the write instead of discarding earlier versions. Archival is not implemented.

Fresh-process undo and manual → agent → restore → second-agent writes passed locally, as did
browser restore on a private copy. These establish the writer/recovery path, not a real host
background loop or participant acceptance. The acceptance list below remains broader than this
slice; automatic source-to-journey orchestration and actual host cycles still need evidence.

## Dependencies

- Required units: [09](./09-sources-cells.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Stale, missing and excluded support are visible and do not erase authored text.
- [ ] Saving a view does not duplicate canonical Leaflets or silently expand membership later.
- [ ] Resume statement links resolve to exact claims and make no independent outcome-verification claim.
- [ ] A manual correction followed by a permitted automatic rewrite retains both versions;
  undo works after restart and updates the portfolio and résumé from the same saved record.
- [ ] Stale undo/concurrent writes refuse without losing either saved version; current
  citations are checked and unavailable evidence is not silently reinstated as verified.
- [ ] Public projection omits private edit history; retries do not duplicate history for an
  unchanged write, and a second automatic update preserves the prior manual/agent versions.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
