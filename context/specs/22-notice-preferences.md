# Unit 22: Make permitted channels and recovery work

Build package: `B07` · Owner: [canopy](../apps/canopy.md)
Acceptance: NT01, NT02, NT03, UX02
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide preferences, safe notices and authenticated delivery callbacks for enabled channels.

## Design

Generic inbox/email/SMS notice defaults, exact review return, accessible preference controls.

2026-09-23 bounded preference slice: persist the owner's weekly-summary default and optional
additional daily digest in the existing account preferences. Both may be disabled. Keep
channel consent and collection cadence separate; preserve opt-outs and older channel-only
saves. Browser forms remain account/CSRF-bound. Clearly label summary delivery unavailable
until summary generation and delivery are implemented and accepted. Verify actual SQL
migration/defaults/isolation and preference form saves without sending messages.

Shared interface contract: [notifications](../contracts/notifications.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Configure allowlisted workflows and verified senders in operator-selected test environments.
2. Implement quiet-time/timezone/digest preferences without changing authorization; recheck before dispatch.
3. Authenticate provider callbacks, deduplicate and reconcile out-of-order terminal states; minimize retained payloads.

## Dependencies

- Required units: [21](./21-outbox-dispatch.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Actual permitted test deliveries contain no raw evidence/private review text.
- [ ] Revoked recipient or changed preference between queue and send cancels/defer as specified.
- [ ] Scanners and GET links never approve; unknown callbacks cannot mutate another attempt.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
