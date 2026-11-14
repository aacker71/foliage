# Unit 05: Admit exact reviewed evidence

Build package: `B01` · Owner: [canopy](../apps/canopy.md)
Acceptance: AU02, AU03, AU04, OF05
Specification: ready · Implementation: not accepted by this specification.

## Goal

Create a verified admission binding for exact content while retaining narrow attribution claims.

## Design

Show exact subject, revision and audience; attribution status and consent are separate facts.

Shared interface contract: [identity-and-admission](../contracts/identity-and-admission.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Integrate current format parsers, hostedAdmission and independent GitHub proof adapter together; audit every v2/v3/v4/v5 consumer during migration.
2. Bind actor, subject, operation, artifact/policy digest, expected revision/generation and final consent.
3. Admit pending evidence honestly; preserve stale/unsupported/refused causes. Reject claims of verification based solely on upload signatures.

## Dependencies

- Required units: [03](./03-hosted-session.md), [04](./04-identifier-ownership.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Changed bytes, subject, audience or policy invalidate admission.
- [ ] A valid signature over fabricated attribution does not mint proof.
- [ ] Private/excluded support cannot leak through a public authored claim.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
