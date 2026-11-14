# Unit 02: Package every actual runtime

Build package: `B00` · Owner: [canopy](../apps/canopy.md)
Acceptance: OP01, OP02
Specification: ready · Implementation: preview packaging exercised; hosted-service acceptance remains blocked on configuration.

## Goal

Produce a deployable preview package for the website and Canopy with their real workspace dependencies.

## Design

Keep separate application entry points; no server dist build added to native TypeScript.

Shared interface contract: [deployment-and-service](../contracts/deployment-and-service.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Use manifests/export maps to collect runtime source, token fonts/marks, shared controls and current optional bundle receipts.
2. Build the Next website only on its integrated path. Validate required environment names without printing values.
3. Publish a preview only under existing deployment authorization and selected environment; otherwise retain the exact package and runnable local acceptance command.

## Dependencies

- Required units: [01](./01-candidate.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Clean install uses pinned runtime and lockfile.
- [ ] Packaged routes load actual shared assets, not another server on the expected port.
- [x] Preview production isolation and source commit are recorded; missing deployment input is a named release gate. See [2026-09-15 acceptance](../../docs/acceptance/2026-09-15-live-portfolio.md#actual-preview-deployment-and-continued-development--2026-09-15).
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
