# Unit 40: Accept the integrated complete product

Build package: `B13` · Owner: [canopy](../apps/canopy.md)
Acceptance: LV01, LV02, LV03, LV04, LV05, LV06, OF01, OF02, OF03, OF04, OF05, UX01, UX02, UX03, AU01, AU02, AU03, AU04, AU05, ST01, ST02, ST03, ST04, NT01, NT02, NT03, OP01, OP02, OP03, OP04, OP05, OP06, OP07, OP08, EV01, EV02, EV03, EV04
Specification: ready · Implementation: not accepted by this specification.

## Goal

Produce one traceable release decision covering every offer, portfolio level and supported deployment.

## Design

Acceptance records report actual outcomes, limitations and accountable operators, never a completion percentage.

Shared interface contract: [deployment-and-service](../contracts/deployment-and-service.md).

Use [UI context](../ui-context.md) for visual work and [code standards](../code-standards.md)
for implementation. No unrelated application redesign or provider re-selection.

## Implementation

1. Run all applicable acceptance rows against one named candidate, including clean install, real input, cloud suggestion, review, publication, outside reader, correction/withdrawal and recovery.
2. Use consenting participants and actual configured environments; record confusion, interventions, failed cases and reopened owning units.
3. Record distribution acceptance from units 35–37, including direct reader/client journeys, tenant isolation, unknown delivery recovery and external-removal limits. Provider-specific claims require that provider's live acceptance; an unavailable agreement stays a named gap.
4. Record the local brain from unit 38 on a second person's own machine: installed without any download, built and searched with the network denied, no outbound attempt in the sandbox log, no score in any result, and excluded hits only with their reason.
5. Record unit 39's local team acceptance: two people on two machines, records moved only by files or commands the members chose themselves, and no team content sent by Foliage or a local model service beyond what a member chose to send.
6. Assemble evidence IDs, release config, terms/support/rollback contacts and the owner release decision; do not infer authorization from passing tests.

## Dependencies

- Required units: [01](./01-candidate.md), [02](./02-deployment-package.md), [03](./03-hosted-session.md), [04](./04-identifier-ownership.md), [05](./05-admission.md), [06](./06-authority-schema.md), [07](./07-immutable-objects.md), [08](./08-current-reader.md), [09](./09-sources-cells.md), [10](./10-background-collection.md), [11](./11-achievement-model.md), [12](./12-local-review.md), [13](./13-publish-handoff.md), [14](./14-group-governance.md), [15](./15-member-exit.md), [16](./16-cloud-tools.md), [17](./17-cloud-conversation.md), [18](./18-scoped-agents.md), [19](./19-private-industry.md), [20](./20-public-discovery.md), [21](./21-outbox-dispatch.md), [22](./22-notice-preferences.md), [23](./23-shared-review-ui.md), [24](./24-public-portfolio.md), [25](./25-website-offers.md), [26](./26-local-evaluation.md), [27](./27-cloud-evaluation.md), [28](./28-private-deployment.md), [29](./29-restore-revocation.md), [30](./30-observability.md), [31](./31-entitlements.md), [32](./32-payment-lifecycle.md), [33](./33-capture-clients.md), [34](./34-dify-development.md), [35](./35-distribution-core.md), [36](./36-destination-adapters.md), [37](./37-partner-feeds.md), [38](./38-local-brain.md), [39](./39-team-project-portfolio.md)
- Packages: reuse the integrated workspace and selected provider adapters. No speculative
  package installation; a missing adapter dependency must be pinned and reviewed with its
  first real use under this unit's interface contract.
- Credentials, real participant access and deployment configuration are supplied through
  the owning environment, not committed. An unavailable external input blocks execution
  acceptance, not the completeness of this spec.

## Verify when done

- [ ] Every required row has candidate/environment, actual result and exercised failure recovery evidence.
- [ ] Any disclosure, identity, silent-loss or post-withdrawal serving blocker reopens its unit and dependent acceptance.
- [ ] No planned service, local harness or other branch test is represented as accepted production behavior.
- [ ] Run the owning focused tests and required candidate gates from `package.json`; record
  exact candidate/environment and actual results. UI changes include browser checks.
- [ ] Update progress and the existing execution record. Do not mark dependent acceptance
  complete from source presence; preserve original cause and a safe recovery action.
