# Unit 26: Observe and import a real local evaluation

Build package: `B14` · Owner: [evaluation](../apps/evaluation.md)
Acceptance: EV01, EV02, AU04, ST04
Specification: ready · Implementation: local executor, opt-in MCP bridge and same-job
browser observer implemented; full live-portfolio acceptance remains open.

## Goal

Run an explicitly selected scenario on an exact revision and import its honest results into existing review.

## Design

Runtime is separate from the product server; command report, observation and personal claim stay distinct.

Shared interface contract: [agents-and-evaluation](../contracts/agents-and-evaluation.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Integrate sibling tools/eval contracts/local executor/import and reuse the canonical observation queue. Implemented locally.
2. Add replaceable browser/test observer with direct measured facts and source/image/scenario digests; signing stays outside workload. Implemented locally: an optional owner-pinned `browser` scenario launches the app in the same offline job after command steps succeed. A bounded loopback relay reaches only that container's selected port over Docker exec; the existing guarded host browser records it. The result binds capture receipt and media digests to the job, commit/tree/archive, image and scenario. Review admits the checked demo and executor report together, preserving the distinction between an observed run and independent proof. No arbitrary running host app is version-labeled.
3. Preserve limits, cleanup outcome, cancellation, missing stages and private-log selection. Implemented for local executor reports.

## Dependencies

- Required units: [09](./09-sources-cells.md), [11](./11-achievement-model.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Real Docker workload obeys configured limits and is removed; cleanup failure remains visible.
- [ ] Tampered signature/untrusted key or replay-conflict receipt refuses.
- [ ] Imported results preserve prior review and do not imply contribution or business impact.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
