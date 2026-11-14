# Agent tools and portable evaluation

## Location and identity

Photosynthesis owns local gathering/drafting. Scarlet is the individual cloud agent (the
Ladybug product); local `apps/leaf/src/scarlet*` is existing implementation to migrate, not
proof the cloud product exists. Keep local reading/drafting usable without an account.
Cloud role hierarchy (Dee Dee, Picus, Fern, Pango) conveys no additional rights. Pango's
scope is forest protection/Canopy maintenance; its actions still need explicit grants.

Reuse existing Canopy assessment/inference and AG-UI contracts on the sibling branch.
Server-held credentials and provider choice stay in the cloud plane. Fireworks remains the
selected inference route where configured; missing billing/model availability produces
honest unavailability. Do not route private local material to a substitute provider silently.

## Context and tools

### Jev decisions shared by Photosynthesis and Scarlet — 2026-09-23

Owner requirement: TypeSafe Jev is required in both Photosynthesis and Scarlet. It is
the structured decision component for bounded pools of user work, not only the optional
statement-support check. This is accepted product scope; the shared routing loop is not yet
implemented or accepted. Use one decision contract and provider adapter with separate caller
scopes, not separate records or competing review state machines.

- Photosynthesis uses Jev to select keep/pass for permitted material and connect retained
  evidence to existing work. Preserve decisions, roadblocks, failed assumptions and pivots;
  a positive outcome is not a prerequisite for meaningful work.
- Scarlet uses Jev against the context admitted to its run to support journey refinement,
  leaflet curation, selection for a particular view and identifying missing support. The
  conversational model explains and collaborates; typed decisions feed existing bounded
  operations rather than granting the conversation unrestricted authority.
- Keep/pass is scoped to a pool and purpose. A pass does not delete the source, change its
  attribution tier or reject it from every other view. Pool taxonomy and configuration UX
  remain to be settled; do not silently interpret all user data as one pool.
- Each decision binds subject, caller, pool/purpose, input evidence/revision and policy
  version. Retain the outcome, bounded reason, source references and provider/model identity
  privately. Invalid output, uncertainty or provider failure stays unresolved, not pass.
- Application rules enforce permissions before provider calls and again before mutations.
  Jev confidence is neither proof, a person score nor a permission grant. Keep does not
  authorize promotion, email delivery or publication; scoped automatic actions require the
  existing durable grant and revocation work.
- Photosynthesis remains local and offline-capable. Jev inference is a disclosed cloud
  operation using only transfer-authorized material. When offline or not authorized, local
  capture/manual review can continue and Jev-dependent decisions remain pending. Scarlet's
  owner context and public-reader context stay separate; a shared adapter shares no data.

Reuse the existing harvest/review, canonical Leaf and locked authoring operations. The current
`apps/leaf/src/claimCheck.ts` provides a bounded TypeSafe integration seam, not acceptance of
these two caller workflows. [Unit 16](../specs/16-cloud-tools.md) owns the integration gates.

Every run binds actor/subject/scope, purpose, selected evidence IDs, document/policy digest,
transfer consent and allowed tools. The local preview and cloud prompt use the same selected
payload; stale/foreign/revoked context is refused before inference. Redact/minimize payloads
and label local versus cloud execution in the interface. Raw source reads require their own
selection; collection permission is not permission to transfer or execute code.

Tools use named schemas and bounded results. Record actual invocation and result references,
not a model's claim to have used a tool. Abort cancels supported work; an unknown remote
outcome remains unknown. Conversation/retry state distinguishes accepted and incomplete
answers. Suggestions return to the existing review flow as drafts, never silent writes or
publication. Claims identify observed facts, attributed personal accounts, hypotheses and
abstention; source citations alone cannot prove a model's inference.

## Existing evaluation and Dify work

At `codex/portfolio-achievements@5f9fa1b`, `tools/eval` contains scenario validation,
local/Docker execution, receipt signing and observation import. `tools/ai/dify.mjs` and
`evaluate.mjs` provide isolated development tooling. These are now integrated reuse points;
a dedicated `apps/eval` package is not required. Dify is an optional
development service, never a dependency of the open portfolio runtime or the authority gate.

Reuse the version-1 scenario/result contract: prepare → execute → observe → evaluate,
exact commit, bounded argv/timeouts, canonical digest and optional host-side Ed25519 signature.
A trusted key is supplied independently on admission. A signed command report proves neither
human contribution nor independent observer measurement; retain the distinction.

The control plane schedules; local/CI/customer/cloud executors run ephemeral workloads.
Cloud arbitrary-code execution requires the isolated worker contract in [deployment](deployment-and-service.md).
Use existing integration observation/review storage rather than a separate evaluation ledger.
Keep issuer, scenario/image digest, environment, exit/timeout/cancel, artifact digest and
cleanup outcome. Raw private logs stay local unless explicitly admitted.

## Execution authority

Default to explicit execution of the selected immutable scenario and exact revision.
Unattended model-generated commands are refused. This preserves the recorded unresolved
adaptive-execution permission; finishing these specs does not grant it. Adaptive execution
can be added only with a separately approved bounded grant and tests. Evaluation results
enter private review and require the normal personal publication step.

## Evidence required

Units 16–18 and 26–27 prove useful sourced answers, stale/foreign tool refusal, runtime
cleanup, independent observation, trusted issuer revocation and two actual update cycles.
No test harness, provider account or self-assessment is substituted for those observations.

## Incoming portfolio harness proposal

The [draft alignment](../proposals/portfolio-harness.md) records proposed transcript observers,
routing and synthesis. The original draft does not supersede execution grants, attribution
limits, the no-score contract or publication consent. Vendor adapters remain proposed.
