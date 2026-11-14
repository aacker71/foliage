# Unit 23: Complete shared decision controls

Build package: `B09` · Owner: [leaf](../apps/leaf.md)
Acceptance: UX01, UX02, UX03
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide one reusable accessible decision composition for private applications.

## Design

Use tokens/shadcn; effect-specific actions and evidence disclosure with no visual pressure.

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Extend shared controls only for a needed journey; consume them first in Leaf and hosting review.
2. Preserve native fallback, context and focus across stale/refused/unknown/saved states.
3. Document adaptation points for member/organization once their unit contracts are integrated; do not duplicate components.

## Dependencies

- Required units: [12](./12-local-review.md), [13](./13-publish-handoff.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Actual narrow, medium and wide viewports have usable actions and evidence.
- [ ] Keyboard, reduced motion and measured text contrast have recorded outcomes.
- [ ] Labels distinguish draft approval, company release and personal publication.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
