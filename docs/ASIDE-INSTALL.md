# Photosynthesis and Aside

Aside owns browser inspection and its account/permission controls. Photosynthesis owns
selected evidence intake, provenance and the single `/review` queue. An agent host can use
both documented stdio MCP servers. This is not an inbound MCP plugin for Aside's own agent.

## Install

From a source checkout:

```sh
./install.sh --with-aside --garden /absolute/existing/garden
```

From the extracted Foliage download, in its `runtime` folder (START-HERE step 2 extracts it into
`~/foliage-download`):

```sh
cd ~/foliage-download/runtime
node install.mjs /absolute/new/foliage-folder --with-aside --garden /absolute/existing/garden
```

Both paths use `tools/install/aside.mjs`. If the CLI is missing, the explicit opt-in invokes
Aside's official macOS installer. Other platforms need vendor setup first. The browser app,
sign-in and a normal browser window are separate prerequisites. Ordinary Foliage installation
keeps repository intake usable without Aside and does not download browser tooling.

To connect an existing installation:

```sh
node /absolute/foliage/tools/install/aside.mjs setup --garden /absolute/existing/garden --install-cli
node /absolute/foliage/tools/install/aside.mjs doctor --probe
```

The helper writes `integrations/aside.mcp.json` in the chosen garden, containing concrete
executable paths for `aside mcp --host local` and `foliage.mjs mcp --garden …`. Add those entries
using your agent host's supported configuration; the helper never replaces host settings.
It preserves an existing differing profile. After moving or upgrading the application,
review the profile paths and update the host connection to the new installation.

No authoring, private-search or publishing flags are granted. Setup does not read browser
pages, register a background job, sign in or weaken Guard/Deny settings. Aside and the agent
host have their own provider/data handling; local transport is not a promise of zero egress.

## Selected-page handoff

1. Connect both servers in the chosen host and obtain `foliage_import_context`.
2. Ask the agent to inspect only the selected page or excerpt with Aside's documented
   browser tools. Use actual source identity, text and revision information.
3. Submit the permitted excerpt through `foliage_submit_observations`, following the
   [existing observation contract](INTEGRATIONS.md#selected-observation-format).
4. Review the resulting candidate at `/review`. Intake confers neither approval nor publication.

Saved reading does not establish completion, competence or impact. Automatic browser learning,
journey attachment and permission-aware scheduling remain Claude's capture workflow work;
this installer does not implement or claim them. No second integration store or review queue.

## Release and acceptance, 2026-09-29

The adapter is reused from `cc1cb1e` on the launch-completion line, integrated onto the current
origin #94 stack. The archive packages and hashes the helper at its original relative path,
so generated MCP entries point to the installed runtime after relocation. The archive installer
checks integrity before copying and retains the usable Foliage install if optional Aside setup
fails; it prints a retry instruction rather than claiming success.

Official interfaces checked in a browser on this date:

- [Developers](https://docs.aside.com/help/developers): CLI installation, concrete command paths,
  stdio MCP server, deterministic REPL.
- [Tasks](https://docs.aside.com/help/tasks): task scope, selected page context and permission modes.
- [Permissions](https://docs.aside.com/help/security): Guard defaults and deny precedence.
- Installed `aside --help`, `aside mcp --help` and `aside guide repl`: local host option and
  CLI syntax. Installed help takes precedence over older examples on the web.

The installed CLI can report its version, but this machine's readiness probe reports no normal
browser window for the selected account. A real selected-page import has not been accepted.
Protocol tests do not stand in for that browser/account acceptance.

`https://getfoliage.com/start` was inspected live: it offers workspace and hosted previews,
with no installer download. Vercel production currently has site/preview origins but none of
`FOLIAGE_DOWNLOAD_URL`, `FOLIAGE_DOWNLOAD_SHA256`, `FOLIAGE_RELEASE_VERSION`.
The website requires all three to render its existing download section. No public artifact was
uploaded or website deployment changed in this installer work. The newer website source is
on the separate portfolio-connection line; deploying the older #94 website would regress it.

Before enabling downloads: build from a committed reviewed source, test the relocated archive,
host that exact platform-specific artifact and SHA-256, then set all three release fields and
redeploy the current website line. This archive is a Node runtime package, not a signed native
macOS/Windows installer; do not label it as a DMG, notarized app or universal binary.
