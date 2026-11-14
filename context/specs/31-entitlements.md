# Unit 31: Model offers without changing ownership

Build package: `B12` · Owner: [canopy](../apps/canopy.md)
Acceptance: OP06, OF01, OF02, OF03, OF04, OF05
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide explicit offer and entitlement state that cannot alter personal evidence rights.

## Design

Payer, subject, tenant and supported limits are separate; absent approved offer has no purchase action.

Shared interface contract: [deployment-and-service](../contracts/deployment-and-service.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Define versioned offer config and effective entitlement records behind an adapter.
2. Connect UI access/limits to the relevant service capability while preserving standalone local reading/export.
3. Handle grace, cancellation, downgrade and unavailable billing state without publishing or deleting evidence.

## Dependencies

- Required units: [03](./03-hosted-session.md), [04](./04-identifier-ownership.md), [06](./06-authority-schema.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Another payer cannot acquire subject authority.
- [ ] Cancelled hosting retains the promised authorized exit/export behavior.
- [ ] UI shows actual approved offer/limit state with no fabricated price or checkout.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
