#!/bin/sh
# Foliage — the installer.
#
#   ./install.sh [--with-aside --garden /absolute/garden]
#
# ONE command to go from a fresh checkout to a machine that can run Foliage. It checks what
# you have, tells you precisely what is missing and how to get it, links the workspace once,
# proves the result actually loads, and prints the single command that starts the app.
#
# WHY THIS IS /bin/sh AND NOT NODE. The first thing it has to be able to diagnose is a
# missing or too-old Node, so it cannot be written in Node. It finds a Node, hands over to
# `tools/install/preflight.mjs` — pure JavaScript with no `.ts` anywhere in its import graph,
# for the same reason — and that file owns every message.
#
# WHAT IT WILL NOT DO, and these are commitments, not omissions:
#   * It does not phone home. There is no telemetry, no analytics, no account, no check-in.
#     By default only `pnpm install` uses the network, for declared workspace dependencies.
#     Explicit --with-aside also fetches Aside’s official installer and CLI release when absent.
#     Browser assets are served locally; Aside follows its own account/provider settings.
#   * It does not download a Node runtime behind your back. If Node is missing or wrong, it
#     refuses and prints the fix. An installer that reaches out on its own initiative is the
#     first step toward a product that does.
#   * The default writes only inside this repository (node_modules, and the symlinks under apps/*).
#     pnpm additionally maintains its own global content-addressable store; that is pnpm's,
#     documented, and shared with every other project on the machine.
#     --with-aside explicitly adds the official Aside CLI installer (user directories) and
#     a portable MCP profile in the selected garden. It changes no browser/host permissions.
#   * It never proceeds past a failed check. A half-install that looks finished is worse than
#     a refusal that names the cause.
#
# Exit codes: 0 installed · 1 a requirement is missing · 2 the install itself failed.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
WITH_ASIDE=0
ASIDE_GARDEN=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-aside) [ "$WITH_ASIDE" -eq 0 ] || { echo 'Repeated --with-aside.' >&2; exit 1; }; WITH_ASIDE=1; shift ;;
    --garden) [ -z "$ASIDE_GARDEN" ] && [ "$#" -ge 2 ] || { echo 'Provide --garden once.' >&2; exit 1; }; ASIDE_GARDEN=$2; shift 2 ;;
    --help) echo './install.sh [--with-aside --garden /absolute/existing/garden]'; echo 'Aside opt-in installs its CLI when absent and writes a portable MCP profile. Capture stays off.'; exit 0 ;;
    *) echo "Unknown installer option: $1" >&2; exit 1 ;;
  esac
done
if [ "$WITH_ASIDE" -eq 1 ]; then
  case "$ASIDE_GARDEN" in /*) [ -d "$ASIDE_GARDEN" ] || { echo 'Choose an existing garden directory.' >&2; exit 1; } ;; *) echo '--with-aside requires an absolute --garden.' >&2; exit 1 ;; esac
elif [ -n "$ASIDE_GARDEN" ]; then
  echo '--garden requires --with-aside.' >&2; exit 1
fi

BOLD=''
DIM=''
RED=''
OFF=''
if [ -t 1 ]; then
  BOLD=$(printf '\033[1m')
  DIM=$(printf '\033[2m')
  RED=$(printf '\033[31m')
  OFF=$(printf '\033[0m')
fi

say() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "${RED}$*${OFF}" >&2; }

say ""
say "${BOLD}Foliage — install${OFF}"
say "${DIM}  $ROOT${OFF}"
say ""

# ---------------------------------------------------------------------------
# 1. Is there a Node at all?
#
# Checked in shell, before anything hands a `.ts` file to a runtime that may not understand
# one. `apps/leaf/server.mjs` and `apps/leaf/intake.mjs` both import `./src/preflight.ts`
# STATICALLY, so their own friendly explanation is unreachable on a wrong Node — the module
# graph links before any of their code runs and the user gets a bare
# ERR_UNKNOWN_FILE_EXTENSION. This check is why nobody has to see that.
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  fail ""
  fail "✗ node — absent"
  fail ""
  say "Node is not installed, or is not on this shell's PATH."
  say ""
  say "Foliage runs its TypeScript sources directly — there is no build step — so it needs"
  say "Node 22.18.0 or newer, and below 25."
  say ""
  say "  nvm:            nvm install 22 && nvm use 22"
  say "  fnm:            fnm install 22 && fnm use 22"
  say "  homebrew:       brew install node@22"
  say "  or download the LTS from https://nodejs.org/ (choose 22.18.0 or newer, below 25)"
  say ""
  say "${DIM}Nothing was installed and nothing on this machine was changed.${OFF}"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Is that Node — and the pnpm and bun beside it — good enough? The logic lives in
#    tools/install/requirements.mjs and is unit-tested, because the interesting cases
#    (22.17.1, Node 25) are ones no single test runtime can reproduce.
# ---------------------------------------------------------------------------
if ! node "$ROOT/tools/install/preflight.mjs"; then
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. The one-time workspace install.
#
# Without --with-aside, this is the only network step, using your configured npm registry.
# Its workspace purpose is
# local: creating the node_modules/@foliage/* symlinks the apps import through. Nothing the
# product serves at runtime comes from a registry.
# ---------------------------------------------------------------------------
say ""
say "${BOLD}Linking the workspace${OFF} ${DIM}(pnpm install — one time)${OFF}"
say ""
if ! pnpm install; then
  fail ""
  fail "✗ pnpm install failed."
  say ""
  say "Nothing further was run. The output above is pnpm's own and is the real cause;"
  say "the two usual ones are no network access to your npm registry, and a read-only"
  say "checkout. Fix that and re-run ./install.sh — it is safe to run again."
  exit 2
fi

# ---------------------------------------------------------------------------
# 4. Prove it. `pnpm install` reporting success is not the same as the app loading.
#    `foliage.mjs up --help` loads the launcher the quickstart uses — its TypeScript graph,
#    a workspace link included (unlinked, it names `pnpm install`) — on this Node, then
#    exits: it starts no server and reads or writes no garden. It proves the launcher
#    loads; it does not start the app.
# ---------------------------------------------------------------------------
say ""
say "${BOLD}Checking the install${OFF}"
if ! node "$ROOT/foliage.mjs" up --help >/dev/null; then
  fail ""
  fail "✗ The workspace installed but the app does not load."
  say ""
  say "That is a real defect, not a configuration problem on your side. Please send the"
  say "output above in a GitHub issue."
  exit 2
fi
say "✓ foliage.mjs loads"

# ---------------------------------------------------------------------------
# 5. Optional Aside connection, after the runtime itself is proven.
# ---------------------------------------------------------------------------
if [ "$WITH_ASIDE" -eq 1 ]; then
  if ! node "$ROOT/tools/install/aside.mjs" setup --garden "$ASIDE_GARDEN" --install-cli; then
    fail 'Foliage installed; Aside setup is incomplete. Fix the reported cause and rerun.'
    exit 2
  fi
else
  node "$ROOT/tools/install/aside.mjs" doctor || say 'Aside is unavailable; local repository capture remains usable.'
fi

# ---------------------------------------------------------------------------
# 6. The single command — the quickstart's, so the app reads the garden (~/.foliage, or the
#    one chosen above), never the checkout's own apps/leaf documents.
# ---------------------------------------------------------------------------
START='node foliage.mjs up'
if [ -n "$ASIDE_GARDEN" ]; then
  START="$START --garden '$(printf '%s' "$ASIDE_GARDEN" | sed "s/'/'\\\\''/g")'"
fi
say ""
say "${BOLD}Installed.${OFF} Start Foliage with one command, from this checkout:"
say ""
say "    ${BOLD}${START}${OFF}"
say ""
say "${DIM}It starts the local app at the address it prints, bound to loopback and reachable"
say "from this machine and from nowhere else. An empty garden says so and names the"
say "command to run first.${OFF}"
say ""
