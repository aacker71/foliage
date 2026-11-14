# Unit 25: Connect website promises to actual offers

Build package: `B09` · Owner: [www](../apps/www.md)
Acceptance: OF01, OF02, OF03, OF04, OF05, OP02
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide accurate offer pages and working start/help paths for the five customer audiences.

## Design

Reuse the existing Next site and shared design; distinguish prototypes and unavailable offers.

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Integrate the website release line and resolve overlap with Canopy marketing routes through canonical navigation.
2. Wire each CTA to the owning available application or an honest availability/support state.
3. Keep self-hosted assets, day surface and accurate local/cloud explanation; no fabricated portfolio or customer proof.

## Dependencies

- Required units: [02](./02-deployment-package.md), [20](./20-public-discovery.md), [24](./24-public-portfolio.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Every visible CTA resolves to the intended experience on the actual deployment.
- [ ] Mobile/keyboard/reduced-motion/error pages work.
- [ ] Page copy matches accepted capability status and no unchecked pricing/terms promise is published.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
