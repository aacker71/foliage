# Unit 24: Complete the achievement-first reader

Build package: `B09` · Owner: [canopy](../apps/canopy.md)
Acceptance: OF01, OF04, OF05, UX03, AU04
Specification: ready · Implementation: not accepted by this specification.

## Goal

Present biography, keystones and the continuous compound-leaf timeline with useful claim-level evidence access.

## Design

Day reader; one compound leaf per selected view, source colors, clear date meaning and owner-selected highlights.

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse shared person-portfolio and Three.js timeline from the achievement branch, including freshness receipts/native fallback.
2. Integrate authored-context publication, claim anchors, logos/media only when admitted, and named-view filtering without duplicating evidence.
3. Finish populated public and private browser review using real authorized accounts; unsupported media and empty collections remain readable.

## Dependencies

- Required units: [08](./08-current-reader.md), [11](./11-achievement-model.md), [23](./23-shared-review-ui.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Scroll/tap/hover and keyboard lead to the correct leaflet and its claim support.
- [ ] Newest/oldest/notable controls preserve dates, selected scope and readable fallback.
- [ ] No private citation, invented media, ranking or outcome-verification claim reaches public HTML/assets.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.

## Customization extension — 2026-09-16

Extend existing authoring and rendering under the [harness customization contract](../proposals/portfolio-harness.md#81-user-and-scarlet-customization--required-product-scope).
Users and Scarlet share canonical edit operations; portfolio/view/leaflet overrides must
round-trip through preview, storage and publication. Reuse existing curation, named views,
media and achievement editors; do not create a separate agent editor or evidence store.

Additional acceptance: manual/agent parity, inheritance/reset, undo/redo, version conflict
refusal, preserved user edits and citations, revoked/visitor tool refusal, and real mobile
rendering of a customized published version. Full implementation remains pending.

### Current implementation order — 2026-09-17

Continue the existing units, not a separate redesign backlog:
1. Adopt the approved shared primary-action and Leaflet panel shapes in the native applications (current slice).
2. Complete revision-bound customization: named-view inheritance and the local live preset preview
   use the shared operation; immediate undo writes a new revision. Bounded style history records
   manual/agent changes and supports restore/reapply through that same operation. Typography,
   rhythm, source palette, branching/linear layout, split/stacked introduction composition and
   contained/panel-width admitted-media framing now round-trip through private and public
   renderers. Media selection/admission, persisted motion settings and history for other portfolio
   fields are next.
3. Connect cloud Scarlet through units 16–18 to the same edit operations; local MCP support is not cloud completion.
4. Present actual collaborators/shared-project relationships where permitted evidence exists; no invented community.
5. Rehearse source → review → portfolio refresh → explicit hosted publication through units 09–13 and 24.

Open Design changes are design acceptance inputs; they do not complete the app or deployment checks.
