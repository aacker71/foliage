# Unit 30: Expose actionable safe operational signals

Build package: `B11` · Owner: [canopy](../apps/canopy.md)
Acceptance: OP04, AU05, EV03
Specification: ready · Implementation: not accepted by this specification.

## Goal

Let an operator trace a failed portfolio update across collection, inference, publication and delivery.

## Design

Use correlated IDs and technical performance facts, never personal scores or private prompt logs.

Shared interface contract: [deployment-and-service](../contracts/deployment-and-service.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Emit structured stage/operation/revision/run/delivery events with redacted causes and safe timing/resource fields.
2. Add queue-lag, unavailable-authority, retry/unknown-outcome and cleanup incident views with explicit missing-telemetry state.
3. Exercise bounded workload/backpressure and alert/incident/takedown drills; scope access to operational roles.

## Dependencies

- Required units: [06](./06-authority-schema.md), [17](./17-cloud-conversation.md), [21](./21-outbox-dispatch.md), [27](./27-cloud-evaluation.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] A forced failure is traceable to its stage and original cause.
- [ ] Credentials/raw evidence are absent from logs and metrics.
- [ ] Overload degrades honestly with bounded queues; actual capacity evidence precedes service promises.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
