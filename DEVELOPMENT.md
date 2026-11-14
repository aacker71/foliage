# Developing Foliage

Start here for code changes. [TESTER-QUICKSTART.md](TESTER-QUICKSTART.md) is the separate
user journey with real work. Read [AGENTS.md](AGENTS.md) for the product and licensing rules.

## First checkout

Tests that need git history build their own throwaway repository (`tools/development/testRepository.mjs`), so a clone with little or no history works.
The development/CI runtime is pinned in `.nvmrc`; the broader supported runtime range
is in `package.json`. With nvm installed:

```sh
nvm install
nvm use
corepack enable
node tools/install/preflight.mjs
git --version
pnpm install --frozen-lockfile
node tools/brain/stage-gbrain.mjs
pnpm check
```

Without nvm, install the Node version in `.nvmrc` using your existing runtime manager.
Preflight checks Node's TypeScript capability, pnpm availability and bun 1.3.10 or newer
(bun builds the browser bundles and stages the local brain) without importing workspace
packages. After installation, `pnpm doctor` runs that same preflight; it is
not a credential, database, or production-readiness check. Installation enforces the
supported engine range. Do not hand-edit the lockfile to make installation pass.

`pnpm check` includes the brain offline gate (`pnpm check:brain-offline`), which runs the
pinned gbrain staged in your checkout's gitignored `vendor/`. It holds the offline proofs of the
local brain's build order items 2 to 6 (`tools/brain/offline-proofs.mjs`), so it takes about
14 minutes on an arm64 Mac. Staging is a developer step that
downloads the pinned gbrain tarball and its locked dependencies; run it again after a pin
change. The gate needs `sandbox-exec` on macOS, or `unshare` and `strace` on Linux (where it
has not run yet: only an earlier version of two of its phases was tried, in a container). A missing `vendor/` or tool fails it red with the command that fixes
it; it is never skipped. On macOS it cannot run inside another sandbox (an agent's, for
example), and says so. On Linux, where unprivileged user namespaces are blocked, it uses
`sudo -n` only in CI or with `FOLIAGE_BRAIN_GATE_SUDO=1`. To see it go red on purpose, run
`node tools/brain/plant-egress-probe.mjs fetch`, then the gate, then stage again.

Foliage ships as one download that includes the local brain (owner decision 2026-10-15; the
brain is macOS arm64 only): `node tools/deploy/package-local.mjs <new folder> --archive` builds
`<new folder>/runtime/` (the local release), `<new folder>/vendor/` (the brain unit, made from the
staged `vendor/` with its own `release.json`, `THIRD-PARTY-NOTICES` and `START-HERE.md`) and
`foliage-<version>-darwin-arm64-<rev7>.tgz` holding both (about 87 MiB, about 25 s here). It
refuses uncommitted changes unless `--include-working-tree` is given, and then the name ends in
`-dirty`. It refuses an archive of 100 MiB or more, GitHub's limit for a file, and warns from
50 MiB. The brain unit refuses a staged tree that differs from the pins or from
`tools/brain/egress-surface.json` (so a planted probe never ships), and a bun that is not the bytes
`BUN_PIN.shipped` names. `runtime/install.mjs` installs the `vendor/` beside it by default and
stops if it fails a check; `--no-brain` leaves it out. `node tools/deploy/package-brain.mjs <new folder>`
still builds the same unit as `foliage-brain-<version>-darwin-arm64.tgz` (about 74 MB) for adding
the brain to an existing install; it is not published. Neither downloads nor uploads anything;
publishing is a separate, owner-run step. `tools/deploy/package-local.test.mjs` installs the one
download on a simulated clean machine, by default with its brain and with `--no-brain` then
`--add-brain`, and runs the installers and the installed brain inside the offline gate's sandbox.
So on a Mac with Apple silicon, `pnpm test` needs a staged `vendor/` whose
`vendor/bun/bun` is exactly the pinned bytes (the bun 1.3.14 that bun's official installer put on
the build machine; any other bytes, even of 1.3.14, are refused), and that one test adds
about 3.5 minutes and roughly 2.3 GB of temporary files. `tools/deploy/package-brain.test.mjs`
copies the same bun into a synthetic checkout. On other platforms the packaging tests check that
no brain archive is made instead.

No Vercel, cloud credentials, database, AI model, gstack, or browser extension is required
for the deterministic development gate. Native Node executes TypeScript directly:
no compiler output, `dist/`, or core build step. The browser bundles are the exception:
`pnpm check` first runs `pnpm run build:bundles`, which needs bun 1.3+ for the Workflow
screen (CI pins 1.3.14); the 3D leaf and portfolio bundles build with Node.

## Short feedback loop

```sh
pnpm dev
# Leaf server, loopback only, normally http://127.0.0.1:4174
# Restarts when imported code changes. Ctrl-C stops this foreground process.
```

This is the low-level app, not an intake command. With no configured portfolio it shows
the honest missing-document state. It does not collect work, seed evidence, or publish.
To use your garden instead, follow `node foliage.mjs up --help` and the tester quickstart.
Keep personal data outside the checkout and published directories. Run each worktree on
a different free `PORT`; never kill a listener simply because you want its port.

```sh
PORT=4274 pnpm dev
pnpm test:focus packages/leaf/src/document.test.ts
pnpm test:focus --test-name-pattern='malformed policy' apps/leaf/src/exportSeam.test.ts
pnpm test:focus --watch packages/leaf/src/document.test.ts
pnpm --filter @foliage/leaf-app --fail-if-no-match typecheck
pnpm check:static
pnpm check
```

Pass an explicit test file to `test:focus`; pass Node test options **before** the file.
This is a shortcut to Node's existing test runner, not a second test framework. A focused
or watched test is feedback, not the release gate. `check:static` runs the same preflight,
boundary, egress, duplicate/dead-export, findings, and type checks used by `check`, omitting
the brain offline gate and the full test suite. CI runs `pnpm check` too, so gate additions cannot drift apart.

All workspace packages must declare a nonempty strict no-emit typecheck. The Leaf app
includes all its CLI `.mjs` files and the Node bootstrap in `checkJs`, guarded by a
configuration regression test. This does **not** claim every root/tool JavaScript file
in the repository has full static type coverage. `pnpm typecheck:tools` additionally checks
the installer, development contracts, surface definitions, and managed-server lifecycle.
The remaining legacy browser, vault, and ledger tools are not yet fully typed.

## Working alongside other agents

Inspect `git status --short` and `git worktree list` first. Use your own worktree for
independent implementation. Existing dirty changes belong to their author; do not reset,
overwrite, or stage them. Stage explicit paths, and run the full gate before a handoff.
Record the tested commit **and whether the working tree was dirty**, plus the real command
and result. Local tests do not prove hosted deployment or cloud withdrawal.

Use the installed gstack review/QA skills for their respective workflows. Optional browser
verification (`pnpm verify`) needs its browser integration; it is not part of `pnpm check`.
For detached servers, `pnpm serve` and `pnpm verify` share a supervisor per surface and
canonical worktree path. Use a different offset in each worktree:

```sh
pnpm serve up leaf --port-offset 100
pnpm serve status
pnpm verify leaf --port-offset 100
pnpm serve down leaf
```

The offset is added to each surface's normal port; `status` and `down` find the recorded
port automatically. `verify` leaves managed servers running for inspection. `down` confirms
child shutdown before replying and does not close browser tabs. Settings/data paths are
inherited from the environment at startup; stop/start to change them. The tools no longer
override these paths with shared `/tmp` demo locations.

Control sockets and logs live in an owner-only `/tmp/fol-serve-<uid>-<worktree-hash>/`
directory. These are macOS/Linux development tools, not a production process manager.
Occupied ports are refused even if they answer HTTP. The old `/tmp/foliage-surfaces.json`
registry and its processes are never adopted or stopped. A stale control socket after a
crash is an explicit failure, not permission to remove it or kill a saved PID; inspect its
log and process ownership before moving stale state aside. The supervisor owns direct
Node app children, not arbitrary descendant process trees.

## When something fails

- Unsupported runtime: select `.nvmrc`, then rerun preflight; do not mask it with global `NODE_OPTIONS`.
- Missing `@foliage/*`: run the frozen install in this worktree. Each worktree needs its own links.
- Filter matches nothing: use `--fail-if-no-match` and the exact package name in its manifest.
- `EADDRINUSE`: choose a free `PORT`; another process answering HTTP is not proof yours started.
- Boundary/egress/findings failure: fix the violated rule, not the gate configuration.
- Need a dependency change: use pnpm deliberately, review both manifest and lockfile changes,
  then rerun the frozen install and full gate. Preserve the minimum-release-age protection.
