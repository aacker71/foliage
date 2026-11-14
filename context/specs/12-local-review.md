# Unit 12: Preserve human review through failure

Build package: `B04` · Owner: [leaf](../apps/leaf.md)
Acceptance: UX01, UX02, ST04
Specification: ready · Implementation: not accepted by this specification.

## Goal

Complete one native review/correction flow that preserves the exact reviewed context.

## Design

What changed, audience/effect and supporting evidence appear before action; no redundant generic confirmation.

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse current draft/version/policy bindings and lock helpers. Keep approval, attribution, promotion and publication separate.
2. Carry rejected/corrected wording and queue position through stale/busy responses.
3. Accept suggestions only through an explicit draft update; edit invalidates the affected approval.

## Dependencies

- Required units: [09](./09-sources-cells.md), [11](./11-achievement-model.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Stale or foreign draft submissions refuse while preserving entered correction.
- [ ] Saved approval plus failed promotion resumes without duplicate Leaflets.
- [ ] Keyboard/mobile user can explain what was saved and what remains private.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
