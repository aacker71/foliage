# Portable Foliage Evaluation Runtime

Owner direction accepted on 2026-09-08 (D10). This is the implementation contract for
B14 in the [build plan](PORTFOLIO-SCALE-BUILD-PLAN.md). The [local command executor and
optional host signing](EVALUATION-RUNTIME-LOCAL.md) are implemented; cloud workers,
remote admission and the complete evaluation-to-portfolio loop remain required. EV01–EV04 in the
[acceptance matrix](PORTFOLIO-SCALE-ACCEPTANCE.md) remain required.

Engineering review is in progress. Review decisions D1 and D2 below belong to this
evaluation-spec review, not the older D1–D10 portfolio decision sequence. D1-A retains
the complete specification across independently testable phases. D2-A accepts the
claim distinctions below. Neither decision marks the runtime or this review complete.

D3, authority for unattended newly generated tests, remains unresolved. The owner directed
the review to continue without choosing between a bounded adaptive execution grant and
rerunning only previously approved immutable scenarios. Do not interpret that continuation
as execution consent. Current local execution remains explicitly selected; neither source
collection permission nor permission to use inference authorizes generated commands.

## What already exists

Source inspection on 2026-09-09 at integration revision `18614a3` found the following
reuse points. This inventory describes implementation, not completion of EV01–EV04.

| Existing path | Reuse and remaining boundary |
|---|---|
| `tools/eval/contract.mjs` | Bounded ordered scenarios, canonical payload digest and optional Ed25519 envelope. Remote issuer enrollment, current trust/revocation and cross-environment admission remain separate requirements. |
| `tools/eval/local.mjs`, `process.mjs`, `cli.mjs` | Explicit local execution, committed archive, pinned local Docker endpoint/image, bounded processes/logs, host-side signing and separate cleanup outcome. These are command reports; independent observer measurements and crash recovery are not implemented. |
| `tools/eval/observation.mjs`, `import.mjs` | Selected receipt verification and deterministic, allowlisted projection into the existing observation import path. Original signature and derived text are distinguished; raw artifact references are not followed. No remote admission or automatic execution. |
| `apps/leaf/src/integrationImport.ts`, `integrationStore.ts` | Existing private queue, explicit subject selection, replay preservation and conflict refusal. Do not create an evaluation-specific review store. Selecting a person's Leaf does not establish that person's contribution. |
| `apps/canopy/src/ladybugAssessment.ts`, `ladybugInference.ts` | Existing private assessment and bounded inference path. Extend these for D2 rather than adding a competing assessor. Typed claim distinctions and permission to execute follow-up tests are not supplied by the present inference path. |
| Existing cells, publication authority and notice outbox | Remain the integration targets for evidence, final owner approval, withdrawal and notices. A local receipt entering private review does not prove the complete publication loop works. |

The local Dockerfile is buildable from the repository. The current CI workflow does not
publish a runtime image or define a supported multi-platform runtime release. Build,
distribution, upgrade and rollback remain part of the full delivery scope; local build
instructions are not a shipped distribution pipeline. Provider/platform choices remain
subject to the engineering review.

### Current evidence and remaining acceptance paths

The targeted `node --test tools/eval/*.test.mjs` run on 2026-09-09 passed 14 tests
under Node 22.23.1. This run exercised local contract/import and subprocess behavior;
it did not run the Docker smoke suite, Fireworks, cloud workers or a public portfolio
update. The earlier real-Docker rehearsal is separately recorded in the local runtime
document with its source and image revisions. Neither is evidence of a person's achievement.

```text
Explicit local selection
  +-- invalid scenario / source / image -> refuse before dispatch [runtime.test.mjs]
  +-- remote Docker endpoint -> refuse before source access       [runtime.test.mjs]
  +-- missing executable -> error receipt, stages not run         [runtime.test.mjs]
  +-- bounded process -> failure / timeout / cancel / truncation  [runtime.test.mjs]
  +-- actual Docker workload -> restrictions / teardown           [docker-smoke.mjs]*
  +-- receipt -> original-byte digest / optional signature        [runtime.test.mjs]
        |
Selected receipt + selected Leaf
  +-- invalid / oversized / wrong signature -> refuse             [import.test.mjs]
  +-- preview -> no queue or Leaf write                           [import.test.mjs]
  +-- import -> private queue, limits and missing stages retained [import.test.mjs]
  +-- replay -> preserve review; changed identity bytes -> refuse [import.test.mjs]
        |
        +-- independent observer measurements                    [GAP]
        +-- Ladybug dispatch / leases / stale-attempt fencing     [GAP: EV03]
        +-- remote issuer / current grants / signed disclosure    [GAP: EV02]
        +-- D2 claim kinds / abstention / contradictions           [GAP: semantic eval]
        +-- two real-person cycles through deliberate publication [GAP: EV04]

* Existing real-Docker harness; not rerun in the targeted check above.
```

This is a review-progress map, not exhaustive branch coverage or a completed test review.
Existing command and import tests cannot stand in for the missing observer, cloud,
semantic-accuracy or end-to-end acceptance paths.

## Boundary and product purpose

Containerize evaluation execution. Keep portfolio/UI, evidence admission, outcome
interpretation, scheduling, identity, billing and metadata in the control plane. Hosted
authority remains Supabase Postgres, admitted artifacts remain private Supabase Storage,
hosted surfaces remain Vercel, and authorized notices remain Novu. Local operation must
stand alone without importing cloud or enterprise packages.

Local evaluation is owned by the portable Foliage Evaluation Runtime and can run on our
infrastructure, a user machine, CI or customer infrastructure. Ladybug owns and performs
cloud evaluation using that same versioned runtime and job/result contract. Ladybug is
cloud-only; it is not the name of the local runtime. Its orchestration, provider selection
and worker lifecycle belong in the cloud executor adapter. The portable evidence schema
records execution environment, issuer and provenance without depending on Ladybug-specific
control-plane fields or defining a second evidence format.

```text
Authorized exact source revision + scenario + resource/network policy
                           |
              existing scheduler dispatch / local CLI
                           |
           local/CI executor OR Ladybug cloud executor
                           |
                trusted runtime supervisor
           prepare → execute → observe → evaluate
                           |
              ephemeral workload + observer adapter
                           |
          bounded results → supervisor validates and signs
                           |
      evidence admission + current source/subject/grant checks
                           |
         Photosynthesis → refreshed private Leaf proposal
                           |
        exact-revision review → personal publication consent
                           |
                  Canopy current publication
                           |
               committed outbox → permitted notices
```

The “Impact Engine” organizes evidence-backed outcomes and their limitations. It does
not compute a personal score, order proof tiers, rank people, infer contributions from
test success or turn a benchmark into a claim of business impact. Team, organization,
company and industry views consume their permitted projections through existing authority
contracts; runtime execution grants no access or publication rights.

## Claim contract: observations, attributed accounts and inferences

**Accepted in engineering review D2-A, 2026-09-08.** An achievement is an account of a
meaningful contribution supported by evidence, not an activity total. The user-provided
honesty objection identifies a real limitation: tests and repository artifacts cannot
establish subjective difficulty or directly reveal a person's internal cognition.
External outcomes also require evidence beyond repository activity. Do not fill those
gaps with flattering model prose, forced answers or an unqualified difficulty field.

Extend the existing versioned evidence/Leaflet contracts. Do not create a separate
Ladybug evidence store or map these distinctions onto `ProofTier`. A claim's origin,
support, attribution and disclosure authority are independent dimensions; none has a
numeric ordering or produces a person/work score.

| Claim kind | Required basis | What it does not establish |
|---|---|---|
| Observation | Exact source or execution-result revision, identified observer/issuer, observation time, method and applicable environment or measurement limits. Distinguish a trusted observer measurement from a workload's self-report. | Authorship, inner reasoning, complete correctness or business causation merely because a test passed. |
| Attributed account | The named speaker's deliberately supplied statement, its captured time and source revision, and authorization for the intended audience. Distinguish a retrospective account from a contemporaneous record. | Independent confirmation that the statement is true. Recording or signing a statement proves neither difficulty nor capability. |
| Inference | Explicitly identified interpretation with linked premises, interpreter/model and revision, limitations, and available supporting or contradicting evidence. | An observed fact, independently verified cognition or permission to promote a proof tier. |

The wire contract must bind each claim to an ID/revision, kind, statement, attribution,
source/evidence revisions, limitations and current disclosure constraints. Supporting and
contradicting references remain separately identifiable. Unknown attribution, missing
context and unavailable evidence carry reasons instead of invented values. A reference
to a private original may be carried only where the audience is authorized to learn it.
An unclassified legacy assessment must not silently acquire an observation label.

Split compound statements before assessment. A recorded architectural decision and an
assertion that making that decision was the hardest part of the project are different
claims with different bases. A recorded choice can support what a person proposed at a
particular time; it cannot establish the moment of their internal realization. A
benchmark can support measured behavior under its declared conditions; customer adoption
requires relevant adoption evidence. A causal contribution claim needs its own support
and alternatives considered, not merely a result occurring after a release.

Evidence unavailable to Foliage yields **not established from the available evidence**.
It does not mean the achievement did not occur or the person lacks the capability.
Personal accounts remain permitted, including in an owner-approved portfolio, but their
attributed nature must remain visible. Independent corroboration can support a separate
claim; it does not rewrite the provenance of the original account.

### Collection and interpretation behavior

Capture authorized decisions, experiments, failures and corrections as they occur when
the source supports it. Preserve the source's original wording and time; capture time is
not necessarily event time. A retrospective explanation remains useful but is labelled
as such. AI-generated narrative is not a human account until the human deliberately
adopts that account, and adoption does not turn it into an observed result.

Local evaluation and Ladybug cloud evaluation emit the shared evidence contract with
execution location and issuer recorded. Ladybug's Fireworks interpretation consumes only
authorized evidence and proposes claims or narrowly scoped follow-up questions. It does
not infer subjective difficulty, personality or an AI contribution percentage from code
volume, token usage, elapsed time or intervention counts. Describe supported human,
collaborator and AI responsibilities; leave missing attribution explicit.

No answer is required for an unsupported dimension. A missing-outcome response names the
missing evidence, not a fabricated quotation. A model may identify a candidate
contradiction or request an experiment, but neither its agreement nor a person's approval
is an independent truth check. Automated schema and citation checks establish structure
and reference integrity, not that a conclusion logically follows from its sources.

```text
source or execution evidence revision
                 |
     claim + kind + attribution + limits
                 |
  support / contradiction / missing evidence
                 |
      private evaluation and owner review
                 |
       permitted publication projection
                 |
  same distinctions in reader and export
```

### Publication and acceptance requirements

Carry kind, attribution and necessary limitations through assessment, editing, review,
publication and export. Public summaries must not strip qualifiers or inherit a blanket
verified badge from a signed execution result. If required context cannot be disclosed,
withhold or narrow the statement rather than expose private evidence or publish an
unsupported stronger version. A changed statement, kind, attribution, evidence revision
or material limitation invalidates the affected exact-revision review. The final public
publish/replace decision remains D7; accepting an account never grants source-company
disclosure permission.

This adds requirements to EV01–EV04 rather than a competing acceptance workflow:

- Parser tests distinguish all three kinds, reject incompatible/missing provenance and
  preserve explicit unknowns; old assessment records require deliberate migration/review.
- Interpretation evals use authorized real work to test correct abstention when only
  commit subjects are available, a matching quote does not support the proposed claim,
  an outcome lacks external evidence, or a timing association is presented as causation.
- Tests distinguish recording a person's statement from independently supporting its
  content. Signing an envelope, owner approval and model agreement cannot change that.
- End-to-end tests preserve attribution and limitations through private drafting,
  correction, exact-revision approval, public rendering and export; stale review and
  revoked source grants refuse use. Publication must not leak hidden source identities.
- An approved real-person rehearsal follows a documented decision and an actual measured
  result. Any personal explanation remains attributed; unavailable external outcomes
  remain unestablished. Record model mistakes and the person's corrections, not only
  successful examples. Deterministic checks passing is not semantic-accuracy acceptance.

Current reuse points: `apps/canopy/src/ladybugAssessment.ts` already requires caveats,
checks quotation membership and prohibits unsupported causation in its prompt;
`ladybugInference.ts` already binds output to a packet digest and rejects incomplete
responses. Extend those paths and the existing cells/Leaflet/publication contracts.
Their present untyped `observation` prose and mandatory per-dimension findings do not
yet implement this claim contract. This section is an implementation requirement,
not a claim that semantic entailment can be proven by a general-purpose validator.

## One contract, separate adapters

The target interface is:

```text
foliage-eval run --repo <repo> --commit <sha> --scenario onboarding --output results.json
```

The local CLI currently requires additional explicit image and execution-scope options;
see the [local usage and limits](EVALUATION-RUNTIME-LOCAL.md). The same versioned job
and evidence schemas must work on our infrastructure, a laptop, in CI, on Ladybug's
ephemeral cloud workers and inside customer infrastructure. A customer can export a
deliberately permitted signed result
without exporting source. Offline local operation may produce an unsigned result with an
explicit issuer/trust state; signatures are required for the signed-admission path, not
invented when no trusted key exists.

| Contract | Required content and behavior |
|---|---|
| Job | Schema version, job ID, attempt ID, authorized source identity, exact commit/tree digest, scenario definition/digest, runtime image digest and platform, observer identity/version/digest, resource/time/output budgets and network policy. Actor, subject, grant and policy bindings stay explicit; the workload receives only the subset it needs. |
| Executor | Prepare the exact input; start the workload; expose bounded process/browser observation channels; enforce cancellation and budgets; collect bounded results; destroy workload resources. Local Docker, Ladybug cloud and customer adapters implement this contract. |
| Observer | A replaceable test/browser/benchmark/telemetry adapter consumes declared inputs and emits typed observations with method, provenance and limitations. Open-Testing.AI, QAssist and future agents are candidates, not required dependencies. Repository content cannot choose privileged tools or change observer policy. |
| Result | Job/attempt binding, input/image/scenario/observer digests, stage outcomes and reasons, observation timestamps, environment, evidence/artifact digests, units and methodology for measurements, limitations, output truncation and separate cleanup outcome. Completion, failure, cancellation, timeout and unknown outcome remain distinguishable. |
| Signed envelope | Versioned canonical payload bytes, payload digest, algorithm, issuer/key ID and signature, bound to the requested job and exact input. Verification includes trusted-issuer scope and key status; unknown/revoked issuers cannot acquire stronger proof labels. |

A zero process exit is not evidence that every scenario ran or passed. Every requested
scenario reports an outcome or an explicit reason it was not observed. A failed test may
still yield useful evidence. Missing tools, unsupported environments and collection
failure must not become zero measurements or empty success.

Pin image digests and resolve the actual architecture-specific image. Record environment,
warm-up, dependencies, network conditions and baseline for benchmarks. Portable schema
means comparable records, not identical measurements on different hardware. Do not add
a production build step or `dist/` to Foliage's native TypeScript packages merely to
package them; evaluated repositories may have their own declared build steps.

## Source, isolation and signing

Source acquisition is explicitly authorized and resolves an exact committed snapshot.
Exclude host credentials, `.git` metadata and uncommitted files by default. Do not mount
the user's home, Docker socket or unrestricted workspace into evaluated code. Cloning
credentials belong to a trusted acquisition step and do not survive into the workload.
Submodules, Git LFS, private dependencies and external services need declared acquisition
and access policies; missing inputs must be reported rather than silently skipped.

For local Docker, the first supported profile uses an unprivileged workload, dropped
capabilities, no privileged mode or host networking, resource/process/time/output limits,
read-only selected inputs and ephemeral writable scratch. Dependency installation gets
only explicitly allowed egress and scoped credentials where necessary; execution follows
the selected network policy. Observer browser access is limited to the workload's declared
application endpoint and authorized test services. A testing agent's cloud model call is
also egress and requires an explicit data policy. No implicit model/provider fallback.

The signing key stays outside the workload and outside its writable filesystem. A trusted
supervisor binds observations to the job, rejects malformed/oversized outputs and signs
the validated envelope. The workload never receives the Supabase service key. Any upload
capability is short-lived and limited to the specific job and intended result objects.

A signature proves integrity and issuer control under the verifier's trust policy. It
does not prove authorship, complete coverage, honest repository-authored tests or causal
impact. Label trusted observer measurements separately from workload self-reports. Customer
issued evidence identifies that customer as issuer; it is not silently equivalent to
independent Foliage observation. Hosted GitHub PGP commit admission remains a separate
proof mechanism. Issuer enrollment, permitted claim types, key rotation/revocation and
privacy-preserving source bindings must be specified before accepting signed remote results.

Ordinary Docker is not the acceptance boundary for hostile multi-tenant code. Ladybug cloud stage
two is restricted to approved workloads until stage three's stronger sandbox, network,
credential and tenant-isolation tests pass. gVisor, Kata Containers and Firecracker are
candidate backends, with selection dependent on workload compatibility and provider support.
For example, gVisor mediates system calls through its Sentry and filesystem access through
its Gofer, and documents Linux compatibility limits; this is a candidate to evaluate, not
evidence Foliage is isolated. See [gVisor architecture](https://gvisor.dev/docs/).

## Admission into the live Leaf

Reuse [source evidence cells](EVIDENCE-CELLS.md), exact source revisions and current grant
bindings; extend their contract deliberately instead of adding a competing evidence store.
Admit signed envelopes only after schema/digest/signature, expected-job, issuer-policy,
subject and current-source-grant checks. Neither a valid JSON shape nor an authenticated
upload establishes attribution. Replay of identical accepted bytes resolves the existing
receipt; reuse of a job/attempt identity with different bytes is refused.

Repository logs, screenshots, paths and measurements may reveal confidential material.
Keep raw outputs local or within the customer's runtime by default. Review and deliberately
admit the outward projection; sign the exact disclosed payload, linking a private original
only when policy permits. Redaction cannot preserve a signature over altered bytes. Apply
retention and withdrawal to admitted artifacts through existing authority; prior exported
copies cannot be recalled.

New admitted observations may extend or supersede evidence for the same private Leaflet.
Preserve prior observations and corrections, show the actual evidence change, reopen stale
review where required, and preserve unsaved wording, snoozes and dismissed-work semantics.
Absence or failure of an evaluation must not erase the last known evidence. Revocation
invalidates future use under current grants; it does not claim to recall existing copies.

The reviewer sees what changed, what was actually tested, what remains uncertain and who
will see the proposed revision. Reuse unchanged decisions when their revision/audience/
authority scope still matches. The person performs final public publish/replace under D7.
One explicit publication action receives a durable receipt. Job completion and a notification
link do not perform that action. Draft-ready notices and publication notices are distinct
events, governed by the existing outbox and recipient/channel rules.

## Execution order and acceptance

| Phase | Deliverable | Gate |
|---|---|---|
| B14.1 — Local Docker | Versioned job/result parser, actual CLI, exact snapshot acquisition, supervisor, Docker executor, one real observer and bounded local artifact store. Keep model-answer evaluation in `tools/ai/evaluate.mjs` separate. | EV01/EV02: run an authorized real repository; capture actual test success and failure, missing dependency, timeout, cancellation, malformed/oversized output, denied egress and cleanup failure. Verify no signing key or host credentials in the workload. |
| B14.2 — Ladybug cloud and CI | Run the same image/contract in CI and approved ephemeral jobs owned and performed by Ladybug; add dispatch/lease/reconciliation to the existing scheduler, trusted signing and scoped result admission. Keep Ladybug orchestration in its executor adapter and select worker placement against actual job duration, browser, network, region and sandbox requirements. | EV01–EV03: same authorized job across environments; worker death, expired lease, late attempt, duplicate/reordered result, lost acknowledgement and tampered signature. Record measured differences, cost and environment limits. No arbitrary external submissions yet. |
| B14.3 — Hardened and customer execution | Select and validate stronger isolation before hostile external submissions. Package customer VPC/on-prem execution, issuer enrollment and permitted signed export with no required source upload. | EV02–EV04: process/filesystem/network and cross-tenant denial tests; resource exhaustion; revoked key/grant; disconnected customer run and later admission; install/upgrade/cleanup/recovery; no forbidden egress. |

Scheduler state distinguishes queued, leased/running, completed, failed, cancelled and
unknown outcomes. Lease expiry does not prove execution stopped: fence stale attempts,
retain attempt history and reconcile before redispatch. Separate evidence acceptance from
resource cleanup; a signed result must not hide an orphaned worker. Enforce per-tenant
concurrency and job budgets, backpressure, orphan cleanup and bounded retention before
claiming an operated service.

Final EV04 acceptance runs the living-portfolio loop twice for the same consenting person:
authorized revision → actual evaluation → admitted evidence → useful private proposal →
informed review → deliberate Canopy update at the same public URL → permitted notice.
Exercise changed evidence, correction, stale review and a failure/retry. Attach exact
commits, runtime/image/observer versions, environment, receipts and observed outcomes.
Fixtures, fabricated results, a generated CLI skeleton or passing model-answer evaluations
cannot substitute for those runs. The existing Git-first Leaf remains useful while these
additional evaluation sources are built.
