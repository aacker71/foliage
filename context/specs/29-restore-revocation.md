# Unit 29: Rehearse durable recovery

Build package: `B11` · Owner: [canopy](../apps/canopy.md)
Acceptance: OP03, OP05, ST02, ST03
Specification: ready · Implementation: not accepted by this specification.

## Goal

Restore authority and exact object bytes without resurrecting revoked publications or grants.

## Design

Keep service unavailable until restored current authority is established.

Shared interface contract: [storage-and-operations](../contracts/storage-and-operations.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Inventory actual database/object/log/replica/backup regions and retention settings.
2. Implement separately verified object backups and restore receipt/outbox/grant/revocation state with the database.
3. Record operator steps for corrupt/missing bytes and interrupted restore; test compatible migration rollback.

## Dependencies

- Required units: [07](./07-immutable-objects.md), [08](./08-current-reader.md), [21](./21-outbox-dispatch.md), [28](./28-private-deployment.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] An older backup cannot re-enable acknowledged withdrawn content.
- [ ] Matching object digests and original operation receipts survive recovery.
- [ ] Measured recovery evidence and limitations are recorded; no invented RPO/RTO guarantee.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
