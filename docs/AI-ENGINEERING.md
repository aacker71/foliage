# AI engineering with Dify

Dify is a separate **local developer service** for Photosynthesis local-agent experiments and node traces.
Photosynthesis owns local AI. **Ladybug is cloud-only**; no local Ladybug product is provided.
Foliage's application still uses AG-UI for interaction and its existing local inference path.
A Dify experiment cannot edit evidence, approve an assessment or publish a portfolio.
The public reader and open packages do not depend on Dify.

## Start and operate

Prerequisites: the repository's Node/pnpm versions, Git, Docker Compose with `!override` support,
and an already installed Ollama model. The verified host uses Docker Desktop on macOS;
its CLI is discovered even when it is absent from PATH. Start Docker Desktop first.

```sh
pnpm ai:up
pnpm ai:provision
pnpm ai:status
```

Open <http://127.0.0.1:4280>. The helper pins Dify **1.17.0** at commit
`09a855dcef24c0edc7431c46c0cfaa494481daf5`; the upstream support images retain their upstream tags.
This is a pinned Dify release, not an immutable digest lock for every container image.
Only nginx port 4280 is published, bound to `127.0.0.1`. Plugin debug ports are unpublished.
The helper refuses a port conflict and rejects composed ports exposed beyond loopback.

State lives in `~/.foliage/dev/dify/`, outside the repository:

- `source/`: upstream checkout; Docker volumes are under `source/docker/volumes`.
- `source/docker/.env`: generated service secrets; never commit or paste resolved Compose config.
- `admin.json`: the local development account and password (owner-readable).
- `workflow.json`: app id, immutable published workflow id, local API key and reviewed DSL digest.
- `evaluations.jsonl`: content-free terminal evaluation records.

`pnpm ai:stop` stops containers while preserving their state. `pnpm ai:up` resumes them.
No reset or destructive cleanup command is provided. Back up the whole state directory while
stopped, using storage appropriate for private evidence. Automatic trace expiry is not configured;
traces remain until deliberately removed through a reviewed Dify administration procedure.
The lab is not a public or production deployment.

## Daily development loop

1. Save a real private workflow draft in Foliage. Inspect its export preview and download its
   portable JSON packet. The export excludes local repository paths and author email addresses.
2. Validate locally, without contacting Dify:
   `pnpm ai:eval --packet /absolute/path/packet.json`.
3. Run that reviewed context explicitly:
   `pnpm ai:eval --packet /absolute/path/packet.json --send`.
   The default model is `llama3.2:3b`; `--model` selects another model already installed in Ollama.
4. Use the printed app Logs link and `difyRunId` to inspect the input, grounding step, HTTP model
   request, response validation, node duration and output. `traceId` is also the Dify API user id.
5. Inspect Photosynthesis's deterministic findings and read the answer against the original evidence.
   `passed-contract-checks` means only the citation/date/missing-data/rating checks passed;
   it does **not** establish factual accuracy. Human review remains necessary.
6. Change the prompt or graph in `tools/ai/workflow.mjs`, review the diff, run `pnpm check`, then
   `pnpm ai:provision --update`. Rerun the same owner-reviewed packet and compare trace findings,
   latency and the actual prose. Keep private packets and outputs out of Git and CI artifacts.

The versioned graph is JSON-compatible Dify DSL. Provisioning imports it through the pinned
local console API and publishes only this local development workflow. Evaluation invokes its
**specific immutable workflow id**; publishing an unrelated edit in the UI does not silently
change what the command runs. To preserve a visual experiment, translate/export its reviewed
change back to the source graph, then provision it deliberately.

The workflow is: reviewed packet context → grounded prompt → local Ollama HTTP call → require
complete model response → return to the CLI for the **existing** `reviewLadybugAnswer` checks.
No copied rating or citation implementation is maintained in Dify. Tests in the normal `pnpm check`
and CI cover transfer integrity, endpoint restrictions, workflow revision mismatch, redaction,
response bounds and failure reporting. Those protocol tests use explicit stubs; they are not
live model evaluations. Live evaluations are opt-in and never require CI to access private packets.

## What is observable

Both Photosynthesis form and AG-UI stream routes emit one `foliage.photosynthesis.run.v1` JSON record on
completion, refusal, cancellation or exception. It includes a generated trace id, a hash of the
client run id, context tool, terminal state, named refusal/error code, timestamp and elapsed time.
It contains no question, answer, evidence, file path, thread id or raw error text.
A diagnostic sink failure is reported and cannot change the run outcome.

`pnpm ai:report` summarizes the lab's terminal states and median/p95/max duration. To analyze
Photosynthesis, capture its server stdout to a private file and run `pnpm ai:report /path/to/server.log`.
Counts and latency describe service operation; they are never assessments of a person or work.

Evaluation records also include the workflow revision, Dify run id, deterministic finding codes,
and the input/output token counts returned by Ollama when present. Because inference uses an
HTTP node, Dify does not natively attribute it as an LLM-provider cost. No monetary cost or
quality score is invented. Routine evaluation output never prints model prose or provider errors.

**Dify's detailed local traces do retain the submitted context and model output.** This is why
`--send` is explicit. Dify metadata reports and Photosynthesis production diagnostics are different
surfaces with different retention. Existing Photosynthesis user traffic is not mirrored to Dify.
Legacy `ladybug*` module names and `/ladybug/*` URLs in the local Leaf studio remain
compatibility identifiers; they implement the Photosynthesis agent. The report reader also
accepts the old `foliage.ladybug.run.v1` schema for historical logs.

## Network and authority boundaries

The code sandbox is on a dedicated internal Docker network with no configured HTTP proxy
and no direct external route. Dify 1.17.0 requires its sandbox network flag for code execution;
network isolation is therefore enforced by Compose rather than that flag. The only network destination in the versioned
workflow is `http://host.docker.internal:11434/api/chat`, reaching Ollama through Docker Desktop.
Dify's SSRF proxy allows that private hostname; no blanket private-IP allowance is added.
Marketplace installation and Weaviate telemetry are disabled. Docker image downloads and
Dify's broader platform are not represented as an air-gapped product. The lab's workflow uses
no external model provider, plugins or provider key.

For Linux, `host.docker.internal` is not automatically supplied by every Docker installation.
Configure a reviewed host-gateway mapping and a reachable local inference service before using
this workflow there; only the macOS Docker Desktop path is verified.

Dify is governed by its own [Dify Open Source License](https://github.com/langgenius/dify/blob/1.17.0/LICENSE).
It is not copied into Foliage packages or represented as covered by a Foliage license.

## Troubleshooting

- Docker unavailable: start Docker Desktop; run `pnpm ai:status`.
- Port occupied: inspect `lsof -nP -iTCP:4280 -sTCP:LISTEN`; preserve the other process.
- Workflow changed: review the graph diff and run `pnpm ai:provision --update`.
- `workflow-failed`: open that Dify run and find the failing node. Missing model, incomplete
  response and model HTTP failures are failures, never empty successful answers.
- Sandbox 401: `CODE_EXECUTION_API_KEY` and `SANDBOX_API_KEY` must match. The installer generates
  one shared secret for these settings.
- Agent backend restart: `DIFY_AGENT_SERVER_SECRET_KEY` must decode to exactly 32 bytes;
  the installer generates base64url encoding, not a hex string.
- Local model unreachable: check `ollama list`, Docker host connectivity and the precise
  SSRF private-host allowlist. Do not expose Ollama publicly as a workaround.
- Interrupted/timeout eval: use Dify Logs to inspect whether the server-side run continued;
  a client timeout is not proof of server-side cancellation. No automatic retry is performed.
