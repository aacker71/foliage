# Unit 04: Reserve identifiers without transferring subjects

Build package: `B01` · Owner: [canopy](../apps/canopy.md)
Acceptance: AU01, OF05, OP06
Specification: ready · Implementation: not accepted by this specification.

## Goal

Allow a verified person to reserve and recover their portfolio identifier independently of payer identity.

## Design

Conflict and already-owned outcomes explain the actual result without disclosing another account.

Shared interface contract: [identity-and-admission](../contracts/identity-and-admission.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse reserveSubject/listOwned in the sibling store and unique database ownership constraints.
2. Bind reservations and reads to verified actor; paginate owned identifiers using an opaque continuation.
3. Preserve ownership across cancellation, session recovery and repeated reservation. No email-based reassignment.

## Dependencies

- Required units: [03](./03-hosted-session.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Concurrent different-account reservation has one owner.
- [ ] Repeated same-owner reservation is stable.
- [ ] Foreign inventory/status requests disclose no owned identifiers.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
