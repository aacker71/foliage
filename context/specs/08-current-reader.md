# Unit 08: Enforce withdrawal across all readers

Build package: `B02` · Owner: [canopy](../apps/canopy.md)
Acceptance: ST03, AU03, OF05
Specification: ready · Implementation: not accepted by this specification.

## Goal

Ensure every Foliage-controlled reader path honors current publication authority.

## Design

Unavailable, withdrawn and corrupt content have distinct safe reader states; no private debugging detail.

Shared interface contract: [storage-and-operations](../contracts/storage-and-operations.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Route HTML/HEAD, details, media, downloads, listing and preview through one authority reader.
2. Advance withdrawal generation transactionally and fence stale publishes; integrate existing readPublic final authority recheck.
3. Inventory historic deployments/caches/object routes and disable any bypass before declaring withdrawal accepted.

## Dependencies

- Required units: [07](./07-immutable-objects.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Reads starting after acknowledged withdrawal return no withdrawn bytes across every URL class.
- [ ] Two serving instances and an old deployment observe current generation.
- [ ] Authority outage and corrupt object produce no stale-content fallback.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
