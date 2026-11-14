# Unit 06: Persist authority and operations atomically

Build package: `B02` · Owner: [canopy](../apps/canopy.md)
Acceptance: ST01, AU02
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide the canonical hosted authority schema and transactional mutation/receipt API.

## Design

Reuse existing Supabase migrations; add forward migrations with default-deny table/RPC access.

Shared interface contract: [storage-and-operations](../contracts/storage-and-operations.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Integrate personal ownership, heads, revisions, generations, operation receipts, history and outbox schema.
2. Enforce actor-operation uniqueness, changed-body conflict and matching-retry lookup before new work; use scope-aware constraints and appropriate row/advisory locking.
3. Expose RPC interfaces with verified server actor and bounded arguments; browser access cannot bypass server authority.

## Dependencies

- Required units: [03](./03-hosted-session.md), [04](./04-identifier-ownership.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Independent concurrent writers cannot split head, receipt and outbox.
- [ ] Forced transaction abort leaves prior authority intact.
- [ ] Matching receipt is stable after later withdrawal; changed request digest conflicts.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
