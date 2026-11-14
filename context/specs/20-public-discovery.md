# Unit 20: Offer consented public discovery

Build package: `B06` · Owner: [recruiter](../apps/recruiter.md)
Acceptance: LV06, OF04, AU02, AU03
Specification: ready · Implementation: not accepted by this specification.

## Goal

Allow deliberately listed current publications to be found through truthful reader-selected filters.

## Design

Unlisted/shared-link reading remains distinct from indexing; no ranking or score.

Shared interface contracts: [deployment-and-service](../contracts/deployment-and-service.md) and
[portfolio distribution](../contracts/portfolio-distribution.md). Unit 20 owns listing/search;
unit 35 adds opportunity views, export and inquiry without duplicating the index.

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Record explicit listing consent separate from publication/private-network participation.
2. Reuse the single public projection and current-authority reader for search/list/detail/subscription references.
3. Support only declared filters and chosen date/alphabetical order; remove revoked results and require current access when opening notifications. Distinguish declared interests from cited artifact topics; do not compute person relevance scores.
4. Make opted-in public HTML, canonical URLs, sitemap and ProfilePage/Person metadata reflect the same admitted visible claims. Search-engine indexing is separate from directory listing and is not guaranteed. Unlisted/private fields must not leak through snippets, metadata or stale indexes.
5. Keep public reading account-free and accessible without WebGL. Connect to the shared inquiry/subscription flow when available; do not send introductions or imply a reader viewed a result from a crawler request.

## Dependencies

- Required units: [08](./08-current-reader.md), [14](./14-group-governance.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Unlisted/private-only content never appears in search, metadata or subscriptions.
- [ ] Listing withdrawal and source withdrawal remove reachability through all discovery paths.
- [ ] A reader can explain what filter/date labels mean without inferred capability claims.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
