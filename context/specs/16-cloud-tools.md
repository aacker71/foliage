# Unit 16: Bind cloud tools to approved context

Build package: `B08` · Owner: [ladybug](../apps/ladybug.md)
Acceptance: AU02, AU05, LV01
Specification: ready · Implementation: not accepted by this specification.

## Goal

Create a cloud-side run context with permitted read/proposal tools and verifiable evidence references.

## Design

Local versus cloud location and selected transferred material are visible before inference.

Shared interface contract: [agents-and-evaluation](../contracts/agents-and-evaluation.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Reuse existing assessment/inference/tool schemas and adapt local Scarlet context into the explicit transfer contract.
2. Recheck subject/grants/document/policy digest before tool execution; use server-configured sources and allowlisted tool arguments.
3. Persist minimal operation status and safe tool traces; no autonomous publishing or arbitrary source path execution.

## Dependencies

- Required units: [05](./05-admission.md), [06](./06-authority-schema.md), [09](./09-sources-cells.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Photosynthesis and Scarlet both use the shared Jev decision contract with caller-scoped
  context; neither a claim-check demo nor one caller alone completes this requirement.
- [ ] Keep/pass binds pool, purpose, input and policy revision; uncertainty/failure remains
  unresolved, pass preserves source history, and keep cannot bypass an action grant.
- [ ] Offline/local-only collection remains available without a TypeSafe call; public-reader
  decisions cannot access owner-private context through shared adapter state.
- [ ] Foreign, stale or revoked selected context is refused before model calls.
- [ ] Prompt-injected text cannot add tools, transfer sources or grant rights.
- [ ] Recorded tool use corresponds to actual execution and retained result references.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.

## Bounded local statement-check slice

The Leaf application now exposes an optional direct TypeSafe statement-support operation
under the transfer constraints above. See [Leaf ownership](../apps/leaf.md#optional-statement-support).
It has no cloud-side tools, persisted run trace or publication authority. This slice does not
complete the broader cloud runtime or the acceptance boxes above.

## Shared Jev operation — implementation boundary

`apps/leaf/src/jevTransport.ts` now supplies the bounded fixed-endpoint transport used by
statement checks and `jevPoolDecision.ts`. The exported pool operation accepts either
Photosynthesis or Scarlet caller scope, validates exact selected context and transfer digest,
and returns a private receipt with keep/pass/unresolved, reason and evidence references.
Confidence is an uncalibrated review heuristic, not accuracy or permission. It neither writes
the receipt to disk nor mutates the harvest, Leaf or publication. Protocol tests cover both
caller labels; they do not establish either application's end-to-end integration.

Photosynthesis's composed repository collector now has source-bound transfer grants,
revocation and retained attempts/receipts in the existing workflow store. Each 30-second
timer pass while the schedule runs outside quiet hours (at most three new checks), and the
owner's Retry from `/review`, may send the commit titles of open git drafts in the granted
checkout's repository queue (`harvest.json`, whichever enabled checkout collected them),
plus as context the commit titles of up to eight approved candidates of the same prefix
(policy version 2). Reviewer titles, refs, shas, paths and emails stay local. The native
settings page discloses this commit-title scope; missing permission keeps collection local. Fixed-purpose decisions leave review/Leaf writes
unchanged. See [the implementation boundary](../apps/photosynthesis.md#repository-title-selection--2026-09-27).

Scarlet private journey maintenance now has independent, selected-record permissions and
Jev caller wiring in the existing local workflow. See [Leaf maintenance](../apps/leaf.md#permitted-private-journey-maintenance--2026-09-28).
Remaining: multi-user hosted Scarlet context, richer artifact selection and new evidence
connections, policy configuration, real provider acceptance on authorized material, and
complete Photosynthesis/Scarlet capture-to-publication cycles. Do not enable
background provider calls merely because the adapter accepts a matching digest.
