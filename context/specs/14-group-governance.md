# Unit 14: Model governed company membership

Build package: `B05` · Owner: [enterprise](../apps/enterprise.md)
Acceptance: LV02, LV03, LV04, AU01, AU02
Specification: ready · Implementation: not accepted by this specification.

## Goal

Connect tenant-scoped reporting, collaboration, artifacts and release decisions without conflating authority.

## Design

Organization view exposes acting capacity and the exact group artifact; memberships do not imply contributions.

Shared interface contract: [storage-and-operations](../contracts/storage-and-operations.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse bough/subject/artifactDocument/release domain models and reconcile primary reporting separately from participation.
2. Add tenant-scoped persistence/grants under the hosted authority contract; preserve local durable release history/outbox adapter.
3. Bind admin actions to verified roles; company permission affects company material only.

## Dependencies

- Required units: [06](./06-authority-schema.md), [12](./12-local-review.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] A member belongs to one primary placement per company without duplicate headcounts.
- [ ] Foreign tenant and ancestor-role reads cannot bypass grants.
- [ ] Group-owned evidence can exist without fabricated personal contributors.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
