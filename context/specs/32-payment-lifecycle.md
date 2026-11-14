# Unit 32: Reconcile payment and support outcomes

Build package: `B12` · Owner: [canopy](../apps/canopy.md)
Acceptance: OP06, OP05
Specification: ready · Implementation: not accepted by this specification.

## Goal

Connect the configured payment provider and support workflow with idempotent receipts.

## Design

Provider-neutral checkout/webhook/status adapter; real charging requires approved offer configuration.

Shared interface contract: [deployment-and-service](../contracts/deployment-and-service.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Implement authenticated checkout initiation bound to account/offer version and a stable operation.
2. Verify webhook authenticity, deduplicate provider events and reconcile out-of-order/unknown outcomes using provider status.
3. Provide cancellation/refund/support and export/deletion paths under approved terms; no LICENSE generated.

## Dependencies

- Required units: [31](./31-entitlements.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Test-mode declines, duplicate events, disputes and lost acknowledgements do not double-charge.
- [ ] Payment events cannot transfer ownership or publish content.
- [ ] Live paid acceptance waits for real merchant/price/terms/support inputs and actual authorization.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
