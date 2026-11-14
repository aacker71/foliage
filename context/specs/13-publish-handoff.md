# Unit 13: Return a real publication receipt

Build package: `B04` · Owner: [canopy](../apps/canopy.md)
Acceptance: UX01, UX02, UX03, AU03, OF05
Specification: ready · Implementation: not accepted by this specification.

## Goal

Connect exact outward preview to personal publish/replace and a real Canopy URL.

## Design

One effect-specific final action; status recovery retains the same operation ID.

Shared interface contract: [identity-and-admission](../contracts/identity-and-admission.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse localHostedBridge and native manager plus React control parity; authored context remains explicit opt-in.
2. Bind reviewed artifact bytes, target subject, audience and current authority to the final personal action.
3. Recover original receipt after interruption; display original outcome separately from current visibility and safe return-to-review.

## Dependencies

- Required units: [07](./07-immutable-objects.md), [08](./08-current-reader.md), [12](./12-local-review.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Company approval, private grant or agent request cannot publish a personal portfolio.
- [ ] Changed claim/support invalidates the preview.
- [ ] Successful receipt links to the actual revision; lost acknowledgement never creates a second operation.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.

## Hosted onboarding follow-up — 2026-09-15

Stop asking new users to reserve identifiers and understand evidence schemas. Provide a
short portfolio-oriented start and an existing-export fallback. A real Photosynthesis
connection is required for complete onboarding; this unit does not pretend it is available.

### Design

Lead with the person's work, then gather → review → share. Show connection availability
honestly. Existing users see portfolio status and one next action. Import takes one export;
GitHub verification and portfolio settings are disclosed on demand. The private preview
precedes the final Publish action. Use shared static controls and Foliage tokens.

### Implementation

Reuse hostedApp, reserveSubject, canonical export parser, owner lookup and admission.
POST /manage/import/start validates the export and derives its original subject identifier,
reserving it under the signed-in actor before the existing preview. Never rename subjects,
transfer ownership, publish on import or change device APIs. Retain input on sign-in failure.
No private draft is persisted: imported content is held in the response until final consent.

### Dependencies

This extends the existing handoff unit with the integrated identity and admission adapters.
No new packages or storage schema.
The automatic Clerk-authenticated Photosynthesis connection remains an explicit dependency
for consumer-ready onboarding, not an enabled button.

### Verify when done

- Empty and existing portfolio pages use plain language without identifier setup.
- Import reaches exact-content preview without publishing; final consent still required.
- Invalid input, foreign owner, cross-origin and expired session are handled honestly.
- Full repository gate, browser desktop/narrow layout, and preview deployment.

## Click-through connection implementation — 2026-09-15

Replace the interim export-first experience with local service discovery → Google SSO →
private preparation → rendered preview → explicit Publish. No password, identifier typing,
export file or typed publication confirmation is part of this path. Candidate approval and
sharing selections remain human decisions; no private record is silently offered.

The companion listens on loopback port 4180, answers discovery only for its configured
Canopy origin, and opens an authenticated connection review. It retains a random verifier
and one-use state in process memory for five minutes. The browser returns a signed grant
by POST to the exact loopback callback; only the local verifier makes it a usable credential.
A purpose-separated HKDF key derived from the Clerk server secret signs the grant. Its
origin, user, session, verifier digest and at-most-one-day expiry are checked before fresh
Clerk session/user checks on every device request. Browser-cookie transport cannot inject
these device credentials. A device cannot mint another device grant. Sign-out revokes its
Clerk session; expiry requires reconnecting through SSO. No silent token refresh is claimed.

Connection state stays in the existing owner-only local bridge file. No new identity table,
parallel provider, or cloud publication authority is introduced. The original operation
receipts, review digests, stale-source refusal and explicit publication remain unchanged.
Private preview must keep same-origin form policy and the portfolio enhancement CSP.

Acceptance: incorrect verifier/signature/origin/expiry/session, callback replay and foreign
return refusal; current account consent with CSRF; no password field; private preparation
without publication; original operation recovery; correct local-network-denied and missing
installation states. Native installer distribution, long-lived device renewal, source-model
automation and complete first-run live acceptance remain independent unfinished work.
