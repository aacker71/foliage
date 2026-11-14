# Unit 36: Deliver to authorized recruiting and client systems

Build package: `B06` · Owner: [canopy](../apps/canopy.md)
Acceptance: OF04, AU02, AU03, ST01, OP04
Specification: ready · Implementation: first shared-resume/Ashby-note slice implemented locally; full unit acceptance remains open.
See [integration behavior and remaining scope](../../docs/DISTRIBUTION-INTEGRATIONS.md).

## Goal

Deliver an admitted view to one authorized employer ATS tenant, while preserving a shared
adapter contract for further ATS and client CRM systems and honest fallbacks for closed systems.

## Design

Follow [portfolio distribution](../contracts/portfolio-distribution.md), particularly capabilities,
identity binding and durable delivery. Existing Nango source-read scope is not destination-write
authority. Choose the first ATS from a willing pilot customer's system; qualify Greenhouse or
Ashby using current provider documentation. No purchased access or vendor agreement is assumed.
A direct client-sharing journey works independently; a CRM adapter is advertised only after its
own tenant/object mapping acceptance. Reuse existing hosted operation/outbox primitives.

Use [UI context](../ui-context.md) and [code standards](../code-standards.md).

## Implementation

1. Define the versioned capability manifest and adapter methods in the cloud owner. Track documented/implemented/sandbox-tested/live-accepted per action, provider version and date. Keep link/document fallback available.
2. Bind Nango connections to verified customer actors/tenants and explicit provider scopes. Resolve existing record mappings safely; separate tenant record ID, Foliage identity and destination-scoped external ID. Ambiguous matches stop without duplicate creation.
3. Add adapter projection and the first authorized link/attachment write. Modify only permitted Foliage-owned fields; preserve historical applications, recruiter notes and other providers' data. Pinned resume plus current portfolio link have different update rules.
4. Dispatch using atomic receipts/outbox, current-grant checks, per-binding serialization and lease fences. Preserve partial outcomes; lost acknowledgement enters unknown and reconciles before retry. Respect provider backoff and resource limits.
5. Retract owned content where supported, reconcile late success after revoke, and expose unsupported/removal-unconfirmed outcomes. Emit safe correlated telemetry without document content, tokens or raw prompts. No job submission or outreach permission is inherited.

## Dependencies

- Required units: [35](./35-distribution-core.md)
- Reuse existing workspace projection, authority, connection and worker packages. Install no
  provider SDK until its first real use is justified and pinned under the contract.
- Real participant, tenant/provider credentials and external agreements are environment inputs,
  never committed. Their absence blocks live acceptance, not truthful link/export fallbacks.

## Verify when done

- [ ] A real authorized pilot tenant accepts the intended view/attachment and readback identifies the correct subject and tenant; another tenant cannot read or write it.
- [ ] Test expired credentials, revoked grants, ambiguous identities, duplicate callbacks, 429/backoff, timeout-after-send, partial attachments and out-of-order updates without silent loss or duplicate candidates.
- [ ] Withdrawal denies Foliage reads and cancels pending sends; late success triggers reconciliation/removal. The UI does not claim deletion of an employer-owned record or retained external copy.
- [ ] Actual capabilities, provider version, field ownership and receipts are documented. API acceptance is not reported as recruiter reading or search indexing.
- [ ] Run focused adapter tests and required candidate gates; unavailable credentials remain a named live-acceptance gap, never simulated customer success.

## Native unified ATS connection slice — 2026-10-05

Canopy adds Merge hosted Link under `/recruiting/accounts`, independently of publishing a
portfolio. The verified actor supplies the provider origin ID; user-entered email and
organization are labels only. Server-only, region-pinned credentials create a 30-minute setup
link. Returning reads actor-filtered ATS accounts and validates every row before presenting
status. Connection status does not enable candidate reads, delivery, or application submission.
No browser account-token exchange, SDK, new database or evidence copy is introduced.

Acceptance: authenticated/CSRF-bound setup, foreign-row refusal, regional host restrictions,
bounded pagination, provider outages distinct from zero accounts, accessible setup/return
screens. Real provider authorization requires configured credentials and an employer admin;
local protocol tests do not establish live acceptance. Kombo connection completion and both
providers' delivery adapters remain subsequent work in this unit.

Provider contracts checked for the next delivery slice: Merge activity creation requires
`remote_user_id` alongside its model and a server-held linked-account token; warnings/errors
must not be treated as clean delivery. Kombo adds notes to an **application**, not merely a
candidate, and its success response need not contain a note ID. Do not coerce these actions
into the first Ashby adapter's UUID candidate/reference receipt contract. Extend and migrate
that contract with explicit destination/application/user binding before enabling either write.
