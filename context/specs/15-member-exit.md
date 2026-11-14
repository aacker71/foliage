# Unit 15: Deliver the enterprise member journey

Build package: `B05` · Owner: [member](../apps/member.md)
Acceptance: OF02, OF03, OP05
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide the member’s own governed view, correction and permitted departure export.

## Design

Dedicated subject experience with policy explanations; not the admin application relabeled.

Shared interface contract: [identity-and-admission](../contracts/identity-and-admission.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Create the reserved enterprise application only at implementation, with its manifest/boundary declaration and verified subject access.
2. Reuse canonical evidence and policy; expose correction requests and exact permitted outward projections.
3. Generate an export manifest of included/withheld/unavailable items under current authority and preserve authorized personal material on departure.

## Dependencies

- Required units: [14](./14-group-governance.md), [13](./13-publish-handoff.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Joined, moved and departed members cannot read another subject’s work.
- [ ] Export opens independently and contains only authorized bytes.
- [ ] Lost company access is not re-rendered as changed evidence or personal failure.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
