# Unit 34: Make Dify experiments reproducible

Build package: `B14` · Owner: [evaluation](../apps/evaluation.md)
Acceptance: EV01, AU05, OP04
Specification: ready · Implementation: not accepted by this specification.

## Goal

Use the existing isolated Dify tooling to run reproducible development evaluations without coupling it to the product.

## Design

Optional local development service; results describe observed tool/model behavior, not portfolio success.

Shared interface contract: [agents-and-evaluation](../contracts/agents-and-evaluation.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Integrate sibling tools/ai/dify.mjs and evaluate.mjs with pinned checkout/config handling; do not print resolved secrets.
2. Register actual experiment input selection, prompt/model/tool versions and result/trace artifacts under the evaluation contract.
3. Compare a changed workflow on retained authorized cases, keep failure/abstention reports and route findings to existing review rather than auto-promoting outputs.

## Dependencies

- Required units: [01](./01-candidate.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Missing Docker/provider billing/config has a named failure and does not block core portfolio reading.
- [ ] Dify starts/stops under inspected loopback bindings and retains its private state.
- [ ] A reproducible experiment identifies actual mismatches; no canned model-success evidence is generated.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
