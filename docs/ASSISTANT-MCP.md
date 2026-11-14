# Local assistant connection

Foliage exposes a local MCP server so an assistant can submit deliberately selected source
observations, or the text of an existing portfolio the owner selected, into the existing review
queue. The owner fixes one Leaf and its harvest at startup. New observations remain unreviewed;
approval and publication happen in Foliage.

This is a manual snapshot handoff. It does not fetch provider records, authenticate declared
provider/tenant/account identities, consult source grants, or provide automatic synchronization.
The default connection does not expose existing portfolio bodies or source excerpts to the assistant. An assistant
host may itself send selected text to its model provider; this transport does not control that
host's data handling. Use only material the person deliberately selected for this workflow.

## Start the connection

Install the workspace dependencies with `pnpm install` and use the repository's supported Node
version. Select an existing garden containing a valid real Leaf, then configure the host to
launch this command as its stdio MCP server:

```bash
node /absolute/foliage/foliage.mjs mcp --garden /absolute/garden
```

Both paths above are placeholders for your checkout and garden. Use an absolute Node executable
when the host does not inherit your shell's PATH. Keep the checkout at a stable path while the
host configuration uses it. The garden is required explicitly: this command never selects a
target from `FOLIAGE_GARDEN`, `FOLIAGE_LEAF`, the working directory or a default garden.

For hosts using a JSON `mcpServers` configuration, the equivalent entry is:

```json
{
  "mcpServers": {
    "foliage": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/foliage/foliage.mjs", "mcp", "--garden", "/absolute/garden"]
    }
  }
}
```

Host configuration formats differ; this is not a universal configuration file. Do not launch
through a package script that prints logs to stdout. The direct Node entry reserves stdout for
MCP and sends startup/transport diagnostics to stderr. Foliage does not edit host settings or
install itself globally. No credential is needed for this local server.
Tool errors omit local filesystem paths; detailed filesystem diagnostics stay on stderr,
which the launching host can capture. Its local configuration already contains the chosen paths.

If your Leaf and harvest are elsewhere, use the underlying entry with both explicit paths:

```bash
node /absolute/foliage/apps/leaf/assistant-mcp.mjs --into /absolute/leaf.json --out /absolute/harvest.json
```

The paths must differ. The selected Leaf must already exist; a missing harvest can be created
by the first nonempty accepted batch. A changed Leaf identity requires restarting the host's
connection. Tools cannot retarget it by supplying a filename or a different subject.

When the garden has a local brain (`foliage brain build`; the Leaf and harvest are that garden's
`leaf.json` and `harvest.json`), every tool not annotated read-only may start a refresh of it
after it answers: gbrain processes on this machine, with no network, that never delay or change
the tool's result. Their failures go to stderr only, never into a tool result, and are written
down in the brain for `foliage status`. `foliage_search` does not read that brain (see below).

## Tools and review flow

A connection always registers the three default tools; each launch flag adds the tools in its
row and nothing else:

| Launch flag | Tools it adds |
|---|---|
| none (default) | `foliage_import_context`, `foliage_import_portfolio`, `foliage_submit_observations` |
| `--allow-presentation` | `foliage_presentation_context`, `foliage_customize_presentation` |
| `--allow-achievements` | `foliage_achievement_context`, `foliage_save_achievement`, `foliage_save_statement` |
| `--allow-search` | `foliage_search` |
| `--allow-brain` | `foliage_brain_context`, `foliage_brain_search`, `foliage_brain_read`, `foliage_brain_related` |
| `--capture-origin` with a local origin | `foliage_capture_demo` |
| `--allow-demo-browser` (beside `--capture-origin`) | `foliage_open_demo_browser`, `foliage_inspect_demo_browser`, `foliage_check_demo_browser`, `foliage_scroll_demo_browser`, `foliage_click_demo_browser`, `foliage_record_demo_browser`, `foliage_close_demo_browser` |
| `--allow-project-test` (with its four `--test-*` inputs) | `foliage_test_selected_project` |

The optional tools are described under [private search](#optional-private-search) (with
`--allow-brain`), [local web demo capture](#optional-local-web-demo-capture),
[project test](#optional-project-test), [presentation editing](#optional-presentation-editing) and
[achievement maintenance](#optional-achievement-maintenance). The default tools:

| Tool | Effect |
|---|---|
| `foliage_import_context` | Returns the selected Leaf ID/name, observation format, limits and review requirements. No arguments. |
| `foliage_import_portfolio` | Takes `title` (up to 200 characters), `source` (the original filename or page address, up to 500) and `text` (text or Markdown, up to 100,000 characters). Without `confirmDigest` it returns a digest and the sections it would add, split at `#` and `##` headings, and saves nothing. Called again with that `confirmDigest` and the identical title, source and text, it appends each section to the fixed harvest as an unreviewed observation from source `portfolio-import`, labeled as the author's own account and not independently verified. It returns imported/unchanged counts and candidate IDs. At most 100 sections, each under 15,000 characters. No URL is fetched. |
| `foliage_submit_observations` | Accepts exactly `{ "batch": … }` using the [selected observation contract](INTEGRATIONS.md#selected-observation-format). Appends new unreviewed observations to the fixed harvest and returns persisted/unchanged IDs. |

## Optional local web demo capture

Launch the connection with `--capture-origin http://127.0.0.1:<port>` to register the
one-shot recorder. Add `--allow-demo-browser` to let the connected agent inspect page pixels
and control labels in its own browser before recording. The browser tools are absent without
that extra opt-in. This is an exact origin pinned by the owner at startup; a tool call
may choose any path under it, including private pages, but cannot change host or port. The ordinary two-tool connection
does not register capture. Chrome/Chromium and ffmpeg with H.264 encoding must be installed
locally. The agent can call `foliage_open_demo_browser` to see a bounded screenshot and visible
controls, `foliage_scroll_demo_browser` or `foliage_click_demo_browser` to choose a scene,
`foliage_inspect_demo_browser` to recheck it, `foliage_check_demo_browser` to measure browser
and layout failures, and `foliage_record_demo_browser` to record that
same browser state into Review. `foliage_close_demo_browser` discards a session without a
candidate. One short-lived browser session is open at a time per connection. The selected page's
pixels and control text are returned to the connected agent and may reach its model provider;
they are untrusted source content, never instructions. A check remains in the private receipt
if the scene is recorded; it makes no correctness or authorship claim.

The existing one-shot `foliage_capture_demo` accepts a URL, an optional 2–15-second duration, an optional draft title,
and up to five timed click steps with exact CSS selectors. Without steps it records an actual
viewport PNG and a short scrolling MP4; selected steps show the page's real interaction.
Both browser-session and one-shot clicks can change the selected local app, including through a GET request. The session
accepts only named controls visible in its latest inspection; avoid destructive or submit controls unless the owner
explicitly asked for that action. One-shot CSS steps are caller-selected and do not use the inspection gate. After the first click, the capture
also refuses non-GET/HEAD requests and keeps no demo or Review candidate if the page attempts one;
that transport guard does not make a click read-only.
The receipt records the ordered inspection-phase scrolls and clicks, the executed recording steps,
and the screenshot instant. Its browser refuses page requests
outside the selected local origin. The selected local server's own network behavior is outside
that browser guard.

Recording returns private receipt, still and video paths and one demo Review candidate ID.
The still and MP4 enter the existing private `/review` queue together. The MP4 bytes stay in
private local storage until a separate owner publication selection.
The assistant cannot approve, promote, share or publish either artifact through this tool. If
review submission fails, the capture remains private and the tool reports that separate failure.
The owner can also record from Work → Capture work or
`node foliage.mjs capture --url http://127.0.0.1:<port> --garden /absolute/garden` without
granting an MCP host capture access. See the
[capture contract](capture-agent.md) for artifact limits and provenance.

## Optional project test

The owner can give the same local assistant one exact, already prepared project scenario:

```bash
node /absolute/foliage/foliage.mjs mcp --garden /absolute/garden \
  --allow-project-test --test-repo /absolute/project \
  --test-commit <full-commit-sha> --test-scenario /absolute/scenario.json \
  --test-image sha256:<local-image-id>
```

`foliage_test_selected_project` takes no arguments. The agent cannot change the repository,
commit, scenario commands, runtime image or Review destination. The scenario is checked at
connection startup and refused if its file changes. This is an explicit local-code grant:
the selected commands run once in the restricted local Docker evaluator, with no network
or workspace write mount. Docker and the immutable image must already be available. See
[the local evaluation runtime](EVALUATION-RUNTIME-LOCAL.md) for image preparation and limits.

The exact command outcome, including failure or unconfirmed cleanup, becomes a private
Review candidate. A scenario may optionally select an in-container app command, port, path,
readiness deadline and clip duration through its `browser` section. After successful command
steps, the existing guarded host browser reaches that same offline job, records PNG/MP4, and
binds their receipt/digests to its commit, image and scenario. The checked demo and report
enter one Review decision. Chrome and ffmpeg must be available on the host. No extra agent
arguments or new execution grant are accepted; the owner pins the whole scenario first.

This is an executor/observer report, not independent proof of correctness, authorship or
impact. The separate `--capture-origin` and `--allow-demo-browser` tools still observe an
already running app; those captures receive no revision binding. Neither path approves or
publishes. See [scenario and recovery details](EVALUATION-RUNTIME-LOCAL.md#capture-the-evaluated-app).
If Review refuses the import, the tool returns a receipt ID. The owner can inspect the
unchanged receipt at `<garden>/evaluations/<receipt-id>/receipt.json` and use the local
evaluation importer after repairing the garden (`--include-demo` for the bound media); the absolute garden path stays out of the
assistant tool result.

## Optional private search

`node foliage.mjs search "decision" --garden /absolute/garden` searches the selected local
Leaf and its bound harvest. It reads owner-written profile context, saved achievement claims,
Leaflets, prior journey versions and reviewed or unreviewed drafts. Each hit names its state,
an exact record location, a short excerpt from the saved text and up to three retained evidence
references. A draft is labeled as a draft; an excluded Leaflet and a past version are labeled
separately. An excluded Leaflet's body is work the owner did not do, so search neither shows it
nor matches words in it: only its title and the owner's reason are searched. Its excerpt is that
reason, and the hit also has a `reason` field with the full reason. No other hit has a `reason`
field, and an excluded Leaflet's hit has no evidence references, since they point at that body.
A record resting on a note about someone else (a `third-party` source) is not searched. A
missing harvest is acceptable. An invalid harvest or one whose Leaf ID and subject do not match
the selected Leaf is refused. Search does not read arbitrary source repositories or external
accounts. The garden is required explicitly: search never selects one from `FOLIAGE_GARDEN` or a
default garden.

By default the answer comes from Foliage's own search. Its `retrieval` field names that search,
`foliage keyword`, and its `because` field says why the garden's local brain did not answer. For a
garden that is `Keyword mode: Foliage's own keyword search answers here; foliage brain search searches the local brain`:
the brain runs keyword search only, where it finds nothing Foliage's own search
misses and would only reorder the first hits, at about three quarters of a second per search
(measured on a small synthetic garden). So `foliage_search` starts no brain process and does not
wait for one, whatever state the brain is in. Where no brain is installed (an install made without
the brain that comes in the Foliage download), `because` is `No brain is installed: Foliage's own search answers here`.

Local embeddings are the owner's choice, per garden: `node foliage.mjs brain embed --local
ollama:<model> --garden /absolute/garden` (add `--port <n>` when Ollama does not listen on 11434).
Foliage asks only the Ollama on this machine, at `127.0.0.1`, and only for a model it already
holds; it never downloads a model, and it refuses Ollama's cloud models. Once they are on,
`foliage_search` reads the garden's brain beside Foliage's own search: when the brain is current,
`retrieval` is `brain local embedding`, gbrain's order of keyword and meaning matches comes first,
and every hit Foliage's own search finds is still there. Before each such search Foliage asks the
local embedder to embed one fixed word and checks the answer has the brain's size; when it is not
answering, no longer has the model, fails to embed (an HTTP 500, as a model that fails to load
answers) or answers another size, Foliage's own search answers and `because` names why, for example
`Brain: broken: the local embedder at 127.0.0.1:11434 is not answering (ECONNREFUSED). Run ollama
serve, or foliage brain embed --off`. So `brain local embedding` means the embedder answered with
the brain's size just before gbrain's search and the brain ordered the hits; it cannot prove
gbrain's own embedding of the query succeeded a moment later. If that one fails, gbrain orders by
keyword alone and does not say so. A brain whose pages are not all embedded yet (its embedder was
down when the record last changed) is not searched until a refresh has embedded them. A search
through the brain fills any spare room up to the limit with the nearest records by meaning, which
may share no word with the query. The query's text goes to that local embedder and nowhere else.
`foliage brain embed --off` turns them off again. Search quality with a real model has not been
measured.

A Leaf and harvest that are not a garden's `leaf.json` and `harvest.json` have no brain, and say
`Brain: off`. A first-run garden with no Leaf yet answers `{ "state": "no-record", "hits": [] }`,
with no `retrieval`. No hit carries a score, a match label or a page address, whichever search
answered. The `--allow-brain` tools below and the owner-started private search session never read
the garden's local brain either, whatever their names say.

For an assistant, launch `node foliage.mjs mcp --garden /absolute/garden --allow-search`.
Only then is the read-only `foliage_search` tool registered. The query is limited to 300
characters, the response to ten hits, and each excerpt to 240 source characters. Tool arguments
cannot change the garden or select another file. Search reads current documents on each call;
if the selected Leaf identity changes, reconnect. Search permission does not grant authoring,
provider transfer or publication. The host's own model processing policy still applies to
private text returned through MCP.

For existing revision-bound clients, `--allow-brain` independently enables
`foliage_brain_context`, `foliage_brain_search`, `foliage_brain_read` and
`foliage_brain_related`. This view reads current canonical Leaf records only, excluding
pending harvest and history. Context returns the current document revision; subsequent
searches, exact reads and citation/view relationships require it. Changed identity or bytes
refuse stale requests. `--allow-search` and `--allow-brain` may be used together, but neither
implies the other. Both are opt-in views of the same local files, not additional stores or
cloud-transfer permission. Stop the process to revoke the host's access.

First read the context. Build a batch using the exact subject, the selected record's original
text and actual record/revision identifiers. Do not invent revisions or infer authorship.
Provider namespaces remain declared and unverified. The operator must remove credentials and
unrelated private material before submission; schema validation is not content redaction.

The CLI importer and MCP tool call the same bounded, locked persistence function. A repeated
unchanged revision preserves its original clock and review decision without rewriting the
file. Different material under an existing revision, partial acquisition and deletion-bearing
batches are refused. A locally retitled observation also causes an explicit replay conflict;
do not manufacture a new upstream revision to bypass that decision.

Review at `/review` under `node foliage.mjs up --garden /absolute/garden`. Inspect
the declared source and complete selected text before approving. Approval permits the existing
promotion flow to create a pending, private Leaflet; it does not itself make the Leaflet public.
The MCP server has no approval, promotion, publishing, messaging, arbitrary file access or
provider-fetch tools. Source text is data, even when it contains instructions to an assistant.

Each serialized batch is limited to 1 MiB and each protocol frame buffer to 2 MiB. Record and
field limits come from the shared importer and are returned by the context tool. Existing
documents and merged output have an 8 MiB cap. Domain rejection preserves prior documents.

Tool calls run one at a time, in the order they arrive. A host may send the next call before the
last one answers: it waits its turn and gets the same answer it would get after that reply, its
own refusal included. Up to 8 calls wait; one more is refused unstarted as `busy · retry`. A
waiting call the host cancels, or disconnects from, never starts. A document lock held by
another local process, such as the CLI, still returns an error.

Every tool the connection registers shares that one queue: import, presentation, achievement,
search, brain, demo capture, demo browser and the project test. A recording or project test
holds the calls behind it until it ends (a project test has a two-minute limit) instead of
having them refused as busy, so a pipelined `foliage_close_demo_browser` waits for the
recording ahead of it. Shutdown is not a tool call: when the host disconnects, the demo browser
is closed and a running project test is cancelled at once.

Disconnecting or cancelling does **not** undo a write already started. If no receipt arrives,
reconnect and retry the exact batch: unchanged snapshots return unchanged IDs. A replay
conflict needs human review. Do not claim an import failed solely because its response was lost.
The stdio server closes on host EOF or termination and opens no HTTP listener.

## Owner-started private search session (signed HTTPS pilot)

An external agent can query a selected part of the local record only while the owner runs a
separate, short-lived session. This is a signed HTTP pilot, not the hosted public MCP or a
deployed remote MCP/OAuth connection. The owner must supply an existing garden, one agent's
Ed25519 **public** key, and exact record IDs. The private key stays with the agent.

```bash
node foliage.mjs private-brain list --garden /absolute/garden
node foliage.mjs private-brain serve --garden /absolute/garden \
  --agent-key /absolute/agent-public.pem --agent-label "Chosen agent" \
  --record 'claim:exact-achievement-id:exact-claim-id' --minutes 15
```

The `list` command shows the IDs in the selected Leaf and harvest without starting a listener.
By default, `serve` binds `127.0.0.1` on an ephemeral HTTP port unless the owner specifies
`--port`. To permit a client on an owner-controlled network, choose one **concrete IPv4
interface** and supply its TLS certificate and private key:

```bash
node foliage.mjs private-brain serve --garden /absolute/garden \
  --agent-key /absolute/agent-public.pem --agent-label "Chosen agent" \
  --record 'claim:exact-achievement-id:exact-claim-id' --minutes 15 \
  --bind <interface-ipv4> --tls-cert /absolute/server-cert.pem \
  --tls-key /absolute/server-key.pem
```

Foliage refuses a hostname or wildcard bind, refuses a non-default bind without both TLS
files, and requires a private regular key file inaccessible to other users. The owner must
provision a certificate whose subject alternative name matches the address or DNS name the
client actually uses. The client must verify that certificate; disabling TLS verification
defeats the transport boundary. An owner-configured raw TCP forward to the HTTPS listener
is possible, but Foliage creates no tunnel, firewall rule or startup listener. Do not expose
the HTTP loopback mode as a remote endpoint.

`serve` prints a random session ID, the agent key fingerprint, selected IDs, expiry and bound
URL. While it runs, each refused request prints one `Refused` line with its time, status and
reason, plus the agent key fingerprint once the request's signature verified; it never prints
query text or key material, and refusals are not written to the receipt log.
There is no automatic transfer, background sync or change to the public search endpoint.
TLS establishes the server's identity to a verifying client; the request signature proves
possession of the owner-selected agent key. Neither establishes a provider account identity.

The request is `POST /private-brain/search` with `Content-Type: application/json` and a JSON
body of `{ "query": "...", "limit": 1 }` (`limit` may be omitted). It carries these headers:
`x-foliage-session` (the printed ID), `x-foliage-timestamp` (Unix milliseconds),
`x-foliage-nonce` (fresh base64url, 22–64 characters), and `x-foliage-signature` (Ed25519
base64url). Sign the UTF-8 bytes of this exact newline-terminated string using the agent's
private key:

```text
foliage-private-search-v1
POST
/private-brain/search
<session ID>
<timestamp>
<nonce>
<lowercase SHA-256 hex of the raw JSON body bytes>
```

The server refuses other paths, query parameters, browser Origin requests, stale timestamps,
replayed nonces, changed selected records and signatures from other keys. It filters the exact
record IDs **before** the shared local ranker runs. The response is bounded to ten hits with
short excerpts and citations; raw evidence tuples and numeric ranking are omitted. Unreviewed,
excluded and historical private records are eligible only when the owner names their exact IDs.
A granted excluded Leaflet comes back as its title and the owner's reason, as the excerpt and in
a `reason` field. Its body is never returned and never matched.
Any selected record change ends that grant's usefulness: restart with an intentional new scope.
Returned source text is untrusted material for the receiving agent, not instructions from Foliage.

Type `revoke` and Enter in the owner's terminal to end the session immediately; closing the
terminal or reaching its 1–60 minute expiry also ends it. No answer is released if its local
transfer receipt cannot be saved first. The owner can read the append-only, mode-0600 receipt
log with `node foliage.mjs private-brain receipts --garden /absolute/garden`; it records agent
key fingerprint, exact scope and returned IDs plus a query digest, not query text. A response
already delivered to an external agent cannot be recalled.

The local HTTPS protocol test verifies certificate trust, agent-key possession, exact scope,
revoke and receipts on an available network interface. It is not a second-host round trip or
a remote MCP connector. Remaining Gate 4 acceptance includes a real outside host and account,
provider identity binding and isolation, revoke observed from that host, and owner inspection
of receipts. A client that already received an answer may retain it after revoke.

## Host compatibility and outstanding acceptance

The implementation uses the stable [official TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)
stdio server, including its legacy-client compatibility transport. Repository tests use a real
SDK client for discovery, submission and decision-preserving replay, and a separate raw
`2025-11-25` protocol client for negotiation, discovery and context. Tests derive observations
from actual temporary Git commits; they do not contact or impersonate remote providers.

| Host | Route and present evidence |
|---|---|
| Claude Code | Supports local stdio servers. Configure the command above following [Claude Code MCP](https://code.claude.com/docs/en/mcp). Local user-scoped connection reports connected (2026-09-21); host-driven mutation acceptance remains open. |
| Hermes Agent | Installed client discovery passed on 2026-09-16 in an isolated profile against the existing real pilot Leaf: both default tools of that date discovered, no model run or submission. Full host-driven acquisition acceptance remains open. Use its host-specific stdio configuration. [Hermes documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/). |
| OpenClaw | Qualify against its [MCP configuration](https://docs.openclaw.ai/cli/mcp); the installed local CLI probe discovered all seven opted-in tools of that date (2026-09-21; `foliage_import_portfolio` was added on 2026-09-28; no OpenClaw probe of it is recorded). Read-only execution passed after the [runtime registration recovery](../plugin/foliage/README.md#openclaw-202681-runtime-registration-recovery). Two actual embedded turns created/updated a journey around a manual correction on 2026-09-23; see [bounded host authoring acceptance](acceptance/2026-09-23-openclaw-authoring.md). Unattended orchestration and publication remain unaccepted. |
| Codex / VS Code | Configure the same local command using each host's schema: [Codex](https://developers.openai.com/codex/mcp), [VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers). Codex local plugin and fixed MCP configuration are installed (2026-09-21); a live Codex task called `foliage_import_context` on 2026-09-22. Host-driven mutations and VS Code acceptance remain open. |
| ChatGPT / Claude web | Require a separately deployed remote MCP service and appropriate authorization. This local stdio entry is not that deployment. [ChatGPT deployment](https://developers.openai.com/plugins/deploy/connect-chatgpt), [Claude remote connectors](https://support.claude.com/en/articles/11175166-about-custom-integrations-using-remote-mcp). |

Do not label a host “connected” from SDK tests or documentation alone. Customer acceptance
requires discovery, selected observation submission, human review and excess-access rejection
in that actual host. Remote HTTPS/OAuth, account administration, Connections UI and
permission-checked scheduled source intake remain separate work on the
[integration roadmap](INTEGRATIONS.md). An assistant session is not a grant to ingest a whole
account, disclose organizational material or publish a portfolio.

## Optional presentation editing

Launch `node foliage.mjs mcp --garden /absolute/garden --allow-presentation` to explicitly
enable `foliage_presentation_context` and `foliage_customize_presentation`. The underlying
`apps/leaf/assistant-mcp.mjs` entry accepts the same flag with explicit `--into` and `--out`.
The three default tools are unchanged. Context exposes target identity, document revision,
saved styles, named Leaf view IDs and titles, and eligible Leaflet IDs, never evidence excerpts.
Edits accept `typography` (`editorial`/`clean`), `spacing` (`airy`/`compact`), `palette`
(`source`/`quiet`), `layout` (`branching`/`linear`), `hero` (`split`/`stacked`) and `media`
(`contained`/`immersive`). They apply to the portfolio, or to one named Leaf view
(`collection`) or one Leaflet (`target`); choose at most one of the two.
Omitted style properties reset to portfolio inheritance (or Foliage defaults at portfolio scope).
Use the returned revision; a stale revision is refused. These tools use the native editor's
locked save operation and cannot alter proof or publish. This is local Photosynthesis/host
support, not a deployed cloud Scarlet editing transport.


## Optional achievement maintenance

Launch `node foliage.mjs mcp --garden /absolute/garden --allow-achievements` to allow the
local host to maintain private achievements and statements. The underlying
`apps/leaf/assistant-mcp.mjs` entry accepts the same flag with explicit `--into` and `--out`.
This grants authoring access to that one Leaf, including access to its work index and selected
retained excerpts. Use a trusted host with appropriate data handling; the stdio transport does
not control which model provider the host uses. It does not enable the TypeSafe cloud transfer
or authorize publication. Without the flag these tools are not registered.

1. `foliage_achievement_context` returns the current document revision and achievement/Leaflet
   indexes. Select `achievement` to read its existing statements, and `leaflets` (at most 12)
   to read exact retained excerpts and citation tuples. Context is bounded to 128 KiB.
2. `foliage_save_achievement` creates or renames an achievement. Reuse its stable identifier
   on later updates instead of creating a new project each time.
3. `foliage_save_statement` creates or revises one statement with exact citations. Supply its
   existing `claim` identifier when updating. Uncited statements remain private self-report.
   For a cited statement, numeric wording must occur in the selected citations' exact retained
   text or the save is refused; token presence does not verify what the number means. Neither
   a model check nor a saved statement establishes impact or attribution.

Statements can preserve `intent`, `decision`, `challenge`, `pivot`, `discovery` and `learning`,
as well as `summary`, `problem`, `contribution`, `outcome` and `ai-contribution`. These optional
categories share the existing schema, editor, citation resolver and reader projections; they
are not a second journey document or required questionnaire. Keep motives in the owner's words,
label interpretations, and retain unresolved roadblocks. Do not imply every story ends in a win.
Reconnect older MCP hosts before using the expanded enum. Older runtimes that do not recognize
these categories reject the document; update readers and writers together before adoption.

Both writes reuse `savePresentation`, including subject binding, document locks, stale-revision
refusal, citation resolution and schema limits. They cannot edit source records, proof tiers,
visibility, the personal introduction or publication settings. The portfolio, live résumé and
Markdown résumé read the same saved claims. No separate résumé is maintained by the agent.
After each write, obtain fresh context. If a response is lost, read current achievements before
retrying creation; disconnecting does not roll back a completed write. This provides the local
agent authoring operation. Journey creation and changed titles/statements now retain private
before/after versions with actor and time in the canonical Leaf. An unchanged update adds no
history. Within authorized maintenance scope an agent may rewrite owner-edited wording; retain
the owner's meaning, corrections and uncertainty rather than treating prior phrasing as frozen.
The owner can restore a version through the journey's History and undo page; restoration creates
a new edit, requires a fresh document revision and refuses unavailable citations. History does
not enter public portfolio projections or the default MCP context. Older runtimes that reject
`journeyHistory` must be upgraded before writing these documents. OpenClaw's bounded
two-turn write/update acceptance is recorded above; other named-host mutation acceptance,
unattended orchestration and project-scoped automatic publication remain outstanding.

## Aside browser tools

The installer can prepare both stdio connections for the same agent host. See
[Aside installation and acceptance](ASIDE-INSTALL.md) for source/archive commands,
permission boundaries and the selected-page handoff. Aside supplies permitted browser
inspection; this server remains the sole observation intake and review path.
