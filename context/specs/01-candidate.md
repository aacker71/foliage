# Unit 01: Reconcile one reproducible candidate

Build package: `B00` · Owner: [leaf](../apps/leaf.md)
Acceptance: ST04, OP02
Specification: ready · Implementation: locally accepted; see [candidate evidence](../../docs/acceptance/2026-09-15-live-portfolio.md). Hosted acceptance is separate.

## Goal

Produce one named integration candidate containing retained local safety and the selected sibling functionality, with a reviewable provenance map.

## Design

No new product feature. Preserve the dirty checkout and identify which commits or explicit patches own each change.

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Record main working-tree changes and sibling commits before making an isolated candidate; do not reset, prune or stage unrelated work.
2. Integrate source/cell workflow, Scarlet naming and achievement/public-format work as separate reviewed patches; preserve enterprise durable release storage.
3. Run the exact candidate gates; record every failure with its owning change. List optional bundles/assets and current export maps before packaging.

## Dependencies

- Required units: None; start with current source inspection.
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [x] Original working-tree bytes and real documents remain intact.
- [x] Candidate commit and ordered source changes are reproducible.
- [x] Full pnpm check output belongs to that candidate; mismatched versions are resolved rather than patched around.
- [x] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [x] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
