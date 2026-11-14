# Unit 28: Package a working private enterprise install

Build package: `B10` · Owner: [enterprise](../apps/enterprise.md)
Acceptance: OP08, OP01, OP05
Specification: ready · Implementation: not accepted by this specification.

## Goal

Deliver versioned private deployment adapters with install, upgrade and offline-safe behavior.

## Design

OCI app/worker images plus declared identity, database/object and optional inference/channel adapters.

Shared interface contract: [deployment-and-service](../contracts/deployment-and-service.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Implement the supported private Postgres/object/verified-actor interfaces without cloud imports in the open set.
2. Provide versioned configuration validation and data-preserving upgrade/migration/rollback paths.
3. Disable external inference/notifications by default; local permitted reading/review/inbox remain usable offline.

## Dependencies

- Required units: [07](./07-immutable-objects.md), [15](./15-member-exit.md), [18](./18-scoped-agents.md), [21](./21-outbox-dispatch.md), [23](./23-shared-review-ui.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Real customer-like private environment installs, upgrades and restores without cloud fallback.
- [ ] Network observation confirms prohibited egress is absent.
- [ ] Interrupted upgrade retains recoverable data and current revocation state.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
