# Unit 18: Apply agent roles without inherited permissions

Build package: `B08` · Owner: [enterprise](../apps/enterprise.md)
Acceptance: AU05, LV02, LV03, LV04
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide bounded team, organization, governance and forest proposals using the same authority contract.

## Design

Dee Dee, Picus, Fern and Pango expose scope/purpose/tools; hierarchy is not an access grant.

Shared interface contract: [agents-and-evaluation](../contracts/agents-and-evaluation.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Define role-specific tool allowlists over existing group/release models; reuse run/context infrastructure.
2. Keep enterprise-owned inspection in the enterprise plane and Canopy-owned maintenance in cloud; exchange admitted contracts across boundaries.
3. Route changes to the appropriate existing review queue with exact scope/revision; no second approval store.

## Dependencies

- Required units: [14](./14-group-governance.md), [15](./15-member-exit.md), [17](./17-cloud-conversation.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Each role produces a useful authorized observation or proposal on real input.
- [ ] Out-of-scope tools and cross-company reads refuse regardless of role name.
- [ ] Forest maintenance cannot disclose or publish private personal/company work.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
