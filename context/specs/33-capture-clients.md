# Unit 33: Retain authorized desktop artifacts

Build package: `B03` · Owner: [capture](../apps/capture.md)
Acceptance: LV01, ST04, OP01
Specification: ready · Implementation: not accepted by this specification.

## Goal

Provide a concrete capture handoff for local document/media/AI-export artifacts into existing review.

## Design

Start with the owner-selected desktop filesystem/export workflow; a native shell is an adapter, not a new evidence store.

Shared interface contract: [agents-and-evaluation](../contracts/agents-and-evaluation.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Define selected-root/file permission, source identity, captured-byte digest, MIME, observed time and revocation in the existing artifact/cell contract.
2. Reuse current local artifact/media/session import adapters for Claude/ChatGPT exports and other retained files; no hidden account scraping.
3. Implement platform-specific file access/picker packaging only in its owning capture adapter; keep raw bytes local and report unsupported formats/permissions.

## Dependencies

- Required units: [09](./09-sources-cells.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] An actual selected document/media artifact reaches private review with retained provenance.
- [ ] Permission refusal/revocation prevents new reads and preserves prior authorized decisions.
- [ ] Metadata-only records never claim captured content; hardware attestation is not invented.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.

## OpenClaw launch slice — 2026-09-21

Extend the existing Foliage marketplace skill with a portable Photosynthesis host adapter.
Use the existing CLI and canonical garden; no new capture or approval store. Inputs are
explicit runtime/garden paths and a selected repository or the existing watched-source list.
Expose doctor/status/refresh, preserve subprocess failures, and refuse publication commands.
Validate the actual npx skills install into an isolated OpenClaw workspace, real Git refresh,
repeat refresh, and absence of an implicit cwd source. Runtime dependencies remain required;
this slice does not install OpenClaw, enable schedules or implement scoped autopublication.

## Local web demo browser slice — 2026-10-08

**Goal.** Let an owner-enabled agent inspect a real local app page in its own guarded browser,
choose a scene, and retain a still plus short MP4 as one private Review candidate. This does
not discover arbitrary running apps, capture the desktop, approve claims, or publish media.

**Design.** The owner pins one exact numeric-loopback origin when opening the MCP connection
and separately enables page inspection because the preview can reach the connected model.
The grant covers any path under the origin, including private pages. The agent receives bounded
pixels and visible controls from one short-lived Chrome profile. It may scroll or click a named,
currently visible control returned by inspection, then records the same browser state.
Page text is untrusted data; no arbitrary script or CDP is exposed. A click can change the
local app even when no POST occurs.

**Implementation.** Reuse the existing capture browser, origin proxy, receipt, digest and
Review queue. One-shot CLI/UI capture remains a wrapper. The session closes after recording,
explicit close, idle expiry or disconnect. Output stays private until the existing human
Review and separate public-media selection.

**Dependencies.** Existing local capture adapter, Chrome/Chromium, ffmpeg and unit 12's
Review queue. No new package, model provider or cloud service.

**Verify when done.** Use a real local HTML page to inspect a visible control, click it,
record the resulting state and observe one unreviewed two-artifact candidate. Refuse another
origin, a new tab and a post-click write; verify cleanup and one-shot capture regression.
Run focused tests and the repository gates. Browser UX acceptance remains distinct from
protocol checks.
