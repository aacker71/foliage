# Photosynthesis for your agent

One shared Foliage skill connects selected work to achievements, a private portfolio and a
live résumé. OpenClaw uses the portable skill; Claude Code and Codex use native plugin
manifests around that same skill. All hosts connect to one explicitly selected local runtime
and garden. There is no separate portfolio database or résumé writer in these packages.

## Install the instructions

Use an existing checkout with dependencies installed and Node 22.18+.

### OpenClaw

```bash
DISABLE_TELEMETRY=1 npx skills add /absolute/foliage/plugin/foliage --skill foliage --agent openclaw --global --copy --yes
```

The copied skill includes `scripts/photosynthesis.mjs` for doctor/status/refresh. It does not
install the runtime, create a Leaf, configure MCP, or enable a background schedule. The host
can expose it as `/foliage`. The local-checkout command is tested; no public release is claimed.

### Claude Code

```bash
claude plugin marketplace add /absolute/foliage
claude plugin install foliage@foliage --scope user
```

For an existing installation, use `claude plugin update foliage@foliage --scope user`.
Restart the Claude Code session to load updated instructions. This is a Claude Code plugin;
it does not install a Claude Desktop extension or a Claude web connector.

### Codex

The same package includes `.codex-plugin/plugin.json`. Register this directory in a local
Codex marketplace, then install `foliage@<marketplace-name>`. On the verified development
machine it is registered in the `personal` marketplace:

```bash
codex plugin add foliage@personal
```

That name requires the existing local marketplace registration; it is not a public package.
Start a new Codex task to pick up the installed skill and configured tools.

## Connect the local tools

The plugin deliberately carries no guessed checkout or garden path. Configure a user-scoped
stdio MCP server once, with absolute paths to Node, the selected runtime and the existing
garden. The following configuration allows private achievement and presentation editing:

```bash
codex mcp add foliage -- /absolute/node /absolute/foliage/foliage.mjs mcp --garden /absolute/garden --allow-achievements --allow-presentation
claude mcp add --scope user foliage -- /absolute/node /absolute/foliage/foliage.mjs mcp --garden /absolute/garden --allow-achievements --allow-presentation
openclaw mcp add foliage --command /absolute/node --arg /absolute/foliage/foliage.mjs --arg mcp --arg=--garden --arg /absolute/garden --arg=--allow-achievements --arg=--allow-presentation --cwd /absolute/foliage
```

Omit both authoring flags for the three default tools: import context, portfolio import
(preview, then add that exact text to review) and submit observations. With both flags
there are eight tools: those three, presentation context/customization, achievement
context, save achievement and save statement. These tools cannot approve, promote or publish
sources. See [the MCP contract](../../docs/ASSISTANT-MCP.md#tools-and-review-flow) for which
flag adds which tool, exact permissions, limits and recovery.

Add `--allow-search` only when the owner wants this host to read their private work record.
It exposes `foliage_search` over the selected garden's saved Leaf and bound harvest. The
default connection and the eight tools above do not imply search permission. The local CLI
can search without an MCP connection: `foliage search "words" --garden /absolute/garden`.
Search returns saved excerpts and references, not a public view.

For collection commands, record the same paths in `~/.foliage/agent-host.json`, or supply
them explicitly for the session:

```json
{"version":1,"home":"/absolute/foliage","garden":"/absolute/garden"}
```

The skill reads that binding and passes explicit paths to its adapter. The file stores no
credentials and grants no publication or cloud-transfer rights. Run the installed adapter's
`doctor --home /absolute/foliage --garden /absolute/garden` before first collection.

## What the agent does

Ask: “Update my portfolio and résumé from my selected work.” The agent reads existing
achievements, connects selected evidence, and saves supported statements through the same
revision-checked editor operation as the UI. Already-authorized private updates do not require
approval of each sentence. Missing role, judgment or outcome calls for a focused question.

`/leaf`, `/leaf/resume` and `/leaf/resume.md` read those same saved achievements. The agent
must preserve owner edits, attribution, evidence and stable identifiers. It cannot infer
impact from commit volume, treat AI interpretation as verification, or invent a career story.
New observations still enter the existing review queue. Automatic public updates and durable
background scheduling are separate acceptance work; installing this package does not enable them.

## Where processing happens

Collection, storage and MCP writes execute in the selected local runtime. Tool output and
conversation context may go to the host's configured model provider. Jev statement checking
is a separate optional cloud transfer of selected evidence with its own consent. Publication
uses its existing separate gate. A local MCP server does not make cloud model inference local.

## Verified installation, 2026-09-21–22

- Claude Code discovers the `foliage` skill and `gardener` collection agent, and its user MCP
  connection reports connected.
- Codex reports the local plugin installed/enabled and the fixed local MCP configuration enabled.
  A live Codex task called `foliage_import_context` against the selected Leaf on 2026-09-22.
- OpenClaw reports the skill eligible and model-visible; a live MCP probe discovered all seven
  tools of that date with no diagnostics (portfolio import was added on 2026-09-28; no probe of
  it is recorded). A real embedded agent called `foliage_import_context` on
  2026-09-22 after the runtime recovery below. On 2026-09-23 two real embedded turns created
  and updated a journey around a manual correction, retaining exact citations and history
  in a disposable garden; see the [acceptance record](../../docs/acceptance/2026-09-23-openclaw-authoring.md).

These are local installations. Full host-driven collection, authoring and approved publication
must be exercised before describing the entire automatic portfolio loop as accepted.

## OpenClaw 2026.8.1 runtime registration recovery

If `agent --local` reports that the Codex harness registration is missing even though
`plugins inspect codex` reports the official plugin installed/enabled, inspect runtime
selection separately from Foliage MCP discovery. In the observed default configuration,
the early startup plan selected only `memory-core`; later model selection requested Codex.

For that configuration, declaring the already-selected runtime fixed the startup plan:

```bash
openclaw config set 'agents.defaults.models["openai/*"].agentRuntime' '{"id":"codex"}' --strict-json
```

This is a targeted host recovery, not a Foliage installation default. Preserve any existing
provider/model policy; do not apply it to a host intentionally using another runtime or
custom OpenAI endpoint. It keeps model/provider selection and approval settings unchanged.
The official compatible `@openclaw/codex` plugin must also be installed and enabled.
Verify with an actual `agent --local` call and its tool receipt; plugin listing alone does
not establish that the agent loaded it. No background Gateway service is needed for this
embedded check, and this command does not enable portfolio scheduling or publication.

## Aside installation

Photosynthesis can prepare Aside browser tools and its own observation intake together.
Use `./install.sh --with-aside --garden /absolute/existing/garden`, or the equivalent
archive installer option. [Aside setup](../../docs/ASIDE-INSTALL.md) covers supported
interfaces, host configuration and acceptance. Setup does not enable browser capture.
