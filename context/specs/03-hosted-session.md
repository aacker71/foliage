# Unit 03: Verify hosted sessions and recovery

Build package: `B01` · Owner: [canopy](../apps/canopy.md)
Acceptance: AU01, OF05
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide a verified server actor for every protected request and a recoverable sign-in flow.

## Design

Clerk is the selected hosted identity provider. Anonymous, pending and active sessions
remain distinguishable; issuer-scoped actors preserve portfolio ownership in Supabase.

Shared interface contract: [identity-and-admission](../contracts/identity-and-admission.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Use the owner-selected Clerk identity and private browser bridge, preserving CSRF and stable issuer-scoped actors. Keep the Supabase identity adapter only as legacy migration/test coverage; no hosted fallback.
2. Wire sign-in, sign-out, refresh, confirmation and recovery with same-origin mutation/CSRF checks and bounded redirects.
3. Keep local Photosynthesis usable without identity service; expose unavailable identity separately from invalid credentials.

## Dependencies

- Required units: [01](./01-candidate.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Expired, anonymous, mixed bearer/cookie and replayed recovery requests refuse.
- [ ] A second account cannot obtain the first actor or operation state.
- [ ] Lost token exchange never reports a completed session; return-to-review survives successful recovery.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
