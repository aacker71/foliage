# Unit 07: Commit private publication objects

Build package: `B02` · Owner: [canopy](../apps/canopy.md)
Acceptance: ST01, ST02, OF05
Specification: ready · Implementation: not accepted by this specification.

## Goal

Publish exact admitted bytes using private immutable objects and one authoritative database commit.

## Design

Preserve separate staging, committed and unknown outcomes; no public object URL.

Shared interface contract: [storage-and-operations](../contracts/storage-and-operations.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse hostedStore staging/digest verification; extend admitted media manifests through the same current-authority contract.
2. Lookup original operation first, stage bytes, then recheck authority/version at commit; retain old head on precommit refusal.
3. Implement reference-checked cleanup of orphan staging; never delete on an uncertain acknowledgement.

## Dependencies

- Required units: [05](./05-admission.md), [06](./06-authority-schema.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Upload failure and transaction refusal preserve the prior head.
- [ ] Lost commit acknowledgement recovers the same operation.
- [ ] Missing committed bytes fail closed without returning an old revision.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
