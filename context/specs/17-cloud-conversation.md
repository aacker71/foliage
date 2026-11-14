# Unit 17: Stream useful cloud suggestions

Build package: `B08` · Owner: [ladybug](../apps/ladybug.md)
Acceptance: AU05, UX02, OF01
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide a usable sourced cloud conversation and explicit return of a suggestion to review.

## Design

Keep supplied records readable alongside generated text; unsupported/incomplete output is labeled.

Local slice implemented and verified, 2026-09-23: expose a single local collaboration workspace for selected authored
journeys. Send only the displayed journey, cited evidence and owner request through the paired
Canopy companion to Scarlet's existing Fireworks transport. Return editable statement and
curation proposals; apply through existing revision-bound editors. Keep collection settings
in the existing workflow scheduler and email settings in the authenticated hosted account.
Missing provider, scheduler or hosting configuration must remain visible, not become inert
success toggles. This slice does not enable unattended narrative writing or automatic publication.

Shared interface contract: [agents-and-evaluation](../contracts/agents-and-evaluation.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse AG-UI ordering/run identity checks, abort and answer-review controls; connect cloud transport using configured provider credentials.
2. Preserve question and accepted bounded history through retry; track unknown remote outcomes distinctly.
3. Add explicit apply-to-draft handoff with current draft digest, then normal human review.

## Dependencies

- Required units: [16](./16-cloud-tools.md), [03](./03-hosted-session.md), [07](./07-immutable-objects.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Real selected evidence produces assessable cited explanations, not a canned answer.
- [ ] Provider unavailable, interrupted stream and unknown citation preserve useful local reading.
- [ ] A suggestion cannot overwrite a changed/approved draft or publish.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
