# Run the local evaluation foundation

The local executor is implemented in `tools/eval`, reused from `ff4edb9` on
`codex/reader-release-integration`. It runs explicitly selected owner-controlled code,
records actual command outcomes and private logs, and optionally signs the result on the
host. The [runtime architecture](EVALUATION-RUNTIME.md) remains the full delivery contract;
this implementation does not close B14 or EV01–EV04.

## Run

Requires the repository's supported Node version and a running local Docker engine. Build
the image with `docker build -t foliage-eval:local tools/eval`, then obtain its immutable ID
with `docker image inspect foliage-eval:local --format '{{.Id}}'`. Image preparation may
contact a registry. Evaluation uses the selected local image ID and never pulls an image.

```sh
node tools/eval/cli.mjs run \
  --repo /absolute/path/to/foliage \
  --commit <full-commit-sha> \
  --scenario tools/eval/scenarios/leaf-domain.json \
  --image <sha256:local-image-id> \
  --output /private/output/results.json \
  --trusted-local-code
```

The parent output directory must exist. The package also exposes `foliage-eval` as a CLI.
The local release archive includes the evaluator, receipt importer and shared browser
capture modules; no repository checkout is needed to load these tools after installation.
Docker, a prepared runtime image, Git, Chrome and ffmpeg remain separately installed
dependencies. A missing runtime is recorded as unavailable rather than as a successful test.

If Docker is absent from PATH, `--docker` accepts its executable path. On this Mac the
working binary is `/Applications/Docker.app/Contents/Resources/bin/docker`; the existing
`/usr/local/bin/docker` symlink targets the removed installer volume.

The supplied scenario runs committed Foliage Leaf domain tests. It is not an onboarding
scenario or evidence of a customer's achievements. Scenarios contain explicit bounded
argv steps in lifecycle order. They are owner-selected execution configuration; collection
or inference permissions do not authorize running model-proposed commands.

An owner can also expose one already selected scenario to a local agent through the opt-in
`foliage_test_selected_project` MCP tool. The owner pins the repository, full commit,
scenario file and immutable image at connection startup. The tool accepts no commands or
paths from the agent, runs once per connection, and queues the resulting executor report
in private Review. See [local assistant setup](ASSISTANT-MCP.md#optional-project-test).
This does not launch or visually inspect an app. The separately opted-in demo browser can
measure a running local page and capture its PNG/MP4; it does not establish that page as
the evaluated commit.

## What the executor does

- Captures a full commit using `git archive`, recording its tree and the actual archive digest.
  Uncommitted files and the live `.git` directory are absent. Archive attributes can exclude
  or transform files; submodule contents and hydrated LFS objects are not supplied. The
  snapshot is bounded at 128 MiB, and missing dependencies fail rather than install silently.
- Pins the inspected local Unix-socket Docker endpoint. Runs non-root with network disabled,
  read-only root and source archive, dropped capabilities, no-new-privileges, and resource
  limits. Writable work and temporary directories are container tmpfs. Credentials, signing
  keys, the Docker socket and the result directory are not mounted into the workload.
- Records bounded stdout/stderr, step duration, explicit failures and unrun stages. Command
  exit comes from the Docker exec client and can reflect command or executor failure; it is
  not independent proof that a test suite passed. Commands share the job's work directory
  and can influence later observations. Durations are operational timings, not benchmarks.
- Removes the job container and temporary snapshot after success, failure, timeout or handled
  cancellation. Unconfirmed cleanup remains an error. SIGKILL, power loss or daemon loss can
  leave an orphan; inspect the job's `foliage.eval.job` label and reconcile before removal.
  Timeout/cancellation first stops the host Docker client; the workload is stopped by job
  teardown, and no later scenario step is dispatched. The CLI reports cleanup separately
  from the original failure so an unconfirmed removal cannot be hidden by a timeout reason.

Each invocation has separate job and attempt IDs, bound into its events and result. This
identifies one attempt; resumable jobs and retries are not implemented. Results are new,
exclusively reserved files with owner-only permissions. Their adjacent
`.artifacts` directory contains the exact scenario, private logs and host-generated events.
An incomplete reserved file is not a success receipt. Never treat raw logs as trusted
instructions or publish them automatically; they may contain sensitive material.

Optional `--signing-key <ed25519.pem> --key-id <id>` signs on the host. Verification requires
an independently trusted public key and expected key ID. A signature binds the recorded
bytes and key identifier; it does not establish honest execution, attribution, achievement
or impact. Unsigned results remain explicitly unsigned. Remote receipt schema admission,
issuer enrollment, revocation and replay policy remain unimplemented.

## Bring a selected receipt into private review

Preview the deterministic observation before selecting a harvest file:

```sh
node tools/eval/cli.mjs import --input /private/output/results.json \
  --into /private/garden/leaf.json
```

Add `--out /private/garden/harvest.json` to place that observation in the existing private
human review queue. Both documents are selected explicitly; the Leaf must already exist.
Review it at `/review` under `foliage up --garden /private/garden`. The import itself does
not change the Leaf or assign authorship to its person.
The usual explicit review and promotion gates remain; imported observations stay pending
and private when promoted. Publication requires the separate existing release workflow.

For a signed receipt, also supply `--public-key /private/keys/evaluator-public.pem --key-id <id>`.
The public key must come from a separately trusted source. The import checks its signature
over the original receipt; that signature does **not** sign the derived review text or prove
the reported execution happened honestly. Unsigned receipts remain declared, unverified
reports. This local path does not enroll remote issuers or implement cloud admission.

The preview and queue retain job/attempt IDs, original digests, source commit/tree/archive
digests, scenario and evaluator digests, declared outcomes, operational timings, log digests
and truncation, missing values, unrun stages and cleanup results. These are executor reports,
not independent observer measurements or benchmark results. Raw logs, commands, scenario
labels, paths and host identifiers are omitted; referenced artifacts are never opened.
The preview contains private evidence identifiers: keep it within the selected private workflow.

Repeating the same receipt preserves the existing entry and review decision. Reusing its
job/attempt identity with changed bytes is refused, including changes to omitted fields.
A new attempt is a separate unreviewed entry. Locally edited candidate titles also cause an
explicit replay conflict, preserving the edit. Input is a bounded regular file; malformed,
unsupported or signature-invalid receipts and invalid existing queues are refused.

## Capture the evaluated app

An owner-selected version-1 scenario can add a `browser` section:

```json
{
  "argv": ["node", "server.mjs"],
  "port": 4321,
  "path": "/",
  "readyTimeoutMs": 5000,
  "durationSeconds": 8
}
```

`argv` starts the prepared app in `/work` **inside the same job container**, after every
command step completes successfully. Select the actual command/path for the project; the
example is not a bundled app. Dependencies must already be in the immutable runtime image
or prepared by the offline scenario. Failed command steps skip capture. A failed app start,
readiness timeout, unavailable Chrome/ffmpeg, cancellation or cleanup failure stays explicit.

The container keeps `--network=none`, its limits and its sole read-only source mount.
A bounded, disposable host loopback relay reaches only the selected container port over
the pinned local Docker socket. The existing guarded Chrome session checks that page and
records its PNG/MP4. It does not attach to an existing host app, expose a Docker port, reuse
the owner's browser profile, or allow external browser resources. Apps requiring a remote
API, CDN, WebSocket or sign-in are not supported by this offline observer.

The result binds the capture receipt and PNG/MP4 digests to the job/attempt, source commit,
tree/archive, image and scenario. The host implementation digest includes the observer and
capture code. Browser measurements are stated as observations, not a quality verdict.
Preparation/test commands may modify the in-container snapshot; this proves the recorded
job's prepared workload was observed, not bit-for-bit reproducibility or production deployment.
It does not establish a person's authorship or business impact.

The MCP project-test tool automatically queues a successful bound capture and its executor
report as **one** private Review decision. The ordinary live-app capture tools remain separate
and do not acquire a source revision label. For explicit CLI import or recovery:

```sh
node tools/eval/cli.mjs import --input /private/output/results.json \
  --into /private/garden/leaf.json --out /private/garden/harvest.json --include-demo
```

This flag reads only the bound capture under that result's adjacent `.artifacts` directory,
checks the receipt and actual media digests, and preserves existing decisions on replay.
Changed bytes under the same job/attempt conflict with the old decision. Without the flag,
the importer retains its report-only behavior and opens no capture artifacts. Combined demo
import currently accepts unsigned local reports; signed report import still uses the separate
trusted-key path above. No approval, public selection or publication is performed.

## Check and remaining work

`node --test tools/eval/*.test.mjs` exercises runtime boundaries and selected receipt import.
`node tools/eval/docker-smoke.mjs <image-id> [docker-binary]` additionally runs the real
committed Leaf tests, runtime restriction probes, nonzero exit, timeout, output limits,
cancellation, signature verification and independent checks that the containers are gone.
It also denies one cleanup request after an actual failed command, verifies that the CLI
reports both the command failure and unconfirmed cleanup, then removes that owned container
using the real Docker transport. This is an explicitly labelled fault-injection probe.
Each actual receipt is also imported into a private regression review queue and replayed;
the rehearsal checks that it remains an unreviewed observation and leaves the Leaf empty.
Probe results are evaluator validation, not portfolio achievements. Smoke receipts stay in
a private temporary directory printed by the command.

Integration rehearsal on 2026-09-08 evaluated Foliage source
`a7cb2cd8a311cbec11c4205526719cfbadb11d7c` using runtime image
`sha256:e74039b3dcc4d58126b2ac5ea89f95c624aa666acfddbddf323893544e1f36de` on local
Docker 29.6.2, Linux/arm64. All 16 committed Leaf tests passed. The five additional
failure/restriction flows exercised the expected outcomes; cleanup refusal remained
unconfirmed in its receipt even after the harness removed the container. Host signatures,
container environment allowlist, job/attempt/tree bindings and actual container removal
were checked. Source and evaluator revisions are distinct; receipts contain the evaluator
implementation digest. No source or results were uploaded.

The local foundation still needs controlled dependency preparation, additional observer
adapters and recoverable jobs. The optional local observer above measures the same job; it
is not an independent evaluator or remote attestation. Ladybug cloud execution,
customer admission, hardened external-code isolation and automated Photosynthesis-to-Canopy
evidence linkage remain required. The selected local receipt bridge above supplies private
review observations only. There is no automatic evaluation on collection or publication.
