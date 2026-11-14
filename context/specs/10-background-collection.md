# Unit 10: Own background collection lifecycle

Build package: `B03` · Owner: [leaf](../apps/leaf.md)
Acceptance: LV01, OP01, ST04
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide start, stop, resume and observable state for the existing collection process.

## Design

UI reflects actual process/run state and last result; disabled scheduling is shown explicitly.

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse existing workflow scheduler/process ownership rather than introducing another timer service.
2. Bind scheduled work to current grants, source IDs and supported local configuration; stop on revoked scope.
3. Preserve durable run status, bounded retry and interruption causes; re-read source/decision state before applying updates.

## Dependencies

- Required units: [09](./09-sources-cells.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Start/stop/restart does not spawn duplicate collectors or lose decisions.
- [ ] Revoked sources cannot continue reading.
- [ ] Timed-out, failed and never-run states are distinguishable in UI and logs.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
