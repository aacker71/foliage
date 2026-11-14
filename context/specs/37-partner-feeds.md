# Unit 37: Supply contracted talent platforms with current evidence

Build package: `B06` · Owner: [canopy](../apps/canopy.md)
Acceptance: LV06, OF04, AU02, AU03, ST01, ST03, OP04
Specification: ready · Implementation: not accepted by this specification.

## Goal

Make Foliage able to supply permitted, current achievement/evidence projections to a contracted
talent platform, with Juicebox the first proposed partner and no dependency on its customer MCP.

## Design

Follow [portfolio distribution](../contracts/portfolio-distribution.md). Juicebox's published
data-partner contact is a qualification route, not supplier API access. Reuse admitted format,
grants and operation receipts; no new people database, private-source upload or generic bulk
agent export. Provider-specific ingestion schema and commercial terms require partner input.
Build the internal feed contract before any authorized external transfer.

Use [UI context](../ui-context.md) and [code standards](../code-standards.md).

## Implementation

1. Produce the feed schema and capability/terms questionnaire. Prepare a minimal sample only from a consenting real participant's admitted material. Record purpose, field/cohort scope, attribution, retention, update/removal acknowledgement and redistribution/training restrictions requiring agreement. Contacting a partner needs separate owner authority.
2. Implement authenticated scoped changes/resnapshot/acknowledgement interfaces with destination-scoped IDs, stable monotonic cursors, exact digests/generations and bounded pages. Enforce current authority on payloads, conditional reads and attached resources.
3. Persist checkpoints, idempotent processing and per-record partner delivery/index acknowledgement. Expired cursors require scoped resnapshot and reconciliation. No indexed claim follows from an HTTP success alone.
4. Preserve tombstones and a narrowly scoped revocation-only channel after content grants end. Revoke compromised credentials immediately; provide agreed alternate removal handling or mark external removal unconfirmed. Handle late imports, partner disconnect and restore without reviving withdrawn records.
5. Adapt to the first agreed Juicebox or other supplier schema only after qualification. Rehearse real upsert/update/retraction and document actual ownership/retention limits before enabling that destination for a cohort.

## Dependencies

- Required units: [35](./35-distribution-core.md), [36](./36-destination-adapters.md)
- Reuse existing workspace projection, authority, connection and worker packages. Install no
  provider SDK until its first real use is justified and pinned under the contract.
- Real participant, tenant/provider credentials and external agreements are environment inputs,
  never committed. Their absence blocks live acceptance, not truthful link/export fallbacks.

## Verify when done

- [ ] Feed conformance rejects wrong client/cohort/cursor/filter scope and leaks no private fields; paginated updates and tombstones survive retries, gaps and checkpoint expiry.
- [ ] Grant withdrawal mid-page and after delivery denies content, queues removal and cannot be reversed by stale worker/import/restore; compromised credentials do not retain content access.
- [ ] Signed receipts are described as provenance/byte integrity, never truth guarantees; unsupported claims and support limitations survive mapping.
- [ ] Before a live supplier claim: agreed terms, real consenting cohort, partner ingestion receipt, observed update and deletion acknowledgement, and independent reader acceptance are recorded. Otherwise keep the provider explicitly unaccepted.
- [ ] Run focused feed/authority/recovery tests and required candidate gates. Preparing a schema or using paid Juicebox MCP is not supplier acceptance.
