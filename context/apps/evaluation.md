# Portable evaluation runtime

## Status

Local execution, receipt signing and observation import are integrated under `tools/eval` from
`codex/portfolio-achievements@5f9fa1b`. An optional local MCP connection can run one
owner-pinned exact project scenario and put its executor report in private Review. No
dedicated application package is required. An optional browser scenario launches and observes
the app in that same offline job, binding its PNG/MP4 and measured checks to the evaluation
receipt. Cloud/customer isolation and live-portfolio acceptance remain pending.

## Responsibility

Execute tests, browser observations and benchmarks over authorized code, emitting evidence that can support an achievement. The control plane schedules and consumes evidence; it should not execute arbitrary submitted code inside its own web process.

## Runtime and interfaces

Reuse the existing version-1 scenario/result contract: prepare → execute → observe →
evaluate, with exact commit, bounded argv/timeouts, image/scenario digests and explicit failure
and cleanup outcomes. Executors share the same evidence envelope; observers are replaceable.
The [agent/evaluation contract](../contracts/agents-and-evaluation.md) owns interfaces and
execution authority. [Deployment](../contracts/deployment-and-service.md) owns worker isolation.

The local observer reuses `tools/capture` through a host loopback relay to one selected port
inside the evaluated container. No Docker networking, additional mount or arbitrary host
app URL is enabled. Observation follows successful command steps; failure and resource
cleanup remain explicit. The host signs only after cleanup. The existing private media
import checks both receipts and artifact bytes before combining them in one Review draft.
The [runtime contract](../../docs/EVALUATION-RUNTIME-LOCAL.md#capture-the-evaluated-app) states
dependency preparation, browser restrictions and signed-demo import limitations.

## Storage and access

Private code stays within the selected runtime; reviewed result evidence can be transferred.
Keep Ed25519 issuer keys outside workloads and verify against an independently trusted key.
Use the existing private observation/review store. Signing proves neither authorship nor
business impact. No cloud dispatch occurs without configured isolation and current grants.

## Data flow and acceptance

Job request → isolated executor → replaceable observer → evidence artifact → reviewed portfolio update. Docker-first is local development scope; untrusted external code requires a separately accepted sandbox boundary. Browser-testing vendors belong behind the observer contract, not inside the portfolio model.

## Ownership

[Canonical architecture](../architecture.md) identifies implementation status. Do not create
an application manifest or broaden a licensing boundary merely to make this planned entry
look implemented. Units [26](../specs/26-local-evaluation.md), [27](../specs/27-cloud-evaluation.md)
and [34](../specs/34-dify-development.md) own runtime and isolated Dify development integration.

## Selected testing and research tools

Arbigent is the selected UI observer, with versioned scenario/result import and real browser
acceptance required. Cookiy is the research tool for cited transcript synthesis and authorized
studies, with real and synthetic participants distinguished. See the
[harness specification](../proposals/portfolio-harness.md) for inputs, outputs and grants.
Neither integration is claimed operational by this documentation change.
