# Unit 19: Share explicitly within a private network

Build package: `B06` · Owner: [enterprise](../apps/enterprise.md)
Acceptance: LV05, AU02, AU03
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide participating-company sharing without merging tenant or personal authority.

## Design

Show company grant, personal disclosure grant and recipient access as separate requirements.

Shared interface contract: [identity-and-admission](../contracts/identity-and-admission.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Persist scoped revocable company and personal grants with expiry and matching-update boundaries.
2. Project group artifacts without inventing contributors or leaving identifying text/media behind when personal disclosure is absent.
3. Recheck grants on read and notice eligibility; removal from participation invalidates future access.

## Dependencies

- Required units: [14](./14-group-governance.md), [15](./15-member-exit.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Company permission alone cannot share person-identifying work.
- [ ] Expanded audiences do not inherit a narrower standing grant.
- [ ] Revocation removes subsequent access without deleting unrelated private evidence.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
