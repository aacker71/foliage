# Unit 21: Dispatch committed notification intent

Build package: `B07` · Owner: [canopy](../apps/canopy.md)
Acceptance: NT01, ST01
Specification: ready · Implementation: not accepted by this specification.

## Goal

Run a bounded durable notification dispatcher over committed events.

## Design

Keep saved action and provider delivery states separate; preserve uncertainty.

Shared interface contract: [notifications](../contracts/notifications.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse owner-notification migration and hostedNotifications adapter; expand recipient scope only with explicit current grants.
2. Claim bounded batches with database lease/fence, current preflight and persisted dispatch marker.
3. Recover crashed workers and same delivery IDs; unknown send outcomes require reconciliation rather than blind resend.

## Dependencies

- Required units: [06](./06-authority-schema.md), [13](./13-publish-handoff.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Crash before and after dispatch marker cannot lose intent or silently double-send.
- [ ] Late stale-lease completion cannot overwrite current state.
- [ ] Provider accepted is never labeled delivered without delivery evidence.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
