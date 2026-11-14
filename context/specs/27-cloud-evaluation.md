# Unit 27: Run isolated cloud and customer evaluation

Build package: `B14` · Owner: [evaluation](../apps/evaluation.md)
Acceptance: EV02, EV03, EV04, AU02, AU03
Specification: ready · Implementation: not accepted by this specification.

## Goal

Dispatch the same contract to an isolated cloud/customer executor and return admitted evidence.

## Design

No arbitrary code in the web process; no fallback when required isolation is absent.

Shared interface contract: [agents-and-evaluation](../contracts/agents-and-evaluation.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Implement leased job/run IDs and stale-attempt fencing using current grants and exact scenario/revision/image.
2. Use the deployment isolation contract, independent trusted issuer enrollment/revocation and minimized signed result transfer.
3. Feed the existing private review/update/publication path; default refuses unattended newly generated commands.

## Dependencies

- Required units: [26](./26-local-evaluation.md), [06](./06-authority-schema.md), [17](./17-cloud-conversation.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Escape/egress/resource policy checks run on the real selected sandbox environment.
- [ ] Revocation and stale worker completion cannot admit an obsolete result.
- [ ] Two real authorized evaluation → review → publication cycles retain exact receipts and no raw-private leakage.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
